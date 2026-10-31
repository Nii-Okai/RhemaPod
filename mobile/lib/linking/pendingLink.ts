/**
 * One-slot, in-memory stash for a shared-content link that arrived before the user could
 * open it (signed out, or a cold start whose home screen isn't up yet). Last one wins;
 * expires after 15 minutes; never persisted to disk (ADR 0021, plan-share-links §D.4).
 * `useAuthGuard` takes it once the signed-in user is on home, so the stack is
 * home -> target and Back lands on home.
 */
export const PENDING_LINK_TTL_MS = 15 * 60 * 1000;

let pending: { route: string; stashedAt: number } | null = null;

export function stashPendingLink(route: string): void {
  pending = { route, stashedAt: Date.now() };
}

/** Returns the stashed route once and clears it; `null` when empty or expired. */
export function takePendingLink(): string | null {
  const current = pending;
  pending = null;
  if (!current) return null;
  return Date.now() - current.stashedAt > PENDING_LINK_TTL_MS ? null : current.route;
}

export function clearPendingLink(): void {
  pending = null;
}
