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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { SessionProvider } from "@/lib/auth/session-context";
import { SeriesDetailScreen } from "@/components/series/series-detail-screen";

/* Batch 5 — the manager-only publish / unpublish control on the Series detail
   screen (`SeriesUpdate.status` accepts draft ⇄ published). Backend via MSW
   (§A.11); `next/navigation` + `next/link` mocked. Covers: a manager publishing
   a draft (PATCH { status: "published" } on the wire, badge flips), the
   unpublish path, and the control being absent for an editor session. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/series/ser-1",
  useSearchParams: () => new URLSearchParams(),
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

interface SeriesRow {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  tier: string;
  status: string;
  thumbnail_url: string | null;
  episode_count: number;
}

const DRAFT: SeriesRow = {
  id: "ser-1",
  title: "Advent 2026",
  description: null,
  category_id: null,
  category_name: null,
  tier: "free",
  status: "draft",
  thumbnail_url: null,
  episode_count: 0,
};

interface BackendResult {
  patches: Array<Record<string, unknown>>;
}

function backend(seed: SeriesRow): BackendResult {
  const current = { ...seed };
  const patches: Array<Record<string, unknown>> = [];
  server.use(
    http.get("*/api/bff/series/:id", () => HttpResponse.json(current)),
    http.get("*/api/bff/categories", () => HttpResponse.json([])),
    http.get("*/api/bff/sermons", () =>
      HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0 }),
    ),
    http.patch("*/api/bff/series/:id", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      Object.assign(current, body);
      return HttpResponse.json(current);
    }),
  );
  return { patches };
}

function renderScreen(role = "manager") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider user={{ id: "u-1", email: "m@x.dev", name: "Mo", role }}>
        <SeriesDetailScreen seriesId="ser-1" />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("SeriesPublishControl", () => {
  it("a manager publishes a draft: PATCH { status: 'published' } and the badge flips", async () => {
    const { patches } = backend(DRAFT);
    renderScreen("manager");

    const publish = await screen.findByRole("button", {
      name: "Publish series",
    });
    // The badge starts on Draft.
    expect(screen.getByText("Draft")).toBeInTheDocument();

    await userEvent.click(publish);

    await waitFor(() => expect(patches).toEqual([{ status: "published" }]));
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unpublish" }),
    ).toBeInTheDocument();
  });

  it("a manager unpublishes a published series: PATCH { status: 'draft' }", async () => {
    const { patches } = backend({ ...DRAFT, status: "published" });
    renderScreen("manager");

    const unpublish = await screen.findByRole("button", { name: "Unpublish" });
    await userEvent.click(unpublish);

    await waitFor(() => expect(patches).toEqual([{ status: "draft" }]));
    expect(await screen.findByText("Draft")).toBeInTheDocument();
  });

  it("shows no publish control for an editor session", async () => {
    backend(DRAFT);
    renderScreen("editor");

    // The form has loaded (its title field is present)…
    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
    // …but neither publish affordance is rendered.
    expect(
      screen.queryByRole("button", { name: "Publish series" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unpublish" }),
    ).not.toBeInTheDocument();
  });
});
