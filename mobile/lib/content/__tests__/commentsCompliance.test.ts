import { COMMENTS_TERMS_TEXT, CONTACT_EMAIL, isComplianceContentPending } from '../commentsCompliance';

describe('commentsCompliance', () => {
  it('flags the unsupplied I1/I2 inputs as pending so no surface can ship them silently', () => {
    expect(isComplianceContentPending(CONTACT_EMAIL)).toBe(true);
    expect(isComplianceContentPending(COMMENTS_TERMS_TEXT)).toBe(true);
  });

  it('does not flag real content', () => {
    expect(isComplianceContentPending('help@example.org')).toBe(false);
  });
});
