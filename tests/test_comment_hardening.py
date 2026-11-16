"""S11b security hardening (SF-1, SF-2, SF-3, SF-5, SF-7, C-2, C-3).

Pure units on ``app.core.text_safety`` and ``comments_service`` validators, plus
endpoint tests on real Postgres (and real Redis for the rate limit) through
``tests/comments_pg.py``. Nothing here mocks the ORM or the session.
"""

from __future__ import annotations

import time

import pytest

from app.core import text_safety
from app.core.text_safety import (
    BLOCKED_TERMS,
    RESERVED_NAME_TITLES,
    contains_blocked_term,
    contains_contact,
    contains_url,
    normalise_text,
    starts_with_reserved_title,
)
from app.models.models import SermonComment, User
from app.services import comments_service
from app.services.content_service import ContentError
from tests.comments_pg import (  # noqa: F401
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_client_primary_only,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    real_redis,
    redis_server,
    seed_comment,
    sessions,
)

API = "/api/v1"


def body_rejected(text: str) -> str | None:
    """The 422 message validate_comment_body raises, or None when it passes."""
    try:
        comments_service.validate_comment_body(text)
    except ContentError as exc:
        assert exc.status_code == 422
        return exc.message
    return None


def name_rejected(text: str) -> str | None:
    try:
        comments_service.validate_full_name(text)
    except ContentError as exc:
        assert exc.status_code == 422
        return exc.message
    return None


# ═════════════════════════════════════════════════════════════════════════════
# SF-1: off-platform contact
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    "text",
    [
        # S11 probes
        "t.me/x",
        "wa.me/123",
        "0241234567",
        "+233 24 123 4567",
        "gmail dot com",
        "@handle",
        "x.link/abc",
        "x.live/abc",
        "x.shop/abc",
        "x.me/abc",
        # variants of the same vectors
        "T.ME/x",
        "ping me t.me",
        "WA.ME/233241234567",
        "024 123 4567",
        "024-123-4567",
        "024.123.4567",
        "(024) 123-4567",
        "+233241234567",
        "+233 241 234 567",
        "233241234567",
        "1234567",
        "0 2 4 1 2 3 4 5 6 7",
        "call me on 0241234567 please",
        "gmail (dot) com",
        "gmail [dot] com",
        "john dot smith at gmail DOT COM",
        "@ab",
        "message me @pastor_john",
        "＠handle",  # fullwidth @, folded by NFKC
        "add me on whatsapp",
        "WhatsApp me",
        "whats app",
        "whatsssapp",
        "telegram",
        "Telegram: x",
        "snapchat",
        "snap chat",
        "add me on discord",
        "my discord",
        "discord: user",
        "discord#1234",
        "join the discord server",
        "dm me on discord",
    ],
)
def test_sf1_off_platform_contact_is_rejected_in_comments(text):
    assert body_rejected(text) is not None, text


@pytest.mark.parametrize(
    "text",
    [
        "John 3:16",
        "Psalm 119:105",
        "In 2026 we pray",
        "2026",
        "10-02-2026",
        "2026-10-02",
        "10.02.2026",
        "2.10.2026",
        "Psalms 23 27 91 121",
        "Rom 8.28-39 and 12.1-2",
        "John 3.16",
        "Genesis 1:1-2:3",
        "1 Kings 18:20-39, 2 Kings 17:1-18",
        "Psalm 119:105-112 and Isaiah 53:4-5",
        "Matthew 5-7",
        "Luke 15:11-32 / 16:19-31",
        "John 3:16 John 3:17 John 3:18 John 3:19",
        "He that soweth discord among brethren (Prov 6:19)",
        "Discord and strife are works of the flesh",
        "Praise God.Today",
        "Praise God.Live",
        "1 Cor. 13 and Ps. 23",
        "We were 120 in the upper room",
        "Come at 6.30pm or 7.30",
    ],
)
def test_sf1_scripture_dates_and_prose_still_pass(text):
    assert body_rejected(text) is None, text


