import { LegalNav } from "../_components/legal-nav";
import { LegalList, LegalSection } from "../_components/legal-section";
import { Wordmark } from "../_components/wordmark";

export const metadata = { title: "Terms of Service · RhemaPod" };

// Draft prepared with AI assistance; not legal advice; reviewed by Isaac on ____-__-__.
// plans/plan-ad5-retention-and-legal-pages.md L3, facts from B.5 (P2 answers).
// Guidelines are linked (relative /guidelines), not copied here; the link text stays true wherever they are hosted.
const EFFECTIVE_DATE = "30 October 2026";
const CONTACT_EMAIL = "contact@rhemapod.com";

/** Public Terms of Service. Static: no session, no data fetching, no cookies. */
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
          <p className="text-[15px] text-ink-muted">Effective {EFFECTIVE_DATE}</p>
          <p className="text-[15px] text-ink-muted">
            These are the terms for using the RhemaPod app. By creating an
            account or using the app, you agree to them.
          </p>
        </header>

        <LegalSection title="Who provides RhemaPod">
          <p>
            RhemaPod is provided by Watered Garden Church, Dansoman &ndash;
            Accra, Ghana (&ldquo;we&rdquo;). How we handle your data is in the{" "}
            <a className="font-medium text-clay-600 underline" href="/privacy">
              Privacy Policy
            </a>
            .
          </p>
        </LegalSection>

        <LegalSection title="Who can use it">
          <p>
            You must be at least 13 years old to use the app, and to comment.
            The app does not check your age, so you are responsible for meeting
            this requirement.
          </p>
        </LegalSection>

        <LegalSection title="Your account">
          <LegalList>
            <li>Give us a real email address and keep your sign-in details to yourself.</li>
            <li>You are responsible for what happens under your account.</li>
            <li>
              You can delete your account at any time in the app (Me &gt; Delete
              account) or through the{" "}
              <a className="font-medium text-clay-600 underline" href="/delete-account">
                delete-account page
              </a>
              .
            </li>
            <li>
              We may deactivate an account that breaks these terms or the
              community guidelines.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="Sermons and other content">
          <p>
            Sermons, series, images and other content published in the app
            belong to Watered Garden Church or its speakers. You may listen,
            watch and, where the app allows it, download for your own personal,
            non-commercial use. Do not copy, re-share, sell or republish the
            content, and do not try to get around the app&rsquo;s protections on
            downloads.
          </p>
        </LegalSection>

        <LegalSection title="Comments and community guidelines">
          <p>
            You are responsible for what you post. The{" "}
            <a className="font-medium text-clay-600 underline" href="/guidelines">
              Community Guidelines
            </a>
            , also shown in the app before you first comment, apply to every
            comment, and you agree to follow them when you
            comment.
          </p>
          <p>
            Staff may hide or remove comments and deactivate accounts that break
            the guidelines. You can report a comment and block another user from
            within the app.
          </p>
        </LegalSection>

        <LegalSection title="Using the app properly">
          <p>
            Do not attack, overload or probe our systems, try to access other
            people&rsquo;s accounts, or use the app to break the law.
          </p>
        </LegalSection>

        <LegalSection title="Paid features and billing">
          <p>
            Some features may be offered for a fee. If they are, this is how
            purchases work:
          </p>
          <LegalList>
            <li>
              Purchases are made through, and charged to, your Apple App Store
              or Google Play account, not to us directly.
            </li>
            <li>Subscriptions renew automatically until you cancel them.</li>
            <li>
              You manage or cancel a subscription in your App Store or Google
              Play subscription settings.
            </li>
            <li>
              Refunds follow Apple&rsquo;s or Google&rsquo;s policies. We do not
              process refunds.
            </li>
            <li>
              Deleting your RhemaPod account does not cancel a subscription
              bought through the App Store or Google Play. Cancel it in the
              store first.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="Availability and responsibility">
          <p>
            We try to keep the app running and accurate, but we provide it as it
            is and cannot promise it will always be available or error-free.
          </p>
        </LegalSection>

        <LegalSection title="Governing law">
          <p>
            These terms are governed by the laws of Ghana. Disputes go to the
            courts of Ghana.
          </p>
        </LegalSection>

        <LegalSection title="Changes and contact">
          <p>
            If we change these terms, we change the effective date at the top of
            this page. Questions:{" "}
            <a className="font-medium text-clay-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </LegalSection>
      </article>
    </main>
  );
}
