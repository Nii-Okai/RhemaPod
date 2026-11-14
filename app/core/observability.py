"""Error and performance reporting to Sentry.

Off unless ``SENTRY_DSN`` is set, so local dev and the test suite send nothing.

Data minimisation (what Sentry never receives):
- request bodies (``max_request_body_size="never"``), cookies, auth headers and
  client IPs (``send_default_pii=False``);
- local variable values in stack frames (``include_local_variables=False``), so a
  password, token or email held in a variable can't ride along with a traceback;
- query strings on any URL, in the event and in breadcrumbs, so signed media URLs
  and one-time tokens never leave the server;
- anything in the SDK's default denylist (password, secret, token, ...), scrubbed
  by its ``EventScrubber`` as a second net.

Every event carries the request's correlation ID instead, so a crash in Sentry
can be matched to the same request in the logs and to the ID the client was shown.
"""

from __future__ import annotations

import sentry_sdk
from sentry_sdk.scrubber import EventScrubber

from app.core.config import Settings
from app.core.logging import correlation_id


def _strip_query(url):
    if not isinstance(url, str):
        return url
    return url.split("?", 1)[0].split("#", 1)[0]


def _before_send(event, _hint):
    cid = correlation_id.get()
    if cid:
        event.setdefault("tags", {})["correlation_id"] = cid
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("query_string", None)
        request.pop("cookies", None)
        request.pop("data", None)
        if "url" in request:
            request["url"] = _strip_query(request["url"])
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                k: v for k, v in headers.items() if k.lower() not in _DROP_HEADERS
            }
    event.pop("user", None)
    return event


def _before_breadcrumb(crumb, _hint):
    data = crumb.get("data")
    if isinstance(data, dict) and "url" in data:
        data["url"] = _strip_query(data["url"])
        data.pop("http.query", None)
    return crumb


_DROP_HEADERS = {"authorization", "cookie", "set-cookie", "x-forwarded-for", "x-real-ip"}


def init_observability(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it started."""
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.sentry_release,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=_before_send,
        before_send_transaction=_before_send,
        before_breadcrumb=_before_breadcrumb,
        event_scrubber=EventScrubber(),
    )
    return True


def capture_exception(exc: BaseException) -> None:
    """Report a handled exception (a no-op when Sentry is off)."""
    sentry_sdk.capture_exception(exc)
