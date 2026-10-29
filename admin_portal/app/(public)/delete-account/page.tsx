import type { ReactNode } from "react";

import { Wordmark } from "../_components/wordmark";

export const metadata = { title: "Delete your account · RhemaPod" };

// The support inbox that handles requests from people who can't use the app
// (mobile/lib/content/commentsCompliance.ts CONTACT_EMAIL).
const DELETION_CONTACT_EMAIL = "contact@rhemapod.com";

const MAILTO = `mailto:${DELETION_CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Delete my RhemaPod account",
)}`;

/**
 * Public account-deletion page (ADR 0020; plans/plan-account-deletion-clients.md
 * D13). Google Play requires a web route for deletion requests; App Store
 * reviewers read it too. Static on purpose: no session, no data fetching, so it
 * works signed out and on any device. An admin fulfils emailed requests with
 * the portal's delete-user action, which cannot revoke Apple, hence the manual
 * Apple steps. Retention numbers match ADR 0020 (30 / 90 / 365 days).
 */
export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-surface px-16 py-[48px] sm:px-[8vw]">
      <article className="mx-auto flex max-w-[680px] flex-col gap-28">
        <Wordmark size={26} />
        <header className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
            Delete your RhemaPod account
          </h1>
          <p className="text-[15px] text-ink-muted">
            You can delete your account and its data at any time. Deletion is
            permanent and can&rsquo;t be undone.
          </p>
        </header>

        <Section title="Delete it in the app">
          <ol className="list-decimal space-y-4 pl-20">
            <li>Open RhemaPod and sign in.</li>
            <li>
              Go to the <strong>Me</strong> tab and tap <strong>Delete account</strong>.
            </li>
            <li>
              Confirm it&rsquo;s you (your password, or Sign in with Apple or
              Google), then tap <strong>Delete permanently</strong>.
            </li>
          </ol>
          <p>
            If you signed in with Apple, deleting in the app also removes
            RhemaPod from your Apple ID.
          </p>
        </Section>

        <Section title="Or ask us to delete it">
          <p>
            If you can&rsquo;t use the app, email{" "}
            <a className="font-medium text-clay-600 underline" href={MAILTO}>
              {DELETION_CONTACT_EMAIL}
            </a>{" "}
            from the address on your account with the subject &ldquo;Delete my
            RhemaPod account&rdquo;. We&rsquo;ll confirm by email once
            it&rsquo;s done.
          </p>
        </Section>

        <Section title="What's deleted">
          <p>
            Your profile and photo, your sign-in methods, playlists, comments,
            likes, watch history, notes and settings.
          </p>
        </Section>

        <Section title="What's kept, and for how long">
          <ul className="list-disc space-y-4 pl-20">
            <li>Encrypted database backups, for up to 30 days, then overwritten.</li>
            <li>
              Copies of comments that someone reported, kept for moderation for
              up to 90 days.
            </li>
            <li>
              A security log of account events with your email removed, for up
              to 365 days.
            </li>
          </ul>
        </Section>

        <Section title="Subscriptions">
          <p>
            Deleting your account doesn&rsquo;t cancel a subscription bought
            through the App Store or Google Play. Cancel it in{" "}
            <a
              className="font-medium text-clay-600 underline"
              href="https://apps.apple.com/account/subscriptions"
            >
              App Store subscriptions
            </a>{" "}
            or{" "}
            <a
              className="font-medium text-clay-600 underline"
              href="https://play.google.com/store/account/subscriptions"
            >
              Google Play subscriptions
            </a>{" "}
            first.
          </p>
        </Section>

        <Section title="Remove Sign in with Apple yourself">
          <p>
            If we delete your account from an email request, or you deleted it
            on Android, remove RhemaPod from your Apple ID yourself:
          </p>
          <ul className="list-disc space-y-4 pl-20">
            <li>
              On an iPhone or iPad: Settings &gt; your name &gt; Sign-In &amp;
              Security &gt; Sign in with Apple &gt; RhemaPod &gt; Stop Using
              Apple ID.
            </li>
            <li>
              On the web: account.apple.com &gt; Sign-In and Security &gt; Sign
              in with Apple &gt; RhemaPod.
            </li>
          </ul>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-8 text-[15px] leading-[1.6] text-ink">
      <h2 className="font-serif text-[24px] leading-[1.2] text-ink">{title}</h2>
      {children}
    </section>
  );
}
