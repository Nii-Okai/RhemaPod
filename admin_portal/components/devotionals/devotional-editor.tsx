"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/portal";
import { EditorField } from "@/components/sermons/editor/field";
import { StatusPill } from "@/components/devotionals/status-pill";
import { DevotionalPreview } from "@/components/devotionals/devotional-preview";
import { useSession } from "@/lib/auth/session-context";
import { isApiError } from "@/lib/api/errors";
import { describeUploadFailure } from "@/lib/upload/errors";
import {
  candidateWords,
  dayLabel,
  formatClock,
  parseClock,
  wordInPassage,
} from "@/lib/devotionals/calendar";
import {
  lookupPassage,
  removeReading,
  uploadReading,
  useDevotional,
  useDevotionalAction,
  useDevotionalHistory,
  useDevotionalSettings,
  useSaveDevotional,
  type DevotionalAction,
  type DevotionalAdmin,
  type DevotionalCreate,
} from "@/lib/query/hooks/use-devotionals";
import { useSermons } from "@/lib/query/hooks/use-sermons";
import { useSpeakers } from "@/lib/query/hooks/use-speakers";
import { queryKeys } from "@/lib/query/keys";
import { useQueryClient } from "@tanstack/react-query";

/* =============================================================================
   Devotional editor (plan-daily-devotional A3).

   Five sections in the order a listener meets them (Still, Hear, Ponder, Pray,
   Carry), with a live phone preview beside them. Save keeps the row in its
   current editable state; the workflow buttons below follow the same
   submit / approve / reject / archive / restore rules as announcements, and a
   manager can't approve their own work (the server enforces it too).

   An approved devotional is read-only. To change it, a manager sends it back
   with "Request changes" (which keeps the approval log honest, ADR 0022).
   ========================================================================== */

const TRANSLATIONS = [
  { value: "kjv", label: "KJV" },
  { value: "web", label: "WEB" },
  { value: "nkjv", label: "NKJV" },
  { value: "niv", label: "NIV" },
  { value: "esv", label: "ESV" },
  { value: "nlt", label: "NLT" },
];
const AUTOFILL = new Set(["kjv", "web"]);

export interface FormState {
  title: string;
  evergreen: boolean;
  date: string;
  author: string;
  breathIn: string;
  breathOut: string;
  stillSeconds: string;
  passageRef: string;
  translation: string;
  passageText: string;
  word: string;
  fallback: "" | "text" | "tts";
  reflection: string;
  momentSermon: string;
  momentStart: string;
  momentEnd: string;
  prayQuestion: string;
  prayText: string;
  carryRef: string;
}

export function formFrom(d: DevotionalAdmin | null | undefined, date: string, translation: string): FormState {
  return {
    title: d?.title ?? "",
    evergreen: d ? d.is_evergreen : false,
    date: d?.date ?? date,
    author: d?.author_speaker_id ?? "",
    breathIn: d?.still_breath_in ?? "",
    breathOut: d?.still_breath_out ?? "",
    stillSeconds: d?.still_seconds != null ? String(d.still_seconds) : "",
    passageRef: d?.passage_ref ?? "",
    translation: d?.passage_translation ?? translation,
    passageText: d?.passage_text ?? "",
    word: d?.suggested_word ?? "",
    fallback: d?.reading_fallback ?? "",
    reflection: d?.reflection_md ?? "",
    momentSermon: d?.moment_sermon_id ?? "",
    momentStart: formatClock(d?.moment_start_s),
    momentEnd: formatClock(d?.moment_end_s),
    prayQuestion: d?.pray_question ?? "",
    prayText: d?.pray_text ?? "",
    carryRef: d?.carry_verse_ref ?? "",
  };
}

export type FormErrors = Partial<Record<keyof FormState, string>>;

