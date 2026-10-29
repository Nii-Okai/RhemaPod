import * as React from "react";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import DeleteAccountPage from "@/app/(public)/delete-account/page";

/* The public deletion page Google Play links to (ADR 0020, clients plan D13).
 * Static: it renders with no session, no fetch and no providers. */
describe("public delete-account page", () => {
  it("renders signed out with the in-app steps and the email route", () => {
    render(<DeleteAccountPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Delete your RhemaPod account" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete it in the app" })).toBeInTheDocument();
    const mail = screen.getByRole("link", { name: "contact@rhemapod.com" });
    expect(mail.getAttribute("href")).toMatch(/^mailto:contact@rhemapod\.com\?subject=/);
  });

  it("states the retention windows from ADR 0020 and the manual Apple steps", () => {
    render(<DeleteAccountPage />);
    expect(screen.getByText(/up to 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/up to 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/to 365 days/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Remove Sign in with Apple yourself" })).toBeInTheDocument();
  });

  it("lives outside the authenticated (portal) group, with no middleware gating it", () => {
    const root = `${process.cwd()}/`; // vitest runs from admin_portal/
    expect(existsSync(`${root}app/(public)/delete-account/page.tsx`)).toBe(true);
    expect(existsSync(`${root}app/(portal)/delete-account`)).toBe(false);
    expect(existsSync(`${root}middleware.ts`) || existsSync(`${root}proxy.ts`)).toBe(false);
  });
});
