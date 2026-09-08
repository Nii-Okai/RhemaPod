/**
 * RhemaPod wordmark — direction 1b "Spoken Word" (design README "Assets"):
 * Newsreader "Rhema" + Figtree 600 clay "Pod", baseline-aligned, a 1px
 * letterspaced gap. Built as markup, not a vector, per the design note.
 */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-baseline text-ink select-none"
      style={{ fontSize: size, lineHeight: 1 }}
      aria-label="RhemaPod"
    >
      <span className="font-serif" style={{ letterSpacing: "0.01em" }}>
        Rhema
      </span>
      <span className="font-sans font-semibold text-clay-600" style={{ marginLeft: 1 }}>
        Pod
      </span>
    </span>
  );
}
