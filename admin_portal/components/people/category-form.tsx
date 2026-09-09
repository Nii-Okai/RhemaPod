"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditorField } from "@/components/sermons/editor/field";
import { isApiError } from "@/lib/api/errors";
import { errorText } from "@/lib/people/error-text";
import { SLUG_MAX_LENGTH, isValidSlug, slugify } from "@/lib/people/slug";
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type Category,
  type CategoryUpdate,
} from "@/lib/query/hooks/use-categories";

/* =============================================================================
   CategoryForm — the name + live slug-preview form the "+ new" pill reveals,
   and the same form an existing pill opens for editing (design Screen 7).

   The slug is client-slugified from the name and shown live in a Plex-Mono
   preview input on `surface-sunken`; the user can override it, which stops the
   auto-sync. It is re-validated against the backend's pattern
   (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) before submit. A **409 duplicate slug** renders
   inline on the preview field ("That slug is taken") — never a card alert; any
   other failure bubbles to the card-top `<Alert>` via `onError`.
   ========================================================================== */

const SLUG_HINT = "Lowercase letters, numbers and hyphens only.";

export interface CategoryFormProps {
  mode: "create" | "edit";
  category?: Category;
  /** Close without a mutation landing (Cancel, or an edit with no changes). */
  onDone: () => void;
  /** A create / update / delete succeeded — close *and* clear the card alert. */
  onSaved: () => void;
  onError: (message: string) => void;
}

function deleteCopy(name: string, count: number): string {
  const sermons = count === 1 ? "1 sermon" : `${count} sermons`;
  return `Delete “${name}”? ${sermons} ${
    count === 1 ? "is" : "are"
  } detached from it — those sermons stay, they just lose their category.`;
}

export function CategoryForm({
  mode,
  category,
  onDone,
  onSaved,
  onError,
}: CategoryFormProps) {
  const isEdit = mode === "edit" && category != null;

  const [name, setName] = React.useState(category?.name ?? "");
  const [slug, setSlug] = React.useState(category?.slug ?? "");
  // An existing slug is authoritative — never auto-resync it from the name.
  const [slugEdited, setSlugEdited] = React.useState(isEdit);
  // The user has interacted with the form — gates the inline name + slug errors.
  const [touched, setTouched] = React.useState(false);
  const [slugTaken, setSlugTaken] = React.useState(false);

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const sermonCount = category?.sermon_count ?? 0;
  const busy = create.isPending || update.isPending || remove.isPending;

  const nameError =
    touched && name.trim() === "" ? "A name is required." : null;
  const slugError = slugTaken
    ? "That slug is taken."
    : touched && slug.length > SLUG_MAX_LENGTH
      ? `Keep the slug to ${SLUG_MAX_LENGTH} characters or fewer.`
      : touched && !isValidSlug(slug)
        ? `Enter a valid slug — ${SLUG_HINT.toLowerCase()}`
        : null;

  const handleName = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
    setSlugTaken(false);
  };

  const handleSlug = (value: string) => {
    setSlug(value);
    setSlugEdited(true);
    setSlugTaken(false);
  };

  const onMutationError = (err: unknown, fallback: string) => {
    if (isApiError(err) && err.status === 409) {
      setSlugTaken(true);
      return;
    }
    onError(errorText(err, fallback));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (name.trim() === "" || !isValidSlug(slug)) return;

    if (!isEdit) {
      create.mutate(
        { name: name.trim(), slug },
        {
          onSuccess: onSaved,
          onError: (err) =>
            onMutationError(err, "Couldn’t create the category."),
        },
      );
      return;
    }

    const patch: CategoryUpdate = {};
    if (name.trim() !== category.name) patch.name = name.trim();
    if (slug !== category.slug) patch.slug = slug;
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    update.mutate(
      { id: category.id, patch },
      {
        onSuccess: onSaved,
        onError: (err) => onMutationError(err, "Couldn’t save the category."),
      },
    );
  };

  const handleDelete = () => {
    if (!isEdit) return;
    if (!window.confirm(deleteCopy(category.name, sermonCount))) return;
    remove.mutate(category.id, {
      onSuccess: onSaved,
      onError: (err) => onError(errorText(err, "Couldn’t delete the category.")),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={isEdit ? `Edit ${category.name}` : "New category"}
      className="flex flex-col gap-12 rounded-12 border border-border-subtle p-14"
    >
      <EditorField label="Name" htmlFor="category-name" error={nameError}>
        <Input
          id="category-name"
          inputSize="dense"
          autoFocus
          value={name}
          error={Boolean(nameError)}
          onChange={(e) => handleName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Sunday Morning"
        />
      </EditorField>

      <EditorField
        label="Slug"
        htmlFor="category-slug"
        error={slugError}
        hint={isEdit ? "Changing this changes the category's public URL." : SLUG_HINT}
      >
        <Input
          id="category-slug"
          inputSize="dense"
          className="bg-surface-sunken font-mono text-[13px] tracking-[0.02em]"
          value={slug}
          error={Boolean(slugError)}
          onChange={(e) => handleSlug(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="sunday-morning"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </EditorField>

      <div className="flex items-center gap-8">
        <Button type="submit" size="sm" disabled={busy}>
          {create.isPending || update.isPending
            ? "Saving…"
            : isEdit
              ? "Save"
              : "Add category"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDone}
        >
          Cancel
        </Button>
        {isEdit ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="ml-auto"
            disabled={busy}
            onClick={handleDelete}
          >
            {remove.isPending ? "Deleting…" : `Delete (${sermonCount})`}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
