import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTIONS_CSV_HEADERS,
  subscriptionsToCsv,
} from "@/components/subscriptions/subscriptions-csv";
import type { SubscriptionAdminItem } from "@/lib/query/hooks/use-subscriptions";

/* W21 item 4 — the client-side CSV. Columns: member, email, tier, status,
   renewal date. NO amount column, NO provider_customer_id column. The file
   matches the visible filtered set (one line per row passed in). */

const row = (over: Partial<SubscriptionAdminItem>): SubscriptionAdminItem => ({
  id: "s-1",
  user_id: "u-1",
  user_name: "Ada Nwosu",
  user_email: "ada@example.com",
  tier: "monthly",
  status: "active",
  current_period_end: "2026-10-01T00:00:00Z",
  provider_customer_id: "cus_ABC123",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("subscriptionsToCsv", () => {
  it("emits exactly the five headers, no amount and no customer id", () => {
    const header = subscriptionsToCsv([]).split("\r\n")[0];
    expect(header).toBe("Member,Email,Tier,Status,Renewal date");
    expect(SUBSCRIPTIONS_CSV_HEADERS).toHaveLength(5);

    const lower = header.toLowerCase();
    for (const banned of [
      "amount",
      "price",
      "currency",
      "mrr",
      "provider_customer_id",
      "customer id",
      "stripe",
    ]) {
      expect(lower).not.toContain(banned);
    }
  });

  it("writes one line per row, in order, header included", () => {
    const csv = subscriptionsToCsv([
      row({ id: "s-1", user_name: "Ada Nwosu" }),
      row({ id: "s-2", user_name: "Bo Diallo" }),
      row({ id: "s-3", user_name: "Cy Park" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("Ada Nwosu,ada@example.com,monthly,Active,2026-10-01");
    expect(lines[2].startsWith("Bo Diallo,")).toBe(true);
    expect(lines[3].startsWith("Cy Park,")).toBe(true);
  });

  it("renders past_due as 'Past due' and still carries the renewal date in its own column", () => {
    const csv = subscriptionsToCsv([
      row({ status: "past_due", current_period_end: "2026-09-30T00:00:00Z" }),
    ]);
    const cells = csv.split("\r\n")[1].split(",");
    expect(cells[3]).toBe("Past due");
    // The renewal-date column is populated normally — it is the renewal date,
    // not a dunning timestamp (plan §A.3).
    expect(cells[4]).toBe("2026-09-30");
  });

  it("leaves the renewal column blank when current_period_end is null", () => {
    const csv = subscriptionsToCsv([row({ current_period_end: null })]);
    expect(csv.split("\r\n")[1]).toBe(
      "Ada Nwosu,ada@example.com,monthly,Active,",
    );
  });

  it("RFC-4180-quotes a member name containing a comma", () => {
    const csv = subscriptionsToCsv([
      row({ user_name: "Okafor, Jr.", user_email: "j@example.com" }),
    ]);
    expect(csv.split("\r\n")[1]).toBe(
      '"Okafor, Jr.",j@example.com,monthly,Active,2026-10-01',
    );
  });

  it("falls back to an empty member cell when user_name is null", () => {
    const csv = subscriptionsToCsv([row({ user_name: null })]);
    expect(csv.split("\r\n")[1]).toBe(
      ",ada@example.com,monthly,Active,2026-10-01",
    );
  });

  it("never emits a dollar sign", () => {
    const csv = subscriptionsToCsv([row({}), row({ status: "past_due" })]);
    expect(csv).not.toContain("$");
  });

  /* --- OWASP CSV formula-injection guard (gilfoyle W21 🔴) ------------- */

  const cellsOf = (over: Partial<SubscriptionAdminItem>): string[] =>
    subscriptionsToCsv([row(over)]).split("\r\n")[1].split(",");

  it.each([
    ["=cmd", "'=cmd"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@x", "'@x"],
  ])(
    "prefixes a formula-leading member name %j with a single quote",
    (name, expected) => {
      expect(cellsOf({ user_name: name })[0]).toBe(expected);
    },
  );

  it.each([
    ["=x@evil.com", "'=x@evil.com"],
    ["+x@evil.com", "'+x@evil.com"],
    ["-x@evil.com", "'-x@evil.com"],
    ["@x@evil.com", "'@x@evil.com"],
    ["\tx@evil.com", "'\tx@evil.com"],
    ["\rx@evil.com", '"\'\rx@evil.com"'],
  ])(
    "prefixes a formula-leading / whitespace-led email %j with a single quote (email is not trimmed)",
    (email, expected) => {
      expect(cellsOf({ user_name: "Ada", user_email: email })[1]).toBe(
        expected,
      );
    },
  );

  it("neutralises a tab/CR-led member NAME by trimming it before the guard even runs", () => {
    // `user_name` is `.trim()`-ed in subscriptionRowToCsvCells, so a leading
    // \t / \r is gone before csvField sees it — it can never read as a formula.
    expect(cellsOf({ user_name: "\tAda" })[0]).toBe("Ada");
    expect(cellsOf({ user_name: "\r=cmd" })[0]).toBe("'=cmd");
  });

  it("guards a name that legitimately starts with '-' or '@' (accepted cosmetic cost)", () => {
    expect(cellsOf({ user_name: "-Danger" })[0]).toBe("'-Danger");
    expect(cellsOf({ user_name: "@handle" })[0]).toBe("'@handle");
  });

  it("leaves an ordinary name untouched — only the FIRST char triggers the guard", () => {
    // "Mary-Jane" starts with 'M'; the interior '-' is irrelevant.
    expect(cellsOf({ user_name: "Mary-Jane" })[0]).toBe("Mary-Jane");
  });

  it("applies BOTH the formula prefix and RFC-4180 quoting when a field needs both", () => {
    const line = subscriptionsToCsv([
      row({ user_name: "=a,b", user_email: "j@example.com" }),
    ]).split("\r\n")[1];
    // `'=a,b` (formula-guarded) then wrapped for the embedded comma.
    expect(line).toBe('"\'=a,b",j@example.com,monthly,Active,2026-10-01');
  });
});