/** Client-side checks that mirror the server's, so most mistakes never reach a 422. */
export function validate(f: FormState): FormErrors {
  const e: FormErrors = {};
  if (!f.title.trim()) e.title = "Give it a title.";
  if (!f.evergreen && !f.date) e.date = "Pick a date, or make it evergreen.";
  if (!f.passageRef.trim()) e.passageRef = "Add the passage reference.";
  if (!f.passageText.trim()) e.passageText = "Add the passage text.";
  if (f.word && !wordInPassage(f.word, f.passageText)) {
    e.word = "The suggested word has to appear in the passage.";
  }
  if (!f.reflection.trim()) e.reflection = "Write the reflection.";
  if (!f.prayQuestion.trim()) e.prayQuestion = "Add a question to sit with.";
  if (!f.prayText.trim()) e.prayText = "Add the prayer.";
  if (f.stillSeconds) {
    const n = Number(f.stillSeconds);
    if (!Number.isInteger(n) || n < 10 || n > 600) e.stillSeconds = "Between 10 and 600 seconds.";
  }
  if (f.momentSermon) {
    const s = parseClock(f.momentStart);
    const en = parseClock(f.momentEnd);
    if (s == null || Number.isNaN(s)) e.momentStart = "Use m:ss.";
    if (en == null || Number.isNaN(en)) e.momentEnd = "Use m:ss.";
    else if (s != null && !Number.isNaN(s)) {
      if (en <= s) e.momentEnd = "End must be after the start.";
      else if (en - s > 600) e.momentEnd = "Keep the moment to 10 minutes or less.";
    }
  }
  return e;
}

export function toBody(f: FormState): DevotionalCreate {
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  return {
    title: f.title.trim(),
    date: f.evergreen ? null : f.date,
    author_speaker_id: opt(f.author),
    still_breath_in: opt(f.breathIn),
    still_breath_out: opt(f.breathOut),
    still_seconds: f.stillSeconds ? Number(f.stillSeconds) : null,
    passage_ref: f.passageRef.trim(),
    passage_translation: f.translation,
    passage_text: f.passageText.trim(),
    suggested_word: opt(f.word),
    reading_fallback: f.fallback || null,
    reflection_md: f.reflection.trim(),
    moment_sermon_id: opt(f.momentSermon),
    moment_start_s: f.momentSermon ? parseClock(f.momentStart) : null,
    moment_end_s: f.momentSermon ? parseClock(f.momentEnd) : null,
    pray_question: f.prayQuestion.trim(),
    pray_text: f.prayText.trim(),
    carry_verse_ref: opt(f.carryRef),
  };
}

