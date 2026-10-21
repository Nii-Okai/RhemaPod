/**
 * Church settings — the Settings › Profile screen (plan-admin-settings S17).
 *
 *   useChurchSettings()
 *     GET /api/v1/admin/settings → ChurchSettingsAdmin
 *   useUpdateChurchSettings()
 *     PATCH /api/v1/admin/settings { version, ...changed } → ChurchSettingsAdmin
 *
 * The PATCH carries the `version` the editor loaded. A 409 means someone else
 * saved first; the screen shows a reload-and-reapply banner rather than
 * retrying, because retrying with a fresh version would silently overwrite
 * the other person's change. A success writes the server's response straight
 * into the cache, so the form re-bases on the new `version` without a refetch.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type ChurchSettings = components["schemas"]["ChurchSettingsAdmin"];
export type ChurchSettingsUpdate = components["schemas"]["ChurchSettingsUpdate"];

/** The editable fields, in form order. */
export const EDITABLE_SETTINGS_FIELDS = [
  "church_name",
  "app_display_name",
  "tagline",
  "about",
  "contact_email",
  "contact_phone",
  "website_url",
  "address",
  "comment_guidelines",
  "terms_of_use_url",
  "privacy_policy_url",
  "copyright_notice",
] as const;

export type EditableSettingsField = (typeof EDITABLE_SETTINGS_FIELDS)[number];
export type SettingsDraft = Record<EditableSettingsField, string>;

/** Server row → form state. Nulls become empty strings for the inputs. */
export function toDraft(settings: ChurchSettings): SettingsDraft {
  return Object.fromEntries(
    EDITABLE_SETTINGS_FIELDS.map((f) => [f, settings[f] ?? ""]),
  ) as SettingsDraft;
}

/**
 * The PATCH body: only fields that differ from `base`, plus `version`. An
 * optional field emptied in the form is sent as `null` (clear it); the
 * backend refuses to clear `contact_email` / `comment_guidelines`.
 */
export function buildSettingsPatch(
  base: ChurchSettings,
  draft: SettingsDraft,
): ChurchSettingsUpdate {
  const patch: Record<string, string | number | null> = { version: base.version };
  for (const field of EDITABLE_SETTINGS_FIELDS) {
    const before = base[field] ?? "";
    const after = draft[field];
    if (after.trim() === before.trim()) continue;
    patch[field] = after.trim() === "" ? null : after;
  }
  return patch as unknown as ChurchSettingsUpdate;
}

export function isSettingsPatchEmpty(patch: ChurchSettingsUpdate): boolean {
  return Object.keys(patch).length === 1;
}

export async function loadChurchSettings(
  client: ApiClient = api,
): Promise<ChurchSettings> {
  return unwrap(client.GET("/api/v1/admin/settings"));
}

export function useChurchSettings() {
  return useQuery({
    queryKey: queryKeys.settings.profile(),
    queryFn: () => loadChurchSettings(),
    staleTime: 60_000,
  });
}

export type ChurchSettingsPublic = components["schemas"]["ChurchSettingsPublic"];

/**
 * The public, unauthenticated church name/display name — for chrome every
 * role sees (the TopBar), not the Settings › Profile editor itself. Hits
 * `GET /settings/public`, not the admin-gated `GET /admin/settings`, so an
 * Editor doesn't 403 just rendering the header.
 */
export function usePublicChurchSettings() {
  return useQuery({
    queryKey: queryKeys.settings.public(),
    queryFn: (): Promise<ChurchSettingsPublic> =>
      unwrap(api.GET("/api/v1/settings/public")),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateChurchSettings() {
  const qc = useQueryClient();
  return useMutation<ChurchSettings, Error, ChurchSettingsUpdate>({
    mutationFn: (body) => unwrap(api.PATCH("/api/v1/admin/settings", { body })),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.settings.profile(), saved);
    },
  });
}
