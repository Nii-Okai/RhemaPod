import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { EpisodeOrder } from "@/components/series/episode-order";

/* W11 — the episode-order panel. Backend via MSW (§A.11). Covers: gap-preserving
   render, a move issuing the right PATCH {episode_number} calls with an
   optimistic reorder, a PATCH failure rolling the order back + a panel alert,
   and a locked (under_review) episode's move control being disabled. */

const SERIES_ID = "ser-1";

interface Ep {
  id: string;
  title: string;
  episode_number: number | null;
  status: string;
}

function makeEpisodes(): Ep[] {
  // Numbers 1, 3, 5 — the seed's intentional gaps.
  return [
    { id: "e1", title: "Grace Abounding", episode_number: 1, status: "published" },
    { id: "e2", title: "Faith Over Fear", episode_number: 3, status: "draft" },
    { id: "e3", title: "The Lord's Prayer", episode_number: 5, status: "under_review" },
  ];
}

function page(items: Ep[]) {
  return {
    items: items.map((e) => ({
      id: e.id,
      title: e.title,
      description: null,
      thumbnail_url: null,
      duration_seconds: 1800,
      speaker_id: null,
      speaker_name: null,
      category_id: null,
      category_name: null,
      series_id: SERIES_ID,
      series_title: "Walking in Faith",
      episode_number: e.episode_number,
      tier: "free",
      locked: false,
      status: e.status,
      created_by: "u-1",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    })),
    total: items.length,
    limit: 100,
    offset: 0,
  };
}

interface BackendOptions {
  /** ids whose PATCH should 500. */
  failPatch?: string[];
  /** collector for the last PATCH body per sermon id. */
  patched?: Record<string, number>;
  /** ordered log of every PATCH the client issued. */
  calls?: Array<{ id: string; episode_number: number }>;
  /** override the seed episode set. */
  episodes?: Ep[];
}

