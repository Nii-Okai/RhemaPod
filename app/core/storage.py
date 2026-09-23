"""Object storage abstraction (S3-compatible).

Two backends:
  * S3Storage    — real AWS S3 / Cloudflare R2 / MinIO via boto3.
  * LocalStorage — in-process stub used by tests and local dev with no cloud
                   credentials. Generates deterministic fake URLs.

The rest of the app depends only on the Storage protocol, so swapping backends
never touches service or route code.
"""
from __future__ import annotations

import uuid
from typing import Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("storage")


class StorageError(Exception):
    pass


class Storage(Protocol):
    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str: ...

    def presigned_download_url(self, bucket: str, key: str, expires_in: int) -> str: ...

    def object_exists(self, bucket: str, key: str) -> bool: ...

    def object_size(self, bucket: str, key: str) -> int | None: ...

    def delete_object(self, bucket: str, key: str) -> None: ...

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

    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str:
        # Pretend the client uploads successfully the moment it's issued.
        self._objects.add((bucket, key))
        return f"https://local-storage.invalid/{bucket}/{key}?upload=1&expires={expires_in}"

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
    def __init__(self) -> None:
        try:
            import boto3  # imported lazily so the stub path needs no boto3
        except ImportError as exc:  # pragma: no cover
            raise StorageError(
                "boto3 is required for S3 storage. Install it or set "
                "STORAGE_BACKEND=local for development."
            ) from exc

        client_config = None
        if settings.s3_endpoint_url:
            from botocore.config import Config as BotoConfig

            # A custom endpoint means MinIO / R2 / another S3-compatible store.
            # Force path-style addressing (bucket in the path, not the hostname)
            # — MinIO does not serve virtual-host-style buckets without extra DNS
            # setup — and pin SigV4.
            client_config = BotoConfig(
                s3={"addressing_style": "path"}, signature_version="s3v4"
            )

        common = dict(
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=client_config,
        )

        # Client for this process's own reads/writes (object_exists, delete).
        self._client = boto3.client(
            "s3", endpoint_url=settings.s3_endpoint_url, **common
        )

        # Client used ONLY to mint presigned URLs the BROWSER will follow. When
        # the browser reaches storage on a different host than this process does
        # (compose: browser → localhost:9000, API → minio:9000), the URL must be
        # signed for the browser's host: SigV4 signs the Host header even for
        # query-string auth, so a signature made for minio:9000 fails when the
        # request lands with Host: localhost:9000. Presigning is offline HMAC, so
        # pointing this client at a host THIS process cannot reach is harmless.
        # Unset s3_public_endpoint (real AWS S3) → same client, no split.
        if settings.s3_public_endpoint:
            self._presign_client = boto3.client(
                "s3", endpoint_url=settings.s3_public_endpoint, **common
            )
        else:
            self._presign_client = self._client

    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str:
        return self._presign_client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

    def presigned_download_url(self, bucket: str, key: str, expires_in: int) -> str:
        return self._presign_client.generate_presigned_url(
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
        self._client.delete_object(Bucket=bucket, Key=key)

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

    Uses S3 when credentials are configured, otherwise the local stub — so the
    app boots and is fully testable with no cloud setup.
    """
    global _backend
    if _backend is None:
        if settings.storage_is_live:
            _backend = S3Storage()
            log.info("storage_backend", backend="s3", bucket=settings.s3_media_bucket)
        elif settings.is_production:
            # Belt-and-braces: config preflight already blocks this, but never
            # let a stub serve production traffic even if that is bypassed.
            raise StorageError(
                "Refusing to use the stub storage backend in production. "
                "Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
            )
        else:
            _backend = LocalStorage()
            log.warning("storage_backend", backend="local_stub", live=False)
    return _backend


def set_storage(backend: Storage | None) -> None:
    """Override the backend (used by tests)."""
    global _backend
    _backend = backend


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
