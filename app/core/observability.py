"""Error and performance reporting to Sentry.

Off unless ``SENTRY_DSN`` is set, so local dev and the test suite send nothing.
Request bodies, cookies and auth headers are never sent (``send_default_pii`` is
off), and every event carries the request's correlation ID, so a crash in Sentry
can be matched to the same request in the logs and to the ID the client was shown.
"""

from __future__ import annotations

import sentry_sdk

from app.core.config import Settings
from app.core.logging import correlation_id


def _tag_correlation_id(event, _hint):
    cid = correlation_id.get()
    if cid:
        event.setdefault("tags", {})["correlation_id"] = cid
    return event


def init_observability(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it started."""
    if not settings.sentry_dsn:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.sentry_release,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=_tag_correlation_id,
    )
    return True


def capture_exception(exc: BaseException) -> None:
    """Report a handled exception (a no-op when Sentry is off)."""
    sentry_sdk.capture_exception(exc)
