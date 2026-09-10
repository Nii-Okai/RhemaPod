import { describe, expect, it } from "vitest";

import {
  USER_STATE_LABEL,
  userState,
} from "@/components/users/user-state";

/* W19 — the "State" column value. Derived from `is_active` + `activated_at`
   only (no invite-state column — decision 8). `deactivated` outranks
   `pending`. */

describe("userState", () => {
  it("active — a working account", () => {
    expect(userState({ is_active: true, activated_at: "2025-01-01T00:00:00Z" })).toBe(
      "active",
    );
  });

  it("pending — invited, password not yet set (`activated_at == null`)", () => {
    expect(userState({ is_active: true, activated_at: null })).toBe("pending");
    expect(userState({ is_active: true, activated_at: undefined })).toBe(
      "pending",
    );
  });

  it("deactivated — `is_active === false`, and it outranks a null `activated_at`", () => {
    expect(
      userState({ is_active: false, activated_at: "2025-01-01T00:00:00Z" }),
    ).toBe("deactivated");
    expect(userState({ is_active: false, activated_at: null })).toBe(
      "deactivated",
    );
  });
});

describe("USER_STATE_LABEL — a word for every state (never colour-only)", () => {
  it("carries readable text for each state", () => {
    expect(USER_STATE_LABEL).toEqual({
      active: "Active",
      deactivated: "Deactivated",
      pending: "Invite pending",
    });
  });
});
