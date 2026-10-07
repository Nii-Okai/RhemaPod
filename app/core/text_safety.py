"""Pure text rules shared by sermon comments and ``PATCH /auth/me`` (plan §A.2, §A.7).

Three layers, applied in this order to any user-visible free text:

1. ``normalise_text``: NFC, strip bidi / zero-width / control characters,
   trim. Everything downstream (length checks, URL and blocklist matching,
   what is stored) sees the normalised string, so what is validated is what is
   persisted.
2. ``contains_url`` / ``contains_contact``: scheme, ``www.``, bare
   ``label.tld`` tokens, explicit ``label.word/path`` shapes, off-platform
   contact vectors (t.me, wa.me, messaging-app names, @handles, phone numbers).
3. ``contains_blocked_term``: whole-word, suffix-tolerant and collapsed-phrase
   matching against ``comment_blocklist.txt``, loaded once at import.

Matching (2 and 3) runs on a folded copy of the text (``_match_form``); the
stored text is never altered by the folds. Every pattern here is linear in the
input length: no nested quantifiers over the same character class.

Nothing here does I/O after import and nothing logs: callers must never log
the text passed in.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

# ``normalise_text`` is a per-character Python loop, so callers must bound the
# RAW length before calling it. The raw cap is a generous multiple of the
# normalised cap (normalisation only ever shrinks text), so legitimate input
# with stray invisible characters still passes.
RAW_LENGTH_FACTOR = 4


def raw_length_exceeded(raw: str, normalised_cap: int) -> bool:
    return len(raw) > normalised_cap * RAW_LENGTH_FACTOR


# Bidi controls: LRE/RLE/PDF/LRO/RLO, isolates, LRM/RLM, ALM.
_BIDI = frozenset(
    [chr(c) for c in range(0x202A, 0x202F)]
    + [chr(c) for c in range(0x2066, 0x206A)]
    + ["\u200e", "\u200f", "\u061c"]
)
# Invisible characters that carry no text: ZWSP, WORD JOINER, BOM/ZWNBSP.
# ZWNJ (U+200C) and ZWJ (U+200D) are deliberately kept in the stored text: they
# are load-bearing in emoji ZWJ sequences and in Persian/Indic scripts. Every
# Unicode Cf (format) character, those two included, plus the combining grapheme
# joiner U+034F, is removed from the copy used for URL and blocklist matching
# (see `_match_form`), so none of them can be used to evade either check.
_INVISIBLE_STRIPPED = frozenset(["\u200b", "\u2060", "\ufeff"])
_CGJ = "\u034f"
_LINE_BREAKS = frozenset(["\r", "\u2028", "\u2029"])
_MULTI_BLANK = re.compile(r"\n[^\S\n]*(?:\n[^\S\n]*){2,}")


def _clean_char(ch: str) -> str | None:
    """Return the character to keep, a replacement, or None to drop it."""
    if ch in _BIDI or ch in _INVISIBLE_STRIPPED:
        return None
    if ch == "\n" or ch in _LINE_BREAKS:
        return "\n"
    if ch == "\t":
        return " "
    cat = unicodedata.category(ch)
    # C0/C1 controls, DEL, surrogates, private use. Unassigned (Cn) is kept so
    # emoji newer than this interpreter's Unicode tables are not mangled.
    if cat in ("Cc", "Cs", "Co"):
        return None
    return ch


def normalise_text(raw: str, *, multiline: bool = True) -> str:
    """Normalise user text. Idempotent.

    ``multiline=False`` (names) folds every whitespace run, newlines included,
    into one space. ``multiline=True`` keeps ``\\n`` (a CRLF pair is one
    newline) and caps a blank-line run at one empty line.
    """
    text = unicodedata.normalize("NFC", raw).replace("\r\n", "\n")
    out: list[str] = []
    for ch in text:
        kept = _clean_char(ch)
        if kept is not None:
            out.append(kept)
    text = "".join(out)
    if multiline:
        text = _MULTI_BLANK.sub("\n\n", text)
    else:
        text = " ".join(text.split())
    text = text.strip()
    if multiline:
        # Re-cap after the trim and drop trailing spaces on each line.
        text = "\n".join(line.rstrip() for line in text.split("\n"))
        text = _MULTI_BLANK.sub("\n\n", text)
    return text


def has_visible_text(text: str) -> bool:
    """True if the string holds at least one letter, number, punctuation,
    symbol or mark. Rejects a body that is only joiners or spaces."""
    return any(unicodedata.category(c)[0] in "LNPSM" for c in text)


# ── URL rejection ────────────────────────────────────────────────────────────
# Bare ``label.tld`` is matched against a list of real, commonly abused TLDs
# rather than any 2+ letter run, so scripture and most run-together sentences
# ("John 3.16", "Rom 8.28-39", "Ps. 23", "Amen.Thank you", "e.g.", "Mr.Smith")
# are not false positives, which matters for this audience. TLDs that are also
# ordinary English words (today, life, me, it, in, ...) are deliberately left
# out: "Praise God.Today" must post. The cost is a false negative for those few
# TLDs; the scheme and ``www.`` forms are still caught, and this stays a floor,
# not a filter.
_TLDS = (
    "com",
    "net",
    "org",
    "edu",
    "gov",
    "info",
    "biz",
    "io",
    "co",
    "uk",
    "ca",
    "au",
    "nz",
    "de",
    "fr",
    "es",
    "nl",
    "ch",
    "se",
    "dk",
    "fi",
    "ie",
    "pl",
    "pt",
    "ru",
    "ua",
    "cn",
    "jp",
    "kr",
    "br",
    "mx",
    "ar",
    "za",
    "ng",
    "gh",
    "ke",
    "ug",
    "tz",
    "zm",
    "zw",
    "cm",
    "sn",
    "ly",
    "gg",
    "tv",
    "cc",
    "ws",
    "fm",
    "ai",
    "app",
    "dev",
    "xyz",
    "top",
    "site",
    "online",
    "store",
    "club",
    "church",
    "vip",
    "win",
    "bid",
    "loan",
    "icu",
    "cyou",
    "click",
    "blog",
    "tech",
    "cloud",
    "website",
    "media",
    "pro",
    "mobi",
    "asia",
    "xxx",
    "sex",
    "porn",
    "adult",
    "cam",
    "chat",
    "wtf",
    "lol",
    "zip",
    "gl",
    "gd",
    "gy",
    "sh",
    "st",
    "tk",
    "ml",
    "ga",
    "cf",
    "gq",
    "su",
    "ae",
    "sa",
    "eu",
)
_TLD_SET = frozenset(_TLDS)
_SCHEME_RE = re.compile(r"https?://|www\.", re.IGNORECASE | re.ASCII)
# One dotted run of labels, consumed whole (so scanning is linear: a start is
# only tried right after a non-label character), optionally followed by "/" and
# a path character. The run is URL-shaped when any label after the first is a
# listed TLD, or when it is followed by "/path" and ends in an alphabetic label
# ("x.link/abc", "t.me/x"): that is how ".me", ".link", ".live" and ".shop"
# are caught without adding those ordinary words to the TLD list.
_DOTTED_RE = re.compile(
    r"(?<![a-z0-9-])([a-z0-9-]+(?:\.[a-z0-9-]+)+)(/(?=[^\s/]))?",
    re.IGNORECASE | re.ASCII,
)
_ALPHA_LABEL = re.compile(r"[a-z]{2,}", re.ASCII)
_DOTS = str.maketrans({"\u3002": ".", "\uff0e": ".", "\uff61": ".", "\u2024": "."})

# Cyrillic and Greek letters that render like a Latin letter, folded to it in
# the MATCH FORM ONLY (stored text is never changed). A small hand-kept table,
# not the full Unicode confusables set: NFKC already folds fullwidth and
# compatibility forms. Both cases are listed because this runs before casefold.
_CONFUSABLES = str.maketrans(
    {
        # Cyrillic, lower case
        "\u0430": "a",
        "\u0435": "e",
        "\u043e": "o",
        "\u0440": "p",
        "\u0441": "c",
        "\u0443": "y",
        "\u0445": "x",
        "\u0456": "i",
        "\u0458": "j",
        "\u0455": "s",
        "\u0501": "d",
        "\u04bb": "h",
        "\u051b": "q",
        "\u051d": "w",
        "\u04cf": "l",
        "\u043a": "k",
        "\u043c": "m",
        "\u043d": "h",
        "\u0442": "t",
        "\u0432": "b",
        # Cyrillic, upper case
        "\u0410": "A",
        "\u0412": "B",
        "\u0415": "E",
        "\u041a": "K",
        "\u041c": "M",
        "\u041d": "H",
        "\u041e": "O",
        "\u0420": "P",
        "\u0421": "C",
        "\u0422": "T",
        "\u0425": "X",
        "\u0406": "I",
        "\u0408": "J",
        "\u0405": "S",
        "\u0423": "Y",
        # Greek, lower case
        "\u03b1": "a",
        "\u03b5": "e",
        "\u03b9": "i",
        "\u03bf": "o",
        "\u03c1": "p",
        "\u03c5": "u",
        "\u03bd": "v",
        "\u03ba": "k",
        "\u03c4": "t",
        "\u03c7": "x",
        "\u03b3": "y",
        "\u03b7": "n",
        "\u03bc": "u",
        "\u03c9": "w",
        "\u03c3": "o",
        # Greek, upper case
        "\u0391": "A",
        "\u0392": "B",
        "\u0395": "E",
        "\u0396": "Z",
        "\u0397": "H",
        "\u0399": "I",
        "\u039a": "K",
        "\u039c": "M",
        "\u039d": "N",
        "\u039f": "O",
        "\u03a1": "P",
        "\u03a4": "T",
        "\u03a5": "Y",
        "\u03a7": "X",
        # Latin look-alike that NFKC/NFKD leave alone
        "\u0131": "i",
    }
)


def _match_form(text: str) -> str:
    """The copy URL, contact and blocklist checks run on: NFKC (folds fullwidth
    forms), unicode dots mapped to '.', every Cf (format) character and U+034F
    removed, Cyrillic/Greek look-alikes folded to Latin."""
    folded = unicodedata.normalize("NFKC", text).translate(_DOTS)
    kept = "".join(c for c in folded if c != _CGJ and unicodedata.category(c) != "Cf")
    return kept.translate(_CONFUSABLES)


# Host-match forms (R-1). People dodge the dotted-host checks by spacing the dot,
# bracketing it or spelling it: "t . me/x", "gmail [.] com", "wa dot me",
# "h t t p : / / x . c o m", "bit ly/abc". The forms below undo that, and they
# are consumed ONLY by the explicit contact-host list and the TLD check, never by
# the general URL-shape, digit or blocklist rules, so ordinary prose with
# sentence-final periods ("Amen. Praise God. Today we pray.") is untouched.
# Every pattern is anchored on a lookbehind so a long whitespace run is consumed
# once, not once per start position.
_JOIN_SINGLES_RE = re.compile(r"\b[a-z0-9](?: [a-z0-9]\b)+", re.IGNORECASE | re.ASCII)
_BRACKET_DOT_RE = re.compile(
    r"(?<!\s)\s*[\[({<]\s*(?:\.|dot)\s*[\])}>]\s*", re.IGNORECASE | re.ASCII
)
_DOT_WORD_RE = re.compile(r"(?<=\w)\s+dot\s+(?=\w)", re.IGNORECASE | re.ASCII)
# TLD form: a space BEFORE the dot ("gmail . com", "gmail .com") counts, a space
# only AFTER it ("pray. Church was good") never does, because a sentence that
# starts with Church, Pro, Win, Top or Media must post.
_SPACE_BEFORE_DOT_RE = re.compile(r"(?<!\s)\s+\.\s*")
# Contact-host form: any spacing around the dot ("t. me/x"). Safe only because
# the host list it feeds is two standalone tokens plus bit.ly.
_SPACE_AROUND_DOT_RE = re.compile(r"(?<!\s)\s*\.\s*")


def _host_form(form: str, *, loose: bool) -> str:
    joined = _JOIN_SINGLES_RE.sub(lambda m: m.group().replace(" ", ""), form)
    joined = _BRACKET_DOT_RE.sub(".", joined)
    joined = _DOT_WORD_RE.sub(".", joined)
    return (_SPACE_AROUND_DOT_RE if loose else _SPACE_BEFORE_DOT_RE).sub(".", joined)


@dataclass(frozen=True, slots=True)
class _Forms:
    """Every derived copy of one text, computed once per validation."""

    match: str  # NFKC, unicode dots, Cf removed, confusables folded
    host_tld: str  # match + spaced/bracketed/"dot" collapsed (TLD check)
    host_contact: str  # same, any spacing around the dot (contact hosts)
    tokens: tuple[str, ...]  # accent-stripped, casefolded, punctuation-split
    leet_tokens: tuple[str, ...]  # tokens after the leetspeak fold (self-harm only)


# 0->o 1->i 3->e 4->a @->a $->s. Applied ONLY to the self-harm ("!phrase")
# matcher: it is a short phrase list matched on whole-token boundaries, so the
# false-positive surface is tiny; profanity and scripture refs never see it.
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "@": "a", "$": "s"})


def _build_forms(text: str) -> _Forms:
    match = _match_form(text)
    nfkd = unicodedata.normalize("NFKD", match)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    folded = stripped.translate(_CONFUSABLES).casefold()
    return _Forms(
        match=match,
        host_tld=_host_form(match, loose=False),
        host_contact=_host_form(match, loose=True),
        tokens=tuple(_NON_WORD.sub(" ", folded).split()),
        leet_tokens=tuple(_NON_WORD.sub(" ", folded.translate(_LEET)).split()),
    )


# One validation calls the url, contact and blocklist matchers (and the reserved
# title check for names) on the same string; the small cache means the Unicode
# normalisation passes run once for all of them. Pure function of the text.
_forms = lru_cache(maxsize=4)(_build_forms)


def _tld_hit(form: str) -> bool:
    for m in _DOTTED_RE.finditer(form):
        if any(label in _TLD_SET for label in m.group(1).lower().split(".")[1:]):
            return True
    return False


def contains_url(text: str) -> bool:
    forms = _forms(text)
    form = forms.match
    if _SCHEME_RE.search(form):
        return True
    for m in _DOTTED_RE.finditer(form):
        labels = m.group(1).lower().split(".")
        if any(label in _TLD_SET for label in labels[1:]):
            return True
        if m.group(2) and _ALPHA_LABEL.fullmatch(labels[-1]):
            return True
    return forms.host_tld != form and _tld_hit(forms.host_tld)


# ── Off-platform contact ─────────────────────────────────────────────────────
# Messaging-app hosts, @handles, "dot com" spelled out, discord used as a
# contact handle, and phone numbers. Messaging-app NAMES are matched by the
# collapsed matcher below (so "whats app" and "telegraaam" are caught too).
# Matched on the contact-host form, where "t . me", "wa dot me" and "t. me" are
# already "t.me". The apostrophes in the lookbehind keep "can't. Me neither" out.
_CONTACT_HOST_RE = re.compile(
    r"(?<![a-z0-9'\u2019-])(?:(?:t|wa)\.me|bit[. ]?ly)(?![a-z0-9-])",
    re.IGNORECASE | re.ASCII,
)
_HANDLE_RE = re.compile(r"(?<![\w@])@[\w.]{2,}")
_SPELLED_DOT_RE = re.compile(
    r"\bdot\W{0,3}(?:com|net|org|edu|gov|info|biz|io|co|uk)\b",
    re.IGNORECASE | re.ASCII,
)
# "discord" is also a scripture word (Prov 6:19, "he that soweth discord"), so it
# only counts in a contact shape: "my/on/add/join/via discord", "discord:",
# "discord server", "discord id", "discord#1234"...
_DISCORD_RE = re.compile(
    r"\b(?:on|my|add|join|via|dms?)\s+(?:my\s+|our\s+|the\s+)?discord\b"
    r"|\bdiscord\s{0,2}(?:[:@#=]|(?:server|invite|id|username|handle|link|dms?"
    r"|channel|group|tag|me)\b)",
    re.IGNORECASE | re.ASCII,
)
# Short handles of other messaging apps (R-2), in a contact shape only, the same
# way discord is. "ig", "tg", "kik", "tiktok", "insta", "instagram", "fb" and
# "facebook" are not English words, so the broad "on/my/add ..." lead-in is
# safe. "snap" and "signal" are ordinary words ("a signal from God", "the snap
# of a finger"), so they need a stricter shape: a colon/@/#/= right after,
# "me/id/username/handle/dm", "add me on snap", or "my snap id".
_HANDLE_APP = r"(?:ig|tg|kik|tiktok|insta|instagram|fb|facebook)"
_AMBIGUOUS_APP = r"(?:snap|signal)"
_APP_TRAILER = r"\s{0,2}(?:[:@#=]|(?:me|id|username|handle|dms?)\b)"
_APP_HANDLE_RE = re.compile(
    r"\b(?:on|my|add|join|via|dms?|follow)\s+(?:me\s+(?:on\s+)?)?"
    r"(?:my\s+|our\s+|the\s+)?" + _HANDLE_APP + r"\b"
    r"|\b"
    + _HANDLE_APP
    + _APP_TRAILER
    + r"|\b"
    + _AMBIGUOUS_APP
    + _APP_TRAILER
    + r"|\b(?:add|dm|text|message|msg|find|follow)\s+me\s+(?:on|at|via)\s+(?:my\s+)?"
    + _AMBIGUOUS_APP
    + r"\b"
    + r"|\bmy\s+"
    + _AMBIGUOUS_APP
    + r"\s+(?:id|username|handle|name|number)\b",
    re.IGNORECASE | re.ASCII,
)

# A digit run: digits separated by spaces, dots, dashes or parentheses (a colon,
# comma, slash or letter ends it, so "John 3:16" and "119:105" never join).
_DIGIT_RUN_RE = re.compile(r"(\+ ?)?\(?(\d+(?:[ \t().\-]+\d+)*)")
_DIGIT_GROUP_RE = re.compile(r"\d+")
_DATE_RUN_RE = re.compile(
    r"\d{1,2}[ .\-]\d{1,2}[ .\-]\d{4}|\d{4}[ .\-]\d{1,2}[ .\-]\d{1,2}"
)
_PHONE_MIN_DIGITS = 7
_MAX_SCRIPTURE_NUMBER = 176  # longest psalm; no chapter or verse is higher
_MAX_SPACED_SINGLES = 4


def _run_looks_like_phone(plus: bool, run: str) -> bool:
    groups = _DIGIT_GROUP_RE.findall(run)
    if sum(len(g) for g in groups) < _PHONE_MIN_DIGITS:
        return False
    if plus or len(groups) == 1:
        return True  # "+233...", or 7+ contiguous digits: never scripture
    if _DATE_RUN_RE.fullmatch(run):
        return False  # 10-02-2026, 2026.10.02
    if sum(1 for g in groups if len(g) == 1) > _MAX_SPACED_SINGLES:
        return True  # "0 2 4 1 2 3 4 5 6 7"
    # Scripture lists ("Psalms 23 27 91 121", "Rom 8.28-39 12.1-2") are small
    # numbers without leading zeros; phones start with 0 or carry groups that
    # are too large to be a chapter or verse.
    return any(
        (len(g) > 1 and g.startswith("0"))
        # len > 3 is already above any chapter or verse; checking it first keeps
        # int() off an unbounded digit run (Python's int-str limit is 4300).
        or len(g) > len(str(_MAX_SCRIPTURE_NUMBER))
        or int(g) > _MAX_SCRIPTURE_NUMBER
        for g in groups
    )


def contains_contact(text: str) -> bool:
    """Off-platform contact details: t.me / wa.me, messaging-app names, @handles,
    spelled-out "dot com", discord as a contact handle, and phone numbers
    (7+ digits ignoring spaces, dots, dashes, parentheses and a leading +)."""
    forms = _forms(text)
    form = forms.match
    if _CONTACT_HOST_RE.search(forms.host_contact) or _HANDLE_RE.search(form):
        return True
    if _SPELLED_DOT_RE.search(form) or _DISCORD_RE.search(form):
        return True
    if _APP_HANDLE_RE.search(form):
        return True
    for m in _DIGIT_RUN_RE.finditer(form):
        if _run_looks_like_phone(m.group(1) is not None, m.group(2)):
            return True
    return _collapsed_hit(forms.tokens, _MESSAGING_COLLAPSED)


# ── Blocklist ────────────────────────────────────────────────────────────────
_BLOCKLIST_PATH = Path(__file__).with_name("comment_blocklist.txt")
_NON_WORD = re.compile(r"[\W_]+", re.UNICODE)


def _fold_for_blocklist(text: str) -> str:
    """Lowercase, accent-stripped, confusable-folded, punctuation-to-space,
    padded with spaces so a whole-word/phrase test is a plain substring test
    on ' term '."""
    return " " + " ".join(_build_forms(text).tokens) + " "


def _tokens(text: str) -> tuple[str, ...]:
    return _forms(text).tokens


_SQUEEZE_RE = re.compile(r"(.)\1+")


def _squeeze(s: str) -> str:
    """Collapse repeated letters ("dieee" -> "die")."""
    return _SQUEEZE_RE.sub(r"\1", s)


def _collapse_phrase(phrase: str) -> str:
    return _squeeze("".join(phrase.split()))


_MESSAGING_COLLAPSED = frozenset(
    _collapse_phrase(w)
    for w in ("telegram", "whatsapp", "whatsap", "watsapp", "snapchat")
)


def _collapsed_hit(tokens: tuple[str, ...], targets: frozenset[str]) -> bool:
    """True when consecutive tokens, joined with no separator and with repeated
    letters squeezed, spell a target exactly from a token boundary to a token
    boundary: "kill your self", "k y s", "go dieee", "whats app". Token
    boundaries are required at both ends, so "ago diesel" (which contains
    "godie") and "Chicago Dietrich" do not match."""
    out: list[str] = []
    starts: set[int] = set()
    ends: set[int] = set()
    for tok in tokens:
        starts.add(len(out))
        for ch in tok:
            if not out or out[-1] != ch:  # squeeze repeats, across tokens too
                out.append(ch)
        ends.add(len(out))
    joined = "".join(out)
    for target in targets:
        i = joined.find(target)
        while i != -1:
            if i in starts and i + len(target) in ends:
                return True
            i = joined.find(target, i + 1)
    return False


_SUFFIXES = ("", "s", "es", "ed", "ing", "y", "er", "ers")


def _inflections(stem: str) -> set[str]:
    """Suffix-tolerant forms of a profanity stem: s/es/ed/ing/y/er/ers, the
    doubled final consonant (shit -> shitting, slut -> slutty) and -y -> -ies
    (pussy -> pussies). Generated words, matched as WHOLE tokens, so a stem
    never fires inside a longer word ("assess", "class", "Scunthorpe")."""
    bases = {stem}
    if stem.endswith("y"):
        bases.add(stem[:-1] + "ie")
    forms: set[str] = set()
    for base in bases:
        for suffix in _SUFFIXES:
            forms.add(base + suffix)
            if suffix and base[-1] not in "aeiouy":
                forms.add(base + base[-1] + suffix)
    return forms


def _fold_term(line: str) -> str:
    return _fold_for_blocklist(line).strip()


def _parse_blocklist(
    path: Path,
) -> tuple[frozenset[str], frozenset[str], frozenset[str]]:
    """(exact, stems, collapsed) folded terms. Line prefixes: none = exact
    whole word/phrase, ``+`` = suffix-tolerant stem, ``!`` = collapsed phrase."""
    exact: set[str] = set()
    stems: set[str] = set()
    collapsed: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        marker = line[0] if line[0] in "+!" else ""
        folded = _fold_term(line[len(marker) :])
        if not folded:
            continue
        {"": exact, "+": stems, "!": collapsed}[marker].add(folded)
    return frozenset(exact), frozenset(stems), frozenset(collapsed)


def _load_blocklist(path: Path = _BLOCKLIST_PATH) -> frozenset[str]:
    """Every listed term, markers stripped (the file content, for audit)."""
    exact, stems, collapsed = _parse_blocklist(path)
    return exact | stems | collapsed


# Loaded once at import.
_EXACT, _STEMS, _COLLAPSED_PHRASES = _parse_blocklist(_BLOCKLIST_PATH)
BLOCKED_TERMS: frozenset[str] = _EXACT | _STEMS | _COLLAPSED_PHRASES
_INFLECTED: frozenset[str] = frozenset(
    form for stem in _STEMS for form in _inflections(stem)
)
_COLLAPSED: frozenset[str] = frozenset(_collapse_phrase(p) for p in _COLLAPSED_PHRASES)


def contains_blocked_term(text: str) -> bool:
    forms = _forms(text)
    tokens = forms.tokens
    padded = " " + " ".join(tokens) + " "
    if any(f" {term} " in padded for term in _EXACT):
        return True
    if any(tok in _INFLECTED for tok in tokens):
        return True
    # Plain tokens, then the leet-folded ones ("kill y0urself", "k1ll urself").
    # Both: "$" and "@" are punctuation to the plain split but letters to the fold.
    return _collapsed_hit(tokens, _COLLAPSED) or _collapsed_hit(
        forms.leet_tokens, _COLLAPSED
    )


# ── Reserved names ───────────────────────────────────────────────────────────
# Titles a member must not be able to claim as the first word of their name, so
# a comment cannot read as coming from staff ("Pastor I." is what viewers see).
# The four from the brief (pastor, admin, moderator, staff) plus the variants
# that carry the same authority in a church setting: the common abbreviations
# (pr, ps, pst, mod, rev, revd), the spelled-out ministry titles (reverend,
# apostle, bishop, elder, deacon, deaconess, prophet, evangelist) and plurals.
# Deliberately NOT listed: minister, brother/sister, mr/mrs, dr (ordinary
# honorifics, not authority claims).
RESERVED_NAME_TITLES = frozenset(
    {
        "pastor",
        "pastors",
        "pst",
        "pr",
        "ps",
        "admin",
        "admins",
        "administrator",
        "administrators",
        "moderator",
        "moderators",
        "mod",
        "mods",
        "staff",
        "rev",
        "revd",
        "reverend",
        "apostle",
        "bishop",
        "elder",
        "deacon",
        "deaconess",
        "prophet",
        "evangelist",
    }
)
_TRAILING_DIGITS = re.compile(r"\d+$")


def starts_with_reserved_title(name: str) -> bool:
    """True when the first word of ``name`` is a reserved title, after
    normalisation, confusable folding and punctuation removal ("Pr. John",
    "(Pastor)", "PASTOR", "Pаstor" with a Cyrillic a, "P a s t o r", "Admin2").
    Only the first word counts: "John Pastor" is a surname."""
    tokens = _tokens(name)
    if not tokens:
        return False
    candidates = {tokens[0]}
    run: list[str] = []
    for tok in tokens:  # leading single letters spell a word: "p a s t o r"
        if len(tok) != 1:
            break
        run.append(tok)
    candidates.update("".join(run[:n]) for n in range(2, len(run) + 1))
    return any(_TRAILING_DIGITS.sub("", c) in RESERVED_NAME_TITLES for c in candidates)
