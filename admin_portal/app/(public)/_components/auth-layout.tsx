import type { ReactNode } from "react";

import { loadSignInImageUrl } from "@/lib/auth/sign-in-image";

import { Wordmark } from "./wordmark";

/**
 * The Login screen's two-column shell (design README §1), reused by
 * set-password and forgot-password so the invite flow reads as one piece.
 *
 * Left: white, vertically centred, `64px 8vw` padding, gap 28 — wordmark,
 * heading (Newsreader 40/1.08), a 15px ink-muted subhead, then the form.
 * Right: the church's photo (set in Settings › Profile, read from the public
 * settings) or, until one is uploaded, built-in warm artwork — with a
 * bottom-aligned pull-quote card either way. Below the `lg` breakpoint the
 * right column drops away (desktop tool; §"Responsive").
 */
export async function AuthLayout({
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

      <BrandAside imageUrl={await loadSignInImageUrl()} />
    </main>
  );
}

function BrandAside({ imageUrl }: { imageUrl: string | null }) {
  return (
    <aside
      data-slot="auth-brand"
      className="relative hidden flex-col justify-end overflow-hidden p-[56px] lg:flex"
      style={{
        background: imageUrl
          ? "var(--color-dark, #2e2723)"
          : // Built-in artwork: warm light falling across clay and sand.
            "radial-gradient(120% 80% at 85% 10%, rgba(255,236,214,.95) 0%, rgba(255,236,214,0) 55%)," +
            "radial-gradient(90% 70% at 10% 95%, rgba(126,65,40,.55) 0%, rgba(126,65,40,0) 60%)," +
            "linear-gradient(160deg, #efe4d6 0%, #e2c7ae 45%, #c98f6c 100%)",
      }}
    >
      {imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Darkens the bottom so the quote card reads on any photo. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_45%,rgba(0,0,0,.45)_100%)]"
          />
        </>
      ) : null}
      <figure className="relative max-w-[420px] rounded-16 bg-surface/90 p-[26px] backdrop-blur-sm">
        <blockquote className="font-serif text-[23px] leading-[1.35] text-ink">
          &ldquo;So faith comes from hearing, and hearing through the word of
          Christ.&rdquo;
        </blockquote>
        <figcaption className="mt-10 text-mono-meta text-ink-faint">Romans 10:17</figcaption>
      </figure>
    </aside>
  );
}
