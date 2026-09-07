"""The committed ``openapi.json`` must match what the dump script produces.

The admin portal generates its TypeScript API types from ``openapi.json``
offline. A router or DTO change that has not been re-dumped would silently drift
the portal's types from the backend — this test is the gate that catches it.

    uv run python -m app.scripts.dump_openapi   # regenerate + commit the result
"""
from __future__ import annotations

from pathlib import Path

from app.scripts.dump_openapi import dump

# tests/ -> repo root. Resolved relative to this file so the test passes from
# any working directory.
REPO_ROOT = Path(__file__).resolve().parents[1]
COMMITTED = REPO_ROOT / "openapi.json"


def test_committed_openapi_matches_dump(tmp_path: Path) -> None:
    regenerated = dump(tmp_path / "openapi.json")

    assert COMMITTED.exists(), (
        "openapi.json is missing at the repo root — run "
        "`uv run python -m app.scripts.dump_openapi` and commit it"
    )
    assert regenerated.read_bytes() == COMMITTED.read_bytes(), (
        "openapi.json is stale — run "
        "`uv run python -m app.scripts.dump_openapi` and commit the result"
    )


def test_dump_output_is_deterministic(tmp_path: Path) -> None:
    first = dump(tmp_path / "first.json").read_bytes()
    second = dump(tmp_path / "second.json").read_bytes()

    assert first == second
    assert first.endswith(b"}\n")
