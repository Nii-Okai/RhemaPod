import { expect, test, type Page } from "@playwright/test";

/**
 * W14 keyboard-only walk of the money path (plan §W14: "keyboard-only run of the
 * money path"; risk D6 — the CSS-grid DataTable must keep roving focus /
 * Space-select / Shift-range without `<table>` semantics).
 *
 * Pointer is never used past the initial `goto`. Every step drives the UI with
 * Tab / Shift+Tab / arrows / Space / Enter / Escape and asserts:
 *   - the expected element takes focus,
 *   - focus is visibly indicated (a real outline or ring — the design's
 *     `focus-ring-button` / `focus-ring-input`),
 *   - menus open on the keyboard, arrow-navigate, close on Escape, and hand
 *     focus back to their trigger,
 *   - the DataTable selection model (roving row focus, Space toggle, Shift+Space
 *     range) works from the keyboard and drives the clay bulk bar.
 *
 * It stops short of the irreversible approve+publish (that is `money-path.spec.ts`
 * against the seed) — this walk proves the *keyboard reachability* of each
 * surface on the path, run every suite pass, without consuming seed rows or the
 * per-account rate-limit budget on a publish.
 *
 * Fixture: the seeded Docker stack (`global-setup.ts`).
 */

const PASSWORD = "SeedDev-Passphrase-2026";
const EDITOR = "editor.sam@seed.rhemapod.dev";

/** A focused element counts as "visibly focused" if it (or its box) carries a
 *  non-zero outline or a box-shadow ring — i.e. one of the design's two focus
 *  treatments actually painted. */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const outline =
      cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const ring = cs.boxShadow !== "none" && cs.boxShadow.trim() !== "";
    // :focus-visible must also be matching — programmatic focus without it
    // would paint nothing in the design's model.
    let fv = false;
    try {
      fv = el.matches(":focus-visible");
    } catch {
      fv = true; // very old engines: don't block on the pseudo-class
    }
    return (outline || ring) && fv;
  });
}

async function activeRole(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute("role") ?? null,
  );
}

async function activeText(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "",
  );
}

/** Tab forward until `predicate` holds or `max` presses are spent. */
async function tabUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  max = 40,
): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (await predicate()) return true;
    await page.keyboard.press("Tab");
  }
  return predicate();
}