def test_sf1_digit_rule_boundary_is_seven_digits():
    assert not contains_contact("123456")
    assert contains_contact("1234567")
    assert contains_contact("123-4567")  # 7 digits across a separator, 4567 is no verse
    assert not contains_contact("123 456")
    assert not contains_contact(
        "Psalm 119:105 John 3:16 Gen 1:1 2026"
    )  # colons end a run


def test_sf1_probes_left_allowed_are_documented_residuals():
    # ".me" (and .link / .live / .shop) are ordinary words kept out of the TLD
    # list (Isaac's pruning decision): only the explicit "host.word/path" URL
    # shape is rejected, a bare "foo.me" is not.
    assert not contains_url("find me at foo.me")
    assert not contains_url("see foo.link")
    assert contains_url("foo.me/bar")
    # Spaced two-digit groups that look like scripture lists cannot be told apart.
    assert not contains_contact("12 34 56 78 90")
    # Digits spelled out as words, and "at" spelled out without "dot".
    assert not contains_contact("zero two four one two three four five six seven")
    assert not contains_contact("john at gmail")
    # Discord only counts in a contact shape (Prov 6:19).
    assert not contains_contact("sowing discord")


def test_sf1_contact_message_does_not_echo_input():
    msg = body_rejected("call 0241234567")
    assert msg == "Contact details are not allowed in comments"
    assert "0241234567" not in msg


# ═════════════════════════════════════════════════════════════════════════════
# SF-2: confusables, match form only
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    "text",
    [
        "ѕhit",  # Cyrillic dze for s
        "fuсk",  # Cyrillic es for c
        "ѕhіt",  # Cyrillic dze + i
        "bіtch",
        "οnlyfans",  # Greek omicron
        "nаzi",
        "kуs",  # Cyrillic u for y
        "kill yоurself",  # Cyrillic o
        "уоу are a ѕlut",
    ],
)
def test_sf2_confusable_blocklist_evasions_are_caught(text):
    assert contains_blocked_term(text), text
    assert body_rejected(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        "ехаре.com",  # all-Cyrillic label before .com
        "htтps://x",  # Cyrillic te
        "раy.раl.com",
        "wwш.x.com",
    ],
)
def test_sf2_confusable_url_evasions_are_caught(text):
    assert body_rejected(text) is not None, text


def test_sf2_confusable_contact_evasion_is_caught():
    assert contains_contact("wа.me/1")  # Cyrillic a
    assert contains_contact("tеlеgram")  # Cyrillic e


def test_sf2_stored_text_is_not_folded():
    legit = "Хвала Господу"  # Russian: praise the Lord
    assert body_rejected(legit) is None
    assert (
        comments_service.validate_comment_body(legit) == normalise_text(legit) == legit
    )
    greek = "Χριστός Ανέστη"  # Christos Anesti
    assert comments_service.validate_comment_body(greek) == greek
    assert comments_service.validate_full_name("Иван П") == "Иван П"


async def test_sf2_endpoint_stores_cyrillic_verbatim_and_rejects_the_evasion(
    pg_client, make_user, published_sermon, db_rows
):
    sid = await published_sermon()
    u = await make_user()
    ok = await pg_client.post(
        f"{API}/sermons/{sid}/comments", json={"body": "Хвала Богу"}, headers=u.headers
    )
    assert ok.status_code == 201 and ok.json()["body"] == "Хвала Богу"
    bad = await pg_client.post(
        f"{API}/sermons/{sid}/comments", json={"body": "ѕhit"}, headers=u.headers
    )
    assert bad.status_code == 422
    stored = [r.body for r in await db_rows(SermonComment, user_id=u.id)]
    assert stored == ["Хвала Богу"]


