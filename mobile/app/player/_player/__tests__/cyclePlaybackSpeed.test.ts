import { nextPlaybackSpeed, formatPlaybackSpeed } from '../cyclePlaybackSpeed';

describe('nextPlaybackSpeed', () => {
  it('advances through the list in order', () => {
    expect(nextPlaybackSpeed(1)).toBe(1.25);
    expect(nextPlaybackSpeed(1.25)).toBe(1.5);
    expect(nextPlaybackSpeed(1.5)).toBe(1.75);
    expect(nextPlaybackSpeed(1.75)).toBe(2);
  });

  it('wraps back to the first speed after the last', () => {
    expect(nextPlaybackSpeed(2)).toBe(1);
  });

  it('falls back to the first speed for an unrecognized current value (failure mode)', () => {
    // Not a real call-site scenario today (the type only allows PLAYBACK_SPEEDS members),
    // but a defensive floor against a future widened list this function hasn't caught up to.
    expect(nextPlaybackSpeed(3 as never)).toBe(1);
  });
});

describe('formatPlaybackSpeed', () => {
  it('renders the multiplier symbol', () => {
    expect(formatPlaybackSpeed(1)).toBe('1×');
    expect(formatPlaybackSpeed(1.25)).toBe('1.25×');
  });
});
