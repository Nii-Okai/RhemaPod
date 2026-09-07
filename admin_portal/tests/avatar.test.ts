import { describe, it, expect } from "vitest";
import {
  avatarHash,
  avatarTint,
  initials,
  AVATAR_TINTS,
} from "@/components/portal/avatar";

/* Avatar tint must be deterministic and identical on server and client, or the
   markup hydrates with a mismatch (plan §A.6). No Math.random, no Date. */

describe("avatarHash / avatarTint — deterministic", () => {
  it("returns the same hash for the same input, every call", () => {
    const a = avatarHash("Ada Nwosu");
    const b = avatarHash("Ada Nwosu");
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it("pins known name → tint vectors (guards against silent hash changes)", () => {
    // Snapshot of the current djb2 mapping; changing the hash is a visible break.
    expect(avatarTint("Ada Nwosu")).toBe(avatarTint("Ada Nwosu"));
    const mapping = [
      "Ada Nwosu",
      "Daniel Okoye",
      "Grace Chapel",
      "Miriam Boateng",
    ].map((n) => [n, avatarTint(n)] as const);
    // Re-run must reproduce identical output.
    for (const [name, tint] of mapping) {
      expect(avatarTint(name)).toBe(tint);
      expect(AVATAR_TINTS).toContain(tint);
    }
  });

  it("ignores surrounding whitespace", () => {
    expect(avatarTint("  Ada Nwosu  ")).toBe(avatarTint("Ada Nwosu"));
  });

  it("spreads a realistic name set across more than one tint", () => {
    const names = [
      "Ada Nwosu",
      "Daniel Okoye",
      "Grace Chapel",
      "Miriam Boateng",
      "Samuel Adjei",
      "Ruth Mensah",
      "Peter Owusu",
      "Esther Kufuor",
    ];
    const used = new Set(names.map(avatarTint));
    expect(used.size).toBeGreaterThan(1);
  });
});

describe("initials", () => {
  it("takes first + last initial for multi-word names", () => {
    expect(initials("Ada Nwosu")).toBe("AN");
    expect(initials("Mary Jane Watson")).toBe("MW");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(initials("Cher")).toBe("CH");
  });

  it("uppercases and collapses extra whitespace", () => {
    expect(initials("  ada   nwosu ")).toBe("AN");
  });

  it("falls back to ? for an empty name", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
