import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import VerifyEmailScreen from '../verify-email';
import { useAuth } from '../../../lib/auth/AuthContext';
import { ApiError } from '../../../lib/api/errors';

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@expo/vector-icons');

const mockedUseAuth = useAuth as jest.Mock;

function mockAuth(overrides: Record<string, jest.Mock> = {}) {
  const value = {
    verifyEmail: jest.fn().mockResolvedValue(undefined),
    resendVerification: jest.fn().mockResolvedValue({ message: 'ok' }),
    ...overrides,
  };
  mockedUseAuth.mockReturnValue(value);
  return value;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { email: 'user@example.com' };
});

describe('VerifyEmailScreen', () => {
  it('submits the 6-digit code with the email from the route as soon as it is complete', async () => {
    const { verifyEmail, resendVerification } = mockAuth();
    const { getByText, getByLabelText } = render(<VerifyEmailScreen />);

    expect(getByText('Enter the 6-digit code we sent to user@example.com.')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Verification code'), '12 34-56');

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('user@example.com', '123456'));
    expect(resendVerification).not.toHaveBeenCalled();
  });

  it('refuses a short code without calling the API', () => {
    const { verifyEmail } = mockAuth();
    const { getByText, getByLabelText } = render(<VerifyEmailScreen />);
    fireEvent.changeText(getByLabelText('Verification code'), '123');
    fireEvent.press(getByText('Verify and continue'));
    expect(getByText('Enter the 6-digit code from the email.')).toBeTruthy();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('shows the wrong-code copy on a 400', async () => {
    mockAuth({ verifyEmail: jest.fn().mockRejectedValue(new ApiError(400, 'Invalid or expired code')) });
    const { getByText, getByLabelText } = render(<VerifyEmailScreen />);
    fireEvent.changeText(getByLabelText('Verification code'), '123456');
    await waitFor(() =>
      expect(getByText('That code is wrong or has expired. Check the email or send a new code.')).toBeTruthy(),
    );
  });

  it('sends a fresh code on arrival from sign-in', async () => {
    mockParams = { email: 'user@example.com', resend: '1' };
    const { resendVerification } = mockAuth();
    const { findByText } = render(<VerifyEmailScreen />);
    expect(await findByText('We sent a new code to user@example.com.')).toBeTruthy();
    expect(resendVerification).toHaveBeenCalledTimes(1);
  });
});
