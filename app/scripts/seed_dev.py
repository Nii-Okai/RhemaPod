"""Seed a realistic development dataset for the admin portal.

Also the Playwright fixture for ``admin_portal/`` — so the output shape is kept
stable on purpose. Everything it writes is tagged with a marker (a known email
domain for staff, a ``[SEED]`` title/name prefix, a ``seed-`` slug prefix) so
``--fresh`` can find and drop exactly its own rows and nothing else.

    uv run python -m app.scripts.seed_dev            # idempotent: no-op if present
    uv run python -m app.scripts.seed_dev --fresh --yes-delete-from localhost

Guarded two ways, because ``ENVIRONMENT`` alone is not enough — a laptop
defaults to ``development`` while its ``DATABASE_URL`` may still point at prod:

* **Environment:** refuses unless ``ENVIRONMENT`` is ``development`` or ``test``
  (and never when ``settings.is_production``).
* **DB target:** refuses unless the host in ``settings.database_url`` is loopback
  (``127.0.0.1`` / ``localhost`` / ``::1``), a dev compose service name
  (``postgres`` / ``db``), or listed in ``SEED_DEV_ALLOWED_DB_HOSTS``
  (comma-separated).

Both checks run inside ``_build()`` and ``_delete_seed_rows()`` themselves, so no
caller can bypass them. ``--fresh`` runs DELETEs and additionally needs the
target host echoed back: ``--yes-delete-from <host>``, an interactive prompt, or
``--force`` in a non-interactive context (loopback/compose host only).

It creates fake accounts with a shared, printed password — never something to
point at a real database.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.database import PrimarySession
from app.models.models import (
    Announcement,
    AnnouncementStatus,
    ApprovalLog,
    Category,
    ContentTier,
    Sermon,
    SermonStatus,
    SermonTag,
    Series,
    Speaker,
    User,
    UserRole,
)

# ── Markers ───────────────────────────────────────────────────────────────────
SEED_EMAIL_DOMAIN = "seed.rhemapod.dev"
SEED_PREFIX = "[SEED]"
SEED_SLUG_PREFIX = "seed-"
# Shared temp password for every seeded staff account. Meets
# _validate_password_strength (>= 12 chars, not a common value).
TEMP_PASSWORD = "SeedDev-Passphrase-2026"

# (email, full name, role). Two editors and two managers so the review queue
# and every role-gated screen have more than one actor to exercise.
STAFF: list[tuple[str, str, UserRole]] = [
    (f"editor.sam@{SEED_EMAIL_DOMAIN}", "Sam Editor", UserRole.EDITOR),
    (f"editor.rae@{SEED_EMAIL_DOMAIN}", "Rae Editor", UserRole.EDITOR),
    (f"manager.mo@{SEED_EMAIL_DOMAIN}", "Mo Manager", UserRole.MANAGER),
    (f"manager.val@{SEED_EMAIL_DOMAIN}", "Val Manager", UserRole.MANAGER),
]

_EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


@dataclass
class SeedSummary:
    staff: list[tuple[str, str]] = field(default_factory=list)  # (email, role)
    temp_password: str = TEMP_PASSWORD
    sermon_statuses: dict[str, int] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    created: bool = True


class SeedError(SystemExit):
    """Non-zero exit with a human message (SystemExit → exit code 1)."""


# DB hosts this script is allowed to write to / delete from. Loopback = the
# developer's own machine; the compose service names = the dev docker-compose
# Postgres. Anything else (a real hostname, an RDS endpoint) is refused unless
# explicitly listed in SEED_DEV_ALLOWED_DB_HOSTS.
_LOOPBACK_DB_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_COMPOSE_DB_HOSTS = frozenset({"postgres", "db"})
_DB_HOST_ALLOWLIST_ENV = "SEED_DEV_ALLOWED_DB_HOSTS"


def _target_db_host() -> str:
    """The host in ``settings.database_url``, lower-cased.

    Returns ``""`` when the URL cannot be parsed or carries no host (e.g. a unix
    socket) — which then fails ``_db_host_is_safe`` below. Fail closed.
    """
    try:
        return (make_url(get_settings().database_url).host or "").strip().lower()
    except Exception:
        return ""


def _db_host_allowlist() -> set[str]:
    raw = os.environ.get(_DB_HOST_ALLOWLIST_ENV, "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _db_host_is_safe(host: str) -> bool:
    return bool(host) and (
        host in _LOOPBACK_DB_HOSTS
        or host in _COMPOSE_DB_HOSTS
        or host in _db_host_allowlist()
    )


def _ensure_safe_environment() -> None:
    """Full guard: environment AND resolved DB host. Called from every mutating
    path (``_build`` / ``_delete_seed_rows``), not just the entrypoint."""
    settings = get_settings()
    if settings.is_production:
        raise SeedError(
            "seed_dev refuses to run: ENVIRONMENT=production. This script "
            "creates fake staff accounts and content."
        )
    if settings.environment.lower() not in {"development", "test"}:
        raise SeedError(
            "seed_dev only runs with ENVIRONMENT in (development, test); got "
            f"{settings.environment!r}."
        )
    host = _target_db_host()
    if not _db_host_is_safe(host):
        raise SeedError(
            "seed_dev refuses to run: DATABASE_URL host "
            f"{host or '(unparseable/none)'!r} is not a recognised dev target. "
            "Allowed: loopback (127.0.0.1 / localhost / ::1), a compose service "
            f"name ({' / '.join(sorted(_COMPOSE_DB_HOSTS))}), or a host listed "
            f"in {_DB_HOST_ALLOWLIST_ENV}. ENVIRONMENT alone is not enough — a "
            "laptop defaults to 'development' while still pointed at prod."
        )


def _ensure_delete_confirmed(confirm_host: str | None, force: bool) -> None:
    """``--fresh`` runs DELETEs — require the target DB host to be named back so
    a mistyped ``--fresh`` against the wrong database is never silent.

    ``_ensure_safe_environment`` has already proven the host is a dev target;
    this is the extra, deliberate speed-bump on destructive intent.
    """
    host = _target_db_host()
    if confirm_host is not None:
        if confirm_host.strip().lower() == host:
            return
        raise SeedError(
            f"--fresh confirmation mismatch: got {confirm_host!r}, but the "
            f"DATABASE_URL host is {host!r}. Pass --yes-delete-from {host}."
        )
    if sys.stdin.isatty():
        typed = input(
            f"About to DELETE all seed rows from DB host {host!r}. "
            "Type the host to confirm: "
        ).strip().lower()
        if typed == host:
            return
        raise SeedError("--fresh aborted: confirmation did not match.")
    if force and _db_host_is_safe(host):
        return
    raise SeedError(
        "--fresh needs confirmation in a non-interactive context: pass "
        f"--yes-delete-from {host} (or --force for a loopback/compose host)."
    )


async def _seed_present(db: AsyncSession) -> bool:
    hit = await db.execute(
        select(User.id).where(User.email.like(f"%@{SEED_EMAIL_DOMAIN}")).limit(1)
    )
    return hit.first() is not None


async def _delete_seed_rows(
    db: AsyncSession,
    *,
    confirm_host: str | None = None,
    force: bool = False,
) -> None:
    """Drop every row this script owns, in FK-safe order.

    sermon_tags / approval_log / announcement_approval_log are ON DELETE CASCADE
    at the DB (and SQLite honours it under PRAGMA foreign_keys=ON in tests), so
    deleting the parent sermon / announcement takes its children with it. The
    created_by FKs to users are ON DELETE RESTRICT, so users go last.

    Guards run here, not only in the caller, so no future caller can DELETE
    against an unvetted database or without confirming the target host.
    """
    _ensure_safe_environment()
    _ensure_delete_confirmed(confirm_host, force)

    seed_user_ids = (
        await db.execute(
            select(User.id).where(User.email.like(f"%@{SEED_EMAIL_DOMAIN}"))
        )
    ).scalars().all()

    opts = {"synchronize_session": False}
    await db.execute(
        delete(Announcement).where(
            or_(
                Announcement.title.like(f"{SEED_PREFIX}%"),
                Announcement.created_by.in_(seed_user_ids),
            )
        ).execution_options(**opts)
    )
    await db.execute(
        delete(Sermon).where(
            or_(
                Sermon.title.like(f"{SEED_PREFIX}%"),
                Sermon.created_by.in_(seed_user_ids),
            )
        ).execution_options(**opts)
    )
    await db.execute(
        delete(Series).where(
            or_(
                Series.title.like(f"{SEED_PREFIX}%"),
                Series.created_by.in_(seed_user_ids),
            )
        ).execution_options(**opts)
    )
    await db.execute(
        delete(Speaker).where(Speaker.name.like(f"{SEED_PREFIX}%"))
        .execution_options(**opts)
    )
    await db.execute(
        delete(Category).where(Category.slug.like(f"{SEED_SLUG_PREFIX}%"))
        .execution_options(**opts)
    )
    await db.execute(
        delete(User).where(User.email.like(f"%@{SEED_EMAIL_DOMAIN}"))
        .execution_options(**opts)
    )
    await db.commit()


def _log(sermon: Sermon, actor: User, chain: list[tuple[SermonStatus, SermonStatus]],
         note: str | None = None) -> list[ApprovalLog]:
    rows: list[ApprovalLog] = []
    for i, (frm, to) in enumerate(chain):
        rows.append(
            ApprovalLog(
                sermon=sermon,
                from_status=frm.value,
                to_status=to.value,
                actor_id=actor.id,
                note=note if i == len(chain) - 1 else None,
            )
        )
    return rows


async def _build(db: AsyncSession) -> SeedSummary:
    # Guard here too — a future caller that reaches _build directly (a test, a
    # REPL, another script) must not be able to write seed accounts into an
    # unvetted database.
    _ensure_safe_environment()

    # ── Staff ────────────────────────────────────────────────────────────────
    users: dict[str, User] = {}
    for email, name, role in STAFF:
        u = User(
            email=email,
            full_name=name,
            password_hash=hash_password(TEMP_PASSWORD),
            role=role,
            is_active=True,
        )
        db.add(u)
        users[email] = u
    sam = users[f"editor.sam@{SEED_EMAIL_DOMAIN}"]
    rae = users[f"editor.rae@{SEED_EMAIL_DOMAIN}"]
    mo = users[f"manager.mo@{SEED_EMAIL_DOMAIN}"]
    await db.flush()

    # ── Categories ───────────────────────────────────────────────────────────
    categories = [
        Category(name=f"{SEED_PREFIX} Teaching", slug=f"{SEED_SLUG_PREFIX}teaching"),
        Category(name=f"{SEED_PREFIX} Worship", slug=f"{SEED_SLUG_PREFIX}worship"),
        Category(name=f"{SEED_PREFIX} Youth", slug=f"{SEED_SLUG_PREFIX}youth"),
    ]
    db.add_all(categories)
    await db.flush()
    teaching, worship, youth = categories

    # ── Speakers (some with bios, some without) ───────────────────────────────
    speakers = [
        Speaker(
            name=f"{SEED_PREFIX} Pastor John Doe",
            bio="Lead pastor since 2009. Teaches through whole books of Scripture.",
        ),
        Speaker(
            name=f"{SEED_PREFIX} Dr. Mary Grace",
            bio="Visiting teacher; Old Testament and biblical languages.",
        ),
        Speaker(name=f"{SEED_PREFIX} Elder Mark", bio=None),
        Speaker(name=f"{SEED_PREFIX} Guest Speaker", bio=None),
    ]
    db.add_all(speakers)
    await db.flush()
    john, mary, mark, guest = speakers

    # ── Series (episode_number gaps are intentional) ──────────────────────────
    faith = Series(
        title=f"{SEED_PREFIX} Walking in Faith",
        description="A journey through Hebrews 11.",
        category_id=teaching.id,
        tier=ContentTier.PAID,
        status=SermonStatus.PUBLISHED,
        created_by=sam.id,
    )
    basics = Series(
        title=f"{SEED_PREFIX} Sunday Basics",
        description="Foundations for new believers.",
        category_id=youth.id,
        tier=ContentTier.FREE,
        status=SermonStatus.PUBLISHED,
        created_by=rae.id,
    )
    db.add_all([faith, basics])
    await db.flush()

    # ── Sermons: all six SermonStatus values ─────────────────────────────────
    def pub_at(days: int) -> datetime:
        return _EPOCH + timedelta(days=days)

    sermons: list[Sermon] = []
    logs: list[ApprovalLog] = []

    def add(s: Sermon, *tags: str) -> Sermon:
        for t in tags:
            s.tags.append(SermonTag(tag=t))
        sermons.append(s)
        db.add(s)
        return s

    # published — standalone, explicit free
    add(Sermon(
        title=f"{SEED_PREFIX} The Prodigal Son", description="Luke 15.",
        speaker_id=john.id, category_id=teaching.id, tier=ContentTier.FREE,
        status=SermonStatus.PUBLISHED, published_at=pub_at(10),
        duration_seconds=2410, created_by=sam.id,
    ), "grace", "parables")
    # published — in a paid series, tier inherited (tier=None)
    add(Sermon(
        title=f"{SEED_PREFIX} Grace Abounding", description="Hebrews 11:1-3.",
        speaker_id=john.id, category_id=teaching.id, series_id=faith.id,
        episode_number=1, tier=None,
        status=SermonStatus.PUBLISHED, published_at=pub_at(20),
        duration_seconds=2650, created_by=sam.id,
    ), "faith")
    # published — same series, episode gap (no ep 2), tier inherited
    add(Sermon(
        title=f"{SEED_PREFIX} Faith Over Fear", description="Hebrews 11:7.",
        speaker_id=mary.id, category_id=teaching.id, series_id=faith.id,
        episode_number=3, tier=None,
        status=SermonStatus.PUBLISHED, published_at=pub_at(34),
        duration_seconds=2510, created_by=sam.id,
    ), "faith", "fear")
    # published — free series, tier inherited
    add(Sermon(
        title=f"{SEED_PREFIX} The Narrow Path", description="Matthew 7.",
        speaker_id=mark.id, category_id=youth.id, series_id=basics.id,
        episode_number=1, tier=None,
        status=SermonStatus.PUBLISHED, published_at=pub_at(12),
        duration_seconds=1980, created_by=rae.id,
    ))
    # published — standalone, explicit paid
    add(Sermon(
        title=f"{SEED_PREFIX} Living Water", description="John 4.",
        speaker_id=mary.id, category_id=worship.id, tier=ContentTier.PAID,
        status=SermonStatus.PUBLISHED, published_at=pub_at(40),
        duration_seconds=3120, created_by=sam.id,
    ), "worship")

    # draft — standalone
    add(Sermon(
        title=f"{SEED_PREFIX} Draft: On Mercy", description=None,
        speaker_id=mark.id, category_id=teaching.id, tier=None,
        status=SermonStatus.DRAFT, created_by=sam.id,
    ))
    # draft — in free series, episode gap (ep 5)
    add(Sermon(
        title=f"{SEED_PREFIX} Draft: The Lord's Prayer",
        speaker_id=guest.id, category_id=youth.id, series_id=basics.id,
        episode_number=5, tier=None,
        status=SermonStatus.DRAFT, created_by=rae.id,
    ))

    # pending_review x2
    s_pend_1 = add(Sermon(
        title=f"{SEED_PREFIX} Pending: Sermon on the Mount",
        speaker_id=john.id, category_id=teaching.id, tier=ContentTier.FREE,
        status=SermonStatus.PENDING_REVIEW, created_by=sam.id,
    ))
    logs += _log(s_pend_1, sam, [
        (SermonStatus.DRAFT, SermonStatus.PENDING_REVIEW),
    ])
    s_pend_2 = add(Sermon(
        title=f"{SEED_PREFIX} Pending: Blessed Are",
        speaker_id=mary.id, category_id=worship.id, tier=None,
        status=SermonStatus.PENDING_REVIEW, created_by=rae.id,
    ))
    logs += _log(s_pend_2, rae, [
        (SermonStatus.DRAFT, SermonStatus.PENDING_REVIEW),
    ])

    # under_review
    s_under = add(Sermon(
        title=f"{SEED_PREFIX} Under Review: The Parables",
        speaker_id=john.id, category_id=teaching.id, tier=ContentTier.FREE,
        status=SermonStatus.UNDER_REVIEW, created_by=sam.id,
    ))
    logs += _log(s_under, sam, [(SermonStatus.DRAFT, SermonStatus.PENDING_REVIEW)])
    logs += _log(s_under, mo, [
        (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW),
    ])

    # approved
    s_appr = add(Sermon(
        title=f"{SEED_PREFIX} Approved: The Beatitudes",
        speaker_id=mary.id, category_id=teaching.id, tier=ContentTier.FREE,
        status=SermonStatus.APPROVED, created_by=sam.id,
    ))
    logs += _log(s_appr, sam, [(SermonStatus.DRAFT, SermonStatus.PENDING_REVIEW)])
    logs += _log(s_appr, mo, [
        (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW),
        (SermonStatus.UNDER_REVIEW, SermonStatus.APPROVED),
    ])

    # rejected — with a rejection note on the approval log
    s_rej = add(Sermon(
        title=f"{SEED_PREFIX} Rejected: Rough Draft",
        speaker_id=guest.id, category_id=worship.id, tier=None,
        status=SermonStatus.REJECTED, created_by=rae.id,
    ))
    logs += _log(s_rej, rae, [(SermonStatus.DRAFT, SermonStatus.PENDING_REVIEW)])
    logs += _log(
        s_rej, mo,
        [(SermonStatus.PENDING_REVIEW, SermonStatus.REJECTED)],
        note="Audio quality is poor and the intro runs long. Please re-record "
        "the first five minutes and resubmit.",
    )

    db.add_all(logs)

    # ── Announcements across statuses ────────────────────────────────────────
    announcements = [
        Announcement(
            title=f"{SEED_PREFIX} Christmas Service Times",
            description="Two services on the 24th.",
            body="Join us at 5pm and 7pm on Christmas Eve. Nursery available.",
            status=AnnouncementStatus.PUBLISHED,
            pinned=True,
            publish_at=pub_at(1),
            expires_at=pub_at(60),
            created_by=mo.id,
        ),
        Announcement(
            title=f"{SEED_PREFIX} Building Fund Update",
            description="We're 80% of the way there.",
            body="Thank you for your generosity. The remaining balance is...",
            status=AnnouncementStatus.PUBLISHED,
            publish_at=pub_at(3),
            created_by=users[f"manager.val@{SEED_EMAIL_DOMAIN}"].id,
        ),
        Announcement(
            title=f"{SEED_PREFIX} Youth Camp Registration",
            description="Opens next month.",
            body="Draft copy — dates and pricing to be confirmed.",
            status=AnnouncementStatus.DRAFT,
            created_by=rae.id,
        ),
    ]
    db.add_all(announcements)

    await db.commit()

    status_counts: dict[str, int] = {}
    for s in sermons:
        status_counts[s.status.value] = status_counts.get(s.status.value, 0) + 1

    return SeedSummary(
        staff=[(email, role.value) for email, _, role in STAFF],
        sermon_statuses=status_counts,
        counts={
            "users": len(STAFF),
            "categories": len(categories),
            "speakers": len(speakers),
            "series": 2,
            "sermons": len(sermons),
            "approval_logs": len(logs),
            "announcements": len(announcements),
        },
    )


async def seed(
    session_factory: async_sessionmaker[AsyncSession] = PrimarySession,
    *,
    fresh: bool = False,
    confirm_delete_host: str | None = None,
    force: bool = False,
) -> SeedSummary:
    """Build the dev dataset. Idempotent unless ``fresh=True``.

    ``session_factory`` is injectable so the test suite can run it against its
    own in-memory database. ``confirm_delete_host`` / ``force`` gate the
    ``fresh=True`` DELETE path (see ``_ensure_delete_confirmed``).
    """
    _ensure_safe_environment()

    async with session_factory() as db:
        if fresh:
            await _delete_seed_rows(
                db, confirm_host=confirm_delete_host, force=force
            )
        elif await _seed_present(db):
            print(
                f"[=] Seed data already present ({SEED_EMAIL_DOMAIN}); nothing "
                "to do. Use --fresh to drop and rebuild."
            )
            return SeedSummary(
                staff=[(email, role.value) for email, _, role in STAFF],
                created=False,
            )
        summary = await _build(db)

    _print_summary(summary)
    return summary


def _print_summary(summary: SeedSummary) -> None:
    print("[+] Dev dataset seeded.")
    print("    Staff accounts (password for all): " + summary.temp_password)
    for email, role in summary.staff:
        print(f"      - {email}  ({role})")
    print("    Sermons by status:")
    for status_name in sorted(summary.sermon_statuses):
        print(f"      - {status_name}: {summary.sermon_statuses[status_name]}")
    print("    Row counts:")
    for name in sorted(summary.counts):
        print(f"      - {name}: {summary.counts[name]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a dev/test dataset.")
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Delete previously seeded rows first, then rebuild.",
    )
    parser.add_argument(
        "--yes-delete-from",
        metavar="HOST",
        default=None,
        help="Confirm --fresh by naming the target DATABASE_URL host "
        "(e.g. --yes-delete-from localhost).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow --fresh without a typed confirmation in a non-interactive "
        "context — only when the DB host is loopback or a compose service name.",
    )
    args = parser.parse_args()
    asyncio.run(
        seed(
            fresh=args.fresh,
            confirm_delete_host=args.yes_delete_from,
            force=args.force,
        )
    )


if __name__ == "__main__":
    main()
