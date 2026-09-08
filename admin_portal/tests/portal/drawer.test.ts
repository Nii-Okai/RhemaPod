import { describe, expect, it } from "vitest";

import { drawerReducer } from "@/components/portal/drawer";

/* W5 — the <1100px nav drawer. Just a boolean; the hamburger dispatches
   `open`, links + route changes dispatch `close`. */

describe("drawerReducer", () => {
  it("opens from closed", () => {
    expect(drawerReducer(false, { type: "open" })).toBe(true);
  });

  it("closes from open", () => {
    expect(drawerReducer(true, { type: "close" })).toBe(false);
  });

  it("toggles both ways", () => {
    expect(drawerReducer(false, { type: "toggle" })).toBe(true);
    expect(drawerReducer(true, { type: "toggle" })).toBe(false);
  });

  it("open is idempotent, close is idempotent", () => {
    expect(drawerReducer(true, { type: "open" })).toBe(true);
    expect(drawerReducer(false, { type: "close" })).toBe(false);
  });
});
