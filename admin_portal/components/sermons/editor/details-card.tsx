"use client";

import { useRef, useState } from "react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tag } from "@/components/ui/tag";
import { EditorField } from "@/components/sermons/editor/field";
import type {
  SermonFormValues,
  SermonPatch,
} from "@/lib/query/hooks/use-autosave-sermon";
import type { Speaker } from "@/lib/query/hooks/use-speakers";
import type { Category } from "@/lib/query/hooks/use-categories";
import type { SeriesListItem } from "@/lib/query/hooks/use-series";

/* =============================================================================
   Details card (design Screen 4, left column, top).

   Title · Description (4 rows) · a 2-up grid of Speaker / Category / Series /
   Episode number (episode in mono) · removable tag pills + a dashed
   "+ add tag" that opens an inline text entry.

   Holds no field state: the parent owns the form object and the autosave
   queue. Every change calls `onChange(patch)` (debounced save) and every blur
   calls `onCommit()` (flush). Tag add/remove goes through the same `onChange`
   → the `tags` array is sent on the normal PATCH (no dedicated tag endpoint on
   the contract).
   ========================================================================== */

export interface DetailsCardProps {
  values: SermonFormValues;
  onChange: (patch: SermonPatch) => void;
  onCommit: () => void;
  disabled?: boolean;
  titleError?: string | null;
  speakers: Speaker[] | undefined;
  categories: Category[] | undefined;
  series: SeriesListItem[] | undefined;
}

function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase();
}

export function DetailsCard({
  values,
  onChange,
  onCommit,
  disabled = false,
  titleError,
  speakers,
  categories,
  series,
}: DetailsCardProps) {
  const [adding, setAdding] = useState(false);
  const [draftTag, setDraftTag] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const commitTag = () => {
    const tag = normaliseTag(draftTag);
    // Clear the draft + close the entry BEFORE the side effects. Pressing
    // Enter closes the input, which fires its `onBlur` → a second `commitTag`;
    // by then `draftTag` is "" so that call is a no-op instead of a double add.
    setDraftTag("");
    setAdding(false);
    if (tag && !values.tags.includes(tag)) {
      onChange({ tags: [...values.tags, tag] });
      onCommit();
    }
  };

  const removeTag = (tag: string) => {
    onChange({ tags: values.tags.filter((t) => t !== tag) });
    onCommit();
  };

  return (
    <Card className="flex flex-col gap-16 p-22">
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>

      <EditorField label="Title" htmlFor="sermon-title" error={titleError}>
        <Input
          id="sermon-title"
          value={values.title}
          disabled={disabled}
          error={Boolean(titleError)}
          placeholder="Untitled sermon"
          onChange={(e) => onChange({ title: e.target.value })}
          onBlur={onCommit}
        />
      </EditorField>

      <EditorField label="Description" htmlFor="sermon-description">
        <Textarea
          id="sermon-description"
          rows={4}
          value={values.description}
          disabled={disabled}
          placeholder="What is this message about?"
          onChange={(e) => onChange({ description: e.target.value })}
          onBlur={onCommit}
        />
      </EditorField>

      <div className="grid grid-cols-1 gap-16 min-[560px]:grid-cols-2">
        <EditorField label="Speaker" htmlFor="sermon-speaker">
          <Select
            id="sermon-speaker"
            inputSize="dense"
            value={values.speaker_id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              onChange({ speaker_id: e.target.value || null });
              onCommit();
            }}
          >
            <option value="">No speaker</option>
            {(speakers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </EditorField>

        <EditorField label="Category" htmlFor="sermon-category">
          <Select
            id="sermon-category"
            inputSize="dense"
            value={values.category_id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              onChange({ category_id: e.target.value || null });
              onCommit();
            }}
          >
            <option value="">No category</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </EditorField>

        <EditorField label="Series" htmlFor="sermon-series">
          <Select
            id="sermon-series"
            inputSize="dense"
            value={values.series_id ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const nextSeriesId = e.target.value || null;
              const patch: SermonPatch = { series_id: nextSeriesId };
              // Prefill Category from the picked series, but only when the
              // editor hasn't chosen one — never clobber an explicit choice.
              // Clearing the series (nextSeriesId === null) leaves Category be.
              if (nextSeriesId && !values.category_id) {
                const inherited =
                  series?.find((s) => s.id === nextSeriesId)?.category_id ??
                  null;
                if (inherited) patch.category_id = inherited;
              }
              onChange(patch);
              onCommit();
            }}
          >
            <option value="">Standalone</option>
            {(series ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </EditorField>

        <EditorField
          label="Episode number"
          htmlFor="sermon-episode"
          hint={values.series_id ? undefined : "Only used inside a series."}
        >
          <Input
            id="sermon-episode"
            inputSize="dense"
            inputMode="numeric"
            className="font-mono"
            value={values.episode_number ?? ""}
            disabled={disabled || !values.series_id}
            placeholder="—"
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, "");
              onChange({
                episode_number: digits === "" ? null : Number(digits),
              });
            }}
            onBlur={onCommit}
          />
        </EditorField>
      </div>

      <EditorField label="Tags">
        <div className="flex flex-wrap items-center gap-8">
          {values.tags.map((tag) => (
            <Tag
              key={tag}
              onRemove={disabled ? undefined : () => removeTag(tag)}
              removeLabel={`Remove tag ${tag}`}
            >
              {tag}
            </Tag>
          ))}

          {adding && !disabled ? (
            <input
              ref={addInputRef}
              autoFocus
              value={draftTag}
              aria-label="New tag"
              className="h-[28px] rounded-full border border-border bg-canvas px-11 text-[13px] text-ink outline-none focus-visible:focus-ring-input"
              onChange={(e) => setDraftTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTag();
                } else if (e.key === "Escape") {
                  setDraftTag("");
                  setAdding(false);
                }
              }}
              onBlur={commitTag}
            />
          ) : (
            <Tag
              variant="add"
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              onClick={() => !disabled && setAdding(true)}
              onKeyDown={(e) => {
                if (!disabled && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setAdding(true);
                }
              }}
              className={
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }
            >
              + add tag
            </Tag>
          )}
        </div>
      </EditorField>
    </Card>
  );
}
