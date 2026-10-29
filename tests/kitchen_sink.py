"""Kitchen-sink viewer: one account with at least one row in every table that
references `users` without RESTRICT, plus prior audit rows that name it.

Shared by the erasure tests (admin delete now, self-service delete in D9) so
both prove the same thing: every linked row goes, nothing email-bearing stays.
`tests/test_user_fk_classification.py` fails when a new `users` FK appears
that this fixture does not know about.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select

from app.models.models import (
    AuditAction,
    AuditLog,
    AuditOutcome,
    AuthProvider,
    CommentReportReason,
    ModerationAction,
    Playlist,
    PlaylistItem,
    PlaybackSession,
    ListenerDay,
    Series,
    SeriesLike,
    SermonComment,
    SermonCommentReport,
    SermonLike,
    Subscription,
    UserBlock,
    UserIdentity,
    Verse,
    CommentModerationLog,
)

AVATAR_KEY_FMT = "avatars/{uid}/avatar.png"
COVER_KEY_FMT = "playlist-covers/{uid}/{n}.png"


@dataclass
class KitchenSink:
    user_id: uuid.UUID
    email: str
    avatar_key: str
    cover_keys: list[str]
    other_id: uuid.UUID  # a second viewer, who must survive
    other_comment_id: uuid.UUID
    sermon_id: str
    prior_audit_ids: list[uuid.UUID] = field(default_factory=list)


async def seed_kitchen_sink_viewer(
    sessions, make_user, published_sermon, *, active: bool = False
) -> KitchenSink:
    editor = await make_user(role="editor", full_name="Sink Editor")
    sermon_id = await published_sermon(owner=editor)
    sermon_uuid = uuid.UUID(sermon_id)
    viewer = await make_user(role="viewer", full_name="Sink Viewer", active=active)
    other = await make_user(role="viewer", full_name="Other Viewer")
    uid = viewer.id

    avatar_key = AVATAR_KEY_FMT.format(uid=uid)
    cover_keys = [COVER_KEY_FMT.format(uid=uid, n=1), COVER_KEY_FMT.format(uid=uid, n=2)]

    async with sessions() as s:
        from app.models.models import User

        (await s.get(User, uid)).avatar_key = avatar_key

        s.add_all([
            UserIdentity(user_id=uid, provider=AuthProvider.GOOGLE, provider_subject=f"g-{uid}"),
            UserIdentity(user_id=uid, provider=AuthProvider.APPLE, provider_subject=f"a-{uid}"),
            Subscription(user_id=uid),
            SermonLike(user_id=uid, sermon_id=sermon_uuid),
            PlaybackSession(user_id=uid, sermon_id=sermon_uuid),
            ListenerDay(day=date(2026, 1, 1), user_id=uid),
            UserBlock(blocker_id=uid, blocked_id=other.id),
            UserBlock(blocker_id=other.id, blocked_id=uid),
            Verse(reference="John 3:16", text="For God so loved the world", created_by=uid),
        ])
        series = Series(title="Sink Series", created_by=editor.id)
        s.add(series)
        await s.flush()
        s.add(SeriesLike(user_id=uid, series_id=series.id))

        # Three playlists: cover 1, cover 2 and one with no cover (NULL key).
        pl_a = Playlist(user_id=uid, name="A", cover_key=cover_keys[0])
        pl_b = Playlist(user_id=uid, name="B", cover_key=cover_keys[1])
        pl_c = Playlist(user_id=uid, name="C", cover_key=None)
        s.add_all([pl_a, pl_b, pl_c])
        await s.flush()
        s.add(PlaylistItem(playlist_id=pl_a.id, sermon_id=sermon_uuid, position=0))

        own_comment = SermonComment(sermon_id=sermon_uuid, user_id=uid, body="mine")
        others_comment = SermonComment(
            sermon_id=sermon_uuid, user_id=other.id, body="theirs", hidden_by_id=uid
        )
        s.add_all([own_comment, others_comment])
        await s.flush()
        s.add_all([
            SermonCommentReport(
                comment_id=others_comment.id, reporter_id=uid,
                reason=CommentReportReason.SPAM,
            ),
            CommentModerationLog(
                comment_id=own_comment.id, actor_id=uid, action=ModerationAction.HIDE, reason="sink",
                sermon_id=sermon_uuid, author_id=uid,
            ),
        ])

        prior = [
            AuditLog(
                action=AuditAction.USER_DELETED, outcome=AuditOutcome.SUCCESS,
                actor_id=uid, actor_email=viewer.email, actor_role="viewer",
                details={},
            ),
            AuditLog(
                action=AuditAction.USER_DELETED, outcome=AuditOutcome.SUCCESS,
                target_type="user", target_id=uid, target_label=viewer.email,
                details={},
            ),
        ]
        s.add_all(prior)
        await s.commit()
        prior_ids = [r.id for r in prior]
        other_comment_id = others_comment.id

    return KitchenSink(
        user_id=uid, email=viewer.email, avatar_key=avatar_key, cover_keys=cover_keys,
        other_id=other.id, other_comment_id=other_comment_id, sermon_id=sermon_id,
        prior_audit_ids=prior_ids,
    )
