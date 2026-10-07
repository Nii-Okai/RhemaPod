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
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SermonEditor } from "@/components/sermons/editor/sermon-editor";
import type { SermonAdminDetail } from "@/lib/query/hooks/use-sermon-admin";

/* W8 — the sermon editor form, rendered (happy-dom). Every backend call is
   MSW (§A.11). Covers: Access radios ↔ tier (`tier_override` drives the
   control; the standalone lock), the newest-first approval-log timeline + empty state,
   optimistic Submit with rollback on a 500, Withdraw-from-under_review's 409
   message, locked fields under review, and (review-fix batch) the field lock
   extending to approved/published with no Withdraw and a status-specific
   banner. */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string | { toString(): string };
    children: React.ReactNode;
  }) => {
    // `onNavigate` is a next/link-only prop (the editor uses it for the
    // unsaved-changes guard); strip it so React doesn't warn about an unknown
    // attribute on a plain <a>.
    delete (props as Record<string, unknown>).onNavigate;
    return (
      <a href={typeof href === "string" ? href : href.toString()} {...props}>
        {children}
      </a>
    );
  },
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

const SERMON_ID = "11111111-1111-1111-1111-111111111111";

function detail(over: Partial<SermonAdminDetail> = {}): SermonAdminDetail {
  return {
    id: SERMON_ID,
    title: "The Prodigal Son",
    description: "A study of Luke 15.",
    thumbnail_url: null,
    duration_seconds: null,
    speaker_id: null,
    speaker_name: null,
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    tier: "free",
    tier_override: null,
    locked: false,
    status: "draft",
    tags: [],
    media_refs: [],
    published_at: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-05T10:00:00Z",
    ...over,
  };
}

interface BackendOpts {
  sermon?: SermonAdminDetail;
  series?: Array<{
    id: string;
    title: string;
    tier: "free" | "paid";
    category_id?: string | null;
  }>;
  categories?: Array<{ id: string; name: string }>;
  approvalLog?: Array<{
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }>;
  onPatch?: (body: Record<string, unknown>) => void;
  /** `total` per comments probe (`all` / `reported` / `hidden`); default 0. */
  commentTotals?: { all: number; reported: number; hidden: number };
  /** Make every comments probe fail with this status. */
  commentsStatus?: number;
}

