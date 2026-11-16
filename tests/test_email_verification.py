"""Sign-up email verification: a self-registered viewer can't sign in until it
enters the 6-digit code emailed at registration. Google/Apple sign-ins and the
reset/invite link count as proof of the address."""
from unittest.mock import AsyncMock

import pytest

from app.core import email as email_module
from app.core.config import get_settings

PW = "correct-horse-battery"
EMAIL = "new@example.com"


@pytest.fixture(autouse=True)
def _verification_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "require_email_verification", True)


@pytest.fixture
def sent_codes(monkeypatch):
    sender = AsyncMock()
    monkeypatch.setattr(email_module, "send_email_verification", sender)
    return sender


async def _register(client, email=EMAIL):
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201
    return r


async def _login(client, email=EMAIL):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": PW})


async def _verify(client, code, email=EMAIL):
    return await client.post(
        "/api/v1/auth/verify-email", json={"email": email, "code": code}
    )


async def test_register_emails_a_code_and_login_is_refused(client, sent_codes):
    await _register(client)
    assert sent_codes.await_count == 1
    to_addr, code = sent_codes.await_args.args
    assert to_addr == EMAIL
    assert len(code) == 6 and code.isdigit()

    r = await _login(client)
    assert r.status_code == 403
    assert r.json()["detail"] == "Email address not verified"


async def test_wrong_password_on_unverified_account_is_still_401(client, sent_codes):
    await _register(client)
    r = await client.post(
        "/api/v1/auth/login", json={"email": EMAIL, "password": "not-the-password-1"}
    )
    assert r.status_code == 401


async def test_correct_code_signs_in_and_unlocks_login(client, sent_codes):
    await _register(client)
    code = sent_codes.await_args.args[1]

    r = await _verify(client, code)
    assert r.status_code == 200
    assert r.json()["access_token"]

    assert (await _login(client)).status_code == 200
    # Single use: the same code can't verify twice.
    assert (await _verify(client, code)).status_code == 400


async def test_wrong_code_is_generic_400(client, sent_codes):
    await _register(client)
    code = sent_codes.await_args.args[1]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    r = await _verify(client, wrong)
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid or expired code"
    # Unknown email answers identically.
    r = await _verify(client, code, email="nobody@example.com")
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid or expired code"


async def test_code_burns_after_max_attempts(client, sent_codes):
    await _register(client)
    code = sent_codes.await_args.args[1]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    for _ in range(get_settings().email_verification_max_attempts):
        assert (await _verify(client, wrong)).status_code == 400
    # Even the right code is dead now.
    assert (await _verify(client, code)).status_code == 400


async def test_resend_issues_a_fresh_code_and_retires_the_old(client, sent_codes):
    await _register(client)
    first = sent_codes.await_args.args[1]

    r = await client.post("/api/v1/auth/resend-verification", json={"email": EMAIL})
    assert r.status_code == 200
    assert sent_codes.await_count == 2
    second = sent_codes.await_args.args[1]

    if first != second:
        assert (await _verify(client, first)).status_code == 400
    assert (await _verify(client, second)).status_code == 200


async def test_resend_is_generic_and_silent_for_unknown_or_verified(client, sent_codes):
    unknown = await client.post(
        "/api/v1/auth/resend-verification", json={"email": "nobody@example.com"}
    )
    await _register(client)
    await _verify(client, sent_codes.await_args.args[1])
    sent_codes.reset_mock()
    verified = await client.post(
        "/api/v1/auth/resend-verification", json={"email": EMAIL}
    )
    assert unknown.status_code == verified.status_code == 200
    assert unknown.json() == verified.json()
    assert sent_codes.await_count == 0


async def test_resend_is_rate_limited_per_email(client, sent_codes):
    await _register(client)
    statuses = [
        (
            await client.post("/api/v1/auth/resend-verification", json={"email": EMAIL})
        ).status_code
        for _ in range(4)
    ]
    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429


async def test_password_reset_link_verifies_the_address(client, sent_codes, monkeypatch):
    reset_sender = AsyncMock()
    monkeypatch.setattr(email_module, "send_password_reset", reset_sender)
    await _register(client)

    await client.post("/api/v1/auth/forgot-password", json={"email": EMAIL})
    _to_addr, token = reset_sender.await_args.args
    # Viewers get the app-flavoured landing page.
    assert reset_sender.await_args.kwargs == {"for_app": True}

    new_pw = "brand-new-passphrase-9"
    r = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": new_pw}
    )
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": EMAIL, "password": new_pw})
    assert r.status_code == 200


async def test_verification_off_lets_unverified_viewers_sign_in(client, sent_codes, monkeypatch):
    monkeypatch.setattr(get_settings(), "require_email_verification", False)
    await _register(client)
    assert sent_codes.await_count == 0
    assert (await _login(client)).status_code == 200


def test_email_templates_render_links_and_codes():
    html = email_module._render_html(
        heading="Reset your password",
        paragraphs=["Hello <script>"],
        button=("Reset password", "https://x.example/set-password?token=a&app=1"),
        code="123456",
    )
    assert "&lt;script&gt;" in html and "<script>" not in html
    assert 'href="https://x.example/set-password?token=a&amp;app=1"' in html
    assert "123456" in html
    assert email_module._reset_link("t", for_app=True).endswith("/set-password?token=t&app=1")
    assert email_module._reset_link("t").endswith("/set-password?token=t")
