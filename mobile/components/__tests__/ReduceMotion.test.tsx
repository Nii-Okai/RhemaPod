import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { HeroCarousel } from '../../app/(tabs)/_home/HeroCarousel';
import { StaggerItem } from '../StaggerItem';

describe('Reduce Motion', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('StaggerItem shows its card at once, with no rise, when Reduce Motion is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { getByText } = render(
      <StaggerItem index={3}>
        <Text>Card</Text>
      </StaggerItem>,
    );
    await act(async () => {});
    const wrapper = getByText('Card').parent?.parent;
    const style = Object.assign({}, ...[wrapper?.props.style].flat(Infinity).filter(Boolean));
    expect(style.opacity).toBe(1);
  });

  it("HeroCarousel doesn't auto-advance when Reduce Motion is on", async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const sermons = [{ id: 'a' }, { id: 'b' }] as never[];
    const { getByTestId, getByLabelText } = render(
      <HeroCarousel sermons={sermons} onPress={() => {}} renderCard={(s: { id: string }) => <Text>{s.id}</Text>} />,
    );
    await act(async () => {});
    act(() => {
      getByTestId('hero-carousel').props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } });
    });
    act(() => {
      jest.advanceTimersByTime(20000);
    });
    expect(getByLabelText('Featured sermons, 1 of 2')).toBeTruthy();
  });
});
