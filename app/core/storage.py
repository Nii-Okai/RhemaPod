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

    def delete_object(self, bucket: str, key: str) -> None: ...


class LocalStorage:
    """Stub backend. Records 'uploaded' keys in memory so object_exists() can
    behave sensibly in tests without any network."""

    def __init__(self) -> None:
        self._objects: set[tuple[str, str]] = set()

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

    def delete_object(self, bucket: str, key: str) -> None:
        self._objects.discard((bucket, key))


class S3Storage:
    def __init__(self) -> None:
        try:
            import boto3  # imported lazily so the stub path needs no boto3
        except ImportError as exc:  # pragma: no cover
            raise StorageError(
                "boto3 is required for S3 storage. Install it or set "
                "STORAGE_BACKEND=local for development."
            ) from exc

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
        )

    def presigned_upload_url(
        self, bucket: str, key: str, content_type: str, expires_in: int
    ) -> str:
        return self._client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

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

    def delete_object(self, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


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


def thumbnail_key(kind: str, entity_id: uuid.UUID, filename: str) -> str:
    """Key for a cover image. `kind` is "sermons" or "series".

    A fresh UUID per upload means replacing a thumbnail never collides with a
    cached copy of the old one at the same URL.
    """
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"thumbnails/{kind}/{entity_id}/{uuid.uuid4()}.{suffix}"
