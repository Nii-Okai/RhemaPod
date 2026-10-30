# syntax=docker/dockerfile:1

# ─────────────────────────────  Builder  ──────────────────────────────
# Resolves prod-only dependencies into a self-contained virtualenv. Only
# /app/.venv crosses into the runtime stage (via COPY --from=builder).
#
# Builder bases stay on tags, not digests: `uv sync --frozen` installs from the
# locked hashes in uv.lock, so a poisoned builder base cannot alter what lands
# in the venv. Only the runtime base — the one that actually ships — is
# digest-pinned.
FROM python:3.13-slim-bookworm AS builder

# uv drives the install. Per ADR 0001 §4 we copy only the uv binary in — uv
# itself has no place in the runtime image. (The ADR sketch used `/uv`; in this
# image the binary actually lives at /usr/local/bin/uv.)
COPY --from=ghcr.io/astral-sh/uv:python3.13-bookworm-slim /usr/local/bin/uv /bin/uv

# UV_COMPILE_BYTECODE   — precompile .pyc for faster cold starts
# UV_LINK_MODE=copy     — self-contained venv when moved between stages
# UV_PYTHON_DOWNLOADS=0 — never fetch a managed Python; use the image's 3.13
#                         (.python-version = 3.13, pyproject requires >=3.13)
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependency layer only — re-runs solely when uv.lock / pyproject.toml change.
#
#   --no-dev              drops the `dev` group (aiosqlite / pytest / httpx) so
#                         test-only deps never reach production.
#   --no-install-project  this project is virtual (uv.lock: source =
#                         { virtual = "." }) — there is nothing to build, so the
#                         source tree is not needed here and no build toolchain
#                         (gcc / libpq-dev) is required.
#
# psycopg[binary] bundles its own libpq + OpenSSL, so no system libpq is needed
# in either stage. ADR 0001 §4 flags the psycopg[binary] vs psycopg[c]
# security-lag tradeoff (bundled libpq/OpenSSL lags upstream fixes); it is a
# deliberate, unchanged choice here.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# ─────────────────────────────  Runtime  ──────────────────────────────
# Digest-pinned: this is the base that actually ships. The tag is kept here for
# humans — python:3.13-slim-bookworm, which resolved to 3.13.15-slim-bookworm
# (Debian bookworm-slim) at pin time. Re-resolve with:
#     docker buildx imagetools inspect python:3.13-slim-bookworm
FROM python:3.13-slim-bookworm@sha256:ed86c82274b3c69b52fb5820f358f0bd7df0b603332063cb5c6e32bd220c3e6e AS runtime

# Non-root. Fixed UID/GID so bind-mounted files get a predictable owner.
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid 1000 --home-dir /app --no-create-home app

ENV PATH="/app/.venv/bin:$PATH" \
    VIRTUAL_ENV="/app/.venv" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    UVICORN_WORKERS=1

WORKDIR /app

# Prod-only virtualenv from the builder, then the application source
# (alembic/ + alembic.ini included — the separate migrate step needs them;
# tests/, docs/, caches, .env* excluded via .dockerignore). `COPY . .` also
# carries pyproject.toml / uv.lock into the image: inert at runtime, and not
# worth a .dockerignore rule since the builder stage copies them from the same
# build context.
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app . .

USER app

EXPOSE 8000

# Liveness only: /health/live checks nothing external, so a DB/Redis blip does
# not make the orchestrator kill a healthy container. stdlib urllib keeps curl
# out of the image. Port is fixed at 8000 (matches EXPOSE and CMD). start-period
# 15s matches the compose healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=4).status==200 else 1)"]

# uvicorn ONLY. No `alembic upgrade head` in the entrypoint, CMD, or any startup
# hook — migrations are a separate one-off invocation (ADR 0001 §4;
# DEPLOYMENT.md §3 "run once, not per instance"). One process per container;
# scale with replicas. Worker count via UVICORN_WORKERS (default 1).
# Port is fixed at 8000 (matches EXPOSE and the HEALTHCHECK). sh -c so
# $UVICORN_WORKERS expands; exec so uvicorn stays PID 1 and receives SIGTERM
# directly.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1} --no-access-log"]
