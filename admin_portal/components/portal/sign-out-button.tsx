"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";

/* =============================================================================
   SignOutButton — the "Out" control in the sidebar account footer (W5).

   POSTs `/api/auth/logout` (the BFF revokes upstream, then clears both cookies
   regardless of the revoke result — W4). Backend logout revokes by user id, so
   this signs the staff member out of every device; the confirmation copy says
   so (resolved decision 6). On completion, hard-navigate to `/login`.
   ========================================================================== */

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookies are cleared by the handler even on a failed upstream
      // revoke; if the request never left, fall through to the redirect
      // anyway — the RSC bootstrap will send an unauthenticated user back to
      // /login on the next navigation.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title="Signed out of all devices"
      className={cn(
        "rounded-8 px-8 py-4 text-[12px] font-medium text-ink-muted transition-colors duration-150 ease-out hover:bg-border-subtle hover:text-ink focus-visible:focus-ring-button disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {busy ? "Signing out…" : "Out"}
    </button>
  );
}
