"""Object storage abstraction (S3-compatible).

Two seams, each with a live and a stub backend:
  * Storage      — the live object store (Cloudflare R2). S3Storage is real
                   boto3; LocalStorage is an in-process stub used by tests and
                   local dev with no cloud credentials.
  * ArchiveStore — the cold-tier archive (AWS S3 Deep Archive). S3ArchiveStore
                   is real boto3; LocalArchiveStore is the in-process stub.

Both live backends are built from an explicit `ObjectStoreConfig` via the one
`_make_client()` factory, so client construction (addressing style, signature
version, checksum behaviour) never drifts between the two. Neither backend
class reads the `Settings` singleton itself — the `get_storage()` /
`get_archive_store()` factories below are the only things that translate
`Settings` into an `ObjectStoreConfig`. That split is what lets archive
integration tests build a store straight from a `ObjectStoreConfig` pointed at
a throwaway MinIO container, bypassing `Settings` entirely (plan §A.5).

The rest of the app depends only on the Storage / ArchiveStore protocols, so
swapping backends never touches service or route code.
"""
from __future__ import annotations

import dataclasses
import hashlib
import io
import uuid
import zlib
from base64 import b64encode
from struct import pack
from typing import BinaryIO, Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("storage")


class StorageError(Exception):
    pass


@dataclasses.dataclass(frozen=True)
class ObjectStoreConfig:
    """Everything a boto3 S3-compatible client needs, independent of
    `Settings`. One instance describes one client: the live R2 store and the
    archive store are each built from their own config, never from a shared
    global."""

    endpoint_url: str | None
    region: str
    access_key_id: str | None
    secret_access_key: str | None
    addressing_style: str  # "path" (R2, MinIO) or "auto" (real AWS S3)
    checksum_mode: str | None  # "when_required", or None for boto3's default


def _make_client(cfg: ObjectStoreConfig):
    """The one boto3 S3 client factory. Every Storage/ArchiveStore backend
    builds its client here so `request_checksum_calculation` /
    `response_checksum_validation` / addressing / signing never drift between
    call sites — see the R2 vs. archive client distinction in plan §A.1.
    """
    try:
        import boto3
    except ImportError as exc:  # pragma: no cover
        raise StorageError(
            "boto3 is required for S3-compatible storage. Install it or use "
            "the local stub for development/tests."
        ) from exc
    from botocore.config import Config as BotoConfig

    boto_config = BotoConfig(
        s3={"addressing_style": cfg.addressing_style},
        signature_version="s3v4",
        request_checksum_calculation=cfg.checksum_mode,
        response_checksum_validation=cfg.checksum_mode,
    )
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        region_name=cfg.region,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        config=boto_config,
    )


@dataclasses.dataclass(frozen=True)
class ObjectHead:
    """Metadata from a HEAD (or GET) against an object store, independent of
    which backend served it."""

    size: int
    etag: str
    storage_class: str | None
    version_id: str | None


@dataclasses.dataclass(frozen=True)
class ArchiveReceipt:
    """Proof an archive PUT landed, returned by `put_archive_object`.
    `crc32` is base64-encoded, matching how S3 itself reports
    `ChecksumCRC32` — so a receipt's value can be diffed directly against
    what a later HEAD/GetObjectAttributes call reports."""

    version_id: str | None
    md5: str
    sha256: str
    crc32: str
    size: int


class _ChecksummingReader:
    """Wraps a binary stream, updating MD5/SHA-256/CRC32 digests as bytes
    pass through `read()` — lets `put_archive_object` compute all three in
    the same pass the upload already makes over the source, instead of
    buffering the whole object twice."""

    def __init__(self, source: BinaryIO) -> None:
        self._source = source
        self._md5 = hashlib.md5()
        self._sha256 = hashlib.sha256()
        self._crc32 = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self._source.read(size)
        if chunk:
            self._md5.update(chunk)
            self._sha256.update(chunk)
            self._crc32 = zlib.crc32(chunk, self._crc32)
        return chunk

    @property
    def md5_hex(self) -> str:
        return self._md5.hexdigest()

    @property
    def sha256_hex(self) -> str:
        return self._sha256.hexdigest()

    @property
    def crc32_b64(self) -> str:
        return b64encode(pack(">I", self._crc32)).decode()


