import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import OnboardingScreen from '../onboarding';
import { markOnboardingSeen } from '../../lib/settings/onboardingSeen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('../../lib/settings/onboardingSeen', () => ({
  markOnboardingSeen: jest.fn().mockResolvedValue(undefined),
}));

const mockedMarkOnboardingSeen = markOnboardingSeen as jest.Mock;

beforeEach(() => {
  mockReplace.mockClear();
  mockedMarkOnboardingSeen.mockClear();
});

describe('OnboardingScreen', () => {
  it('renders all three slides (first slide content, dot count per slide, and the trailing action label on each)', () => {
    const { getByText, getAllByTestId, getAllByText } = render(<OnboardingScreen />);

    expect(getByText('Grow spiritually,\nlive fully')).toBeTruthy();
    expect(
      getByText(
        "Messages that answer life's questions and strengthen your faith, with a short quiet time each morning to help it take root.",
      ),
    ).toBeTruthy();
    expect(
      getByText(
        'Renew your mindset and find inspiration tailored exactly to your walk and destiny in God. Step into your purpose and live with confidence.',
      ),
    ).toBeTruthy();
    expect(getByText('Solutions at your\nfingertips')).toBeTruthy();
    expect(getByText('Empower your\neveryday life')).toBeTruthy();

    // Slide 0's own dots row has exactly 3 dots (one per slide in the data file).
    expect(getAllByTestId(/^onboarding-dot-0-/)).toHaveLength(3);

    // First two slides offer "Continue"; only the last offers "Get started".
    expect(getAllByText('Continue')).toHaveLength(2);
    expect(getAllByText('Get started')).toHaveLength(1);
  });

  it('Skip marks onboarding seen and replaces the route with sign-in', async () => {
    const { getAllByText } = render(<OnboardingScreen />);

    fireEvent.press(getAllByText('Skip')[0]);

    await waitFor(() => expect(mockedMarkOnboardingSeen).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('the final slide\'s "Get Started" does the same as Skip', async () => {
    const { getByText } = render(<OnboardingScreen />);

    fireEvent.press(getByText('Get started'));

    await waitFor(() => expect(mockedMarkOnboardingSeen).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('a non-final slide\'s "Next" advances the page without touching onboarding-seen', () => {
    const { getAllByText } = render(<OnboardingScreen />);

    fireEvent.press(getAllByText('Continue')[0]);

    expect(mockedMarkOnboardingSeen).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
