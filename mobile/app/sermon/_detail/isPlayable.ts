import type { components } from '../../../lib/api/schema';

export type SermonDetail = components['schemas']['SermonDetail'];

/**
 * Whether the sermon's CTA and full meta line (format segment / renditions clause, design
 * spec §8.1.5) render normally, vs. the §8.3 no-media disabled composition.
 *
 * Two conditions collapse into this single check, per the Conductor's interim decision
 * (W4.1, pending Isaac's sign-off, recorded in status.md): `media_refs = []` (Stream
 * ingest/transcode not finished — the addendum's own no-media case, §8.3) and
 * `locked: true` (the backend still computes paid-tier locking even though plan L1 cuts
 * the paid tier indefinitely). A locked sermon renders the *exact same* no-media
 * composition — no paywall, upsell, PAID badge, or tier wording anywhere — because no
 * locked-specific state exists in this addendum and L1 forbids inventing one. Isolated
 * here as the single source of truth so no other call site re-derives this condition.
 */
export function isPlayable(detail: SermonDetail): boolean {
  return !detail.locked && detail.media_refs.length > 0;
}
