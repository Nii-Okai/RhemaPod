import { previewDisplayName } from '../displayName';

describe('previewDisplayName', () => {
  it('shows first name plus last initial, matching the server rule', () => {
    expect(previewDisplayName('Nii Kwame Okai')).toBe('Nii O.');
    expect(previewDisplayName('  Ada   Nwosu ')).toBe('Ada N.');
  });

  it('returns a single token as-is', () => {
    expect(previewDisplayName('Ada')).toBe('Ada');
  });

  it('returns null for blank or missing input', () => {
    expect(previewDisplayName('   ')).toBeNull();
    expect(previewDisplayName(null)).toBeNull();
    expect(previewDisplayName(undefined)).toBeNull();
  });
});
