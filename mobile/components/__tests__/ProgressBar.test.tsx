import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('exposes accessibilityRole="progressbar" with a rounded-percent accessibilityValue', () => {
    const { getByLabelText } = render(<ProgressBar progress={0.42} accessibilityLabel="42% downloaded" />);
    const bar = getByLabelText('42% downloaded');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  });

  it('clamps out-of-range progress to 0–100', () => {
    const { getByLabelText, rerender } = render(<ProgressBar progress={-0.5} accessibilityLabel="progress" />);
    expect(getByLabelText('progress').props.accessibilityValue.now).toBe(0);

    rerender(<ProgressBar progress={1.5} accessibilityLabel="progress" />);
    expect(getByLabelText('progress').props.accessibilityValue.now).toBe(100);
  });

  // Design spec §1.4's motion baseline: download-progress rows animate their fill
  // (`animated`), the player's scrub/buffering bar stays instant (the default) — this is
  // the one place this component's own two consumers deliberately diverge. The two tests
  // below prove the actual mechanism, not just the final rendered value (which is
  // identical either way and so can't tell the two code paths apart) — per
  // reviewer-gilfoyle's should-fix, they spy on `Animated.timing` itself, stubbed to a
  // no-op `.start()` so no real animation timers are left running past the test (the same
  // failure mode the component's own `hasMounted` guard exists to avoid on mount).
  describe('the `animated` prop actually changes which code path updates the fill', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('drives the fill via `Animated.timing` (~250ms ease-out) when `animated` is set and progress changes post-mount', () => {
      const timingSpy = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn() } as unknown as Animated.CompositeAnimation);
      const { rerender } = render(<ProgressBar progress={0.2} accessibilityLabel="progress" animated />);

      // Mounting itself must not animate (nothing to ease from yet) — only a later update should.
      expect(timingSpy).not.toHaveBeenCalled();

      rerender(<ProgressBar progress={0.6} accessibilityLabel="progress" animated />);

      expect(timingSpy).toHaveBeenCalledTimes(1);
      expect(timingSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toValue: 60, duration: 250, useNativeDriver: false }),
      );
      // `Animated.timing` returning a composite animation is inert until `.start()` runs —
      // asserting the call args alone wouldn't prove the component actually starts it.
      expect(timingSpy.mock.results[0]?.value.start).toHaveBeenCalledTimes(1);
    });

    it('never calls `Animated.timing` when `animated` is left at its default (instant) — sets the value directly instead', () => {
      const timingSpy = jest.spyOn(Animated, 'timing');
      const { rerender } = render(<ProgressBar progress={0.2} accessibilityLabel="progress" />);

      rerender(<ProgressBar progress={0.6} accessibilityLabel="progress" />);

      expect(timingSpy).not.toHaveBeenCalled();
    });
  });
});
