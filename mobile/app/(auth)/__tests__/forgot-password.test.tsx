import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ForgotPasswordScreen from '../forgot-password';
import { useAuth } from '../../../lib/auth/AuthContext';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@expo/vector-icons');

const mockedUseAuth = useAuth as jest.Mock;

describe('ForgotPasswordScreen', () => {
  it('asks for an email before sending anything', () => {
    const forgotPassword = jest.fn();
    mockedUseAuth.mockReturnValue({ forgotPassword });

    const { getByText } = render(<ForgotPasswordScreen />);
    fireEvent.press(getByText('Send reset link'));

    expect(getByText('Enter your email.')).toBeTruthy();
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it('switches to the check-your-email state with the generic copy once sent', async () => {
    const forgotPassword = jest.fn().mockResolvedValue({ message: 'ok' });
    mockedUseAuth.mockReturnValue({ forgotPassword });

    const { getByText, getByLabelText } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByLabelText('Email'), ' user@example.com ');
    fireEvent.press(getByText('Send reset link'));

    await waitFor(() => expect(getByText('Check your email')).toBeTruthy());
    expect(getByText('If that email exists, a reset link has been sent.')).toBeTruthy();
    expect(getByText('user@example.com')).toBeTruthy();
    expect(forgotPassword).toHaveBeenCalledWith('user@example.com');
  });

  it('says plainly when the request never reached the server', async () => {
    mockedUseAuth.mockReturnValue({ forgotPassword: jest.fn().mockRejectedValue(new Error('offline')) });

    const { getByText, getByLabelText } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByLabelText('Email'), 'user@example.com');
    fireEvent.press(getByText('Send reset link'));

    await waitFor(() => expect(getByText('Could not send reset link')).toBeTruthy());
  });
});
