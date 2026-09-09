"use client";

import * as React from "react";

import { PageHeader } from "@/components/portal";
import { AddSpeakerCard } from "./add-speaker-card";
import { CategoriesCard } from "./categories-card";
import { SpeakersPanel } from "./speakers-panel";

/* =============================================================================
   PeopleScreen — Speakers & categories (design Screen 7, plan W12).

   Header + subhead, then a `1.4fr 1fr` grid (gap 16): the Speakers panel on the
   left, and a right column of the Categories card over the Add-speaker card.
   The panel's "Add speaker" button focuses that form. Everything below the
   header is client React Query (lists, per-entity count probes, mutations).
   ========================================================================== */

export function PeopleScreen() {
  const nameRef = React.useRef<HTMLInputElement>(null);

  const focusAddSpeaker = React.useCallback(() => {
    const el = nameRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus();
  }, []);

  return (
    <>
      <PageHeader
        title="Speakers & categories"
        subhead="Deleting either detaches it from sermons — it never deletes content."
      />

      <div className="grid grid-cols-1 gap-16 md:grid-cols-[1.4fr_1fr]">
        <SpeakersPanel onAddSpeaker={focusAddSpeaker} />
        <div className="flex flex-col gap-16">
          <CategoriesCard />
          <AddSpeakerCard nameRef={nameRef} />
        </div>
      </div>
    </>
  );
}
