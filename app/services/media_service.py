"""Media upload, processing, and streaming.

Flow
----
1. Editor requests an upload ticket  -> pre-signed PUT URL, UploadJob created
2. Client PUTs the file straight to object storage (never through this API)
3. Client confirms  -> job marked UPLOADED, transcode kicked off
4. Transcode writes renditions and creates MediaRef rows -> job READY
5. Viewer requests a stream URL -> entitlement checked, signed URLs returned

The transcoder is pluggable. `transcode_inline=True` (default in dev/test) runs
a stub that records renditions without invoking FFmpeg. Production swaps in a
background worker; nothing else in the app changes.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import storage as storage_module
from app.core import stream as stream_module
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.core.storage import StorageError
from app.core.stream import StreamError
from app.models.content_schemas import (
    AudioDownloadResponse,
    StreamResponse,
    StreamVariant,
    UploadTicket,
)
from app.models.models import (
    ContentTier,
    MediaRef,
    MediaType,
    ProcessedWebhook,
    Series,
    Sermon,
    SermonStatus,
    UploadJob,
    UploadStatus,
    User,
    UserRole,
)
from app.services.content_service import (
    ContentError,
    effective_tier,
    ensure_editor_can_access,
    sermon_publish_time_passed,
    staff_scope_hides,
)

settings = get_settings()
log = get_logger("media")

# Renditions produced per media type. Historically the streaming layer capped
# free-tier viewers at 480p (FREE_TIER_MAX_QUALITY); deleted in W1.5 (plan
# L10) — moot once Cloudflare Stream owns the rendition ladder, since Stream
# serves one adaptive manifest per video, not discrete quality-tier files.
VIDEO_QUALITIES = ("1080p", "720p", "480p")
AUDIO_QUALITIES = ("128k",)

ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska", "video/webm"}
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav"}


# ── Upload ────────────────────────────────────────────────────────────────────
async def _load_sermon_for_editor(
    db: AsyncSession, sermon_id: uuid.UUID, actor: User
) -> Sermon:
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    ensure_editor_can_access(sermon, actor, action="upload to")
    # Uploading to live content would swap the file under viewers mid-playback.
    if sermon.status == SermonStatus.PUBLISHED:
        raise ContentError(
            "Unpublish the sermon before replacing its media", status_code=409
        )
    return sermon


def _validate_content_type(media_type: MediaType, content_type: str) -> None:
    allowed = ALLOWED_VIDEO_TYPES if media_type == MediaType.VIDEO else ALLOWED_AUDIO_TYPES
    if content_type.lower() not in allowed:
        raise ContentError(
            f"Unsupported {media_type.value} content type '{content_type}'",
            status_code=400,
        )


async def create_upload_ticket(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    actor: User,
    filename: str,
    content_type: str,
    media_type: MediaType,
    size_bytes: int | None,
) -> UploadTicket:
    sermon = await _load_sermon_for_editor(db, sermon_id, actor)
    _validate_content_type(media_type, content_type)

    # Cap concurrent open jobs for this sermon. Retry-spam otherwise mints
    # unbounded awaiting_upload rows and orphan raw-bucket objects — the BFF
    # hides the client IP, so the global per-IP limiter never sees it (CWE-770).
    #
    # This is a count-then-insert: a spam bound, not an invariant. Two
    # concurrent tickets can both pass the check at 4 and land the sermon at 6.
    # Acceptable — the point is to stop unbounded retry loops, not to enforce
    # an exact ceiling, and DELETE / the stale-job sweep drain the overshoot.
    open_states = (
        UploadStatus.AWAITING_UPLOAD,
        UploadStatus.UPLOADED,
        UploadStatus.PROCESSING,
    )
    open_count = (await db.execute(
        select(func.count())
        .select_from(UploadJob)
        .where(UploadJob.sermon_id == sermon.id, UploadJob.status.in_(open_states))
    )).scalar_one()
    if open_count >= settings.max_open_upload_jobs_per_sermon:
        raise ContentError(
            "Too many uploads in progress for this sermon — finish or cancel "
            "one first.",
            status_code=429,
            # No window to quote for a state-based cap; a slot frees when an
            # upload completes or is cancelled. 60s is a sane "come back soon".
            headers={"Retry-After": "60"},
        )

    # Light retry rate-limit on top of the hard cap. Redis fixed-window, fails
    # open: a Redis outage falls back to the per-sermon cap above, which is the
    # real ceiling.
    if not await check_rate_limit(
        f"upload_ticket:{sermon.id}",
        settings.upload_ticket_rate_limit,
        settings.upload_ticket_rate_window_seconds,
    ):
        raise ContentError(
            "Too many upload attempts for this sermon — wait a moment and try "
            "again.",
            status_code=429,
            headers={
                "Retry-After": str(settings.upload_ticket_rate_window_seconds)
            },
        )

    if size_bytes is not None and size_bytes > settings.max_upload_bytes:
        raise ContentError(
            f"File exceeds the maximum upload size of "
            f"{settings.max_upload_bytes // (1024 ** 3)} GB",
            status_code=413,
        )

    key = storage_module.raw_key(sermon.id, filename)
    store = storage_module.get_storage()
    url = store.presigned_upload_url(
        settings.object_store_raw_bucket, key, content_type, settings.upload_url_expire_seconds
    )

    job = UploadJob(
        sermon_id=sermon.id,
        raw_key=key,
        original_filename=filename,
        content_type=content_type,
        size_bytes=size_bytes,
        media_type=media_type,
        status=UploadStatus.AWAITING_UPLOAD,
        created_by=actor.id,
    )

    db.add(job)
    await db.commit()
    await db.refresh(job)

    log.info("upload_ticket_issued", job_id=str(job.id), sermon_id=str(sermon.id))

    return UploadTicket(
        job_id=job.id,
        upload_url=url,
        headers={"Content-Type": content_type},
        expires_in=settings.upload_url_expire_seconds,
        raw_key=key,
    )


async def confirm_upload(
    db: AsyncSession,
    job_id: uuid.UUID,
    actor: User,
    duration_seconds: int | None = None,
) -> UploadJob:
    """Client calls this after the PUT succeeds. Verifies the object really
    landed, then processes it."""
    job = await db.get(UploadJob, job_id)
    if job is None:
        raise ContentError("Upload job not found", status_code=404)
    if actor.role == UserRole.EDITOR and job.created_by != actor.id:
        raise ContentError("Not your upload", status_code=403)
    if job.status not in (UploadStatus.AWAITING_UPLOAD, UploadStatus.FAILED):
        raise ContentError(
            f"Upload is already '{job.status.value}'", status_code=409
        )

    store = storage_module.get_storage()
    # Trust but verify: never mark an upload complete on the client's word alone.
    if not store.object_exists(settings.object_store_raw_bucket, job.raw_key):
        raise ContentError(
            "No uploaded file found for this job — complete the PUT first",
            status_code=409,
        )

    # The declared `size_bytes` at presign time is advisory — nothing binds it
    # to the PUT. Enforce the cap here against the bytes that actually landed,
    # and record the observed size (overriding the client's figure). Over the
    # cap: delete the object so a rejected upload leaves nothing behind, and
    # 413 exactly as the presign path would have.
    observed_size = store.object_size(settings.object_store_raw_bucket, job.raw_key)
    if observed_size is not None:
        if observed_size > settings.max_upload_bytes:
            try:
                store.delete_object(settings.object_store_raw_bucket, job.raw_key)
            except Exception:  # noqa: BLE001 - best-effort cleanup, still reject
                log.warning(
                    "oversize_upload_cleanup_failed",
                    job_id=str(job.id), key=job.raw_key,
                )
            raise ContentError(
                f"File exceeds the maximum upload size of "
                f"{settings.max_upload_bytes // (1024 ** 3)} GB",
                status_code=413,
            )
        job.size_bytes = observed_size

    job.status = UploadStatus.UPLOADED
    job.error_message = None

    # Duration comes from the client because nothing server-side opens the file
    # in passthrough mode. Only fill a blank — never overwrite a known value
    # with a client-supplied one.
    if duration_seconds is not None:
        sermon = await db.get(Sermon, job.sermon_id)
        if sermon is not None and not sermon.duration_seconds:
            sermon.duration_seconds = duration_seconds

    await db.commit()
    log.info("upload_confirmed", job_id=str(job.id), duration=duration_seconds)

    if settings.transcode_inline:
        await process_upload(db, job.id)
        await db.refresh(job)
        # Hand the raw master to Cloudflare Stream (plan §A.2, W1.3), after
        # the existing pipeline above — never instead of it. Video only:
        # audio renditions are served straight from S3 (W1.6), never through
        # Stream. Best-effort: a Stream outage must not fail the
        # upload-confirm response — sweep_stream_jobs.py retries later.
        if job.status == UploadStatus.READY and job.media_type == MediaType.VIDEO:
            await _start_stream_ingest(db, job)
    return job


# ── Processing ────────────────────────────────────────────────────────────────
async def process_upload(db: AsyncSession, job_id: uuid.UUID) -> UploadJob:
    """Transcode a confirmed upload into renditions and create MediaRef rows.

    Idempotent per job: re-running replaces that job's previous MediaRefs.
    """
    job = await db.get(UploadJob, job_id)
    if job is None:
        raise ContentError("Upload job not found", status_code=404)

    job.status = UploadStatus.PROCESSING
    await db.commit()

    try:
        renditions = await _transcode(job)
    except Exception as exc:  # noqa: BLE001 - surface any transcoder failure
        job.status = UploadStatus.FAILED
        job.error_message = str(exc)[:500]
        await db.commit()
        log.warning("transcode_failed", job_id=str(job.id), error=str(exc))
        return job

    # Replace any renditions from a previous run of this job.
    existing = (await db.execute(
        select(MediaRef).where(
            MediaRef.sermon_id == job.sermon_id, MediaRef.type == job.media_type
        )
    )).scalars().all()
    for ref in existing:
        await db.delete(ref)

    for quality, bucket, key in renditions:
        db.add(MediaRef(
            sermon_id=job.sermon_id,
            type=job.media_type,
            quality=quality,
            bucket=bucket,
            s3_key=key,
            # Only a real HLS transcode produces a manifest; passthrough doesn't.
            hls_manifest_key=key if settings.transcode_enabled else None,
        ))

    job.status = UploadStatus.READY
    job.error_message = None
    await db.commit()
    await db.refresh(job)

    log.info(
        "transcode_complete",
        job_id=str(job.id),
        sermon_id=str(job.sermon_id),
        renditions=len(renditions),
    )
    
    return job


async def _transcode(job: UploadJob) -> list[tuple[str | None, str, str]]:
    """Produce playable renditions, returning (quality, bucket, key) triples.

    PASSTHROUGH MODE (default). No transcoding: the file the editor uploaded is
    served directly. MP4/H.264 plays natively in every browser and mobile
    player, so this gives working playback with no FFmpeg, no worker, and no
    extra storage — at the cost of adaptive bitrate and true HLS seeking.

    When `transcode_enabled` is turned on, replace the body below with an FFmpeg
    invocation that writes an HLS ladder to the media bucket and returns one
    triple per rendition. Nothing else in the app changes.
    """
    if not settings.transcode_enabled:
        # One rendition: the original upload, in the raw bucket.
        return [(None, settings.object_store_raw_bucket, job.raw_key)]

    qualities = (
        VIDEO_QUALITIES if job.media_type == MediaType.VIDEO else AUDIO_QUALITIES
    )
    kind = job.media_type.value
    return [
        (q, settings.object_store_media_bucket, storage_module.media_key(job.sermon_id, kind, q))
        for q in qualities
    ]


async def list_jobs(
    db: AsyncSession, sermon_id: uuid.UUID, actor: User
) -> list[UploadJob]:
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    if actor.role == UserRole.EDITOR and sermon.created_by != actor.id:
        raise ContentError("Not your sermon", status_code=403)

    rows = (await db.execute(
        select(UploadJob)
        .where(UploadJob.sermon_id == sermon_id)
        .order_by(UploadJob.created_at.desc())
    )).scalars().all()
    return list(rows)


# A job is "in flight" while the file is still arriving or being transcoded —
# the states that would show a spinner on the editor Dashboard. READY and
# FAILED are terminal and excluded. Same set the upload-quota check counts.
_IN_FLIGHT_JOB_STATES = (
    UploadStatus.AWAITING_UPLOAD,
    UploadStatus.UPLOADED,
    UploadStatus.PROCESSING,
)


async def list_in_flight_jobs(
    db: AsyncSession, actor: User, limit: int = 50
) -> list[UploadJob]:
    """Every upload job still uploading or processing, across all sermons the
    caller may see: an editor gets jobs on their own sermons only, a
    manager/admin gets all. Newest first.

    Powers the Dashboard's global "processing" WIP card, which is why it spans
    sermons rather than taking a `sermon_id` like `list_jobs`.
    """
    stmt = (
        select(UploadJob)
        .join(Sermon, Sermon.id == UploadJob.sermon_id)
        .where(UploadJob.status.in_(_IN_FLIGHT_JOB_STATES))
    )
    if actor.role == UserRole.EDITOR:
        stmt = stmt.where(Sermon.created_by == actor.id)
    stmt = stmt.order_by(UploadJob.created_at.desc()).limit(
        max(1, min(limit, 200))
    )
    return list((await db.execute(stmt)).scalars().all())


# States a job may be deleted from. `processing` (mid-transcode) and `ready`
# (renditions already produced — manage those via the media endpoints) are not
# here: deleting the row from either would strand work or MediaRefs.
_DELETABLE_JOB_STATES = (
    UploadStatus.AWAITING_UPLOAD,
    UploadStatus.UPLOADED,
    UploadStatus.FAILED,
)


async def delete_upload_job(
    db: AsyncSession, job_id: uuid.UUID, actor: User
) -> None:
    """Cancel a superseded or stalled upload job and best-effort drop its raw
    object.

    Owner-scoped: an editor may only touch a job whose sermon they created —
    another editor's job, or an unknown id, is 404 (existence is not
    disclosed). Manager/admin: any job.

    Refused with 409 unless the job is in awaiting_upload / uploaded / failed;
    a job mid-transcode (`processing`) or already `ready` cannot be deleted
    this way. Storage cleanup is best-effort — the row is gone regardless, and
    a leftover object is a sweep's problem, not a 500.

    Concurrency: the status guard lives IN the DELETE statement
    (``WHERE status IN (...)``), not in a preceding Python check. A transcode
    worker flipping the job awaiting_upload/uploaded → processing/ready between
    a read and the delete would otherwise strand MediaRef rows and unlink a
    raw object a live passthrough MediaRef still points at (CWE-367). With the
    guard in the statement the loser of that race — and the loser of a
    concurrent double-DELETE — simply matches 0 rows and gets a clean 404/409,
    never a StaleDataError 500.
    """
    # Ownership / scope is immutable (a job's sermon.created_by never changes),
    # so this check is not part of the race and is done up front: an unknown
    # id or another editor's job is 404, existence undisclosed.
    job = await db.get(UploadJob, job_id)
    if job is None:
        raise ContentError("Upload job not found", status_code=404)

    sermon = await db.get(Sermon, job.sermon_id)
    if sermon is None or staff_scope_hides(sermon, actor):
        raise ContentError("Upload job not found", status_code=404)

    deleted = (await db.execute(
        delete(UploadJob)
        .where(
            UploadJob.id == job_id,
            UploadJob.status.in_(_DELETABLE_JOB_STATES),
        )
        .returning(UploadJob.raw_key)
        .execution_options(synchronize_session=False)
    )).first()

    if deleted is None:
        # 0 rows: between the read above and here, either a concurrent DELETE
        # removed the row or the transcode worker moved it out of a deletable
        # state. A fresh column-only read (no ORM identity map) answers 404 vs
        # 409. Scope was already checked above and cannot change mid-request,
        # so it is not re-checked here.
        current = (await db.execute(
            select(UploadJob.status).where(UploadJob.id == job_id)
        )).scalar_one_or_none()
        if current is None:
            raise ContentError("Upload job not found", status_code=404)
        detail = f"Cannot delete an upload job that is '{current.value}'"
        if current == UploadStatus.PROCESSING:
            detail += " — it is still transcoding"
        elif current == UploadStatus.READY:
            detail += " — remove its renditions via the media endpoints instead"
        raise ContentError(detail, status_code=409)

    raw_key = deleted[0]
    await db.commit()

    try:
        storage_module.get_storage().delete_object(settings.object_store_raw_bucket, raw_key)
    except Exception:  # noqa: BLE001 - best-effort; row already deleted
        log.warning(
            "upload_job_raw_object_delete_failed",
            job_id=str(job_id), key=raw_key,
        )

    log.info(
        "upload_job_deleted",
        job_id=str(job_id), sermon_id=str(sermon.id), by=str(actor.id),
    )


# ── Streaming ─────────────────────────────────────────────────────────────────
# W1.5 (plan L10): the free-tier rendition-quality cap that used to live here
# is gone. Stream owns the ladder now — it serves one adaptive manifest per
# video, not discrete quality-tier files, so there is nothing left to cap.


def _resolve_variant_url(ref: MediaRef, *, expires_in: int) -> str:
    """The one rule for turning a MediaRef into a playable/downloadable URL,
    shared by get_stream and get_audio_download (W1.6) so both endpoints
    degrade identically.

    If this rendition has gone through Cloudflare Stream ingest
    (`stream_uid` set — video only, today, and only for a passthrough master;
    `_start_stream_ingest` skips the ambiguous multi-rendition-ladder case),
    serve a Stream signed-token playback URL. Otherwise — not yet ingested,
    ingest skipped/still pending, or a type Stream never ingests (audio,
    W1.6) — fall back to the pre-Stream presigned-S3 path unchanged. This is
    what makes the incremental rollout work: nothing needs every sermon
    backfilled before it can be listed (W1.9 does the backfill later).

    A `stream_uid` that IS set but fails to sign (StreamError — today's
    concrete case: CF_STREAM_SIGNING_KEY_ID/_PEM not configured yet, plan
    §A.2's known W1.5 gap) also falls back here rather than 500ing a playback
    request. Logged, not silent: production's preflight requires the signing
    key once Stream is live, so this branch should be unreachable there and
    only a dev/staging convenience in practice.
    """
    if ref.stream_uid:
        try:
            return stream_module.get_provider().signed_playback_url(
                uid=ref.stream_uid, expires_in=expires_in
            )
        except StreamError as exc:
            log.warning(
                "stream_signed_url_failed_falling_back_to_s3",
                media_ref_id=str(ref.id), stream_uid=ref.stream_uid, error=str(exc),
            )

    store = storage_module.get_storage()
    playback_key = ref.hls_manifest_key or ref.s3_key
    presigned = store.presigned_download_url(
        ref.bucket or settings.object_store_media_bucket, playback_key, expires_in
    )
    return storage_module.cdn_url_for(playback_key, presigned_fallback=presigned)


async def _authorize_stream_access(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    user: User | None,
    has_subscription: bool,
) -> tuple[Sermon, bool]:
    """Shared authorization gate for get_stream and get_audio_download
    (W1.6 reuses this rather than reimplementing it, per the plan). Returns
    the sermon (with media_refs eager-loaded) and whether the caller is
    staff. This is where `locked` stops being advisory: a locked sermon
    raises 403 upgrade_required, so the catalog can stay fully browsable.
    """
    sermon = (await db.execute(
        select(Sermon)
        .where(Sermon.id == sermon_id)
        .options(selectinload(Sermon.media_refs))
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)

    is_staff = user is not None and user.role in (
        UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN
    )
    # An editor may preview only their OWN unpublished sermon; a manager/admin
    # any. Without the ownership test, any editor could pull signed playback
    # URLs for another editor's unpublished draft (BOLA). Non-owner editor on
    # an unpublished sermon -> 404, consistent with the staff read.
    hidden_by_scope = user is not None and staff_scope_hides(sermon, user)
    not_yet_visible = (
        sermon.status != SermonStatus.PUBLISHED
        or not sermon_publish_time_passed(sermon)
    )
    if not_yet_visible and (not is_staff or hidden_by_scope):
        raise ContentError("Sermon not found", status_code=404)

    series = await db.get(Series, sermon.series_id) if sermon.series_id else None
    tier = effective_tier(sermon, series)

    if tier == ContentTier.PAID and not has_subscription and not is_staff:
        raise ContentError("upgrade_required", status_code=403)

    return sermon, is_staff


async def get_stream(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    user: User | None,
    has_subscription: bool,
) -> StreamResponse:
    """Return signed playback URLs, enforcing the paid-content gate.

    One variant per MediaRef, unfiltered (see the W1.5 note above) — the
    `url` is Stream-signed or presigned-S3 per `_resolve_variant_url`.
    """
    sermon, _is_staff = await _authorize_stream_access(
        db, sermon_id, user, has_subscription
    )

    if not sermon.media_refs:
        raise ContentError("No playable media for this sermon yet", status_code=409)

    expires_in = settings.stream_url_expire_seconds
    variants = [
        StreamVariant(
            type=ref.type,
            quality=ref.quality,
            url=_resolve_variant_url(ref, expires_in=expires_in),
        )
        for ref in sermon.media_refs
    ]

    log.info(
        "stream_issued",
        sermon_id=str(sermon.id),
        user_id=str(user.id) if user else None,
        variants=len(variants),
    )
    return StreamResponse(
        sermon_id=sermon.id,
        expires_in=expires_in,
        variants=variants,
    )


async def get_audio_download(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    user: User | None,
    has_subscription: bool,
) -> AudioDownloadResponse:
    """Short-lived signed URL for the AUDIO rendition only (plan §A.6, W1.6,
    L6 — offline downloads are audio-only in this app, by design, not a gap
    the video path happens to be missing from).

    Same authorization as get_stream — reused via _authorize_stream_access,
    not reimplemented. 409 when the sermon has no audio rendition, matching
    the "no media exists" framing get_stream already uses (never 404: the
    sermon itself is visible and authorized, only playable audio is absent).
    """
    sermon, _is_staff = await _authorize_stream_access(
        db, sermon_id, user, has_subscription
    )

    audio_ref = next(
        (ref for ref in sermon.media_refs if ref.type == MediaType.AUDIO), None
    )
    if audio_ref is None:
        raise ContentError(
            "No audio rendition available for this sermon", status_code=409
        )

    expires_in = settings.stream_url_expire_seconds
    url = _resolve_variant_url(audio_ref, expires_in=expires_in)

    log.info(
        "audio_download_issued",
        sermon_id=str(sermon.id),
        user_id=str(user.id) if user else None,
    )
    return AudioDownloadResponse(sermon_id=sermon.id, url=url, expires_in=expires_in)


# ── Media ref management ──────────────────────────────────────────────────────
async def list_media_refs(
    db: AsyncSession, sermon_id: uuid.UUID, actor: User
) -> list[MediaRef]:
    """All playable renditions attached to a sermon, for the editing UI."""
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    if actor.role == UserRole.EDITOR and sermon.created_by != actor.id:
        raise ContentError("Not your sermon", status_code=403)

    rows = (await db.execute(
        select(MediaRef)
        .where(MediaRef.sermon_id == sermon_id)
        .order_by(MediaRef.type, MediaRef.quality)
    )).scalars().all()
    return list(rows)


async def delete_media_ref(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    media_ref_id: uuid.UUID,
    actor: User,
    purge_object: bool = True,
) -> None:
    """Detach one rendition from a sermon.

    Refuses while the sermon is published — removing a rendition mid-playback
    would break viewers already streaming it. Unpublish first, matching the
    rule that already governs uploads.

    The stored object is deleted too by default, since an orphaned file costs
    money forever. Pass purge_object=False to keep the file and drop only the
    database row.
    """
    sermon = await _load_sermon_for_editor(db, sermon_id, actor)

    ref = (await db.execute(
        select(MediaRef).where(
            MediaRef.id == media_ref_id, MediaRef.sermon_id == sermon.id
        )
    )).scalar_one_or_none()
    if ref is None:
        raise ContentError("Media not found for this sermon", status_code=404)

    bucket = ref.bucket or settings.object_store_media_bucket
    key = ref.s3_key

    await db.delete(ref)
    await db.commit()

    if purge_object:
        # Storage cleanup is best-effort: the row is already gone, and failing
        # the request over a leftover object would be the wrong trade. A sweep
        # can reclaim orphans later.
        try:
            storage_module.get_storage().delete_object(bucket, key)
        except Exception:
            log.warning(
                "media_object_delete_failed", bucket=bucket, key=key,
                media_ref_id=str(media_ref_id),
            )

    log.info(
        "media_ref_deleted",
        sermon_id=str(sermon_id), media_ref_id=str(media_ref_id),
        media_type=ref.type.value, by=str(actor.id),
    )


async def delete_media_by_type(
    db: AsyncSession, sermon_id: uuid.UUID, media_type: MediaType, actor: User
) -> int:
    """Remove every rendition of one type (e.g. drop the audio version).

    Returns how many were removed.
    """
    sermon = await _load_sermon_for_editor(db, sermon_id, actor)

    refs = (await db.execute(
        select(MediaRef).where(
            MediaRef.sermon_id == sermon.id, MediaRef.type == media_type
        )
    )).scalars().all()
    if not refs:
        raise ContentError(
            f"No {media_type.value} media on this sermon", status_code=404
        )

    targets = [(r.bucket or settings.object_store_media_bucket, r.s3_key) for r in refs]
    for ref in refs:
        await db.delete(ref)
    await db.commit()

    store = storage_module.get_storage()
    for bucket, key in targets:
        try:
            store.delete_object(bucket, key)
        except Exception:
            log.warning("media_object_delete_failed", bucket=bucket, key=key)

    log.info(
        "media_type_deleted",
        sermon_id=str(sermon_id), media_type=media_type.value,
        count=len(targets), by=str(actor.id),
    )
    return len(targets)


async def sweep_stale_jobs(db: AsyncSession, older_than_hours: int | None = None) -> int:
    """Fail upload jobs that were never completed.

    A browser tab closed mid-upload leaves a job stuck in AWAITING_UPLOAD
    forever, cluttering the editor's view with phantom work. Marking them
    failed makes the state honest and lets the editor retry.

    Returns how many were swept.
    """
    # `or` would treat an explicit 0 as unset — deliberate check for None.
    hours = settings.stale_upload_hours if older_than_hours is None else older_than_hours
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = (await db.execute(
        select(UploadJob).where(UploadJob.status == UploadStatus.AWAITING_UPLOAD)
    )).scalars().all()

    swept = 0
    for job in rows:
        created = job.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created <= cutoff:
            job.status = UploadStatus.FAILED
            job.error_message = "Upload was never completed and has timed out."
            swept += 1

    if swept:
        await db.commit()
        log.info("stale_uploads_swept", count=swept)
    return swept


# ── Stream ingest (plan §A.2, W1.2/W1.3/W1.4) ─────────────────────────────────
# How many times _start_stream_ingest may be retried by the sweep for a job
# whose initial kickoff never produced a uid (network blip, Stream outage,
# or an ambiguous/missing MediaRef — see the skip branches below). Past this
# the sweep stops retrying. There is no dashboard signal for this today —
# GET .../media doesn't expose stream_uid at all — so a job that exhausts
# its attempts is only visible to an operator via the WARNING log lines
# these branches emit; surfacing it in the editor Dashboard is future work.
STREAM_INGEST_MAX_ATTEMPTS = 5

# How long an in-flight Stream ingest (or a failed archive copy — see
# _apply_stream_state) is left alone before sweep_stream_jobs treats it as
# "check it now" rather than "still working". Cloudflare's own ingests
# typically resolve in minutes for a sermon-length file, so an hour is
# conservative, not eager.
STREAM_SWEEP_STALE_MINUTES = 60


async def _start_stream_ingest(db: AsyncSession, job: UploadJob) -> None:
    """Hand `job`'s raw master to Cloudflare Stream via a presigned GET.

    Targets the MediaRef the existing pipeline just created for this job's
    (sermon, media_type) — see confirm_upload. Best-effort: a StreamError here
    is logged and swallowed, not raised, so a Stream outage never fails the
    upload-confirm response; sweep_stream_jobs.py retries later using
    `attempts`/`started_at`.
    """
    refs = (await db.execute(
        select(MediaRef).where(
            MediaRef.sermon_id == job.sermon_id, MediaRef.type == MediaType.VIDEO
        )
    )).scalars().all()
    if not refs:
        # No video rendition to ingest — e.g. its MediaRef was deleted via
        # DELETE /sermons/{id}/media after this job reached READY. Still
        # counts as an attempt: without bumping `attempts`/`started_at` here,
        # sweep_stream_jobs's retry-candidate query (attempts <
        # STREAM_INGEST_MAX_ATTEMPTS, ignoring `started_at`'s staleness gate
        # on the very first pass) would re-select and re-skip this job every
        # sweep, forever.
        job.attempts += 1
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
        log.warning("stream_ingest_skipped_no_media_ref", job_id=str(job.id))
        return
    if len(refs) > 1:
        # A real HLS ladder (transcode_enabled=True) produces one MediaRef per
        # quality — several rows for one VIDEO job, none of which is "the"
        # Stream target. Not the pipeline this phase covers (§A.2 targets the
        # passthrough single-master path); skip rather than guess which row
        # to tag. W1.5 replaces this quality-ladder concept with Stream's own
        # adaptive bitrate, which removes the ambiguity entirely. Bump
        # `attempts`/`started_at` regardless — same reasoning as the
        # no-MediaRef branch above: this case is permanent for a given job
        # (the ladder doesn't collapse to one MediaRef on its own), so
        # without this the sweep would re-skip it every hour forever instead
        # of eventually giving up at STREAM_INGEST_MAX_ATTEMPTS.
        job.attempts += 1
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
        log.warning(
            "stream_ingest_skipped_multiple_media_refs",
            job_id=str(job.id), count=len(refs),
        )
        return
    ref = refs[0]

    store = storage_module.get_storage()
    source_url = store.presigned_download_url(
        settings.object_store_raw_bucket, job.raw_key, settings.stream_ingest_url_expire_seconds
    )

    job.attempts += 1
    job.started_at = datetime.now(timezone.utc)
    await db.commit()

    try:
        ingest = await stream_module.get_provider().start_ingest(
            source_url=source_url,
            meta={"sermon_id": str(job.sermon_id), "upload_job_id": str(job.id)},
        )
    except StreamError as exc:
        log.warning(
            "stream_ingest_failed",
            job_id=str(job.id), attempts=job.attempts, error=str(exc),
        )
        return

    ref.stream_uid = ingest.uid
    await db.commit()
    log.info(
        "stream_ingest_started",
        job_id=str(job.id), stream_uid=ingest.uid, state=ingest.state,
    )


async def _active_video_job_for_sermon(
    db: AsyncSession, sermon_id: uuid.UUID
) -> UploadJob | None:
    """The most recent not-yet-finished VIDEO upload job for a sermon — the
    job a Stream ready/error notification for that sermon's video should be
    attributed to. MediaRef carries no FK back to the UploadJob that created
    it, so this is a best-effort correlation by (sermon_id, media_type,
    unfinished); a superseded re-upload can leave an old job's `finished_at`
    permanently unset (a stale bookkeeping row, harmless — see
    sweep_stream_jobs docstring)."""
    return (await db.execute(
        select(UploadJob)
        .where(
            UploadJob.sermon_id == sermon_id,
            UploadJob.media_type == MediaType.VIDEO,
            UploadJob.finished_at.is_(None),
        )
        .order_by(UploadJob.created_at.desc())
    )).scalars().first()


async def _archive_raw_master(ref: MediaRef, job: UploadJob | None) -> None:
    """Copy the raw master into Deep Archive once Stream is done with it
    (ready or error — see _apply_stream_state). This is the step that makes
    the Cloudflare Stream vendor choice reversible (plan §A.2, L8): the S3
    master survives independent of Cloudflare. Not optional, not deferrable.

    Idempotent by construction: S3 copy overwrites the same destination key,
    so a retry after a prior failure is safe to just redo in full. Runs in a
    worker thread — boto3 is sync and a multi-GB copy can take a real amount
    of wall-clock time, which must not block the event loop.

    That idempotency claim covers retry-after-failure, not true concurrency:
    a sweep poll and a webhook racing on the same ref both copy from the same
    source key, so it's still last-write-wins on S3 with no lock between
    them. Believed harmless given the webhook-side ledger dedup (see
    handle_stream_webhook's "duplicate_ignored" outcome) keeps both callers
    writing the same bytes, but that's an assumption, not a guarantee this
    function itself enforces.
    """
    if job is None:
        log.error(
            "archive_skipped_no_job",
            sermon_id=str(ref.sermon_id), stream_uid=ref.stream_uid,
        )
        raise StorageError("No upload job to source the raw master from")

    store = storage_module.get_storage()
    dest_key = storage_module.archive_key(ref.sermon_id, job.raw_key)
    await asyncio.to_thread(
        store.copy_object,
        settings.object_store_raw_bucket, job.raw_key,
        settings.object_store_raw_bucket, dest_key,
        storage_class=settings.archive_store_storage_class,
    )
    log.info(
        "raw_master_archived",
        sermon_id=str(ref.sermon_id), src=job.raw_key, dest=dest_key,
    )


async def _apply_stream_state(
    ref: MediaRef, job: UploadJob | None, *, state: str, ready_to_stream: bool
) -> str:
    """Apply a Stream status (from a webhook event or a sweep poll — both
    produce the same (state, ready_to_stream) shape) to the MediaRef/UploadJob
    rows. Shared by handle_stream_webhook and sweep_stream_jobs so both paths
    apply exactly the same transition.

    Returns "ready", "error", or "not_terminal" (queued/downloading/inprogress
    — nothing to do yet).
    """
    if state == "ready" and ready_to_stream:
        outcome = "ready"
    elif state == "error":
        outcome = "error"
    else:
        return "not_terminal"

    # Archive first, mark finished second. If the archive copy raises, this
    # function raises too and `job.finished_at` is never set — the job stays
    # eligible for the next sweep_stream_jobs pass to retry the archive.
    # Silently marking the job "finished" with no archive copy would collapse
    # the reversibility argument the whole Stream decision rests on.
    await _archive_raw_master(ref, job)

    if job is not None and job.finished_at is None:
        job.finished_at = datetime.now(timezone.utc)
    log.info(
        "stream_ingest_resolved",
        sermon_id=str(ref.sermon_id), stream_uid=ref.stream_uid, outcome=outcome,
    )
    return outcome


async def _already_processed_stream_event(
    db: AsyncSession, provider: str, event_id: str
) -> bool:
    found = (await db.execute(
        select(ProcessedWebhook).where(
            ProcessedWebhook.provider == provider,
            ProcessedWebhook.event_id == event_id,
        )
    )).scalar_one_or_none()
    return found is not None


def _is_stream_webhook_ledger_violation(exc: IntegrityError) -> bool:
    """True when an IntegrityError is the `uq_webhook_provider_event`
    collision (a concurrent duplicate delivery). Mirrors
    subscription_service._is_webhook_ledger_violation exactly — same table,
    same constraint, same reasoning: match the constraint by name (Postgres)
    or by its exact column pair (SQLite, which never names it), so a future
    unrelated constraint on the table still surfaces instead of being
    silently swallowed."""
    text = str(getattr(exc, "orig", exc)).lower()
    if "uq_webhook_provider_event" in text:
        return True
    return (
        "unique" in text
        and "processed_webhooks.provider" in text
        and "processed_webhooks.event_id" in text
    )


async def handle_stream_webhook(db: AsyncSession, event: dict[str, Any]) -> str:
    """Apply a Cloudflare Stream ready/error notification. Idempotent: a
    redelivered event is a no-op (ProcessedWebhook ledger — same precedent
    subscription_service.handle_webhook uses for Stripe).

    A StorageError from the archive step (see _apply_stream_state) propagates
    uncaught: the route returns 500, Cloudflare redelivers the webhook later,
    and the ledger row is never written for this attempt (it commits only
    after _apply_stream_state returns), so the redelivery retries the archive
    too rather than being deduped away.
    """
    provider_name = stream_module.get_provider().name
    uid = str(event.get("uid") or "")
    status_obj = event.get("status") or {}
    state = str(status_obj.get("state") or "")
    if not uid or not state:
        raise ContentError("Webhook missing uid or status.state", status_code=400)

    # Cloudflare Stream webhooks carry no event id (unlike Stripe) — the
    # (uid, state) pair is the redelivery identity: two deliveries of the same
    # "ready" event for the same uid must dedupe. A later, genuinely different
    # state for the same uid is a distinct event_id and is not swallowed.
    event_id = f"{uid}:{state}"

    if await _already_processed_stream_event(db, provider_name, event_id):
        return "duplicate_ignored"

    ref = (await db.execute(
        select(MediaRef).where(MediaRef.stream_uid == uid)
    )).scalar_one_or_none()
    if ref is None:
        # Unknown uid: still record the ledger entry below so a redelivery
        # storm for an id we don't recognise doesn't hammer this branch
        # forever. Not something the provider should keep retrying over.
        log.warning("stream_webhook_unknown_uid", uid=uid, state=state)
        outcome = "unknown_uid"
    else:
        job = await _active_video_job_for_sermon(db, ref.sermon_id)
        outcome = await _apply_stream_state(
            ref, job, state=state, ready_to_stream=bool(event.get("readyToStream", False)),
        )

    db.add(ProcessedWebhook(provider=provider_name, event_id=event_id, event_type=state))
    try:
        await db.commit()
    except IntegrityError as exc:
        if not _is_stream_webhook_ledger_violation(exc):
            raise
        await db.rollback()
        log.info("stream_webhook_duplicate_ignored", uid=uid, state=state)
        return "duplicate_ignored"

    log.info("stream_webhook_handled", uid=uid, state=state, outcome=outcome)
    return outcome


async def sweep_stream_jobs(db: AsyncSession, older_than_minutes: int | None = None) -> int:
    """Reconcile Stream ingests a webhook never resolved, and retry ingests
    whose initial kickoff never produced a uid.

    Two cases, both keyed off `upload_jobs.started_at`/`finished_at`/
    `attempts` (added alongside `media_refs.stream_uid` — plan §A.2, W1.1):

    1. Ingest under way (we have a stream_uid) but never resolved — poll
       Cloudflare directly and apply the same transition the webhook would
       have (_apply_stream_state). This also covers a "ready" that resolved
       but whose archive copy failed: `finished_at` is only set once the
       archive succeeds too, so a job in that state is picked up again here
       and the poll-then-archive is simply retried.
    2. The initial `_start_stream_ingest` call never produced a uid at all
       (Stream outage at confirm time) — retry it, up to
       STREAM_INGEST_MAX_ATTEMPTS.

    A superseded re-upload (editor replaces a sermon's video while an older
    ingest is still in flight) can leave the OLD upload job's `finished_at`
    permanently unset — the MediaRef it was tracking gets deleted and
    recreated by the newer upload's process_upload() call, so this sweep
    can no longer find it via `_active_video_job_for_sermon`. That old job
    then sits inert (case 2 would touch it, but the sermon's current
    MediaRef already has a *different* stream_uid, so it is skipped as
    "already started"). Harmless — a stale bookkeeping row, not a retry
    loop or a stuck sermon — and not fixed here; the S3/Stream orphan cleanup
    this implies is the same class of "sweep's problem, later" already noted
    elsewhere in this module for deleted MediaRefs.

    Returns how many jobs were touched (resolved or retried).
    """
    minutes = STREAM_SWEEP_STALE_MINUTES if older_than_minutes is None else older_than_minutes
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    def _stale(started_at: datetime | None) -> bool:
        if started_at is None:
            return True
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        return started_at <= cutoff

    resolved = 0
    retried = 0

    # Case 1: has a uid, not yet fully resolved.
    in_flight_refs = (await db.execute(
        select(MediaRef).where(
            MediaRef.type == MediaType.VIDEO, MediaRef.stream_uid.is_not(None)
        )
    )).scalars().all()
    for ref in in_flight_refs:
        job = await _active_video_job_for_sermon(db, ref.sermon_id)
        if job is None or not _stale(job.started_at):
            continue
        try:
            status = await stream_module.get_provider().get_status(uid=ref.stream_uid)
        except StreamError as exc:
            log.warning(
                "stream_sweep_status_check_failed",
                sermon_id=str(ref.sermon_id), uid=ref.stream_uid, error=str(exc),
            )
            continue
        try:
            outcome = await _apply_stream_state(
                ref, job, state=status.state, ready_to_stream=status.ready_to_stream
            )
        except StorageError as exc:
            # Archive failed again — leave finished_at unset so the next pass
            # retries. Loud (ERROR), never silently swallowed.
            log.error(
                "stream_sweep_archive_failed",
                sermon_id=str(ref.sermon_id), uid=ref.stream_uid, error=str(exc),
            )
            continue
        if outcome != "not_terminal":
            resolved += 1

    if resolved:
        # _apply_stream_state only mutates in-memory objects; this is the
        # transaction boundary for all of case 1's changes (job.finished_at).
        await db.commit()

    # Case 2: the initial kickoff never even got a uid — retry it.
    candidates = (await db.execute(
        select(UploadJob).where(
            UploadJob.media_type == MediaType.VIDEO,
            UploadJob.status == UploadStatus.READY,
            UploadJob.finished_at.is_(None),
            UploadJob.attempts < STREAM_INGEST_MAX_ATTEMPTS,
        )
    )).scalars().all()
    for job in candidates:
        if not _stale(job.started_at):
            continue
        refs = (await db.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == job.sermon_id, MediaRef.type == MediaType.VIDEO
            )
        )).scalars().all()
        if any(r.stream_uid is not None for r in refs):
            continue  # already has a uid — case 1 owns it now
        await _start_stream_ingest(db, job)
        retried += 1

    if resolved or retried:
        log.info("stream_jobs_swept", resolved=resolved, retried=retried)
    return resolved + retried
