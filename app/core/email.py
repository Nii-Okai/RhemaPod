"""Pluggable email sender.

Phase 3 ships a console backend that logs the message (and any action link) so
staff-invite and reset flows are fully exercisable without a mail server.
Phase 6 replaces `_send` with a real SMTP/SendGrid backend — callers here do
not change.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("email")


async def _send_console(to: str, subject: str, body: str) -> None:
    """Development backend: log the message instead of delivering it."""
    log.info("email_send_console", to=to, subject=subject, body=body)


def _send_smtp_blocking(to: str, subject: str, body: str) -> None:
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = settings.smtp_from_email
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    if settings.smtp_port == 465:
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
    try:
        if settings.smtp_port != 465 and settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)
    finally:
        server.quit()


async def _send(to: str, subject: str, body: str) -> None:
    """Deliver an email.

    Uses SMTP when configured, otherwise logs (development only — the
    production preflight refuses to boot without SMTP settings).

    smtplib is blocking, so it runs in a worker thread to avoid stalling the
    event loop. Exceptions propagate: callers such as staff invite creation
    depend on a failed send rolling the whole transaction back.
    """
    if not settings.email_is_live:
        await _send_console(to, subject, body)
        return

    import asyncio

    await asyncio.to_thread(_send_smtp_blocking, to, subject, body)
    log.info("email_sent", to=to, subject=subject)


def _reset_link(token: str) -> str:
    base = settings.frontend_base_url.rstrip("/")
    return f"{base}/set-password?token={token}"


async def send_staff_invite(to: str, full_name: str | None, token: str) -> None:
    link = _reset_link(token)
    name = full_name or to
    body = (
        f"Hello {name},\n\n"
        f"An account has been created for you on {settings.app_name}. "
        f"Set your password to activate it:\n\n{link}\n\n"
        f"This link expires in {settings.invite_token_expire_hours} hours."
    )
    await _send(to, f"Your {settings.app_name} account", body)


async def send_password_reset(to: str, token: str) -> None:
    link = _reset_link(token)
    body = (
        f"We received a request to reset your {settings.app_name} password.\n\n"
        f"Reset it here:\n\n{link}\n\n"
        f"If you didn't request this, you can ignore this email."
    )
    await _send(to, f"Reset your {settings.app_name} password", body)