# ═════════════════════════════════════════════════════════════════════════════
# SF-3: blocklist
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    "text",
    [
        "killyourself",
        "kill urself",
        "kill ur self",
        "Kill  Your-Self",
        "KILLYOURSELF",
        "kill yourselves",
        "kill yaself",
        "hang urself",
        "go dieee",
        "go die",
        "GO DIE!",
        "k.y.s",
        "k y s",
        "kyssss",
        "k_i_l_l_y_o_u_r_s_e_l_f",
        "just go d i e",
    ],
)
def test_sf3_self_harm_incitement_collapsed(text):
    assert contains_blocked_term(text), text
    assert body_rejected(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        # the missing S11 terms
        "retarded",
        "shitting",
        "pussies",
        "dicks",
        "slut",
        "sluts",
        "dumbass",
        "bitchy",
        "motherfucking",
        "nazi",
        "nazis",
        # Isaac's additions
        "onlyfans",
        "OnlyFans",
        "nudes",
        "kys",
        "go die",
        # suffix tolerance
        "fucking",
        "fucked",
        "fucker",
        "fuckers",
        "fucks",
        "bitches",
        "bitching",
        "shitty",
        "shitted",
        "shitter",
        "slutty",
        "assholes",
        "bullshitter",
        "bullshitting",
        "FUCKING idiot",
        "That is Shitty!",
        "you pussy",
        "retards",
    ],
)
def test_sf3_new_terms_and_suffix_tolerance(text):
    assert contains_blocked_term(text), text
    assert body_rejected(text) == "This comment can't be posted"


@pytest.mark.parametrize(
    "text",
    [
        # scripture exclusions stay excluded
        "bastard",
        "whore",
        "damn",
        "hell",
        "cock",
        "rape",
        "porn",
        "sex",
        "Deuteronomy 23:2 a bastard shall not enter",
        "the whore of Babylon",
        "Jesus descended into hell, damn the devil",
        "the cock crowed",
        "Tamar was raped by Amnon",
        "flee sexual immorality, porn and sex outside marriage",
        "an ass colt, riding on an ass",
        # Scunthorpe-style words and look-alikes
        "Sussex",
        "Middlesex",
        "scunthorpe",
        "Scunthorpe United",
        "assess",
        "assessment",
        "class",
        "classic",
        "bassist",
        "cocktail",
        "Dick Van Dyke",
        "Dickens",
        "Shitake mushrooms",
        "Nazareth and Nazarene",
        "Niger and Nigeria",
        "flame retardant",
        "ago diesel",
        "Chicago Dietrich",
        "I will go diet next week",
        "kill the fatted calf",
        "your kingdom come",
        "pussycat",
        "Kyle and Kylie",
    ],
)
def test_sf3_scripture_and_scunthorpe_words_still_pass(text):
    assert not contains_blocked_term(text), text
    assert body_rejected(text) is None, text


def test_sf3_every_listed_term_is_loaded():
    for term in (
        "retard",
        "shit",
        "dicks",
        "slut",
        "dumbass",
        "bitch",
        "motherfuck",
        "nazi",
        "onlyfans",
        "nudes",
        "kys",
        "go die",
        "kill yourself",
    ):
        assert term in BLOCKED_TERMS, term
    for excluded in (
        "bastard",
        "whore",
        "damn",
        "hell",
        "cock",
        "rape",
        "porn",
        "sex",
        "ass",
    ):
        assert excluded not in BLOCKED_TERMS, excluded


def test_sf3_leetspeak_and_spaced_profanity_stay_residuals():
    assert not contains_blocked_term("sh1t")
    assert not contains_blocked_term("f u c k")


@pytest.mark.parametrize(
    "text", ["fuck", "killyourself", "go die", "retarded", "http://x.com", "0241234567"]
)
def test_sf3_c3_comment_errors_never_echo_the_matched_term(text):
    msg = body_rejected(f"hello {text}")
    assert msg is not None
    for needle in text.split():
        assert needle.lower() not in msg.lower()


# ═════════════════════════════════════════════════════════════════════════════
# SF-7: linear matching
# ═════════════════════════════════════════════════════════════════════════════
# Repeating units: the input is unit * n. Linear matching means 4x the input
# costs about 4x the time; a quadratic scan would cost 16x.
ADVERSARIAL_UNITS = {
    "a.": "a.",
    "a-.": "a-",
    "a": "a",
    "dots": ".",
    "a.b": "a.b",
    "a./": "a./",
    "1 ": "1 ",
    "0.": "0.",
    "1-": "1-",
    "paren": "(1) ",
    "k ": "k ",
    "kill ": "kill ",
    "killyourself": "killyourself",
    "@a": "@a",
    "@": "@",
    "dot ": "dot ",
    "mixed": "a.b-c d1 ",
    "cyrillic": "\u0430.",
    "spaced dots": "a . ",
    "brackets": "a [.] ",
    "dot word": "a dot ",
    "single letters": "h t t p ",
    "spaces": " ",
    "leet": "k1ll y0u ",
    "handles": "my ig ",
}


