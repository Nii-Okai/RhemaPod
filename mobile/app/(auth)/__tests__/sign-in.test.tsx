import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SignInScreen from '../sign-in';
import { useAuth } from '../../../lib/auth/AuthContext';
import { ApiError } from '../../../lib/api/errors';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { resetOnboardingSeen } from '../../../lib/settings/onboardingSeen';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
}));

jest.mock('../../../lib/settings/onboardingSeen', () => ({
  resetOnboardingSeen: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@expo/vector-icons');

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
  },
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  signInAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: jest.fn(() => new Uint8Array([1, 2, 3, 4])),
  digestStringAsync: jest.fn().mockResolvedValue('hashed-nonce'),
}));

const mockedUseAuth = useAuth as jest.Mock;
const mockedGoogleSignIn = GoogleSignin as unknown as {
  configure: jest.Mock;
  hasPlayServices: jest.Mock;
  signIn: jest.Mock;
};
const mockedAppleAuth = AppleAuthentication as unknown as {
  isAvailableAsync: jest.Mock;
  signInAsync: jest.Mock;
};
const mockedDigestStringAsync = Crypto.digestStringAsync as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;
const mockedResetOnboardingSeen = resetOnboardingSeen as jest.Mock;

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const value = {
    signIn: jest.fn(),
    register: jest.fn(),
    forgotPassword: jest.fn(),
    signOut: jest.fn(),
    signInWithGoogle: jest.fn(),
    signInWithApple: jest.fn(),
    ...overrides,
  };
  mockedUseAuth.mockReturnValue(value);
  return value;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedDigestStringAsync.mockResolvedValue('hashed-nonce');
  mockedUseRouter.mockReturnValue({ replace: jest.fn() });
  mockedResetOnboardingSeen.mockResolvedValue(undefined);
  Platform.OS = 'ios';
});

describe('SignInScreen', () => {
  it('shows a field-level error and does not call signIn when fields are empty', () => {
    const { signIn } = mockAuth();

    const { getByText } = render(<SignInScreen />);
    fireEvent.press(getByText('Sign in'));

    expect(getByText('Email and password are required.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows the wrong-credentials copy on a 401 from signIn', async () => {
    const { signIn } = mockAuth({ signIn: jest.fn().mockRejectedValue(new ApiError(401, 'Invalid email or password')) });

    const { getByText, getByLabelText, queryByText } = render(<SignInScreen />);
    fireEvent.changeText(getByLabelText('Email'), 'user@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'password123456');
    fireEvent.press(getByText('Sign in'));

    await waitFor(() => {
      expect(getByText("That email and password don't match.")).toBeTruthy();
    });
    expect(queryByText('Email and password are required.')).toBeNull();
    expect(signIn).toHaveBeenCalledWith('user@example.com', 'password123456');
  });

  describe('social sign-in buttons', () => {
    it('renders both the Google and Apple buttons on iOS when Apple sign-in is available', async () => {
      Platform.OS = 'ios';
      mockAuth();

      const { findByText } = render(<SignInScreen />);

      expect(await findByText('Continue with Google')).toBeTruthy();
      expect(await findByText('Continue with Apple')).toBeTruthy();
    });

    it('does not render the Apple button on Android', async () => {
      Platform.OS = 'android';
      mockAuth();

      const { findByText, queryByText } = render(<SignInScreen />);

      expect(await findByText('Continue with Google')).toBeTruthy();
      expect(queryByText('Continue with Apple')).toBeNull();
    });

    it('a successful Google press calls through to signInWithGoogle with the ID token', async () => {
      Platform.OS = 'ios';
      const { signInWithGoogle } = mockAuth();
      mockedGoogleSignIn.signIn.mockResolvedValueOnce({
        type: 'success',
        data: { idToken: 'google-id-token', user: { id: '1', email: 'a@b.com', name: null, photo: null, familyName: null, givenName: null }, scopes: [], serverAuthCode: null },
      });

      const { findByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Continue with Google'));

      await waitFor(() => {
        expect(signInWithGoogle).toHaveBeenCalledWith('google-id-token');
      });
    });

    it('a successful Apple press calls through with the raw nonce and the digest sent to Apple kept separate', async () => {
      Platform.OS = 'ios';
      const { signInWithApple } = mockAuth();
      mockedAppleAuth.signInAsync.mockResolvedValueOnce({
        identityToken: 'apple-identity-token',
        authorizationCode: 'apple-auth-code',
        user: 'apple-user-id',
        state: null,
        email: null,
        realUserStatus: 1,
        fullName: { givenName: 'Grace', familyName: 'Hopper', namePrefix: null, middleName: null, nameSuffix: null, nickname: null },
      });

      const { findByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Continue with Apple'));

      await waitFor(() => {
        expect(signInWithApple).toHaveBeenCalledWith('apple-identity-token', '01020304', 'apple-auth-code', 'Grace', 'Hopper');
      });
      // The digest (not the raw nonce) is what goes to Apple's own `nonce` param —
      // asserting both so a raw/digest swap here fails loudly.
      expect(mockedAppleAuth.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
      expect(mockedDigestStringAsync).toHaveBeenCalledWith('SHA-256', '01020304');
    });

    it('swallows an Apple cancellation silently (no error alert)', async () => {
      Platform.OS = 'ios';
      const { signInWithApple } = mockAuth();
      const cancelError = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
      mockedAppleAuth.signInAsync.mockRejectedValueOnce(cancelError);

      const { findByText, queryByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Continue with Apple'));

      await waitFor(() => {
        expect(signInWithApple).not.toHaveBeenCalled();
      });
      expect(queryByText('Could not sign you in with Apple')).toBeNull();
    });

    it('renders the account-already-linked copy for a Google conflict', async () => {
      Platform.OS = 'ios';
      mockAuth({
        signInWithGoogle: jest.fn().mockRejectedValue(
          new ApiError(409, 'This account is already linked to a different Google account'),
        ),
      });
      mockedGoogleSignIn.signIn.mockResolvedValueOnce({
        type: 'success',
        data: { idToken: 'google-id-token', user: { id: '1', email: 'a@b.com', name: null, photo: null, familyName: null, givenName: null }, scopes: [], serverAuthCode: null },
      });

      const { findByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Continue with Google'));

      expect(await findByText('This account is already linked to a different Google account')).toBeTruthy();
    });

    it('shows the provider-disabled copy on a 404 from the oauth endpoint', async () => {
      Platform.OS = 'ios';
      mockAuth({ signInWithGoogle: jest.fn().mockRejectedValue(new ApiError(404, 'Not found')) });
      mockedGoogleSignIn.signIn.mockResolvedValueOnce({
        type: 'success',
        data: { idToken: 'google-id-token', user: { id: '1', email: 'a@b.com', name: null, photo: null, familyName: null, givenName: null }, scopes: [], serverAuthCode: null },
      });

      const { findByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Continue with Google'));

      expect(await findByText("Google sign-in isn't available right now")).toBeTruthy();
    });
  });

  describe('dev-only onboarding replay', () => {
    it('resets the onboarding-seen flag and navigates to /onboarding', async () => {
      mockAuth();
      const replace = jest.fn();
      mockedUseRouter.mockReturnValue({ replace });

      const { findByText } = render(<SignInScreen />);
      fireEvent.press(await findByText('Dev: Replay onboarding'));

      await waitFor(() => {
        expect(mockedResetOnboardingSeen).toHaveBeenCalled();
      });
      expect(replace).toHaveBeenCalledWith('/onboarding');
    });
  });
});
