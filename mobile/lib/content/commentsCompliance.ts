/**
 * The two pieces of public-facing compliance content the comments feature needs and the
 * app cannot invent: the contact address App Store guideline 1.2 requires for user-
 * generated content (plan input I1) and the comment guidelines / terms text a viewer
 * accepts before their first post (plan input I2). Both are supplied by Isaac.
 *
 * They live in this one module so replacing them is a single-file change.
 * `isComplianceContentPending` lets a caller show or hide a surface that would
 * otherwise ship a placeholder.
 *
 * I2 (comment guidelines) shipped 2026-10-08. I1 (contact email) shipped 2026-10-16 —
 * Isaac supplied `contact@rhemapod.com`.
 */
export const CONTACT_EMAIL = 'contact@rhemapod.com';

export const COMMENTS_TERMS_TEXT = `RhemaPod Comment Guidelines

Welcome to RhemaPod, the media platform of Watered Garden Church, Ghana. To keep our community Christ-centered, respectful, and edifying, all users must agree to the following rules before commenting on sermons:

• Edify and Encourage: Use your words to build up others, share testimonies, and discuss the Word of God respectfully.
• Zero Tolerance for Abuse: Insults, mockery, profanity, or attacks against church leadership or fellow believers will not be tolerated.
• No Spam or Promotion: Do not post advertisements, external links, commercial promos, or repetitive spam.
• Protect Privacy: Do not share phone numbers, addresses, or private financial details in public comments.

Moderation & Enforcement:
Watered Garden Church reserves the right to delete violating comments. Continuous or severe violations will result in temporary or permanent suspension from the platform.

By clicking Agree & Accept, you promise to keep your interactions respectful, safe, and honoring to the Lord.`;

export function isComplianceContentPending(value: string): boolean {
  return value.startsWith('[I1 PENDING') || value.startsWith('[I2 PENDING');
}
