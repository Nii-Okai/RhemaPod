"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/portal";
import { StatusBadge } from "@/components/portal/status-badge";
import { toBadgeStatus, type SermonStatus } from "@/components/sermons/sermon-status";

import { AccessCard } from "@/components/sermons/editor/access-card";
import { ApprovalLogCard } from "@/components/sermons/editor/approval-log-card";
import { DetailsCard } from "@/components/sermons/editor/details-card";
import { EditorSkeleton } from "@/components/sermons/editor/editor-skeleton";
import { MediaJobsCard } from "@/components/sermons/editor/media-jobs-card";
import { SaveStamp } from "@/components/sermons/editor/save-stamp";
import { ThumbnailCard } from "@/components/sermons/editor/thumbnail-card";
import { useUnsavedChangesGuard } from "@/components/sermons/editor/use-unsaved-guard";

import { isApiError } from "@/lib/api/errors";
import { useApprovalLog, toTimeline } from "@/lib/query/hooks/use-approval-log";
import {
  useAutosaveSermon,
  type SermonFormValues,
  type SermonPatch,
} from "@/lib/query/hooks/use-autosave-sermon";
import { useCategories } from "@/lib/query/hooks/use-categories";
import { useEditorWorkflow } from "@/lib/query/hooks/use-editor-workflow";
import {
  useSermonAdmin,
  isNotFound,
  type SermonAdminDetail,
} from "@/lib/query/hooks/use-sermon-admin";
import { UploadProvider } from "@/lib/upload";
import { useSeriesList } from "@/lib/query/hooks/use-series";
import { useSpeakers } from "@/lib/query/hooks/use-speakers";

/* =============================================================================
   SermonEditor — the sermon editor FORM (design Screen 4, plan W8).

   W8 = the form. The upload pipeline (presigned PUT → confirm → poll, the XHR
   uploader, retry, duration extraction) is W9 — the Media card here lists
   existing jobs read-only and the dropzone is disabled.

   `SermonEditor` owns the load / not-found / skeleton decision; the inner
   `EditorForm` mounts only once its data is ready so autosave starts with a
   real "saved N min ago" baseline.
   ========================================================================== */

const IN_REVIEW: readonly SermonStatus[] = ["pending_review", "under_review"];

const EMPTY_FORM: SermonFormValues = {
  title: "",
  description: "",
  speaker_id: null,
  category_id: null,
  series_id: null,
  episode_number: null,
  tier: null,
  tags: [],
};

function fromDetail(detail: SermonAdminDetail): SermonFormValues {
  return {
    title: detail.title,
    description: detail.description ?? "",
    speaker_id: detail.speaker_id,
    category_id: detail.category_id,
    series_id: detail.series_id,
    episode_number: detail.episode_number,
    // `tier_override` is the raw `Sermon.tier` column, authoritative since
    // GATE 3 Batch 3: null = "Inherit from series", else the explicit choice.
    // (`detail.tier` is the resolved effective tier — for display only.)
    tier: detail.tier_override ?? null,
    tags: detail.tags,
  };
}

export interface SermonEditorProps {
  /** undefined = `/sermons/new` (create mode until the first save). */
  sermonId?: string;
}

export function SermonEditor({ sermonId: initialId }: SermonEditorProps) {
  const detail = useSermonAdmin(initialId);
  // Prefetched here (shared cache, no extra request) so the Access card's
  // "Inherit resolves to <series tier>" sub-line is right on first paint.
  const series = useSeriesList();

  if (initialId && (detail.isLoading || series.isLoading)) {
    return <EditorSkeleton />;
  }

  if (initialId && detail.isError && isNotFound(detail.error)) {
    return (
      <>
        <PageHeader
          title="Sermon not found"
          subhead="It may have been deleted, or it isn’t yours to edit."
        />
        <EmptyState
          title="Nothing to edit here"
          description="Head back to your sermons and pick another."
          action={
            <Button asChild size="sm">
              <Link href="/sermons">Go to sermons</Link>
            </Button>
          }
        />
      </>
    );
  }

  if (initialId && detail.isError) {
    return (
      <>
        <PageHeader
          title="Sermon"
          subhead="Something went wrong loading this sermon."
        />
        <Alert variant="error" title="Couldn’t load this sermon">
          {detail.error instanceof Error
            ? detail.error.message
            : "Reload to try again."}
        </Alert>
      </>
    );
  }

  return (
    <EditorForm
      key={initialId ?? "new"}
      mode={initialId ? "edit" : "create"}
      initial={detail.data ?? null}
    />
  );
}

