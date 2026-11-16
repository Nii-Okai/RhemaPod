import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CheckEmailBody } from '../check-email';

jest.mock('@expo/vector-icons');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// The countdown re-arms one timeout per second, so each tick needs its own act().
function waitOutCooldown() {
  for (let i = 0; i < 30; i += 1) {
    act(() => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('CheckEmailBody', () => {
  it('shows where the email went and no resend control without onResend', () => {
    const { getByText, queryByText } = render(<CheckEmailBody email="a@b.com" kind="code" />);

    expect(getByText('a@b.com')).toBeTruthy();
    expect(queryByText('Resend email')).toBeNull();
    expect(queryByText(/Resend in/)).toBeNull();
  });

  it('holds resend behind a cooldown, then resends and confirms', async () => {
    const onResend = jest.fn().mockResolvedValue(undefined);
    const { getByText, queryByText } = render(<CheckEmailBody email="a@b.com" kind="reset" onResend={onResend} />);

    expect(queryByText('Resend email')).toBeNull();
    waitOutCooldown();

    fireEvent.press(getByText('Resend email'));
    await waitFor(() => expect(getByText('Sent again')).toBeTruthy());
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('shows a network error when the resend fails', async () => {
    const onResend = jest.fn().mockRejectedValue(new Error('offline'));
    const { getByText } = render(<CheckEmailBody email="a@b.com" kind="reset" onResend={onResend} />);

    waitOutCooldown();
    fireEvent.press(getByText('Resend email'));

    await waitFor(() => expect(getByText('Could not resend')).toBeTruthy());
  });
});
