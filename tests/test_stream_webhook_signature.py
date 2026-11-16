"""CloudflareStreamProvider.verify_webhook — pure HMAC logic, no network, so
most of these run synchronously (unlike test_stream_ingest.py, which needs the
`client`/`engine` async fixtures for the rest of the ingest pipeline).

Signature scheme per Cloudflare's docs: header `Webhook-Signature:
time=<unix-ts>,sig1=<hex>`, where `<hex>` is HMAC-SHA256 over
`f"{time}.{body}"` keyed with the secret returned when the webhook URL was
registered (see DEPLOYMENT.md §12).

The class above proves `verify_webhook` itself rejects bad signatures. The
async test at the bottom proves the *route* does too — every other webhook
test in test_stream_ingest.py runs against LocalStream, whose stub
`verify_webhook` doesn't check a signature at all, so without this the real
POST /media/stream/webhook path had zero regression coverage for "bad
signature -> 400, no DB side effect".
"""
import hashlib
import hmac
import time
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.core.stream as stream_module
from app.core.config import get_settings
from app.core.stream import CloudflareStreamProvider, StreamError
from app.models.models import MediaRef, MediaType, UploadJob
from tests.test_media import make_user, upload_and_process


def _sign(secret: str, ts: int, body: bytes) -> str:
    signed = f"{ts}.".encode() + body
    return hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()


def test_accepts_valid_signature(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_account_id", "acct_x")
    monkeypatch.setattr(get_settings(), "cf_stream_api_token", "cfut_x")
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    provider = CloudflareStreamProvider()

    body = b'{"uid": "abc", "status": {"state": "ready"}}'
    ts = int(time.time())
    sig = f"time={ts},sig1={_sign('whsec_x', ts, body)}"

    event = provider.verify_webhook(body, sig)
    assert event["uid"] == "abc"


def test_rejects_bad_signature(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    body = b'{"uid": "abc"}'
    ts = int(time.time())
    sig = f"time={ts},sig1={_sign('wrong-secret', ts, body)}"

    with pytest.raises(StreamError, match="Invalid webhook signature"):
        provider.verify_webhook(body, sig)


def test_rejects_stale_timestamp(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    body = b'{"uid": "abc"}'
    ts = int(time.time()) - 3600  # 1 hour old, outside the 5-minute tolerance
    sig = f"time={ts},sig1={_sign('whsec_x', ts, body)}"

    with pytest.raises(StreamError, match="tolerance"):
        provider.verify_webhook(body, sig)


def test_requires_secret_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", None)
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="CF_STREAM_WEBHOOK_SECRET"):
        provider.verify_webhook(b"{}", "time=1,sig1=deadbeef")


def test_requires_signature_present(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="Missing webhook signature"):
        provider.verify_webhook(b"{}", None)


def test_rejects_malformed_header(monkeypatch):
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="Malformed webhook signature header"):
        provider.verify_webhook(b"{}", "not-the-right-shape")


# ── route-level: POST /media/stream/webhook against the REAL provider ────────
async def test_route_rejects_bad_signature_with_real_provider(client, engine, monkeypatch):
    """Every webhook test in test_stream_ingest.py runs against LocalStream,
    whose verify_webhook never checks a signature. Wire in the real
    CloudflareStreamProvider (same seam-swap conftest.py uses at suite
    start — stream_module.set_provider) and prove the route itself rejects a
    bad signature: 400, and the job/ref the signature would have unlocked
    stays untouched."""
    monkeypatch.setattr(get_settings(), "cf_account_id", "acct_x")
    monkeypatch.setattr(get_settings(), "cf_stream_api_token", "cfut_x")
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")

    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        ref = (await s.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.VIDEO
            )
        )).scalars().first()
        job = (await s.execute(
            select(UploadJob).where(UploadJob.sermon_id == uuid.UUID(sid))
        )).scalars().first()
    uid = ref.stream_uid
    assert uid is not None  # LocalStream kickoff already gave it one
    assert job.finished_at is None

    # Swap the real provider in only now, for the webhook call itself — the
    # ingest kickoff above still ran against LocalStream via the `client`
    # fixture's default, same as every other test in this suite.
    stream_module.set_provider(CloudflareStreamProvider())
    try:
        body = {"uid": uid, "status": {"state": "ready"}, "readyToStream": True}
        r = await client.post(
            "/api/v1/media/stream/webhook",
            json=body,
            headers={"webhook-signature": "time=1,sig1=deadbeef"},
        )
        assert r.status_code == 400

        r2 = await client.post("/api/v1/media/stream/webhook", json=body)  # no header
        assert r2.status_code == 400
    finally:
        stream_module.set_provider(stream_module.LocalStream())

    async with Session() as s:
        job = (await s.execute(
            select(UploadJob).where(UploadJob.sermon_id == uuid.UUID(sid))
        )).scalars().first()
        ref = (await s.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.VIDEO
            )
        )).scalars().first()
    assert job.finished_at is None  # neither rejected call touched the DB
    assert ref.stream_uid == uid


@pytest.mark.parametrize("environment, refused", [("development", False), ("staging", True)])
def test_stub_provider_refuses_unsigned_webhooks_on_internet_reachable_hosts(
    monkeypatch, environment, refused
):
    """The stub verifies no signature, so it must not accept events anywhere an
    outsider can reach the endpoint."""
    monkeypatch.setattr(get_settings(), "environment", environment)
    stub = stream_module.LocalStream()
    if refused:
        with pytest.raises(StreamError):
            stub.verify_webhook(b'{"uid": "x"}', None)
    else:
        assert stub.verify_webhook(b'{"uid": "x"}', None) == {"uid": "x"}
