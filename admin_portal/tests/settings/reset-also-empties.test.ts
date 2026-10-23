import { describe, expect, it } from "vitest";

import { resetAlsoEmpties } from "@/lib/query/hooks/use-data-transfer";

const tables = [
  { name: "users", reset_with: ["sermons", "approval_log", "playlists"] },
  { name: "categories", reset_with: [] },
  { name: "sermons", reset_with: ["approval_log"] },
  { name: "approval_log", reset_with: [] },
  { name: "playlists", reset_with: [] },
];

describe("resetAlsoEmpties", () => {
  it("lists dependent tables outside the selection, in table order", () => {
    expect(resetAlsoEmpties(["users"], tables)).toEqual(["sermons", "approval_log", "playlists"]);
    expect(resetAlsoEmpties(["sermons", "approval_log"], tables)).toEqual([]);
    expect(resetAlsoEmpties(["categories"], tables)).toEqual([]);
  });
});
