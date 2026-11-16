"""Request/response models for the daily devotional (plans/plan-daily-devotional.md).

Kept out of `content_schemas.py` (already the largest module in the package)
because nothing else shares these shapes.
"""
from __future__ import annotations

import uuid
from datetime import date as Day, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.models import DevotionalStatus, ReadingFallback

FallbackMode = Literal["text", "tts"]
DisplayStatus = Literal[
    "draft", "pending_review", "rejected", "archived", "scheduled", "published", "evergreen"
]


# ── Public ────────────────────────────────────────────────────────────────────
class DevotionalAuthor(BaseModel):
    id: uuid.UUID
    name: str


class DevotionalStill(BaseModel):
    breath_in: str | None
    breath_out: str | None
    seconds: int


class DevotionalVerse(BaseModel):
    number: int | None
    text: str


class DevotionalPassage(BaseModel):
    ref: str
    translation: str
    text: str
    verses: list[DevotionalVerse]


class DevotionalReading(BaseModel):
    url: str
    duration_s: int | None


class DevotionalTts(BaseModel):
    voice: str | None
    rate: float


class DevotionalMoment(BaseModel):
    sermon_id: uuid.UUID
    title: str
    cover_url: str | None
    start_s: int
    end_s: int


class DevotionalPray(BaseModel):
    question: str
    text: str


class DevotionalPublic(BaseModel):
    id: uuid.UUID
    date: Day
    source: Literal["dated", "evergreen"]
    title: str
    author: DevotionalAuthor | None
    still: DevotionalStill
    passage: DevotionalPassage
    suggested_word: str | None
    reading: DevotionalReading | None
    # Resolved: what the Hear step does when `reading` is null. Always "text"
    # when a reading exists (the app then never needs TTS).
    reading_fallback: FallbackMode
    tts: DevotionalTts | None
    reflection_md: str
    moment: DevotionalMoment | None
    pray: DevotionalPray
    carry_verse_ref: str
    publish_hour: int


