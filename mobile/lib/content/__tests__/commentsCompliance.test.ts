import { COMMENTS_TERMS_TEXT, CONTACT_EMAIL, isComplianceContentPending } from '../commentsCompliance';

describe('commentsCompliance', () => {
  it('no longer flags I1 — the real contact email shipped 2026-10-16', () => {
    expect(isComplianceContentPending(CONTACT_EMAIL)).toBe(false);
    expect(CONTACT_EMAIL).toBe('contact@rhemapod.com');
  });

  it('no longer flags I2 — the real comment guidelines text shipped 2026-10-08', () => {
    expect(isComplianceContentPending(COMMENTS_TERMS_TEXT)).toBe(false);
    expect(COMMENTS_TERMS_TEXT).toContain('RhemaPod Comment Guidelines');
  });

  it('does not flag real content', () => {
    expect(isComplianceContentPending('help@example.org')).toBe(false);
  });
});
