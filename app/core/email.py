"""Pluggable email sender.

Every message goes out as multipart text + HTML through one seam, `_send`:
SMTP when configured (production uses Resend's SMTP relay — see
DEPLOYMENT.md §7), otherwise a console backend that logs the message (and any
action link) so the invite, reset and verification flows are fully
exercisable without a mail server. Callers never know which is active.
"""
from __future__ import annotations

from html import escape

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("email")

# Brand palette, mirrored from admin_portal/app/globals.css. Inline styles
# only: most mail clients drop <style> blocks and every web font.
_CLAY = "#a65b3a"
_ON_CLAY = "#fff8f3"
_INK = "#1f1a17"
_INK_FAINT = "#6f655e"
_PAPER = "#f6f1ec"
_CARD = "#ffffff"


async def _send_console(to: str, subject: str, text: str) -> None:
    """Development backend: log the message instead of delivering it. Only the
    plain-text part — it carries the same link/code as the HTML part."""
    log.info("email_send_console", to=to, subject=subject, body=text)


def _send_smtp_blocking(to: str, subject: str, text: str, html: str) -> None:
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = settings.smtp_from_email
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

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


async def _send(to: str, subject: str, text: str, html: str) -> None:
    """Deliver an email.

    Uses SMTP when configured, otherwise logs (development only — the
    production preflight refuses to boot without SMTP settings).

    smtplib is blocking, so it runs in a worker thread to avoid stalling the
    event loop. Exceptions propagate: callers such as staff invite creation
    depend on a failed send rolling the whole transaction back.
    """
    if not settings.email_is_live:
        await _send_console(to, subject, text)
        return

    import asyncio

    await asyncio.to_thread(_send_smtp_blocking, to, subject, text, html)
    log.info("email_sent", to=to, subject=subject)


def _render_html(
    *,
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None = None,
    code: str | None = None,
    footnote: str | None = None,
) -> str:
    """One branded, table-based layout for every transactional email.

    Every argument is plain text and escaped here; `button` is (label, url).
    """
    app = escape(settings.app_name)
    body = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{_INK};">'
        f"{escape(p)}</p>"
        for p in paragraphs
    )
    if code:
        body += (
            f'<p style="margin:8px 0 24px;text-align:center;">'
            f'<span style="display:inline-block;padding:14px 24px;border-radius:12px;'
            f"background:{_PAPER};font-family:'SF Mono',Menlo,Consolas,monospace;"
            f'font-size:30px;letter-spacing:8px;font-weight:600;color:{_INK};">'
            f"{escape(code)}</span></p>"
        )
    if button:
        label, url = button
        href = escape(url, quote=True)
        body += (
            f'<p style="margin:8px 0 24px;">'
            f'<a href="{href}" style="display:inline-block;padding:13px 26px;'
            f"border-radius:11px;background:{_CLAY};color:{_ON_CLAY};"
            f'font-size:15px;font-weight:600;text-decoration:none;">'
            f"{escape(label)}</a></p>"
            f'<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:{_INK_FAINT};">'
            f"Or paste this link into your browser:<br>"
            f'<a href="{href}" style="color:{_CLAY};word-break:break-all;">{escape(url)}</a></p>'
        )
    if footnote:
        body += (
            f'<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:{_INK_FAINT};">'
            f"{escape(footnote)}</p>"
        )
    return (
        "<!doctype html>"
        '<html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(heading)}</title></head>"
        f'<body style="margin:0;padding:0;background:{_PAPER};'
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">"
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{_PAPER};"><tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:520px;">'
        f'<tr><td style="padding:0 4px 20px;font-family:Georgia,\'Times New Roman\',serif;'
        f'font-size:22px;font-weight:600;color:{_CLAY};">{app}</td></tr>'
        f'<tr><td style="background:{_CARD};border-radius:16px;padding:32px 28px;">'
        f'<h1 style="margin:0 0 20px;font-family:Georgia,\'Times New Roman\',serif;'
        f'font-size:24px;font-weight:600;line-height:1.3;color:{_INK};">{escape(heading)}</h1>'
        f"{body}</td></tr>"
        f'<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:{_INK_FAINT};">'
        f"You received this email because of an action on your {app} account."
        "</td></tr></table></td></tr></table></body></html>"
    )


def _reset_link(token: str, *, for_app: bool = False) -> str:
    """The admin portal's set-password page serves staff invites, staff resets
    and app users' resets. `app=1` switches it to app-user copy (no "staff
    account" wording, no redirect to the portal's own sign-in)."""
    base = settings.frontend_base_url.rstrip("/")
    link = f"{base}/set-password?token={token}"
    return f"{link}&app=1" if for_app else link


