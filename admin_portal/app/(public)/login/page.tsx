import { Suspense } from "react";

import { AuthLayout } from "../_components/auth-layout";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · RhemaPod Admin" };

/**
 * Login (design README §1). The BFF owns the session — this screen only posts
 * credentials to `/api/auth/login` and, on success, navigates into the portal;
 * no token is ever readable from `document.cookie`.
 */
export default function LoginPage() {
  return (
    <AuthLayout
      heading="Welcome back"
      subhead="Sign in to manage sermons, series and announcements for your congregation."
    >
      {/* useSearchParams (the post-set-password banner) needs a Suspense bound. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
