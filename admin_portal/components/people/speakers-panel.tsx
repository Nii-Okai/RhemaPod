"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { errorText } from "@/lib/people/error-text";
import { useDeleteSpeaker, useSpeakers } from "@/lib/query/hooks/use-speakers";
import { SpeakerRow } from "./speaker-row";

/* =============================================================================
   SpeakersPanel — the left column of the Speakers & categories screen
   (design Screen 7, grid `1.4fr 1fr`).

   A header row ("Speakers" + a small "Add speaker" button that focuses the
   right-column form), then divided rows. Loading is a geometry-matched skeleton;
   a load failure and any per-row mutation failure both surface as a card-top
   `<Alert>` (design §"Interactions & behavior" — never a toast); an empty list
   gets the "No speakers yet" state.
   ========================================================================== */

export interface SpeakersPanelProps {
  /** Focus + scroll the "Add speaker" form (owned by the sibling card). */
  onAddSpeaker: () => void;
}

function RowSkeleton() {
  return (
    <div
      aria-hidden
      className="flex items-center gap-14 px-20 py-[14px]"
    >
      <span className="size-[38px] shrink-0 rounded-full bg-border-subtle" />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <span className="block h-[14px] w-[42%] rounded-4 bg-border-subtle" />
        <span className="block h-[12px] w-[68%] rounded-4 bg-border-subtle" />
      </div>
      <span className="h-[12px] w-[24px] shrink-0 rounded-4 bg-border-subtle" />
    </div>
  );
}

export function SpeakersPanel({ onAddSpeaker }: SpeakersPanelProps) {
  const speakers = useSpeakers();
  const remove = useDeleteSpeaker();
  const [alert, setAlert] = React.useState<string | null>(null);

  // Owned here, not in the row: the row unmounts on the optimistic removal, and
  // in React Query v5 a `mutate()` callback does not fire once its component is
  // gone — the panel stays mounted, so the rollback alert always lands.
  const deleteSpeaker = (id: string) => {
    setAlert(null);
    remove.mutate(id, {
      onError: (err) =>
        setAlert(errorText(err, "Couldn’t delete the speaker.")),
    });
  };

  return (
    <section
      aria-labelledby="speakers-heading"
      className="flex flex-col overflow-hidden rounded-16 border border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-12 border-b border-border-subtle px-20 py-14">
        <h2 id="speakers-heading" className="text-section-title text-ink">
          Speakers
        </h2>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onAddSpeaker}
        >
          Add speaker
        </Button>
      </div>

      {alert ? (
        <div className="px-20 pt-14">
          <Alert variant="error" title="That didn’t go through">
            <span className="flex items-center gap-10">
              <span>{alert}</span>
              <button
                type="button"
                onClick={() => setAlert(null)}
                className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
              >
                Dismiss
              </button>
            </span>
          </Alert>
        </div>
      ) : null}

      {speakers.isPending ? (
        <div className="divide-y divide-border-subtle">
          {Array.from({ length: 4 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : speakers.isError ? (
        <div className="p-20">
          <Alert variant="error" title="Couldn’t load speakers">
            {speakers.error instanceof Error
              ? speakers.error.message
              : "Please try again."}
          </Alert>
        </div>
      ) : !speakers.data || speakers.data.length === 0 ? (
        <div className="p-20">
          <EmptyState
            title="No speakers yet"
            description="Add a speaker on the right, then assign them to sermons."
          />
        </div>
      ) : (
        <div className="divide-y divide-border-subtle">
          {speakers.data.map((speaker) => (
            <SpeakerRow
              key={speaker.id}
              speaker={speaker}
              onError={setAlert}
              onDelete={() => deleteSpeaker(speaker.id)}
              deleting={remove.isPending && remove.variables === speaker.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}
