import { LegalNav } from "../_components/legal-nav";
import { LegalList, LegalSection } from "../_components/legal-section";
import { Wordmark } from "../_components/wordmark";

export const metadata = { title: "Support · RhemaPod" };

// Draft prepared with AI assistance; not legal advice; reviewed by Isaac on ____-__-__.
// plans/plan-ad5-retention-and-legal-pages.md L3. This is the App Store Connect support URL.
const EFFECTIVE_DATE = "30 October 2026";
const CONTACT_EMAIL = "contact@rhemapod.com";

/** Public Support page. Static: no session, no data fetching, no cookies. */
export default function SupportPage() {
  return (
    <main className="min-h-screen bg-surface px-16 py-[48px] sm:px-[8vw]">
      <article className="mx-auto flex max-w-[680px] flex-col gap-28">
        <Wordmark size={26} />
        <LegalNav />
        <header className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
            Support
          </h1>
          <p className="text-[15px] text-ink-muted">Effective {EFFECTIVE_DATE}</p>
        </header>

        <LegalSection title="Contact us">
          <p>
            Email{" "}
            <a className="font-medium text-clay-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . A person reads this inbox. Write from the address on your account
            if your question is about your account, and never send your
            password.
          </p>
        </LegalSection>

        <LegalSection title="Common requests">
          <LegalList>
            <li>
              <strong>Delete your account.</strong> Use Me &gt; Delete account in
              the app, or see the{" "}
              <a className="font-medium text-clay-600 underline" href="/delete-account">
                delete-account page
              </a>
              . If you can&rsquo;t use the app, email us with the subject
              &ldquo;Delete my RhemaPod account&rdquo;.
            </li>
            <li>
              <strong>Remove Sign in with Apple.</strong> If an administrator
              deleted your account, or you deleted it on Android, the
              delete-account page shows how to remove RhemaPod from your Apple
              ID yourself.
            </li>
            <li>
              <strong>See, correct or object to how we use your data.</strong>{" "}
              Email us. Details are in the{" "}
              <a className="font-medium text-clay-600 underline" href="/privacy">
                Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Subscriptions and refunds.</strong> These are handled by
              Apple or Google. Manage or cancel in your App Store or Google
              Play subscription settings. See the{" "}
              <a className="font-medium text-clay-600 underline" href="/terms">
                Terms of Service
              </a>
              .
            </li>
            <li>
              <strong>A comment that breaks the guidelines.</strong> Report it
              from the comment in the app. You can also block the user there.
            </li>
          </LegalList>
        </LegalSection>
      </article>
    </main>
  );
}
