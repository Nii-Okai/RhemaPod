import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { ReviewScreen } from "@/components/review/review-screen";
import { queryKeys } from "@/lib/query/keys";
import { useReviewActions } from "@/lib/query/hooks/use-review-actions";
import type {
  ReviewQueueItem,
  ReviewQueuePage,
} from "@/lib/query/hooks/use-review-queue";

/* W10 — the Review queue, rendered (happy-dom). Every backend call is MSW,
   never a mocked fetch (§A.11). Covers: the >48h alert, "Approve only"
   staying available whether the card is unclaimed or claimed by me, the
   inline reject flow (guard + rollback with the
   note preserved), approve-and-publish as two ordered calls + the toast, the
   card title linking to /sermons/{id}, "Start review" claiming a pending card
   (+ rollback), per-card pending gating under concurrent actions, "Watch"
   opening a media player, the empty state, (Batch 6) the claim-lock:
   disabled actions + "Take over review" on a card another manager holds (an
   admin bypasses), take-over 422/409 handling, an `approved` card that
   publishes out of the queue, and the review-queue-authorship self-author
   lock: a manager's own pending/under_review sermon has start-review/approve/
   reject disabled with the backend's exact 403 copy as the tooltip (admin
   bypasses), while an own `approved` sermon keeps Reject live (self-correction
   carve-out). */

/* --- next/navigation + next/link, mocked ----------------------------- */

