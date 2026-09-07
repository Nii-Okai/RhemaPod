import type { CSSProperties, ReactNode } from "react";

/* ============================================================================
   W1 token-audit page.

   Renders the RhemaPod design tokens (colour, spacing, radius, elevation,
   focus) and all three font families so the @theme layer in app/globals.css
   can be checked side-by-side against
   docs/design_admin_portal/RhemaPod UI Kit.dc.html.

   This is a design-system reference, not a product screen. The full /kit
   component gallery is W2.
   ========================================================================== */

type Swatch = { token: string; label: string; hex: string; onDark?: boolean };

const NEUTRALS: Swatch[] = [
  { token: "surface", label: "cards, tables, top bar", hex: "#FFFFFF" },
  { token: "surface-sunken", label: "page bg, table headers, hover", hex: "#FBF9F5" },
  { token: "canvas", label: "sidebar, app background, chips", hex: "#F7F4EE" },
  { token: "border-subtle", label: "row dividers, inner rules", hex: "#EFE9DF" },
  { token: "border", label: "card + container borders", hex: "#E4DDD1" },
  { token: "border-strong", label: "input borders, dropzones", hex: "#D8CFC0" },
];

const INK: Swatch[] = [
  { token: "ink-faint", label: "mono labels, meta, disabled", hex: "#9C9085" },
  { token: "ink-muted", label: "secondary body text", hex: "#6B6055" },
  { token: "ink-soft", label: "inactive nav labels", hex: "#5C534A" },
  { token: "ink", label: "primary text", hex: "#2E2723", onDark: true },
];

const CLAY: Swatch[] = [
  { token: "clay-50", label: "ghost hover, selected row", hex: "#FBF1EC" },
  { token: "clay-100", label: "focus-ring glow, PAID badge", hex: "#F1E4DC" },
  { token: "clay-400", label: "chart mid series, dark accent", hex: "#DE8F63" },
  { token: "clay-600", label: "PRIMARY — buttons, links, bars", hex: "#A65B3A", onDark: true },
  { token: "clay-700", label: "primary hover, clay-on-tint", hex: "#7E4128", onDark: true },
];

const STATUS: Swatch[] = [
  { token: "sage", label: "published, active, positive", hex: "#3F7A55", onDark: true },
  { token: "sage-tint", label: "approved badge fill", hex: "#E6F0E9" },
  { token: "sage-text", label: "approved badge text", hex: "#2F6342", onDark: true },
  { token: "wheat", label: "pending, past due, warnings", hex: "#8A6A1F", onDark: true },
  { token: "wheat-tint", label: "pending badge fill", hex: "#F7EFDA" },
  { token: "wheat-text", label: "pending badge text", hex: "#725718", onDark: true },
  { token: "slate", label: "under review, processing", hex: "#3D6491", onDark: true },
  { token: "slate-tint", label: "processing badge fill", hex: "#E7EEF6" },
  { token: "slate-text", label: "processing badge text", hex: "#33547A", onDark: true },
  { token: "rose", label: "rejected, failed, destructive", hex: "#A33F3F", onDark: true },
  { token: "rose-tint", label: "rejected badge fill", hex: "#F7E7E7" },
  { token: "rose-text", label: "rejected badge text", hex: "#8C3535", onDark: true },
  { token: "rose-border", label: "destructive button border", hex: "#E2C4C4" },
  { token: "rose-bg", label: "destructive button hover", hex: "#FCF2F2" },
];

const MISC: Swatch[] = [
  { token: "on-clay", label: "text on clay-600", hex: "#FFF8F3" },
  { token: "dark", label: "toast bg, Admin role chip", hex: "#2E2723", onDark: true },
  { token: "dark-deep", label: "dark (alt) — #241F1B", hex: "#241F1B", onDark: true },
];

const ALERTS: Swatch[] = [
  { token: "alert-success-bg", label: "success alert surface", hex: "#F2F8F3" },
  { token: "alert-success-border", label: "success alert border", hex: "#C6D6C9" },
  { token: "alert-warning-bg", label: "warning alert surface", hex: "#FCF7EA" },
  { token: "alert-warning-border", label: "warning alert border", hex: "#E5D7B4" },
  { token: "alert-error-bg", label: "error alert surface", hex: "#FCF2F2" },
  { token: "alert-error-border", label: "error alert border", hex: "#E2C4C4" },
];

const BADGE_FILLS: Swatch[] = [
  { token: "neutral-badge", label: "Draft / Unpublished fill", hex: "#F2EFE8" },
  { token: "sage-dot", label: "Published badge dot", hex: "#B6D6C0" },
];

