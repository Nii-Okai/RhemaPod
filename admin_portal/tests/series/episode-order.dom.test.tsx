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

/* W11 / Batch 5 — the episode-order panel. Backend via MSW (§A.11). Covers:
   sorted (gap-preserving) render, a move issuing exactly ONE atomic
   `PUT .../episode-order` with the full ordered id list + an optimistic
   renumber, a 409 naming the locked episode rolling the order back with a panel
   alert, a 422 surfacing a "reload" alert + rollback, the locked-span
   pre-check blocking client-side with no request, and a locked (under_review)
   episode's move control being disabled. */

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
  /** Status for the reorder PUT (default 200). */
  putStatus?: number;
  /** `detail` returned on a non-200 PUT. */
  putDetail?: string;
  /** Override the seed episode set. */
  episodes?: Ep[];
}

function backend({
  putStatus = 200,
  putDetail = "boom",
  episodes,
}: BackendOptions = {}) {
  const state = episodes ?? makeEpisodes();
  const puts: Array<{ episode_ids: string[] }> = [];
  server.use(
    http.get("*/api/bff/sermons", () => HttpResponse.json(page(state))),
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
});
