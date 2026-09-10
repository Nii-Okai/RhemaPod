import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SubscriptionsScreen } from "@/components/subscriptions/subscriptions-screen";
import { subscriptionsToCsv } from "@/components/subscriptions/subscriptions-csv";
import type { SubscriptionAdminItem } from "@/lib/query/hooks/use-subscriptions";

/* W21 — the Subscriptions screen, rendered (happy-dom). Every backend call is
   MSW, never a mocked fetch (§A.11). Proves the acceptance list: tiles from
   `/counts`, `?status=`/`?tier=` on the wire, a past-due row that reads exactly
   "Past due" with no date, "Open in Stripe" present-with-href / absent on a
   null customer id, a client CSV that matches the visible filtered set with no
   amount and no customer-id column, no dollar sign anywhere, and no non-GET
   request from any interaction. */

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
  usePathname: () => "/subscriptions",
  useSearchParams: () => nav.search,
}));

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
});
afterEach(() => {
  server.resetHandlers();
  nav.replace.mockClear();
  nav.search = new URLSearchParams();
});
afterAll(() => server.close());

/* --- fixtures ---------------------------------------------------------- */

const sub = (over: Partial<SubscriptionAdminItem>): SubscriptionAdminItem => ({
  id: "s-1",
  user_id: "u-1",
  user_name: "Ada Nwosu",
  user_email: "ada@example.com",
  tier: "monthly",
  status: "active",
  current_period_end: "2026-10-01T00:00:00Z",
  provider_customer_id: "cus_ADA",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const ROWS: SubscriptionAdminItem[] = [
  sub({ id: "s-a", user_name: "Ada Nwosu", user_email: "ada@example.com", tier: "monthly", status: "active", provider_customer_id: "cus_ADA" }),
  sub({ id: "s-b", user_name: "Bo Diallo", user_email: "bo@example.com", tier: "annual", status: "past_due", current_period_end: "2026-09-30T00:00:00Z", provider_customer_id: "cus_BO" }),
  sub({ id: "s-c", user_name: "Cy Park", user_email: "cy@example.com", tier: "free", status: "expired", current_period_end: null, provider_customer_id: null }),
];

const COUNTS = { active_paid: 24, monthly: 15, annual: 9 };

interface BackendOpts {
  rows?: SubscriptionAdminItem[];
  counts?: typeof COUNTS;
  onList?: (q: URLSearchParams) => void;
}

const nonGet: string[] = [];

function backend(opts: BackendOpts = {}) {
  const counts = opts.counts ?? COUNTS;
  const all = opts.rows ?? ROWS;

  server.use(
    http.get("*/api/bff/admin/subscriptions/counts", () =>
      HttpResponse.json(counts),
    ),
    http.get("*/api/bff/admin/subscriptions", ({ request }) => {
      const q = new URL(request.url).searchParams;
      opts.onList?.(q);
      const status = q.get("status");
      const tier = q.get("tier");
      const filtered = all.filter(
        (r) =>
          (!status || r.status === status) && (!tier || r.tier === tier),
      );
      return HttpResponse.json({
        items: filtered,
        total: filtered.length,
        limit: 25,
        offset: 0,
      });
    }),
    ...(["post", "patch", "put", "delete"] as const).map((verb) =>
      http[verb]("*/api/bff/*", ({ request }) => {
        nonGet.push(`${request.method} ${new URL(request.url).pathname}`);
        return HttpResponse.json({}, { status: 200 });
      }),
    ),
  );
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SubscriptionsScreen />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  nonGet.length = 0;
});
afterEach(() => {
  nonGet.length = 0;
});

/* --- tiles ----------------------------------------------------------- */

describe("SubscriptionsScreen — stat tiles", () => {
  it("renders Active paid / Monthly / Annual from /counts", async () => {
    backend();
    renderScreen();

    await screen.findByText("Ada Nwosu");
    expect(screen.getByTestId("subscription-count-active_paid")).toHaveTextContent("24");
    expect(screen.getByTestId("subscription-count-monthly")).toHaveTextContent("15");
    expect(screen.getByTestId("subscription-count-annual")).toHaveTextContent("9");
  });

  it("shows the API's active_paid verbatim, not a client-side monthly+annual sum", async () => {
    backend({ counts: { active_paid: 999, monthly: 15, annual: 9 } });
    renderScreen();

    await screen.findByText("Ada Nwosu");
    expect(screen.getByTestId("subscription-count-active_paid")).toHaveTextContent("999");
  });
});

/* --- filter → wire ------------------------------------------------- */

describe("SubscriptionsScreen — filters on the wire", () => {
  it("sends no status/tier when unfiltered", async () => {
    const seen: URLSearchParams[] = [];
    backend({ onList: (q) => seen.push(q) });
    renderScreen();

    await screen.findByText("Ada Nwosu");
    expect(seen.at(-1)!.has("status")).toBe(false);
    expect(seen.at(-1)!.has("tier")).toBe(false);
  });

  it("puts ?status= on the wire when the URL carries one, and narrows the list", async () => {
    const seen: URLSearchParams[] = [];
    nav.search = new URLSearchParams("status=past_due");
    backend({ onList: (q) => seen.push(q) });
    renderScreen();

    await screen.findByText("Bo Diallo");
    expect(seen.at(-1)!.get("status")).toBe("past_due");
    expect(screen.queryByText("Ada Nwosu")).not.toBeInTheDocument();
  });

  it("changing the tier select writes ?tier= and replaces (not pushes)", async () => {
    backend();
    renderScreen();
    await screen.findByText("Ada Nwosu");

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tier"),
      "annual",
    );

    expect(nav.replace).toHaveBeenCalled();
    expect(nav.replace.mock.calls.at(-1)![0]).toContain("tier=annual");
  });
});

