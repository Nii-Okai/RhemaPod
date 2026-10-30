import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import GuidelinesPage from "@/app/(public)/guidelines/page";

/* Public /guidelines (plans/plan-ad5-amendment-1-guidelines.md G.4, G6).
 * The page reads GET /settings/public at request time; fetch is stubbed. */
const TEXT = [
  "RhemaPod Comment Guidelines",
  "",
  "Last updated: 30 October 2026",
  "",
  "Welcome to RhemaPod.",
  "",
  "• Edify and Encourage: build up others.",
  "• Protect Privacy: no phone numbers.",
  "",
  "Moderation & Enforcement:",
  "We may delete comments.",
].join("\n");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function renderPage() {
  const ui = await GuidelinesPage();
  return render(ui);
}

afterEach(() => vi.unstubAllGlobals());

describe("/guidelines", () => {
  it("renders the first line as h1, bullets as list items, no placeholder text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ comment_guidelines: TEXT })));
    const { container } = await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "RhemaPod Comment Guidelines" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Last updated: 30 October 2026")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Edify and Encourage: build up others.");
    expect(items).toContain("Protect Privacy: no phone numbers.");
    expect(screen.getByText("Moderation & Enforcement: We may delete comments.")).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/\b(PENDING|TODO|DRAFT)\b/i);
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });

  it("sends no cookie or authorization header", async () => {
    const spy = vi.fn<typeof fetch>().mockImplementation(async () => json({ comment_guidelines: TEXT }));
    vi.stubGlobal("fetch", spy);
    await renderPage();

    expect(spy).toHaveBeenCalled();
    for (const [url, init] of spy.mock.calls) {
      expect(String(url)).toMatch(/\/api\/v1\/settings\/public$/);
      const names = Object.keys((init?.headers ?? {}) as Record<string, string>).map((h) =>
        h.toLowerCase(),
      );
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
      expect(init?.credentials).toBeUndefined();
    }
  });

  it("renders the fallback, with the nav, when the request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await renderPage();

    expect(screen.getByText(/can.t be loaded right now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "contact@rhemapod.com" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });

  it("renders the fallback on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "boom" }, 503)));
    await renderPage();
    expect(screen.getByText(/can.t be loaded right now/)).toBeInTheDocument();
  });

  it("renders the fallback on a 200 with an empty field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ comment_guidelines: "  " })));
    await renderPage();
    expect(screen.getByText(/can.t be loaded right now/)).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn(async () => json({})));
    document.body.innerHTML = "";
    await renderPage();
    expect(screen.getByText(/can.t be loaded right now/)).toBeInTheDocument();
  });
});
