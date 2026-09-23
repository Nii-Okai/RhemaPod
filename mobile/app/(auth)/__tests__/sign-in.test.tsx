import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SignInScreen from '../sign-in';
import { useAuth } from '../../../lib/auth/AuthContext';
import { ApiError } from '../../../lib/api/errors';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../lib/auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockedUseAuth = useAuth as jest.Mock;

describe('SignInScreen', () => {
  it('shows a field-level error and does not call signIn when fields are empty', () => {
    const signIn = jest.fn();
    mockedUseAuth.mockReturnValue({ signIn, register: jest.fn(), forgotPassword: jest.fn(), signOut: jest.fn() });

    const { getByText } = render(<SignInScreen />);
    fireEvent.press(getByText('Sign in'));

    expect(getByText('Email and password are required.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows the wrong-credentials copy on a 401 from signIn', async () => {
    const signIn = jest.fn().mockRejectedValue(new ApiError(401, 'Invalid email or password'));
    mockedUseAuth.mockReturnValue({ signIn, register: jest.fn(), forgotPassword: jest.fn(), signOut: jest.fn() });

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
});
