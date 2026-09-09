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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { ReviewScreen } from "@/components/review/review-screen";
import type { ReviewQueueItem } from "@/lib/query/hooks/use-review-queue";

/* W10 — the Review queue, rendered (happy-dom). Every backend call is MSW,
   never a mocked fetch (§A.11). Covers: the >48h alert, "Under review · you"
   dropping "Approve only", the inline reject flow (guard + rollback with the
   note preserved), approve-and-publish as two ordered calls + the toast, Watch
   as an optimistic claim, and the empty state. */

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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

/* --- fixtures ------------------------------------------------------- */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

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
}

/** One review-queue endpoint served from a mutable list, plus the four action
    endpoints. `start-review` claims the row; `approve`/`reject` drop it
    (mirrors the real queue: an approved/rejected sermon is no longer
    pending/under review). Every handler mutates `live`, so the post-settle
    refetch reflects the transition. */
function backend(initial: ReviewQueueItem[], opts: BackendOpts = {}) {
  const { calls, rejectBodies, startReviewDelayMs = 0 } = opts;
  let live = [...initial];
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
            ? { ...r, status: "under_review", review_claimed_by: "Mia Okafor" }
            : r,
        );
        return HttpResponse.json({ id: params.id, status: "under_review" });
      },
    ),
    http.post("*/api/bff/approvals/sermons/:id/approve", ({ params }) => {
      calls?.push("approve");
      live = live.filter((r) => r.id !== params.id);
      return HttpResponse.json({ id: params.id, status: "approved" });
    }),
    http.post("*/api/bff/approvals/sermons/:id/publish", ({ params }) => {
      calls?.push("publish");
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
  it("'Under review · you' drops 'Approve only'; another reviewer's name is shown", async () => {
    backend([
      item({
        id: "a1",
        title: "Mine to review",
        status: "under_review",
        review_claimed_by: "Mia Okafor",
      }),
      item({
        id: "a2",
        title: "Theirs to review",
        status: "under_review",
        review_claimed_by: "Dana Rivers",
      }),
    ]);
    renderScreen({ name: "Mia Okafor" });

    await screen.findByText("Mine to review");

    const mine = cardFor("Mine to review");
    expect(within(mine).getByText("Under review · you")).toBeInTheDocument();
    expect(
      within(mine).queryByRole("button", { name: "Approve only" }),
    ).not.toBeInTheDocument();
    expect(
      within(mine).getByRole("button", { name: "Approve & publish" }),
    ).toBeInTheDocument();

    const theirs = cardFor("Theirs to review");
    expect(
      within(theirs).getByText("Under review · Dana Rivers"),
    ).toBeInTheDocument();
    expect(
      within(theirs).getByRole("button", { name: "Approve only" }),
    ).toBeInTheDocument();
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
});

describe("ReviewScreen — Watch", () => {
  it("optimistically claims the card: status → under review, 'Under review · you', no Watch/Approve only", async () => {
    const calls: string[] = [];
    // Delay the server's answer so the optimistic claim is observed first.
    backend([item({ id: "a1", title: "Claim me" })], {
      calls,
      startReviewDelayMs: 40,
    });

    renderScreen({ name: "Mia Okafor" });
    const user = userEvent.setup();
    await screen.findByText("Claim me");

    await user.click(screen.getByRole("button", { name: "Watch" }));

    // Optimistic — visible before the (delayed) response resolves.
    expect(
      await screen.findByText("Under review · you"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Watch" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve only" }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(calls).toContain("start-review"));
    // Still claimed after the settle refetch.
    expect(screen.getByText("Under review · you")).toBeInTheDocument();
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
