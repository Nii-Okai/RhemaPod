import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { EpisodeOrder } from "@/components/series/episode-order";
import { EPISODE_ORDER_LIMIT } from "@/lib/query/hooks/use-series-episodes";

/* W11 / Batch 5 — the episode-order panel. Backend via MSW (§A.11). Covers:
   sorted (gap-preserving) render, a move issuing exactly ONE atomic
   `PUT .../episode-order` with the full ordered id list + an optimistic
   renumber, a 409 naming the locked episode rolling the order back with a panel
   alert, a 422 surfacing a "reload" alert + rollback, the locked-span
   pre-check blocking client-side with no request, a locked (under_review)
   episode's move control being disabled, and a series whose server total
   exceeds `EPISODE_ORDER_LIMIT` going fully read-only (Batch 5 changed the
   disable reason: the atomic endpoint needs the complete ordered set, which
   past the limit the client has only a recency slice of). */

const SERIES_ID = "ser-1";

interface Ep {
  id: string;
  title: string;
  episode_number: number | null;
  status: string;
}

/** Three non-locked episodes with the seed's intentional gaps (1, 3, 5). */
function makeEpisodes(): Ep[] {
  return [
    { id: "e1", title: "Grace Abounding", episode_number: 1, status: "published" },
    { id: "e2", title: "Faith Over Fear", episode_number: 3, status: "draft" },
    { id: "e3", title: "The Lord's Prayer", episode_number: 5, status: "published" },
  ];
}

function page(items: Ep[], total = items.length) {
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
    total,
    limit: 100,
    offset: 0,
  };
}

interface BackendOptions {
  /** Status for the reorder PUT (default 200). */
  putStatus?: number;
  /** `detail` returned on a non-200 PUT. */
  putDetail?: string;
  /** Override the seed episode set. */
  episodes?: Ep[];
  /** Server total for the series — defaults to the number of loaded rows.
      Set `> EPISODE_ORDER_LIMIT` to model a series the panel can only see a
      recency slice of. */
  total?: number;
}

