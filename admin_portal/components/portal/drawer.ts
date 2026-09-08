/* =============================================================================
   Drawer state — the <1100px sidebar overlay (W5).

   Extracted from `app-shell.tsx` as a pure reducer so it is unit-tested with
   no DOM (same pattern as `statusVisual`, `paginationRange`). The drawer is
   just a boolean: open or not.
   ========================================================================== */

export type DrawerAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" };

export function drawerReducer(open: boolean, action: DrawerAction): boolean {
  switch (action.type) {
    case "open":
      return true;
    case "close":
      return false;
    case "toggle":
      return !open;
    default:
      return open;
  }
}
