"""Machine translation for caption text (English -> French today).

Two backends, same seam shape as app/core/stream.py:
  * WorkersAITranslator — Cloudflare Workers AI's REST endpoint
    (`POST /accounts/{id}/ai/run/<model>`, default `@cf/meta/m2m100-1.2b`),
    on the same Cloudflare account Stream already uses, so no new vendor.
  * LocalTranslator     — deterministic stub for tests and local dev.

Only app/services/captions_service.py calls this. Swapping in a different
translation provider means adding a class here and nothing else.
"""
from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("translate")

# Parallel requests per translate() call. Workers AI rate-limits per account;
# a 45-minute sermon is a few hundred caption groups, so 4 at a time keeps a
# translation to a minute or two without tripping limits.
_CONCURRENCY = 4


class TranslationError(Exception):
    pass


class Translator(Protocol):
    name: str

    async def translate(
        self, texts: list[str], *, source: str, target: str
    ) -> list[str]: ...


class LocalTranslator:
    name = "translate_stub"

    async def translate(
        self, texts: list[str], *, source: str, target: str
    ) -> list[str]:
        return [f"[{target}] {text}" for text in texts]


class WorkersAITranslator:
    name = "workers_ai"

    def __init__(self) -> None:
        self._url = (
            f"https://api.cloudflare.com/client/v4/accounts/{settings.cf_account_id}"
            f"/ai/run/{settings.captions_translation_model}"
        )
        self._headers = {"Authorization": f"Bearer {settings.workers_ai_token}"}

    async def _one(
        self, client: httpx.AsyncClient, sem: asyncio.Semaphore,
        text: str, source: str, target: str,
    ) -> str:
        if not text.strip():
            return text
        async with sem:
            for attempt in range(3):
                try:
                    resp = await client.post(
                        self._url,
                        headers=self._headers,
                        json={"text": text, "source_lang": source, "target_lang": target},
                    )
                except httpx.HTTPError as exc:
                    if attempt == 2:
                        raise TranslationError(f"Workers AI request failed: {exc}") from exc
                else:
                    if resp.status_code == 429 or resp.status_code >= 500:
                        if attempt == 2:
                            raise TranslationError(
                                f"Workers AI returned {resp.status_code}"
                            )
                    else:
                        try:
                            data = resp.json()
                        except ValueError as exc:
                            raise TranslationError("Workers AI: non-JSON response") from exc
                        if resp.status_code >= 400 or not data.get("success", True):
                            raise TranslationError(
                                f"Workers AI failed ({resp.status_code}): "
                                f"{data.get('errors') or resp.text[:200]}"
                            )
                        translated = (data.get("result") or {}).get("translated_text")
                        if not isinstance(translated, str) or not translated.strip():
                            raise TranslationError("Workers AI returned no translated_text")
                        return translated.strip()
                await asyncio.sleep(2 ** attempt)
        raise TranslationError("unreachable")  # pragma: no cover

    async def translate(
        self, texts: list[str], *, source: str, target: str
    ) -> list[str]:
        sem = asyncio.Semaphore(_CONCURRENCY)
        async with httpx.AsyncClient(timeout=60) as client:
            return list(await asyncio.gather(
                *(self._one(client, sem, t, source, target) for t in texts)
            ))


_translator: Translator | None = None


def get_translator() -> Translator:
    global _translator
    if _translator is None:
        if settings.cf_account_id and settings.workers_ai_token:
            _translator = WorkersAITranslator()
        elif settings.is_production:
            raise TranslationError(
                "Refusing to use the stub translator in production. Set "
                "CF_ACCOUNT_ID and CF_WORKERS_AI_API_TOKEN (or CF_STREAM_API_TOKEN)."
            )
        else:
            _translator = LocalTranslator()
        log.info("translator", provider=_translator.name)
    return _translator


def set_translator(translator: Translator | None) -> None:
    """Override the translator (used by tests)."""
    global _translator
    _translator = translator
