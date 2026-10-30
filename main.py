from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.sermon_approval import router as sermon_approval_router
from app.api.admin_audit import router as admin_audit_router
from app.api.admin_auth import router as admin_router
from app.api.admin_data import router as admin_data_router
from app.api.admin_settings import public_router as settings_public_router
from app.api.admin_settings import router as admin_settings_router
from app.api.admin_comments import router as admin_comments_router
from app.api.admin_subscriptions import router as admin_subscriptions_router
from app.api.announcements import router as announcements_router
from app.api.announcement_approval import router as announcement_approvals_router
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.catalog import router as catalog_router
from app.api.comments import router as comments_router
from app.api.categories import router as categories_router
from app.api.media import router as media_router
from app.api.playlists import router as playlists_router
from app.api.search import router as search_router
from app.api.series import router as series_router
from app.api.sermons import router as sermons_router
from app.api.speakers import router as speakers_router
from app.api.subscriptions import router as subscriptions_router
from app.api.verses import router as verses_router
from app.core.config import get_settings
from app.core.logging import configure_logging, correlation_id, get_logger
from app.core.middleware import (
    BodySizeLimitMiddleware,
    CorrelationIdMiddleware,
    GlobalRateLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.apple_revocation import get_apple_revocation_client
from app.core.redis import check_redis
from app.core.storage import get_storage
from app.core.token_store import TokenStoreUnavailable
from app.db.database import check_db, primary_engine
from app.services.retention_scheduler import (
    start_retention_scheduler,
    stop_retention_scheduler,
)

settings = get_settings()
log = get_logger("app")

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(log_level=settings.log_level, json_logs=settings.is_production)
    logger = get_logger("startup")

    # Resolve external backends at startup rather than on the first request, so
    # a misconfiguration is a failed deploy instead of a 500 for a real user.
    storage_backend = type(get_storage()).__name__
    apple_revocation_backend = type(get_apple_revocation_client()).__name__

    logger.info(
        "startup",
        app=settings.app_name,
        environment=settings.environment,
        storage=storage_backend,
        apple_revocation=apple_revocation_backend,
        email="smtp" if settings.email_is_live else "console",
    )
    retention_task = start_retention_scheduler() if settings.retention_scheduler_enabled else None
    yield
    logger.info("shutdown")
    if retention_task is not None:
        await stop_retention_scheduler(retention_task)
    await primary_engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
    lifespan=lifespan,
)

# Middleware runs bottom-up: correlation ID is outermost so every log line and
# error response carries it.
app.add_middleware(GlobalRateLimitMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
    expose_headers=["X-Correlation-ID"],
    max_age=600,
)
app.add_middleware(CorrelationIdMiddleware)


# ── Error handling ────────────────────────────────────────────────────────────
def _error_body(detail, request: Request) -> dict:
    return {"detail": detail, "correlation_id": correlation_id.get()}


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.detail, request),
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return field-level validation errors in a stable, JSON-safe shape.

    Pydantic embeds the original exception object under `ctx`, which is not
    serialisable and can leak internals — so only the safe fields are echoed.
    """
    errors = [
        {
            "field": ".".join(str(p) for p in err.get("loc", ()) if p != "body"),
            "message": err.get("msg", "Invalid value"),
            "type": err.get("type", "value_error"),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Validation failed",
            "errors": errors,
            "correlation_id": correlation_id.get(),
        },
    )


@app.exception_handler(TokenStoreUnavailable)
async def token_store_unavailable_handler(
    request: Request, exc: TokenStoreUnavailable
):
    """Redis behind the token store is unreachable.

    The credential paths fail closed (see ``token_store`` module docstring), so
    this surfaces as a deliberate 503 with the correlation ID — never a naked
    500 from the catch-all, and never a false 200 for a revocation that did not
    happen. The message is intentionally non-specific.
    """
    log.warning(
        "token_store_unavailable",
        method=request.method,
        path=request.url.path,
        error=type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=_error_body(
            "Authentication service temporarily unavailable. Please retry.",
            request,
        ),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all so an unexpected error never returns a stack trace.

    The full traceback goes to the logs with the correlation ID; the client
    gets an opaque message plus that ID, which is enough for support to find
    the exact request without leaking internals.
    """
    log.exception(
        "unhandled_exception",
        method=request.method,
        path=request.url.path,
        error=type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Internal server error",
            "correlation_id": correlation_id.get(),
        },
    )


# ── Routers ───────────────────────────────────────────────────────────────────
for _router in (
    auth_router,
    categories_router,
    speakers_router,
    series_router,
    sermons_router,
    catalog_router,
    comments_router,
    media_router,
    playlists_router,
    announcements_router,
    subscriptions_router,
    search_router,
    analytics_router,
    admin_router,
    admin_comments_router,
    admin_subscriptions_router,
    admin_audit_router,
    admin_settings_router,
    admin_data_router,
    settings_public_router,
    announcement_approvals_router,
    sermon_approval_router,
    verses_router,
):
    app.include_router(_router, prefix=API_PREFIX)


# ── Probes ────────────────────────────────────────────────────────────────────
@app.get("/health/live", tags=["system"])
async def liveness() -> dict:
    """Is the process up? Deliberately checks nothing external — a database
    blip must not cause the orchestrator to kill healthy containers."""
    return {"status": "alive"}


@app.get("/health/ready", tags=["system"])
async def readiness() -> JSONResponse:
    """Can this instance serve traffic? Checks critical dependencies."""
    db_ok = await check_db()
    redis_ok = await check_redis()
    ready = db_ok and redis_ok
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ready" if ready else "not_ready",
            "checks": {
                "database": "ok" if db_ok else "unreachable",
                "redis": "ok" if redis_ok else "unreachable",
            },
        },
    )


@app.get("/health", tags=["system"], include_in_schema=False)
async def health() -> JSONResponse:
    """Backwards-compatible alias for /health/ready."""
    return await readiness()
