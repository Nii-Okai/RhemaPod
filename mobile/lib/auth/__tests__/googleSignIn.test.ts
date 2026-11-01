import { Platform } from 'react-native';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    hasPreviousSignIn: jest.fn(),
    signInSilently: jest.fn(),
    revokeAccess: jest.fn(),
    signOut: jest.fn(),
    signIn: jest.fn(),
  },
}));

type Mod = typeof import('../googleSignIn');
let g: Record<string, jest.Mock>;
const originalOS = Platform.OS;

/** Fresh module registry per platform: `Platform.OS` is read at call time and `configured` resets. */
function loadFresh(os: 'android' | 'ios', signInResult?: unknown): Mod {
  Platform.OS = os;
  let mod!: Mod;
  jest.isolateModules(() => {
    g = require('@react-native-google-signin/google-signin').GoogleSignin;
    mod = require('../googleSignIn');
  });
  g.hasPlayServices.mockResolvedValue(true);
  g.signInSilently.mockResolvedValue({ type: 'success' });
  g.revokeAccess.mockResolvedValue(null);
  g.signOut.mockResolvedValue(null);
  g.signIn.mockResolvedValue(
    signInResult ?? { type: 'success', data: { idToken: 'id-tok', serverAuthCode: 'auth-code' } },
  );
  return mod;
}

afterEach(() => {
  Platform.OS = originalOS;
});

describe('configureGoogleSignIn', () => {
  it('asks for offline access without forcing re-consent on Android', () => {
    const mod = loadFresh('android');
    mod.configureGoogleSignIn();
    expect(g.configure).toHaveBeenCalledWith(
      expect.objectContaining({ offlineAccess: true, forceCodeForRefreshToken: false }),
    );
  });

  it('leaves offline access off on iOS', () => {
    loadFresh('ios').configureGoogleSignIn();
    const cfg = g.configure.mock.calls[0][0];
    expect(cfg).not.toHaveProperty('offlineAccess');
    expect(cfg).not.toHaveProperty('forceCodeForRefreshToken');
  });
});

describe('performGoogleSignIn', () => {
  it('returns the server auth code on Android, with no revoke or sign-out', async () => {
    const { performGoogleSignIn: run } = loadFresh('android');
    await expect(run()).resolves.toEqual({ kind: 'server_auth_code', code: 'auth-code' });
    expect(g.revokeAccess).not.toHaveBeenCalled();
    expect(g.signOut).not.toHaveBeenCalled();
    expect(g.signInSilently).not.toHaveBeenCalled();
  });

  it('throws on Android when no server auth code comes back, without falling back to the ID token', async () => {
    const { performGoogleSignIn: run } = loadFresh('android', {
      type: 'success',
      data: { idToken: 'id-tok', serverAuthCode: null },
    });
    await expect(run()).rejects.toThrow(/server auth code/);
  });

  it('returns the ID token on iOS, with no revoke or sign-out', async () => {
    const { performGoogleSignIn: run } = loadFresh('ios');
    await expect(run()).resolves.toEqual({ kind: 'id_token', idToken: 'id-tok' });
    expect(g.revokeAccess).not.toHaveBeenCalled();
    expect(g.signOut).not.toHaveBeenCalled();
  });

  it('throws on iOS when no ID token comes back', async () => {
    const { performGoogleSignIn: run } = loadFresh('ios', {
      type: 'success',
      data: { idToken: null, serverAuthCode: null },
    });
    await expect(run()).rejects.toThrow(/ID token/);
  });

  it.each(['android', 'ios'] as const)('returns null when the user cancels (%s)', async (os) => {
    const mod = loadFresh(os, { type: 'cancelled', data: null });
    await expect(mod.performGoogleSignIn()).resolves.toBeNull();
  });
});

describe('signOutGoogle', () => {
  it('only signs out, never revokes, and swallows a failure', async () => {
    const { signOutGoogle } = loadFresh('ios');
    g.signOut.mockRejectedValue(new Error('not signed in'));
    await expect(signOutGoogle()).resolves.toBeUndefined();
    expect(g.signOut).toHaveBeenCalled();
    expect(g.revokeAccess).not.toHaveBeenCalled();
    expect(g.signInSilently).not.toHaveBeenCalled();
  });
});

describe('forgetGoogleAccount (account deletion)', () => {
  it('restores, revokes then signs out, swallowing every failure', async () => {
    const { forgetGoogleAccount } = loadFresh('android');
    g.hasPreviousSignIn.mockReturnValue(true);
    g.revokeAccess.mockRejectedValue(new Error('nothing to revoke'));
    await expect(forgetGoogleAccount()).resolves.toBeUndefined();
    expect(g.signInSilently).toHaveBeenCalled();
    expect(g.signOut).toHaveBeenCalled();
    expect(g.signInSilently.mock.invocationCallOrder[0]).toBeLessThan(g.revokeAccess.mock.invocationCallOrder[0]);
    expect(g.revokeAccess.mock.invocationCallOrder[0]).toBeLessThan(g.signOut.mock.invocationCallOrder[0]);
  });
});
