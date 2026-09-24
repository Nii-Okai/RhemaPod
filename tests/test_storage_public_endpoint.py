"""S3Storage presigned-URL host handling (GATE 3 Batch 2, item 3).

The compose dev stack runs the API and the browser on different views of MinIO
(``minio:9000`` vs ``localhost:9000``). Presigned URLs the browser follows must
be signed for the browser's host — SigV4 signs ``Host`` even for query-string
auth — while this process keeps doing its own I/O against the internal host.

These are pure unit tests on the URL S3Storage produces; no live MinIO.
"""
from urllib.parse import parse_qs, urlsplit

from app.core import storage as storage_module


def _make_storage(monkeypatch, *, endpoint, public):
    s = storage_module.settings
    monkeypatch.setattr(s, "object_store_endpoint_url", endpoint)
    monkeypatch.setattr(s, "s3_public_endpoint", public)
    monkeypatch.setattr(s, "object_store_access_key_id", "minioadmin")
    monkeypatch.setattr(s, "object_store_secret_access_key", "minioadmin")
    return storage_module.S3Storage()


def test_presigned_urls_are_signed_for_the_public_host(monkeypatch):
    st = _make_storage(
        monkeypatch,
        endpoint="http://minio:9000",
        public="http://localhost:9000",
    )

    put = st.presigned_upload_url("sermon-raw", "raw/a/b.mp4", "video/mp4", 900)
    get = st.presigned_download_url("sermon-raw", "raw/a/b.mp4", 900)

    for url in (put, get):
        parts = urlsplit(url)
        # Host the browser will hit — not the internal one.
        assert parts.netloc == "localhost:9000"
        assert "minio:9000" not in url
        # Path-style: bucket in the path, so it plays with the host swap.
        assert parts.path == "/sermon-raw/raw/a/b.mp4"
        # Still a real SigV4 signature.
        q = parse_qs(parts.query)
        assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
        assert q["X-Amz-Signature"][0]


def test_no_public_endpoint_signs_for_the_internal_host(monkeypatch):
    st = _make_storage(
        monkeypatch,
        endpoint="http://minio:9000",
        public=None,
    )
    url = st.presigned_upload_url("sermon-raw", "raw/a/b.mp4", "video/mp4", 900)
    assert urlsplit(url).netloc == "minio:9000"


def test_signature_changes_with_the_signing_host(monkeypatch):
    """Proof that the host is inside the signature: signing the same object for
    two different hosts yields two different signatures. This is why a naive
    string rewrite of the host would break the URL."""
    internal = _make_storage(
        monkeypatch, endpoint="http://minio:9000", public=None
    )
    public = _make_storage(
        monkeypatch, endpoint="http://minio:9000", public="http://localhost:9000"
    )
    sig_internal = parse_qs(urlsplit(
        internal.presigned_upload_url("sermon-raw", "k", "video/mp4", 900)
    ).query)["X-Amz-Signature"][0]
    sig_public = parse_qs(urlsplit(
        public.presigned_upload_url("sermon-raw", "k", "video/mp4", 900)
    ).query)["X-Amz-Signature"][0]
    assert sig_internal != sig_public
