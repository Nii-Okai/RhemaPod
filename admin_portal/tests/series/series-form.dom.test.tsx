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
import { SeriesForm } from "@/components/series/series-form";

/* W11 — create a series: POST /series then navigate to the new id. Backend via
   MSW (§A.11); `next/navigation` router is mocked. */

const nav = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/series/new",
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  nav.push.mockClear();
});
afterAll(() => server.close());

function renderCreate() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <SeriesForm mode="create" />
    </QueryClientProvider>,
  );
}

describe("SeriesForm — create", () => {
  it("POSTs the form and navigates to /series/{newId}", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.get("*/api/bff/categories", () => HttpResponse.json([])),
      http.post("*/api/bff/series", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          {
            id: "ser-new-123",
            title: "Advent 2026",
            description: null,
            category_id: null,
            tier: "paid",
            status: "draft",
            thumbnail_url: null,
          },
          { status: 201 },
        );
      }),
    );

    renderCreate();

    await userEvent.type(
      screen.getByLabelText("Title"),
      "Advent 2026",
    );
    await userEvent.click(
      screen.getByRole("radio", { name: /Paid — subscribers only/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create series" }),
    );

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/series/ser-new-123"));
    expect(bodies).toEqual([
      { title: "Advent 2026", description: null, category_id: null, tier: "paid" },
    ]);
  });

  it("blocks submit and shows an inline error when the title is blank", async () => {
    server.use(
      http.get("*/api/bff/categories", () => HttpResponse.json([])),
      http.post("*/api/bff/series", () => {
        throw new Error("POST should not fire with a blank title");
      }),
    );

    renderCreate();

    // Button is disabled with no title; force the submit path anyway.
    await userEvent.click(screen.getByLabelText("Title"));
    await userEvent.tab();

    expect(await screen.findByText("A title is required.")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
