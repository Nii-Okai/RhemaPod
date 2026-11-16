"""Check the Apple revocation credentials against Apple, revoking nothing.

Preflight only proves the key parses. This proves Apple accepts the client
secret minted from APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY and
APPLE_CLIENT_ID, by exchanging a deliberately invalid authorization code
(DEPLOYMENT.md §14). Run after every key change:

    uv run python -m app.scripts.check_apple_key
"""
from __future__ import annotations

import asyncio
import sys

from app.core.apple_revocation import AppleRevocationError, HttpAppleRevocationClient


async def _run() -> int:
    from app.core.config import get_settings

    s = get_settings()
    missing = [
        name
        for name, value in (
            ("APPLE_KEY_ID", s.apple_key_id),
            ("APPLE_PRIVATE_KEY", s.apple_private_key),
            ("APPLE_CLIENT_ID", s.apple_client_id),
        )
        if not value
    ]
    if missing:
        print(f"[FAIL] not set: {', '.join(missing)}")
        return 1

    client = HttpAppleRevocationClient(
        team_id=s.apple_team_id,
        key_id=s.apple_key_id,
        private_key=s.apple_private_key.get_secret_value(),
        client_id=s.apple_client_id,
    )
    target = f"team {s.apple_team_id}, key {s.apple_key_id}, client {s.apple_client_id}"
    try:
        await client.check_credentials()
    except AppleRevocationError as exc:
        if exc.reason == "misconfigured":
            print(f"[FAIL] Apple rejected the client secret ({target}). Check the team ID, "
                  "key ID, that the key has Sign in with Apple enabled, and the client ID.")
        else:
            print("[FAIL] Apple could not be reached. Try again shortly.")
        return 1
    print(f"[ ok ] Apple accepted the client secret ({target}).")
    return 0


def main() -> None:
    sys.exit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
