import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LinkButton, PrimaryButton } from '../Button';

describe('PrimaryButton', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<PrimaryButton label="Sign in" onPress={onPress} />);

    fireEvent.press(getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<PrimaryButton label="Sign in" onPress={onPress} disabled />);

    fireEvent.press(getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('LinkButton', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<LinkButton label="Retry" onPress={onPress} />);

    fireEvent.press(getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<LinkButton label="Cancel" onPress={onPress} disabled />);

    fireEvent.press(getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });

  // Real gap this pins down: `disabled` already blocked touches and set
  // accessibilityState correctly, but had no matching visual dimming at all — a disabled
  // Cancel (e.g. while a save is in flight) looked identical to an enabled one.
  it('dims visually when disabled', () => {
    const { getByRole } = render(<LinkButton label="Cancel" onPress={() => {}} disabled />);
    const button = getByRole('button');
    const flatStyle = Array.isArray(button.props.style) ? Object.assign({}, ...button.props.style.flat(Infinity).filter(Boolean)) : button.props.style;
    expect(flatStyle?.opacity).toBe(0.4);
  });

  it('is not dimmed when enabled', () => {
    const { getByRole } = render(<LinkButton label="Cancel" onPress={() => {}} />);
    expect(getByRole('button').props.style).toBeUndefined();
  });
});
