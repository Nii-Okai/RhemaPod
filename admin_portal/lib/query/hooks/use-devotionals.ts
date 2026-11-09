/**
 * Daily devotionals — data layer for Library › Devotionals, the editor, bulk
 * import and Settings › Devotionals (plans/plan-daily-devotional.md, Phase 2).
 *
 *   useDevotionalCalendar(from, to)  GET  /devotionals/admin/calendar
 *   useEvergreenPool()               GET  /devotionals/admin/all?evergreen=true
 *   usePendingDevotionals()          GET  /approvals/devotionals/review-queue (manager+)
 *   useDevotional(id)                GET  /devotionals/admin/{id}
 *   useDevotionalHistory(id)         GET  /devotionals/admin/{id}/history
 *   useSaveDevotional()              POST /devotionals | PATCH /devotionals/{id}
 *   useDevotionalAction()            submit / withdraw / approve / reject / archive / restore / delete
 *   lookupPassage(ref, translation)  GET  /devotionals/admin/passage
 *   uploadReading(id, file)          ticket → PUT → confirm
 *   runImport(csv, options)          POST /devotionals/admin/import (text/csv)
 *   useDevotionalSettings()/useUpdateDevotionalSettings()
 *
 * Every mutation invalidates the whole `devotionals` domain: the calendar,
 * pool, pending list and details are all cheap reads, and a stale calendar
 * day is exactly the kind of bug this screen exists to prevent.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";
import { ConfirmError, TicketError, UploadValidationError } from "@/lib/upload/errors";
import { putFileWithProgress } from "@/lib/upload/xhr-put";

export type DevotionalAdmin = components["schemas"]["DevotionalAdminItem"];
export type DevotionalListItem = components["schemas"]["DevotionalListItem"];
export type DevotionalCalendar = components["schemas"]["DevotionalCalendar"];
export type DevotionalCreate = components["schemas"]["DevotionalCreate"];
export type DevotionalUpdate = components["schemas"]["DevotionalUpdate"];
export type DevotionalSettings = components["schemas"]["DevotionalSettings"];
export type DevotionalSettingsUpdate = components["schemas"]["DevotionalSettingsUpdate"];
export type ImportResult = components["schemas"]["ImportResult"];
export type ImportRow = components["schemas"]["ImportRowResult"];
export type DisplayStatus = DevotionalListItem["display_status"];

// ── Reads ────────────────────────────────────────────────────────────────────
export async function loadCalendar(
  from: string,
  to: string,
  client: ApiClient = api,
): Promise<DevotionalCalendar> {
  return unwrap(
    client.GET("/api/v1/devotionals/admin/calendar", {
      params: { query: { from, to } },
    }),
  );
}

export function useDevotionalCalendar(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.devotionals.calendar(from, to),
    queryFn: () => loadCalendar(from, to),
  });
}

export function useEvergreenPool() {
  return useQuery({
    queryKey: queryKeys.devotionals.pool(),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/devotionals/admin/all", {
          params: { query: { evergreen: true, limit: 200 } },
        }),
      ),
  });
}

export function usePendingDevotionals(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.devotionals.pending(),
    queryFn: () => unwrap(api.GET("/api/v1/approvals/devotionals/review-queue")),
    enabled,
  });
}

export function useDevotional(id: string | null) {
  return useQuery({
    queryKey: queryKeys.devotionals.detail(id ?? "new"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/devotionals/admin/{devotional_id}", {
          params: { path: { devotional_id: id as string } },
        }),
      ),
    enabled: Boolean(id),
  });
}

export function useDevotionalHistory(id: string | null) {
  return useQuery({
    queryKey: queryKeys.devotionals.history(id ?? "new"),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/devotionals/admin/{devotional_id}/history", {
          params: { path: { devotional_id: id as string } },
        }),
      ),
    enabled: Boolean(id),
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────
export function useSaveDevotional() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string | null; body: DevotionalCreate | DevotionalUpdate }) =>
      vars.id
        ? unwrap(
            api.PATCH("/api/v1/devotionals/{devotional_id}", {
              params: { path: { devotional_id: vars.id } },
              body: vars.body as DevotionalUpdate,
            }),
          )
        : unwrap(api.POST("/api/v1/devotionals", { body: vars.body as DevotionalCreate })),
    onSuccess: (row) => {
      qc.setQueryData(queryKeys.devotionals.detail(row.id), row);
      void qc.invalidateQueries({ queryKey: queryKeys.devotionals.all() });
    },
  });
}

export type DevotionalAction =
  | "submit"
  | "withdraw"
  | "approve"
  | "reject"
  | "archive"
  | "restore"
  | "delete";

export async function runDevotionalAction(
  id: string,
  action: DevotionalAction,
  note?: string,
): Promise<void> {
  const path = { params: { path: { devotional_id: id } } };
  switch (action) {
    case "submit":
      await unwrap(api.POST("/api/v1/devotionals/{devotional_id}/submit", path));
      return;
    case "withdraw":
      await unwrap(api.POST("/api/v1/devotionals/{devotional_id}/withdraw", path));
      return;
    case "approve":
      await unwrap(api.POST("/api/v1/approvals/devotionals/{devotional_id}/approve", path));
      return;
    case "reject":
      await unwrap(api.POST("/api/v1/approvals/devotionals/{devotional_id}/reject", {
        ...path,
        body: { note: note ?? "" },
      }));
      return;
    case "archive":
      await unwrap(api.POST("/api/v1/approvals/devotionals/{devotional_id}/archive", path));
      return;
    case "restore":
      await unwrap(api.POST("/api/v1/approvals/devotionals/{devotional_id}/restore", path));
      return;
    case "delete":
      await unwrap(api.DELETE("/api/v1/devotionals/{devotional_id}", path));
      return;
  }
}

export function useDevotionalAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; action: DevotionalAction; note?: string }) =>
      runDevotionalAction(vars.id, vars.action, vars.note),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.devotionals.all() }),
  });
}

export async function lookupPassage(ref: string, translation: string) {
  return unwrap(
    api.GET("/api/v1/devotionals/admin/passage", {
      params: { query: { ref, translation } },
    }),
  );
}

// ── Pastor's reading upload ──────────────────────────────────────────────────
export const READING_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
};
export const MAX_READING_BYTES = 30 * 1024 * 1024;

/** The MIME type to upload `file` as, or null when it isn't an accepted audio file. */
export function readingContentType(file: { name: string; type: string }): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext in READING_TYPES) return READING_TYPES[ext];
  if (Object.values(READING_TYPES).includes(file.type)) return file.type;
  return null;
}

