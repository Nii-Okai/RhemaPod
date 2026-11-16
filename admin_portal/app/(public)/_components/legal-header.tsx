import { LegalNav } from "./legal-nav";
import { Wordmark } from "./wordmark";

/** Site header shared by the public pages: wordmark plus the legal nav, outside the <article>. */
export function LegalHeader() {
  return (
    <header className="flex flex-col gap-28">
      <Wordmark size={26} />
      <LegalNav />
    </header>
  );
}
