import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { AnimatedSplash, SPLASH_DURATION_MS } from '../AnimatedSplash';

jest.useFakeTimers();

async function flush() {
  // Let the reduce-motion lookup resolve, then run the timers it starts.
  await act(async () => {
    await Promise.resolve();
  });
}

describe('AnimatedSplash', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is one "RhemaPod" image for screen readers and hides the native splash on first layout', () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const onShown = jest.fn();
    const { getByLabelText, getByTestId } = render(<AnimatedSplash ready={false} onFinish={jest.fn()} onShown={onShown} />);
    expect(getByLabelText('RhemaPod')).toBeTruthy();
    getByTestId('animated-splash').props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 844 } } });
    getByTestId('animated-splash').props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 844 } } });
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('plays for about two seconds, then fades out once the app is ready', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const onFinish = jest.fn();
    const view = render(<AnimatedSplash ready={false} onFinish={onFinish} />);
    await flush();
    act(() => jest.advanceTimersByTime(SPLASH_DURATION_MS + 1000));
    // Not ready yet: it holds rather than revealing an unfinished app.
    expect(onFinish).not.toHaveBeenCalled();

    view.rerender(<AnimatedSplash ready onFinish={onFinish} />);
    act(() => jest.advanceTimersByTime(1000));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('skips the motion and leaves quickly with Reduce Motion on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const onFinish = jest.fn();
    render(<AnimatedSplash ready onFinish={onFinish} />);
    await flush();
    act(() => jest.advanceTimersByTime(700));
    act(() => jest.advanceTimersByTime(500));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
