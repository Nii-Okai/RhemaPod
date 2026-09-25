import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { IconButton } from '../IconButton';

jest.mock('@expo/vector-icons');

describe('IconButton', () => {
  it('requires and exposes an accessibilityLabel', () => {
    const { getByLabelText } = render(<IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => {}} />);
    expect(getByLabelText('Back')).toBeTruthy();
  });

  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(
      <IconButton icon="chevron-back" accessibilityLabel="Back" onPress={onPress} disabled />,
    );
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