/** Duration of an audio file in whole seconds, read in the browser. */
export function readAudioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

export async function uploadReading(
  id: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<DevotionalAdmin> {
  const contentType = readingContentType(file);
  if (!contentType) {
    throw new UploadValidationError("Use an MP3, M4A, AAC or WAV file.");
  }
  if (file.size > MAX_READING_BYTES) {
    throw new UploadValidationError("The reading must be 30 MB or smaller.");
  }
  let ticket;
  try {
    ticket = await unwrap(
      api.POST("/api/v1/devotionals/{devotional_id}/reading-url", {
        params: { path: { devotional_id: id } },
        body: { filename: file.name, content_type: contentType },
      }),
    );
  } catch (err) {
    if (isApiError(err)) {
      throw new TicketError(`Couldn’t start the upload: ${err.detail}`, err);
    }
    throw new TicketError("Couldn’t start the upload.", err);
  }
  await putFileWithProgress(ticket.upload_url, file, {
    contentType: ticket.headers?.["Content-Type"] ?? contentType,
    onProgress: (p) => onProgress?.(p.total ? p.loaded / p.total : 0),
  });
  const duration = await readAudioDuration(file);
  try {
    return await unwrap(
      api.POST("/api/v1/devotionals/{devotional_id}/reading/confirm", {
        params: { path: { devotional_id: id } },
        body: { reading_key: ticket.reading_key, duration_s: duration },
      }),
    );
  } catch (err) {
    if (isApiError(err)) throw new ConfirmError(err.status, err.detail, err);
    throw new ConfirmError(0, "Couldn’t attach the reading. Try again.", err);
  }
}

export async function removeReading(id: string): Promise<DevotionalAdmin> {
  return unwrap(
    api.DELETE("/api/v1/devotionals/{devotional_id}/reading", {
      params: { path: { devotional_id: id } },
    }),
  );
}

// ── Import ───────────────────────────────────────────────────────────────────
export interface ImportOptions {
  dryRun: boolean;
  as: "draft" | "approved";
  onClash: "skip" | "replace_draft" | "to_pool";
}

export async function runImport(csv: string, opts: ImportOptions): Promise<ImportResult> {
  return unwrap(
    api.POST("/api/v1/devotionals/admin/import", {
      params: {
        query: { dry_run: opts.dryRun, as: opts.as, on_clash: opts.onClash },
      },
      body: csv as never,
      bodySerializer: (b: unknown) => b as string,
      headers: { "Content-Type": "text/csv" },
    }),
  );
}

export const IMPORT_TEMPLATE_URL = "/api/bff/devotionals/admin/import/template";

// ── Settings ─────────────────────────────────────────────────────────────────
export function useDevotionalSettings() {
  return useQuery({
    queryKey: queryKeys.devotionals.settings(),
    queryFn: () => unwrap(api.GET("/api/v1/admin/settings/devotionals")),
  });
}

export function useUpdateDevotionalSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DevotionalSettingsUpdate) =>
      unwrap(api.PATCH("/api/v1/admin/settings/devotionals", { body })),
    onSuccess: (row) => qc.setQueryData(queryKeys.devotionals.settings(), row),
  });
}
