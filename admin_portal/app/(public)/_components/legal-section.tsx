import type { ReactNode } from "react";

/** Titled block shared by the long-form public pages (privacy, terms, support). */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-8 text-[15px] leading-[1.6] text-ink">
      <h2 className="font-serif text-[24px] leading-[1.2] text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Bulleted list styled like the delete-account page. */
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-4 pl-20">{children}</ul>;
}
