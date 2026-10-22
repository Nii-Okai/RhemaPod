import React from 'react';
import { render } from '@testing-library/react-native';
import { CastCloseHeader } from '../CastCloseHeader';

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

// A build with the Cast SDK linked: its native button stands in as a plain view.
jest.mock('../../lib/cast/googleCast', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return { googleCast: { CastButton: (props: object) => <MockView testID="google-cast-button" {...props} /> } };
});

describe('CastCloseHeader with the Cast SDK', () => {
  it('renders the Google Cast button where the screen casts', () => {
    const { getByTestId, getByLabelText } = render(<CastCloseHeader onClose={jest.fn()} castEnabled />);
    expect(getByTestId('google-cast-button')).toBeTruthy();
    expect(getByLabelText('Cast').props.accessibilityState).toBeUndefined();
  });

  it('keeps the disabled placeholder on screens that do not cast', () => {
    const { queryByTestId, getByLabelText } = render(<CastCloseHeader onClose={jest.fn()} />);
    expect(queryByTestId('google-cast-button')).toBeNull();
    expect(getByLabelText('Cast').props.accessibilityState.disabled).toBe(true);
  });
});
