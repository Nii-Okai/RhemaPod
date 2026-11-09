"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EditorField } from "@/components/sermons/editor/field";
import { isApiError } from "@/lib/api/errors";
import {
  useDevotionalSettings,
  useUpdateDevotionalSettings,
  type DevotionalSettings,
  type DevotionalSettingsUpdate,
} from "@/lib/query/hooks/use-devotionals";

/* =============================================================================
   Settings › Devotionals (plan-daily-devotional A5).

   The church-wide defaults: what the app does when a day has no pastor's
   reading (text only, or read aloud by the phone), whether a single
   devotional may override that, the read-aloud voice and speed, the publish
   hour, the gap-alert threshold, the Still timer and the default translation.

   Saved with the same optimistic version lock as the church profile: a 409
   means someone else saved first, and the form offers to load theirs.
   ========================================================================== */

type Draft = Omit<DevotionalSettings, "version">;

function toDraft(s: DevotionalSettings): Draft {
  const rest: Partial<DevotionalSettings> = { ...s };
  delete rest.version;
  return rest as Draft;
}

/** Only the fields that changed, plus the version the form was loaded at. */
export function buildDevotionalPatch(base: DevotionalSettings, draft: Draft): DevotionalSettingsUpdate {
  const patch: DevotionalSettingsUpdate = { version: base.version };
  for (const k of Object.keys(draft) as (keyof Draft)[]) {
    if (draft[k] !== base[k]) (patch as Record<string, unknown>)[k] = draft[k];
  }
  return patch;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
function hourLabel(h: number) {
  if (h === 0) return "Midnight";
  if (h === 12) return "Noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function DevotionalSettingsScreen() {
  const q = useDevotionalSettings();
  if (q.isPending) return <div className="h-[480px] rounded-16 border border-border bg-surface" aria-busy />;
  if (q.isError || !q.data) {
    return (
      <Alert variant="error" title="Couldn’t load devotional settings">
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Try again
        </button>
      </Alert>
    );
  }
  return <SettingsForm key={q.data.version} initial={q.data} reload={() => void q.refetch()} />;
}

function SettingsForm({ initial, reload }: { initial: DevotionalSettings; reload: () => void }) {
  const update = useUpdateDevotionalSettings();
  const [base, setBase] = React.useState(initial);
  const [draft, setDraft] = React.useState<Draft>(toDraft(initial));
  const [conflict, setConflict] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const patch = buildDevotionalPatch(base, draft);
  const dirty = Object.keys(patch).length > 1;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const gapInvalid = !Number.isInteger(draft.gap_alert_days) || draft.gap_alert_days < 1 || draft.gap_alert_days > 90;
  const stillInvalid = !Number.isInteger(draft.still_seconds) || draft.still_seconds < 10 || draft.still_seconds > 600;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || gapInvalid || stillInvalid) return;
    setError(null);
    update.mutate(patch, {
      onSuccess: (row) => {
        setBase(row);
        setDraft(toDraft(row));
        setSaved(true);
      },
      onError: (err) => {
        if (isApiError(err) && err.status === 409) setConflict(true);
        else setError(isApiError(err) ? err.detail : "Couldn’t save. Please try again.");
      },
    });
  }

  return (
    <form className="flex flex-col gap-16" onSubmit={onSubmit} noValidate>
      {conflict ? (
        <Alert variant="warning" title="Someone else saved these settings">
          <div className="flex flex-col items-start gap-8">
            <span>Your changes weren’t saved. Load the latest version, then make your edits again.</span>
            <Button type="button" variant="secondary" size="sm" onClick={reload}>
              Load latest
            </Button>
          </div>
        </Alert>
      ) : null}
      {saved && !dirty ? (
        <Alert variant="success" title="Settings saved">
          The app picks up the change within a few minutes.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Not saved">
          {error}
        </Alert>
      ) : null}

      <Card className="flex flex-col gap-14">
        <CardHeader>
          <CardTitle>When there’s no pastor’s reading</CardTitle>
        </CardHeader>
        <p className="text-[13px] text-ink-muted">
          Recordings are optional. On days without one, the app can show the passage as text, or read it aloud
          with the phone’s own voice.
        </p>
        <div role="radiogroup" aria-label="Fallback" className="flex flex-col gap-10">
          {(
            [
              ["text", "Text only", "Listeners read the passage themselves."],
              ["tts", "Read aloud by the phone", "Uses the phone’s built-in voice. Works offline, costs nothing."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-10">
              <Radio
                name="fallback"
                value={value}
                checked={draft.reading_fallback === value}
                onChange={() => set("reading_fallback", value)}
              />
              <span className="flex flex-col">
                <span className="text-[14px] text-ink">{label}</span>
                <span className="text-[12.5px] text-ink-faint">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-center justify-between gap-12 border-t border-border-subtle pt-12">
          <span className="flex flex-col">
            <span className="text-[14px] text-ink">Let a devotional override this</span>
            <span className="text-[12.5px] text-ink-faint">Shows a choice in the editor for each devotional.</span>
          </span>
          <Switch checked={draft.allow_override} onCheckedChange={(v) => set("allow_override", v)} aria-label="Allow override" />
        </label>
        {draft.reading_fallback === "tts" || draft.allow_override ? (
          <div className="grid grid-cols-1 gap-14 border-t border-border-subtle pt-12 sm:grid-cols-2">
            <EditorField label="Voice" htmlFor="tts-voice" hint="Leave blank for the phone’s default voice in the listener’s language.">
              <Input
                id="tts-voice"
                value={draft.tts_voice ?? ""}
                maxLength={60}
                placeholder="Phone default"
                onChange={(e) => set("tts_voice", e.target.value.trim() ? e.target.value : null)}
              />
            </EditorField>
            <EditorField label={`Speed · ${draft.tts_rate_pct}%`} htmlFor="tts-rate" hint="Slightly slower than normal suits scripture.">
              <input
                id="tts-rate"
                type="range"
                min={50}
                max={150}
                step={5}
                value={draft.tts_rate_pct}
                onChange={(e) => set("tts_rate_pct", Number(e.target.value))}
                className="accent-clay-600"
              />
            </EditorField>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-14">
        <CardHeader>
          <CardTitle>Schedule and defaults</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 gap-14 sm:grid-cols-2">
          <EditorField label="New devotional appears at" htmlFor="pub-hour" hint="In each listener’s own time zone.">
            <Select id="pub-hour" value={draft.publish_hour} onChange={(e) => set("publish_hour", Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </EditorField>
          <EditorField
            label="Warn when fewer days are ready than"
            htmlFor="gap-days"
            error={gapInvalid ? "Between 1 and 90 days." : null}
          >
            <Input
              id="gap-days"
              inputMode="numeric"
              value={String(draft.gap_alert_days)}
              onChange={(e) => set("gap_alert_days", Number(e.target.value.replace(/\D/g, "") || 0))}
              error={gapInvalid}
            />
          </EditorField>
          <EditorField label="Still timer (seconds)" htmlFor="still-secs" error={stillInvalid ? "Between 10 and 600." : null}>
            <Input
              id="still-secs"
              inputMode="numeric"
              value={String(draft.still_seconds)}
              onChange={(e) => set("still_seconds", Number(e.target.value.replace(/\D/g, "") || 0))}
              error={stillInvalid}
            />
          </EditorField>
          <EditorField label="Default translation" htmlFor="def-tr" hint="KJV and WEB can fill the passage text automatically.">
            <Select id="def-tr" value={draft.default_translation} onChange={(e) => set("default_translation", e.target.value)}>
              {["kjv", "web", "nkjv", "niv", "esv", "nlt"].map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </Select>
          </EditorField>
        </div>
      </Card>

      <div className="flex justify-end gap-8">
        <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setDraft(toDraft(base))}>
          Discard
        </Button>
        <Button type="submit" disabled={!dirty || update.isPending || gapInvalid || stillInvalid}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