def _best_cost(text: str, runs: int = 5) -> float:
    """Best-of-N seconds for all three matchers on ``text``, form cache cold."""
    best = float("inf")
    for _ in range(runs):
        text_safety._forms.cache_clear()
        start = time.perf_counter()
        contains_url(text)
        contains_contact(text)
        contains_blocked_term(text)
        best = min(best, time.perf_counter() - start)
    return best


def _assert_scales_linearly(unit: str, small_n: int = 250) -> None:
    small = _best_cost(unit * small_n)
    large = _best_cost(unit * (small_n * 4))
    # 4x the input: linear is ~4x, quadratic ~16x. The floor keeps a sub-
    # millisecond baseline from turning timer noise into a ratio failure.
    assert large < max(small, 3e-4) * 10, (
        f"{unit!r}: {small * 1000:.2f} ms -> {large * 1000:.2f} ms for 4x input"
    )


@pytest.mark.parametrize("name", list(ADVERSARIAL_UNITS))
def test_sf7_adversarial_inputs_scale_linearly(name):
    _assert_scales_linearly(ADVERSARIAL_UNITS[name])


@pytest.mark.parametrize("name", list(ADVERSARIAL_UNITS))
def test_sf7_adversarial_inputs_pass_the_validators_without_error(name):
    # The 1000-char body and 100-char name validators accept any verdict but
    # must never raise.
    text = (ADVERSARIAL_UNITS[name] * 1000)[:1000]
    body_rejected(text)
    name_rejected(text[:100])


def test_sf7_url_rewrite_keeps_the_existing_url_verdicts():
    for yes in (
        "example.com",
        "foo.co.uk",
        "bit.ly/abc",
        "a@b.com",
        "www.x",
        "https://x",
    ):
        assert contains_url(yes), yes
    for no in (
        "John 3.16",
        "Rom 8.28-39",
        "e.g. this",
        "Amen.Thank you",
        "Mr.Smith said",
        "wait...what",
    ):
        assert not contains_url(no), no


# ═════════════════════════════════════════════════════════════════════════════
# C-2 / C-3: reserved names, generic PATCH /auth/me errors
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    "name",
    [
        "Pastor John",
        "pastor john",
        "PASTOR JOHN",
        "Pastor",
        "Pastor.John",
        "(Pastor) John",
        "Pr. John",
        "Pr John",
        "Ps. Mary",
        "Pst Mary",
        "Rev. Mary",
        "Revd Mary",
        "Reverend Mary",
        "Apostle Paul",
        "Bishop Mary",
        "Elder James",
        "Deacon James",
        "Deaconess Ruth",
        "Prophet Sam",
        "Evangelist Sam",
        "Admin",
        "Admin Joe",
        "Administrator Joe",
        "Moderator Joe",
        "Mod Joe",
        "Staff Joe",
        "Staff",
        "Admin2 Joe",
        "Pаstor John",  # Cyrillic a
        "Рastor John",  # Cyrillic capital Er
        "Adмin Joe",  # Cyrillic em
        "Pástor John",  # accent
        "Ｐastor John",  # fullwidth P
        "P​astor John",  # zero width
        "P a s t o r John",
        "✠ Pastor John",
        "  pastor   john  ",
    ],
)
def test_c2_reserved_first_token_is_rejected(name):
    assert name_rejected(name) == "This name can't be used", name
    assert starts_with_reserved_title(name)


@pytest.mark.parametrize(
    "name",
    [
        "John Pastor",  # surname, only the first token counts
        "Mary Admin",
        "Pastorius Smith",
        "Administrate Smith",
        "Staffordshire Joe",
        "Prudence Okai",
        "Psalm Okai",
        "Eldering Joe",
        "Nii Okai",
        "Kwame",
    ],
)
def test_c2_ordinary_names_pass(name):
    assert name_rejected(name) is None, name


