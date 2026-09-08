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

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import storage as storage_module
from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.content_schemas import StreamResponse, StreamVariant, UploadTicket
from app.models.models import (
    ContentTier,
    MediaRef,
    MediaType,
    Sermon,
    SermonStatus,
    Series,
    UploadJob,
    UploadStatus,
    User,
    UserRole,
)
from app.services.content_service import ContentError, effective_tier

settings = get_settings()
log = get_logger("media")

# Renditions produced per media type. Video ladder is capped at 480p for free
# tier by the streaming layer, not here — we always produce the full ladder.
VIDEO_QUALITIES = ("1080p", "720p", "480p")
AUDIO_QUALITIES = ("128k",)

FREE_TIER_MAX_QUALITY = "480p"

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
    if actor.role == UserRole.EDITOR and sermon.created_by != actor.id:
        raise ContentError("You can only upload to your own sermons", status_code=403)
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

    if size_bytes is not None and size_bytes > settings.max_upload_bytes:
        raise ContentError(
            f"File exceeds the maximum upload size of "
            f"{settings.max_upload_bytes // (1024 ** 3)} GB",
            status_code=413,
        )

    key = storage_module.raw_key(sermon.id, filename)
    store = storage_module.get_storage()
    url = store.presigned_upload_url(
        settings.s3_raw_bucket, key, content_type, settings.upload_url_expire_seconds
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
    if not store.object_exists(settings.s3_raw_bucket, job.raw_key):
        raise ContentError(
            "No uploaded file found for this job — complete the PUT first",
            status_code=409,
        )

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
        return [(None, settings.s3_raw_bucket, job.raw_key)]

    qualities = (
        VIDEO_QUALITIES if job.media_type == MediaType.VIDEO else AUDIO_QUALITIES
    )
    kind = job.media_type.value
    return [
        (q, settings.s3_media_bucket, storage_module.media_key(job.sermon_id, kind, q))
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


# ── Streaming ─────────────────────────────────────────────────────────────────
# Free viewers are capped at this rendition even on free content, keeping
# bandwidth costs predictable. Paid viewers get the full ladder.



async def get_stream(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    user: User | None,
    has_subscription: bool,
) -> StreamResponse:
    """Return signed playback URLs, enforcing the paid-content gate.

    This is where `locked` stops being advisory: a locked sermon returns 403
    with upgrade_required, so the catalog can stay fully browsable.
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
    if sermon.status != SermonStatus.PUBLISHED and not is_staff:
        raise ContentError("Sermon not found", status_code=404)

    series = await db.get(Series, sermon.series_id) if sermon.series_id else None
    tier = effective_tier(sermon, series)

    if tier == ContentTier.PAID and not has_subscription and not is_staff:
        raise ContentError("upgrade_required", status_code=403)

    if not sermon.media_refs:
        raise ContentError("No playable media for this sermon yet", status_code=409)

    store = storage_module.get_storage()
    variants: list[StreamVariant] = []
    for ref in sermon.media_refs:
        # Cap video quality for non-subscribers; audio is unrestricted.
        # Cap video quality for non-subscribers. A rendition with no quality
        # label is a passthrough original — there's nothing to choose between,
        # so it is never filtered out (that would leave nothing playable).
        if (
            ref.type == MediaType.VIDEO
            and not has_subscription
            and not is_staff
            and ref.quality is not None
            and ref.quality != FREE_TIER_MAX_QUALITY
        ):
            continue
        playback_key = ref.hls_manifest_key or ref.s3_key
        url = store.presigned_download_url(
            ref.bucket or settings.s3_media_bucket,
            playback_key,
            settings.stream_url_expire_seconds,
        )
        if settings.cdn_base_url:
            url = f"{settings.cdn_base_url.rstrip('/')}/{playback_key}"
        variants.append(
            StreamVariant(type=ref.type, quality=ref.quality, url=url)
        )

    if not variants:
        raise ContentError("No playable rendition available", status_code=409)

    log.info(
        "stream_issued",
        sermon_id=str(sermon.id),
        user_id=str(user.id) if user else None,
        variants=len(variants),
    )
    return StreamResponse(
        sermon_id=sermon.id,
        expires_in=settings.stream_url_expire_seconds,
        variants=variants,
    )


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

    bucket = ref.bucket or settings.s3_media_bucket
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

    targets = [(r.bucket or settings.s3_media_bucket, r.s3_key) for r in refs]
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
    from datetime import datetime, timedelta, timezone

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