# ── Staff ─────────────────────────────────────────────────────────────────────
class _DevotionalFields(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    date: Day | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    author_speaker_id: uuid.UUID | None = None
    still_breath_in: str | None = Field(default=None, max_length=80)
    still_breath_out: str | None = Field(default=None, max_length=80)
    still_seconds: int | None = Field(default=None, ge=10, le=600)
    passage_ref: str | None = Field(default=None, min_length=1, max_length=100)
    passage_translation: str | None = Field(default=None, min_length=1, max_length=20)
    passage_text: str | None = Field(default=None, min_length=1, max_length=20000)
    suggested_word: str | None = Field(default=None, max_length=40)
    reading_fallback: ReadingFallback | None = None
    reflection_md: str | None = Field(default=None, min_length=1, max_length=20000)
    moment_sermon_id: uuid.UUID | None = None
    moment_start_s: int | None = Field(default=None, ge=0)
    moment_end_s: int | None = Field(default=None, ge=1)
    pray_question: str | None = Field(default=None, min_length=1, max_length=300)
    pray_text: str | None = Field(default=None, min_length=1, max_length=5000)
    carry_verse_ref: str | None = Field(default=None, max_length=100)

    @field_validator("suggested_word")
    @classmethod
    def _one_word(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if any(ch.isspace() for ch in value):
            raise ValueError("suggested_word must be a single word")
        return value


class DevotionalCreate(_DevotionalFields):
    """A new draft. `date` null = the evergreen pool."""

    title: str = Field(min_length=1, max_length=200)
    passage_ref: str = Field(min_length=1, max_length=100)
    passage_translation: str = Field(min_length=1, max_length=20)
    passage_text: str = Field(min_length=1, max_length=20000)
    reflection_md: str = Field(min_length=1, max_length=20000)
    pray_question: str = Field(min_length=1, max_length=300)
    pray_text: str = Field(min_length=1, max_length=5000)


class DevotionalUpdate(_DevotionalFields):
    """Partial update; send `date: null` to move a devotional to the evergreen pool."""

    @model_validator(mode="after")
    def _required_stay_set(self) -> DevotionalUpdate:
        required = (
            "title", "passage_ref", "passage_translation", "passage_text",
            "reflection_md", "pray_question", "pray_text",
        )
        for name in required:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be cleared")
        return self


class DevotionalAdminItem(BaseModel):
    id: uuid.UUID
    date: Day | None
    is_evergreen: bool
    title: str
    status: DevotionalStatus
    display_status: DisplayStatus
    author_speaker_id: uuid.UUID | None
    author_name: str | None
    still_breath_in: str | None
    still_breath_out: str | None
    still_seconds: int | None
    passage_ref: str
    passage_translation: str
    passage_text: str
    suggested_word: str | None
    reading_url: str | None
    reading_duration_s: int | None
    reading_fallback: ReadingFallback | None
    reflection_md: str
    moment_sermon_id: uuid.UUID | None
    moment_sermon_title: str | None
    moment_start_s: int | None
    moment_end_s: int | None
    pray_question: str
    pray_text: str
    carry_verse_ref: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime | None


class DevotionalListItem(BaseModel):
    id: uuid.UUID
    date: Day | None
    is_evergreen: bool
    title: str
    status: DevotionalStatus
    display_status: DisplayStatus
    passage_ref: str
    has_reading: bool
    created_by: uuid.UUID
    updated_at: datetime | None


class DevotionalCalendarDay(BaseModel):
    date: Day
    devotional: DevotionalListItem | None


class DevotionalCalendar(BaseModel):
    days: list[DevotionalCalendarDay]
    # Consecutive days from today (UTC) that already have an approved devotional.
    ready_days_ahead: int
    gap_alert_days: int
    evergreen_ready: int


class DevotionalStatusResponse(BaseModel):
    id: uuid.UUID
    status: DevotionalStatus


class DevotionalRejectRequest(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class DevotionalApprovalLogItem(BaseModel):
    from_status: str | None
    to_status: str
    actor_id: uuid.UUID
    actor_name: str | None
    note: str | None
    created_at: datetime


class ReadingUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)


class ReadingTicket(BaseModel):
    upload_url: str
    headers: dict[str, str]
    expires_in: int
    reading_key: str


class ReadingConfirm(BaseModel):
    reading_key: str = Field(min_length=1, max_length=512)
    duration_s: int | None = Field(default=None, ge=1, le=3600)


class PassageLookup(BaseModel):
    ref: str
    translation: str
    text: str


# ── Import ────────────────────────────────────────────────────────────────────
class ImportRowResult(BaseModel):
    row: int  # 1-based data row (the header is row 0)
    date: Day | None
    title: str | None
    passage_ref: str | None
    suggested_word: str | None
    status: Literal["ready", "warning", "error", "clash"]
    messages: list[str]
    clash_with: str | None = None


class ImportResult(BaseModel):
    dry_run: bool
    rows: list[ImportRowResult]
    ready: int
    warnings: int
    errors: int
    clashes: int
    created: int = 0
    replaced: int = 0
    pooled: int = 0
    skipped: int = 0


# ── Settings ──────────────────────────────────────────────────────────────────
class DevotionalSettings(BaseModel):
    reading_fallback: FallbackMode
    allow_override: bool
    tts_voice: str | None
    tts_rate_pct: int
    publish_hour: int
    gap_alert_days: int
    still_seconds: int
    default_translation: str
    version: int


class DevotionalSettingsUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    version: int
    reading_fallback: FallbackMode | None = None
    allow_override: bool | None = None
    tts_voice: str | None = Field(default=None, max_length=60)
    tts_rate_pct: int | None = Field(default=None, ge=50, le=150)
    publish_hour: int | None = Field(default=None, ge=0, le=23)
    gap_alert_days: int | None = Field(default=None, ge=1, le=90)
    still_seconds: int | None = Field(default=None, ge=10, le=600)
    default_translation: str | None = Field(default=None, min_length=1, max_length=20)
