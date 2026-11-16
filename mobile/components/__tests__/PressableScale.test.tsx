import React from 'react';
import { Animated, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { PressableScale } from '../PressableScale';

describe('PressableScale', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fires onPress and forwards accessibility props like a plain Pressable', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel="Play">
        <Text>Play</Text>
      </PressableScale>,
    );

    fireEvent.press(getByLabelText('Play'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('springs the scale down on pressIn and back to 1 on pressOut', () => {
    const springSpy = jest
      .spyOn(Animated, 'spring')
      .mockReturnValue({ start: jest.fn() } as unknown as Animated.CompositeAnimation);
    const { getByLabelText } = render(
      <PressableScale onPress={jest.fn()} accessibilityLabel="Play">
        <Text>Play</Text>
      </PressableScale>,
    );
    const target = getByLabelText('Play');

    fireEvent(target, 'pressIn');
    expect(springSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.96 }));

    fireEvent(target, 'pressOut');
    expect(springSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1 }));

    expect(springSpy).toHaveBeenCalledTimes(2);
  });

  it('still calls caller-supplied onPressIn/onPressOut alongside the animation', () => {
    jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn() } as unknown as Animated.CompositeAnimation);
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const { getByLabelText } = render(
      <PressableScale onPress={jest.fn()} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityLabel="Play">
        <Text>Play</Text>
      </PressableScale>,
    );
    const target = getByLabelText('Play');

    fireEvent(target, 'pressIn');
    fireEvent(target, 'pressOut');

    expect(onPressIn).toHaveBeenCalledTimes(1);
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });
});