const nav = vi.hoisted(() => ({
  replace: vi.fn<(href: string) => void>(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: nav.replace,
    push: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/review",
  useSearchParams: () => nav.search,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string | { toString(): string };
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : href.toString()} {...props}>
      {children}
    </a>
  ),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

/* --- fixtures ------------------------------------------------------- */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/* The session principal `renderScreen` signs in as, by default. The MSW
   `start-review` / `take-over-review` handlers claim rows for this identity so
   the post-settle refetch agrees with the optimistic patch. */
const ME = { id: "u-1", name: "Mia Okafor" };

const baseItem: ReviewQueueItem = {
  id: "a1",
  title: "Grace upon grace",
  description: "A close reading of John 1:14-18.",
  duration_seconds: 1902,
  speaker_id: "spk-1",
  speaker_name: "Ada Grace",
  category_id: "cat-1",
  category_name: "Teaching",
  series_id: null,
  series_title: null,
  tier: "free",
  status: "pending_review",
  submitted_at: hoursAgo(5),
  renditions_ready: 2,
  review_claimed_by: null,
  review_claimed_by_id: null,
  // A different id than `ME.id` ("u-1") — the default fixture is someone
  // ELSE's submission, so every existing test (reviewing, not authoring) is
  // unaffected by the self-author lock. Tests for that lock override this.
  created_by: "u-author",
};

const item = (over: Partial<ReviewQueueItem>): ReviewQueueItem => ({
  ...baseItem,
  ...over,
});

interface BackendOpts {
  /** Records every action call in order (e.g. `["approve", "publish"]`). */
  calls?: string[];
  /** Records the parsed body of every `reject` POST. */
  rejectBodies?: Array<{ note?: string }>;
  /** Delay the `start-review` response so the optimistic claim is observable
      before the server answers. */
  startReviewDelayMs?: number;
  /** Delay the `take-over-review` response so the optimistic claim is observable
      before the server answers. */
  takeOverDelayMs?: number;
  /** Fail the first N `publish` calls with 500 (then succeed). `approve` still
      200s — this is the approve-ok / publish-fail partial-failure path. */
  publishFailTimes?: number;
  /** `approve` flips the row to `approved` and KEEPS it in the queue instead of
      dropping it — simulates a stale tab / not-yet-refetched queue so the
      already-approved retry is observable on-screen. */
  keepApproved?: boolean;
}

/** One review-queue endpoint served from a mutable list, plus the four action
    endpoints. `start-review` claims the row; `approve`/`reject` drop it
    (mirrors the real queue: an approved/rejected sermon is no longer
    pending/under review). Every handler mutates `live`, so the post-settle
    refetch reflects the transition. */
function backend(initial: ReviewQueueItem[], opts: BackendOpts = {}) {
  const {
    calls,
    rejectBodies,
    startReviewDelayMs = 0,
    takeOverDelayMs = 0,
    publishFailTimes = 0,
    keepApproved = false,
  } = opts;
  let live = [...initial];
  let publishCalls = 0;
  server.use(
    http.get("*/api/bff/approvals/sermons/review-queue", () =>
      HttpResponse.json({ items: live, total: live.length, limit: 25, offset: 0 }),
    ),
    http.post(
      "*/api/bff/approvals/sermons/:id/start-review",
      async ({ params }) => {
        calls?.push("start-review");
        if (startReviewDelayMs) await delay(startReviewDelayMs);
        live = live.map((r) =>
          r.id === params.id
            ? {
                ...r,
                status: "under_review",
                review_claimed_by: ME.name,
                review_claimed_by_id: ME.id,
              }
            : r,
        );
        return HttpResponse.json({ id: params.id, status: "under_review" });
      },
    ),
    http.post(
      "*/api/bff/approvals/sermons/:id/take-over-review",
      async ({ params }) => {
        calls?.push("take-over-review");
        if (takeOverDelayMs) await delay(takeOverDelayMs);
        const current = live.find((r) => r.id === params.id);
        if (current && current.review_claimed_by_id === ME.id) {
          // Mirrors `take_over_review`: the caller already holds the claim.
          return HttpResponse.json(
            { detail: "already_reviewing", correlation_id: "cid-to-409" },
            { status: 409 },
          );
        }
        if (current && current.status !== "under_review") {
          return HttpResponse.json(
            {
              detail: `cannot take over a sermon in status '${current.status}'`,
              correlation_id: "cid-to-422",
            },
            { status: 422 },
          );
        }
        live = live.map((r) =>
          r.id === params.id
            ? {
                ...r,
                status: "under_review",
                review_claimed_by: ME.name,
                review_claimed_by_id: ME.id,
              }
            : r,
        );
        return HttpResponse.json({ id: params.id, status: "under_review" });
      },
    ),
    http.post("*/api/bff/approvals/sermons/:id/approve", ({ params }) => {
      calls?.push("approve");
      const current = live.find((r) => r.id === params.id);
      if (current && current.status === "approved") {
        // Mirrors `resolve_transition`: re-approving is a 409.
        return HttpResponse.json(
          {
            detail: `Cannot 'approve' a sermon in status 'approved'`,
            correlation_id: "cid-approve-409",
          },
          { status: 409 },
        );
      }
      if (keepApproved) {
        live = live.map((r) =>
          r.id === params.id ? { ...r, status: "approved" } : r,
        );
      } else {
        live = live.filter((r) => r.id !== params.id);
      }
      return HttpResponse.json({ id: params.id, status: "approved" });
    }),
    http.post("*/api/bff/approvals/sermons/:id/publish", ({ params }) => {
      calls?.push("publish");
      publishCalls += 1;
      if (publishCalls <= publishFailTimes) {
        return HttpResponse.json(
          { detail: "Encoder queue unreachable", correlation_id: "cid-pub-1" },
          { status: 500 },
        );
      }
      live = live.filter((r) => r.id !== params.id);
      return HttpResponse.json({ id: params.id, status: "published" });
    }),
    http.post(
      "*/api/bff/approvals/sermons/:id/reject",
      async ({ params, request }) => {
        calls?.push("reject");
        const body = (await request.json()) as { note?: string };
        rejectBodies?.push(body);
        if (!body.note) return new HttpResponse(null, { status: 400 });
        live = live.filter((r) => r.id !== params.id);
        return HttpResponse.json({ id: params.id, status: "rejected" });
      },
    ),
    // Default stream stub — SubmissionCard now fetches this proactively (not
    // just on "Watch"/"Listen" click) for any card with renditions_ready > 0,
    // to learn the media type for the button label. Every `item()` default
    // has renditions_ready: 2, so most tests in this file hit this route
    // whether or not they care about playback; a test that DOES care
    // registers its own `server.use(...)` afterward, which takes priority.
    http.get("*/api/bff/sermons/:id/stream", ({ params }) =>
      HttpResponse.json({
        sermon_id: params.id,
        expires_in: 3600,
        variants: [
          {
            quality: "720p",
            type: "video",
            url: `https://cdn.test/${params.id}.mp4`,
          },
        ],
      }),
    ),
  );
}

function renderScreen(opts: { role?: string; name?: string | null } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider
        user={{
          id: "u-1",
          email: "mia@seed.dev",
          name: opts.name === undefined ? "Mia Okafor" : opts.name,
          role: opts.role ?? "manager",
        }}
      >
        <ReviewScreen />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

const cardFor = (title: string) =>
  screen.getByText(title).closest("article") as HTMLElement;

/* --- tests --------------------------------------------------------- */

describe("ReviewScreen — >48h alert", () => {
  it("is absent when every visible item has waited under 48h", async () => {
    backend([item({ id: "a1", submitted_at: hoursAgo(10) })]);
    renderScreen();

    await screen.findByText("Grace upon grace");
    expect(
      screen.queryByText(/waiting more than 2 days/),
    ).not.toBeInTheDocument();
  });

  it("appears, with the count, once any visible item is older than 48h", async () => {
    backend([
      item({ id: "a1", title: "Old one", submitted_at: hoursAgo(72) }),
      item({ id: "a2", title: "Fresh one", submitted_at: hoursAgo(3) }),
    ]);
    renderScreen();

    await screen.findByText("Old one");
    expect(
      await screen.findByText(
        "1 submission has been waiting more than 2 days.",
      ),
    ).toBeInTheDocument();
  });
});

describe("ReviewScreen — claim state", () => {
  it("keys 'mine' off review_claimed_by_id, not the display name: my card keeps 'Approve only' but drops 'Take over review'", async () => {
    backend([
      item({
        id: "a1",
        title: "Mine to review",
        status: "under_review",
        review_claimed_by: "Mia Okafor",
        review_claimed_by_id: ME.id,
      }),
      item({
        id: "a2",
        title: "Theirs to review",
        status: "under_review",
        review_claimed_by: "Dana Rivers",
        review_claimed_by_id: "u-2",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("Mine to review");

    const mine = cardFor("Mine to review");
    expect(within(mine).getByText("Under review · you")).toBeInTheDocument();
    expect(
      within(mine).getByRole("button", { name: "Approve only" }),
    ).toBeEnabled();
    expect(
      within(mine).queryByRole("button", { name: "Take over review" }),
    ).not.toBeInTheDocument();
    expect(
      within(mine).getByRole("button", { name: "Approve & publish" }),
    ).toBeEnabled();

    const theirs = cardFor("Theirs to review");
    expect(
      within(theirs).getByText("Under review · Dana Rivers"),
    ).toBeInTheDocument();
    // A manager viewing someone else's claim: the act buttons are locked and
    // "Take over review" is offered.
    expect(
      within(theirs).getByRole("button", { name: "Approve only" }),
    ).toBeDisabled();
    expect(
      within(theirs).getByRole("button", { name: "Take over review" }),
    ).toBeEnabled();
  });

  it("a namesake does NOT count as me: same display name, different id → treated as claimed by another", async () => {
    backend([
      item({
        id: "a1",
        title: "Namesake claim",
        status: "under_review",
        review_claimed_by: "Mia Okafor",
        review_claimed_by_id: "someone-else",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("Namesake claim");
    const card = cardFor("Namesake claim");
    expect(
      within(card).getByText("Under review · Mia Okafor"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Reject with note" }),
    ).toBeDisabled();
    expect(
      within(card).getByRole("button", { name: "Take over review" }),
    ).toBeEnabled();
  });
});

describe("ReviewScreen — claim lock (Batch 6 #9)", () => {
  const claimedByOther = () =>
    item({
      id: "a1",
      title: "Val is on this",
      status: "under_review",
      review_claimed_by: "Val Reyes",
      review_claimed_by_id: "u-val",
    });

  it("a manager sees the act buttons disabled with a 'take over' tooltip, then 'Take over review' claims it and re-enables them", async () => {
    const calls: string[] = [];
    backend([claimedByOther()], { calls, takeOverDelayMs: 40 });
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Val is on this");
    const card = cardFor("Val is on this");

    for (const name of ["Approve & publish", "Approve only", "Reject with note"]) {
      const btn = within(card).getByRole("button", { name });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute(
        "title",
        "Val Reyes is reviewing this — take over to act",
      );
    }
    expect(
      within(card).queryByRole("button", { name: "Start review" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(card).getByRole("button", { name: "Take over review" }),
    );

    // Optimistic — the claim flips to me before the (delayed) response lands.
    expect(await screen.findByText("Under review · you")).toBeInTheDocument();

    // Once the mutation settles: buttons live again, take-over gone, claimed by me.
    await waitFor(() =>
      expect(
        within(cardFor("Val is on this")).getByRole("button", {
          name: "Approve & publish",
        }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Take over review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Under review · you")).toBeInTheDocument();
    expect(calls.filter((c) => c === "take-over-review")).toHaveLength(1);
  });

  it("an admin is NOT locked: the same card keeps its act buttons enabled", async () => {
    backend([claimedByOther()]);
    renderScreen({ name: "Ada Admin", role: "admin" });

    await screen.findByText("Val is on this");
    const card = cardFor("Val is on this");

    expect(
      within(card).getByText("Under review · Val Reyes"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Approve & publish" }),
    ).toBeEnabled();
    expect(
      within(card).getByRole("button", { name: "Approve only" }),
    ).toBeEnabled();
    expect(
      within(card).getByRole("button", { name: "Reject with note" }),
    ).toBeEnabled();
  });

  it("take-over 422 (not under review): rolls back with a card-top alert, no claim change", async () => {
    backend([claimedByOther()]);
    server.use(
      http.post(
        "*/api/bff/approvals/sermons/a1/take-over-review",
        async () => {
          await delay(20);
          return HttpResponse.json(
            {
              detail: "cannot take over a sermon in status 'approved'",
              correlation_id: "cid-to-422",
            },
            { status: 422 },
          );
        },
      ),
    );
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Val is on this");
    await user.click(
      screen.getByRole("button", { name: "Take over review" }),
    );

    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot take over a sermon in status 'approved'/),
    ).toBeInTheDocument();
    // Rolled back: still claimed by Val, still locked, take-over still offered.
    const card = cardFor("Val is on this");
    expect(
      within(card).getByText("Under review · Val Reyes"),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Approve & publish" }),
    ).toBeDisabled();
    expect(
      within(card).getByRole("button", { name: "Take over review" }),
    ).toBeEnabled();
  });

  it("take-over 409 (I already hold the claim): treated as a no-op success — no alert, card settles on '· you'", async () => {
    // A race: the card renders claimed by Val, but by the time the click lands
    // the claim is already the caller's, so the server 409s. The refetch then
    // reflects the real state (mine).
    let claim = { by: "Val Reyes", id: "u-val" };
    server.use(
      http.get("*/api/bff/approvals/sermons/review-queue", () =>
        HttpResponse.json({
          items: [
            item({
              id: "a1",
              title: "Val is on this",
              status: "under_review",
              review_claimed_by: claim.by,
              review_claimed_by_id: claim.id,
            }),
          ],
          total: 1,
          limit: 25,
          offset: 0,
        }),
      ),
      http.post("*/api/bff/approvals/sermons/a1/take-over-review", async () => {
        claim = { by: "Mia Okafor", id: ME.id };
        await delay(20);
        return HttpResponse.json(
          { detail: "already_reviewing", correlation_id: "cid-to-409" },
          { status: 409 },
        );
      }),
    );
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Val is on this");
    await user.click(
      screen.getByRole("button", { name: "Take over review" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Under review · you")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("That action didn’t go through"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Take over review" }),
    ).not.toBeInTheDocument();
  });
});

describe("ReviewScreen — self-author lock (review-queue authorship)", () => {
  const SELF_AUTHOR_TITLE =
    "You submitted this sermon — another manager needs to review it";

  it("own pending_review sermon: Start review/Approve/Reject disabled with the backend's exact 403 copy as the tooltip", async () => {
    backend([
      item({
        id: "a1",
        title: "My own submission",
        status: "pending_review",
        created_by: ME.id,
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("My own submission");
    const card = cardFor("My own submission");

    for (const name of [
      "Start review",
      "Approve & publish",
      "Approve only",
      "Reject with note",
    ]) {
      const btn = within(card).getByRole("button", { name });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", SELF_AUTHOR_TITLE);
    }
    // Watch is unaffected by the lock.
    expect(within(card).getByRole("button", { name: "Watch" })).toBeEnabled();
  });

  it("own under_review sermon (necessarily claimed by someone else): Approve/Reject disabled, self-author tooltip wins over the claim-lock tooltip, but Take over review stays enabled", async () => {
    backend([
      item({
        id: "a1",
        title: "Mine, under review",
        status: "under_review",
        created_by: ME.id,
        review_claimed_by: "Val Reyes",
        review_claimed_by_id: "u-val",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("Mine, under review");
    const card = cardFor("Mine, under review");

    for (const name of ["Approve & publish", "Approve only", "Reject with note"]) {
      const btn = within(card).getByRole("button", { name });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", SELF_AUTHOR_TITLE);
    }
    // Not the claim-lock copy — the self-author reason takes priority.
    expect(
      screen.queryByText(/Val Reyes is reviewing this — take over to act/),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Take over review" }),
    ).toBeEnabled();
  });

  it("own approved sermon: Reject and Publish both stay enabled (self-correction carve-out)", async () => {
    backend([
      item({
        id: "a1",
        title: "My approved sermon",
        status: "approved",
        created_by: ME.id,
        review_claimed_by: "Val Reyes",
        review_claimed_by_id: "u-val",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("My approved sermon");
    const card = cardFor("My approved sermon");

    const reject = within(card).getByRole("button", { name: "Reject" });
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("title");
    expect(
      within(card).getByRole("button", { name: "Publish" }),
    ).toBeEnabled();
  });

  it("someone else's sermon is unaffected: the reviewer's own id never matches created_by, so no lock applies", async () => {
    backend([
      item({
        id: "a1",
        title: "Not mine",
        status: "pending_review",
        created_by: "u-someone-else",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("Not mine");
    const card = cardFor("Not mine");

    for (const name of [
      "Start review",
      "Approve & publish",
      "Approve only",
      "Reject with note",
    ]) {
      const btn = within(card).getByRole("button", { name });
      expect(btn).toBeEnabled();
      expect(btn).not.toHaveAttribute("title");
    }
  });

  it("an admin viewing their own sermon is unaffected: admins bypass the self-author lock", async () => {
    backend([
      item({
        id: "a1",
        title: "Admin's own submission",
        status: "pending_review",
        created_by: "u-1", // renderScreen's SessionProvider always signs in as id "u-1".
      }),
    ]);
    renderScreen({ name: "Ada Admin", role: "admin" });

    await screen.findByText("Admin's own submission");
    const card = cardFor("Admin's own submission");

    for (const name of [
      "Start review",
      "Approve & publish",
      "Approve only",
      "Reject with note",
    ]) {
      const btn = within(card).getByRole("button", { name });
      expect(btn).toBeEnabled();
      expect(btn).not.toHaveAttribute("title");
    }
  });
});

describe("ReviewScreen — approved rows publish out of the queue (Batch 6 #12)", () => {
  it("an approved card shows only Publish + Watch; Publish POSTs …/publish and the card leaves the queue", async () => {
    const calls: string[] = [];
    backend(
      [
        item({
          id: "a1",
          title: "Approved, not live",
          status: "approved",
          review_claimed_by: "Val Reyes",
          review_claimed_by_id: "u-val",
        }),
      ],
      { calls },
    );
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Approved, not live");
    const card = cardFor("Approved, not live");

    expect(within(card).getByText("Approved · Val Reyes")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Publish" }),
    ).toBeEnabled();
    for (const name of [
      "Approve only",
      "Approve & publish",
      "Reject with note",
      "Start review",
      "Take over review",
    ]) {
      expect(
        within(card).queryByRole("button", { name }),
      ).not.toBeInTheDocument();
    }

    await user.click(within(card).getByRole("button", { name: "Publish" }));

    expect(
      await screen.findByText("Published to the app"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Approved, not live"),
      ).not.toBeInTheDocument(),
    );
    expect(calls).toEqual(["publish"]);
  });

  it("a bare `publish` 500 rolls the approved card back into the queue with a card-top alert", async () => {
    const calls: string[] = [];
    backend(
      [
        item({
          id: "a1",
          title: "Approved, not live",
          status: "approved",
          review_claimed_by: "Val Reyes",
          review_claimed_by_id: "u-val",
        }),
      ],
      { calls, publishFailTimes: 1 },
    );
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Approved, not live");
    await user.click(
      within(cardFor("Approved, not live")).getByRole("button", {
        name: "Publish",
      }),
    );

    // Rollback: the card comes back, still `approved`, with a card-top alert.
    await waitFor(() =>
      expect(
        within(cardFor("Approved, not live")).getByText(
          /That action didn’t go through/,
        ),
      ).toBeInTheDocument(),
    );
    const card = cardFor("Approved, not live");
    expect(within(card).getByText(/Encoder queue unreachable/)).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Publish" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("Approved · Val Reyes")).toBeInTheDocument();
    // No success toast, no honest-half-shipped screen message.
    expect(screen.queryByText("Published to the app")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/was approved, but publishing failed/),
    ).not.toBeInTheDocument();
    expect(calls).toEqual(["publish"]);
  });
});

describe("ReviewScreen — Reject on an approved card (round 2)", () => {
  it("offers Reject beside Publish, and sending it POSTs /reject and drops the card", async () => {
    const rejectBodies: Array<{ note?: string }> = [];
    backend(
      [
        item({
          id: "a1",
          title: "Approved, not live",
          status: "approved",
          review_claimed_by: "Val Reyes",
          review_claimed_by_id: "u-val",
        }),
      ],
      { rejectBodies },
    );
    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();

    await screen.findByText("Approved, not live");
    const card = cardFor("Approved, not live");

    expect(within(card).getByRole("button", { name: "Publish" })).toBeEnabled();
    const reject = within(card).getByRole("button", { name: "Reject" });
    expect(reject).toBeEnabled();

    await user.click(reject);
    await user.type(
      within(card).getByLabelText(
        "Rejection note (sent to the editor and kept in the log)",
      ),
      "Actually the intro needs a re-record.",
    );
    await user.click(
      within(card).getByRole("button", { name: "Send rejection" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Approved, not live")).not.toBeInTheDocument(),
    );
    expect(rejectBodies).toEqual([
      { note: "Actually the intro needs a re-record." },
    ]);
  });
});

describe("ReviewScreen — inline reject flow", () => {
  it("opens the textarea, gates Send rejection on a non-empty note, posts {note}, and drops the card", async () => {
    const rejectBodies: Array<{ note?: string }> = [];
    backend([item({ id: "a1", title: "Reject me" })], { rejectBodies });

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Reject me");

    await user.click(
      screen.getByRole("button", { name: "Reject with note" }),
    );

    const note = screen.getByLabelText(
      "Rejection note (sent to the editor and kept in the log)",
    );
    const send = screen.getByRole("button", { name: "Send rejection" });
    expect(send).toBeDisabled();

    await user.type(note, "Audio clips at 04:12. Re-record and resubmit.");
    expect(send).toBeEnabled();

    await user.click(send);

    await waitFor(() =>
      expect(screen.queryByText("Reject me")).not.toBeInTheDocument(),
    );
    expect(rejectBodies).toEqual([
      { note: "Audio clips at 04:12. Re-record and resubmit." },
    ]);
  });

  it("rolls back on a 500 and re-shows the textarea with the typed note + a card-top alert", async () => {
    backend([item({ id: "a1", title: "Reject me" })]);
    server.use(
      http.post("*/api/bff/approvals/sermons/a1/reject", async () => {
        await delay(20);
        return HttpResponse.json(
          { detail: "Reviewer lock expired", correlation_id: "cid-r1" },
          { status: 500 },
        );
      }),
    );

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Reject me");

    await user.click(
      screen.getByRole("button", { name: "Reject with note" }),
    );
    await user.type(
      screen.getByLabelText(
        "Rejection note (sent to the editor and kept in the log)",
      ),
      "Needs the closing prayer trimmed.",
    );
    await user.click(screen.getByRole("button", { name: "Send rejection" }));

    // Card-top alert, and the card is back (rollback).
    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reject me")).toBeInTheDocument();
    expect(screen.getByText(/Reviewer lock expired/)).toBeInTheDocument();

    // The textarea is still open AND still holds the note.
    const note = screen.getByLabelText(
      "Rejection note (sent to the editor and kept in the log)",
    ) as HTMLTextAreaElement;
    expect(note.value).toBe("Needs the closing prayer trimmed.");
  });
});

describe("ReviewScreen — approve & publish", () => {
  it("fires approve then publish in order, shows the toast, and removes the card", async () => {
    const calls: string[] = [];
    backend([item({ id: "a1", title: "Ship it" })], { calls });

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Ship it");

    await user.click(
      screen.getByRole("button", { name: "Approve & publish" }),
    );

    expect(
      await screen.findByText("Published to the app"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Ship it")).not.toBeInTheDocument(),
    );
    expect(calls).toEqual(["approve", "publish"]);
  });

  it("reject mode hides 'Approve & publish' — only 'Send rejection' and 'Cancel' show, and Cancel restores the full action row", async () => {
    backend([item({ id: "s7", title: "Half shipped" })]);

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Half shipped");
    const card = cardFor("Half shipped");

    await user.click(within(card).getByRole("button", { name: "Reject with note" }));

    // While rejecting: no "Approve & publish" — approving and rejecting are
    // mutually exclusive intents (fix: reject mode no longer offers it).
    expect(
      within(card).queryByRole("button", { name: "Approve & publish" }),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Send rejection" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();

    // Cancel returns to idle: the full action row (incl. "Approve & publish")
    // is back, and the reject textarea is gone.
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(
      within(card).getByRole("button", { name: "Approve & publish" }),
    ).toBeEnabled();
    expect(
      within(card).queryByLabelText(
        "Rejection note (sent to the editor and kept in the log)",
      ),
    ).not.toBeInTheDocument();
  });

  it("a card never in reject mode is unaffected by the mode reset: approve-ok / publish-fail still lands on a Publish retry", async () => {
    const calls: string[] = [];
    backend([item({ id: "s7", title: "Half shipped" })], {
      calls,
      publishFailTimes: 1,
      keepApproved: true,
    });

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Half shipped");

    // First attempt straight from the default action row (no reject mode):
    // approve 200, publish 500.
    await user.click(
      screen.getByRole("button", { name: "Approve & publish" }),
    );

    // The row refetches as `approved` and stays in the queue (#12): "Publish"
    // retry appears, the approve/reject affordance is gone.
    await waitFor(() =>
      expect(
        within(cardFor("Half shipped")).getByRole("button", { name: "Publish" }),
      ).toBeInTheDocument(),
    );
    expect(
      within(cardFor("Half shipped")).queryByRole("button", {
        name: "Approve & publish",
      }),
    ).not.toBeInTheDocument();
    calls.length = 0;

    // Finish it from the still-visible card via the plain `publish` kind.
    await user.click(
      within(cardFor("Half shipped")).getByRole("button", { name: "Publish" }),
    );

    expect(await screen.findByText("Published to the app")).toBeInTheDocument();
    expect(calls).toEqual(["publish"]);
    expect(calls).not.toContain("approve");
    await waitFor(() =>
      expect(screen.queryByText("Half shipped")).not.toBeInTheDocument(),
    );
  });
});

/* `approvePublish` on an item that is ALREADY `approved` — the short-circuit at
   use-review-actions.ts (`vars.item.status === "approved"`) and the
   `isAlreadyApprovedConflict` 409-catch. After the reject-mode reset above, the
   UI can no longer route an `approved` card to "Approve & publish" (an approved
   card only renders "Publish"), so this branch is exercised directly on the
   hook. */
describe("useReviewActions — approvePublish on an already-approved item", () => {
  function hookHarness(seed: ReviewQueueItem) {
    const client = new QueryClient({
      defaultOptions: {
        // gcTime: Infinity — the seeded queue has no observer (no `useReviewQueue`
        // here), so it must survive until the mutation's `onMutate` reads it.
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData<ReviewQueuePage>(queryKeys.review.queue({ page: 1 }), {
      items: [seed],
      total: 1,
      limit: 25,
      offset: 0,
    });
    const onPublished = vi.fn();
    const onError = vi.fn();
    const onApprovedNotPublished = vi.fn();
    const { result } = renderHook(
      () =>
        useReviewActions({
          meName: ME.name,
          meId: ME.id,
          onError,
          onApprovedNotPublished,
          onPublished,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    const pageItems = () =>
      client.getQueryData<ReviewQueuePage>(
        queryKeys.review.queue({ page: 1 }),
      )?.items ?? [];
    return { result, client, onPublished, onError, onApprovedNotPublished, pageItems };
  }

  it("skips the approve leg entirely (status already `approved`), publishes, and drops the card", async () => {
    const calls: string[] = [];
    backend([], { calls });
    const seed = item({
      id: "s9",
      title: "Already approved",
      status: "approved",
      review_claimed_by: "Val Reyes",
      review_claimed_by_id: "u-val",
    });
    const h = hookHarness(seed);

    act(() => {
      h.result.current.approveAndPublish(seed);
    });

    await waitFor(() => expect(h.onPublished).toHaveBeenCalledTimes(1));
    // No approve call — the short-circuit took the item's own status.
    expect(calls).toEqual(["publish"]);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onApprovedNotPublished).not.toHaveBeenCalled();
    // The optimistic `removeFromQueues` dropped it and the publish success stuck.
    expect(h.pageItems().some((i) => i.id === "s9")).toBe(false);
  });

  it("recovers when the approve leg 409s 'already approved' (stale status): catches it, publishes, drops the card", async () => {
    const calls: string[] = [];
    // The row is `approved` server-side but the caller still holds an
    // `under_review` snapshot, so `approvePublish` attempts approve → 409.
    backend([item({ id: "s9", title: "Stale under review", status: "approved" })], {
      calls,
    });
    const staleSnapshot = item({
      id: "s9",
      title: "Stale under review",
      status: "under_review",
      review_claimed_by: ME.name,
      review_claimed_by_id: ME.id,
    });
    const h = hookHarness(staleSnapshot);

    act(() => {
      h.result.current.approveAndPublish(staleSnapshot);
    });

    await waitFor(() => expect(h.onPublished).toHaveBeenCalledTimes(1));
    // approve was attempted, 409'd, and was swallowed by isAlreadyApprovedConflict.
    expect(calls).toEqual(["approve", "publish"]);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onApprovedNotPublished).not.toHaveBeenCalled();
    expect(h.pageItems().some((i) => i.id === "s9")).toBe(false);
  });
});

describe("ReviewScreen — Start review claims the sermon", () => {
  it("POSTs start-review, keeps the card in the queue as 'Under review · you', drops 'Start review' but keeps 'Approve only'", async () => {
    const calls: string[] = [];
    backend([item({ id: "a1", title: "Claim me" })], {
      calls,
      startReviewDelayMs: 40,
    });

    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();
    await screen.findByText("Claim me");

    await user.click(screen.getByRole("button", { name: "Start review" }));

    // Optimistic — visible before the (delayed) response resolves.
    expect(await screen.findByText("Under review · you")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start review" }),
    ).not.toBeInTheDocument();
    // Present now that I hold the claim, but still busy (this same mutation
    // is in flight) until it settles.
    expect(
      screen.getByRole("button", { name: "Approve only" }),
    ).toBeDisabled();

    await waitFor(() => expect(calls).toContain("start-review"));
    // Still claimed after the settle refetch, and now actionable.
    expect(screen.getByText("Under review · you")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Approve only" }),
      ).toBeEnabled(),
    );
    expect(calls.filter((c) => c === "start-review")).toHaveLength(1);
  });

  it("rolls back to 'pending_review' with a card-top alert when start-review 500s", async () => {
    backend([item({ id: "a1", title: "Claim me" })]);
    server.use(
      http.post("*/api/bff/approvals/sermons/a1/start-review", async () => {
        await delay(20);
        return HttpResponse.json(
          { detail: "Reviewer lock expired", correlation_id: "cid-sr1" },
          { status: 500 },
        );
      }),
    );

    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();
    await screen.findByText("Claim me");

    await user.click(screen.getByRole("button", { name: "Start review" }));

    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reviewer lock expired/)).toBeInTheDocument();
    // Rolled back: still a pending card, the affordance is offered again.
    expect(
      screen.getByRole("button", { name: "Start review" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Under review · you"),
    ).not.toBeInTheDocument();
  });
});

describe("ReviewScreen — concurrent actions", () => {
  it("gates each card's pending state independently: a rolled-back card stays usable, an untouched card is never disabled, and neither action double-submits", async () => {
    const calls: string[] = [];
    backend(
      [
        item({ id: "a1", title: "First up" }),
        item({ id: "a2", title: "Second up" }),
        item({ id: "a3", title: "Bystander" }),
      ],
      { calls },
    );
    // a1's approve: slow success. a2's reject: quick failure → rollback.
    server.use(
      http.post(
        "*/api/bff/approvals/sermons/a1/approve",
        async ({ params }) => {
          calls.push("approve");
          await delay(120);
          return HttpResponse.json({ id: params.id, status: "approved" });
        },
      ),
      http.post("*/api/bff/approvals/sermons/a2/reject", async () => {
        calls.push("reject");
        await delay(20);
        return HttpResponse.json(
          { detail: "Reviewer lock expired", correlation_id: "cid-cc" },
          { status: 500 },
        );
      }),
    );

    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();
    await screen.findByText("First up");

    // Pre-stage a2's rejection so "Send rejection" is a single click.
    await user.click(
      within(cardFor("Second up")).getByRole("button", {
        name: "Reject with note",
      }),
    );
    await user.type(
      within(cardFor("Second up")).getByLabelText(
        "Rejection note (sent to the editor and kept in the log)",
      ),
      "Levels run hot in the last third.",
    );

    // Quick succession: approve a1, then send a2's rejection.
    await user.click(
      within(cardFor("First up")).getByRole("button", { name: "Approve only" }),
    );
    await user.click(
      within(cardFor("Second up")).getByRole("button", {
        name: "Send rejection",
      }),
    );

    // a2's reject fails fast → its card rolls back into view with its own
    // alert while a1's approve is still outstanding.
    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();

    const secondCard = cardFor("Second up");
    // a2's mutation has settled — its actions are live again, NOT held disabled
    // by a1's still-in-flight approve (per-id gating, not one global flag).
    // It rolled back still in reject mode (note preserved), so it's the
    // reject-mode pair — "Approve & publish" isn't offered here — not "Approve
    // & publish" itself.
    expect(
      within(secondCard).getByRole("button", { name: "Send rejection" }),
    ).toBeEnabled();
    expect(
      within(secondCard).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();

    // The bystander card was never acted on and is never disabled — proof the
    // busy flag is scoped per id, not a single screen-wide "a mutation is
    // running" boolean (which this concurrent pair would otherwise trip).
    expect(
      within(cardFor("Bystander")).getByRole("button", { name: "Approve only" }),
    ).toBeEnabled();

    // Let a1's approve settle; each action fired exactly once (no double-submit).
    await waitFor(() =>
      expect(calls.filter((c) => c === "approve")).toHaveLength(1),
    );
    expect(calls.filter((c) => c === "reject")).toHaveLength(1);
  });
});

describe("ReviewScreen — card title links to the sermon page", () => {
  it("wraps the title in a link to /sermons/{id}; the action buttons are not inside it", async () => {
    backend([item({ id: "a1", title: "Read me on the detail page" })]);
    renderScreen();

    const link = await screen.findByRole("link", {
      name: "Read me on the detail page",
    });
    expect(link).toHaveAttribute("href", "/sermons/a1");

    // The approve/reject actions sit beside the title, not within the link.
    const card = cardFor("Read me on the detail page");
    expect(
      within(link).queryByRole("button", { name: "Approve & publish" }),
    ).toBeNull();
    expect(
      within(card).getByRole("button", { name: "Approve & publish" }),
    ).toBeInTheDocument();
  });
});

describe("ReviewScreen — Watch plays the sermon media", () => {
  const stream = (
    variants: Array<{ type: "video" | "audio"; url: string; quality?: string }>,
  ) =>
    http.get("*/api/bff/sermons/:id/stream", ({ params }) =>
      HttpResponse.json({
        sermon_id: params.id,
        expires_in: 3600,
        variants: variants.map((v) => ({ quality: v.quality ?? null, ...v })),
      }),
    );

  it("fetches the stream URL and mounts a <video> player in a dialog", async () => {
    backend([item({ id: "a1", title: "Watch me", renditions_ready: 3 })]);
    let hit = 0;
    server.use(
      http.get("*/api/bff/sermons/:id/stream", ({ params }) => {
        hit += 1;
        return HttpResponse.json({
          sermon_id: params.id,
          expires_in: 3600,
          variants: [
            { quality: "720p", type: "video", url: "https://cdn.test/a1.mp4" },
          ],
        });
      }),
    );

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Watch me");

    // The card already fetched this proactively (for the button label) —
    // wait for that to settle before clicking, then opening the dialog
    // revalidates the (short-lived) signed URL once more.
    await waitFor(() => expect(hit).toBeGreaterThanOrEqual(1));
    await user.click(screen.getByRole("button", { name: "Watch" }));

    const dialog = await screen.findByRole("dialog");
    const player = await within(dialog).findByTestId("sermon-player");
    expect(player.tagName).toBe("VIDEO");
    expect(player).toHaveAttribute("src", "https://cdn.test/a1.mp4");
    expect(hit).toBeGreaterThanOrEqual(1);
  });

  it("mounts an <audio> player when the media ref is audio, and labels the button 'Listen'", async () => {
    backend([item({ id: "a1", title: "Listen to this", renditions_ready: 1 })]);
    server.use(
      stream([{ type: "audio", url: "https://cdn.test/a1.m4a" }]),
    );

    renderScreen();
    const user = userEvent.setup();
    await screen.findByText("Listen to this");

    // The proactive prefetch resolves the media type to audio before any
    // click — the button reads "Listen", not "Watch".
    const listen = await screen.findByRole("button", { name: "Listen" });
    expect(
      screen.queryByRole("button", { name: "Watch" }),
    ).not.toBeInTheDocument();
    await user.click(listen);

    const dialog = await screen.findByRole("dialog");
    const player = await within(dialog).findByTestId("sermon-player");
    expect(player.tagName).toBe("AUDIO");
    expect(player).toHaveAttribute("src", "https://cdn.test/a1.m4a");
  });

  it("disables Watch when the sermon has no processed renditions", async () => {
    backend([item({ id: "a1", title: "Nothing yet", renditions_ready: 0 })]);
    renderScreen();

    const watch = await screen.findByRole("button", { name: "Watch" });
    expect(watch).toBeDisabled();
    expect(watch).toHaveAttribute("title", "No media uploaded yet");
  });
});

describe("ReviewScreen — empty state", () => {
  it("renders the 'Nothing waiting' copy when the queue is empty", async () => {
    backend([]);
    renderScreen();

    expect(await screen.findByText("Nothing waiting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "When editors submit sermons, they land here for review.",
      ),
    ).toBeInTheDocument();
  });
});
