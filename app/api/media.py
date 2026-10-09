"""Media upload and streaming endpoints."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, get_optional_user, require_role
from app.core.logging import get_logger
from app.core.stream import StreamError
from app.core.stream import get_provider as get_stream_provider
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    AudioDownloadResponse,
    MediaRefPublic,
    StreamResponse,
    UploadConfirm,
    UploadJobPublic,
    UploadRequest,
    UploadTicket,
    VideoDownloadResponse,
)
from app.models.models import MediaType, User, UserRole
from app.services import auth_service, content_service, media_service
from app.services.content_service import ContentError

log = get_logger("media_api")

router = APIRouter(tags=["media"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
EditorPlus = Annotated[
    CurrentUser,
    Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)),
]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    # upgrade_required gets a structured body the client can branch on.
    if exc.status_code == 403 and exc.message == "upgrade_required":
        return HTTPException(
            status_code=403,
            detail={"upgrade_required": True, "reason": "subscription_needed"},
        )
    return HTTPException(
        status_code=exc.status_code,
        detail=exc.message,
        headers=exc.headers or None,
    )


@router.post(
    "/sermons/{sermon_id}/upload-url",
    response_model=UploadTicket,
    status_code=status.HTTP_201_CREATED,
)
async def create_upload_url(
    sermon_id: uuid.UUID, data: UploadRequest, user: EditorPlus, db: DbDep
) -> UploadTicket:
    """Issue a pre-signed URL so the client uploads straight to object storage.

    The file never passes through this API — no bandwidth cost, no request-size
    limits, no blocked worker.
    """
    actor = await _actor(db, user)
    try:
        return await media_service.create_upload_ticket(
            db, 
            sermon_id, 
            actor,
            filename=data.filename,
            content_type=data.content_type,
            media_type=data.media_type,
            size_bytes=data.size_bytes,
        )
    except ContentError as exc:
        raise _err(exc)


@router.post("/uploads/{job_id}/confirm", response_model=UploadJobPublic)
async def confirm_upload(
    job_id: uuid.UUID,
    user: EditorPlus,
    db: DbDep,
    data: UploadConfirm | None = None,
) -> UploadJobPublic:
    """Call after the PUT completes. Verifies the object exists, then processes.

    Optionally carries `duration_seconds`, which the browser reads from the file
    before uploading — the only practical source while transcoding is passthrough.
    """
    actor = await _actor(db, user)
    try:
        job = await media_service.confirm_upload(
            db, job_id, actor,
            duration_seconds=data.duration_seconds if data else None,
        )
    except ContentError as exc:
        raise _err(exc)
    return UploadJobPublic.model_validate(job)


@router.get("/sermons/{sermon_id}/uploads", response_model=list[UploadJobPublic])
async def list_uploads(
    sermon_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> list[UploadJobPublic]:
    actor = await _actor(db, user)
    try:
        jobs = await media_service.list_jobs(db, sermon_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return [UploadJobPublic.model_validate(j) for j in jobs]


@router.get("/uploads/in-flight", response_model=list[UploadJobPublic])
async def list_in_flight_uploads(
    user: EditorPlus,
    db: DbDep,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[UploadJobPublic]:
    """Upload jobs still uploading or transcoding, across every sermon the
    caller may see (an editor: their own; manager/admin: all). Feeds the
    Dashboard's global "processing" card.
    """
    actor = await _actor(db, user)
    jobs = await media_service.list_in_flight_jobs(db, actor, limit=limit)
    return [UploadJobPublic.model_validate(j) for j in jobs]


@router.delete("/uploads/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upload_job(
    job_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> Response:
    """Cancel a superseded or stalled upload job and best-effort delete its raw
    object.

    Owner-scoped: an editor may only delete a job whose sermon they created
    (another editor's job, or an unknown id, is 404); managers and admins any.
    Refused with 409 while the job is transcoding or already ready.
    """
    actor = await _actor(db, user)
    try:
        await media_service.delete_upload_job(db, job_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/media/stream/webhook", include_in_schema=False)
async def stream_webhook(request: Request, db: DbDep) -> dict:
    """Receive Cloudflare Stream ready/error notifications.

    Unauthenticated by design — the signature is the authentication. Mirrors
    subscriptions.provider_webhook's shape for the same reason: return 200
    quickly so the provider doesn't retry on slow processing, and let a
    genuine processing failure (StreamError from a bad signature is caught
    here; anything else, e.g. a StorageError from a failed archive copy,
    propagates to the global handler as a 500 so Cloudflare redelivers).
    """
    payload = await request.body()
    signature = request.headers.get("webhook-signature")

    try:
        event = get_stream_provider().verify_webhook(payload, signature)
    except StreamError as exc:
        log.warning("stream_webhook_rejected", reason=str(exc))
        raise HTTPException(status_code=400, detail="Invalid webhook")

    try:
        outcome = await media_service.handle_stream_webhook(db, event)
    except ContentError as exc:
        raise _err(exc)
    return {"received": True, "outcome": outcome}


@router.get("/sermons/{sermon_id}/stream", response_model=StreamResponse)
async def get_stream(
    sermon_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> StreamResponse:
    """Signed playback URLs. Paid content requires an active subscription —
    this is where the catalog's `locked` flag is actually enforced."""
    has_sub = await content_service._has_subscription(db, user)
    try:
        return await media_service.get_stream(db, sermon_id, user, has_sub)
    except ContentError as exc:
        raise _err(exc)


@router.get(
    "/sermons/{sermon_id}/download/audio", response_model=AudioDownloadResponse
)
async def download_audio(
    sermon_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> AudioDownloadResponse:
    """Short-lived signed URL for the audio rendition only — offline
    downloads are audio-only in this app, by design (plan §A.6, L6). Same
    authorization as get_stream; 409 if the sermon has no audio rendition."""
    has_sub = await content_service._has_subscription(db, user)
    try:
        return await media_service.get_audio_download(db, sermon_id, user, has_sub)
    except ContentError as exc:
        raise _err(exc)


@router.get(
    "/sermons/{sermon_id}/download/video", response_model=VideoDownloadResponse
)
async def download_video(
    sermon_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> VideoDownloadResponse:
    """Short-lived signed URL for the video rendition only — offline video
    downloads (Isaac's ask, session 2026-10-08, revisiting L6). Same
    authorization as get_stream; 409 if the sermon has no video rendition.
    See `media_service.get_video_download` for the at-rest protection
    tradeoff this path accepts versus the audio download's encryption."""
    has_sub = await content_service._has_subscription(db, user)
    try:
        return await media_service.get_video_download(db, sermon_id, user, has_sub)
    except ContentError as exc:
        raise _err(exc)


# ── Media management ──────────────────────────────────────────────────────────
@router.get("/sermons/{sermon_id}/media", response_model=list[MediaRefPublic])
async def list_media(
    sermon_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> list[MediaRefPublic]:
    """Every rendition attached to a sermon — what the editing UI lists."""
    actor = await _actor(db, user)
    try:
        refs = await media_service.list_media_refs(db, sermon_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return [MediaRefPublic.model_validate(r) for r in refs]


@router.delete(
    "/sermons/{sermon_id}/media/{media_ref_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_media(
    sermon_id: uuid.UUID,
    media_ref_id: uuid.UUID,
    user: EditorPlus,
    db: DbDep,
    purge_object: bool = Query(
        default=True,
        description="Also delete the stored file. False keeps it in storage.",
    ),
) -> Response:
    """Detach one rendition. The sermon must not be published."""
    actor = await _actor(db, user)
    try:
        await media_service.delete_media_ref(
            db, sermon_id, media_ref_id, actor, purge_object=purge_object
        )
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/sermons/{sermon_id}/media", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_media_by_type(
    sermon_id: uuid.UUID,
    media_type: MediaType,
    user: EditorPlus,
    db: DbDep,
) -> Response:
    """Remove every rendition of one type, e.g. drop the audio version."""
    actor = await _actor(db, user)
    try:
        await media_service.delete_media_by_type(db, sermon_id, media_type, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
