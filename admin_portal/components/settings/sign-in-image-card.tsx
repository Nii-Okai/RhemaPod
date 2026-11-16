"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeUploadFailure, IMAGE_ACCEPT_ATTR } from "@/lib/upload";
import { useSignInImage, type ChurchSettings } from "@/lib/query/hooks/use-church-settings";

/* =============================================================================
   SignInImageCard — Settings › Profile: the photo beside the admin portal's
   sign-in form. Upload replaces it at once (it's saved on its own, not with
   the form); "Use the built-in artwork" removes it. The sign-in screen picks
   up a change within five minutes.

   Portrait works best: the panel is half the screen wide and full height, and
   the photo is cropped to fill it (centred), so keep faces away from the
   edges.
   ========================================================================== */

export function SignInImageCard({
  imageUrl,
  onSaved,
}: {
  imageUrl: string | null | undefined;
  onSaved: (row: ChurchSettings) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { upload, remove } = useSignInImage();
  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;

  return (
    <Card className="flex flex-col gap-16" data-slot="sign-in-image-card">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Sign-in screen</h2>
        <p className="text-[13px] text-ink-muted">
          The photo beside the admin sign-in form. A portrait photo (about 4:5, at
          least 1200 px tall) of your congregation or building works best; it is
          cropped to fill the panel, so keep faces away from the edges. JPEG, PNG
          or WebP, up to 10 MB.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-16">
        <div className="relative aspect-[4/5] w-[160px] overflow-hidden rounded-12 border border-border bg-surface-sunken">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Current sign-in screen photo" className="h-full w-full object-cover" />
          ) : (
            <div
              aria-label="Built-in artwork"
              role="img"
              className="h-full w-full"
              style={{
                background:
                  "radial-gradient(120% 80% at 85% 10%, rgba(255,236,214,.95) 0%, rgba(255,236,214,0) 55%)," +
                  "linear-gradient(160deg, #efe4d6 0%, #e2c7ae 45%, #c98f6c 100%)",
              }}
            />
          )}
        </div>
        <div className="flex flex-col gap-8">
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              remove.reset();
              upload.mutate(file, { onSuccess: onSaved });
            }}
          />
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? "Uploading…" : imageUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {imageUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                upload.reset();
                remove.mutate(undefined, { onSuccess: onSaved });
              }}
            >
              {remove.isPending ? "Removing…" : "Use the built-in artwork"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="error" title="The photo wasn’t changed">
          {describeUploadFailure(error).message}
        </Alert>
      ) : null}
    </Card>
  );
}
