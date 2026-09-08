"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";

/* =============================================================================
   Thumbnail card (design Screen 4, right column, top).

   W8 SCOPE: display only. "Replace image" is STUBBED — disabled with a
   "W9" title.

   Why stubbed, not wired: `POST /sermons/{id}/thumbnail-url` →
   PUT → `POST /sermons/{id}/thumbnail/confirm` is a clean contract and the
   compose MinIO now supports a real browser-direct presigned PUT, BUT that is
   exactly the surface W9's mandatory `security-reviewer` pass covers
   (presigned-URL handling + CORS posture, plan W9 review). W8's review is
   autosave concurrency only. Wiring an ad-hoc PUT here would ship an
   un-security-reviewed upload path and duplicate the `lib/upload` uploader W9
   builds. Deferring it costs one disabled button.
   ========================================================================== */

export interface ThumbnailCardProps {
  thumbnailUrl: string | null;
  title: string;
}

export function ThumbnailCard({ thumbnailUrl, title }: ThumbnailCardProps) {
  return (
    <Card className="flex flex-col gap-12 p-20">
      <CardHeader>
        <CardTitle>Thumbnail</CardTitle>
      </CardHeader>

      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
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

      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled
          title="Image upload arrives in W9"
        >
          Replace image
        </Button>
      </div>
    </Card>
  );
}