function backend({
  failPatch = [],
  patched = {},
  calls = [],
  episodes,
}: BackendOptions = {}) {
  const state = episodes ?? makeEpisodes();
  server.use(
    http.get("*/api/bff/sermons", () => HttpResponse.json(page(state))),
    http.patch("*/api/bff/sermons/:id", async ({ params, request }) => {
      const id = params.id as string;
      const body = (await request.json()) as { episode_number: number };
      calls.push({ id, episode_number: body.episode_number });
      if (failPatch.includes(id)) {
        await delay(10);
        return HttpResponse.json(
          { detail: "boom", correlation_id: "cid-x" },
          { status: 500 },
        );
      }
      patched[id] = body.episode_number;
      const row = state.find((e) => e.id === id);
      if (row) row.episode_number = body.episode_number;
      return HttpResponse.json({ id, episode_number: body.episode_number });
    }),
  );
  return { state, patched, calls };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <EpisodeOrder seriesId={SERIES_ID} seriesTitle="Walking in Faith" />
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EpisodeOrder", () => {
  it("renders episodes sorted with the gap preserved (01, 03, 05)", async () => {
    backend();
    renderPanel();

    await screen.findByText("Grace Abounding");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("01");
    expect(items[0]).toHaveTextContent("Grace Abounding");
    expect(items[1]).toHaveTextContent("03");
    expect(items[2]).toHaveTextContent("05");
  });

  it("move-down on ep 01 PATCHes both swapped episodes and reorders optimistically", async () => {
    const patched: Record<string, number> = {};
    backend({ patched });
    renderPanel();
    await screen.findByText("Grace Abounding");

    await userEvent.click(
      screen.getByRole("button", { name: 'Move “Grace Abounding” down' }),
    );

    // Two PATCHes: e1 takes 3, e2 takes 1.
    await waitFor(() => {
      expect(patched).toEqual({ e1: 3, e2: 1 });
    });

    // Optimistic + reconciled order: Faith Over Fear (now 01) is first.
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Faith Over Fear");
      expect(items[0]).toHaveTextContent("01");
      expect(items[1]).toHaveTextContent("Grace Abounding");
      expect(items[1]).toHaveTextContent("03");
    });
  });

  it("rolls the order back and shows a panel alert when the PATCHes fail", async () => {
    backend({ failPatch: ["e1", "e2"] });
    renderPanel();
    await screen.findByText("Grace Abounding");

    await userEvent.click(
      screen.getByRole("button", { name: 'Move “Grace Abounding” down' }),
    );

    // Optimistic flip first…
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
        "Faith Over Fear",
      );
    });

    // …then the failure rolls it back and alerts on the panel.
    expect(
      await screen.findByText("Couldn’t reorder the episodes"),
    ).toBeInTheDocument();
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Grace Abounding");
      expect(items[0]).toHaveTextContent("01");
    });
  });

  it("disables the move control on a locked (under_review) episode", async () => {
    backend();
    renderPanel();
    await screen.findByText("The Lord's Prayer");

    expect(
      screen.getByRole("button", { name: "Move “The Lord's Prayer” up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move “The Lord's Prayer” down" }),
    ).toBeDisabled();

    // A draft in the middle still moves.
    expect(
      screen.getByRole("button", { name: "Move “Faith Over Fear” up" }),
    ).toBeEnabled();
  });

  it("refuses a move whose span crosses a locked episode: zero PATCHes + a note", async () => {
    const patched: Record<string, number> = {};
    const calls: Array<{ id: string; episode_number: number }> = [];
    backend({
      patched,
      calls,
      episodes: [
        { id: "e1", title: "Grace Abounding", episode_number: 1, status: "published" },
        { id: "e2", title: "Faith Over Fear", episode_number: 3, status: "under_review" },
        { id: "e3", title: "The Lord's Prayer", episode_number: 5, status: "draft" },
      ],
    });
    renderPanel();
    await screen.findByText("The Lord's Prayer");

    // e3 is the only unlocked, movable row; moving it up sweeps the locked e2.
    await userEvent.click(
      screen.getByRole("button", { name: "Move “The Lord's Prayer” up" }),
    );

    expect(
      await screen.findByText("Can’t move past an episode that’s in review."),
    ).toBeInTheDocument();

    // No PATCH was issued and the visible order is unchanged.
    expect(calls).toEqual([]);
    expect(patched).toEqual({});
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Grace Abounding");
    expect(items[1]).toHaveTextContent("Faith Over Fear");
    expect(items[2]).toHaveTextContent("The Lord's Prayer");
  });

  it("on one-lands-one-fails, reverts the landed row and ends at the pre-move order", async () => {
    const patched: Record<string, number> = {};
    const calls: Array<{ id: string; episode_number: number }> = [];
    // Move-down on ep 01 => e1 takes 3, e2 takes 1. e2's PATCH fails.
    backend({ failPatch: ["e2"], patched, calls });
    renderPanel();
    await screen.findByText("Grace Abounding");

    await userEvent.click(
      screen.getByRole("button", { name: 'Move “Grace Abounding” down' }),
    );

    // The alert says nothing changed…
    expect(
      await screen.findByText(/The reorder didn’t complete/),
    ).toBeInTheDocument();

    // …because the landed row (e1 → 3) was PATCHed back to its pre-move 1.
    await waitFor(() => {
      expect(calls).toHaveLength(3);
    });
    // Forward pass (order-independent): e1→3 and e2→1.
    expect(calls.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { id: "e1", episode_number: 3 },
        { id: "e2", episode_number: 1 },
      ]),
    );
    // Then the best-effort revert of the one row that landed.
    expect(calls[2]).toEqual({ id: "e1", episode_number: 1 });
    expect(patched).toEqual({ e1: 1 });

    // Final panel order matches the pre-move order (01 Grace, 03 Faith, 05 Lord's).
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Grace Abounding");
      expect(items[0]).toHaveTextContent("01");
      expect(items[1]).toHaveTextContent("Faith Over Fear");
      expect(items[1]).toHaveTextContent("03");
      expect(items[2]).toHaveTextContent("The Lord's Prayer");
    });
  });
});
