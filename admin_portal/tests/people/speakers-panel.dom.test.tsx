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
import { SpeakersPanel } from "@/components/people/speakers-panel";
import { AddSpeakerCard } from "@/components/people/add-speaker-card";
import type { Speaker } from "@/lib/query/hooks/use-speakers";

/* W12 / Batch 5 — the Speakers panel + Add-speaker card (happy-dom). Every
   backend call is MSW, never a mocked fetch (§A.11). Covers: row render (avatar,
   "No bio yet", the mono `sermon_count` read straight off the list DTO — no
   probe), the Add-speaker POST + prepend, the blank-name block, optimistic
   delete with the confirm copy naming the sermon count, and a 500 on delete
   rolling the row back with a card-top alert. */

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
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEED: Speaker[] = [
  { id: "spk-1", name: "Ada Grace", bio: "Lead pastor since 2016.", sermon_count: 3 },
  { id: "spk-2", name: "Bem Okoro", bio: null, sermon_count: 0 },
];

interface BackendOptions {
  onPost?: (body: unknown) => void;
  deleteStatus?: number;
}

/** One mutable speakers store. Each row carries its own `sermon_count` (Batch
    5) — spk-1 → 3, spk-2 → 0 — so there is no separate count probe. */
function backend({ onPost, deleteStatus = 204 }: BackendOptions = {}) {
  let speakers: Speaker[] = SEED.map((s) => ({ ...s }));
  server.use(
    http.get("*/api/bff/speakers", () => HttpResponse.json(speakers)),
    http.post("*/api/bff/speakers", async ({ request }) => {
      const body = (await request.json()) as { name: string; bio: string | null };
      onPost?.(body);
      const created: Speaker = {
        id: `spk-${speakers.length + 1}`,
        name: body.name,
        bio: body.bio ?? null,
        sermon_count: 0,
      };
      speakers = [...speakers, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.delete("*/api/bff/speakers/:id", async ({ params }) => {
      await delay(30);
      if (deleteStatus !== 204) {
        return HttpResponse.json(
          { detail: "Speaker is referenced elsewhere", correlation_id: "cid-del" },
          { status: deleteStatus },
        );
      }
      speakers = speakers.filter((s) => s.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
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
      <SpeakersPanel onAddSpeaker={() => {}} />
      <AddSpeakerCard />
    </QueryClientProvider>,
  );
}

function stubConfirm(result: boolean) {
  const seen: string[] = [];
  const original = window.confirm;
  window.confirm = vi.fn((msg?: string) => {
    seen.push(msg ?? "");
    return result;
  });
  return {
    seen,
    restore: () => {
      window.confirm = original;
    },
  };
}

describe("SpeakersPanel — rows", () => {
  it("renders each row with a tinted initials avatar, the bio or a 'No bio yet' fallback, and the mono sermon count", async () => {
    backend();
    renderPanel();

    await screen.findByText("Ada Grace");
    expect(screen.getByText("Bem Okoro")).toBeInTheDocument();

    // Avatar initials (W2 `Avatar`, aria-hidden text).
    expect(screen.getByText("AG")).toBeInTheDocument();
    expect(screen.getByText("BO")).toBeInTheDocument();

    // Bio + fallback.
    expect(screen.getByText("Lead pastor since 2016.")).toBeInTheDocument();
    expect(screen.getByText("No bio yet")).toBeInTheDocument();

    // spk-1's `sermon_count` renders straight from the list row.
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("AddSpeakerCard", () => {
  it("POSTs { name, bio } and the new speaker appears in the list", async () => {
    const posted: unknown[] = [];
    backend({ onPost: (b) => posted.push(b) });
    renderPanel();
    await screen.findByText("Ada Grace");

    await userEvent.type(screen.getByLabelText("Name"), "Cara New");
    await userEvent.type(screen.getByLabelText("Bio"), "Youth lead");
    await userEvent.click(screen.getByRole("button", { name: "Save speaker" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ name: "Cara New", bio: "Youth lead" });
    expect(await screen.findByText("Cara New")).toBeInTheDocument();
  });

  it("blocks submit on a blank name with an inline error and fires no POST", async () => {
    const posted: unknown[] = [];
    backend({ onPost: (b) => posted.push(b) });
    renderPanel();
    await screen.findByText("Ada Grace");

    await userEvent.click(screen.getByRole("button", { name: "Save speaker" }));

    expect(await screen.findByText("A name is required.")).toBeInTheDocument();
    // Give a stray request a chance to land, then assert none did.
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(0);
  });
});

describe("SpeakersPanel — delete", () => {
  it("confirms with copy naming the sermon count, then optimistically removes the row", async () => {
    backend();
    const confirm = stubConfirm(true);
    try {
      renderPanel();
      await screen.findByText("Ada Grace");
      await screen.findByText("3"); // spk-1.sermon_count → the confirm copy names it

      await userEvent.click(
        screen.getByRole("button", { name: "Actions for Ada Grace" }),
      );
      const menu = await screen.findByRole("menu");
      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Delete" }),
      );

      expect(confirm.seen).toHaveLength(1);
      expect(confirm.seen[0]).toMatch(/detaches from 3 sermons/);
      expect(confirm.seen[0]).toMatch(/those sermons stay/);

      // Optimistic: gone before the DELETE (30ms delay) resolves.
      await waitFor(() =>
        expect(screen.queryByText("Ada Grace")).not.toBeInTheDocument(),
      );
      // Bem stays.
      expect(screen.getByText("Bem Okoro")).toBeInTheDocument();
    } finally {
      confirm.restore();
    }
  });

  it("rolls the row back and shows a card-top alert (with the backend detail + reference) when the DELETE 500s", async () => {
    backend({ deleteStatus: 500 });
    const confirm = stubConfirm(true);
    try {
      renderPanel();
      await screen.findByText("Ada Grace");
      await screen.findByText("3");

      await userEvent.click(
        screen.getByRole("button", { name: "Actions for Ada Grace" }),
      );
      const menu = await screen.findByRole("menu");
      await userEvent.click(
        within(menu).getByRole("menuitem", { name: "Delete" }),
      );

      // Optimistic removal…
      await waitFor(() =>
        expect(screen.queryByText("Ada Grace")).not.toBeInTheDocument(),
      );
      // …then rollback + alert.
      expect(await screen.findByText("That didn’t go through")).toBeInTheDocument();
      expect(await screen.findByText("Ada Grace")).toBeInTheDocument();
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Speaker is referenced elsewhere");
      expect(alert).toHaveTextContent("reference: cid-del");
    } finally {
      confirm.restore();
    }
  });
});
