"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, Pagination, Toast } from "@/components/portal";
import { clampPage } from "@/lib/format";
import { useSession } from "@/lib/auth/session-context";
import {
  useReviewQueue,
  type ReviewQueueItem,
} from "@/lib/query/hooks/use-review-queue";
import { useReviewActions } from "@/lib/query/hooks/use-review-actions";
import {
  oldestWaitDays,
  overdueAlertText,
  overdueItems,
  reviewCountLine,
} from "@/lib/review/summary";
import { SubmissionCard } from "@/components/review/submission-card";
import { SermonPlayerDialog } from "@/components/review/sermon-player-dialog";

/* =============================================================================
   ReviewScreen — Review queue (design Screen 5, plan W10). Manager/Admin only
   (the page gates with `requireRole("manager")` → 404 for an Editor).

   URL is the state: `?page=` only. All transitions are optimistic with rollback
   (`useReviewActions`); a failure lands in an `<Alert>` at the top of the
   affected card, never a toast. The publish success toast ("Published to the
   app") is the one deliberate toast, per design "Approval transitions".
   ========================================================================== */

const TOAST_MS = 6000;

interface CardState {
  mode: "idle" | "rejecting" | "scheduling";
  note: string;
  /** Local `datetime-local` text for the "scheduling" mode's
      `SchedulePublishPanel` (round 2 — scheduled sermon publish). Same
      per-card ownership as `note`. */
  schedule: string;
  error: string | null;
}
const BLANK: CardState = { mode: "idle", note: "", schedule: "", error: null };

function ReviewCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-14 rounded-16 border border-border bg-surface p-20"
    >
      <div className="flex flex-wrap gap-18">
        <div className="aspect-video w-[180px] shrink-0 rounded-5 bg-border-subtle" />
        <div className="flex min-w-0 flex-1 flex-col gap-9">
          <div className="h-[24px] w-2/3 rounded-4 bg-border-subtle" />
          <div className="h-[13px] w-1/2 rounded-4 bg-border-subtle" />
          <div className="h-[13px] w-full max-w-[62ch] rounded-4 bg-border-subtle" />
          <div className="h-[11px] w-1/3 rounded-4 bg-border-subtle" />
          <div className="mt-2 flex gap-8">
            <div className="h-[30px] w-[130px] rounded-8 bg-border-subtle" />
            <div className="h-[30px] w-[100px] rounded-8 bg-border-subtle" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReviewScreen() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requestedPage = useMemo(
    () => clampPage(searchParams.get("page")),
    [searchParams],
  );

  const { items, total, page, pageCount, isPending, isError, error } =
    useReviewQueue({ page: requestedPage });

  // "waiting N days" is day-granular — a value fixed at mount is accurate for
  // any realistic session and keeps the header, the alert and every card on the
  // same "today". (Lazy state init, so it's read once, not every render.)
  const [now] = useState(() => Date.now());

  const [cards, setCards] = useState<Record<string, CardState>>({});
  const cardState = (id: string): CardState => cards[id] ?? BLANK;
  const patchCard = useCallback(
    (id: string, partial: Partial<CardState>) =>
      setCards((prev) => ({
        ...prev,
        [id]: { ...(prev[id] ?? BLANK), ...partial },
      })),
    [],
  );
  const resetCard = useCallback(
    (id: string) =>
      setCards((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }),
    [],
  );

  // The sermon whose media player dialog is open (id + title for the heading),
  // or null when closed. "Watch" on a card opens it.
  const [playerFor, setPlayerFor] = useState<{ id: string; title: string } | null>(
    null,
  );

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const actions = useReviewActions({
    meName: session.name,
    meId: session.id,
    onError: (vars, message) => patchCard(vars.item.id, { error: message }),
    onApprovedNotPublished: (vars, detail) =>
      // approve-ok / publish-fail: the approve committed, only publishing threw.
      // The row refetches as `approved` and stays in the queue (#12), where its
      // card now offers a "Publish" retry — so clear any half-open reject/
      // scheduling `mode` (else the card lands on a stale panel, not the
      // Publish button) and surface the failure as a transient, dismissible
      // card-top alert. No standing screen banner: the fix is right there on
      // the card.
      patchCard(vars.item.id, {
        mode: "idle",
        note: "",
        schedule: "",
        error: `Approved, but publishing failed. ${detail}`,
      }),
    onSuccess: (vars) => {
      // reject / approve / publish leave the queue; startReview and takeOver
      // keep the card (now under_review, claimed by me) but its local state is
      // spent. Either way, drop this card's transient UI.
      resetCard(vars.item.id);
    },
    onPublished: () => setToast("Published to the app"),
  });

  const pushPage = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next <= 1) params.delete("page");
      else params.set("page", String(next));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // If the URL points past the last page (a page emptied under us), walk it
  // back down — once (the replace re-parses `page` inside the bound).
  useEffect(() => {
    if (isPending || isError) return;
    if (requestedPage > pageCount) pushPage(pageCount);
  }, [isPending, isError, requestedPage, pageCount, pushPage]);

  // `overdue` / `countLine` are computed over the *visible page only*. That is
  // correct solely because the backend's `review_queue_page` returns rows
  // oldest-submitted-first (`ORDER BY submitted_at`); if that sort ever changes,
  // an off-page item could be the oldest and this under-reports silently.
  const overdue = overdueItems(items, now);
  const countLine = reviewCountLine(total, oldestWaitDays(items, now));

  // Claim state keys off `review_claimed_by_id` (raw user id) vs the session id —
  // exact, unlike the old best-effort display-name match. Batch 6 #9:
  //   - `mine`            — I hold the claim → normal actions, no take-over.
  //   - `claimedElsewhere` — someone else holds it (id resolved, not me),
  //                          regardless of role or whether their name resolved →
  //                          "Take over review" is offered.
  //   - `claimLocked`     — `claimedElsewhere` AND I'm not an admin → the
  //                          approve/reject actions are disabled until I take
  //                          over. Admins bypass the lock (backend does too).
  //
  // Self-author lock (review-queue authorship): `item.created_by === my id`
  // AND I'm not an admin → start-review/approve/reject are disabled
  // (segregation of duties, mirrors `content_service.transition`'s 403).
  // Independent of the claim state above — see `SubmissionCard`'s file
  // header for how the two combine when a self-authored card also happens to
  // be `claimedElsewhere` (it always is, in practice).
  const isAdmin = session.role === "admin";
  const selfAuthorLockedFor = (item: ReviewQueueItem) =>
    item.created_by === session.id && !isAdmin;
  const claimFor = (item: ReviewQueueItem) => {
    if (item.status !== "under_review") {
      return { mine: false, claimedByOther: null, claimedElsewhere: false, claimLocked: false };
    }
    const claimantId = item.review_claimed_by_id ?? null;
    const claimantName = item.review_claimed_by?.trim() || null;
    const mine = claimantId != null && claimantId === session.id;
    const claimedElsewhere = claimantId != null && claimantId !== session.id;
    return {
      mine,
      claimedByOther: mine ? null : claimantName,
      claimedElsewhere,
      claimLocked: claimedElsewhere && !isAdmin,
    };
  };

  return (
    <>
      <PageHeader title="Review queue" subhead={countLine} />

      {isError ? (
        <Alert variant="error" title="Couldn’t load the review queue">
          {error instanceof Error ? error.message : "Reload to try again."}
        </Alert>
      ) : null}

      {overdue.length > 0 ? (
        <Alert variant="warning" title="Some submissions are overdue">
          {overdueAlertText(overdue.length)}
        </Alert>
      ) : null}

      {isPending ? (
        <div className="flex flex-col gap-18">
          <ReviewCardSkeleton />
          <ReviewCardSkeleton />
          <ReviewCardSkeleton />
        </div>
      ) : total === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="When editors submit sermons, they land here for review."
        />
      ) : (
        <div className="flex flex-col gap-18">
          {items.map((item) => {
            const { mine, claimedByOther, claimedElsewhere, claimLocked } =
              claimFor(item);
            const state = cardState(item.id);
            return (
              <SubmissionCard
                key={item.id}
                item={item}
                mine={mine}
                claimedByOther={claimedByOther}
                claimedElsewhere={claimedElsewhere}
                claimLocked={claimLocked}
                selfAuthorLocked={selfAuthorLockedFor(item)}
                busy={actions.isPending(item.id)}
                error={state.error}
                onDismissError={() => patchCard(item.id, { error: null })}
                mode={state.mode}
                note={state.note}
                scheduleValue={state.schedule}
                now={now}
                onNoteChange={(value) => patchCard(item.id, { note: value })}
                onStartReject={() =>
                  patchCard(item.id, { mode: "rejecting", error: null })
                }
                onCancelReject={() =>
                  patchCard(item.id, { mode: "idle", note: "" })
                }
                onScheduleChange={(value) =>
                  patchCard(item.id, { schedule: value })
                }
                onStartSchedule={() =>
                  patchCard(item.id, { mode: "scheduling", error: null })
                }
                onCancelSchedule={() =>
                  patchCard(item.id, { mode: "idle", schedule: "" })
                }
                onStartReview={() => actions.startReview(item)}
                onTakeOver={() => actions.takeOver(item)}
                onPlay={() =>
                  setPlayerFor({ id: item.id, title: item.title })
                }
                onApproveOnly={() => actions.approve(item)}
                onApproveAndPublish={() => actions.approveAndPublish(item)}
                onApproveAndSchedule={(iso) =>
                  actions.approveAndPublish(item, iso)
                }
                onPublish={() => actions.publish(item)}
                onSchedule={(iso) => actions.publish(item, iso)}
                onSendRejection={() => actions.reject(item, state.note)}
              />
            );
          })}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex justify-end">
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={pushPage}
            aria-label="Review queue pages"
          />
        </div>
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <Toast
            message={toast}
            timestamp="just now"
            onDismiss={() => setToast(null)}
          />
        </div>
      ) : null}

      <SermonPlayerDialog
        sermonId={playerFor?.id ?? null}
        title={playerFor?.title ?? ""}
        onClose={() => setPlayerFor(null)}
      />
    </>
  );
}