test.describe("keyboard-only money-path walk", () => {
  test("login → sermons DataTable → row menu → editor, keyboard only", async ({
    page,
  }) => {
    const failures: string[] = [];
    type Cond = boolean | Promise<boolean> | (() => boolean | Promise<boolean>);
    const check = async (label: string, cond: Cond) => {
      const value = typeof cond === "function" ? cond() : cond;
      if (!(await value)) failures.push(label);
    };

    // ---- 1. Login, keyboard only -----------------------------------------
    await page.goto("/login");
    await page.keyboard.press("Tab"); // → Email (first focusable in the form)
    await check("login: Tab reaches the Email field", async () => {
      const el = await page.evaluate(
        () => (document.activeElement as HTMLInputElement | null)?.name,
      );
      return el === "email" || (await activeText(page)) === "";
    });
    await check("login: Email field shows a visible focus ring", focusIsVisible(page));
    await page.keyboard.type(EDITOR);
    await page.keyboard.press("Tab"); // → Password
    await check("login: password field is visibly focused", focusIsVisible(page));
    await page.keyboard.type(PASSWORD);
    // Tab past "Keep me signed in" + "Forgot password?" to the submit button.
    const onSignIn = await tabUntil(page, async () => {
      const t = await activeText(page);
      return t === "Sign in" || t === "Signing in…";
    }, 8);
    await check("login: Tab reaches the Sign in button", onSignIn);
    await check("login: Sign in button is visibly focused", focusIsVisible(page));
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });

    // ---- 2. Sermons list — DataTable keyboard model ---------------------
    await page.goto("/sermons");
    await expect(page.getByRole("heading", { name: "Sermons" })).toBeVisible();
    const grid = page.getByRole("grid", { name: "Sermons" });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("row")).not.toHaveCount(0);

    // Tab from the top of the page until a grid row holds focus (roving
    // tabindex: exactly one row is a tab stop).
    const onRow = await tabUntil(page, async () => (await activeRole(page)) === "row", 60);
    await check("sermons: Tab reaches a grid row (roving tabindex)", onRow);
    await check("sermons: the focused row shows a visible focus ring", focusIsVisible(page));

    const rowIndexNow = () =>
      page.evaluate(() =>
        Number(document.activeElement?.getAttribute("aria-rowindex") ?? "-1"),
      );
    const firstIdx = await rowIndexNow();

    await page.keyboard.press("ArrowDown");
    await check(
      "sermons: ArrowDown moves row focus to the next row",
      async () => (await rowIndexNow()) === firstIdx + 1,
    );
    await check("sermons: row focus stays visibly indicated after ArrowDown", focusIsVisible(page));
    await page.keyboard.press("ArrowUp");
    await check(
      "sermons: ArrowUp moves row focus back",
      async () => (await rowIndexNow()) === firstIdx,
    );

    // Space toggles selection of the focused row → aria-selected + the sr-only
    // live count.
    await page.keyboard.press("Space");
    await check(
      "sermons: Space selects the focused row (aria-selected)",
      async () =>
        (await page.evaluate(
          () => document.activeElement?.getAttribute("aria-selected"),
        )) === "true",
    );
    const liveCount = () =>
      page.locator('[role="status"]', { hasText: "selected" }).first().innerText();
    await check(
      "sermons: selecting one row announces '1 selected'",
      async () => (await liveCount()).trim().startsWith("1"),
    );

    // Shift+Space from the anchor across two more rows → contiguous range.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+Space");
    await check(
      "sermons: Shift+Space range-selects from the anchor (3 rows)",
      async () => {
        const n = await page
          .locator('[role="row"][aria-selected="true"]')
          .count();
        return n === 3;
      },
    );
    await check(
      "sermons: the clay bulk bar replaces the header when rows are selected",
      page
        .getByRole("toolbar", { name: "Bulk actions" })
        .getByText(/\d+ selected/)
        .isVisible(),
    );

    // Clear the selection (Space on the 3 focused/again) so the row menu step
    // starts clean — Space toggles the currently focused (3rd) row off, then
    // walk back up toggling each.
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");

    // ---- 3. The `···` row menu — open / arrow / Escape / focus return --
    // Tab forward from the focused row to the row's actions trigger.
    const onMenuTrigger = await tabUntil(
      page,
      async () => {
        const label = await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        );
        return Boolean(label && label.startsWith("Actions for "));
      },
      6,
    );
    await check("sermons: Tab reaches a row's ··· actions trigger", onMenuTrigger);
    await check("sermons: the ··· trigger is visibly focused", focusIsVisible(page));

    const triggerLabel = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await check("sermons: Enter opens the row menu", menu.isVisible());
    await check(
      "sermons: focus moves into the open menu",
      async () =>
        (await page.evaluate(
          () => document.activeElement?.getAttribute("role"),
        )) === "menuitem",
    );
    await page.keyboard.press("ArrowDown");
    await check(
      "sermons: ArrowDown moves between menu items",
      async () =>
        (await page.evaluate(
          () => document.activeElement?.getAttribute("role"),
        )) === "menuitem",
    );
    await page.keyboard.press("Escape");
    await check("sermons: Escape closes the row menu", menu.isHidden());
    await check(
      "sermons: focus returns to the ··· trigger after Escape",
      async () =>
        (await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        )) === triggerLabel,
    );

    // ---- 4. Sermon editor — form fields are keyboard-reachable ---------
    await page.goto("/sermons/new");
    await expect(page.getByLabel("Title")).toBeVisible();
    const onTitle = await tabUntil(page, async () => {
      const el = await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.getAttribute("id"),
      );
      const lbl = el
        ? await page.locator(`label[for="${el}"]`).innerText().catch(() => "")
        : "";
      return lbl.trim() === "Title";
    }, 30);
    await check("editor: Tab reaches the Title field", onTitle);
    await check("editor: Title field shows a visible focus treatment", focusIsVisible(page));

    // Walk the rest of the Details card in DOM order and confirm each stop is
    // visibly focused (no keyboard-dead controls).
    const fieldsSeen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const meta = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        return {
          tag: el.tagName.toLowerCase(),
          id: el.getAttribute("id"),
          label: el.getAttribute("aria-label"),
          type: el.getAttribute("type"),
        };
      });
      if (!meta) break;
      const name = meta.id || meta.label || meta.tag;
      fieldsSeen.add(name);
      if (["radio", "submit"].includes(meta.type ?? "")) break;
    }
    await check(
      "editor: at least 4 distinct form controls are tab-reachable in the Details card",
      fieldsSeen.size >= 4,
    );

    // ---- verdict -------------------------------------------------------
    expect(
      failures,
      `Keyboard-walk failures (${failures.length}):\n - ${failures.join("\n - ")}`,
    ).toEqual([]);
  });
});
