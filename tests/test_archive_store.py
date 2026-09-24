"""The ArchiveStore seam (plan §A.1, R1.2): `LocalArchiveStore` and
`S3ArchiveStore` client construction.

`put_archive_object`'s exact AWS call shape (StorageClass=DEEP_ARCHIVE,
ChecksumAlgorithm=CRC32, ChecksumType=FULL_OBJECT, multipart/resume) is
proved at R1.9's unit tier by spying the client kwargs (plan AM5) — this file
only proves the seam itself: the protocol's two implementations behave
correctly, and the archive client's checksum config differs from the R2
client's (A.5's "checksum shape asserted at the unit tier" starts here).
"""
import hashlib
import io
import zlib
from base64 import b64encode
from struct import pack

from botocore.stub import Stubber

from app.core.storage import (
    ArchiveReceipt,
    LocalArchiveStore,
    ObjectHead,
    S3ArchiveStore,
    StorageError,
    _make_client,
)
from tests.test_storage_seam import _cfg


def _crc32_b64(data: bytes) -> str:
    return b64encode(pack(">I", zlib.crc32(data))).decode()


# ── LocalArchiveStore: put/head roundtrip ─────────────────────────────────────
def test_local_archive_store_put_then_head_roundtrip():
    store = LocalArchiveStore()
    payload = b"sermon master bytes" * 1000
    receipt = store.put_archive_object(
        "archive-bucket", "sermon_archives/s1/master.mp4", io.BytesIO(payload),
        size=len(payload), storage_class="DEEP_ARCHIVE", metadata={"sermon_id": "s1"},
    )

    assert isinstance(receipt, ArchiveReceipt)
    assert receipt.md5 == hashlib.md5(payload).hexdigest()
    assert receipt.sha256 == hashlib.sha256(payload).hexdigest()
    assert receipt.crc32 == _crc32_b64(payload)
    assert receipt.size == len(payload)
    assert receipt.version_id

    head = store.head("archive-bucket", "sermon_archives/s1/master.mp4")
    assert isinstance(head, ObjectHead)
    assert head.size == len(payload)
    assert head.storage_class == "DEEP_ARCHIVE"
    assert head.version_id == receipt.version_id


def test_local_archive_store_head_missing_key_returns_none():
    store = LocalArchiveStore()
    assert store.head("archive-bucket", "sermon_archives/nope/master.mp4") is None


def test_local_archive_store_head_wrong_version_id_returns_none():
    store = LocalArchiveStore()
    payload = b"bytes"
    store.put_archive_object(
        "archive-bucket", "k", io.BytesIO(payload),
        size=len(payload), storage_class="DEEP_ARCHIVE", metadata={},
    )
    assert store.head("archive-bucket", "k", version_id="not-the-real-version") is None


# ── S3ArchiveStore: client construction ───────────────────────────────────────
def test_archive_client_checksum_config_differs_from_r2():
    """The load-bearing assertion R1.2's verification bullet asks for: the R2
    client forces when_required; the archive client does not."""
    r2_client = _make_client(_cfg())  # checksum_mode="when_required"
    archive_client = _make_client(_cfg(checksum_mode=None, addressing_style="auto"))

    assert r2_client.meta.config.request_checksum_calculation == "when_required"
    assert archive_client.meta.config.request_checksum_calculation != "when_required"


def test_s3_archive_store_head_missing_key_returns_none():
    store = S3ArchiveStore(_cfg(checksum_mode=None, addressing_style="auto"))
    with Stubber(store._client) as stub:
        stub.add_client_error(
            "head_object", service_error_code="NoSuchKey", http_status_code=404,
        )
        assert store.head("archive-bucket", "sermon_archives/nope/master.mp4") is None


def test_s3_archive_store_head_infra_fault_raises():
    store = S3ArchiveStore(_cfg(checksum_mode=None, addressing_style="auto"))
    with Stubber(store._client) as stub:
        stub.add_client_error(
            "head_object", service_error_code="AccessDenied", http_status_code=403,
        )
        try:
            store.head("archive-bucket", "k")
        except StorageError:
            pass
        else:
            raise AssertionError("expected StorageError for a non-404 head failure")


def test_s3_archive_store_head_passes_version_id():
    store = S3ArchiveStore(_cfg(checksum_mode=None, addressing_style="auto"))
    with Stubber(store._client) as stub:
        stub.add_response(
            "head_object",
            {"ContentLength": 10, "ETag": '"abc"', "StorageClass": "DEEP_ARCHIVE", "VersionId": "v1"},
            {"Bucket": "archive-bucket", "Key": "k", "VersionId": "v1"},
        )
        head = store.head("archive-bucket", "k", version_id="v1")
        assert head == ObjectHead(size=10, etag="abc", storage_class="DEEP_ARCHIVE", version_id="v1")
