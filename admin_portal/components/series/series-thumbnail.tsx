"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { IMAGE_ACCEPT_ATTR } from "@/lib/upload";
import { COVER_HINT, coverDimensionsWarning, readImageSize } from "@/lib/upload/cover-guidance";
import { useSeriesThumbnailUpload } from "@/lib/query/hooks/use-series-thumbnail-upload";

/* =============================================================================
   SeriesThumbnail — the 16:9 series art with "Replace image" (design Screen 6),
   plan W11 item 3. Wires the series thumbnail ticket → XHR PUT → confirm:
     POST /api/v1/series/{id}/thumbnail-url
     PUT  <upload_url>            (direct to storage)
     POST /api/v1/series/{id}/thumbnail/confirm?thumbnail_key=…

   Same contract as the sermon thumbnail (verified in `app/api/series.py`), so
   this is fully wired — not stubbed. On success the returned `thumbnail_url`
   swaps the striped placeholder immediately.
   ========================================================================== */

export interface SeriesThumbnailProps {
  seriesId: string;
  thumbnailUrl: string | null;
  title: string;
}

export function SeriesThumbnail({
  seriesId,
  thumbnailUrl,
  title,
}: SeriesThumbnailProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [sizeWarning, setSizeWarning] = React.useState<string | null>(null);
  const { replace, isPending, errorMessage, uploadedUrl, reset } =
    useSeriesThumbnailUpload({ seriesId });

  const shown = uploadedUrl ?? thumbnailUrl;

  return (
    <Card className="flex flex-col gap-12 p-20">
      <CardHeader>
        <CardTitle>Series art</CardTitle>
      </CardHeader>

      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt={`Art for ${title}`}
          className="aspect-square w-full max-w-[280px] rounded-10 border border-border object-cover"
        />
      ) : (
        <MediaPlaceholder
          scale="card"
          caption="cover · square · 1080×1080"
          className="aspect-square w-full max-w-[280px] rounded-10 border border-border"
        />
      )}

      {errorMessage ? (
        <Alert variant="error" title="Couldn’t replace the art">
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

      <p className="text-[12.5px] text-ink-muted">{COVER_HINT}</p>
      {sizeWarning && !errorMessage ? (
        <Alert variant="warning" title="Check this image">
          {sizeWarning}
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
          if (!file) return;
          setSizeWarning(null);
          replace(file);
          void readImageSize(file).then((size) =>
            setSizeWarning(size ? coverDimensionsWarning(size.width, size.height) : null),
          );
        }}
      />

      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? "Uploading…" : "Replace image"}
        </Button>
      </div>
    </Card>
  );
}
