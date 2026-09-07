"""Approval state machine for sermons and series.

Kept separate from the ORM models so the allowed transitions live in one place
and can be reasoned about (and tested) on their own.

    draft ─submit→ pending_review ─start_review→ under_review ─approve→ approved
      ↑                                              │                    │
      └────────────── reject ──────────────────────-┘                 publish
                                                                          │
                                        unpublish ← published ←──────────-┘
"""
from __future__ import annotations

from app.models.models import SermonStatus, UserRole
from app.models.models import AnnouncementStatus

# action -> (allowed_from_statuses, resulting_status, roles_permitted)
TRANSITIONS: dict[str, tuple[tuple[SermonStatus, ...], SermonStatus, tuple[UserRole, ...]]] = {
    "submit": (
        (SermonStatus.DRAFT, SermonStatus.REJECTED),
        SermonStatus.PENDING_REVIEW,
        (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN),
    ),
    "start_review": (
        (SermonStatus.PENDING_REVIEW,),
        SermonStatus.UNDER_REVIEW,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "approve": (
        (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW),
        SermonStatus.APPROVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "reject": (
        (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW),
        SermonStatus.REJECTED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "publish": (
        (SermonStatus.APPROVED, SermonStatus.UNPUBLISHED),
        SermonStatus.PUBLISHED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "unpublish": (
        (SermonStatus.PUBLISHED,),
        SermonStatus.UNPUBLISHED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
}

ANNOUNCEMENT_TRANSITIONS: dict[
    str, tuple[tuple[AnnouncementStatus, ...], AnnouncementStatus, tuple[UserRole, ...]]
] = {
    "submit": (
        (AnnouncementStatus.DRAFT, AnnouncementStatus.REJECTED),
        AnnouncementStatus.PENDING_REVIEW,
        (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN),
    ),
    "approve": (
        (AnnouncementStatus.PENDING_REVIEW,),
        AnnouncementStatus.APPROVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "reject": (
        (AnnouncementStatus.PENDING_REVIEW,),
        AnnouncementStatus.REJECTED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "publish": (
        (AnnouncementStatus.APPROVED, AnnouncementStatus.ARCHIVED),
        AnnouncementStatus.PUBLISHED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "unpublish": (
        (AnnouncementStatus.PUBLISHED,),
        AnnouncementStatus.APPROVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "archive": (
        (AnnouncementStatus.PUBLISHED, AnnouncementStatus.APPROVED),
        AnnouncementStatus.ARCHIVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
}


class TransitionError(Exception):
    """Raised when a transition is not allowed from the current state."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def resolve_transition(
    action: str, current: SermonStatus, role: UserRole
) -> SermonStatus:
    """Validate a transition and return the resulting status.

    Raises TransitionError if the action is unknown, illegal from the current
    state, or not permitted for the role.
    """
    spec = TRANSITIONS.get(action)
    if spec is None:
        raise TransitionError(f"Unknown action '{action}'")

    allowed_from, to_status, roles = spec
    if role not in roles:
        raise TransitionError(f"Role '{role.value}' may not perform '{action}'")
    if current not in allowed_from:
        raise TransitionError(
            f"Cannot '{action}' a sermon in status '{current.value}'"
        )
    return to_status


def resolve_announcement_transition(
    action: str, current: AnnouncementStatus, role: UserRole
) -> AnnouncementStatus:
    """Validate an announcement transition and return the resulting status."""
    spec = ANNOUNCEMENT_TRANSITIONS.get(action)
    if spec is None:
        raise TransitionError(f"Unknown action '{action}'")

    allowed_from, to_status, roles = spec
    if role not in roles:
        raise TransitionError(f"Role '{role.value}' may not perform '{action}'")
    if current not in allowed_from:
        raise TransitionError(
            f"Cannot '{action}' an announcement in status '{current.value}'"
        )
    return to_status