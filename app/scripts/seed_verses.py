"""Populate the `verses` table (Home's "verse of the day") from a real source.

References are hand-picked (well-known, short, single-clause verses); the quoted
*text* itself is fetched live from bible-api.com (KJV — public domain, no API key
needed) rather than typed by hand, so accuracy is bible-api.com's problem, not this
codebase's. Runs once after the `add_verses` migration, and is safe to re-run —
existing rows are matched by `reference` and left untouched, so this only ever adds
references that aren't already present.

    uv run python -m app.scripts.seed_verses

The app itself never calls bible-api.com at request time — `GET /verses/today` only
ever reads from this table. This script is the one place the network call happens.
"""
from __future__ import annotations

import asyncio

import httpx
from sqlalchemy import select

from app.db.database import PrimarySession
from app.models.models import Verse

REFERENCES = [
    "Philippians 4:13",
    "Proverbs 3:5",
    "Proverbs 3:6",
    "Psalm 23:1",
    "Joshua 1:9",
    "Psalm 118:24",
    "Psalm 46:10",
    "Philippians 4:4",
    "1 Corinthians 16:14",
    "Luke 1:37",
    "John 3:16",
    "Romans 8:28",
    "Romans 10:9",
    "Jeremiah 29:11",
    "Isaiah 40:31",
    "Isaiah 41:10",
    "Psalm 27:1",
    "Psalm 34:8",
    "Psalm 37:4",
    "Psalm 119:105",
    "Proverbs 18:10",
    "Proverbs 16:3",
    "Matthew 6:33",
    "Matthew 11:28",
    "Mark 11:24",
    "Luke 6:31",
    "John 14:27",
    "John 15:13",
    "John 8:32",
    "Romans 12:2",
    "Romans 5:8",
    "2 Corinthians 5:17",
    "Ephesians 2:8",
    "Ephesians 6:10",
    "Philippians 4:6",
    "Philippians 4:7",
    "Philippians 1:6",
    "Colossians 3:23",
    "2 Timothy 1:7",
    "Hebrews 11:1",
    "Hebrews 13:8",
    "James 1:5",
    "James 1:17",
    "1 Peter 5:7",
    "1 John 1:9",
    "1 John 4:19",
    "Revelation 3:20",
    "Psalm 1:1",
    "Psalm 91:1",
    "Psalm 121:2",
    "Deuteronomy 31:6",
]

API_URL = "https://bible-api.com/{reference}"
TRANSLATION = "kjv"


REQUEST_DELAY_SECONDS = 1.2
RATE_LIMIT_RETRY_DELAY_SECONDS = 8.0


async def _fetch(client: httpx.AsyncClient, reference: str, retrying: bool = False) -> tuple[str, str] | None:
    """Returns (canonical_reference, text) or None on failure — logged, not raised, so
    one bad lookup doesn't abort the whole run. A 429 gets exactly one retry after a
    longer backoff (bible-api.com's free tier rate-limits fairly aggressively at this
    request volume) — a second 429 is treated as a real failure, not retried again."""
    try:
        resp = await client.get(
            API_URL.format(reference=reference.replace(" ", "+")),
            params={"translation": TRANSLATION},
            timeout=10.0,
        )
        if resp.status_code == 429 and not retrying:
            print(f"[.] {reference}: rate-limited, retrying in {RATE_LIMIT_RETRY_DELAY_SECONDS:.0f}s")
            await asyncio.sleep(RATE_LIMIT_RETRY_DELAY_SECONDS)
            return await _fetch(client, reference, retrying=True)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            print(f"[!] {reference}: {body['error']}")
            return None
        return body["reference"], body["text"].strip()
    except (httpx.HTTPError, KeyError) as exc:
        print(f"[!] {reference}: {exc}")
        return None


def _dedupe(fetched: tuple[str, str] | None, existing: set[str]) -> tuple[str, str] | None:
    """`None` if the fetch failed, or if the fetched result's *canonical* reference is
    already present — the exact check that used to (wrongly) compare `existing`
    against the raw input reference string instead. bible-api.com normalizes "Psalm
    46:10" to "Psalms 46:10", so that old comparison never matched and let duplicates
    through on every re-run (caught in dev: 10 references had 2-3 copies each)."""
    if fetched is None:
        return None
    canonical_reference, _text = fetched
    if canonical_reference in existing:
        return None
    return fetched


async def _run() -> None:
    async with PrimarySession() as db, httpx.AsyncClient() as client:
        existing = {r for r in (await db.execute(select(Verse.reference))).scalars().all()}
        added = 0
        skipped = 0
        for reference in REFERENCES:
            fetched = await _fetch(client, reference)
            resolved = _dedupe(fetched, existing)
            if resolved is None:
                if fetched is not None:
                    skipped += 1
                continue
            canonical_reference, text = resolved
            db.add(Verse(reference=canonical_reference, text=text, translation=TRANSLATION))
            existing.add(canonical_reference)
            added += 1
            print(f"[+] {canonical_reference}")
            await asyncio.sleep(REQUEST_DELAY_SECONDS)
        await db.commit()
        print(f"Done — added {added} new verse(s), skipped {skipped} already present.")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