class Storage(Protocol):
    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str: ...

    def put_object(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        """Write `data` directly, server-side — no client, no presigned URL.
        The one write path on this protocol with no ticket/PUT/confirm round
        trip; use it only when the caller already has the bytes in hand and
        there is no client to hand a presigned URL to (e.g. the OAuth avatar
        sync, ADR 0015, fetching a provider's profile picture server-side)."""
        ...

    def presigned_download_url(self, bucket: str, key: str, expires_in: int) -> str: ...

    def object_exists(self, bucket: str, key: str) -> bool: ...

    def object_size(self, bucket: str, key: str) -> int | None: ...

    def delete_object(self, bucket: str, key: str) -> None: ...

    def open_read(self, bucket: str, key: str) -> tuple[BinaryIO, ObjectHead]:
        """Open a readable stream on an object, alongside its HEAD metadata.
        The archive copy path (R1.9) reads the raw master through this to
        stream it into `ArchiveStore.put_archive_object` — cross-vendor
        copies (R2 → AWS) can't use a server-side CopyObject, since that only
        works within one account (plan §A.1, AM5)."""
        ...

    def copy_object(
        self,
        src_bucket: str,
        src_key: str,
        dest_bucket: str,
        dest_key: str,
        *,
        storage_class: str | None = None,
    ) -> None: ...

    def object_storage_class(self, bucket: str, key: str) -> str | None:
        """The object's storage class (e.g. 'STANDARD', 'DEEP_ARCHIVE'), or
        None if the object does not exist. Callers that need to *prove* an
        archival copy landed in the expected class must call this — never
        infer it from copy_object() succeeding or from a bucket lifecycle
        rule's mere existence (plan §A.2, W1.4: "a configured lifecycle rule
        that never fires looks identical to a working one until you need the
        tape")."""
        ...


class LocalStorage:
    """Stub backend. Records 'uploaded' keys in memory so object_exists() can
    behave sensibly in tests without any network."""

    def __init__(self) -> None:
        self._objects: set[tuple[str, str]] = set()
        self._storage_class: dict[tuple[str, str], str] = {}
        # Unlike the presigned-upload path (which never sees real bytes —
        # see `open_read`'s docstring), `put_object` IS handed real bytes
        # directly, so the stub keeps them: a test asserting on the exact
        # content-type/payload an OAuth avatar sync wrote needs somewhere to
        # read that back from.
        self._put_objects: dict[tuple[str, str], tuple[bytes, str]] = {}

    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str:
        # Pretend the client uploads successfully the moment it's issued.
        self._objects.add((bucket, key))
        return f"https://local-storage.invalid/{bucket}/{key}?upload=1&expires={expires_in}"

    def put_object(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self._objects.add((bucket, key))
        self._put_objects[(bucket, key)] = (data, content_type)

    def presigned_download_url(self, bucket: str, key: str, expires_in: int) -> str:
        return f"https://local-storage.invalid/{bucket}/{key}?expires={expires_in}"

    def object_exists(self, bucket: str, key: str) -> bool:
        return (bucket, key) in self._objects

    def object_size(self, bucket: str, key: str) -> int | None:
        """The stub stores no real bytes, so the observed size is genuinely
        unknown -> None. `confirm_upload` treats None as "can't verify, don't
        override". Tests that exercise the confirm-time size cap monkeypatch
        this to return a concrete value (mirroring how they monkeypatch
        object_exists)."""
        return None

    def delete_object(self, bucket: str, key: str) -> None:
        self._objects.discard((bucket, key))
        self._storage_class.pop((bucket, key), None)

    def open_read(self, bucket: str, key: str) -> tuple[BinaryIO, ObjectHead]:
        """Stub read. No real bytes ever reached this backend — like
        `object_size`, `presigned_upload_url` only pretends a transfer
        happened — so this hands back a small deterministic payload for any
        key marked uploaded. Enough for the archive seam's checksum plumbing
        to be exercised end-to-end in unit tests without real I/O; tests that
        need to assert specific archived bytes should seed a real upload via
        the S3ArchiveStore/LocalArchiveStore pair directly instead."""
        if (bucket, key) not in self._objects:
            raise StorageError(f"Cannot read: object not found ({bucket}/{key})")
        payload = f"local-stub-content:{bucket}/{key}".encode()
        head = ObjectHead(
            size=len(payload),
            etag=hashlib.md5(payload).hexdigest(),
            storage_class=self._storage_class.get((bucket, key), "STANDARD"),
            version_id=None,
        )
        return io.BytesIO(payload), head

    def copy_object(
        self,
        src_bucket: str,
        src_key: str,
        dest_bucket: str,
        dest_key: str,
        *,
        storage_class: str | None = None,
    ) -> None:
        if (src_bucket, src_key) not in self._objects:
            raise StorageError(
                f"Cannot copy: source object not found ({src_bucket}/{src_key})"
            )
        self._objects.add((dest_bucket, dest_key))
        self._storage_class[(dest_bucket, dest_key)] = storage_class or "STANDARD"

    def object_storage_class(self, bucket: str, key: str) -> str | None:
        if (bucket, key) not in self._objects:
            return None
        return self._storage_class.get((bucket, key), "STANDARD")


class S3Storage:
    """Live object store client (Cloudflare R2). Built entirely from the
    `ObjectStoreConfig` passed in — never reads `Settings` itself; see the
    module docstring."""

    def __init__(self, cfg: ObjectStoreConfig) -> None:
        self._client = _make_client(cfg)

    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str:
        return self._client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

    def put_object(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        """Direct server-side write of bytes already in hand — a single
        `PutObject` call, not `Client.upload_fileobj`'s managed multipart
        transfer (`copy_object` below / `S3ArchiveStore.put_archive_object`
        use that instead): every caller of this method is bounded by
        `settings.max_thumbnail_bytes` (10 MB), nowhere near the 5 GB
        single-PUT ceiling that justifies the managed transfer elsewhere in
        this file."""
        from botocore.exceptions import ClientError

        try:
            self._client.put_object(
                Bucket=bucket, Key=key, Body=data, ContentType=content_type
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            log.error("s3_put_object_failed", bucket=bucket, key=key, code=code)
            raise StorageError(f"Could not write object (S3 error {code}).") from exc

    def presigned_download_url(self, bucket: str, key: str, expires_in: int) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def object_exists(self, bucket: str, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")

            # Only a genuine "not there" should return False.
            if code in ("404", "NoSuchKey") or status == 404:
                return False

            # 403 (missing s3:GetObject), wrong region, bad credentials — these
            # are infrastructure faults, not a missing upload. Say so.
            log.error(
                "s3_head_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not verify the uploaded object (S3 error {code}). "
                "Check the IAM policy grants s3:GetObject on this bucket."
            ) from exc

    def object_size(self, bucket: str, key: str) -> int | None:
        """ContentLength of the stored object, or None if it is not there.

        Used at upload-confirm time to enforce the size cap against the real
        bytes that landed, not the client's declared figure. A non-404 error
        is an infrastructure fault and is raised, matching object_exists.
        """
        from botocore.exceptions import ClientError

        try:
            head = self._client.head_object(Bucket=bucket, Key=key)
            return int(head["ContentLength"])
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey") or status == 404:
                return None
            log.error(
                "s3_head_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not size the uploaded object (S3 error {code})."
            ) from exc

    def delete_object(self, bucket: str, key: str) -> None:
        """Delete an object. A 404/NoSuchKey means the end state is already
        correct (nothing to delete), so it's success, not an error — a retry
        of a delete that already landed must not fail. Anything else is an
        infrastructure fault and is raised."""
        from botocore.exceptions import ClientError

        try:
            self._client.delete_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey") or status == 404:
                log.info("s3_delete_object_missing", bucket=bucket, key=key)
                return
            log.error(
                "s3_delete_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not delete object (S3 error {code})."
            ) from exc

    def open_read(self, bucket: str, key: str) -> tuple[BinaryIO, ObjectHead]:
        from botocore.exceptions import ClientError

        try:
            resp = self._client.get_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            log.error(
                "s3_get_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not open object for reading (S3 error {code})."
            ) from exc

        head = ObjectHead(
            size=int(resp["ContentLength"]),
            etag=resp.get("ETag", "").strip('"'),
            storage_class=resp.get("StorageClass", "STANDARD"),
            version_id=resp.get("VersionId"),
        )
        return resp["Body"], head

    def copy_object(
        self,
        src_bucket: str,
        src_key: str,
        dest_bucket: str,
        dest_key: str,
        *,
        storage_class: str | None = None,
    ) -> None:
        """Managed copy (`Client.copy`, not the raw `copy_object` API call).

        A raw `CopyObject` request is capped at 5 GiB source size; a raw
        sermon master can legitimately sit right at `max_upload_bytes` (5 GB),
        so a single-call copy has no safety margin. `Client.copy` is boto3's
        managed transfer — it multipart-copies automatically above the
        threshold, same idea as a multipart upload, so this works uniformly
        regardless of master size. `StorageClass` is a documented
        `ALLOWED_COPY_ARGS` key for this method.
        """
        from botocore.exceptions import ClientError

        extra_args = {"StorageClass": storage_class} if storage_class else None
        try:
            self._client.copy(
                CopySource={"Bucket": src_bucket, "Key": src_key},
                Bucket=dest_bucket,
                Key=dest_key,
                ExtraArgs=extra_args,
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            log.error(
                "s3_copy_object_failed",
                src=f"{src_bucket}/{src_key}", dest=f"{dest_bucket}/{dest_key}",
                code=code,
            )
            raise StorageError(
                f"Could not copy object to archive (S3 error {code})."
            ) from exc

    def object_storage_class(self, bucket: str, key: str) -> str | None:
        from botocore.exceptions import ClientError

        try:
            head = self._client.head_object(Bucket=bucket, Key=key)
            # boto3/S3 omit the StorageClass field entirely for STANDARD —
            # its presence is the signal, not its absence.
            return head.get("StorageClass", "STANDARD")
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey") or status == 404:
                return None
            log.error(
                "s3_head_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not read storage class (S3 error {code})."
            ) from exc


_backend: Storage | None = None


def get_storage() -> Storage:
    """Return the active storage backend (singleton).

    Uses R2 when credentials are configured, otherwise the local stub — so the
    app boots and is fully testable with no cloud setup. The live store is
    always Cloudflare R2 (decision (a): S3 now names the archive vendor only),
    so `region`/`addressing_style`/`checksum_mode` are fixed here rather than
    configurable — see plan §A.1.
    """
    global _backend
    if _backend is None:
        if settings.storage_is_live:
            cfg = ObjectStoreConfig(
                endpoint_url=settings.object_store_endpoint_url,
                region="auto",
                access_key_id=settings.object_store_access_key_id,
                secret_access_key=settings.object_store_secret_access_key,
                addressing_style="path",
                checksum_mode="when_required",
            )
            _backend = S3Storage(cfg)
            log.info("storage_backend", backend="s3", bucket=settings.object_store_media_bucket)
        elif settings.is_production:
            # Belt-and-braces: config preflight already blocks this, but never
            # let a stub serve production traffic even if that is bypassed.
            raise StorageError(
                "Refusing to use the stub storage backend in production. "
                "Set OBJECT_STORE_ACCESS_KEY_ID and OBJECT_STORE_SECRET_ACCESS_KEY."
            )
        else:
            _backend = LocalStorage()
            log.warning("storage_backend", backend="local_stub", live=False)
    return _backend


def set_storage(backend: Storage | None) -> None:
    """Override the backend (used by tests)."""
    global _backend
    _backend = backend


class ArchiveStore(Protocol):
    """The cold-tier archive (AWS S3 Deep Archive). Deliberately a separate
    protocol from `Storage`, not another method on it: the archive vendor
    (AWS) and the live vendor (R2) are different accounts with different
    credentials, and cross-vendor copy is a manual read-then-write (see
    `Storage.open_read`), not a server-side `CopyObject`."""

    def head(
        self, bucket: str, key: str, version_id: str | None = None
    ) -> ObjectHead | None: ...

    def put_archive_object(
        self,
        bucket: str,
        key: str,
        source: BinaryIO,
        *,
        size: int,
        storage_class: str,
        metadata: dict[str, str],
    ) -> ArchiveReceipt:
        """Stream `source` into the archive, computing MD5/SHA-256/CRC32 as it
        goes. The receipt carries the resulting `version_id`, which callers
        pin future HEAD/restore calls to — never "the current version"."""
        ...


class LocalArchiveStore:
    """Stub archive backend. Unlike `LocalStorage`, this stores real bytes:
    the archive seam's whole point is proving a verified copy exists, so a
    stub that can't be read back and checksummed can't exercise that."""

    def __init__(self) -> None:
        self._objects: dict[tuple[str, str], bytes] = {}
        self._storage_class: dict[tuple[str, str], str] = {}
        self._version_ids: dict[tuple[str, str], str] = {}
        self._version_counter = 0

    def head(
        self, bucket: str, key: str, version_id: str | None = None
    ) -> ObjectHead | None:
        data = self._objects.get((bucket, key))
        if data is None:
            return None
        stored_version = self._version_ids.get((bucket, key))
        if version_id is not None and version_id != stored_version:
            return None
        return ObjectHead(
            size=len(data),
            etag=hashlib.md5(data).hexdigest(),
            storage_class=self._storage_class.get((bucket, key)),
            version_id=stored_version,
        )

    def put_archive_object(
        self,
        bucket: str,
        key: str,
        source: BinaryIO,
        *,
        size: int,
        storage_class: str,
        metadata: dict[str, str],
    ) -> ArchiveReceipt:
        reader = _ChecksummingReader(source)
        data = reader.read()
        self._objects[(bucket, key)] = data
        self._storage_class[(bucket, key)] = storage_class
        self._version_counter += 1
        version_id = f"local-v{self._version_counter}"
        self._version_ids[(bucket, key)] = version_id
        return ArchiveReceipt(
            version_id=version_id,
            md5=reader.md5_hex,
            sha256=reader.sha256_hex,
            crc32=reader.crc32_b64,
            size=len(data),
        )


class S3ArchiveStore:
    """Real AWS S3 Deep Archive client. Built entirely from the
    `ObjectStoreConfig` passed in — never reads `Settings` itself, so
    archive_integration tests (plan §A.5, R1.8) can point this at a MinIO
    stand-in with nothing more than a differently-built config."""

    def __init__(self, cfg: ObjectStoreConfig) -> None:
        self._client = _make_client(cfg)

    def head(
        self, bucket: str, key: str, version_id: str | None = None
    ) -> ObjectHead | None:
        from botocore.exceptions import ClientError

        params: dict[str, str] = {"Bucket": bucket, "Key": key}
        if version_id is not None:
            params["VersionId"] = version_id
        try:
            resp = self._client.head_object(**params)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey") or status == 404:
                return None
            log.error(
                "archive_head_object_failed",
                bucket=bucket, key=key, code=code, status=status,
            )
            raise StorageError(
                f"Could not head archive object (S3 error {code})."
            ) from exc
        return ObjectHead(
            size=int(resp["ContentLength"]),
            etag=resp.get("ETag", "").strip('"'),
            storage_class=resp.get("StorageClass", "STANDARD"),
            version_id=resp.get("VersionId"),
        )

    def put_archive_object(
        self,
        bucket: str,
        key: str,
        source: BinaryIO,
        *,
        size: int,
        storage_class: str,
        metadata: dict[str, str],
    ) -> ArchiveReceipt:
        """Managed upload (`Client.upload_fileobj`, boto3's multipart-aware
        transfer manager — same rationale as `S3Storage.copy_object`: a raw
        master can sit right at the 5 GB single-PUT ceiling). Resume, lease
        fencing and the exact `StorageClass`/`ChecksumAlgorithm` call-shape
        assertion belong to the archive_service/sweep_archives orchestration
        layer (R1.9, plan AM5) built on top of this method, not to the seam
        itself.
        """
        from botocore.exceptions import ClientError

        reader = _ChecksummingReader(source)
        extra_args = {
            "StorageClass": storage_class,
            "ChecksumAlgorithm": "CRC32",
            "ChecksumType": "FULL_OBJECT",
            "Metadata": metadata,
        }
        try:
            self._client.upload_fileobj(reader, bucket, key, ExtraArgs=extra_args)
            head = self._client.head_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            log.error(
                "archive_put_object_failed", bucket=bucket, key=key, code=code,
            )
            raise StorageError(
                f"Could not archive object (S3 error {code})."
            ) from exc

        return ArchiveReceipt(
            version_id=head.get("VersionId"),
            md5=reader.md5_hex,
            sha256=reader.sha256_hex,
            crc32=reader.crc32_b64,
            size=size,
        )


_archive_backend: ArchiveStore | None = None


def get_archive_store() -> ArchiveStore:
    """Return the active archive backend (singleton).

    Real AWS S3 when archive credentials are configured (`settings.
    archive_is_live` — access key, secret and region all set; see
    app/core/config.py), otherwise the local stub — mirrors `get_storage()`'s
    shape. Unlike the R2 live store, the archive client keeps boto3's
    default checksum behaviour rather than `when_required` (plan §A.1: an
    Object Lock bucket requires a checksum on PUT/UploadPart) and has no
    custom endpoint — `endpoint_url=None` lets boto3 resolve AWS's real
    per-region S3 endpoint.
    """
    global _archive_backend
    if _archive_backend is None:
        if settings.archive_is_live:
            cfg = ObjectStoreConfig(
                endpoint_url=None,
                region=settings.archive_store_region,
                access_key_id=settings.archive_store_access_key_id,
                secret_access_key=settings.archive_store_secret_access_key,
                addressing_style="auto",
                checksum_mode=None,
            )
            _archive_backend = S3ArchiveStore(cfg)
            log.info("archive_backend", backend="s3", bucket=settings.archive_store_bucket)
        elif settings.is_production:
            # Belt-and-braces, same rationale as get_storage(): the
            # production preflight is the primary control; this refuses to
            # let a stub serve production traffic even if that's bypassed.
            raise StorageError(
                "Refusing to use the stub archive backend in production. "
                "No live archive credentials are configured."
            )
        else:
            _archive_backend = LocalArchiveStore()
            log.warning("archive_backend", backend="local_stub", live=False)
    return _archive_backend


def set_archive_store(backend: ArchiveStore | None) -> None:
    """Override the archive backend (used by tests)."""
    global _archive_backend
    _archive_backend = backend


def raw_key(sermon_id: uuid.UUID, filename: str) -> str:
    """Key for the editor's original upload."""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    return f"raw/{sermon_id}/{uuid.uuid4()}.{suffix}"


def media_key(sermon_id: uuid.UUID, kind: str, quality: str | None = None) -> str:
    """Key for a processed rendition."""
    if quality:
        return f"sermons/{sermon_id}/{kind}/{quality}/index.m3u8"
    return f"sermons/{sermon_id}/{kind}/index.m3u8"


def archive_key(sermon_id: uuid.UUID, raw_key: str) -> str:
    """Key for the Deep Archive copy of a raw master, under /sermon_archives
    — the archive destination confirmed in status.md ("W0.1 Glacier archive
    location confirmed"), in the SAME raw bucket. Mirrors the raw key's own
    filename so the two are trivially correlated by eye.
    """
    filename = raw_key.rsplit("/", 1)[-1]
    return f"sermon_archives/{sermon_id}/{filename}"


def thumbnail_key(kind: str, entity_id: uuid.UUID, filename: str) -> str:
    """Key for a cover image. `kind` is "sermons" or "series".

    A fresh UUID per upload means replacing a thumbnail never collides with a
    cached copy of the old one at the same URL.
    """
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"thumbnails/{kind}/{entity_id}/{uuid.uuid4()}.{suffix}"


def avatar_key(user_id: uuid.UUID, filename: str) -> str:
    """Key for a profile picture — same shape as `thumbnail_key`, a fresh UUID per
    upload so replacing an avatar never collides with a cached copy of the old one
    at the same URL."""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"avatars/{user_id}/{uuid.uuid4()}.{suffix}"


def playlist_cover_key(playlist_id: uuid.UUID, filename: str) -> str:
    """Key for a playlist cover image — same shape as `avatar_key`, a fresh
    UUID per upload so replacing a cover never collides with a cached copy of
    the old one at the same URL."""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"playlist_covers/{playlist_id}/{uuid.uuid4()}.{suffix}"


def cdn_url_for(key: str, *, presigned_fallback: str) -> str:
    """Resolve the URL a client should use to fetch `key`.

    This is the ONE place that decides CDN vs. presigned S3 for every
    CDN-eligible asset (media playback, thumbnails, announcement images) —
    callers compute a presigned URL first (it's the safe default) and hand it
    here as `presigned_fallback`, rather than each building its own
    `f"{cdn_base_url}/{key}"` string.

    There is currently no CDN request-signing implementation in this codebase
    — no signing key/keypair setting exists alongside `cdn_base_url` — so a
    bare CDN URL carries no access control at all. For a deterministic key
    (e.g. `media_key()`'s sermon_id/kind/quality path, built from a
    publicly-visible sermon UUID) that isn't a cosmetic gap: it lets anyone
    construct a URL to any rendition by editing the key, bypassing whatever
    the caller was gating (see media_service.get_stream's paid-quality
    filter). So until real CDN signing is built, this always returns the
    presigned fallback rather than ever emitting an unsigned CDN URL.
    `Settings.production_preflight` refuses to boot with `cdn_base_url` set
    at all for exactly this reason, and `app/scripts/preflight.py` mirrors
    that check for staging — so the branch below should be unreachable in a
    correctly configured deployment; it's a second line of defense, not the
    primary control. When real signing is implemented, it belongs here, so
    every call site below picks it up automatically.
    """
    if settings.cdn_base_url:
        log.error(
            "cdn_signing_unavailable",
            key=key,
            msg=(
                "cdn_base_url is configured but no CDN signing is implemented; "
                "serving a presigned URL instead of an unsigned CDN URL"
            ),
        )
    return presigned_fallback
