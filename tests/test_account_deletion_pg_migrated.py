"""D9: a full self-service erasure of the kitchen-sink viewer on the
alembic-migrated Postgres (`pg_engine` is built from `pg_migrated_db`), so the
real `ON DELETE` rules run rather than `create_all`'s."""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.core import email as email_module
from app.core import security
from app.core import storage as storage_module
from app.core.apple_revocation import StubAppleRevocationClient, set_apple_revocation_client
from app.core.config import get_settings
from app.models.models import AuditAction, AuditLog, Base, SermonComment, User
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
from tests.kitchen_sink import seed_kitchen_sink_viewer
from tests.test_oauth import (  # noqa: F401
    _apple_claims,
    _mint,
    _rsa_key,
    _wire_static_jwks,
)
from tests.test_user_fk_classification import USER_FKS

pytestmark = pytest.mark.asyncio
BUCKET = get_settings().object_store_media_bucket


class _Spy:
    def __init__(self, inner):
        self._inner = inner
        self.deleted: list[tuple[str, str]] = []

    def delete_object(self, bucket, key):
        self.deleted.append((bucket, key))
        self._inner.delete_object(bucket, key)

    def __getattr__(self, n):
        return getattr(self._inner, n)


async def test_self_service_full_erasure_on_migrated_schema(
    pg_client, sessions, make_user, published_sermon, _rsa_key, capture_logs, monkeypatch
):
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon, active=True)

    async def _no_mail(to: str) -> None:  # the dev console sender logs the recipient
        pass

    monkeypatch.setattr(email_module, "send_account_deleted", _no_mail)
    stub = StubAppleRevocationClient()
    set_apple_revocation_client(stub)
    inner = storage_module.get_storage()
    spy = _Spy(inner)
    storage_module.set_storage(spy)
    try:
        token = _mint(_rsa_key, _apple_claims(f"a-{ks.user_id}", "nonce-1"))
        headers = {"Authorization": "Bearer " + security.create_access_token(
            str(ks.user_id), "viewer")}
        r = await pg_client.post(
            "/api/v1/auth/me/delete",
            json={"method": "apple", "identity_token": token, "raw_nonce": "nonce-1",
                  "authorization_code": "code-1"},
            headers=headers,
        )
    finally:
        set_apple_revocation_client(None)
        storage_module.set_storage(inner)
    assert r.status_code == 204, r.text
    assert stub.calls == ["code-1"]

    models = {t.name: t for t in Base.metadata.sorted_tables}
    async with sessions() as s:
        assert await s.get(User, ks.user_id) is None
        for (table, column), action in USER_FKS.items():
            if action != "CASCADE":
                continue
            t = models[table]
            n = (await s.execute(
                select(func.count()).select_from(t).where(t.c[column] == ks.user_id)
            )).scalar_one()
            assert n == 0, f"{table}.{column} still references the deleted user"
        survivor = await s.get(SermonComment, ks.other_comment_id)
        assert survivor is not None and survivor.hidden_by_id is None
        assert await s.get(User, ks.other_id) is not None

        # Prior audit rows survive without the email; the new row has none either.
        for rid in ks.prior_audit_ids:
            row = await s.get(AuditLog, rid)
            assert row.actor_email is None and row.target_label is None
        rows = (await s.execute(
            select(AuditLog).where(
                AuditLog.target_id == ks.user_id,
                AuditLog.id.not_in(ks.prior_audit_ids),
            )
        )).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.action == AuditAction.USER_DELETED
    assert row.actor_id == row.target_id == ks.user_id
    assert row.actor_email is None and row.target_label is None
    assert row.details == {
        "role": "viewer", "self_service": True,
        "providers": ["apple", "google"], "apple_revoked": True,
    }
    assert ks.email not in repr({c.name: getattr(row, c.name) for c in AuditLog.__table__.columns})
    assert ks.email not in capture_logs.text()

    assert sorted(spy.deleted) == sorted((BUCKET, k) for k in [ks.avatar_key, *ks.cover_keys])
