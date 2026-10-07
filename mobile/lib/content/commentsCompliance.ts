/**
 * The two pieces of public-facing compliance content the comments feature needs and the
 * app cannot invent: the contact address App Store guideline 1.2 requires for user-
 * generated content (plan input I1) and the comment guidelines / terms text a viewer
 * accepts before their first post (plan input I2). Both are supplied by Isaac.
 *
 * They live in this one module so replacing them is a single-file change. The values
 * below are deliberate, visibly-flagged placeholders. `isComplianceContentPending`
 * lets a caller show or hide a surface that would otherwise ship a placeholder.
 */
export const CONTACT_EMAIL = '[I1 PENDING — contact email from Isaac]';

export const COMMENTS_TERMS_TEXT = '[I2 PENDING — comment guidelines text from Isaac]';

export function isComplianceContentPending(value: string): boolean {
  return value.startsWith('[I1 PENDING') || value.startsWith('[I2 PENDING');
}
