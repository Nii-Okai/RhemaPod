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


# The one route allowed a larger body (`Settings.max_import_bytes`).
DATA_IMPORT_PATH = "/api/v1/admin/data/import"


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized request bodies before they are parsed.

    Media never flows through this API (uploads go straight to object storage),
    so a large body here is a mistake or an attack.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            limit = (
                _settings.max_import_bytes
                if request.url.path == DATA_IMPORT_PATH
                else _settings.max_request_bytes
            )
            try:
                if int(declared) > limit:
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
    """Token-bucket request cap, keyed by identity, on top of the
    per-endpoint login limiter.

    Key selection (status.md "MOBILE — W2.1 kickoff decision"): if the
    request carries a bearer token that decodes as a valid, signature-verified
    access token, it draws from that user's bucket (`user:{sub}`) — one
    budget shared across a person's devices, not one per session. Otherwise
    it draws from the calling IP's bucket (`ip:{client}`).

    HARD RULE, load-bearing, do not relax: token validation here is always
    `security.decode_token(token, security.ACCESS)` — the exact same
    signature-verified, DB-free function `get_current_user` calls — called
    with the exact same arguments. Never decode with `verify_signature:
    False`, never hand-split/parse the JWT, never add a second validation
    path. If either of those happened, an attacker could set `sub` to a
    fresh value on every request and the limiter would silently become
    unlimited — that is a real vulnerability, not a style preference. The
    one deliberate gap versus `get_current_user` is that this never checks
    Postgres for the user existing/being active: that check is irrelevant to
    choosing a partition key (worst case, a deactivated user with an
    unexpired token gets their own bucket for the rest of that token's life
    instead of sharing the IP bucket — the request still 401s downstream,
    no worse than sharing the IP bucket). The decoded payload is never
    stashed on `request.state` for `get_current_user` to reuse either — that
    would make this a second source of truth for auth, which is exactly the
    divergent path the rule above exists to prevent.

    Fails open: if Redis is unavailable the request proceeds. A rate limiter
    that takes the whole site down when its backing store blips is worse than
    the abuse it prevents.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path.startswith("/health"):
            return await call_next(request)

        key, capacity, refill_per_minute = self._bucket_for(request)
        if capacity <= 0 or refill_per_minute <= 0:
            return await call_next(request)

        from app.core.rate_limit import check_token_bucket

        allowed = await check_token_bucket(key, capacity, refill_per_minute)
        if not allowed:
            log.warning("rate_limit_exceeded", key=key)
            retry_after = max(1, -(-60 // refill_per_minute))  # ceil(60 / rate)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)

    @staticmethod
    def _bucket_for(request: Request) -> tuple[str, int, int]:
        """Pick the (key, burst_capacity, refill_per_minute) bucket for this
        request. See the class docstring's HARD RULE before touching this."""
        from fastapi.security.utils import get_authorization_scheme_param

        from app.core.net import client_ip
        from app.core.security import ACCESS, decode_token

        scheme, token = get_authorization_scheme_param(
            request.headers.get("authorization")
        )
        if scheme.lower() == "bearer" and token:
            payload = decode_token(token, ACCESS)
            if payload is not None:
                sub = payload.get("sub")
                if sub:
                    return (
                        f"user:{sub}",
                        _settings.user_rate_limit_burst,
                        _settings.user_rate_limit_per_minute,
                    )

        client = client_ip(request)
        return (
            f"ip:{client}",
            _settings.ip_rate_limit_burst,
            _settings.ip_rate_limit_per_minute,
        )
