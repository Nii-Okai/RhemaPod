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
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { CategoriesCard } from "@/components/people/categories-card";
import type { Category } from "@/lib/query/hooks/use-categories";

/* W12 — the Categories card (happy-dom). Every backend call is MSW (§A.11).
   Covers: count-bearing pills, the "+ new" reveal, the live client-side slug
   preview (and the manual-override latch), a 409 duplicate-slug rendering
   inline on the preview field (never a card alert), an empty slug blocking
   submit, and an optimistic delete carrying the SET-NULL copy. */

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEED: Category[] = [
  { id: "cat-1", name: "Teaching", slug: "teaching" },
  { id: "cat-2", name: "Testimony", slug: "testimony" },
];

interface BackendOptions {
  onPost?: (body: unknown) => void;
  postStatus?: number;
}

function backend({ onPost, postStatus = 201 }: BackendOptions = {}) {
  let categories: Category[] = SEED.map((c) => ({ ...c }));
  server.use(
    http.get("*/api/bff/categories", () => HttpResponse.json(categories)),
    http.get("*/api/bff/sermons", ({ request }) => {
      const id = new URL(request.url).searchParams.get("category_id");
      const total = id === "cat-1" ? 5 : id === "cat-2" ? 2 : 0;
      return HttpResponse.json({ items: [], total, limit: 1, offset: 0 });
    }),
    http.post("*/api/bff/categories", async ({ request }) => {
      const body = (await request.json()) as { name: string; slug: string };
      onPost?.(body);
      if (postStatus !== 201) {
        return HttpResponse.json(
          { detail: "slug already exists", correlation_id: "cid-409" },
          { status: postStatus },
        );
      }
      const created: Category = { id: "cat-new", name: body.name, slug: body.slug };
      categories = [...categories, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.delete("*/api/bff/categories/:id", async ({ params }) => {
      await delay(30);
      categories = categories.filter((c) => c.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <CategoriesCard />
    </QueryClientProvider>,
  );
}

const slugInput = () => screen.getByLabelText("Slug") as HTMLInputElement;

describe("CategoriesCard — pills", () => {
  it("renders a pill per category with its mono sermon count", async () => {
    backend();
    renderCard();

    await screen.findByRole("button", { name: /Teaching/ });
    expect(screen.getByRole("button", { name: /Testimony/ })).toBeInTheDocument();
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("CategoriesCard — the '+ new' form", () => {
  it("reveals a name input and a slug preview, and slugifies the name live until the slug is hand-edited", async () => {
    backend();
    renderCard();
    await screen.findByRole("button", { name: /Teaching/ });

    await userEvent.click(screen.getByRole("button", { name: "New category" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(slugInput().value).toBe("");

    await userEvent.type(screen.getByLabelText("Name"), "Sunday Morning");
    expect(slugInput().value).toBe("sunday-morning");

    // Hand-edit the slug → the name no longer drives it.
    await userEvent.clear(slugInput());
    await userEvent.type(slugInput(), "sunday-am");
    await userEvent.type(screen.getByLabelText("Name"), "!!");
    expect(slugInput().value).toBe("sunday-am");
  });

  it("shows 'That slug is taken' inline on the slug field on a 409 — not a card alert", async () => {
    const posted: unknown[] = [];
    backend({ onPost: (b) => posted.push(b), postStatus: 409 });
    renderCard();
    await screen.findByRole("button", { name: /Teaching/ });

    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    await userEvent.type(screen.getByLabelText("Name"), "Teaching");
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ name: "Teaching", slug: "teaching" });

    expect(await screen.findByText("That slug is taken.")).toBeInTheDocument();
    expect(slugInput()).toHaveAttribute("aria-invalid", "true");
    // NOT the card-top alert.
    expect(screen.queryByText("That didn’t go through")).not.toBeInTheDocument();
  });

  it("blocks submit when the name slugs to nothing", async () => {
    const posted: unknown[] = [];
    backend({ onPost: (b) => posted.push(b) });
    renderCard();
    await screen.findByRole("button", { name: /Teaching/ });

    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    await userEvent.type(screen.getByLabelText("Name"), "日本語");
    expect(slugInput().value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));

    expect(await screen.findByText(/Enter a valid slug/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(0);
  });
});

describe("CategoriesCard — delete", () => {
  it("opens the edit form from a pill, confirms with the SET-NULL copy, and optimistically removes the pill", async () => {
    backend();
    const seen: string[] = [];
    const original = window.confirm;
    window.confirm = vi.fn((msg?: string) => {
      seen.push(msg ?? "");
      return true;
    });
    try {
      renderCard();
      await screen.findByRole("button", { name: /Teaching/ });

      await userEvent.click(screen.getByRole("button", { name: /Teaching/ }));
      // Edit form, pre-filled, count resolved into the Delete label.
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Teaching",
      );
      const del = await screen.findByRole("button", { name: /Delete \(5\)/ });
      await userEvent.click(del);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/5 sermons are detached from it/);
      expect(seen[0]).toMatch(/those sermons stay/);

      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /Teaching/ }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: /Testimony/ })).toBeInTheDocument();
    } finally {
      window.confirm = original;
    }
  });
});
