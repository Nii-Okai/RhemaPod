export const APPLE_RELAY_DOMAIN = 'privaterelay.appleid.com';
export const APPLE_RELAY_LABEL = 'Private email (via Apple)';

/**
 * Display-only form of the signed-in user's own email. Apple "Hide My Email"
 * relay addresses are unreadable noise, so show a label instead. Never use the
 * result for anything sent to the API or held in a form field.
 */
export function displayEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at !== -1 && email.slice(at + 1).trim().toLowerCase() === APPLE_RELAY_DOMAIN) {
    return APPLE_RELAY_LABEL;
  }
  return email;
}
