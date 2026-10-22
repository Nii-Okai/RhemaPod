import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CastCloseHeader } from '../CastCloseHeader';

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

describe('CastCloseHeader', () => {
  it('fires onClose when the close icon is pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<CastCloseHeader onClose={onClose} />);

    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the cast icon disabled unless the screen casts (and Jest has no Cast SDK)', () => {
    const { getByLabelText } = render(<CastCloseHeader onClose={jest.fn()} />);
    const cast = getByLabelText('Cast');
    expect(cast.props.accessibilityState.disabled).toBe(true);
  });

  it('renders no back button', () => {
    const { queryByLabelText } = render(<CastCloseHeader onClose={jest.fn()} />);
    expect(queryByLabelText('Back')).toBeNull();
  });

  it('renders a back chevron and fires onBack when provided (drill-down entry, e.g. a Related item)', () => {
    const onBack = jest.fn();
    const { getByLabelText } = render(<CastCloseHeader onClose={jest.fn()} onBack={onBack} />);

    fireEvent.press(getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('still renders Cast and Close alongside the back chevron', () => {
    const { getByLabelText } = render(<CastCloseHeader onClose={jest.fn()} onBack={jest.fn()} />);

    expect(getByLabelText('Cast')).toBeTruthy();
    expect(getByLabelText('Close')).toBeTruthy();
  });
});
