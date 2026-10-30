import { LegalNav } from "../_components/legal-nav";
import { LegalList, LegalSection } from "../_components/legal-section";
import { Wordmark } from "../_components/wordmark";

export const metadata = { title: "Privacy Policy · RhemaPod" };

// Draft prepared with AI assistance; not legal advice; reviewed by Isaac on ____-__-__.
// plans/plan-ad5-retention-and-legal-pages.md L3. Facts: status.md "AD5-PREREQ — L1 data
// inventory" and the P2 answers (B.5). Changing EFFECTIVE_DATE is a commit.
const EFFECTIVE_DATE = "30 October 2026";
const CONTACT_EMAIL = "contact@rhemapod.com";

/** Public Privacy Policy. Static: no session, no data fetching, no cookies. */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-surface px-16 py-[48px] sm:px-[8vw]">
      <article className="mx-auto flex max-w-[680px] flex-col gap-28">
        <Wordmark size={26} />
        <LegalNav />
        <header className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.025em] text-ink">
            Privacy Policy
          </h1>
          <p className="text-[15px] text-ink-muted">Effective {EFFECTIVE_DATE}</p>
          <p className="text-[15px] text-ink-muted">
            This explains what the RhemaPod app collects about you, why, who else
            handles it, how long it is kept, and how to have it deleted.
          </p>
        </header>

        <LegalSection title="Who we are">
          <p>
            RhemaPod is run by Watered Garden Church, Dansoman &ndash; Accra,
            Ghana (&ldquo;we&rdquo;). We are the data controller for the
            information described here. We handle personal data in line with
            Ghana&rsquo;s Data Protection Act, 2012 (Act 843). To reach us, email{" "}
            <a className="font-medium text-clay-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . A person reads that inbox.
          </p>
        </LegalSection>

        <LegalSection title="What we collect">
          <LegalList>
            <li>
              <strong>Your account.</strong> Your email address, your name, and
              details you add to your profile, such as a profile photo. If you
              use a password, we store only a one-way hash of it, not the
              password.
            </li>
            <li>
              <strong>Sign in with Google.</strong> Your name, email address and
              profile photo. The photo is copied once, when your account is
              created.
            </li>
            <li>
              <strong>Sign in with Apple.</strong> Your name (on your first
              sign-in) and either your email address or the private relay
              address Apple gives us. We receive no photo from Apple.
            </li>
            <li>
              <strong>What you do in the app.</strong> Playlists you make (name,
              description, cover image), comments you post, likes, people you
              block, comments you report, and your listening history: where you
              stopped, how long you listened, and which days you listened. When
              you first comment, we record that you accepted the community
              guidelines, and when.
            </li>
            <li>
              <strong>Your plan.</strong> A record of your plan. Paid features, when
              offered, are bought through Apple or Google, so we do not receive
              or store your payment card details.
            </li>
            <li>
              <strong>Security records.</strong> When you sign in, sign out or
              change your password, we record the event with your email address,
              your IP address and your device&rsquo;s user agent (the app and
              device type). Failed sign-in attempts are recorded the same way
              when the email address belongs to an account.
            </li>
            <li>
              <strong>Abuse-prevention counters.</strong> To limit repeated
              requests, we count them by IP address or by a sign-in email
              address (the sign-in counter uses a hashed form of the email).
              These counters are temporary; see below.
            </li>
          </LegalList>
          <p>
            Other people using the app see your comments with your first name and
            the first letter of your last name only.
          </p>
        </LegalSection>

        <LegalSection title="What stays on your device">
          <p>
            The app keeps your sign-in token in your phone&rsquo;s secure storage,
            your offline downloads (encrypted), a cache of recent app data, and
            your app settings. The app wipes the token, downloads and cache when
            you sign out or delete your account.
          </p>
          <p>
            The app asks for access to your photos or camera only so you can set
            a profile picture, and to your local network only to find Chromecast
            devices. The app does not record audio.
          </p>
        </LegalSection>

        <LegalSection title="What we do not do">
          <p>
            The app has no analytics, crash-reporting, advertising or push
            notification software. We do not use your data for advertising.
          </p>
        </LegalSection>

        <LegalSection title="Why we use it">
          <p>
            To run your account and sign you in, to show your playlists,
            comments and listening history, to moderate comments, to send the
            account emails described below, and to keep the service secure and
            prevent abuse. We do not use it for anything else.
          </p>
        </LegalSection>

        <LegalSection title="Who else handles your data">
          <LegalList>
            <li>
              <strong>Render</strong>, our hosting provider, runs our servers and
              database. It keeps its own operational logs, including IP
              addresses, under its own retention policy.
            </li>
            <li>
              <strong>Resend</strong> sends our emails: verification codes,
              password-reset links, a notice if a sign-in method is linked to
              your account, and the confirmation after you delete your account.
              Resend sees the recipient address, subject and body, and keeps its
              own logs under its own retention policy. We cannot recall an email
              once it is sent.
            </li>
            <li>
              <strong>Cloudflare</strong> stores profile photos and playlist
              covers, and delivers sermon audio and video. When you play a
              sermon, your device connects to Cloudflare directly, so Cloudflare
              sees your IP address. We send Cloudflare no account details for
              playback.
            </li>
            <li>
              <strong>Google and Apple</strong>, if you use them to sign in, under
              their own privacy policies.
            </li>
            <li>
              <strong>Chromecast.</strong> If you cast, the app sends the
              playback address to the device you chose on your local network.
            </li>
          </LegalList>
          <p>We do not sell personal data.</p>
        </LegalSection>

        <LegalSection title="Our logs">
          <p>
            Our application logs record each request&rsquo;s method, path, status,
            timing and a request ID, and the ID of the signed-in account. They do
            not contain email recipients, verification codes or email addresses
            in rate-limit keys, and we have turned off the web server&rsquo;s
            access log.
          </p>
        </LegalSection>

        <LegalSection title="How long we keep it">
          <LegalList>
            <li>
              <strong>Account, profile, playlists, comments, likes, blocks,
              reports you filed, listening history and plan record:</strong> until
              you delete your account (or remove the item yourself).
            </li>
            <li>
              <strong>IP address and user agent in security records:</strong>{" "}
              removed after 30 days, on every record. A daily task in our server
              does this.
            </li>
            <li>
              <strong>Sign-in records:</strong> deleted after 365 days.
            </li>
            <li>
              <strong>Other security and audit records</strong> (for example, an
              administrator deactivating an account, or an account being
              deleted): kept. When an account is deleted, the email address and
              name label on these records are removed. An internal account ID,
              the role and the date remain, which no longer identify you by
              name or email.
            </li>
            <li>
              <strong>Moderation records</strong> (what a moderator did to a
              comment, when, and their note): kept without a link to your
              account after deletion. An internal ID remains that no longer
              matches any account. The copy of the comment text saved with the
              record is cleared after 90 days.
            </li>
            <li>
              <strong>Production backups:</strong> kept for up to 90 days. Deleting
              your account does not change copies in backups or in administrator
              exports. If we restore a backup, we erase deleted accounts again
              under our runbook.
            </li>
            <li>
              <strong>Abuse-prevention counters:</strong> last up to 15 minutes.
            </li>
            <li>
              <strong>Render and Resend logs:</strong> kept by those providers under
              their own policies. We do not control those periods.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="Deleting your account">
          <p>
            You can delete your account in the app (Me &gt; Delete account), or
            ask us at{" "}
            <a className="font-medium text-clay-600 underline" href="/delete-account">
              the delete-account page
            </a>{" "}
            or by email. Deleting in the app is immediate and cannot be undone.
            We honour emailed requests by hand.
          </p>
          <p>
            Deletion erases your account and profile, your sign-in links,
            playlists and their covers, your profile photo, your comments,
            likes, subscription record, blocks, listening history (including
            daily listening records) and the reports you filed. Removing the
            uploaded files (photo and covers) is best-effort: if it fails, we
            log it and do not retry. The app wipes downloads on your device. We
            send one confirmation email to your address afterwards. What we keep
            is listed above.
          </p>
          <p>
            If you signed in with Apple and delete in the app, we also revoke
            RhemaPod&rsquo;s access to your Apple ID. If an administrator
            deletes your account, that revocation does not happen automatically;
            the delete-account page shows how to do it yourself.
          </p>
          <p>
            Deleting your RhemaPod account does not cancel a subscription bought
            through the App Store or Google Play.
          </p>
        </LegalSection>

        <LegalSection title="Your rights">
          <p>
            Under Act 843 you can ask to see the personal data we hold about you,
            ask us to correct it, object to how we use it, and ask us to delete
            it. Email{" "}
            <a className="font-medium text-clay-600 underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            from the address on your account. You can also contact Ghana&rsquo;s
            Data Protection Commission.
          </p>
        </LegalSection>

        <LegalSection title="Age">
          <p>
            You must be at least 13 to use RhemaPod. If you think a child under
            13 has an account, email us and we will delete it.
          </p>
        </LegalSection>

        <LegalSection title="Cookies">
          <p>
            These public pages set no cookies.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>
            If we change this policy, we change the effective date at the top of
            this page.
          </p>
        </LegalSection>
      </article>
    </main>
  );
}
