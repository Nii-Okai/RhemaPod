"use client";

import * as React from "react";
import { cn } from "cn";

import type { FormState } from "@/components/devotionals/devotional-editor";

/* =============================================================================
   A phone-sized preview of the five steps, in the app's dark palette
   (mobile/theme/colors.ts), so a planner sees roughly what a listener will.
   It is a guide, not a pixel match: the app renders each step full-screen.
   ========================================================================== */

const STEPS = ["Still", "Hear", "Ponder", "Pray", "Carry"] as const;
type Step = (typeof STEPS)[number];

function highlight(text: string, word: string): React.ReactNode {
  const w = word.trim();
  if (!w) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_'])(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}_'])`, "iu");
  const m = re.exec(text);
  if (!m) return text;
  return (
    <>
      {text.slice(0, m.index)}
      <mark className="rounded-3 bg-[#C99A33]/25 px-2 text-[#E0B45C]">{m[0]}</mark>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

export function DevotionalPreview({
  form,
  hasReading,
  fallback,
}: {
  form: FormState;
  hasReading: boolean;
  fallback: "text" | "tts";
}) {
  const [step, setStep] = React.useState<Step>("Hear");
  return (
    <div className="flex flex-col gap-10">
      <div role="tablist" aria-label="Preview step" className="flex gap-4">
        {STEPS.map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={step === s}
            onClick={() => setStep(s)}
            className={cn(
              "h-[28px] flex-1 rounded-8 text-[12.5px] font-medium",
              step === s ? "bg-dark text-canvas" : "text-ink-muted hover:bg-clay-50",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div
        aria-label="App preview"
        className="flex h-[560px] flex-col gap-14 overflow-y-auto rounded-[28px] border-[6px] border-dark bg-[#0D111A] p-20 text-[#E8E4DC]"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#E0B45C]">
          {step} · {STEPS.indexOf(step) + 1} of 5
        </p>
        <h3 className="font-serif text-[22px] leading-tight">{form.title || "Untitled"}</h3>

        {step === "Still" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-16 text-center">
            <span aria-hidden className="size-[120px] rounded-full border border-[#C99A33]/50 bg-[#C99A33]/10" />
            <p className="font-serif text-[18px]">{form.breathIn || "Breathe in…"}</p>
            <p className="font-serif text-[18px] text-[#9AA3B2]">{form.breathOut || "…and out"}</p>
            <p className="font-mono text-[11px] text-[#9AA3B2]">{form.stillSeconds || "church default"} s</p>
          </div>
        ) : null}

        {step === "Hear" ? (
          <>
            <p className="font-mono text-[11px] text-[#9AA3B2]">
              {form.passageRef || "Passage"} · {form.translation.toUpperCase()}
            </p>
            <p className="whitespace-pre-line font-serif text-[16px] leading-relaxed">
              {form.passageText ? highlight(form.passageText, form.word) : "The passage appears here."}
            </p>
            <p className="rounded-10 bg-[#131926] p-10 text-[12px] text-[#9AA3B2]">
              {hasReading
                ? "▶ Pastor’s reading"
                : fallback === "tts"
                  ? "▶ Read aloud by the phone"
                  : "Text only, no audio"}
            </p>
            <p className="text-[12px] text-[#9AA3B2]">Tap a word that stands out to keep it.</p>
          </>
        ) : null}

        {step === "Ponder" ? (
          <div className="flex flex-col gap-10 text-[14.5px] leading-relaxed">
            {(form.reflection || "The reflection appears here.").split(/\n{2,}/).map((p, i) => (
              <p key={i} className={p.startsWith(">") ? "border-l-2 border-[#C99A33] pl-10 italic" : undefined}>
                {p.replace(/^>\s?/, "").replace(/\*\*?([^*]+)\*\*?/g, "$1")}
              </p>
            ))}
            {form.momentSermon ? (
              <p className="rounded-10 bg-[#131926] p-10 text-[12px] text-[#9AA3B2]">
                ▶ Sermon moment {form.momentStart}–{form.momentEnd}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "Pray" ? (
          <>
            <p className="font-serif text-[18px] italic">{form.prayQuestion || "A question to sit with."}</p>
            <p className="rounded-10 bg-[#131926] p-10 text-[12px] text-[#9AA3B2]">Journal (stays on the phone)</p>
            <p className="whitespace-pre-line text-[14.5px] leading-relaxed">{form.prayText || "The prayer appears here."}</p>
          </>
        ) : null}

        {step === "Carry" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-12 text-center">
            {form.word ? <p className="font-serif text-[28px] text-[#E0B45C]">{form.word}</p> : null}
            <p className="font-mono text-[12px] text-[#9AA3B2]">{form.carryRef || form.passageRef || "Verse"}</p>
            <p className="text-[12px] text-[#9AA3B2]">Added to the word garden</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
