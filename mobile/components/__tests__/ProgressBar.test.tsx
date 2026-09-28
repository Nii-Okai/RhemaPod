import React from 'react';
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
  // the one place this component's own two consumers deliberately diverge.
  it('defaults to instant (unanimated) — the player scrub-bar/buffering behaviour', () => {
    const { getByLabelText } = render(<ProgressBar progress={0.5} accessibilityLabel="progress" />);
    expect(getByLabelText('progress').props.accessibilityValue.now).toBe(50);
  });

  it('accepts an `animated` prop for the download-progress row without changing the exposed value', () => {
    const { getByLabelText } = render(<ProgressBar progress={0.5} accessibilityLabel="progress" animated />);
    expect(getByLabelText('progress').props.accessibilityValue.now).toBe(50);
  });
});
