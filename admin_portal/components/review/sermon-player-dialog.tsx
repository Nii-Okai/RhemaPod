"use client";

import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogSrOnly,
} from "@/components/ui/dialog";
import {
  pickPlaybackVariant,
  useSermonStream,
} from "@/lib/query/hooks/use-sermon-stream";

/* =============================================================================
   SermonPlayerDialog — the Review queue's "Watch" player (bugfix batch #11).

   Opens a modal with a real <video>/<audio> control pointed at a signed
   playback URL from `GET /sermons/{id}/stream`. The media ref carries a
   `type` ("video" | "audio"); a video rendition is preferred when both exist.

   Controlled: `sermonId` non-null means open. The stream query only runs while
   the dialog is open, and the signed URL is not cached long (it expires).
   ========================================================================== */

export interface SermonPlayerDialogProps {
  /** The sermon to play, or `null` when the dialog is closed. */
  sermonId: string | null;
  title: string;
  onClose: () => void;
}

export function SermonPlayerDialog({
  sermonId,
  title,
  onClose,
}: SermonPlayerDialogProps) {
  const open = sermonId !== null;
  const stream = useSermonStream(sermonId ?? undefined, open);
  const variant = stream.data
    ? pickPlaybackVariant(stream.data.variants)
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogSrOnly>
          <DialogDescription>
            Media preview for the sermon under review.
          </DialogDescription>
        </DialogSrOnly>

        {stream.isPending ? (
          <div
            className="aspect-video w-full animate-pulse rounded-10 bg-border-subtle"
            aria-label="Loading media"
          />
        ) : stream.isError ? (
          <Alert variant="error" title="Couldn’t load the media">
            {stream.error instanceof Error
              ? stream.error.message
              : "Try again in a moment."}
          </Alert>
        ) : !variant ? (
          <Alert variant="warning" title="No media to play">
            This sermon has no processed renditions yet.
          </Alert>
        ) : variant.type === "audio" ? (
          <audio
            controls
            autoPlay
            src={variant.url}
            className="w-full"
            data-testid="sermon-player"
          />
        ) : (
          <video
            controls
            autoPlay
            src={variant.url}
            className="aspect-video w-full rounded-10 bg-ink"
            data-testid="sermon-player"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