def test_c2_reserved_set_is_the_documented_one():
    assert {"pastor", "admin", "moderator", "staff"} <= RESERVED_NAME_TITLES
    assert {
        "pr",
        "ps",
        "rev",
        "reverend",
        "apostle",
        "bishop",
        "elder",
        "deacon",
    } <= RESERVED_NAME_TITLES
    assert (
        not {"minister", "mr", "mrs", "dr", "brother", "sister"} & RESERVED_NAME_TITLES
    )


@pytest.mark.parametrize(
    "name",
    [
        "fuck face",  # blocklist
        "Visit example.com",  # URL
        "https://x.co",  # scheme
        "Call 0241234567",  # contact
        "@handle",  # contact
        "Pastor Nii",  # reserved
        "Nazi Joe",  # blocklist
    ],
)
async def test_c3_every_name_rule_returns_one_generic_message(
    pg_client, make_user, name
):
    u = await make_user(full_name="Keep Name")
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": name}, headers=u.headers
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "This name can't be used"
    for fragment in name.split():
        assert fragment.lower() not in r.text.lower().replace(
            "this name can't be used", ""
        )


async def test_c3_rejected_name_changes_nothing_and_a_clean_one_is_saved(
    pg_client, make_user, db_rows
):
    u = await make_user(full_name="Keep Name")
    for bad in ("Pastor Nii", "visit x.com"):
        assert (
            await pg_client.patch(
                f"{API}/auth/me", json={"full_name": bad}, headers=u.headers
            )
        ).status_code == 422
    (row,) = await db_rows(User, id=u.id)
    assert row.full_name == "Keep Name"
    ok = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": "Nii Okai"}, headers=u.headers
    )
    assert ok.status_code == 200 and ok.json()["full_name"] == "Nii Okai"


async def test_c3_length_errors_are_not_content_rules_and_stay_specific(
    pg_client, make_user
):
    u = await make_user()
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": "x" * 101}, headers=u.headers
    )
    assert r.status_code == 422 and "between 1 and 100" in r.json()["detail"]


async def test_c3_name_errors_are_not_logged_with_the_name(
    pg_client, capture_logs, make_user
):
    u = await make_user()
    sentinel = "Pastor SentinelnameQqq"
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": sentinel}, headers=u.headers
    )
    assert r.status_code == 422
    assert "SentinelnameQqq" not in capture_logs.text()
    assert "SentinelnameQqq" not in r.text


# ═════════════════════════════════════════════════════════════════════════════
# SF-5: PATCH /auth/me rate limit (real Redis)
# ═════════════════════════════════════════════════════════════════════════════
async def test_sf5_sixth_name_change_in_an_hour_is_429_with_retry_after(
    pg_client, real_redis, make_user, db_rows
):
    u = await make_user(full_name="Start Name")
    for i in range(5):
        r = await pg_client.patch(
            f"{API}/auth/me",
            json={"full_name": f"Name {'abcde'[i]}"},
            headers=u.headers,
        )
        assert r.status_code == 200, i
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": "Name Six"}, headers=u.headers
    )
    assert r.status_code == 429
    assert 0 < int(r.headers["Retry-After"]) <= 3600
    assert r.json()["detail"] and "correlation_id" in r.json()
    (row,) = await db_rows(User, id=u.id)
    assert row.full_name == "Name e"  # the limited call changed nothing


async def test_sf5_key_is_per_user_and_independent_of_other_actions(
    pg_client, real_redis, make_user
):
    a, b = await make_user(), await make_user()
    key = comments_service.rate_limit_key("profile", "1h", a.id)
    await real_redis.set(f"ratelimit:{key}", 5, ex=3600)
    assert (
        await pg_client.patch(
            f"{API}/auth/me", json={"full_name": "A B"}, headers=a.headers
        )
    ).status_code == 429
    assert (
        await pg_client.patch(
            f"{API}/auth/me", json={"full_name": "B C"}, headers=b.headers
        )
    ).status_code == 200
    spoof = {**a.headers, "X-Forwarded-For": "203.0.113.50"}
    assert (
        await pg_client.patch(
            f"{API}/auth/me", json={"full_name": "A B"}, headers=spoof
        )
    ).status_code == 429


