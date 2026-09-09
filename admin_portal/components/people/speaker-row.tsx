"use client";

import * as React from "react";

import { Avatar } from "@/components/portal/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/people/error-text";
import { useUpdateSpeaker, type Speaker } from "@/lib/query/hooks/use-speakers";
import { useEntityCount, entityCountLabel } from "@/lib/query/hooks/use-entity-count";

/* =============================================================================
   SpeakerRow — one row of the Speakers panel (design Screen 7).

   padding 14px 20px, `border-subtle` divider, hover `surface-sunken`: a 38px
   initials avatar (rotating tint by name hash — the W2 `Avatar`), the name
   (14.5/600) over a truncated 13px bio (`ink-faint` "No bio yet" when absent),
   a mono sermon count, and a `···` menu with Edit / Delete.

   Edit swaps the row in place for name + bio fields (design §"inline"). Delete
   goes through `window.confirm` — the stopgap the W7/W11 rows use — with copy
   that names how many sermons detach and states the sermons themselves stay.
   Both the count and that number come from the one `useEntityCount` probe.
   ========================================================================== */

export interface SpeakerRowProps {
  speaker: Speaker;
  /** Bubble an inline-edit failure to the panel's card-top `<Alert>`. */
  onError: (message: string) => void;
  /** Confirmed delete — the panel owns the mutation (it stays mounted while this
      row unmounts on the optimistic removal, so it is where the `mutate`
      callbacks must live). The row still writes the confirm copy — it holds the
      count probe the copy names. */
  onDelete: () => void;
  /** A delete for this row is in flight — disables the menu. */
  deleting?: boolean;
  /** Clear the panel's card-top `<Alert>` after a successful inline edit. */
  onSuccess?: () => void;
}

function deleteCopy(name: string, count: number | undefined): string {
  if (typeof count !== "number") {
    return `Delete “${name}”? It’s removed as a speaker and detached from any sermons — the sermons themselves are not deleted.`;
  }
  const sermons = count === 1 ? "1 sermon" : `${count} sermons`;
  return `Delete “${name}”? It detaches from ${sermons} — those sermons stay, they just lose their speaker.`;
}

export function SpeakerRow({
  speaker,
  onError,
  onDelete,
  deleting = false,
  onSuccess,
}: SpeakerRowProps) {
  const count = useEntityCount("speaker", speaker.id);
  const update = useUpdateSpeaker();

  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(speaker.name);
  const [bio, setBio] = React.useState(speaker.bio ?? "");
  const nameEmpty = name.trim() === "";

  const startEdit = () => {
    setName(speaker.name);
    setBio(speaker.bio ?? "");
    setEditing(true);
  };

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (nameEmpty) return;
    const patch: { name?: string; bio?: string | null } = {};
    if (name.trim() !== speaker.name) patch.name = name.trim();
    if ((bio.trim() || null) !== (speaker.bio ?? null)) {
      patch.bio = bio.trim() || null;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: speaker.id, patch },
      {
        onSuccess: () => {
          setEditing(false);
          onSuccess?.();
        },
        onError: (err) =>
          onError(errorText(err, "Couldn’t save the speaker.")),
      },
    );
  };

  const confirmDelete = () => {
    if (!window.confirm(deleteCopy(speaker.name, count.data))) return;
    onDelete();
  };

  if (editing) {
    return (
      <form
        onSubmit={submitEdit}
        className="flex flex-col gap-10 px-20 py-[14px]"
        aria-label={`Edit ${speaker.name}`}
      >
        <Input
          aria-label="Name"
          inputSize="dense"
          autoFocus
          value={name}
          error={nameEmpty}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <Textarea
          aria-label="Bio"
          rows={2}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="No bio yet"
        />
        <div className="flex items-center gap-8">
          <Button
            type="submit"
            size="sm"
            disabled={update.isPending || nameEmpty}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-14 px-20 py-[14px] transition-colors duration-100 hover:bg-surface-sunken">
      <Avatar name={speaker.name} size={38} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14.5px] font-semibold text-ink">
          {speaker.name}
        </span>
        <span
          className={
            speaker.bio
              ? "truncate text-[13px] text-ink-muted"
              : "truncate text-[13px] text-ink-faint"
          }
        >
          {speaker.bio ?? "No bio yet"}
        </span>
      </div>

      <span
        className="shrink-0 font-mono text-[12px] tracking-[0.04em] text-ink-faint tabular-nums"
        title="Sermons by this speaker"
      >
        {entityCountLabel(count.data)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${speaker.name}`}
          className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-8 text-[16px] leading-none text-ink-faint outline-none transition-colors duration-[140ms] ease-out hover:bg-canvas hover:text-ink focus-visible:focus-ring-button data-[state=open]:bg-canvas data-[state=open]:text-ink"
        >
          <span aria-hidden>···</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={deleting} onSelect={startEdit}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={deleting}
            onSelect={confirmDelete}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
