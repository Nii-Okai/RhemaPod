import * as React from "react";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import PrivacyPage from "@/app/(public)/privacy/page";
import TermsPage from "@/app/(public)/terms/page";
import SupportPage from "@/app/(public)/support/page";
import DeleteAccountPage from "@/app/(public)/delete-account/page";

/* Public legal pages (plans/plan-ad5-retention-and-legal-pages.md B.1, L2).
 * Static: they render with no session, no fetch and no providers. */
const PAGES = [
  { route: "/privacy", title: "Privacy Policy", Page: PrivacyPage },
  { route: "/terms", title: "Terms of Service", Page: TermsPage },
  { route: "/support", title: "Support", Page: SupportPage },
  { route: "/delete-account", title: "Delete your RhemaPod account", Page: DeleteAccountPage },
];

describe.each(PAGES)("public $route page", ({ title, Page }) => {
  it("renders signed out with an h1 and the legal nav", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Legal" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/privacy", "/terms", "/support", "/delete-account"]);
    hrefs.forEach((h) => expect(h).toMatch(/^\/[a-z-]+$/));
  });
});

describe.each(PAGES.slice(0, 3))("public $route page placeholder", () => {
  // Red until L3 writes the real text; L3 turns this into a live test.
  it.todo("has no PENDING/TODO/DRAFT text");
});

describe("public legal routes", () => {
  const root = `${process.cwd()}/`; // vitest runs from admin_portal/

  it("lives outside the authenticated group", () => {
    for (const r of ["privacy", "terms", "support"]) {
      expect(existsSync(`${root}app/(public)/${r}/page.tsx`)).toBe(true);
      expect(existsSync(`${root}app/(portal)/${r}`)).toBe(false);
    }
  });

  it("has no /guidelines route (guidelines stay in-app, staff-edited)", () => {
    expect(existsSync(`${root}app/(public)/guidelines`)).toBe(false);
    expect(existsSync(`${root}app/(portal)/guidelines`)).toBe(false);
    expect(existsSync(`${root}app/guidelines`)).toBe(false);
  });
});
