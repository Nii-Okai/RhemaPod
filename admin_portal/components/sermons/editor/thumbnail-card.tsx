"use client";

import * as React from "react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { useThumbnailUpload } from "@/lib/query/hooks/use-thumbnail-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/upload";

/* =============================================================================
   Thumbnail card (design Screen 4, right column, top) — plan W9 item 4.

   "Replace image" wires the same ticket → XHR PUT → confirm pattern as the
   Media card, against the sermon thumbnail endpoints:
     POST /api/v1/sermons/{id}/thumbnail-url
     PUT  <upload_url>            (direct to storage)
     POST /api/v1/sermons/{id}/thumbnail/confirm?thumbnail_key=…

   On success the returned `thumbnail_url` swaps the striped placeholder
   immediately (optimistic), and the sermon detail is invalidated so every
   other surface catches up.
   ========================================================================== */

export interface ThumbnailCardProps {
  sermonId: string | undefined;
  thumbnailUrl: string | null;
  title: string;
  /** Locked (in review) or no saved sermon yet. */
  disabled: boolean;
}

export function ThumbnailCard({
  sermonId,
  thumbnailUrl,
  title,
  disabled,
}: ThumbnailCardProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { replace, isPending, errorMessage, uploadedUrl, reset } =
    useThumbnailUpload({ sermonId });

  // Prefer the freshly-uploaded URL until the invalidated detail catches up.
  const shown = uploadedUrl ?? thumbnailUrl;
  const canReplace = !disabled && Boolean(sermonId) && !isPending;

  return (
    <Card className="flex flex-col gap-12 p-20">
      <CardHeader>
        <CardTitle>Thumbnail</CardTitle>
      </CardHeader>

      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt={`Thumbnail for ${title}`}
          className="aspect-video w-full rounded-10 border border-border object-cover"
        />
      ) : (
        <MediaPlaceholder
          scale="card"
          caption="thumbnail 16:9 · 1280×720"
          className="aspect-video rounded-10 border border-border"
        />
      )}

      {errorMessage ? (
        <Alert variant="error" title="Couldn’t replace the image">
          <span className="flex items-center gap-10">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={reset}
              className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) replace(file);
        }}
      />

      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canReplace}
          onClick={() => inputRef.current?.click()}
          title={
            !sermonId
              ? "Save the draft before adding an image"
              : disabled
                ? "Locked while the sermon is in review"
                : undefined
          }
        >
          {isPending ? "Uploading…" : "Replace image"}
        </Button>
      </div>
    </Card>
  );
}
