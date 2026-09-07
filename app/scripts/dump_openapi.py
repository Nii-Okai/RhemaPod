"""Dump the FastAPI OpenAPI schema to a file, offline.

The admin portal generates its TypeScript API types from this schema and must be
able to do that in CI with nothing running — no server, no database, no Redis —
so the schema is built in-process here and the result is committed to the repo
root as ``openapi.json``.

    uv run python -m app.scripts.dump_openapi              # -> ./openapi.json
    uv run python -m app.scripts.dump_openapi --out PATH   # -> PATH

``app.openapi()`` builds the complete schema by introspecting the routers and
Pydantic models. It does this regardless of whether ``/openapi.json`` is
route-mounted at runtime — that endpoint is DEBUG-gated in ``main.py``, the
builder is not — so this works without ``DEBUG=true`` and touches no network
path.

Output is ``json.dumps(..., indent=2, sort_keys=True)`` plus a trailing
newline, so re-running on an unchanged backend produces no diff.
``tests/test_openapi_dump.py`` regenerates into a temp file and asserts a
byte-for-byte match with the committed ``openapi.json``, so a router or DTO
change that has not been re-dumped fails CI.

Config note: importing ``main`` constructs the ``Settings`` singleton, which
fails fast without a real ``SECRET_KEY`` / ``DATABASE_URL``. Schema generation
needs neither a database nor those secrets, so this module seeds inert
placeholders via ``os.environ.setdefault`` before the import — the same
technique ``tests/conftest.py`` uses, and only when a variable is unset, so a
real ``.env`` or an injected Docker-stack environment still wins. No database or
Redis connection is opened: the SQLAlchemy engine and the Redis pool are built
lazily at import and only dial out on first use, which schema generation never
triggers.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

# app/scripts/dump_openapi.py -> repo root is two parents up.
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "openapi.json"

# Inert values so the settings singleton can be constructed for a schema-only
# build. ``setdefault`` means a real environment (.env, Docker stack, CI
# secrets) always wins; none of these affect the generated schema.
_SCHEMA_ONLY_ENV = {
    "SECRET_KEY": "openapi-dump-inert-signing-key-0123456789abcdef",
    "DATABASE_URL": "postgresql+psycopg://openapi:openapi@localhost/openapi",
}
for _key, _value in _SCHEMA_ONLY_ENV.items():
    os.environ.setdefault(_key, _value)


def render_openapi() -> str:
    """Return the deterministic JSON serialisation of the app's OpenAPI schema."""
    from main import app

    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def dump(out: Path) -> Path:
    """Write the OpenAPI schema to ``out``, creating parent dirs as needed."""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_openapi(), encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump the FastAPI OpenAPI schema to a JSON file, offline."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Destination file (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args()
    written = dump(args.out)
    print(f"[+] Wrote OpenAPI schema to {written}")


if __name__ == "__main__":
    main()
