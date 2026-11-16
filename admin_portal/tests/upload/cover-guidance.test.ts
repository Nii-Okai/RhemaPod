import { describe, expect, it } from "vitest";

import { coverDimensionsWarning } from "@/lib/upload/cover-guidance";

describe("coverDimensionsWarning", () => {
  it("is quiet for a large, roughly square image", () => {
    expect(coverDimensionsWarning(1080, 1080)).toBeNull();
    expect(coverDimensionsWarning(1200, 1100)).toBeNull();
  });
  it("flags a wide or small image", () => {
    expect(coverDimensionsWarning(1920, 1080)).toMatch(/isn’t square/);
    expect(coverDimensionsWarning(600, 600)).toMatch(/small/);
    expect(coverDimensionsWarning(640, 360)).toMatch(/isn’t square.*and.*small/);
  });
});
