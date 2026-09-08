import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.logging import correlation_id, get_logger

from app.core.config import get_settings

log = get_logger("http")
_settings = get_settings()

# Docs routes need a relaxed CSP; everything else gets deny-all.
_DOCS_PATHS = {"/docs", "/redoc", "/docs/oauth2-redirect", "/openapi.json"}

CORRELATION_HEADER = "X-Correlation-ID"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Assigns a correlation ID to every request and logs its lifecycle."""

    async def dispatch(self, request: Request, call_next) -> Response:
        cid = request.headers.get(CORRELATION_HEADER) or str(uuid.uuid4())
        token = correlation_id.set(cid)
        start = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            log.exception(
                "request_failed",
                method=request.method,
                path=request.url.path,
            )
            correlation_id.reset(token)
            raise

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers[CORRELATION_HEADER] = cid

        log.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        correlation_id.reset(token)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline security response headers.

    HSTS is only sent in production — sending it from a local http:// dev
    server would pin the browser to https for localhost and break development.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # The API itself renders nothing, so it gets a deny-all policy. The
        # docs pages are the one exception: Swagger UI and ReDoc pull their
        # bundle and CSS from a CDN and fetch the OpenAPI schema, all of which
        # "default-src 'none'" blocks — producing a blank page.
        if request.url.path in _DOCS_PATHS:
            headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                "img-src 'self' https://fastapi.tiangolo.com data:; "
                "font-src 'self' https://cdn.jsdelivr.net; "
                "connect-src 'self'; "
                "worker-src 'self' blob:; "
                "frame-ancestors 'none'"
            )
        else:
            headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
        if _settings.is_production:
            headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized request bodies before they are parsed.

    Media never flows through this API (uploads go straight to object storage),
    so a large body here is a mistake or an attack.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > _settings.max_request_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body too large"},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400, content={"detail": "Invalid Content-Length"}
                )
        return await call_next(request)


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    """Coarse per-IP request cap, on top of the per-endpoint login limiter.

    Fails open: if Redis is unavailable the request proceeds. A rate limiter
    that takes the whole site down when its backing store blips is worse than
    the abuse it prevents.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        limit = _settings.global_rate_limit
        if limit <= 0 or request.url.path.startswith("/health"):
            return await call_next(request)

        from app.core.net import client_ip
        from app.core.rate_limit import check_rate_limit

        client = client_ip(request)

        allowed = await check_rate_limit(
            f"global:{client}", limit, _settings.global_rate_window_seconds
        )
        if not allowed:
            log.warning("global_rate_limit_exceeded", client=client)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(_settings.global_rate_window_seconds)},
            )
        return await call_next(request)
