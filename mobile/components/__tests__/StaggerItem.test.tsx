import React from 'react';
import { Animated, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { StaggerItem } from '../StaggerItem';

describe('StaggerItem', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders its children', () => {
    const { getByText } = render(
      <StaggerItem index={0}>
        <Text>Card</Text>
      </StaggerItem>,
    );
    expect(getByText('Card')).toBeTruthy();
  });

  it('delays later items further, capped at the max delay', () => {
    const timingSpy = jest
      .spyOn(Animated, 'timing')
      .mockReturnValue({ start: jest.fn(), stop: jest.fn() } as unknown as Animated.CompositeAnimation);

    render(
      <StaggerItem index={0}>
        <Text>First</Text>
      </StaggerItem>,
    );
    expect(timingSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ delay: 0 }));

    render(
      <StaggerItem index={3}>
        <Text>Fourth</Text>
      </StaggerItem>,
    );
    expect(timingSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ delay: 120 }));

    render(
      <StaggerItem index={50}>
        <Text>Far down the shelf</Text>
      </StaggerItem>,
    );
    expect(timingSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ delay: 320 }));
  });
});
