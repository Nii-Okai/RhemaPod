#!/usr/bin/env bash
# Run after merging to main (or pulling): the api container is a static built
# image with no source volume mount, so new code needs a rebuild, and Alembic
# migrations don't run themselves against the persistent dev Postgres. Skipping
# either one silently serves stale code / a stale schema — see status.md,
# 2026-09-21 (thumbnail bug that was actually a missing publish_at migration).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose up -d --build api
docker compose exec api alembic upgrade head
