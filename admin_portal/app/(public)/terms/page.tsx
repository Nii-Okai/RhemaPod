import { LegalNav } from "../_components/legal-nav";
import { Wordmark } from "../_components/wordmark";

export const metadata = { title: "Terms of Service · RhemaPod" };

/**
 * Public Terms of Service page shell (plans/plan-ad5-retention-and-legal-pages.md L2).
 * Static: no session, no data fetching. The real text lands in L3.
 */
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-surface px-16 py-[48px] sm:px-[8vw]">
      <article className="mx-auto flex max-w-[680px] flex-col gap-28">
        <Wordmark size={26} />
        <LegalNav />
        <header className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
            Terms of Service
          </h1>
        </header>
        <p className="text-[15px] leading-[1.6] text-ink">
          DRAFT: text pending.
        </p>
      </article>
    </main>
  );
}
