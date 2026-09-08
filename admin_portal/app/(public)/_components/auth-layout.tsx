import type { ReactNode } from "react";

import { Wordmark } from "./wordmark";

/**
 * The Login screen's two-column shell (design README §1), reused by
 * set-password and forgot-password so the invite flow reads as one piece.
 *
 * Left: white, vertically centred, `64px 8vw` padding, gap 28 — wordmark,
 * heading (Newsreader 40/1.08), a 15px ink-muted subhead, then the form.
 * Right: the striped brand placeholder with a bottom-aligned pull-quote card.
 * Below 900px the right column drops away (desktop tool; §"Responsive").
 */
export function AuthLayout({
  heading,
  subhead,
  children,
}: {
  heading: string;
  subhead: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="flex flex-col justify-center gap-28 bg-surface px-[8vw] py-[64px]">
        <Wordmark size={26} />
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
            {heading}
          </h1>
          <p className="max-w-[42ch] text-[15px] text-ink-muted">{subhead}</p>
        </div>
        <div className="flex w-full max-w-[400px] flex-col gap-14">{children}</div>
      </section>

      <BrandAside />
    </main>
  );
}

function BrandAside() {
  return (
    <aside
      className="hidden flex-col justify-end p-[56px] lg:flex"
      style={{
        background:
          "repeating-linear-gradient(135deg,#E4DDD1 0 8px,#EFE9DF 8px 16px)",
      }}
    >
      <figure className="max-w-[420px] rounded-16 bg-surface-sunken p-[26px]">
        <figcaption className="text-mono-meta text-ink-faint">
          brand image · 4:5 portrait of congregation
        </figcaption>
        <blockquote className="mt-14 font-serif text-[23px] leading-[1.35] text-ink">
          &ldquo;So faith comes from hearing, and hearing through the word of
          Christ.&rdquo;
        </blockquote>
      </figure>
    </aside>
  );
}
