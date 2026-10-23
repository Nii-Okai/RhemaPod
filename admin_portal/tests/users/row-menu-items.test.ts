import { describe, expect, it } from "vitest";

import {
  userRowMenuItems,
  type UserRowMenuArgs,
} from "@/components/users/row-menu-items";
import type { UserPublic } from "@/lib/query/hooks/use-users";

/* W19 — the `···` row-menu gating matrix (session role × target role × target
   state). Pure; the backend guards on `PATCH /users/{id}/active` and
   `POST /users/{id}/resend-invite` are the real enforcement — this locks the
   affordance so the screen never offers an action the backend would 403, and
   offers the state-correct verb (reactivate, not deactivate) on an off row. */

const target = (over: Partial<UserPublic>): UserPublic => ({
  id: "t-1",
  email: "t1@rhemapod.church",
  full_name: "Target One",
  role: "editor",
  is_active: true,
  activated_at: "2025-01-01T00:00:00Z",
  created_at: "2024-06-21T10:00:00Z",
  ...over,
});

const ADMIN = { id: "admin-1", role: "admin" };
const MANAGER = { id: "mgr-1", role: "manager" };

const labels = (args: UserRowMenuArgs) =>
  userRowMenuItems(args).map((i) => i.label);

describe("userRowMenuItems — who may act", () => {
  it("a manager may act on an editor only", () => {
    expect(
      labels({ actor: MANAGER, target: target({ role: "editor" }), activeAdminCount: 2 }),
    ).toEqual(["Deactivate"]);
    expect(
      labels({ actor: MANAGER, target: target({ role: "manager" }), activeAdminCount: 2 }),
    ).toEqual([]);
    expect(
      labels({ actor: MANAGER, target: target({ role: "admin" }), activeAdminCount: 2 }),
    ).toEqual([]);
  });

  it("an admin may act on editor, manager and admin rows", () => {
    for (const role of ["editor", "manager", "admin"] as const) {
      expect(
        labels({ actor: ADMIN, target: target({ role }), activeAdminCount: 3 }),
      ).toContain("Deactivate");
    }
  });

  it("gives the caller no lifecycle actions on their own row", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ id: "admin-1", role: "admin" }),
        activeAdminCount: 3,
      }),
    ).toEqual([]);
  });
});

describe("userRowMenuItems — state-correct verbs", () => {
  it("an active row offers Deactivate, not Reactivate", () => {
    expect(
      labels({ actor: ADMIN, target: target({ is_active: true }), activeAdminCount: 3 }),
    ).toEqual(["Deactivate"]);
  });

  it("a deactivated row offers Reactivate (and Remove for an admin), not Deactivate", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ is_active: false }),
        activeAdminCount: 3,
      }),
    ).toEqual(["Reactivate", "Remove…"]);
  });

  it("Resend invite appears only while `activated_at == null`", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ activated_at: null }),
        activeAdminCount: 3,
      }),
    ).toEqual(["Deactivate", "Resend invite"]);
    expect(
      labels({
        actor: ADMIN,
        target: target({ activated_at: "2025-05-01T00:00:00Z" }),
        activeAdminCount: 3,
      }),
    ).toEqual(["Deactivate"]);
  });

  it("a deactivated, never-activated row offers no Resend invite", () => {
    // Resend is gated on `is_active`: a deactivated account can't authenticate,
    // so a fresh set-password link is a dead affordance.
    expect(
      labels({
        actor: ADMIN,
        target: target({ is_active: false, activated_at: null }),
        activeAdminCount: 3,
      }),
    ).toEqual(["Reactivate", "Remove…"]);
  });

  it("Resend invite needs `is_active` — an active, pending row still offers it", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ is_active: true, activated_at: null }),
        activeAdminCount: 3,
      }),
    ).toEqual(["Deactivate", "Resend invite"]);
  });
});

describe("userRowMenuItems — last active admin", () => {
  it("hides Deactivate on the last active admin row", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ id: "other-admin", role: "admin", is_active: true }),
        activeAdminCount: 1,
      }),
    ).toEqual([]);
  });

  it("offers Deactivate on an admin row when another active admin exists", () => {
    expect(
      labels({
        actor: ADMIN,
        target: target({ id: "other-admin", role: "admin", is_active: true }),
        activeAdminCount: 2,
      }),
    ).toEqual(["Deactivate"]);
  });

  it("Deactivate is the destructive item", () => {
    const [item] = userRowMenuItems({
      actor: ADMIN,
      target: target({ role: "editor" }),
      activeAdminCount: 3,
    });
    expect(item).toMatchObject({ action: "deactivate", destructive: true });
  });
});

describe("userRowMenuItems — Remove", () => {
  it("is admin only, and only once the account is deactivated", () => {
    const off = target({ is_active: false });
    expect(labels({ actor: MANAGER, target: off, activeAdminCount: 1 })).toEqual([
      "Reactivate",
    ]);
    expect(
      labels({ actor: ADMIN, target: target({ is_active: true }), activeAdminCount: 3 }),
    ).not.toContain("Remove…");
  });
});

describe("userRowMenuItems — mobile (viewer) accounts", () => {
  it("lets an admin deactivate, reactivate and remove, never resend an invite", () => {
    const viewer = target({ role: "viewer", is_active: true, activated_at: null });
    expect(labels({ actor: ADMIN, target: viewer, activeAdminCount: 1 })).toEqual(["Deactivate"]);
    expect(
      labels({ actor: ADMIN, target: { ...viewer, is_active: false }, activeAdminCount: 1 }),
    ).toEqual(["Reactivate", "Remove…"]);
  });

  it("gives a manager nothing", () => {
    const viewer = target({ role: "viewer", is_active: true });
    expect(labels({ actor: MANAGER, target: viewer, activeAdminCount: 1 })).toEqual([]);
  });
});
