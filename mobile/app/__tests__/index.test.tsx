import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import Index from '../index';
import { hasSeenOnboarding } from '../../lib/settings/onboardingSeen';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

jest.mock('../../lib/settings/onboardingSeen', () => ({
  hasSeenOnboarding: jest.fn(),
}));

let mockStatus: 'loading' | 'signedIn' | 'signedOut' = 'loading';
jest.mock('../../lib/auth/AuthContext', () => ({
  useAuth: () => ({ status: mockStatus }),
}));

const mockedHasSeenOnboarding = hasSeenOnboarding as jest.Mock;

beforeEach(() => {
  mockRedirect.mockClear();
  mockedHasSeenOnboarding.mockReset();
  mockStatus = 'loading';
});

describe('Index (root route)', () => {
  it('shows the loading spinner while auth status is still loading, even once onboarding resolves', async () => {
    mockedHasSeenOnboarding.mockResolvedValue(true);
    mockStatus = 'loading';
    const { UNSAFE_getByType } = render(<Index />);

    await waitFor(() => expect(mockedHasSeenOnboarding).toHaveBeenCalled());
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('keeps the loading spinner up while the onboarding-seen check is still pending, even once auth resolves', () => {
    mockedHasSeenOnboarding.mockReturnValue(new Promise(() => {})); // never resolves
    mockStatus = 'signedOut';
    const { UNSAFE_getByType } = render(<Index />);

    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to onboarding when it has not been seen yet, regardless of auth status', async () => {
    mockedHasSeenOnboarding.mockResolvedValue(false);
    mockStatus = 'signedIn';
    render(<Index />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/onboarding'));
  });

  it('redirects to sign-in once onboarding is seen and the device is signed out', async () => {
    mockedHasSeenOnboarding.mockResolvedValue(true);
    mockStatus = 'signedOut';
    render(<Index />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/(auth)/sign-in'));
  });

  it('redirects to home once onboarding is seen and the device is signed in', async () => {
    mockedHasSeenOnboarding.mockResolvedValue(true);
    mockStatus = 'signedIn';
    render(<Index />);

    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/(tabs)/home'));
  });
});
