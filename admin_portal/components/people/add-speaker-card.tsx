"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditorField } from "@/components/sermons/editor/field";
import { errorText } from "@/lib/people/error-text";
import { useCreateSpeaker } from "@/lib/query/hooks/use-speakers";

/* =============================================================================
   AddSpeakerCard — the right column's lower card (design Screen 7).

   Name (required) + Bio (3-row textarea) + a primary "Save speaker". POST
   /api/v1/speakers, then the optimistic prepend in `useCreateSpeaker` shows the
   row immediately; the `onSettled` refetch reconciles it. A blank name blocks
   submit with an inline error and fires no request. A request failure lands in
   a card-top `<Alert>`, never a toast (design §"Interactions & behavior").
   ========================================================================== */

export interface AddSpeakerCardProps {
  /** Focused by the Speakers-panel header's "Add speaker" button. */
  nameRef?: React.Ref<HTMLInputElement>;
}

export function AddSpeakerCard({ nameRef }: AddSpeakerCardProps) {
  const [name, setName] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);

  const create = useCreateSpeaker();
  const nameError =
    nameTouched && name.trim() === "" ? "A name is required." : null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setAlert(null);
    if (name.trim() === "") {
      setNameTouched(true);
      return;
    }
    create.mutate(
      { name: name.trim(), bio: bio.trim() || null },
      {
        onSuccess: () => {
          setName("");
          setBio("");
          setNameTouched(false);
        },
        onError: (err) =>
          setAlert(errorText(err, "Couldn’t add the speaker.")),
      },
    );
  };

  return (
    <section
      aria-labelledby="add-speaker-heading"
      className="flex flex-col gap-14 rounded-16 border border-border bg-surface p-20"
    >
      <h2 id="add-speaker-heading" className="text-section-title text-ink">
        Add speaker
      </h2>

      {alert ? (
        <Alert variant="error" title="That didn’t go through">
          {alert}
        </Alert>
      ) : null}

      <form className="flex flex-col gap-14" onSubmit={handleSubmit} noValidate>
        <EditorField label="Name" htmlFor="add-speaker-name" error={nameError}>
          <Input
            id="add-speaker-name"
            ref={nameRef}
            value={name}
            error={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setNameTouched(true)}
            placeholder="e.g. Ada Grace"
          />
        </EditorField>

        <EditorField label="Bio" htmlFor="add-speaker-bio">
          <Textarea
            id="add-speaker-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A sentence on who they are — shown on their sermons."
          />
        </EditorField>

        <div className="pt-2">
          <Button type="submit" size="md" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Save speaker"}
          </Button>
        </div>
      </form>
    </section>
  );
}
