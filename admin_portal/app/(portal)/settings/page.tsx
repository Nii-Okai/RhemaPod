import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";

/** `/settings` has no content of its own — Profile is the default section.
    The role check comes first so an Editor gets a 404, not a redirect that
    would confirm the route exists. */
export default async function SettingsIndex() {
  await requireRole("manager");
  redirect("/settings/profile");
}
