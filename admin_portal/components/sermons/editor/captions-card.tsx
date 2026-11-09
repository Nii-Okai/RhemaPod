"use client";

import * as React from "react";
import { cn } from "cn";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { isApiError } from "@/lib/api/errors";
import {
  CAPTION_LANGUAGES,
  useCaptionActions,
  useSermonCaptions,
  type Caption,
  type CaptionLanguage,
} from "@/lib/query/hooks/use-sermon-captions";

/* =============================================================================
   Captions card — subtitles on the sermon's video.

   Every new video gets English captions generated from its audio, then French
   translated from the English, a few minutes after processing finishes. Both
   play in the mobile app (CC button, English by default) and in the review
   player. Staff can download a track, fix it in any text editor, and upload
   it back; an uploaded track is never overwritten automatically, and a new
   English upload re-translates a machine-translated French track.

   Captions stay editable while the sermon is in review or live: they don't
   change the sermon's content, and a fix to a live sermon's captions
   shouldn't have to wait for re-approval.
   ========================================================================== */

const STATUS_TEXT: Record<Caption["status"], string> = {
  pending: "Queued",
  generating: "Generating",
  ready: "Ready",
  error: "Failed",
};

const STATUS_CLASS: Record<Caption["status"], string> = {
  pending: "border-border-strong text-ink-muted",
  generating: "border-border-strong text-ink-muted",
  ready: "border-sage-dot bg-sage-tint text-sage-text",
  error: "border-rose-border bg-rose-bg text-rose",
};

function sourceText(c: Caption): string {
  if (c.source === "uploaded") return "Uploaded by staff";
  if (c.source === "translated") return "Translated from English automatically";
  return "Generated from the audio automatically";
}

function errorText(err: unknown): string {
  if (isApiError(err)) return err.detail;
  return err instanceof Error ? err.message : "Something went wrong.";
}

export interface CaptionsCardProps {
  sermonId: string | undefined;
}

export function CaptionsCard({ sermonId }: CaptionsCardProps) {
  const query = useSermonCaptions(sermonId);
  const actions = useCaptionActions(sermonId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = React.useState<CaptionLanguage | null>(null);

  const byLanguage = React.useMemo(() => {
    const map = new Map<string, Caption>();
    for (const c of query.data?.captions ?? []) map.set(c.language, c);
    return map;
  }, [query.data]);

  const pickFile = (language: CaptionLanguage) => {
    setUploadTarget(language);
    inputRef.current?.click();
  };

  const mutationError =
    actions.upload.error ?? actions.regenerate.error ?? actions.download.error;
  const busy =
    actions.upload.isPending || actions.regenerate.isPending || actions.download.isPending;

  return (
    <Card className="flex flex-col gap-12 p-20" data-slot="captions-card">
      <CardHeader>
        <CardTitle>Captions</CardTitle>
      </CardHeader>

      <input
        ref={inputRef}
        type="file"
        accept=".vtt,text/vtt"
        hidden
        data-testid="caption-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && uploadTarget) {
            actions.upload.mutate({ language: uploadTarget, file });
          }
        }}
      />

      {!sermonId ? (
        <p className="text-[13px] text-ink-faint">Save the draft first.</p>
      ) : query.isLoading ? (
        <p className="text-[13px] text-ink-faint">Loading captions…</p>
      ) : query.isError ? (
        <p className="text-[13px] text-ink-faint">
          Couldn’t load captions. Reload to try again.
        </p>
      ) : !query.data?.available ? (
        <p className="text-[13px] text-ink-faint">
          English and French captions are added automatically a few minutes
          after a video finishes processing. Audio-only sermons don’t have
          captions.
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">
            English is shown by default in the app. Viewers can switch to
            French or turn captions off.
          </p>
          <div className="flex flex-col">
            {CAPTION_LANGUAGES.map(({ code, name }) => {
              const c = byLanguage.get(code);
              return (
                <div
                  key={code}
                  data-slot="caption-row"
                  data-language={code}
                  className="flex flex-col gap-6 border-t border-border-subtle py-12 first:border-t-0"
                >
                  <div className="flex items-center justify-between gap-12">
                    <span className="text-[13.5px] font-semibold text-ink">{name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-8 py-[2px] text-[11.5px] font-semibold",
                        STATUS_CLASS[c?.status ?? "pending"],
                      )}
                    >
                      {c ? STATUS_TEXT[c.status] : "Not started"}
                    </span>
                  </div>
                  {c ? (
                    <p className="text-[12px] text-ink-faint">{sourceText(c)}</p>
                  ) : null}
                  {c?.status === "error" && c.error_message ? (
                    <p className="font-mono text-[12px] leading-[1.5] text-rose">
                      {c.error_message}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-8">
                    {c?.status === "ready" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => actions.download.mutate(code)}
                      >
                        Download .vtt
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => pickFile(code)}
                      aria-label={`Upload ${name} captions`}
                    >
                      Upload .vtt
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (
                          c?.source === "uploaded" &&
                          !window.confirm(
                            `Replace the uploaded ${name} captions with automatic ones?`,
                          )
                        ) {
                          return;
                        }
                        actions.regenerate.mutate(code);
                      }}
                      aria-label={`${c?.status === "error" ? "Retry" : "Redo"} ${name} captions automatically`}
                    >
                      {c?.status === "error"
                        ? "Retry"
                        : code === "en"
                          ? "Regenerate"
                          : "Re-translate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {mutationError ? (
        <Alert variant="error" title="Captions weren’t updated">
          {errorText(mutationError)}
        </Alert>
      ) : null}
    </Card>
  );
}
