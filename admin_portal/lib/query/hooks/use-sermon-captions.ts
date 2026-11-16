/**
 * `useSermonCaptions` — the sermon video's subtitle tracks (English, French).
 *
 * `GET /api/v1/sermons/{id}/captions`. English is generated automatically by
 * Cloudflare Stream once the video finishes processing; French is translated
 * from it. Both take a few minutes, so the query polls every 15s while any
 * track is still `pending` or `generating`, and stops once they settle.
 *
 * `useCaptionActions` covers the staff actions: upload a corrected .vtt,
 * redo a track automatically, and download the current .vtt for editing.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Caption = components["schemas"]["CaptionPublic"];
export type CaptionList = components["schemas"]["CaptionListResponse"];
export type CaptionLanguage = "en" | "fr";

export const CAPTION_LANGUAGES: { code: CaptionLanguage; name: string }[] = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
];

const POLL_MS = 15_000;

export function isCaptionInFlight(c: Caption): boolean {
  return c.status === "pending" || c.status === "generating";
}

export function useSermonCaptions(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.captions(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons/{sermon_id}/captions", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId),
    refetchInterval: (query) => {
      const data = query.state.data as CaptionList | undefined;
      return data?.captions.some(isCaptionInFlight) ? POLL_MS : false;
    },
  });
}

/** Save text as a file in the browser. */
function saveTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/vtt" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useCaptionActions(sermonId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (sermonId) {
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.captions(sermonId) });
    }
  };

  const upload = useMutation({
    mutationFn: async ({ language, file }: { language: CaptionLanguage; file: File }) => {
      const vtt = await file.text();
      return unwrap(
        api.PUT("/api/v1/sermons/{sermon_id}/captions/{language}", {
          params: { path: { sermon_id: sermonId as string, language } },
          body: { vtt },
        }),
      );
    },
    onSettled: invalidate,
  });

  const regenerate = useMutation({
    mutationFn: (language: CaptionLanguage) =>
      unwrap(
        api.POST("/api/v1/sermons/{sermon_id}/captions/{language}/regenerate", {
          params: { path: { sermon_id: sermonId as string, language } },
        }),
      ),
    onSettled: invalidate,
  });

  const download = useMutation({
    mutationFn: async (language: CaptionLanguage) => {
      const data = await unwrap(
        api.GET("/api/v1/sermons/{sermon_id}/captions/{language}/vtt", {
          params: { path: { sermon_id: sermonId as string, language } },
        }),
      );
      saveTextFile(`sermon-${language}.vtt`, data.vtt);
      return data;
    },
  });

  return { upload, regenerate, download };
}
