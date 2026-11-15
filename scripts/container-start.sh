#!/bin/sh
# API start command on Azure Container Apps (infra/azure/modules/app.bicep).
# Preflight on every replica start, so a bad secret keeps the new revision from
# going live while the old one keeps serving. No migrations here: the deploy
# workflow runs them once, in the migrate job, before the apps update.
set -e
python -m app.scripts.preflight
exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers "${UVICORN_WORKERS:-1}" --no-access-log
