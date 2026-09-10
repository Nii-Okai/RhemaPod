import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_STATUS_LABEL,
  subscriptionStatusVisual,
} from "@/components/subscriptions/subscription-status";
import type { SubscriptionStatus } from "@/lib/query/hooks/use-subscriptions";

/* W21 — the status label/tone registry. The load-bearing rule (plan §A.3):
   a past-due row reads exactly "Past due" and NOTHING resembling a date. */

const ALL: SubscriptionStatus[] = ["active", "past_due", "cancelled", "expired"];

describe("subscriptionStatusVisual", () => {
  it("is total over every SubscriptionStatus", () => {
    for (const status of ALL) {
      const v = subscriptionStatusVisual(status);
      expect(v.label).toBeTruthy();
      expect(v.tone).toBeTruthy();
    }
  });

  it("labels past_due exactly 'Past due' — no date, no digits, no 'since'/'retry'", () => {
    const label = subscriptionStatusVisual("past_due").label;
    expect(label).toBe("Past due");
    expect(label).not.toMatch(/\d/);
    expect(label.toLowerCase()).not.toMatch(/since|retry|until|by /);
  });

  it("uses the plain enum-faithful words for the other statuses", () => {
    expect(SUBSCRIPTION_STATUS_LABEL.active).toBe("Active");
    expect(SUBSCRIPTION_STATUS_LABEL.cancelled).toBe("Cancelled");
    expect(SUBSCRIPTION_STATUS_LABEL.expired).toBe("Expired");
  });

  it("carries no currency glyph in any label", () => {
    for (const status of ALL) {
      expect(SUBSCRIPTION_STATUS_LABEL[status]).not.toMatch(/[$£€]/);
    }
  });
});
