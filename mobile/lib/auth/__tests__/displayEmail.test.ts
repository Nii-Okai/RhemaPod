import { displayEmail } from '../displayEmail';

describe('displayEmail', () => {
  it('labels an Apple private relay address', () => {
    expect(displayEmail('n7nw7759jd@privaterelay.appleid.com')).toBe('Private email (via Apple)');
  });

  it('matches the relay domain case-insensitively', () => {
    expect(displayEmail('N7NW@PrivateRelay.AppleID.com')).toBe('Private email (via Apple)');
  });

  it('returns a normal email unchanged', () => {
    expect(displayEmail('ada@example.com')).toBe('ada@example.com');
    expect(displayEmail('x@notprivaterelay.appleid.com.evil.io')).toBe('x@notprivaterelay.appleid.com.evil.io');
  });

  it('returns an empty string for null/undefined', () => {
    expect(displayEmail(null)).toBe('');
    expect(displayEmail(undefined)).toBe('');
  });
});
