"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, Pagination, Toast } from "@/components/portal";
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
  mode: "idle" | "rejecting";
  note: string;
  error: string | null;
}
const BLANK: CardState = { mode: "idle", note: "", error: null };

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

  const requestedPage = useMemo(() => {
    const raw = Number(searchParams.get("page"));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  }, [searchParams]);

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

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const actions = useReviewActions({
    meName: session.name,
    onError: (vars, message) => patchCard(vars.item.id, { error: message }),
    onSuccess: (vars) => {
      // reject / approve leave the queue; watch stays but its local state is
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

  const overdue = overdueItems(items, now);
  const countLine = reviewCountLine(total, oldestWaitDays(items, now));

  const claimFor = (item: ReviewQueueItem) => {
    if (item.status !== "under_review") {
      return { mine: false, claimedByOther: null };
    }
    const claimant = item.review_claimed_by;
    const mine =
      claimant != null &&
      session.name != null &&
      claimant.trim().toLowerCase() === session.name.trim().toLowerCase();
    return { mine, claimedByOther: mine ? null : (claimant ?? null) };
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
            const { mine, claimedByOther } = claimFor(item);
            const state = cardState(item.id);
            return (
              <SubmissionCard
                key={item.id}
                item={item}
                mine={mine}
                claimedByOther={claimedByOther}
                busy={actions.pendingId === item.id}
                error={state.error}
                onDismissError={() => patchCard(item.id, { error: null })}
                mode={state.mode}
                note={state.note}
                now={now}
                onNoteChange={(value) => patchCard(item.id, { note: value })}
                onStartReject={() =>
                  patchCard(item.id, { mode: "rejecting", error: null })
                }
                onCancelReject={() =>
                  patchCard(item.id, { mode: "idle", note: "" })
                }
                onWatch={() => actions.watch(item)}
                onApproveOnly={() => actions.approve(item)}
                onApproveAndPublish={() => actions.approveAndPublish(item)}
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
    </>
  );
}