function backend(opts: BackendOpts = {}) {
  const sermon = opts.sermon ?? detail();
  server.use(
    http.get(`*/api/bff/sermons/${SERMON_ID}`, () => HttpResponse.json(sermon)),
    http.get("*/api/bff/speakers", () => HttpResponse.json([])),
    http.get("*/api/bff/categories", () =>
      HttpResponse.json(
        (opts.categories ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.name.toLowerCase().replace(/\s+/g, "-"),
          sermon_count: 0,
        })),
      ),
    ),
    http.get("*/api/bff/series", () =>
      HttpResponse.json(
        (opts.series ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          description: null,
          category_id: s.category_id ?? null,
          tier: s.tier,
          status: "published",
          thumbnail_url: null,
        })),
      ),
    ),
    http.get(`*/api/bff/approvals/sermons/${SERMON_ID}/approval-log`, () =>
      HttpResponse.json(
        (opts.approvalLog ?? []).map((r) => ({
          from_status: r.from_status,
          to_status: r.to_status,
          actor_id: "00000000-0000-0000-0000-0000000000aa",
          note: r.note,
          created_at: r.created_at,
        })),
      ),
    ),
    http.get(`*/api/bff/sermons/${SERMON_ID}/uploads`, () =>
      HttpResponse.json([]),
    ),
    http.get("*/api/bff/admin/comments", ({ request }) => {
      if (opts.commentsStatus) {
        return HttpResponse.json(
          { detail: "nope", correlation_id: "c" },
          { status: opts.commentsStatus },
        );
      }
      const q = new URL(request.url).searchParams;
      const t = opts.commentTotals ?? { all: 0, reported: 0, hidden: 0 };
      const total = q.get("reported_only")
        ? t.reported
        : q.get("status") === "HIDDEN"
          ? t.hidden
          : t.all;
      return HttpResponse.json({ items: [], total, limit: 1, offset: 0 });
    }),
    http.patch(`*/api/bff/sermons/${SERMON_ID}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      opts.onPatch?.(body);
      return HttpResponse.json({ ...sermon, ...body });
    }),
  );
}

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SermonEditor sermonId={SERMON_ID} />
    </QueryClientProvider>,
  );
}

/* --- Access card ↔ tier ------------------------------------------------- */

describe("SermonEditor — Access radios ↔ tier", () => {
  it("standalone + no override → Inherit selected AND disabled", async () => {
    backend({
      sermon: detail({ series_id: null, tier: "free", tier_override: null }),
    });
    renderEditor();

    const inherit = await screen.findByRole("radio", {
      name: /Inherit from series/,
    });
    expect(inherit).toBeChecked();
    expect(inherit).toBeDisabled();
    expect(
      screen.getByText(/isn’t in a series — it will be free/),
    ).toBeInTheDocument();
  });

  it("in a series + tier_override null → Inherit selected (enabled)", async () => {
    backend({
      sermon: detail({ series_id: "ser-1", tier: "free", tier_override: null }),
      series: [{ id: "ser-1", title: "Luke", tier: "free" }],
    });
    renderEditor();

    const inherit = await screen.findByRole("radio", {
      name: /Inherit from series/,
    });
    expect(inherit).toBeChecked();
    expect(inherit).toBeEnabled();
  });

  it("in a series + tier_override 'free' (series paid) → Free selected", async () => {
    backend({
      sermon: detail({
        series_id: "ser-1",
        tier: "free",
        tier_override: "free",
      }),
      series: [{ id: "ser-1", title: "Luke", tier: "paid" }],
    });
    renderEditor();

    expect(await screen.findByRole("radio", { name: "Free" })).toBeChecked();
  });

  it("picking Paid sends PATCH { tier: 'paid' } on the wire", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ series_id: null, tier: "free" }),
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    await userEvent.click(
      await screen.findByRole("radio", { name: "Paid — subscribers only" }),
    );

    await vi.waitFor(() => expect(bodies).toEqual([{ tier: "paid" }]));
  });
});

/* --- Publish at is gone from the editor, for any role (round 2 —
   scheduled-publish authz fix) ------------------------------------------- */

// This is the regression the whole fix exists to prevent: `publish_at` used
// to be a plain Access-card field (any editor could set their own publish
// schedule at creation or edit time — the authz gap). It's now settable in
// exactly one place, the reviewing manager/admin's `PublishRequest` body on
// `POST …/publish` (`SchedulePublishPanel`, review queue) — never here, for
// any role or status, draft or otherwise.
describe("SermonEditor — no Publish at input anywhere (regression)", () => {
  it("does not render a 'Publish at' field on an editable draft", async () => {
    backend({ sermon: detail({ status: "draft" }) });
    renderEditor();

    await screen.findByLabelText("Title");
    expect(screen.queryByLabelText("Publish at")).not.toBeInTheDocument();
    expect(screen.queryByText("Publish at")).not.toBeInTheDocument();
  });

  it("does not render a 'Publish at' field on a locked (under_review) sermon", async () => {
    backend({ sermon: detail({ status: "under_review" }) });
    renderEditor();

    await screen.findByLabelText("Title");
    expect(screen.queryByLabelText("Publish at")).not.toBeInTheDocument();
  });

  it("never sends publish_at on the autosave PATCH wire, even for a sermon that already carries one", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({
        status: "draft",
        publish_at: "2026-09-10T09:00:00Z",
      }),
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "The Prodigal Son — revised");
    fireEvent.blur(title);

    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).not.toHaveProperty("publish_at");
  });
});

/* --- Approval log ----------------------------------------------------- */

describe("SermonEditor — approval log timeline", () => {
  it("renders newest-first with the rejection note", async () => {
    backend({
      approvalLog: [
        {
          from_status: "draft",
          to_status: "pending_review",
          note: null,
          created_at: "2026-09-01T10:00:00Z",
        },
        {
          from_status: "pending_review",
          to_status: "rejected",
          note: "Audio quality is poor. Please re-record the intro.",
          created_at: "2026-09-03T10:00:00Z",
        },
      ],
    });
    renderEditor();

    const list = await screen.findByRole("list");
    const headlines = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(headlines[0]).toContain("Rejected");
    expect(headlines[0]).toContain(
      "Audio quality is poor. Please re-record the intro.",
    );
    expect(headlines[1]).toContain("Submitted for review");
  });

  it("shows 'No history yet.' when the log is empty", async () => {
    backend({ approvalLog: [] });
    renderEditor();
    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
  });
});

/* --- Submit (optimistic + rollback) --------------------------------- */

describe("SermonEditor — Submit for review", () => {
  it("optimistically shows Pending review, then rolls back to Draft on a 500", async () => {
    backend({ sermon: detail({ status: "draft" }) });
    server.use(
      http.post(`*/api/bff/sermons/${SERMON_ID}/submit`, async () => {
        await delay(30);
        return HttpResponse.json(
          { detail: "Something broke", correlation_id: "cid-500" },
          { status: 500 },
        );
      }),
    );
    renderEditor();

    await screen.findByRole("heading", { name: "The Prodigal Son" });
    expect(screen.getByText("Draft")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Submit for review" }),
    );

    expect(await screen.findByText("Pending review")).toBeInTheDocument();
    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(
      await screen.findByText("That action didn’t go through"),
    ).toBeInTheDocument();
  });
});

/* --- Withdraw + locked state -------------------------------------------- */

describe("SermonEditor — in-review lock + Withdraw", () => {
  it("locks the fields, hides Save/Submit and offers only Withdraw", async () => {
    backend({ sermon: detail({ status: "under_review" }) });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    expect(title).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Withdraw" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This sermon is in review"),
    ).toBeInTheDocument();
  });

  it("surfaces the backend 409 message when withdrawing from under_review", async () => {
    backend({ sermon: detail({ status: "under_review" }) });
    server.use(
      http.post(`*/api/bff/sermons/${SERMON_ID}/withdraw`, () =>
        HttpResponse.json(
          {
            detail:
              "A manager is reviewing this — ask them to send it back.",
            correlation_id: "cid-409",
          },
          { status: 409 },
        ),
      ),
    );
    renderEditor();

    await userEvent.click(
      await screen.findByRole("button", { name: "Withdraw" }),
    );

    expect(
      await screen.findByText(
        /A manager is reviewing this — ask them to send it back\./,
      ),
    ).toBeInTheDocument();
    // No optimistic change to undo — the badge stays "Under review".
    expect(screen.getByText("Under review")).toBeInTheDocument();
  });
});

/* --- approved / published lock ------------------------------------------ */

describe("SermonEditor — approved/published lock (no Withdraw, status-specific banner)", () => {
  it("approved: locks the fields, offers no action button, and shows an approved-specific banner", async () => {
    backend({ sermon: detail({ status: "approved" }) });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    expect(title).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
    // No transition exists back to draft from `approved` — no Withdraw either.
    expect(
      screen.queryByRole("button", { name: "Withdraw" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("This sermon is approved")).toBeInTheDocument();
    expect(
      screen.queryByText("This sermon is in review"),
    ).not.toBeInTheDocument();
  });

  it("published: locks the fields, offers no action button, and shows a published-specific banner", async () => {
    backend({ sermon: detail({ status: "published" }) });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    expect(title).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("This sermon is published")).toBeInTheDocument();
    expect(
      screen.getByText(/A manager can unpublish it from the Sermons list/),
    ).toBeInTheDocument();
  });
});

/* --- draft is always editable (bugfix batch #5) ------------------------- */

describe("SermonEditor — a draft is never locked", () => {
  it("a draft in a paid series (DTO locked=true) stays fully editable with no in-review banner", async () => {
    // `SermonAdminDetail.locked` is the per-user paywall flag (paid tier + no
    // subscription), NOT an editing lock — a draft in a paid series must not
    // read as "in review".
    backend({
      sermon: detail({
        status: "draft",
        series_id: "ser-1",
        tier: "paid",
        locked: true,
      }),
      series: [{ id: "ser-1", title: "Romans", tier: "paid" }],
    });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    expect(title).toBeEnabled();
    expect(
      screen.queryByText("This sermon is in review"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeInTheDocument();
  });
});

/* --- Save draft click confirmation (review-fix batch, item 2) ----------- */

describe("SermonEditor — Save draft shows a click-confirmation toast", () => {
  it("clicking Save draft (with a change already made) shows a 'Draft saved.' toast", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ status: "draft" }),
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "The Prodigal Son — revised");

    // "Save draft" flushes immediately — it doesn't wait out the debounce.
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
  });

  it("does not toast on a plain debounced autosave tick — only on the Save-draft click", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ status: "draft" }),
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    // Real timers for the initial render/data-fetch — `findBy*`/`waitFor`
    // poll on real timers, so switching to fake timers before this resolves
    // deadlocks (same caution as `autosave-sermon.dom.test.tsx`).
    const title = await screen.findByLabelText("Title");

    vi.useFakeTimers();
    fireEvent.change(title, {
      target: { value: "The Prodigal Son — revised" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(bodies.length).toBeGreaterThan(0);
    expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
  });

  it("does not toast when Save draft is clicked with no unsaved change (nothing to flush)", async () => {
    backend({ sermon: detail({ status: "draft" }) });
    renderEditor();

    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    // No pending edits → `flush()` is a no-op (status never reaches "saved").
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Draft saved.")).not.toBeInTheDocument();
  });
});

/* --- Details: Category prefill from Series (bugfix batch #4) ------------ */

describe("SermonEditor — Series picks a Category", () => {
  it("prefills Category from the chosen series when Category is empty", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ series_id: null, category_id: null }),
      series: [
        { id: "ser-1", title: "Luke", tier: "free", category_id: "cat-teaching" },
      ],
      categories: [{ id: "cat-teaching", name: "Teaching" }],
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    await userEvent.selectOptions(
      await screen.findByLabelText("Series"),
      "ser-1",
    );

    await vi.waitFor(() =>
      expect(bodies).toEqual([
        { series_id: "ser-1", category_id: "cat-teaching" },
      ]),
    );
  });

  it("does NOT overwrite a Category the editor already chose", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ series_id: null, category_id: "cat-faith" }),
      series: [
        { id: "ser-1", title: "Luke", tier: "free", category_id: "cat-teaching" },
      ],
      categories: [
        { id: "cat-faith", name: "Faith" },
        { id: "cat-teaching", name: "Teaching" },
      ],
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    await userEvent.selectOptions(
      await screen.findByLabelText("Series"),
      "ser-1",
    );

    await vi.waitFor(() =>
      expect(bodies).toEqual([{ series_id: "ser-1" }]),
    );
  });

  it("clearing the series leaves the Category untouched", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    backend({
      sermon: detail({ series_id: "ser-1", category_id: "cat-teaching" }),
      series: [
        { id: "ser-1", title: "Luke", tier: "free", category_id: "cat-teaching" },
      ],
      categories: [{ id: "cat-teaching", name: "Teaching" }],
      onPatch: (b) => bodies.push(b),
    });
    renderEditor();

    await userEvent.selectOptions(
      await screen.findByLabelText("Series"),
      "", // "Standalone"
    );

    await vi.waitFor(() => expect(bodies).toEqual([{ series_id: null }]));
  });
});

describe("SermonEditor — Comments card", () => {
  it("shows total / reported / hidden from the list totals and deep-links to the queue", async () => {
    backend({ commentTotals: { all: 12, reported: 3, hidden: 2 } });
    renderEditor();

    const link = await screen.findByRole("link", { name: "Review reported" });
    expect(link).toHaveAttribute("href", `/comments?sermon_id=${SERMON_ID}`);
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Reported")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("reads 'View all' when nothing is reported", async () => {
    backend({ commentTotals: { all: 4, reported: 0, hidden: 1 } });
    renderEditor();

    const link = await screen.findByRole("link", { name: "View all" });
    expect(link).toHaveAttribute("href", `/comments?sermon_id=${SERMON_ID}`);
  });

  it("says 'No comments yet.' for a sermon with no comments", async () => {
    backend();
    renderEditor();
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });

  it("renders no Comments card for an unsaved sermon (no id)", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    backend({ commentTotals: { all: 12, reported: 3, hidden: 2 } });
    render(
      <QueryClientProvider client={client}>
        <SermonEditor />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
    expect(screen.queryByText("Comments")).toBeNull();
    expect(screen.queryByRole("link", { name: "Review reported" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View all" })).toBeNull();
  });

  it("fails quietly when the counts can't load", async () => {
    backend({ commentsStatus: 500 });
    renderEditor();
    expect(
      await screen.findByText("Couldn’t load comments."),
    ).toBeInTheDocument();
    // The rest of the editor is unaffected.
    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
  });
});
