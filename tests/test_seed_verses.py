"""app.scripts.seed_verses — the bible-api.com fetch + dedup logic, mocked (no real
network calls in the suite). `_run`'s DB-writing orchestration isn't covered here —
it talks to `PrimarySession` directly (this codebase's scripts aren't wired through
`app.dependency_overrides`), so it's exercised for real against dev Postgres instead,
not by this suite.
"""
from unittest.mock import AsyncMock, MagicMock

import httpx

from app.scripts.seed_verses import _dedupe, _fetch


def _response(status_code: int, json_body: dict) -> httpx.Response:
    return httpx.Response(status_code=status_code, json=json_body, request=httpx.Request("GET", "https://bible-api.com/x"))


async def test_fetch_returns_canonical_reference_and_stripped_text():
    client = MagicMock()
    client.get = AsyncMock(
        return_value=_response(
            200,
            {"reference": "Psalms 46:10", "text": "  Be still, and know that I am God.\n"},
        )
    )

    result = await _fetch(client, "Psalm 46:10")

    assert result == ("Psalms 46:10", "Be still, and know that I am God.")


async def test_fetch_returns_none_on_not_found():
    client = MagicMock()
    client.get = AsyncMock(return_value=_response(200, {"error": "not found"}))

    assert await _fetch(client, "Not A Real Verse") is None


async def test_fetch_retries_once_on_429_then_succeeds():
    client = MagicMock()
    client.get = AsyncMock(
        side_effect=[
            _response(429, {}),
            _response(200, {"reference": "John 3:16", "text": "For God so loved the world...\n"}),
        ]
    )

    result = await _fetch(client, "John 3:16")

    assert result == ("John 3:16", "For God so loved the world...")
    assert client.get.call_count == 2


async def test_fetch_does_not_retry_a_second_429():
    client = MagicMock()
    client.get = AsyncMock(return_value=_response(429, {}))

    result = await _fetch(client, "John 3:16")

    assert result is None
    assert client.get.call_count == 2  # the one allowed retry, not a third attempt


def test_dedupe_regression_canonical_reference_already_present_is_skipped():
    """The actual bug, reproduced: the old code compared `existing` against the raw
    input string ("Psalm 46:10"), which never matched the *canonical* form
    bible-api.com actually returns ("Psalms 46:10") — so a verse already in the
    database got re-added on every single re-run of the script."""
    fetched = ("Psalms 46:10", "Be still, and know that I am God.")
    existing = {"Psalms 46:10"}  # what's actually stored — the canonical form

    assert _dedupe(fetched, existing) is None


def test_dedupe_allows_a_genuinely_new_canonical_reference():
    fetched = ("Psalms 46:10", "Be still, and know that I am God.")
    existing = {"Psalms 23:1"}

    assert _dedupe(fetched, existing) == fetched


def test_dedupe_passes_through_a_failed_fetch():
    assert _dedupe(None, {"Psalms 46:10"}) is None