function backend({
  putStatus = 200,
  putDetail = "boom",
  episodes,
  total,
}: BackendOptions = {}) {
  const state = episodes ?? makeEpisodes();
  const puts: Array<{ episode_ids: string[] }> = [];
  server.use(
    http.get("*/api/bff/sermons", () => HttpResponse.json(page(state, total))),
    http.put(
      "*/api/bff/series/:id/episode-order",
      async ({ request }) => {
        const body = (await request.json()) as { episode_ids: string[] };
        puts.push(body);
        if (putStatus !== 200) {
          await delay(10);
          return HttpResponse.json(
            { detail: putDetail, correlation_id: "cid-x" },
            { status: putStatus },
          );
        }
        // Atomic renumber 1..N by the requested order.
        body.episode_ids.forEach((id, i) => {
          const row = state.find((e) => e.id === id);
          if (row) row.episode_number = i + 1;
        });
        return HttpResponse.json(
          body.episode_ids.map((id, i) => ({ id, episode_number: i + 1 })),
        );
      },
    ),
  );
  return { state, puts };
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

  it("move-down on ep 01 issues exactly ONE PUT with the full ordered id list and renumbers optimistically", async () => {
    const { puts } = backend();
    renderPanel();
    await screen.findByText("Grace Abounding");

    await userEvent.click(
      screen.getByRole("button", { name: 'Move “Grace Abounding” down' }),
    );

    // One atomic request, carrying every episode id in the new order.
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ episode_ids: ["e2", "e1", "e3"] });

    // Optimistic + reconciled order: Faith Over Fear is first, series is now 1..N.
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Faith Over Fear");
      expect(items[0]).toHaveTextContent("01");
      expect(items[1]).toHaveTextContent("Grace Abounding");
      expect(items[1]).toHaveTextContent("02");
      expect(items[2]).toHaveTextContent("The Lord's Prayer");
      expect(items[2]).toHaveTextContent("03");
    });
  });

  it("on a 409, rolls the order back and shows a panel alert naming the locked episode", async () => {
    backend({
      putStatus: 409,
      putDetail: "“The Lord's Prayer” is in review and can’t be renumbered.",
    });
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

    // …then the 409 rolls it back and surfaces the backend's message.
    expect(
      await screen.findByText(/is in review and can’t be renumbered/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("reference: cid-x");
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Grace Abounding");
      expect(items[0]).toHaveTextContent("01");
      expect(items[1]).toHaveTextContent("03");
      expect(items[2]).toHaveTextContent("05");
    });
  });

  it("on a 422, rolls back and shows a 'reload' alert (stale client)", async () => {
    backend({ putStatus: 422, putDetail: "Episode set does not match." });
    renderPanel();
    await screen.findByText("Grace Abounding");

    await userEvent.click(
      screen.getByRole("button", { name: 'Move “Grace Abounding” down' }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
        "Faith Over Fear",
      );
    });

    expect(await screen.findByText(/reload and try again/i)).toBeInTheDocument();
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Grace Abounding");
      expect(items[0]).toHaveTextContent("01");
    });
  });

  it("disables the move control on a locked (under_review) episode", async () => {
    backend({
      episodes: [
        { id: "e1", title: "Grace Abounding", episode_number: 1, status: "published" },
        { id: "e2", title: "Faith Over Fear", episode_number: 3, status: "draft" },
        {
          id: "e3",
          title: "The Lord's Prayer",
          episode_number: 5,
          status: "under_review",
        },
      ],
    });
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

  it("refuses a move whose span crosses a locked episode: no PUT, an inline note", async () => {
    const { puts } = backend({
      episodes: [
        { id: "e1", title: "Grace Abounding", episode_number: 1, status: "published" },
        {
          id: "e2",
          title: "Faith Over Fear",
          episode_number: 3,
          status: "under_review",
        },
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

    // No request was issued and the visible order is unchanged.
    expect(puts).toEqual([]);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Grace Abounding");
    expect(items[1]).toHaveTextContent("Faith Over Fear");
    expect(items[2]).toHaveTextContent("The Lord's Prayer");
  });

  it("goes read-only when the series total exceeds EPISODE_ORDER_LIMIT: notice shown, rows not draggable, zero PUTs", async () => {
    const { puts } = backend({ total: EPISODE_ORDER_LIMIT + 1 });
    renderPanel();
    await screen.findByText("Grace Abounding");

    // The "reordering disabled" notice renders (the loaded rows are an
    // arbitrary recency slice, not episodes 1..N, and the atomic endpoint
    // needs the complete ordered set).
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Reordering is disabled");
    expect(notice).toHaveTextContent(
      `more than ${EPISODE_ORDER_LIMIT} episodes`,
    );

    // Every row is inert: not draggable, both move controls disabled.
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveAttribute("draggable", "false");
    }
    for (const title of ["Grace Abounding", "Faith Over Fear", "The Lord's Prayer"]) {
      expect(
        screen.getByRole("button", { name: `Move “${title}” up` }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: `Move “${title}” down` }),
      ).toBeDisabled();
    }

    // Neither a (disabled) button click nor a full HTML5 drag interaction
    // issues a request — `move()` bails on `overLimit` before `mutate`.
    fireEvent.click(
      screen.getByRole("button", { name: "Move “Grace Abounding” down" }),
    );
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    fireEvent.dragEnd(rows[0]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(puts).toEqual([]);

    // Order is exactly as loaded — the sorted seed, gaps preserved.
    const after = screen.getAllByRole("listitem");
    expect(after[0]).toHaveTextContent("01");
    expect(after[0]).toHaveTextContent("Grace Abounding");
    expect(after[1]).toHaveTextContent("03");
    expect(after[2]).toHaveTextContent("05");
  });
});
