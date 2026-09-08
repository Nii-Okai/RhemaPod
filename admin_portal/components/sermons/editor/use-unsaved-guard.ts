"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Warn before losing unsaved autosave work (plan W8 acceptance: "navigating
 * away with unsaved changes warns").
 *
 * Two mechanisms, because the App Router offers no global route-change hook
 * without a routing library:
 *
 *  - **`beforeunload`** — covers tab close, refresh, and same-tab navigation to
 *    another origin. Registered only while `active`, torn down on unmount / when
 *    it goes inactive.
 *  - **`confirmLeave()`** — wire this into the editor's own `<Link onNavigate>`
 *    (`onNavigate={(e) => { if (!confirmLeave()) e.preventDefault(); }}`) so an
 *    in-editor client navigation prompts.
 *
 * **Residual (see status.md):** a click on the app-shell sidebar / top bar, or
 * the browser Back button, is a client-side App-Router navigation with no
 * framework interception point and is NOT guarded — that would need a routing
 * library the plan's dependency list forbids. `beforeunload` + the in-editor
 * links are the full reach without a dep.
 */
export function useUnsavedChangesGuard(active: boolean): {
  confirmLeave: () => boolean;
} {
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy Chrome/Firefox still need a truthy returnValue to show the
      // prompt; the string itself is never rendered.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  const confirmLeave = useCallback(
    () =>
      !activeRef.current ||
      window.confirm("You have unsaved changes. Leave and lose them?"),
    [],
  );

  return { confirmLeave };
}
