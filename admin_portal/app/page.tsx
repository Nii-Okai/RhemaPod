import { redirect } from "next/navigation";

/* W1 has no real screens. The only page in the app is the token-audit
   reference under the (portal) group. Login / shell / sermons land in W4+. */
export default function RootPage() {
  redirect("/tokens");
}
