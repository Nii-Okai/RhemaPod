import { describe, it, expect } from "vitest";
import {
  statusVisual,
  SERMON_STATUS_PIPELINE,
  UPLOAD_STATUS_PIPELINE,
  type AnyStatus,
} from "@/components/portal/status-badge";

/* The a11y guarantee under test (plan §A.6, DoD "Status is never colour-only"):
   the dot's pipeline position is DERIVED from the ordered status enum, never
   hand-placed per variant, so it cannot drift out of sync with the label. */

describe("statusVisual — pipeline position is derived, not hand-placed", () => {
  it("places every sermon-pipeline status dot at its exact index in SERMON_STATUS_PIPELINE", () => {
    SERMON_STATUS_PIPELINE.forEach((status, index) => {
      const v = statusVisual(status);
      expect(v.dotIndex).toBe(index);
      expect(v.dotIndex).toBe(SERMON_STATUS_PIPELINE.indexOf(status));
      expect(v.dotFilled).toBe(true);
      expect(v.offPipeline).toBe(false);
      expect(v.rail).toBe("sermon");
      expect(v.railLength).toBe(SERMON_STATUS_PIPELINE.length);
    });
  });

  it("advances the dot monotonically along the sermon pipeline", () => {
    const indices = SERMON_STATUS_PIPELINE.map((s) => statusVisual(s).dotIndex);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  it("does the same for the upload pipeline", () => {
    UPLOAD_STATUS_PIPELINE.forEach((status, index) => {
      const v = statusVisual(status);
      expect(v.dotIndex).toBe(index);
      expect(v.rail).toBe("upload");
      expect(v.dotFilled).toBe(true);
    });
  });

  it("anchors rejected at the review step with a hollow dot", () => {
    const v = statusVisual("rejected");
    expect(v.offPipeline).toBe(true);
    expect(v.dotFilled).toBe(false);
    expect(v.dotIndex).toBe(SERMON_STATUS_PIPELINE.indexOf("under_review"));
    expect(v.tone).toBe("rose");
  });

  it("anchors unpublished and archived at the published step with a hollow dot", () => {
    for (const s of ["unpublished", "archived"] as const) {
      const v = statusVisual(s);
      expect(v.offPipeline).toBe(true);
      expect(v.dotFilled).toBe(false);
      expect(v.dotIndex).toBe(SERMON_STATUS_PIPELINE.indexOf("published"));
      expect(v.tone).toBe("outline");
    }
  });

  it("anchors upload failure at the processing step", () => {
    const v = statusVisual("failed");
    expect(v.offPipeline).toBe(true);
    expect(v.dotFilled).toBe(false);
    expect(v.rail).toBe("upload");
    expect(v.dotIndex).toBe(UPLOAD_STATUS_PIPELINE.indexOf("processing"));
  });

  it("is total — every known status yields a label and a valid dot slot", () => {
    const ALL: AnyStatus[] = [
      ...SERMON_STATUS_PIPELINE,
      "rejected",
      "unpublished",
      "archived",
      ...UPLOAD_STATUS_PIPELINE,
      "failed",
    ];
    for (const s of ALL) {
      const v = statusVisual(s);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.dotIndex).toBeGreaterThanOrEqual(0);
      expect(v.dotIndex).toBeLessThan(v.railLength);
    }
  });

  it("is a pure function — repeated calls return equal shapes", () => {
    expect(statusVisual("under_review")).toEqual(statusVisual("under_review"));
  });
});
