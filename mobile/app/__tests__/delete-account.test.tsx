import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import DeleteAccountScreen from '../delete-account';
import { api } from '../../lib/api/typedClient';
import { ApiError, networkError } from '../../lib/api/errors';
import { useAuth } from '../../lib/auth/AuthContext';
import { createTestQueryClient } from '../../lib/query/testUtils';

jest.mock('../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../../lib/auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@expo/vector-icons');

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    hasPlayServices: jest.fn().mockResolvedValue(true),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
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

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedUseAuth = useAuth as jest.Mock;
const mockedAppleSignIn = AppleAuthentication.signInAsync as jest.Mock;
const mockedGoogleSignIn = GoogleSignin.signIn as jest.Mock;
const finishAccountDeletion = jest.fn().mockResolvedValue(undefined);

let profile: Record<string, unknown>;

function renderScreen() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );
}

async function toConfirmStep(screen: ReturnType<typeof renderScreen>) {
  fireEvent.press(await screen.findByText('Continue'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseAuth.mockReturnValue({ finishAccountDeletion });
  profile = { id: 'u1', email: 'ada@example.com', role: 'viewer', has_password: true, linked_providers: [] };
  mockedGet.mockImplementation((path: string) =>
    Promise.resolve(path === '/auth/me' ? profile : {}),
  );
  mockedAppleSignIn.mockResolvedValue({
    identityToken: 'apple-id-token',
    authorizationCode: 'apple-code',
    fullName: null,
  });
});

describe('DeleteAccountScreen', () => {
  it('shows what is deleted, what is kept and the subscription notice before any proof', async () => {
    const screen = renderScreen();
    expect(await screen.findByText("What's deleted")).toBeTruthy();
    expect(screen.getByText(/up to 30 days/)).toBeTruthy();
    expect(screen.getByText("Subscriptions aren't cancelled")).toBeTruthy();
    expect(screen.getByText('Manage subscriptions')).toBeTruthy();
    expect(screen.queryByLabelText('Delete permanently')).toBeNull();
  });

  it('deletes with the password, then wipes the device and lands on sign-in', async () => {
    mockedPost.mockResolvedValueOnce(undefined);
    const screen = renderScreen();
    await toConfirmStep(screen);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });

    expect(mockedPost).toHaveBeenCalledWith('/auth/me/delete', {
      body: { method: 'password', password: 'hunter2hunter2', apple_unavailable: false },
    });
    expect(finishAccountDeletion).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(auth)/sign-in', params: { deleted: '1' } });
  });

  it('does not send an empty password', async () => {
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your password to continue.')).toBeTruthy();
  });

  it('keeps the user signed in and on the screen after a failed re-auth (403)', async () => {
    mockedPost.mockRejectedValueOnce(new ApiError(403, 'Could not confirm your identity'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'wrong');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(await screen.findByText(/couldn't confirm it's you/)).toBeTruthy();
    expect(finishAccountDeletion).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('confirms with Apple when Apple is linked, sending the identity token, nonce and code', async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedPost.mockResolvedValueOnce(undefined);
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/auth/me/delete', {
      body: {
        method: 'apple',
        identity_token: 'apple-id-token',
        raw_nonce: '01020304',
        authorization_code: 'apple-code',
        apple_unavailable: false,
      },
    });
    expect(finishAccountDeletion).toHaveBeenCalled();
    // Apple gets the SHA-256 digest; only the backend sees the raw nonce.
    expect(mockedAppleSignIn).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'hashed-nonce' }));
    expect(mockedAppleSignIn.mock.calls[0][0].nonce).not.toBe('01020304');
  });

  it("does nothing when the user cancels Apple's sheet", async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedAppleSignIn.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
    });
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing was deleted|went wrong|couldn't confirm|didn't confirm/)).toBeNull();
    expect(screen.getByLabelText('Delete permanently, Confirm with Apple').props.accessibilityState.disabled).toBe(false);
  });

  it('blocks client-side when Apple returns no authorization code', async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedAppleSignIn.mockResolvedValueOnce({ identityToken: 'apple-id-token', authorizationCode: null, fullName: null });
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
    });
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText("Apple didn't confirm the sign-in. Try again.")).toBeTruthy();
  });

  it('refetches the profile on 409 "Apple re-auth required"', async () => {
    mockedPost.mockRejectedValueOnce(new ApiError(409, 'Apple re-auth required'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    const meCalls = () => mockedGet.mock.calls.filter(([path]) => path === '/auth/me').length;
    const before = meCalls();
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(await screen.findByText('Apple re-auth required')).toBeTruthy();
    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
    expect(finishAccountDeletion).not.toHaveBeenCalled();
  });

  it('shows the rate-limit message on 429 and clears the password', async () => {
    mockedPost.mockRejectedValueOnce(new ApiError(429, 'Too many attempts. Try again later.'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(await screen.findByText('Too many attempts. Try again later.')).toBeTruthy();
    expect(screen.getByLabelText('Your password').props.value).toBe('');
    expect(finishAccountDeletion).not.toHaveBeenCalled();
  });

  it('shows the network error, stays on screen and clears the password', async () => {
    mockedPost.mockRejectedValueOnce(networkError());
    const screen = renderScreen();
    await toConfirmStep(screen);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(await screen.findByText(networkError().message)).toBeTruthy();
    expect(screen.getByLabelText('Your password').props.value).toBe('');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps the user signed in and shows the message on a 400 "Apple sign-in expired"', async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedPost.mockRejectedValueOnce(new ApiError(400, 'Apple sign-in expired. Please try again.'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
    });
    expect(await screen.findByText('Apple sign-in expired. Please try again.')).toBeTruthy();
    expect(finishAccountDeletion).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not count a non-Apple 503 toward the Apple fallback', async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedPost.mockRejectedValue(new ApiError(503, 'Account deletion is temporarily unavailable. Try again shortly.'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
      });
    }
    expect(screen.queryByText('Use my password instead')).toBeNull();
    expect(screen.queryByText('Nothing was deleted.')).toBeNull();
  });

  it('stays locked after a 204 so a second press sends no second request', async () => {
    let finish!: () => void;
    finishAccountDeletion.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    mockedPost.mockResolvedValue(undefined);
    const screen = renderScreen();
    await toConfirmStep(screen);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    // Wipe still running.
    expect(finishAccountDeletion).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Delete permanently').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Back').props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(mockedPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('offers deleting without Apple only after repeated Apple outages, then sends apple_unavailable', async () => {
    profile = { ...profile, linked_providers: ['apple'] };
    mockedPost.mockRejectedValue(new ApiError(503, 'Apple is unavailable right now. Try again shortly.'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    const button = await screen.findByLabelText('Delete permanently, Confirm with Apple');

    await act(async () => {
      fireEvent.press(button);
    });
    expect(screen.getByText('Nothing was deleted.')).toBeTruthy();
    expect(screen.queryByText('Use my password instead')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently, Confirm with Apple'));
    });
    fireEvent.press(await screen.findByText('Use my password instead'));
    expect(screen.getByText('Remove Apple sign-in yourself')).toBeTruthy();

    mockedPost.mockReset();
    mockedPost.mockResolvedValueOnce(undefined);
    fireEvent.changeText(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/auth/me/delete', {
      body: { method: 'password', password: 'hunter2hunter2', apple_unavailable: true },
    });
    // No automatic revoke on this path: the user is told how to do it by hand.
    expect(screen.getByText(/Settings, tap your name, then Sign-In & Security/)).toBeTruthy();
    expect(screen.getByText(/Stop Using Apple ID/)).toBeTruthy();
  });

  it('sends apple_unavailable on a Google-only fallback after repeated Apple outages', async () => {
    profile = { ...profile, has_password: false, linked_providers: ['apple', 'google'] };
    mockedPost.mockRejectedValue(new ApiError(503, 'Apple is unavailable right now. Try again shortly.'));
    const screen = renderScreen();
    await toConfirmStep(screen);
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Apple'));
      });
    }
    fireEvent.press(await screen.findByText('Use Google instead'));
    mockedPost.mockReset();
    mockedPost.mockResolvedValueOnce(undefined);
    mockedGoogleSignIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'google-id-token' } });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete permanently, Confirm with Google'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/auth/me/delete', {
      body: { method: 'google', id_token: 'google-id-token', apple_unavailable: true },
    });
  });

  it('confirms with Google on a Google-only account', async () => {
    profile = { ...profile, has_password: false, linked_providers: ['google'] };
    mockedGoogleSignIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'google-id-token' } });
    mockedPost.mockResolvedValueOnce(undefined);
    const screen = renderScreen();
    await toConfirmStep(screen);
    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Delete permanently, Confirm with Google'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/auth/me/delete', {
      body: { method: 'google', id_token: 'google-id-token', apple_unavailable: false },
    });
  });

  it('tells staff to ask an administrator and offers no delete button', async () => {
    profile = { ...profile, role: 'editor' };
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByText('Staff accounts are removed by an administrator.')).toBeTruthy());
    expect(screen.queryByText('Continue')).toBeNull();
  });
});
