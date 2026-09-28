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

  // Design spec §6: "no focus-visible, disabled, or pressed states are encoded anywhere in
  // the source... mobile-developer needs to design-in-code standard states". `disabled`
  // already blocked touches and set accessibilityState correctly, but had no matching
  // visual dimming — a real gap this test pins down.
  it('dims visually when disabled', () => {
    const { getByRole } = render(<IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => {}} disabled />);
    const button = getByRole('button');
    const flatStyle = Array.isArray(button.props.style) ? Object.assign({}, ...button.props.style.flat(Infinity).filter(Boolean)) : button.props.style;
    expect(flatStyle.opacity).toBe(0.4);
  });

  it('is not dimmed when enabled and not pressed', () => {
    const { getByRole } = render(<IconButton icon="chevron-back" accessibilityLabel="Back" onPress={() => {}} />);
    const button = getByRole('button');
    const flatStyle = Array.isArray(button.props.style) ? Object.assign({}, ...button.props.style.flat(Infinity).filter(Boolean)) : button.props.style;
    expect(flatStyle.opacity).toBeUndefined();
  });
});
