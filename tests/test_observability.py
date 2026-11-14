"""Sentry stays off without a DSN and tags events with the correlation ID."""

from unittest.mock import patch

from app.core import observability
from app.core.config import get_settings
from app.core.logging import correlation_id


def test_off_without_dsn():
    settings = get_settings().model_copy(update={"sentry_dsn": None})
    with patch.object(observability.sentry_sdk, "init") as init:
        assert observability.init_observability(settings) is False
    init.assert_not_called()


def test_starts_with_dsn_and_never_sends_pii():
    settings = get_settings().model_copy(
        update={"sentry_dsn": "https://key@o0.ingest.sentry.io/0", "sentry_release": "abc123"}
    )
    with patch.object(observability.sentry_sdk, "init") as init:
        assert observability.init_observability(settings) is True
    kwargs = init.call_args.kwargs
    assert kwargs["send_default_pii"] is False
    assert kwargs["release"] == "abc123"
    assert kwargs["environment"] == settings.environment


def test_events_carry_the_correlation_id():
    token = correlation_id.set("cid-123")
    try:
        event = observability._before_send({}, None)
    finally:
        correlation_id.reset(token)
    assert event["tags"]["correlation_id"] == "cid-123"


async def test_unhandled_error_is_reported(client):
    from main import app

    @app.get("/__test_boom")
    async def _boom():
        raise RuntimeError("boom")

    try:
        # Starlette re-raises after the catch-all has answered, and the test
        # transport surfaces that; what matters is that the error was reported.
        with patch("main.capture_exception") as capture:
            try:
                await client.get("/__test_boom")
            except RuntimeError:
                pass
        capture.assert_called_once()
        assert isinstance(capture.call_args.args[0], RuntimeError)
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != "/__test_boom"]


def test_init_minimises_what_is_sent():
    settings = get_settings().model_copy(update={"sentry_dsn": "https://key@o0.ingest.sentry.io/0"})
    with patch.object(observability.sentry_sdk, "init") as init:
        observability.init_observability(settings)
    kwargs = init.call_args.kwargs
    assert kwargs["max_request_body_size"] == "never"
    assert kwargs["include_local_variables"] is False
    assert kwargs["include_source_context"] is False
    assert kwargs["before_breadcrumb"] is observability._before_breadcrumb


def test_events_lose_query_strings_secret_headers_bodies_and_user():
    event = {
        "request": {
            "url": "https://api.rhemapod.com/api/v1/sermons/x/stream?sig=abc&exp=1",
            "query_string": "sig=abc&exp=1",
            "cookies": {"session": "s"},
            "data": {"password": "hunter2"},
            "headers": {"Authorization": "Bearer t", "X-Forwarded-For": "1.2.3.4", "Accept": "json"},
        },
        "user": {"email": "a@b.c", "ip_address": "1.2.3.4"},
    }
    out = observability._before_send(event, None)
    req = out["request"]
    assert req["url"] == "https://api.rhemapod.com/api/v1/sermons/x/stream"
    assert "query_string" not in req and "cookies" not in req and "data" not in req
    assert req["headers"] == {"Accept": "json"}
    assert "user" not in out


def test_breadcrumb_urls_lose_query_strings():
    crumb = {"category": "httplib", "data": {"url": "https://r2.example/obj?X-Amz-Signature=s", "http.query": "X-Amz-Signature=s"}}
    out = observability._before_breadcrumb(crumb, None)
    assert out["data"]["url"] == "https://r2.example/obj"
    assert "http.query" not in out["data"]
