"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Tag } from "@/components/ui/tag";
import { EmptyState } from "@/components/portal";
import { useCategories, type Category } from "@/lib/query/hooks/use-categories";
import { CategoryForm } from "./category-form";

/* =============================================================================
   CategoriesCard — the right column's upper card (design Screen 7).

   A wrapping set of count-bearing pills plus a dashed "+ new"; a mono
   "flat · one level" note in the header (categories are deliberately
   non-hierarchical — there is no nesting affordance anywhere). Clicking a pill
   opens the same name + slug form the "+ new" pill reveals, in edit mode.
   Failures that are not a 409 duplicate-slug surface as a card-top `<Alert>`.
   ========================================================================== */

type Editing =
  | { mode: "create" }
  | { mode: "edit"; category: Category }
  | null;

function CategoryPill({
  category,
  onEdit,
}: {
  category: Category;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex h-[28px] items-center gap-[7px] rounded-full border border-border bg-canvas pl-11 pr-[9px] text-[13px] text-ink outline-none transition-colors duration-[120ms] ease-out hover:border-border-strong hover:bg-surface-sunken focus-visible:focus-ring-button"
    >
      <span className="truncate">{category.name}</span>
      <span className="font-mono text-[11px] tracking-[0.04em] text-ink-faint tabular-nums">
        {category.sermon_count}
      </span>
    </button>
  );
}

export function CategoriesCard() {
  const categories = useCategories();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [alert, setAlert] = React.useState<string | null>(null);

  const close = () => setEditing(null);
  // A mutation landed — drop any stale card-top alert from an earlier failure,
  // not just when the next form opens.
  const handleSaved = () => {
    setAlert(null);
    setEditing(null);
  };

  return (
    <section
      aria-labelledby="categories-heading"
      className="flex flex-col gap-14 rounded-16 border border-border bg-surface p-20"
    >
      <div className="flex items-baseline justify-between gap-12">
        <h2 id="categories-heading" className="text-section-title text-ink">
          Categories
        </h2>
        <span className="font-mono text-[11px] tracking-[0.06em] text-ink-faint">
          flat · one level
        </span>
      </div>

      {alert ? (
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
      ) : null}

      {categories.isPending ? (
        <div className="flex flex-wrap gap-8" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="h-[28px] w-[92px] rounded-full bg-border-subtle"
            />
          ))}
        </div>
      ) : categories.isError ? (
        <Alert variant="error" title="Couldn’t load categories">
          {categories.error instanceof Error
            ? categories.error.message
            : "Please try again."}
        </Alert>
      ) : !categories.data || categories.data.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Add one below — categories stay flat, with no sub-levels."
        />
      ) : (
        <div className="flex flex-wrap items-center gap-8">
          {categories.data.map((category) => (
            <CategoryPill
              key={category.id}
              category={category}
              onEdit={() => {
                setAlert(null);
                setEditing({ mode: "edit", category });
              }}
            />
          ))}
        </div>
      )}

      {editing?.mode === "create" ? null : (
        <div>
          <Tag
            variant="add"
            role="button"
            tabIndex={0}
            aria-label="New category"
            onClick={() => {
              setAlert(null);
              setEditing({ mode: "create" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAlert(null);
                setEditing({ mode: "create" });
              }
            }}
            className="outline-none focus-visible:focus-ring-button"
          >
            + new
          </Tag>
        </div>
      )}

      {editing ? (
        <CategoryForm
          key={editing.mode === "edit" ? editing.category.id : "create"}
          mode={editing.mode}
          category={editing.mode === "edit" ? editing.category : undefined}
          onDone={close}
          onSaved={handleSaved}
          onError={setAlert}
        />
      ) : null}
    </section>
  );
}
