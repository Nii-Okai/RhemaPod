import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { forgetGoogleAccount, performGoogleSignIn } from '../googleSignIn';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    hasPreviousSignIn: jest.fn(),
    signInSilently: jest.fn(),
    revokeAccess: jest.fn(),
    signOut: jest.fn(),
    signIn: jest.fn(),
  },
}));

const g = GoogleSignin as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  g.hasPlayServices.mockResolvedValue(true);
  g.signInSilently.mockResolvedValue({ type: 'success' });
  g.revokeAccess.mockResolvedValue(null);
  g.signOut.mockResolvedValue(null);
  g.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'fresh-token' } });
});

const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];

describe('performGoogleSignIn', () => {
  it('restores the previous account before revoking, so the next token is fresh (Android)', async () => {
    g.hasPreviousSignIn.mockReturnValue(true);
    await expect(performGoogleSignIn()).resolves.toBe('fresh-token');
    expect(order(g.signInSilently)).toBeLessThan(order(g.revokeAccess));
    expect(order(g.revokeAccess)).toBeLessThan(order(g.signIn));
  });

  it('skips the silent restore when there was no previous sign-in', async () => {
    g.hasPreviousSignIn.mockReturnValue(false);
    await performGoogleSignIn();
    expect(g.signInSilently).not.toHaveBeenCalled();
    expect(g.revokeAccess).toHaveBeenCalled();
    expect(g.signIn).toHaveBeenCalled();
  });

  it('never lets a failed restore, revoke or sign-out block the real sign-in', async () => {
    g.hasPreviousSignIn.mockReturnValue(true);
    g.signInSilently.mockRejectedValue(new Error('no saved credential'));
    g.revokeAccess.mockRejectedValue(new Error('SIGN_IN_REQUIRED'));
    g.signOut.mockRejectedValue(new Error('not signed in'));
    await expect(performGoogleSignIn()).resolves.toBe('fresh-token');
  });

  it('returns null when the user cancels', async () => {
    g.hasPreviousSignIn.mockReturnValue(false);
    g.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(performGoogleSignIn()).resolves.toBeNull();
  });
});

describe('forgetGoogleAccount', () => {
  it('restores, revokes and signs out, swallowing every failure', async () => {
    g.hasPreviousSignIn.mockReturnValue(true);
    g.revokeAccess.mockRejectedValue(new Error('nothing to revoke'));
    await expect(forgetGoogleAccount()).resolves.toBeUndefined();
    expect(g.signInSilently).toHaveBeenCalled();
    expect(g.signOut).toHaveBeenCalled();
  });
});
