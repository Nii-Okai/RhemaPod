"""The object-storage seam (plan §A.1, R1.2): `ObjectStoreConfig`/`_make_client`,
`S3Storage`, and `LocalStorage.open_read`.

Pure unit tests — no live R2/AWS, no MinIO. `S3Storage` is exercised only
through client construction and `botocore.stub.Stubber`, never a real
network call.
"""
from botocore.stub import Stubber

from app.core import storage as storage_module
from app.core.storage import LocalStorage, ObjectHead, ObjectStoreConfig, S3Storage, StorageError


def _cfg(**overrides) -> ObjectStoreConfig:
    base = dict(
        endpoint_url="https://abc123.r2.cloudflarestorage.com",
        region="auto",
        access_key_id="r2-key",
        secret_access_key="r2-secret",
        addressing_style="path",
        checksum_mode="when_required",
    )
    base.update(overrides)
    return ObjectStoreConfig(**base)


# ── ObjectStoreConfig / _make_client ──────────────────────────────────────────
def test_r2_client_forces_when_required_checksums():
    client = storage_module._make_client(_cfg())
    assert client.meta.config.request_checksum_calculation == "when_required"
    assert client.meta.config.response_checksum_validation == "when_required"


def test_archive_style_client_keeps_boto3_default_checksums():
    """The archive client (built the same way, just with checksum_mode=None)
    must NOT be when_required — Object Lock PUTs need boto3's own default
    checksum behaviour (plan §A.1)."""
    client = storage_module._make_client(_cfg(checksum_mode=None, addressing_style="auto"))
    assert client.meta.config.request_checksum_calculation != "when_required"
    assert client.meta.config.response_checksum_validation != "when_required"


def test_make_client_uses_the_given_endpoint_and_region():
    client = storage_module._make_client(_cfg(endpoint_url="https://example.r2.cloudflarestorage.com"))
    assert client.meta.endpoint_url == "https://example.r2.cloudflarestorage.com"
    assert client.meta.region_name == "auto"


# ── S3Storage: built from cfg, never from Settings ────────────────────────────
def test_s3_storage_never_reads_settings(monkeypatch):
    """Poison the settings singleton's credential fields; S3Storage must still
    build correctly from the cfg it was handed."""
    monkeypatch.setattr(storage_module.settings, "object_store_access_key_id", "poisoned")
    monkeypatch.setattr(storage_module.settings, "object_store_secret_access_key", "poisoned")
    st = S3Storage(_cfg(access_key_id="real-key", secret_access_key="real-secret"))
    creds = st._client._request_signer._credentials
    assert creds.access_key == "real-key"
    assert creds.secret_key == "real-secret"


def test_presigned_upload_and_download_urls_use_the_configured_endpoint():
    st = S3Storage(_cfg(endpoint_url="https://abc123.r2.cloudflarestorage.com"))
    put = st.presigned_upload_url("sermon-raw", "raw/a/b.mp4", "video/mp4", 900)
    get = st.presigned_download_url("sermon-raw", "raw/a/b.mp4", 900)
    for url in (put, get):
        assert url.startswith("https://abc123.r2.cloudflarestorage.com/sermon-raw/raw/a/b.mp4")
        assert "X-Amz-Signature=" in url


# ── delete_object: 404-tolerant ───────────────────────────────────────────────
def test_s3_delete_object_missing_key_is_success():
    st = S3Storage(_cfg())
    with Stubber(st._client) as stub:
        stub.add_client_error(
            "delete_object", service_error_code="NoSuchKey", http_status_code=404,
        )
        st.delete_object("sermon-raw", "raw/does/not/exist.mp4")  # must not raise


def test_s3_delete_object_infra_fault_raises():
    st = S3Storage(_cfg())
    with Stubber(st._client) as stub:
        stub.add_client_error(
            "delete_object", service_error_code="AccessDenied", http_status_code=403,
        )
        try:
            st.delete_object("sermon-raw", "raw/a/b.mp4")
        except StorageError:
            pass
        else:
            raise AssertionError("expected StorageError for a non-404 delete failure")


def test_local_storage_delete_object_missing_key_is_success():
    st = LocalStorage()
    st.delete_object("sermon-raw", "raw/does/not/exist.mp4")  # must not raise


# ── open_read (LocalStorage stub) ─────────────────────────────────────────────
def test_local_storage_open_read_returns_stream_and_head():
    st = LocalStorage()
    st.presigned_upload_url("sermon-raw", "raw/a/b.mp4", "video/mp4", 900)
    stream, head = st.open_read("sermon-raw", "raw/a/b.mp4")
    assert isinstance(head, ObjectHead)
    assert head.size > 0
    data = stream.read()
    assert len(data) == head.size


def test_local_storage_open_read_missing_key_raises():
    st = LocalStorage()
    try:
        st.open_read("sermon-raw", "raw/does/not/exist.mp4")
    except StorageError:
        pass
    else:
        raise AssertionError("expected StorageError for an unread object")


# ── stable_image_url: one URL per window, so phone image caches hit ───────────
def _query(url: str) -> dict[str, str]:
    from urllib.parse import parse_qsl, urlsplit

    return dict(parse_qsl(urlsplit(url).query))


def test_stable_image_url_is_identical_within_a_window_and_changes_after(monkeypatch):
    from datetime import datetime, timedelta, timezone

    st = S3Storage(_cfg())
    monkeypatch.setattr(storage_module, "get_storage", lambda: st)
    t0 = datetime(2026, 10, 22, 0, 0, 5, tzinfo=timezone.utc)

    first = storage_module.stable_image_url("thumbnails/a.jpg", now=t0)
    later = storage_module.stable_image_url("thumbnails/a.jpg", now=t0 + timedelta(hours=23))
    next_window = storage_module.stable_image_url("thumbnails/a.jpg", now=t0 + timedelta(hours=24))

    assert first == later
    assert first != next_window
    q = _query(first)
    assert q["X-Amz-Date"] == "20261022T000000Z"
    # Window + the usual playback lifetime, so a URL handed out at the very end of
    # its window still has stream_url_expire_seconds left.
    assert int(q["X-Amz-Expires"]) == (
        storage_module.IMAGE_URL_WINDOW_SECONDS + storage_module.settings.stream_url_expire_seconds
    )


def test_pinned_signing_time_does_not_leak_into_other_presigns():
    from datetime import datetime, timezone

    st = S3Storage(_cfg())
    pinned = datetime(2020, 1, 1, tzinfo=timezone.utc)
    st.presigned_download_url("b", "k", 900, signed_at=pinned)
    after = st.presigned_download_url("b", "k", 900)

    assert _query(after)["X-Amz-Date"] != "20200101T000000Z"
    assert _query(after)["X-Amz-Date"][:4] == str(datetime.now(timezone.utc).year)