/* --- past-due copy ------------------------------------------------- */

describe("SubscriptionsScreen — past-due row", () => {
  it("reads exactly 'Past due' with no date of any kind in the badge", async () => {
    backend();
    renderScreen();

    const row = (await screen.findByText("Bo Diallo")).closest('[role="row"]')!;
    const badge = within(row as HTMLElement).getByTestId("subscription-status");

    expect(badge.textContent?.trim()).toBe("Past due");
    // No retry date, no since-date, no digits at all next to the word.
    expect(badge.textContent ?? "").not.toMatch(/\d/);
    expect((badge.textContent ?? "").toLowerCase()).not.toMatch(/since|retry/);
  });

  it("still shows current_period_end in its own renewal column", async () => {
    backend();
    renderScreen();

    const row = (await screen.findByText("Bo Diallo")).closest('[role="row"]')!;
    // The date lives in the renewal cell, not the status badge.
    expect(row.textContent).toContain("2026-09-30");
  });
});

/* --- Open in Stripe --------------------------------------------- */

describe("SubscriptionsScreen — Open in Stripe", () => {
  it("renders a link with the customer href when provider_customer_id is set", async () => {
    backend();
    renderScreen();

    const row = (await screen.findByText("Ada Nwosu")).closest('[role="row"]')!;
    const link = within(row as HTMLElement).getByRole("link", {
      name: "Open in Stripe",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/customers/cus_ADA",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is absent from the DOM entirely for a row with provider_customer_id: null", async () => {
    backend();
    renderScreen();

    const row = (await screen.findByText("Cy Park")).closest('[role="row"]')!;
    expect(
      within(row as HTMLElement).queryByRole("link", { name: "Open in Stripe" }),
    ).not.toBeInTheDocument();
    // Not merely hidden/disabled — the text is nowhere in the row.
    expect(row.textContent).not.toContain("Open in Stripe");
  });
});

/* --- CSV ------------------------------------------------------- */

describe("SubscriptionsScreen — client CSV", () => {
  let createdBlobs: Blob[];
  let origCreate: typeof URL.createObjectURL;
  let origRevoke: typeof URL.revokeObjectURL;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    createdBlobs = [];
    origCreate = URL.createObjectURL;
    origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      createdBlobs.push(b);
      return "blob:mock";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });
  afterEach(() => {
    createdBlobs.length = 0;
    clickSpy.mockClear();
  });
  afterAll(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    clickSpy.mockRestore();
  });

  it("downloads a CSV whose header has no amount and no customer-id column, one line per visible row", async () => {
    backend();
    renderScreen();
    await screen.findByText("Ada Nwosu");

    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(createdBlobs).toHaveLength(1);
    const text = await createdBlobs[0].text();
    const lines = text.split("\r\n");

    expect(lines[0]).toBe("Member,Email,Tier,Status,Renewal date");
    expect(text.toLowerCase()).not.toContain("amount");
    expect(text.toLowerCase()).not.toContain("currency");
    expect(text).not.toContain("cus_");
    expect(text).not.toContain("$");
    // header + the three visible rows
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe("Bo Diallo,bo@example.com,annual,Past due,2026-09-30");
  });

  it("matches the active filter — a past-due filter exports only the past-due row", async () => {
    nav.search = new URLSearchParams("status=past_due");
    backend();
    renderScreen();
    await screen.findByText("Bo Diallo");

    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    const text = await createdBlobs[0].text();
    const expected = subscriptionsToCsv([ROWS[1]]);
    expect(text).toBe(expected);
    expect(text.split("\r\n")).toHaveLength(2); // header + 1
  });
});

/* --- no money, no mutation ----------------------------------- */

describe("SubscriptionsScreen — read-only, no currency", () => {
  it("renders no dollar sign anywhere on the screen", async () => {
    backend();
    const { container } = renderScreen();
    await screen.findByText("Ada Nwosu");
    expect(container.textContent ?? "").not.toMatch(/[$£€]/);
  });

  it("issues no non-GET request across load + filter + CSV", async () => {
    backend();
    renderScreen();
    await screen.findByText("Ada Nwosu");

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tier"),
      "monthly",
    );
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(nonGet).toEqual([]);
  });
});
