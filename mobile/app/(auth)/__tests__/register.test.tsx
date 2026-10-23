import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RegisterScreen from '../register';
import { useAuth } from '../../../lib/auth/AuthContext';
import { ApiError } from '../../../lib/api/errors';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
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
    signOut: jest.fn().mockResolvedValue(undefined),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
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
  Platform.OS = 'ios';
});

describe('RegisterScreen', () => {
  it('shows a field-level error and does not call register when fields are empty', () => {
    const { register } = mockAuth();

    const { getByText } = render(<RegisterScreen />);
    fireEvent.press(getByText('Create account'));

    expect(getByText('Email and password are required.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });

  it('shows the server error copy on a failed register call', async () => {
    const { register } = mockAuth({ register: jest.fn().mockRejectedValue(new ApiError(409, 'Email already registered')) });

    const { getByText, getByLabelText } = render(<RegisterScreen />);
    fireEvent.changeText(getByLabelText('Email'), 'user@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'lantern-river-47');
    fireEvent.press(getByText('Create account'));

    await waitFor(() => {
      expect(getByText('Email already registered')).toBeTruthy();
    });
    expect(register).toHaveBeenCalledWith('user@example.com', 'lantern-river-47');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('goes to verify-email after a successful register', async () => {
    const { register } = mockAuth();
    mockReplace.mockClear();

    const { getByText, getByLabelText } = render(<RegisterScreen />);
    fireEvent.changeText(getByLabelText('Email'), 'user@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'lantern-river-47');
    fireEvent.press(getByText('Create account'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(auth)/verify-email',
        params: { email: 'user@example.com' },
      });
    });
    expect(register).toHaveBeenCalledWith('user@example.com', 'lantern-river-47');
  });

  describe('social sign-in buttons', () => {
    it('renders both the Google and Apple buttons on iOS when Apple sign-in is available', async () => {
      Platform.OS = 'ios';
      mockAuth();

      const { findByText } = render(<RegisterScreen />);

      expect(await findByText('Continue with Google')).toBeTruthy();
      expect(await findByText('Continue with Apple')).toBeTruthy();
    });

    it('does not render the Apple button on Android', async () => {
      Platform.OS = 'android';
      mockAuth();

      const { findByText, queryByText } = render(<RegisterScreen />);

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

      const { findByText } = render(<RegisterScreen />);
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

      const { findByText } = render(<RegisterScreen />);
      fireEvent.press(await findByText('Continue with Apple'));

      await waitFor(() => {
        expect(signInWithApple).toHaveBeenCalledWith('apple-identity-token', '01020304', 'apple-auth-code', 'Grace', 'Hopper');
      });
      expect(mockedAppleAuth.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
      expect(mockedDigestStringAsync).toHaveBeenCalledWith('SHA-256', '01020304');
    });

    it('swallows an Apple cancellation silently (no error alert)', async () => {
      Platform.OS = 'ios';
      const { signInWithApple } = mockAuth();
      const cancelError = Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
      mockedAppleAuth.signInAsync.mockRejectedValueOnce(cancelError);

      const { findByText, queryByText } = render(<RegisterScreen />);
      fireEvent.press(await findByText('Continue with Apple'));

      await waitFor(() => {
        expect(signInWithApple).not.toHaveBeenCalled();
      });
      expect(queryByText('Could not sign you in with Apple')).toBeNull();
    });

    it('renders the staff-must-use-password copy for an Apple rejection', async () => {
      Platform.OS = 'ios';
      mockAuth({
        signInWithApple: jest.fn().mockRejectedValue(new ApiError(403, 'Staff accounts must sign in with email and password')),
      });
      mockedAppleAuth.signInAsync.mockResolvedValueOnce({
        identityToken: 'apple-identity-token',
        authorizationCode: null,
        user: 'apple-user-id',
        state: null,
        email: null,
        realUserStatus: 1,
        fullName: null,
      });

      const { findByText } = render(<RegisterScreen />);
      fireEvent.press(await findByText('Continue with Apple'));

      expect(await findByText('Staff accounts must sign in with email and password')).toBeTruthy();
    });
  });
});
