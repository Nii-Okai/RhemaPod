import { Suspense } from "react";

import { AuthLayout } from "../_components/auth-layout";
import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set your password · RhemaPod Admin" };

/**
 * Set-password (plan §A.2 "Invite acceptance / set-password"). The path is
 * fixed by the backend's invite/reset email link
 * (`{frontend_base_url}/set-password?token=…`), not a naming choice.
 *
 * Neutral copy — this one screen serves both the admin invite and the
 * self-service reset; the backend tells the token types apart, the UI does
 * not need to. The token is NOT pre-validated (there is no validation
 * endpoint, and probing one would burn a single-use credential).
 */
export default function SetPasswordPage() {
  return (
    <AuthLayout
      heading="Set your password"
      subhead="Choose a password for your RhemaPod staff account."
    >
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
