import logging
import sys
from contextvars import ContextVar

import structlog

# Holds the correlation ID for the current request/task context
correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def _add_correlation_id(
    logger: object, method_name: str, event_dict: dict
) -> dict:
    cid = correlation_id.get()
    if cid is not None:
        event_dict["correlation_id"] = cid
    return event_dict


# Keys whose values must never reach a log line, at any depth (Apple revocation
# secrets, tokens, passwords). Matched case-insensitively on the key name.
SENSITIVE_LOG_KEYS: frozenset[str] = frozenset(
    {
        "client_secret",
        "authorization_code",
        "identity_token",
        "id_token",
        "refresh_token",
        "access_token",
        "apple_private_key",
        "password",
    }
)
REDACTED = "[REDACTED]"


def _redact(value: object) -> object:
    if isinstance(value, dict):
        return {
            k: REDACTED if isinstance(k, str) and k.lower() in SENSITIVE_LOG_KEYS else _redact(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return type(value)(_redact(v) for v in value)
    return value


def redact_sensitive_keys(
    logger: object, method_name: str, event_dict: dict
) -> dict:
    """structlog processor: replace the value of any sensitive key with
    "[REDACTED]", recursing through dicts, lists and tuples."""
    return _redact(event_dict)  # type: ignore[return-value]


def configure_logging(log_level: str = "INFO", json_logs: bool = True) -> None:
    level = getattr(logging, log_level.upper(), logging.INFO)

    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        _add_correlation_id,
        redact_sensitive_keys,
    ]

    renderer = (
        structlog.processors.JSONRenderer()
        if json_logs
        else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

#logger = structlog.get_logger()

def get_logger(name: str = "app") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