function errorText(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId ? `${err.detail} (reference: ${err.correlationId})` : err.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

export function DevotionalEditor({ devotionalId }: { devotionalId: string | null }) {
  const query = useDevotional(devotionalId);
  const settings = useDevotionalSettings();
  const search = useSearchParams();

  if (devotionalId && query.isPending) {
    return <div className="h-[600px] rounded-16 border border-border bg-surface" aria-busy />;
  }
  if (devotionalId && query.isError) {
    return (
      <Alert variant="error" title="Couldn’t load this devotional">
        {errorText(query.error, "It may have been deleted.")}{" "}
        <Link href="/devotionals" className="underline">
          Back to Devotionals
        </Link>
      </Alert>
    );
  }
  return (
    <EditorBody
      key={query.data?.id ?? "new"}
      devotional={query.data ?? null}
      initialDate={search.get("date") ?? ""}
      defaultTranslation={settings.data?.default_translation ?? "kjv"}
      allowOverride={settings.data?.allow_override ?? true}
      churchFallback={settings.data?.reading_fallback ?? "text"}
    />
  );
}

function EditorBody({
  devotional,
  initialDate,
  defaultTranslation,
  allowOverride,
  churchFallback,
}: {
  devotional: DevotionalAdmin | null;
  initialDate: string;
  defaultTranslation: string;
  allowOverride: boolean;
  churchFallback: "text" | "tts";
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { role, id: userId } = useSession();
  const isManager = role === "manager" || role === "admin";
  const status = devotional?.status ?? "draft";
  const editable =
    !devotional ||
    status === "draft" ||
    status === "rejected" ||
    (isManager && status === "pending_review");

  const initial = React.useMemo(
    () => formFrom(devotional, initialDate, defaultTranslation),
    [devotional, initialDate, defaultTranslation],
  );
  const [form, setForm] = React.useState<FormState>(initial);
  const [touched, setTouched] = React.useState(false);
  const [alert, setAlert] = React.useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState<number | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [showReject, setShowReject] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const save = useSaveDevotional();
  const action = useDevotionalAction();
  const history = useDevotionalHistory(devotional?.id ?? null);
  const speakers = useSpeakers();
  const [sermonQ, setSermonQ] = React.useState("");
  const sermons = useSermons({ status: "published", q: sermonQ || undefined, limit: 20 });

  const errors = touched ? validate(form) : {};
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave(): Promise<DevotionalAdmin | null> {
    setTouched(true);
    if (Object.keys(validate(form)).length) {
      setAlert({ kind: "error", text: "Some fields need attention before saving." });
      return null;
    }
    try {
      const row = await save.mutateAsync({ id: devotional?.id ?? null, body: toBody(form) });
      setAlert({ kind: "success", text: "Saved." });
      if (!devotional) router.replace(`/devotionals/${row.id}`);
      return row;
    } catch (err) {
      setAlert({ kind: "error", text: errorText(err, "Couldn’t save.") });
      return null;
    }
  }

  async function run(a: DevotionalAction, note?: string) {
    if (!devotional) return;
    if (a === "submit" && dirty) {
      const saved = await handleSave();
      if (!saved) return;
    }
    try {
      await action.mutateAsync({ id: devotional.id, action: a, note });
      if (a === "delete") {
        router.push("/devotionals");
        return;
      }
      setShowReject(false);
      setAlert({ kind: "success", text: ACTION_DONE[a] });
    } catch (err) {
      setAlert({ kind: "error", text: errorText(err, "That didn’t work.") });
    }
  }

  async function handleLookup() {
    if (!form.passageRef.trim()) return;
    setLookupBusy(true);
    try {
      const r = await lookupPassage(form.passageRef.trim(), form.translation);
      setForm((f) => ({ ...f, passageText: r.text, passageRef: r.ref || f.passageRef }));
      setAlert(null);
    } catch (err) {
      setAlert({ kind: "error", text: errorText(err, "Couldn’t find that passage. Paste the text instead.") });
    } finally {
      setLookupBusy(false);
    }
  }

  async function handleFile(file: File) {
    if (!devotional) return;
    setUploadPct(0);
    try {
      const row = await uploadReading(devotional.id, file, setUploadPct);
      qc.setQueryData(queryKeys.devotionals.detail(row.id), row);
      setAlert({ kind: "success", text: "Reading attached." });
    } catch (err) {
      setAlert({ kind: "error", text: describeUploadFailure(err).message });
    } finally {
      setUploadPct(null);
    }
  }

  async function handleRemoveReading() {
    if (!devotional) return;
    try {
      const row = await removeReading(devotional.id);
      qc.setQueryData(queryKeys.devotionals.detail(row.id), row);
    } catch (err) {
      setAlert({ kind: "error", text: errorText(err, "Couldn’t remove the reading.") });
    }
  }

  const ownWork = devotional?.created_by === userId;
  const busy = save.isPending || action.isPending;
  const words = React.useMemo(() => candidateWords(form.passageText).slice(0, 40), [form.passageText]);
  const effectiveFallback = devotional?.reading_url
    ? "text"
    : allowOverride && form.fallback
      ? form.fallback
      : churchFallback;

  return (
    <div className="flex flex-col gap-20">
      <PageHeader
        title={devotional ? devotional.title || "Untitled devotional" : "New devotional"}
        subhead={
          <span className="flex flex-wrap items-center gap-8">
            <Link href="/devotionals" className="text-clay-600 hover:underline">
              Devotionals
            </Link>
            <span aria-hidden>·</span>
            {devotional ? <StatusPill status={devotional.display_status} /> : <span>Draft</span>}
            {devotional?.date ? <span>{dayLabel(devotional.date)}</span> : null}
          </span>
        }
        actions={
          editable ? (
            <Button onClick={() => void handleSave()} disabled={busy || (!!devotional && !dirty)}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null
        }
      />

      {alert ? (
        <Alert variant={alert.kind} title={alert.kind === "error" ? "Not saved" : alert.text}>
          {alert.kind === "error" ? alert.text : null}
        </Alert>
      ) : null}
      {status === "rejected" && history.data?.[0]?.note ? (
        <Alert variant="warning" title="Changes requested">
          {history.data[0].note}
        </Alert>
      ) : null}
      {!editable ? (
        <Alert variant="warning" title="This devotional is read-only">
          {status === "approved"
            ? "It is approved. A manager can request changes to edit it again."
            : status === "pending_review"
              ? "It is waiting for review. Withdraw it to keep editing."
              : "Restore it to edit."}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-16 min-[1200px]:grid-cols-[1fr_360px]">
        <fieldset disabled={!editable || busy} className="flex min-w-0 flex-col gap-16">
          <Card className="flex flex-col gap-14">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <EditorField label="Title" htmlFor="dv-title" error={errors.title}>
              <Input id="dv-title" value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} error={!!errors.title} />
            </EditorField>
            <div className="grid grid-cols-1 gap-14 sm:grid-cols-2">
              <EditorField
                label="Date"
                htmlFor="dv-date"
                error={errors.date}
                hint={form.evergreen ? "Evergreen devotionals have no date. They fill empty days." : "Shows on this date in each listener’s time zone."}
              >
                <Input id="dv-date" type="date" value={form.evergreen ? "" : form.date} disabled={form.evergreen} onChange={(e) => set("date", e.target.value)} error={!!errors.date} />
              </EditorField>
              <EditorField label="Written by" htmlFor="dv-author">
                <Select id="dv-author" value={form.author} onChange={(e) => set("author", e.target.value)}>
                  <option value="">Nobody named</option>
                  {(speakers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </EditorField>
            </div>
            <label className="flex items-center gap-10 text-[14px]">
              <Switch checked={form.evergreen} onCheckedChange={(v) => set("evergreen", v)} aria-label="Evergreen" />
              Evergreen (no date, part of the fallback pool)
            </label>
          </Card>

          <Section n={1} title="Still" hint="A guided breath before the reading. Leave blank to use the church defaults.">
            <div className="grid grid-cols-1 gap-14 sm:grid-cols-3">
              <EditorField label="Breathe in" htmlFor="dv-in">
                <Input id="dv-in" value={form.breathIn} maxLength={80} placeholder="Be still" onChange={(e) => set("breathIn", e.target.value)} />
              </EditorField>
              <EditorField label="Breathe out" htmlFor="dv-out">
                <Input id="dv-out" value={form.breathOut} maxLength={80} placeholder="and know" onChange={(e) => set("breathOut", e.target.value)} />
              </EditorField>
              <EditorField label="Seconds" htmlFor="dv-secs" error={errors.stillSeconds}>
                <Input id="dv-secs" inputMode="numeric" value={form.stillSeconds} placeholder="Church default" onChange={(e) => set("stillSeconds", e.target.value.replace(/\D/g, ""))} error={!!errors.stillSeconds} />
              </EditorField>
            </div>
          </Section>

          <Section n={2} title="Hear" hint="The passage, and the word you suggest listeners hold onto.">
            <div className="grid grid-cols-1 gap-14 sm:grid-cols-[1fr_120px_auto] sm:items-end">
              <EditorField label="Passage" htmlFor="dv-ref" error={errors.passageRef}>
                <Input id="dv-ref" value={form.passageRef} maxLength={100} placeholder="Psalm 46:10-11" onChange={(e) => set("passageRef", e.target.value)} error={!!errors.passageRef} />
              </EditorField>
              <EditorField label="Translation" htmlFor="dv-tr">
                <Select id="dv-tr" value={form.translation} onChange={(e) => set("translation", e.target.value)}>
                  {TRANSLATIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </EditorField>
              <Button
                type="button"
                variant="secondary"
                disabled={!AUTOFILL.has(form.translation) || !form.passageRef.trim() || lookupBusy}
                onClick={() => void handleLookup()}
                title={AUTOFILL.has(form.translation) ? undefined : "Auto-fill works for KJV and WEB. Paste other translations."}
              >
                {lookupBusy ? "Finding…" : "Fill text"}
              </Button>
            </div>
            <EditorField label="Passage text" htmlFor="dv-text" error={errors.passageText} hint="Verse numbers like “10” or “[10]” at the start of a line become verse markers in the app.">
              <Textarea id="dv-text" rows={6} value={form.passageText} onChange={(e) => set("passageText", e.target.value)} />
            </EditorField>
            <EditorField label="Suggested word" htmlFor="dv-word" error={errors.word} hint="Listeners can pick their own. This one is highlighted first.">
              <Input id="dv-word" value={form.word} maxLength={40} onChange={(e) => set("word", e.target.value)} error={!!errors.word} />
            </EditorField>
            {words.length ? (
              <div className="flex flex-wrap gap-6" aria-label="Pick a word from the passage">
                {words.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => set("word", w)}
                    aria-pressed={form.word.toLowerCase() === w.toLowerCase()}
                    className={cn(
                      "h-[26px] rounded-full border px-10 text-[12.5px]",
                      form.word.toLowerCase() === w.toLowerCase()
                        ? "border-clay-600 bg-clay-50 text-clay-700"
                        : "border-border text-ink-muted hover:bg-clay-50",
                    )}
                  >
                    {w}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-10 rounded-12 border border-border-subtle bg-surface-sunken p-14">
              <p className="text-[13px] font-medium text-ink-muted">Pastor’s reading (optional)</p>
              {devotional?.reading_url ? (
                <div className="flex flex-wrap items-center gap-12">
                  <audio controls src={devotional.reading_url} className="h-[36px] max-w-full" />
                  <span className="font-mono text-[12px] text-ink-faint">{formatClock(devotional.reading_duration_s)}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleRemoveReading()}>
                    Remove
                  </Button>
                </div>
              ) : devotional ? (
                <div className="flex flex-wrap items-center gap-12">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".mp3,.m4a,.aac,.wav,audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" size="sm" variant="secondary" disabled={uploadPct !== null} onClick={() => fileRef.current?.click()}>
                    {uploadPct !== null ? `Uploading ${Math.round(uploadPct * 100)}%` : "Upload a reading"}
                  </Button>
                  <span className="text-[12.5px] text-ink-faint">MP3, M4A, AAC or WAV, up to 30 MB.</span>
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-faint">Save the devotional first, then upload a recording.</p>
              )}
              {!devotional?.reading_url ? (
                allowOverride ? (
                  <EditorField label="Without a recording" htmlFor="dv-fb">
                    <Select id="dv-fb" value={form.fallback} onChange={(e) => set("fallback", e.target.value as FormState["fallback"])}>
                      <option value="">Church default ({churchFallback === "tts" ? "read aloud" : "text only"})</option>
                      <option value="text">Text only</option>
                      <option value="tts">Read aloud by the phone</option>
                    </Select>
                  </EditorField>
                ) : (
                  <p className="text-[12.5px] text-ink-faint">
                    Without a recording, the app shows {churchFallback === "tts" ? "the text and reads it aloud" : "the text only"} (church setting).
                  </p>
                )
              ) : null}
            </div>
          </Section>

          <Section n={3} title="Ponder" hint="The reflection. Markdown works: *italic*, **bold**, > quotes, and blank lines between paragraphs.">
            <EditorField label="Reflection" htmlFor="dv-refl" error={errors.reflection}>
              <Textarea id="dv-refl" rows={10} value={form.reflection} onChange={(e) => set("reflection", e.target.value)} />
            </EditorField>
            <div className="flex flex-col gap-10 rounded-12 border border-border-subtle bg-surface-sunken p-14">
              <p className="text-[13px] font-medium text-ink-muted">Sermon moment (optional)</p>
              <div className="grid grid-cols-1 gap-12 sm:grid-cols-[1fr_1fr]">
                <EditorField label="Find a published sermon" htmlFor="dv-sq">
                  <Input id="dv-sq" value={sermonQ} placeholder="Search titles" onChange={(e) => setSermonQ(e.target.value)} />
                </EditorField>
                <EditorField label="Sermon" htmlFor="dv-sermon">
                  <Select id="dv-sermon" value={form.momentSermon} onChange={(e) => set("momentSermon", e.target.value)}>
                    <option value="">None</option>
                    {devotional?.moment_sermon_id && !sermons.data?.items.some((s) => s.id === devotional.moment_sermon_id) ? (
                      <option value={devotional.moment_sermon_id}>{devotional.moment_sermon_title ?? "Current sermon"}</option>
                    ) : null}
                    {(sermons.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </Select>
                </EditorField>
              </div>
              {form.momentSermon ? (
                <div className="grid grid-cols-2 gap-12 sm:w-[300px]">
                  <EditorField label="Start (m:ss)" htmlFor="dv-ms" error={errors.momentStart}>
                    <Input id="dv-ms" className="font-mono" value={form.momentStart} placeholder="12:40" onChange={(e) => set("momentStart", e.target.value)} />
                  </EditorField>
                  <EditorField label="End (m:ss)" htmlFor="dv-me" error={errors.momentEnd}>
                    <Input id="dv-me" className="font-mono" value={form.momentEnd} placeholder="14:10" onChange={(e) => set("momentEnd", e.target.value)} />
                  </EditorField>
                </div>
              ) : null}
            </div>
          </Section>

          <Section n={4} title="Pray" hint="A question to sit with, then a prayer listeners can make their own.">
            <EditorField label="Question" htmlFor="dv-q" error={errors.prayQuestion}>
              <Input id="dv-q" value={form.prayQuestion} maxLength={300} onChange={(e) => set("prayQuestion", e.target.value)} error={!!errors.prayQuestion} />
            </EditorField>
            <EditorField label="Prayer" htmlFor="dv-p" error={errors.prayText}>
              <Textarea id="dv-p" rows={5} value={form.prayText} onChange={(e) => set("prayText", e.target.value)} />
            </EditorField>
          </Section>

          <Section n={5} title="Carry" hint="A short verse to take into the day. Defaults to the passage.">
            <EditorField label="Verse to carry" htmlFor="dv-carry">
              <Input id="dv-carry" value={form.carryRef} maxLength={100} placeholder={form.passageRef || "Psalm 46:10"} onChange={(e) => set("carryRef", e.target.value)} />
            </EditorField>
          </Section>
        </fieldset>

        <div className="flex flex-col gap-16 min-[1200px]:sticky min-[1200px]:top-16">
          <DevotionalPreview form={form} hasReading={!!devotional?.reading_url} fallback={effectiveFallback} />

          {devotional ? (
            <Card className="flex flex-col gap-10">
              <CardHeader>
                <CardTitle>Workflow</CardTitle>
              </CardHeader>
              <WorkflowButtons
                status={status}
                isManager={isManager}
                isAdmin={role === "admin"}
                ownWork={ownWork}
                busy={busy}
                onAction={(a) => (a === "reject" ? setShowReject(true) : void run(a))}
              />
              {showReject ? (
                <div className="flex flex-col gap-8">
                  <EditorField label="What needs changing?" htmlFor="dv-note">
                    <Textarea id="dv-note" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                  </EditorField>
                  <div className="flex gap-8">
                    <Button size="sm" variant="destructive" disabled={!rejectNote.trim() || busy} onClick={() => void run("reject", rejectNote.trim())}>
                      Send back
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
              {history.data?.length ? (
                <ol className="mt-4 flex flex-col gap-6 border-t border-border-subtle pt-10 text-[12.5px] text-ink-muted">
                  {history.data.slice(0, 6).map((h, i) => (
                    <li key={i}>
                      <span className="text-ink">{h.actor_name ?? "Someone"}</span> {h.from_status ? `${h.from_status.replace("_", " ")} → ` : ""}
                      {h.to_status.replace("_", " ")}
                      <span className="ml-6 font-mono text-[11px] text-ink-faint">{h.created_at.slice(0, 10)}</span>
                      {h.note ? <span className="block italic">“{h.note}”</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const ACTION_DONE: Record<DevotionalAction, string> = {
  submit: "Sent for review.",
  withdraw: "Withdrawn. You can keep editing.",
  approve: "Approved. It will show on its date.",
  reject: "Sent back with your note.",
  archive: "Archived.",
  restore: "Restored as a draft.",
  delete: "Deleted.",
};

/** Which workflow actions a role may take from a status (mirrors the server's TRANSITIONS table). */
export function availableActions(
  status: DevotionalAdmin["status"],
  opts: { isManager: boolean; isAdmin: boolean; ownWork: boolean },
): DevotionalAction[] {
  const canApprove = opts.isManager && (!opts.ownWork || opts.isAdmin);
  switch (status) {
    case "draft":
    case "rejected":
      return [
        ...(opts.ownWork || opts.isManager ? (["submit"] as const) : []),
        ...(opts.isManager ? (["archive"] as const) : []),
        ...(opts.ownWork || opts.isManager ? (["delete"] as const) : []),
      ];
    case "pending_review":
      return [
        ...(canApprove ? (["approve"] as const) : []),
        ...(opts.isManager ? (["reject"] as const) : []),
        ...(opts.ownWork || opts.isManager ? (["withdraw"] as const) : []),
      ];
    case "approved":
      return opts.isManager ? ["reject", "archive"] : [];
    case "archived":
      return opts.isManager ? ["restore", "delete"] : [];
    default:
      return [];
  }
}

const ACTION_LABEL: Record<DevotionalAction, string> = {
  submit: "Submit for review",
  withdraw: "Withdraw",
  approve: "Approve",
  reject: "Request changes",
  archive: "Archive",
  restore: "Restore",
  delete: "Delete",
};

function WorkflowButtons({
  status,
  isManager,
  isAdmin,
  ownWork,
  busy,
  onAction,
}: {
  status: DevotionalAdmin["status"];
  isManager: boolean;
  isAdmin: boolean;
  ownWork: boolean;
  busy: boolean;
  onAction: (a: DevotionalAction) => void;
}) {
  const actions = availableActions(status, { isManager, isAdmin, ownWork });
  const selfBlocked = isManager && !isAdmin && ownWork && status === "pending_review";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-8">
        {actions.map((a, i) => (
          <Button
            key={a}
            size="sm"
            variant={a === "delete" ? "destructive" : i === 0 ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => {
              if (a === "delete" && !window.confirm("Delete this devotional? This can’t be undone.")) return;
              onAction(a);
            }}
          >
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      {selfBlocked ? (
        <p className="text-[12.5px] text-ink-faint">Another manager needs to approve your own devotional.</p>
      ) : null}
    </div>
  );
}

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-14">
      <div className="flex flex-col gap-4">
        <h2 className="flex items-baseline gap-10 text-[16px] font-semibold text-ink">
          <span className="font-mono text-[12px] text-clay-600">{String(n).padStart(2, "0")}</span>
          {title}
        </h2>
        <p className="text-[13px] text-ink-muted">{hint}</p>
      </div>
      {children}
    </Card>
  );
}
