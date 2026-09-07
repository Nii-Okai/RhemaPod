"""Unit tests for the approval state machine — pure logic, no DB."""
import pytest

from app.models.models import SermonStatus, UserRole
from app.services.approval import TransitionError, resolve_transition


def test_editor_can_submit_draft():
    assert resolve_transition("submit", SermonStatus.DRAFT, UserRole.EDITOR) == (
        SermonStatus.PENDING_REVIEW
    )


def test_editor_cannot_approve():
    with pytest.raises(TransitionError):
        resolve_transition("approve", SermonStatus.PENDING_REVIEW, UserRole.EDITOR)


def test_manager_can_approve_pending():
    assert resolve_transition(
        "approve", SermonStatus.PENDING_REVIEW, UserRole.MANAGER
    ) == SermonStatus.APPROVED


def test_cannot_publish_a_draft():
    with pytest.raises(TransitionError):
        resolve_transition("publish", SermonStatus.DRAFT, UserRole.MANAGER)


def test_publish_then_unpublish():
    assert resolve_transition(
        "publish", SermonStatus.APPROVED, UserRole.ADMIN
    ) == SermonStatus.PUBLISHED
    assert resolve_transition(
        "unpublish", SermonStatus.PUBLISHED, UserRole.ADMIN
    ) == SermonStatus.UNPUBLISHED


def test_rejected_can_be_resubmitted():
    assert resolve_transition(
        "submit", SermonStatus.REJECTED, UserRole.EDITOR
    ) == SermonStatus.PENDING_REVIEW


def test_unknown_action():
    with pytest.raises(TransitionError):
        resolve_transition("frobnicate", SermonStatus.DRAFT, UserRole.ADMIN)
