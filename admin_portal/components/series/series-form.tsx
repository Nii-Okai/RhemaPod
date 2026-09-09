"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EditorField } from "@/components/sermons/editor/field";
import { StatusBadge } from "@/components/portal/status-badge";
import { toBadgeStatus } from "@/components/sermons/sermon-status";
import { SeriesPublishControl } from "./series-publish-control";
import { useCategories } from "@/lib/query/hooks/use-categories";
import {
  useCreateSeries,
  useDeleteSeries,
  useUpdateSeries,
  type Series,
  type SeriesUpdate,
} from "@/lib/query/hooks/use-series-manager";
import { isApiError } from "@/lib/api/errors";

/* =============================================================================
   SeriesForm — create / edit a series (design Screen 6, plan W11 item 2).

   Fields: title, description, category select, tier radios (Free / Paid — a
   series has no "inherit"). Create → POST /series → navigate to /series/{newId}.
   Edit → PATCH (optimistic in `useUpdateSeries`). Delete → confirm → DELETE →
   back to /series. Request failures render as a panel-top `<Alert>`, never a
   toast (design §"Errors").

   The status badge in the card header carries a manager-only publish /
   unpublish control next to it (`SeriesPublishControl`, Batch 5 —
   `SeriesUpdate.status` accepts `draft` ⇄ `published`).
   ========================================================================== */

type Tier = "free" | "paid";

export interface SeriesFormProps {
  mode: "create" | "edit";
  series?: Series;
}

interface FormState {
  title: string;
  description: string;
  categoryId: string;
  tier: Tier;
}

function stateFrom(series: Series | undefined): FormState {
  return {
    title: series?.title ?? "",
    description: series?.description ?? "",
    categoryId: series?.category_id ?? "",
    tier: series?.tier === "paid" ? "paid" : "free",
  };
}

function errorMessage(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

export function SeriesForm({ mode, series }: SeriesFormProps) {
  const router = useRouter();
  const categories = useCategories();

  const initial = React.useMemo(() => stateFrom(series), [series]);
  const [form, setForm] = React.useState<FormState>(initial);
  // Re-seed if the loaded series changes underneath us (e.g. a refetch after a
  // thumbnail confirm) — but only when the user has no pending edits.
  const [baseline, setBaseline] = React.useState(initial);
  if (baseline !== initial && form === baseline) {
    setBaseline(initial);
    setForm(initial);
  }

  const [titleTouched, setTitleTouched] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);

  const create = useCreateSeries();
  const update = useUpdateSeries();
  const remove = useDeleteSeries();
  const busy = create.isPending || update.isPending || remove.isPending;

  const titleError =
    (titleTouched || mode === "edit") && form.title.trim() === ""
      ? "A title is required."
      : null;

  const dirty =
    form.title !== baseline.title ||
    form.description !== baseline.description ||
    form.categoryId !== baseline.categoryId ||
    form.tier !== baseline.tier;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setAlert(null);
    if (form.title.trim() === "") {
      setTitleTouched(true);
      return;
    }

    if (mode === "create") {
      create.mutate(
        {
          title: form.title.trim(),
          description: form.description.trim() || null,
          category_id: form.categoryId || null,
          tier: form.tier,
        },
        {
          // `replace`, not `push` — the create route (`/series/new`) must not
          // stay in history, or Back lands the user on a blank create form.
          onSuccess: (data) => router.replace(`/series/${data.id}`),
          onError: (err) =>
            setAlert(errorMessage(err, "Couldn’t create the series.")),
        },
      );
      return;
    }

    if (!series || !dirty) return;
    const patch: SeriesUpdate = {};
    if (form.title !== baseline.title) patch.title = form.title.trim();
    if (form.description !== baseline.description) {
      patch.description = form.description.trim() || null;
    }
    if (form.categoryId !== baseline.categoryId) {
      patch.category_id = form.categoryId || null;
    }
    if (form.tier !== baseline.tier) patch.tier = form.tier;

    update.mutate(
      { seriesId: series.id, patch },
      {
        onSuccess: () => setBaseline(form),
        onError: (err) =>
          setAlert(errorMessage(err, "Couldn’t save the series.")),
      },
    );
  };

  const handleDelete = () => {
    if (!series) return;
    const ok = window.confirm(
      `Delete “${series.title}”? Its sermons become standalone — their content is not deleted.`,
    );
    if (!ok) return;
    setAlert(null);
    remove.mutate(series.id, {
      onSuccess: () => router.push("/series"),
      onError: (err) =>
        setAlert(errorMessage(err, "Couldn’t delete the series.")),
    });
  };

  return (
    <Card className="flex flex-col gap-16 p-20">
      <CardHeader>
        <CardTitle>{mode === "create" ? "New series" : "Series details"}</CardTitle>
        {mode === "edit" && series ? (
          <div className="flex items-center gap-10">
            <StatusBadge status={toBadgeStatus(series.status)} />
            <SeriesPublishControl
              series={series}
              onError={setAlert}
              onSuccess={() => setAlert(null)}
            />
          </div>
        ) : null}
      </CardHeader>

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

      <form className="flex flex-col gap-14" onSubmit={handleSubmit} noValidate>
        <EditorField label="Title" htmlFor="series-title" error={titleError}>
          <Input
            id="series-title"
            value={form.title}
            error={Boolean(titleError)}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => setTitleTouched(true)}
            placeholder="e.g. Walking in Faith"
          />
        </EditorField>

        <EditorField label="Description" htmlFor="series-description">
          <Textarea
            id="series-description"
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="A sentence on what this series covers."
          />
        </EditorField>

        <EditorField label="Category" htmlFor="series-category">
          <Select
            id="series-category"
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </EditorField>

        <fieldset className="flex flex-col gap-10" aria-label="Series tier">
          <span className="text-[13px] font-medium text-ink-muted">
            Default tier for episodes
          </span>
          {(["free", "paid"] as const).map((value) => {
            const id = `series-tier-${value}`;
            return (
              <div key={value} className="flex items-start gap-10">
                <Radio
                  id={id}
                  name="series-tier"
                  className="mt-[2px]"
                  value={value}
                  checked={form.tier === value}
                  onChange={() => set("tier", value)}
                />
                <label htmlFor={id} className="flex flex-col gap-2">
                  <span className="text-[13.5px] font-medium text-ink">
                    {value === "free" ? "Free" : "Paid — subscribers only"}
                  </span>
                  <span className="text-[12.5px] text-ink-faint">
                    {value === "free"
                      ? "Episodes are free unless they set their own tier."
                      : "Episodes inherit Paid unless they set their own tier."}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>

        <div className="flex items-center justify-between gap-12 pt-2">
          <Button
            type="submit"
            size="md"
            disabled={
              busy ||
              (mode === "edit" && !dirty) ||
              (mode === "create" && form.title.trim() === "")
            }
          >
            {mode === "create"
              ? create.isPending
                ? "Creating…"
                : "Create series"
              : update.isPending
                ? "Saving…"
                : "Save changes"}
          </Button>

          {mode === "edit" ? (
            <Button
              type="button"
              size="md"
              variant="destructive"
              disabled={busy}
              onClick={handleDelete}
            >
              {remove.isPending ? "Deleting…" : "Delete series"}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
