"""Push notifications: device registration and "new sermon" announcements."""

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.push import ExpoPushSender, PushMessage, PushResult
from app.models.models import PushDevice, Sermon
from app.services.push_service import MAX_SERMONS_PER_PASS, announce_new_sermons
from tests.test_likes import API, _unique_email, make_published_sermon, make_viewer

pytestmark = pytest.mark.asyncio

TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"


class RecordingSender:
    def __init__(self, dead: list[str] | None = None):
        self.messages: list[PushMessage] = []
        self.dead = dead or []

    async def send(self, messages):
        self.messages.extend(messages)
        return PushResult(sent=len(messages), dead_tokens=list(self.dead))


def _session(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _devices(engine):
    async with _session(engine)() as s:
        return (await s.execute(select(PushDevice))).scalars().all()


async def _announce(engine, sender):
    async with _session(engine)() as s:
        return await announce_new_sermons(s, sender)


# ── Registration ────────────────────────────────────────────────────────────
async def test_register_requires_sign_in(client):
    r = await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"})
    assert r.status_code == 401


async def test_register_rejects_a_token_that_is_not_an_expo_token(client):
    viewer = await make_viewer(client, _unique_email("v"))
    r = await client.put(
        f"{API}/me/push-devices", json={"token": "not-a-token", "platform": "ios"}, headers=viewer
    )
    assert r.status_code == 422


async def test_register_then_update_preferences_is_one_row(client, engine):
    viewer = await make_viewer(client, _unique_email("v"))
    r = await client.put(
        f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"}, headers=viewer
    )
    assert r.status_code == 200
    assert r.json() == {"token": TOKEN_A, "platform": "ios", "new_sermons": True}

    r = await client.put(
        f"{API}/me/push-devices",
        json={"token": TOKEN_A, "platform": "ios", "new_sermons": False},
        headers=viewer,
    )
    assert r.json()["new_sermons"] is False
    devices = await _devices(engine)
    assert len(devices) == 1 and devices[0].new_sermons is False


async def test_a_token_moves_to_the_account_that_signs_in_on_that_phone(client, engine):
    first = await make_viewer(client, _unique_email("v"))
    second = await make_viewer(client, _unique_email("v"))
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "android"}, headers=first)
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "android"}, headers=second)
    me = (await client.get(f"{API}/auth/me", headers=second)).json()
    devices = await _devices(engine)
    assert len(devices) == 1
    assert str(devices[0].user_id) == me["id"]


async def test_remove_only_touches_the_callers_own_token(client, engine):
    owner = await make_viewer(client, _unique_email("v"))
    other = await make_viewer(client, _unique_email("v"))
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"}, headers=owner)

    r = await client.post(f"{API}/me/push-devices/remove", json={"token": TOKEN_A}, headers=other)
    assert r.status_code == 204
    assert len(await _devices(engine)) == 1

    await client.post(f"{API}/me/push-devices/remove", json={"token": TOKEN_A}, headers=owner)
    assert await _devices(engine) == []


# ── New-sermon announcements ────────────────────────────────────────────────
async def test_a_newly_published_sermon_is_pushed_once_to_opted_in_devices(client, engine):
    viewer = await make_viewer(client, _unique_email("v"))
    muted = await make_viewer(client, _unique_email("v"))
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"}, headers=viewer)
    await client.put(
        f"{API}/me/push-devices",
        json={"token": TOKEN_B, "platform": "android", "new_sermons": False},
        headers=muted,
    )
    sid = await make_published_sermon(client, engine, title="Grace Abounds")

    sender = RecordingSender()
    result = await _announce(engine, sender)
    assert result.sermons == 1
    assert [m.token for m in sender.messages] == [TOKEN_A]
    message = sender.messages[0]
    assert message.title == "New sermon"
    assert message.body.startswith("Grace Abounds")
    assert message.data["url"] == f"/sermon/{sid}"

    again = RecordingSender()
    await _announce(engine, again)
    assert again.messages == []


async def test_a_scheduled_sermon_is_pushed_when_it_appears_not_when_approved(client, engine):
    await make_viewer(client, _unique_email("v"))
    sid = await make_published_sermon(client, engine)
    async with _session(engine)() as s:
        await s.execute(
            update(Sermon)
            .where(Sermon.id == uuid.UUID(sid))
            .values(publish_at=datetime.now(timezone.utc) + timedelta(hours=2))
        )
        await s.commit()
    assert (await _announce(engine, RecordingSender())).sermons == 0

    async with _session(engine)() as s:
        await s.execute(
            update(Sermon)
            .where(Sermon.id == uuid.UUID(sid))
            .values(publish_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await s.commit()
    assert (await _announce(engine, RecordingSender())).sermons == 1


async def test_a_burst_of_uploads_is_spread_over_passes(client, engine):
    for i in range(MAX_SERMONS_PER_PASS + 1):
        await make_published_sermon(client, engine, title=f"S{i}")
    assert (await _announce(engine, RecordingSender())).sermons == MAX_SERMONS_PER_PASS
    assert (await _announce(engine, RecordingSender())).sermons == 1


async def test_tokens_expo_reports_dead_are_removed(client, engine):
    viewer = await make_viewer(client, _unique_email("v"))
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"}, headers=viewer)
    await make_published_sermon(client, engine)
    result = await _announce(engine, RecordingSender(dead=[TOKEN_A]))
    assert result.removed_tokens == 1
    assert await _devices(engine) == []


async def test_deleting_the_account_removes_its_devices(client, engine):
    viewer = await make_viewer(client, _unique_email("v"))
    await client.put(f"{API}/me/push-devices", json={"token": TOKEN_A, "platform": "ios"}, headers=viewer)
    me = (await client.get(f"{API}/auth/me", headers=viewer)).json()
    async with _session(engine)() as s:
        await s.execute(text("PRAGMA foreign_keys=ON"))
        await s.execute(text("DELETE FROM users WHERE id = :id"), {"id": me["id"].replace("-", "")})
        await s.commit()
    assert await _devices(engine) == []


# ── Expo sender ─────────────────────────────────────────────────────────────
async def test_expo_sender_batches_and_reports_dead_tokens():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        calls.append(body)
        tickets = [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}}
            if m["to"] == TOKEN_B
            else {"status": "ok", "id": "x"}
            for m in body
        ]
        return httpx.Response(200, json={"data": tickets})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        sender = ExpoPushSender(client=http)
        messages = [PushMessage(token=TOKEN_A, title="t", body="b")] * 150 + [
            PushMessage(token=TOKEN_B, title="t", body="b")
        ]
        result = await sender.send(messages)
    assert [len(c) for c in calls] == [100, 51]
    assert result.sent == 150
    assert result.dead_tokens == [TOKEN_B]


async def test_expo_sender_survives_a_failed_batch():
    def handler(request):
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await ExpoPushSender(client=http).send([PushMessage(token=TOKEN_A, title="t", body="b")])
    assert result.sent == 0 and result.dead_tokens == []
