import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinkButton, PrimaryButton } from '../Button';

jest.mock('@expo/vector-icons');

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return (style as Record<string, unknown>) || {};
}

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

  it('is content-sized (no explicit width) by default', () => {
    const { getByRole } = render(<PrimaryButton label="Sign in" onPress={jest.fn()} />);
    expect(flattenStyle(getByRole('button').props.style).width).toBeUndefined();
  });

  it('stretches to 100% width when fullWidth is set', () => {
    const { getByRole } = render(<PrimaryButton label="Play" onPress={jest.fn()} fullWidth />);
    expect(flattenStyle(getByRole('button').props.style).width).toBe('100%');
  });

  it('renders a leading icon when one is given', () => {
    const { UNSAFE_getByType } = render(<PrimaryButton label="Play" onPress={jest.fn()} icon="play" />);
    expect(UNSAFE_getByType(Ionicons).props.name).toBe('play');
  });

  it('renders no icon by default', () => {
    const { UNSAFE_queryAllByType } = render(<PrimaryButton label="Sign in" onPress={jest.fn()} />);
    expect(UNSAFE_queryAllByType(Ionicons)).toHaveLength(0);
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