async def send_staff_invite(to: str, full_name: str | None, token: str) -> None:
    link = _reset_link(token)
    name = full_name or to
    app = settings.app_name
    hours = settings.invite_token_expire_hours
    text = (
        f"Hello {name},\n\n"
        f"An account has been created for you on {app}. "
        f"Set your password to activate it:\n\n{link}\n\n"
        f"This link expires in {hours} hours."
    )
    html = _render_html(
        heading=f"You're invited to {app}",
        paragraphs=[
            f"Hello {name},",
            (
                f"A staff account has been created for you on the {app} admin portal. "
                "Set your password to activate it."
            ),
        ],
        button=("Set your password", link),
        footnote=f"This link expires in {hours} hours and can only be used once. "
        "If you weren't expecting this invite, you can ignore this email.",
    )
    await _send(to, f"Your {app} account", text, html)


async def send_password_reset(to: str, token: str, *, for_app: bool = False) -> None:
    link = _reset_link(token, for_app=for_app)
    app = settings.app_name
    minutes = settings.password_reset_expire_minutes
    text = (
        f"We received a request to reset your {app} password.\n\n"
        f"Reset it here:\n\n{link}\n\n"
        f"This link expires in {minutes} minutes. "
        f"If you didn't request this, you can ignore this email."
    )
    html = _render_html(
        heading="Reset your password",
        paragraphs=[
            f"We received a request to reset the password for your {app} account.",
        ],
        button=("Reset password", link),
        footnote=f"This link expires in {minutes} minutes and can only be used once. "
        "If you didn't request this, you can ignore this email; your password "
        "won't change.",
    )
    await _send(to, f"Reset your {app} password", text, html)


async def send_email_verification(to: str, code: str) -> None:
    """The 6-digit code a self-registered (email/password) account enters in
    the app to confirm its address. A code rather than a link: it needs no
    universal-link setup and keeps the user inside the app."""
    app = settings.app_name
    minutes = settings.email_verification_expire_minutes
    text = (
        f"Welcome to {app}!\n\n"
        f"Your verification code is: {code}\n\n"
        f"Enter it in the app to confirm your email address. "
        f"It expires in {minutes} minutes.\n\n"
        f"If you didn't create an account, you can ignore this email."
    )
    html = _render_html(
        heading="Confirm your email",
        paragraphs=[
            f"Welcome to {app}! Enter this code in the app to confirm your email address.",
        ],
        code=code,
        footnote=f"The code expires in {minutes} minutes. "
        "If you didn't create an account, you can ignore this email.",
    )
    await _send(to, f"{code} is your {app} verification code", text, html)


async def send_sign_in_method_linked(to: str, provider: str, *, password_removed: bool) -> None:
    """ADR 0015's auto-link notice: an existing account just had a
    Google/Apple sign-in linked to it. When the account had a password, the
    link also cleared it (closes a pre-registration takeover: an attacker
    could otherwise register the victim's email with a password first and
    keep access after the victim links their real account), so the holder
    needs to know their old password no longer works. An account that never
    had one (e.g. created via the other provider) gets the plain notice —
    telling it a password was removed would be false and alarming.
    `provider` is the display name ("Google"/"Apple"), not the enum value."""
    app = settings.app_name
    if password_removed:
        paragraphs = [
            (
                f"{provider} sign-in was just connected to your {app} account, and your "
                "previous password was removed as part of that."
            ),
            (
                "If you'd like to set a new password (to sign in without "
                f"{provider} too), use Forgot Password on the sign-in screen."
            ),
        ]
    else:
        paragraphs = [
            (
                f"{provider} sign-in was just connected to your {app} account. You can "
                f"now sign in with {provider} as well as the way you signed in before."
            ),
        ]
    footnote = "If you didn't do this, contact support right away."
    text = "\n\n".join([*paragraphs, footnote])
    html = _render_html(
        heading=f"{provider} sign-in connected",
        paragraphs=paragraphs,
        footnote=footnote,
    )
    await _send(to, f"{provider} sign-in connected to your {app} account", text, html)


async def send_account_deleted(to: str) -> None:
    """Notice that the account was just deleted at the holder's own request
    (ADR 0020). Sent after the delete has committed, to the address snapshotted
    before it; best-effort, so a failure here never undoes or fails the delete.
    Contact address is deliberately generic: the church's support inbox is not
    a backend setting."""
    app = settings.app_name
    paragraphs = [
        f"Your {app} account and the data tied to it (playlists, likes, comments, "
        "sign-in methods) were deleted at your request.",
        "Backups are purged within 30 days. If you signed in with Apple, you can also "
        f"remove {app} under Settings > Apple Account > Sign in with Apple.",
    ]
    footnote = "If you didn't do this, contact support right away."
    text = "\n\n".join([*paragraphs, footnote])
    html = _render_html(
        heading="Your account was deleted", paragraphs=paragraphs, footnote=footnote
    )
    await _send(to, f"Your {app} account was deleted", text, html)
