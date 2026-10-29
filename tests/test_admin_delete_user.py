"""D8 (plans/plan-account-deletion-backend.md): the shared `erase_user` as
driven by admin `DELETE /users/{id}`.

Viewer targets are erased completely, with no email left in the audit trail;
staff targets keep their snapshot label (ADR 0018); owned storage objects are
deleted best-effort; the `user_deleted` log line carries no email.
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.core import storage as storage_module
from app.core.config import get_settings
from app.models.models import (
    AuditAction,
    AuditLog,
    Base,
    Playlist,
    SermonComment,
    User,
    UserRole,
)
from app.services import auth_service
from tests.comments_pg import (  # noqa: F401
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    sessions,
)
from tests.conftest import _fake
from tests.kitchen_sink import seed_kitchen_sink_viewer
from tests.test_user_fk_classification import RESTRICT, USER_FKS

BUCKET = get_settings().object_store_media_bucket


class _SpyStorage:
    def __init__(self, inner, *, fail_keys: frozenset[str] = frozenset()):
        self._inner = inner
        self.deleted: list[tuple[str, str]] = []
        self._fail_keys = fail_keys

    def delete_object(self, bucket, key):
        self.deleted.append((bucket, key))
        if key in self._fail_keys:
            raise RuntimeError("storage down")
        self._inner.delete_object(bucket, key)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _install_spy(**kw) -> _SpyStorage:
    spy = _SpyStorage(storage_module.get_storage(), **kw)
    storage_module.set_storage(spy)
    return spy


async def _audit_rows(sessions, **where) -> list[AuditLog]:
    async with sessions() as s:
        q = select(AuditLog)
        for k, v in where.items():
            q = q.where(getattr(AuditLog, k) == v)
        return list((await s.execute(q.order_by(AuditLog.created_at))).scalars().all())


def _delete(pg_client, uid, headers):
    return pg_client.delete(f"/api/v1/users/{uid}", headers=headers)


async def test_admin_deletes_kitchen_sink_viewer_and_pseudonymizes_audit(
    pg_client, sessions, make_user, published_sermon
):
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    _install_spy()

    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text

    models = {t.name: t for t in Base.metadata.sorted_tables}
    async with sessions() as s:
        assert await s.get(User, ks.user_id) is None
        # CASCADE rows are gone.
        for (table, column), action in USER_FKS.items():
            if action != "CASCADE":
                continue
            t = models[table]
            n = (await s.execute(
                select(func.count()).select_from(t).where(t.c[column] == ks.user_id)
            )).scalar_one()
            assert n == 0, f"{table}.{column} still references the deleted user"
        # SET NULL rows survive, detached from the user.
        survivor = await s.get(SermonComment, ks.other_comment_id)
        assert survivor is not None and survivor.hidden_by_id is None
        for table, column in (("verses", "created_by"), ("comment_moderation_log", "actor_id")):
            t = models[table]
            assert (await s.execute(
                select(func.count()).select_from(t).where(t.c[column] == ks.user_id)
            )).scalar_one() == 0
            assert (await s.execute(
                select(func.count()).select_from(t)
            )).scalar_one() >= 1
        assert await s.get(User, ks.other_id) is not None

    # Prior audit rows: still there, emails gone.
    async with sessions() as s:
        for rid in ks.prior_audit_ids:
            row = await s.get(AuditLog, rid)
            assert row is not None
            assert row.actor_email is None and row.target_label is None

    # The new row names the user by id only; the admin actor stays accountable.
    new = [
        r_ for r_ in await _audit_rows(sessions, target_id=ks.user_id)
        if r_.id not in ks.prior_audit_ids
    ]
    assert len(new) == 1
    row = new[0]
    assert row.action == AuditAction.USER_DELETED
    assert row.target_label is None
    assert row.actor_id == admin.id and row.actor_email == admin.email
    assert row.details == {"role": "viewer"}
    assert ks.email not in repr(
        {c.name: getattr(row, c.name) for c in AuditLog.__table__.columns}
    )


async def test_admin_deleting_staff_keeps_audit_emails(
    pg_client, sessions, make_user
):
    admin = await make_user(role="admin")
    ed = await make_user(role="editor", active=False)
    async with sessions() as s:
        prior = AuditLog(
            action=AuditAction.USER_DELETED, outcome="success",
            actor_id=ed.id, actor_email=ed.email, actor_role="editor",
            target_type="user", target_id=ed.id, target_label=ed.email, details={},
        )
        s.add(prior)
        await s.commit()
        prior_id = prior.id

    r = await _delete(pg_client, ed.id, admin.headers)
    assert r.status_code == 204, r.text

    async with sessions() as s:
        kept = await s.get(AuditLog, prior_id)
    assert kept.actor_email == ed.email and kept.target_label == ed.email
    new = [r_ for r_ in await _audit_rows(sessions, target_id=ed.id) if r_.id != prior_id]
    assert len(new) == 1 and new[0].target_label == ed.email


async def test_storage_deletes_avatar_and_every_cover_key(
    pg_client, sessions, make_user, published_sermon
):
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    spy = _install_spy()

    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text
    # The third playlist has a NULL cover and must be skipped, not deleted as "None".
    assert sorted(spy.deleted) == sorted(
        (BUCKET, k) for k in [ks.avatar_key, *ks.cover_keys]
    )


async def test_null_avatar_and_no_playlists_delete_nothing(
    pg_client, sessions, make_user
):
    admin = await make_user(role="admin")
    viewer = await make_user(role="viewer", active=False)
    spy = _install_spy()

    r = await _delete(pg_client, viewer.id, admin.headers)
    assert r.status_code == 204, r.text
    assert spy.deleted == []


async def test_storage_failure_logs_orphaned_object_and_still_succeeds(
    pg_client, sessions, make_user, published_sermon, capture_logs
):
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    spy = _install_spy(fail_keys=frozenset({ks.cover_keys[0]}))

    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text
    # The failing key did not stop the remaining deletes.
    assert len(spy.deleted) == 3
    orphans = [e for e in capture_logs.records if e["event"] == "orphaned_object"]
    assert [e["key"] for e in orphans] == [ks.cover_keys[0]]
    assert ks.email not in capture_logs.text()
    async with sessions() as s:
        assert await s.get(User, ks.user_id) is None


async def test_object_missing_from_store_is_not_an_error(
    pg_client, sessions, make_user, published_sermon
):
    """The seeded keys were never uploaded; LocalStorage treats the delete as
    a no-op, as S3 does for an absent key."""
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text


async def test_storage_sweeps_replaced_and_unconfirmed_uploads(
    pg_client, sessions, make_user, published_sermon
):
    """Erasure covers every object under the account's own prefixes (an avatar
    replaced earlier, a cover upload never confirmed), not only the keys the
    rows point at, and leaves another account's objects alone."""
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    async with sessions() as s:
        playlist_ids = (await s.execute(
            select(Playlist.id).where(Playlist.user_id == ks.user_id)
        )).scalars().all()
    stale = [
        storage_module.avatar_key(ks.user_id, "old.jpg"),
        storage_module.playlist_cover_key(playlist_ids[0], "unconfirmed.jpg"),
    ]
    survivor = storage_module.avatar_key(ks.other_id, "theirs.jpg")
    store = storage_module.get_storage()
    for key in [*stale, survivor]:
        store.put_object(BUCKET, key, b"img", "image/jpeg")
    spy = _install_spy()

    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text
    assert sorted(spy.deleted) == sorted(
        (BUCKET, k) for k in [ks.avatar_key, *ks.cover_keys, *stale]
    )
    assert store.object_exists(BUCKET, survivor)
    assert not any(store.object_exists(BUCKET, k) for k in stale)


