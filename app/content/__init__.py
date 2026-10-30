"""Static, versioned text the API serves (plan-ad5-amendment-1, §G.1).

`comment_guidelines.txt` is the single editable source of the community
comment guidelines. It is loaded once at import: a missing or empty file
fails startup rather than serving blank guidelines. Plain `.txt` on purpose
(`.dockerignore` excludes `*.md`, and the mobile sheet renders the text
verbatim). Any text change edits this file and
`mobile/lib/content/commentsCompliance.ts` in the same commit; a backend
test pins the two byte-for-byte.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

_PATH = Path(__file__).with_name("comment_guidelines.txt")


def _load() -> str:
    text = _PATH.read_text(encoding="utf-8")
    # POSIX files end with one newline; the served text has none.
    text = text.removesuffix("\n")
    if not text.strip():
        raise RuntimeError(f"{_PATH.name} is empty; refusing to start.")
    return text


COMMENT_GUIDELINES: str = _load()
# First 12 hex chars of SHA-256 over the UTF-8 bytes; part of the public ETag
# and the Redis cache key so a text change never serves a stale body.
COMMENT_GUIDELINES_DIGEST: str = hashlib.sha256(
    COMMENT_GUIDELINES.encode("utf-8")
).hexdigest()[:12]
