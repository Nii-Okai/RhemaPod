"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/portal";
import { StatusBadge } from "@/components/portal/status-badge";
import { Toast } from "@/components/portal/toast";
import { toBadgeStatus, type SermonStatus } from "@/components/sermons/sermon-status";

import { AccessCard } from "@/components/sermons/editor/access-card";
import { ApprovalLogCard } from "@/components/sermons/editor/approval-log-card";
import { CommentsCard } from "@/components/sermons/editor/comments-card";
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

// Statuses where the editor's fields are read-only. `pending_review` /
// `under_review` lock while a manager is actively reviewing; `approved` and
// `published` lock too (a backend guard added alongside this — 409 on PATCH —
// matches). `Withdraw` only exists as a transition out of the first two
// (`app/services/approval.py::TRANSITIONS`) — there is no transition back to
// draft from `approved` or `published` — so `canWithdraw` below is
// deliberately narrower than this set; see the action-row branch.
const FIELD_LOCKED_STATUSES: readonly SermonStatus[] = [
  "pending_review",
  "under_review",
  "approved",
  "published",
];
const WITHDRAWABLE_STATUSES: readonly SermonStatus[] = [
  "pending_review",
  "under_review",
];

// Success toast for an explicit "Save draft" click (review-fix batch, item 2
// — Save draft previously gave zero click-confirmation, only the passive
// mono "saved N min ago" stamp). Same shape as `review-screen.tsx`'s toast
// (`TOAST_MS`, auto-dismiss); inlined rather than shared since this is a
// single new consumer, not a second one — see status.md.
const TOAST_MS = 6000;

const EMPTY_FORM: SermonFormValues = {
  title: "",
  description: "",
  speaker_id: null,
  category_id: null,
  series_id: null,
  episode_number: null,
  tier: null,
  tags: [],
  is_prophets_catalog: false,
};

/** The locked-fields banner's title, by status — kept distinct so "in
    review" never gets shown for an approved/published sermon. */
function lockedBannerTitle(status: SermonStatus): string {
  switch (status) {
    case "approved":
      return "This sermon is approved";
    case "published":
      return "This sermon is published";
    default:
      return "This sermon is in review";
  }
}

/** The locked-fields banner's body, by status — each points at the actual
    way (if any) to unlock it; `approved` has none (no transition back to
    draft exists — `app/services/approval.py::TRANSITIONS`). */
function lockedBannerBody(status: SermonStatus): string {
  switch (status) {
    case "approved":
      return "Fields are locked now that it’s approved. A manager can publish it, or reject it from the Review queue to send it back for edits.";
    case "published":
      return "Fields are locked while it’s live. A manager can unpublish it from the Sermons list to edit it again — any edit then sends it back for review.";
    default:
      return "Fields are locked while a manager reviews it. Withdraw it to keep editing.";
  }
}

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
    is_prophets_catalog: detail.is_prophets_catalog,
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
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  // Armed by an explicit Save-draft click, cleared the next time `autosave.
  // status` settles — distinguishes "the click's own save landed" from any
  // OTHER autosave tick (a field edit's debounced save, or this same flush
  // firing from elsewhere) so the toast fires once per click, not per tick.
  // State, not a ref: it's read/adjusted during render (below), and a ref
  // can't be — same reason `statusOverride` is state.
  const [saveDraftArmed, setSaveDraftArmed] = useState(false);

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
  // The editor is read-only while a manager is reviewing the sermon
  // (`pending_review` / `under_review`), and again once it's `approved` or
  // `published` — a decision already made shouldn't be re-litigated by
  // editing the record under it. A `draft` or `rejected` sermon is always
  // fully editable, series-attached or not, and the backend agrees
  // (`update_sermon` guards an in-review/approved/published sermon's fields,
  // never a draft's).
  //
  // `current.locked` is deliberately NOT consulted: on `SermonAdminDetail`
  // that flag is the per-user paywall signal (paid tier + no subscription),
  // computed off the resolved tier — so a draft in a paid series would lock
  // the form and wrongly show the "in review" banner. It has no editing
  // meaning on the staff screen.
  const locked = mode === "edit" && FIELD_LOCKED_STATUSES.includes(displayStatus);
  // Narrower than `locked` — "Withdraw" (→ draft) only exists as a backend
  // transition from pending_review/under_review. An approved/published
  // sermon has no editor-side undo (approved: no transition back at all;
  // published: only "Unpublish" from the Sermons list, manager-only), so the
  // action row below offers nothing rather than a button that would 409.
  const canWithdraw = mode === "edit" && WITHDRAWABLE_STATUSES.includes(displayStatus);

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

  // Fires the click-confirmation toast once the flush this SAME click armed
  // actually settles — not on an unrelated debounced autosave tick that
  // happens to land around the same time. Adjust-state-during-render (the
  // pattern this file already uses above for the optimistic-badge clear and
  // the form re-seed), not an effect: a `setState` synchronously derived from
  // other state belongs in render, not in an effect body.
  if (saveDraftArmed && autosave.status === "saved") {
    setSaveDraftArmed(false);
    setToast("Draft saved.");
  } else if (
    saveDraftArmed &&
    (autosave.status === "error" || autosave.status === "idle")
  ) {
    // "error": already surfaced as the card-top "Your last change didn't
    // save" alert — no toast on top of that. "idle": a create-mode flush with
    // no title yet is a no-op (`useAutosaveSermon` holds it) — the inline
    // "Title is required." error is the feedback there. Either way, disarm so
    // a LATER unrelated tick can't fire a stale toast.
    setSaveDraftArmed(false);
  }

  const onSaveDraft = () => {
    setTitleTouched(true);
    setSaveDraftArmed(true);
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
            {canWithdraw ? (
              <Button
                size="md"
                variant="secondary"
                disabled={workflow.isPending}
                onClick={onWithdraw}
              >
                Withdraw
              </Button>
            ) : locked ? null : (
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
              <Alert variant="warning" title={lockedBannerTitle(displayStatus)}>
                {lockedBannerBody(displayStatus)}
              </Alert>
            ) : mode === "edit" && displayStatus === "unpublished" ? (
              <Alert variant="warning" title="This sermon is unpublished">
                Any change you save moves it back to draft. It will need to be
                submitted and approved again before it can go live.
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
            {sermonId ? <CommentsCard sermonId={sermonId} /> : null}
          </div>
        </div>
      </div>

      {toast ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </UploadProvider>
  );
}
