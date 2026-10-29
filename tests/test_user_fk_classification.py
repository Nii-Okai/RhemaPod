"""Every foreign key into `users` is classified, so a new one cannot slip past
the erasure path unnoticed (account deletion, ADR 0020).

Adding an FK to `users` fails this test until the (table, column) is listed
here with its `ondelete`, and the kitchen-sink viewer
(`tests/kitchen_sink.py`) gains a row for it. RESTRICT columns are the
authored-history guard (`auth_service._authored_history`, 409 on delete).
"""
from sqlalchemy import func, select

from app.models.models import Base, User
from tests.comments_pg import (  # noqa: F401
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    sessions,
)
from tests.kitchen_sink import seed_kitchen_sink_viewer

CASCADE, SET_NULL, RESTRICT = "CASCADE", "SET NULL", "RESTRICT"

USER_FKS: dict[tuple[str, str], str] = {
    ("announcement_approval_log", "actor_id"): RESTRICT,
    ("announcements", "created_by"): RESTRICT,
    ("approval_log", "actor_id"): RESTRICT,
    ("comment_moderation_log", "actor_id"): SET_NULL,
    ("listener_day", "user_id"): CASCADE,
    ("playback_sessions", "user_id"): CASCADE,
    ("playlists", "user_id"): CASCADE,
    ("sermon_comment_reports", "reporter_id"): CASCADE,
    ("sermon_comments", "hidden_by_id"): SET_NULL,
    ("sermon_comments", "user_id"): CASCADE,
    ("sermon_likes", "user_id"): CASCADE,
    ("series", "created_by"): RESTRICT,
    ("series_likes", "user_id"): CASCADE,
    ("sermons", "created_by"): RESTRICT,
    ("subscriptions", "user_id"): CASCADE,
    ("upload_jobs", "created_by"): RESTRICT,
    ("user_blocks", "blocked_id"): CASCADE,
    ("user_blocks", "blocker_id"): CASCADE,
    ("user_identities", "user_id"): CASCADE,
    ("verses", "created_by"): SET_NULL,
}


def _model_user_fks() -> dict[tuple[str, str], str]:
    users = User.__table__
    found: dict[tuple[str, str], str] = {}
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table is users:
                found[(table.name, fk.parent.name)] = (fk.ondelete or "NO ACTION").upper()
    return found


def test_every_users_fk_is_classified_with_its_ondelete():
    found = _model_user_fks()
    unclassified = sorted(set(found) - set(USER_FKS))
    stale = sorted(set(USER_FKS) - set(found))
    assert not unclassified, (
        f"new FK(s) into users not classified in USER_FKS (and not in the "
        f"kitchen-sink viewer): {unclassified}"
    )
    assert not stale, f"USER_FKS lists FK(s) that no longer exist: {stale}"
    assert {k: v for k, v in found.items()} == USER_FKS


async def test_kitchen_sink_viewer_touches_every_non_restrict_fk(
    pg_client, sessions, make_user, published_sermon
):
    """The fixture is only a proof of erasure if it reaches every table the
    erasure has to clean."""
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    models = {t.name: t for t in Base.metadata.sorted_tables}
    async with sessions() as s:
        for (table, column), action in USER_FKS.items():
            if action == RESTRICT:
                continue
            t = models[table]
            n = (await s.execute(
                select(func.count()).select_from(t).where(t.c[column] == ks.user_id)
            )).scalar_one()
            assert n >= 1, f"kitchen sink has no row for {table}.{column}"
