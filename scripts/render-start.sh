#!/bin/sh
# Render free-plan start command (render.yaml dockerCommand). Free plans have no
# pre-deploy step, so migrations and the preflight run here, on every start.
# Only safe because a free service is exactly one instance.
set -e
alembic upgrade head
python -m app.scripts.preflight
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
