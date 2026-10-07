import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Sidebar, commentsCountLabel } from "@/components/portal/sidebar";
import { navGroupsForRole } from "@/components/portal/nav-config";
import type { NavCounts } from "@/lib/query/hooks/use-nav-counts";
import type { SessionUser } from "@/lib/auth/session-types";

/* S12 — the Comments nav entry and its badge. Pure render: the counts arrive as
   a prop (the `total` of `needs_review=true&limit=1`, asserted on the wire in
   nav-counts.test.ts). */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const USER = (role: string): SessionUser => ({
  id: "u",
  email: "u@example.com",
  name: "U",
  role,
});

const counts = (comments: number | null): NavCounts => ({
  sermons: 1,
  series: 1,
  reviewQueue: 0,
  comments,
});

function renderSidebar(role: string, comments: number | null) {
  return render(
    <Sidebar
      groups={navGroupsForRole(role)}
      user={USER(role)}
      counts={counts(comments)}
    />,
  );
}

describe("Sidebar — Comments entry", () => {
  it.each(["editor", "manager", "admin"])("is visible to %s", (role) => {
    renderSidebar(role, null);
    expect(screen.getByRole("link", { name: "Comments" })).toHaveAttribute(
      "href",
      "/comments",
    );
  });

  it("names the link with the reported count and shows the pill", () => {
    renderSidebar("manager", 3);
    const link = screen.getByRole("link", { name: "Comments, 3 reported" });
    expect(link).toHaveTextContent("3");
  });

  it("caps the pill at 99+", () => {
    renderSidebar("manager", 250);
    expect(
      screen.getByRole("link", { name: "Comments, 99+ reported" }),
    ).toHaveTextContent("99+");
    expect(commentsCountLabel(99)).toBe("99");
    expect(commentsCountLabel(100)).toBe("99+");
  });

  it.each([0, null])("hides the badge when the count is %s", (value) => {
    renderSidebar("manager", value);
    const link = screen.getByRole("link", { name: "Comments" });
    expect(link).toHaveTextContent(/^Comments$/);
  });
});
