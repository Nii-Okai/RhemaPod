import * as React from "react";
import { existsSync, readFileSync } from "node:fs";
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

const LEGAL_PAGES = PAGES.slice(0, 3);

describe.each(LEGAL_PAGES)("public $route page text", ({ Page }) => {
  it("has no PENDING/TODO/DRAFT text and shows an effective date", () => {
    const { container } = render(<Page />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(PENDING|TODO|DRAFT)\b/i);
    expect(text).toMatch(/Effective \d{1,2} [A-Z][a-z]+ \d{4}/);
  });

  it("sets no cookies (page source never touches cookies or headers)", () => {
    const route = PAGES.find((p) => p.Page === Page)!.route;
    const src = readFileSync(`${process.cwd()}/app/(public)${route}/page.tsx`, "utf8");
    expect(src).not.toMatch(/cookies\(|next\/headers|document\.cookie/);
  });
});

describe("/privacy text", () => {
  it("states the retention windows (30 / 90 / 365 days, backups 90, counters 15 min)", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/removed after 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/cleared after 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/Sign-in records:/)).toBeInTheDocument();
    expect(screen.getByText(/deleted after 365 days/)).toBeInTheDocument();
    expect(screen.getByText(/kept for up to 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/last up to 15 minutes/)).toBeInTheDocument();
  });

  it("names the controller and Act 843, with no GDPR/CCPA or registration number", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Watered Garden Church, Dansoman – Accra/);
    expect(text).toMatch(/Act 843/);
    expect(text).toMatch(/contact@rhemapod\.com/);
    expect(text).not.toMatch(/GDPR|CCPA|registration/i);
  });
});

describe("/terms text", () => {
  it("states 13+, Ghana law and courts, and the store-cancellation sentence", () => {
    const { container } = render(<TermsPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/at least 13 years old/);
    expect(text).toMatch(/laws of Ghana/);
    expect(text).toMatch(/courts of Ghana/);
    expect(text).toMatch(
      /Deleting your RhemaPod account does not cancel a subscription bought through the App Store or Google Play/,
    );
    expect(
      screen.getByRole("link", { name: "Community Guidelines" }).getAttribute("href"),
    ).toBe("/guidelines");
  });

  it("names no product or price", () => {
    const { container } = render(<TermsPage />);
    expect(container.textContent ?? "").not.toMatch(/[$€£]\s?\d|GH₵|\d+\s?(USD|GHS)/);
  });
});

describe("/support text", () => {
  it("shows the contact email and links to delete-account", () => {
    render(<SupportPage />);
    expect(
      screen.getAllByRole("link").some((a) => a.getAttribute("href") === "mailto:contact@rhemapod.com"),
    ).toBe(true);
    expect(
      screen.getAllByRole("link", { name: "delete-account page" })[0].getAttribute("href"),
    ).toBe("/delete-account");
  });
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