async def test_sf5_rejected_names_consume_budget(pg_client, real_redis, make_user):
    """Charged before validation, so the limit also bounds probing the rules."""
    u = await make_user()
    for _ in range(5):
        assert (
            await pg_client.patch(
                f"{API}/auth/me", json={"full_name": "Pastor X"}, headers=u.headers
            )
        ).status_code == 422
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": "Fine Name"}, headers=u.headers
    )
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


async def test_sf5_limit_constants():
    assert comments_service.PROFILE_LIMITS == (("1h", 5, 3600),)


# ═════════════════════════════════════════════════════════════════════════════
# S11c: filter residuals (R-1, R-2, R-3, leetspeak, int guard, one match form)
# ═════════════════════════════════════════════════════════════════════════════
def _contact_or_url(text: str) -> bool:
    return contains_url(text) or contains_contact(text)


@pytest.mark.parametrize(
    "text",
    [
        "t . me/abc",
        "t .me/x",
        "t. me/x",
        "wa . me/x",
        "wa dot me",
        "t dot me/x",
        "T . ME/x",
        "gmail . com",
        "gmail .com",
        "www . x . com",
        "h t t p : / / x . c o m",
        "bit ly/abc",
        "bit . ly/abc",
        "example [.] com",
        "example (.) com",
        "example(dot)com",
        "example [dot] com",
        "x . c o m",
        "join t\u3002me/x",
        "wa \uff0e me/x",
    ],
)
def test_r1_spaced_bracketed_and_dot_word_hosts_are_rejected(text):
    assert _contact_or_url(text), text
    assert body_rejected(f"hello {text} thanks") is not None
    assert name_rejected(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        "Amen. Praise God. Today we pray.",
        "We love God. Church was great.",
        "Praise God. Pro tips help. Win the day. Top of the morning.",
        "Thank you. Co-workers and family. Media team. Online church. App store.",
        "Don't. Me neither.",
        "I can't. Me too.",
        "That is it. Me and my family. Wa is a town in Ghana.",
        "Wait . . . what?",
        "Pray. Dev. Site. Chat. Club. Cam. Store.",
        "John 3. 16 and Psalm 23. 24",
        "a polka dot dress and a dot on the map",
        "Isaiah 40. Read it. Then Isaiah 41.",
        "I will be a bit lyrical today",
    ],
)
def test_r1_ordinary_prose_with_periods_still_passes(text):
    assert not _contact_or_url(text), text
    assert body_rejected(text) is None, text


def test_r1_host_forms_do_not_leak_into_other_rules():
    # The spaced-dot form feeds only the TLD check and the contact-host list.
    # The general path-shape rule and the digit rule still see the plain form.
    assert not contains_url("x . link/abc")
    assert not contains_url("see foo . me")
    assert not contains_contact("1 . 2 . 3")


@pytest.mark.parametrize(
    "text",
    [
        "ig: john",
        "IG : john",
        "my ig is john",
        "add me on ig",
        "snap: john",
        "snap me",
        "add me on snap",
        "my snap id is john",
        "tg: john",
        "my tg is john",
        "signal me",
        "Signal: john",
        "dm me on signal",
        "kik me",
        "my kik is john",
        "kik: john",
        "tiktok: john",
        "follow me on tiktok",
        "on tiktok",
        "insta: john",
        "my insta is john",
        "DM me on insta",
        "follow me on instagram",
        "instagram: john",
        "fb: john",
        "add me on fb",
        "facebook: john",
        "my facebook is john",
    ],
)
def test_r2_messaging_handles_in_contact_shape_are_rejected(text):
    assert contains_contact(text), text
    assert body_rejected(text) == "Contact details are not allowed in comments"


@pytest.mark.parametrize(
    "text",
    [
        "a signal from God",
        "the snap of a finger",
        "God gave us a signal at the red sea",
        "Snap out of it, brother",
        "They gave the signal and the walls fell",
        "It was a snap decision",
        "the big ig of the matter",
        "a kikuyu sermon in Nairobi",
        "tgif at church",
        "John 3:16 gives a clear signal",
        "Install the app and read today's devotion",
        "Instant answers to prayer",
        "an instance of God's grace",
    ],
)
def test_r2_ordinary_words_pass(text):
    assert not contains_contact(text), text
    assert body_rejected(text) is None, text


