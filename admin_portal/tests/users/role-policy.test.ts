import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  creatableRoles,
} from "@/lib/users/role-policy";

/* W17 — the client mirror of `auth_service._ASSIGNABLE_BY` + the self / manager
   guards. Pure logic; the backend 400 is the real enforcement (asserted on the
   wire in the screen test). */

describe("creatableRoles — the invite dialog's role options", () => {
  it("a manager may invite editors only", () => {
    expect(creatableRoles("manager")).toEqual(["editor"]);
  });

  it("an admin may invite any staff role", () => {
    expect(creatableRoles("admin")).toEqual(["editor", "manager", "admin"]);
  });

  it("an editor or viewer may invite nobody", () => {
    expect(creatableRoles("editor")).toEqual([]);
    expect(creatableRoles("viewer")).toEqual([]);
    expect(creatableRoles("nonsense")).toEqual([]);
  });
});

describe("assignableRoles — the inline role <select> options", () => {
  const ADMIN = { id: "admin-1", role: "admin" };
  const MANAGER = { id: "mgr-1", role: "manager" };

  it("an admin gets all three staff roles for another user's row", () => {
    expect(
      assignableRoles(ADMIN, { id: "u-e", role: "editor" }),
    ).toEqual(["editor", "manager", "admin"]);
    expect(
      assignableRoles(ADMIN, { id: "u-m", role: "manager" }),
    ).toEqual(["editor", "manager", "admin"]);
    expect(
      assignableRoles(ADMIN, { id: "u-a", role: "admin" }),
    ).toEqual(["editor", "manager", "admin"]);
  });

  it("nobody may change their own role — an admin on their own row gets a chip", () => {
    expect(assignableRoles(ADMIN, { id: ADMIN.id, role: "admin" })).toEqual([]);
    expect(
      assignableRoles(MANAGER, { id: MANAGER.id, role: "manager" }),
    ).toEqual([]);
  });

  it("a manager may not touch a manager or an admin row", () => {
    expect(
      assignableRoles(MANAGER, { id: "u-m", role: "manager" }),
    ).toEqual([]);
    expect(
      assignableRoles(MANAGER, { id: "u-a", role: "admin" }),
    ).toEqual([]);
  });

  it("a manager on an editor row gets a chip — the only role it could assign is the one already set", () => {
    expect(
      assignableRoles(MANAGER, { id: "u-e", role: "editor" }),
    ).toEqual([]);
  });
});
