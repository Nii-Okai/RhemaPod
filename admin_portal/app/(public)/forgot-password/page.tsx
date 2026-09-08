import { AuthLayout } from "../_components/auth-layout";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password · RhemaPod Admin" };

/**
 * Forgot-password (design README §1). The response is deliberately generic —
 * it never reveals whether an email belongs to an account.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      heading="Reset your password"
      subhead="Enter your work email and we'll send a link to set a new password."
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