@pytest.mark.parametrize(
    "text",
    [
        "only fans",
        "only-fans",
        "Only  Fans",
        "only.fans",
        "n u d e s",
        "n-u-d-e-s",
        "onlyfans",
        "nudes",
    ],
)
def test_r3_spaced_onlyfans_and_nudes_are_rejected(text):
    assert contains_blocked_term(text), text
    assert body_rejected(f"check out {text} now") == "This comment can't be posted"


@pytest.mark.parametrize(
    "text",
    [
        "denudes the field",
        "the only fan of the choir",
        "nude",
        "only a few fans",
        "nu",
    ],
)
def test_r3_neighbouring_words_pass(text):
    assert not contains_blocked_term(text), text


@pytest.mark.parametrize(
    "text",
    [
        "kill y0urself",
        "k1ll yourself",
        "k1ll y0urs3lf",
        "kill ur$elf",
        "k i l l y0 u r s e l f",
        "hang y0urself",
        "go d1e",
        "g0 d1e",
        "k y $",
        "ky$",
        "k1ll y0urself",
    ],
)
def test_leet_self_harm_is_caught(text):
    assert contains_blocked_term(text), text
    assert body_rejected(text) == "This comment can't be posted"


@pytest.mark.parametrize(
    "text",
    [
        "John 3:16",
        "Psalm 91:1",
        "Psalm 119:105",
        "Matthew 5:3-4",
        "1 Kings 18:20-39",
        "Acts 2:1-4",
        "Luke 4:13 and 1 John 1:9",
        "Heb 11:4 Rev 21:4 Gen 1:1 Rom 8:28",
        "2 Cor 5:17 and 1 Pet 3:15",
        "Psalms 23 27 91 121",
        "kill the fatted calf, said Luke 15:23",
        "Go 4 it, 3 of us, 1 team",
    ],
)
def test_leet_fold_does_not_misfire_on_scripture_or_digits(text):
    assert not contains_blocked_term(text), text


def test_leet_fold_is_not_applied_to_profanity():
    # Pinned residual from S11b: only the self-harm phrase list gets the fold.
    assert not contains_blocked_term("sh1t")
    assert not contains_blocked_term("f*ck")
    assert not contains_blocked_term("b1tch")


def test_digit_run_length_guard_never_raises():
    huge = "1 " + "9" * 5000  # past Python's 4300-digit int() limit
    assert contains_contact(huge) is True
    assert contains_contact("0 " + "9" * 5000) is True
    assert contains_contact("+" + "9" * 5000) is True
    assert contains_contact("Psalm " + "1" * 5000 + " 2") is True
    assert body_rejected(("1 " + "9" * 990)[:1000]) is not None


def test_match_form_is_computed_once_per_validation():
    text = "Grace and peace to you all, brother"
    text_safety._forms.cache_clear()
    comments_service.validate_comment_body(text)
    info = text_safety._forms.cache_info()
    assert (info.misses, info.hits) == (1, 2)  # url, contact, blocklist

    text_safety._forms.cache_clear()
    comments_service.validate_full_name("Grace Mensah")
    info = text_safety._forms.cache_info()
    assert info.misses == 1
    assert info.hits == 3  # url, contact, blocklist, reserved title


def test_fdfa_amplification_costs_one_pass_and_scales_linearly():
    # U+FDFA NFKC-expands to 18 characters. One normalisation pass per
    # validation, and cost linear in the input.
    text = "\ufdfa" * 1000
    text_safety._forms.cache_clear()
    body_rejected(text)
    assert text_safety._forms.cache_info().misses == 1
    _assert_scales_linearly("\ufdfa", small_n=250)
    # Same order of magnitude as plain text of the same normalised length, not a
    # multiple of the old four passes: bounded ratio to 18000 plain characters.
    expanded = _best_cost("\ufdfa" * 1000)
    plain = _best_cost("a" * 18000)
    assert expanded < max(plain, 3e-4) * 25, (expanded, plain)
