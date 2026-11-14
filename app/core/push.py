"""Sending push notifications through Expo's push service.

The app registers an Expo push token per install; Expo forwards to APNs (iOS)
and FCM (Android), so the API never holds Apple or Google push credentials.

`get_push_sender()` returns the real sender only when
`PUSH_NOTIFICATIONS_ENABLED` is true; otherwise a sender that logs and drops,
so dev and tests can never notify real phones. Tests swap in their own with
`set_push_sender`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts at most 100 messages per request.
BATCH_SIZE = 100


@dataclass(frozen=True)
class PushMessage:
    token: str
    title: str
    body: str
    data: dict = field(default_factory=dict)


@dataclass
class PushResult:
    sent: int = 0
    # Tokens Expo says are no longer registered (app uninstalled, permission
    # revoked): the caller deletes them.
    dead_tokens: list[str] = field(default_factory=list)


class PushSender(Protocol):
    async def send(self, messages: list[PushMessage]) -> PushResult: ...


class LogPushSender:
    """Logs instead of sending (push turned off)."""

    async def send(self, messages: list[PushMessage]) -> PushResult:
        if messages:
            log.info("push_skipped_disabled", count=len(messages))
        return PushResult()


class ExpoPushSender:
    def __init__(self, access_token: str | None = None, client: httpx.AsyncClient | None = None):
        self._access_token = access_token
        self._client = client

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        return headers

    async def send(self, messages: list[PushMessage]) -> PushResult:
        result = PushResult()
        if not messages:
            return result
        client = self._client or httpx.AsyncClient(timeout=15.0)
        try:
            for start in range(0, len(messages), BATCH_SIZE):
                batch = messages[start : start + BATCH_SIZE]
                payload = [
                    {
                        "to": m.token,
                        "title": m.title,
                        "body": m.body,
                        "data": m.data,
                        "sound": "default",
                        "channelId": "default",
                    }
                    for m in batch
                ]
                try:
                    res = await client.post(EXPO_PUSH_URL, json=payload, headers=self._headers())
                    res.raise_for_status()
                    tickets = res.json().get("data", [])
                except (httpx.HTTPError, ValueError) as exc:
                    # One failed batch must not stop the rest: log it and move on.
                    log.error("push_batch_failed", error_type=type(exc).__name__, size=len(batch))
                    continue
                for message, ticket in zip(batch, tickets, strict=False):
                    if ticket.get("status") == "ok":
                        result.sent += 1
                    elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                        result.dead_tokens.append(message.token)
                    else:
                        log.warning("push_ticket_error", error=(ticket.get("details") or {}).get("error"))
        finally:
            if self._client is None:
                await client.aclose()
        return result


_sender: PushSender | None = None


def get_push_sender() -> PushSender:
    global _sender
    if _sender is None:
        settings = get_settings()
        _sender = (
            ExpoPushSender(settings.expo_push_access_token)
            if settings.push_notifications_enabled
            else LogPushSender()
        )
    return _sender


def set_push_sender(sender: PushSender | None) -> None:
    global _sender
    _sender = sender