const SPACING = [2, 4, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28];
const OFF_GRID = new Set([6, 7, 9, 11, 18, 22]);
const RADII = [4, 5, 6, 8, 9, 10, 11, 12, 14, 16, 18];

const SHADOWS = [
  {
    cls: "shadow-nav-active",
    label: "active nav item",
    css: "inset 0 0 0 1px #E4DDD1",
  },
  {
    cls: "shadow-segmented-thumb",
    label: "segmented-control thumb",
    css: "0 1px 2px rgba(46,39,35,.06)",
  },
  {
    cls: "shadow-toast",
    label: "toast",
    css: "0 8px 24px rgba(46,39,35,.16)",
  },
] as const;

function cssVar(token: string): CSSProperties {
  return { background: `var(--color-${token})` };
}

function SwatchGrid({ title, items }: { title: string; items: Swatch[] }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
        {title}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-10">
        {items.map((s) => (
          <div
            key={s.token}
            className="flex flex-col overflow-hidden rounded-12 border border-border bg-surface"
          >
            <div
              className="flex h-16 items-end justify-end border-b border-border-subtle p-6"
              style={cssVar(s.token)}
            >
              <span
                className={`font-mono text-[10px] ${
                  s.onDark ? "text-on-clay/80" : "text-ink-faint"
                }`}
              >
                {s.hex}
              </span>
            </div>
            <div className="flex flex-col gap-2 px-11 py-9">
              <span className="text-[13px] font-semibold">{s.token}</span>
              <span className="text-[12px] text-ink-muted">{s.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  blurb,
  children,
}: {
  index: string;
  title: string;
  blurb?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-20">
      <div className="flex flex-col gap-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {index}
        </div>
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h2>
        {blurb ? (
          <p className="max-w-[62ch] text-[15px] text-ink-muted">{blurb}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-28 px-28 py-28">
      <header className="flex flex-col gap-14 border-b border-border pb-24">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[30px] font-normal tracking-[-0.01em]">
            Rhema
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em] text-clay-600">
            Pod
          </span>
        </div>
        <h1 className="font-serif text-[52px] font-normal leading-[1.02] tracking-[-0.025em]">
          Token audit
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-[1.6] text-ink-muted">
          W1 reference. Every colour, spacing step, radius, shadow and font
          family below is wired from the <code className="font-mono text-[14px]">@theme</code>{" "}
          layer in <code className="font-mono text-[14px]">app/globals.css</code>,
          transcribed verbatim from the design token table. Check it against{" "}
          <code className="font-mono text-[14px]">
            RhemaPod UI Kit.dc.html
          </code>
          .
        </p>
      </header>

      <Section
        index="01"
        title="Typography"
        blurb="Newsreader (serif) for titles and metrics; Figtree (sans) for all functional UI; IBM Plex Mono for IDs, timestamps, durations and labels. All self-hosted via next/font."
      >
        <div className="flex flex-col overflow-hidden rounded-16 border border-border bg-surface">
          {[
            { label: "Figtree 400 — body", cls: "font-sans font-normal text-[15px]" },
            { label: "Figtree 500 — label", cls: "font-sans font-medium text-[15px]" },
            { label: "Figtree 600 — heading", cls: "font-sans font-semibold text-[15px]" },
            { label: "Figtree 700 — strong", cls: "font-sans font-bold text-[15px]" },
            { label: "Newsreader 400 — page title", cls: "font-serif font-normal text-[22px]" },
            { label: "Newsreader 500 — content title", cls: "font-serif font-medium text-[22px]" },
            { label: "IBM Plex Mono 400 — meta", cls: "font-mono font-normal text-[13px] tracking-[0.06em]" },
            { label: "IBM Plex Mono 500 — mono strong", cls: "font-mono font-medium text-[13px] tracking-[0.06em]" },
          ].map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[220px_1fr] items-baseline gap-20 border-b border-border-subtle px-24 py-20 last:border-b-0"
            >
              <span className="font-mono text-[11px] text-ink-faint">
                {row.label}
              </span>
              <span className={row.cls}>
                The weight of mercy — Sunday 09:41 · 42:18 · 8f3c1e
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        index="02"
        title="Colour"
        blurb="Warm neutrals carry the interface; clay is the only interactive accent; sage / wheat / slate / rose are reserved for status."
      >
        <div className="flex flex-col gap-24">
          <SwatchGrid title="Neutrals · warm" items={NEUTRALS} />
          <SwatchGrid title="Ink ramp" items={INK} />
          <SwatchGrid title="Accent · clay (interactive)" items={CLAY} />
          <SwatchGrid title="Status" items={STATUS} />
          <SwatchGrid title="Misc" items={MISC} />
          <SwatchGrid title="Alert surfaces" items={ALERTS} />
          <SwatchGrid title="Status-badge fills (from component spec)" items={BADGE_FILLS} />
        </div>
      </Section>

      <Section
        index="03"
        title="Spacing"
        blurb="16 steps in px. Off Tailwind's 4px grid at 6, 7, 9, 11, 18, 22 (marked ·) — defined as explicit --spacing-* tokens."
      >
        <div className="flex flex-col gap-9 rounded-16 border border-border bg-surface p-24">
          {SPACING.map((n) => (
            <div key={n} className="flex items-center gap-14">
              <span className="w-16 font-mono text-[12px] text-ink-faint">
                {n}
                {OFF_GRID.has(n) ? " ·" : ""}
              </span>
              <span
                className="block h-14 rounded-4 bg-clay-600"
                style={{ width: `var(--spacing-${n})` }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        index="04"
        title="Radius"
        blurb="Ten discrete radii plus 999 for pills, avatars and dots. Each is load-bearing (9 toolbar controls vs 10 buttons vs 11 login button)."
      >
        <div className="flex flex-wrap gap-16 rounded-16 border border-border bg-surface p-24">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-8">
              <span
                className="h-16 w-16 border border-border-strong bg-clay-50"
                style={{ borderRadius: `var(--radius-${r})` }}
              />
              <span className="font-mono text-[11px] text-ink-faint">{r}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-8">
            <span className="h-16 w-16 rounded-full border border-border-strong bg-clay-50" />
            <span className="font-mono text-[11px] text-ink-faint">999</span>
          </div>
        </div>
      </Section>

      <Section
        index="05"
        title="Elevation"
        blurb="Shadows are almost absent by design. These three are the entire set."
      >
        <div className="flex flex-wrap gap-24 rounded-16 border border-border bg-canvas p-24">
          {SHADOWS.map((s) => (
            <div key={s.cls} className="flex flex-col gap-8">
              <span
                className={`h-20 w-40 rounded-12 border border-border-subtle bg-surface ${s.cls}`}
              />
              <span className="text-[13px] font-semibold">{s.cls}</span>
              <span className="font-mono text-[11px] text-ink-faint">
                {s.css}
              </span>
              <span className="text-[12px] text-ink-muted">{s.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        index="06"
        title="Focus treatment"
        blurb="Inputs: clay border + 0 0 0 3px #F1E4DC glow. Buttons: 2px #DE8F63 ring at 2px offset. Exposed as focus-ring-input / focus-ring-button utilities — shown here applied statically."
      >
        <div className="flex flex-wrap items-center gap-24 rounded-16 border border-border bg-surface p-24">
          <input
            readOnly
            value="The Weight of Mercy"
            className="focus-ring-input h-11 rounded-10 border border-border-strong bg-surface px-12 text-[15px] outline-none"
          />
          <button
            type="button"
            className="focus-ring-button h-10 rounded-10 border border-clay-600 bg-clay-600 px-18 text-[14px] font-semibold text-on-clay"
          >
            Publish sermon
          </button>
        </div>
      </Section>

      <Section
        index="07"
        title="Utilities compile"
        blurb="A spot-check that the @theme keys generate Tailwind utilities (literal class names, statically extractable)."
      >
        <div className="flex flex-wrap gap-12 rounded-16 border border-border bg-surface p-24">
          <span className="rounded-full bg-clay-600 px-11 py-6 text-[12px] font-semibold text-on-clay">
            bg-clay-600
          </span>
          <span className="rounded-full bg-sage-tint px-11 py-6 text-[12px] font-semibold text-sage-text">
            sage-tint / sage-text
          </span>
          <span className="rounded-full bg-wheat-tint px-11 py-6 text-[12px] font-semibold text-wheat-text">
            wheat-tint / wheat-text
          </span>
          <span className="rounded-8 border border-border-strong px-11 py-6 font-mono text-[12px] text-ink-muted">
            border-border-strong
          </span>
          <span className="rounded-9 bg-surface-sunken px-11 py-7 text-[12px] text-ink-soft">
            p-7 · rounded-9 · surface-sunken
          </span>
        </div>
      </Section>
    </main>
  );
}
