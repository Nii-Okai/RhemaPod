import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Toggle } from '../Toggle';

describe('Toggle', () => {
  it('requires and exposes an accessibilityLabel, and reports its checked state', () => {
    const { getByLabelText } = render(
      <Toggle value onValueChange={() => {}} accessibilityLabel="Autoplay next in series" />,
    );
    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(true);
  });

  it('calls onValueChange with the inverted value when pressed', () => {
    const onValueChange = jest.fn();
    const { getByRole } = render(
      <Toggle value={false} onValueChange={onValueChange} accessibilityLabel="Autoplay next in series" />,
    );
    fireEvent.press(getByRole('switch'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('does not fire onValueChange when disabled', () => {
    const onValueChange = jest.fn();
    const { getByRole } = render(
      <Toggle value={false} onValueChange={onValueChange} disabled accessibilityLabel="Autoplay next in series" />,
    );
    fireEvent.press(getByRole('switch'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