/* --------------------------------------------------------------------------- */

interface EditorFormProps {
  mode: "create" | "edit";
  initial: SermonAdminDetail | null;
}

function EditorForm({ mode, initial }: EditorFormProps) {
  const speakers = useSpeakers();
  const categories = useCategories();
  const series = useSeriesList();

  // Live id: the prop id, or the id returned by the first create POST.
  const [sermonId, setSermonId] = useState<string | undefined>(initial?.id);
  // Guard so a post-create background refetch of the detail never re-seeds the
  // form over the user's in-progress edits.
  const [seededId, setSeededId] = useState<string | null>(initial?.id ?? null);

  const [form, setForm] = useState<SermonFormValues>(() =>
    initial ? fromDetail(initial) : EMPTY_FORM,
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [statusOverride, setStatusOverride] = useState<SermonStatus | null>(
    null,
  );
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  // The live sermon (same query key as `SermonEditor` → shared cache, no extra
  // request). Its `status` / `thumbnail_url` stay fresh across a submit/withdraw
  // refetch; the *form fields* deliberately do not follow it.
  const live = useSermonAdmin(sermonId);
  const current: SermonAdminDetail | null = live.data ?? initial;

  const approvalLog = useApprovalLog(sermonId);

  // A no-op after this editor's own unmount — a create POST that resolves late
  // must not rewrite the address bar of whatever page the user moved to.
  const editorMountedRef = useRef(true);
  useEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
    };
  }, []);

  const handleCreated = useCallback((newId: string) => {
    if (!editorMountedRef.current) return;
    setSermonId(newId);
    setSeededId(newId);
    // Shallow URL update — App Router has no shallow `router.replace`, and a
    // real navigation would remount the tree and drop focus/state (§ plan W8:
    // "switches to patch-mode without losing focus/state").
    window.history.replaceState(null, "", `/sermons/${newId}`);
  }, []);

  const autosave = useAutosaveSermon({
    sermonId,
    baselineSavedAt:
      current?.updated_at ?? current?.created_at ?? null,
    onCreated: handleCreated,
  });

  const workflow = useEditorWorkflow({
    sermonId,
    onOptimistic: (s) => setStatusOverride(s),
    onRollback: () => setStatusOverride(null),
    onSettledStatus: (s) => setStatusOverride(s),
    onError: (msg) => setWorkflowError(msg),
  });

  // --- render-time reconciles (React's "adjust state on a change" pattern,
  //     the same one SermonsScreen uses) -----------------------------------

  // Re-seed the form if a *different* sermon's detail arrives (shouldn't happen
  // with the `key` on <EditorForm>, but keeps the guard honest).
  if (mode === "edit" && live.data && seededId !== live.data.id) {
    setSeededId(live.data.id);
    setForm(fromDetail(live.data));
  }

  // Clear the optimistic badge once the server truth agrees.
  const serverStatus = (current?.status ?? "draft") as SermonStatus;
  if (statusOverride && serverStatus === statusOverride) {
    setStatusOverride(null);
  }

  const displayStatus: SermonStatus = statusOverride ?? serverStatus;
  // The DTO's own `locked` is authoritative — a backend lock for ANY reason
  // (not just in-review) disables the form + autosave. OR in the optimistic
  // in-review check so a just-submitted sermon locks before the refetch lands.
  const locked =
    (current?.locked ?? false) ||
    (mode === "edit" && IN_REVIEW.includes(displayStatus));

  const titleEmpty = form.title.trim().length === 0;
  const titleError =
    titleTouched && titleEmpty ? "Title is required." : null;

  const standalone = !form.series_id;
  const seriesTier =
    series.data?.find((s) => s.id === form.series_id)?.tier ?? undefined;

  // --- change plumbing --------------------------------------------------

  const change = useCallback(
    (patch: SermonPatch) => {
      setForm((f) => ({ ...f, ...patch }));
      autosave.queue(patch);
    },
    [autosave],
  );
  const commit = useCallback(() => {
    void autosave.flush();
  }, [autosave]);

  // Warn on tab close / refresh / in-editor nav while there is unsaved work in
  // flight or errored (plan W8 acceptance). Sidebar / Back-button residual is
  // documented in status.md.
  const { confirmLeave } = useUnsavedChangesGuard(
    autosave.isDirty ||
      autosave.status === "error" ||
      autosave.status === "saving",
  );

  const onSaveDraft = () => {
    setTitleTouched(true);
    void autosave.flush();
  };

  const canSubmit =
    Boolean(sermonId) &&
    !titleEmpty &&
    !autosave.isDirty &&
    autosave.status !== "saving" &&
    !workflow.isPending;

  const onSubmit = () => {
    setTitleTouched(true);
    if (titleEmpty || !sermonId) return;
    setWorkflowError(null);
    // Let a debounced PATCH land BEFORE the status transition, or it could
    // arrive after `/submit` and clobber the freshly-locked sermon.
    void autosave.flush().then(() => workflow.submit());
  };

  const onWithdraw = () => {
    setWorkflowError(null);
    void autosave.flush().then(() => workflow.withdraw());
  };

  const timeline = approvalLog.data ? toTimeline(approvalLog.data) : undefined;
  const heading = form.title.trim() || "Untitled sermon";

  return (
    <UploadProvider sermonId={sermonId}>
      <div className="flex flex-col gap-16">
        {/* breadcrumb + save row */}
        <div className="flex flex-wrap items-center justify-between gap-12">
          <nav className="flex min-w-0 items-center gap-8 text-[13px]">
            <Link
              href="/sermons"
              onNavigate={(e) => {
                if (!confirmLeave()) e.preventDefault();
              }}
              className="shrink-0 font-medium text-clay-600 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              ← Sermons
            </Link>
            <span className="text-ink-faint">/</span>
            <span className="truncate text-ink-muted">{heading}</span>
          </nav>

          <div className="flex items-center gap-10">
            <SaveStamp
              status={autosave.status}
              savedAt={autosave.savedAt}
              unsaved={!sermonId}
            />
            {locked ? (
              <Button
                size="md"
                variant="secondary"
                disabled={workflow.isPending}
                onClick={onWithdraw}
              >
                Withdraw
              </Button>
            ) : (
              <>
                <Button
                  size="md"
                  variant="secondary"
                  disabled={autosave.status === "saving" && !autosave.isDirty}
                  onClick={onSaveDraft}
                >
                  Save draft
                </Button>
                <Button
                  size="md"
                  variant="primary"
                  disabled={!canSubmit}
                  onClick={onSubmit}
                >
                  Submit for review
                </Button>
              </>
            )}
          </div>
        </div>

        {/* title + status */}
        <div className="flex flex-wrap items-center gap-12">
          <h1 className="text-page-title text-ink">{heading}</h1>
          <StatusBadge status={toBadgeStatus(displayStatus)} />
        </div>

        {/* body */}
        <div className="grid items-start gap-16 min-[1100px]:grid-cols-[1.7fr_1fr]">
          <div className="flex flex-col gap-16">
            {(autosave.status === "error" || workflowError) && (
              <div className="flex flex-col gap-8">
                {autosave.status === "error" && autosave.errorMessage ? (
                  <Alert variant="error" title="Your last change didn’t save">
                    {autosave.errorMessage}
                  </Alert>
                ) : null}
                {workflowError ? (
                  <Alert variant="error" title="That action didn’t go through">
                    <span className="flex items-center gap-10">
                      <span>{workflowError}</span>
                      <button
                        type="button"
                        onClick={() => setWorkflowError(null)}
                        className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                      >
                        Dismiss
                      </button>
                    </span>
                  </Alert>
                ) : null}
              </div>
            )}

            {locked ? (
              <Alert variant="warning" title="This sermon is in review">
                Fields are locked while a manager reviews it. Withdraw it to keep
                editing.
              </Alert>
            ) : null}

            <DetailsCard
              values={form}
              onChange={change}
              onCommit={commit}
              disabled={locked}
              titleError={titleError}
              speakers={speakers.data}
              categories={categories.data}
              series={series.data}
            />

            <MediaJobsCard
              sermonId={sermonId}
              sermonDurationSeconds={current?.duration_seconds ?? null}
              disabled={locked || !sermonId}
            />
          </div>

          <div className="flex flex-col gap-16">
            <ThumbnailCard
              sermonId={sermonId}
              thumbnailUrl={current?.thumbnail_url ?? null}
              title={heading}
              disabled={locked || !sermonId}
            />
            <AccessCard
              tier={form.tier}
              standalone={standalone}
              seriesTier={seriesTier}
              disabled={locked}
              onChange={(tier) => {
                change({ tier });
                commit();
              }}
            />
            <ApprovalLogCard
              entries={timeline}
              isLoading={approvalLog.isLoading}
              isError={approvalLog.isError}
              notFound={
                approvalLog.isError &&
                isApiError(approvalLog.error) &&
                approvalLog.error.status === 404
              }
            />
          </div>
        </div>
      </div>
    </UploadProvider>
  );
}