async def test_unlistable_prefix_logs_and_still_deletes_known_keys(
    pg_client, sessions, make_user, published_sermon, capture_logs
):
    admin = await make_user(role="admin")
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon)
    spy = _install_spy()

    def _list_fails(bucket, prefix):
        raise RuntimeError("list down")

    spy.list_keys = _list_fails
    r = await _delete(pg_client, ks.user_id, admin.headers)
    assert r.status_code == 204, r.text
    assert sorted(spy.deleted) == sorted(
        (BUCKET, k) for k in [ks.avatar_key, *ks.cover_keys]
    )
    prefixes = [e["prefix"] for e in capture_logs.records if e["event"] == "orphaned_prefix"]
    assert f"avatars/{ks.user_id}/" in prefixes and len(prefixes) == 4  # avatar + 3 playlists
    assert ks.email not in capture_logs.text()


async def test_revocation_deferred_when_token_store_down(
    pg_client, sessions, make_user, capture_logs
):
    admin = await make_user(role="admin")
    viewer = await make_user(role="viewer", active=False)
    async with sessions() as s:
        actor = await s.get(User, admin.id)
        with _fake.failing():
            deferred = await auth_service.delete_user(s, viewer.id, actor)
    assert deferred is True
    async with sessions() as s:
        assert await s.get(User, viewer.id) is None


async def test_user_deleted_log_carries_no_email(
    pg_client, sessions, make_user, capture_logs
):
    admin = await make_user(role="admin")
    viewer = await make_user(role="viewer", active=False)

    r = await _delete(pg_client, viewer.id, admin.headers)
    assert r.status_code == 204, r.text

    events = [e for e in capture_logs.records if e["event"] == "user_deleted"]
    assert len(events) == 1
    assert events[0]["user_id"] == str(viewer.id)
    assert "email" not in events[0]
    assert viewer.email not in capture_logs.text()


async def test_erase_refused_paths_unchanged(pg_client, sessions, make_user):
    """Active target -> 409; unknown -> 404 (preconditions stay in delete_user)."""
    admin = await make_user(role="admin")
    viewer = await make_user(role="viewer", active=True)
    r = await _delete(pg_client, viewer.id, admin.headers)
    assert r.status_code == 409
    r = await _delete(pg_client, uuid.uuid4(), admin.headers)
    assert r.status_code == 404
