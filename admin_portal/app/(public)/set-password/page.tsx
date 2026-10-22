import { Suspense } from "react";

import { AuthLayout } from "../_components/auth-layout";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password · RhemaPod Admin" };

/**
 * Set-password (plan §A.2 "Invite acceptance / set-password"). The path is
 * fixed by the backend's invite/reset email link
 * (`{frontend_base_url}/set-password?token=…`), not a naming choice.
 *
 * Neutral copy — this one screen serves the admin invite, the staff
 * self-service reset and, with `app=1`, a mobile app user's reset (the
 * backend adds it for viewer accounts): no "staff account" wording, and the
 * success state says to go back to the app instead of redirecting to the
 * portal's sign-in, which an app user can't use. The token is NOT
 * pre-validated (there is no validation endpoint, and probing one would burn
 * a single-use credential).
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string | string[] }>;
}) {
  const forApp = (await searchParams).app === "1";
  return (
    <AuthLayout
      heading={forApp ? "Reset your password" : "Set your password"}
      subhead={
        forApp
          ? "Choose a new password for your RhemaPod account."
          : "Choose a password for your RhemaPod staff account."
      }
    >
      <Suspense fallback={null}>
        <SetPasswordForm forApp={forApp} />
      </Suspense>
    </AuthLayout>
  );
}
