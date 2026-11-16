import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { OVERLAY_AUTOHIDE_MS, useControlsOverlay } from '../useControlsOverlay';

const playing = { isPlaying: true, isBuffering: false, isEnded: false, pinned: false };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount(options = playing) {
  const hook = renderHook((props) => useControlsOverlay(props), { initialProps: options });
  await act(async () => {});
  return hook;
}

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

describe('useControlsOverlay', () => {
  it('starts visible and auto-hides 3s after the last interaction while playing', async () => {
    const { result } = await mount();
    expect(result.current.visible).toBe(true);

    advance(OVERLAY_AUTOHIDE_MS - 1);
    expect(result.current.visible).toBe(true);
    advance(1);
    expect(result.current.visible).toBe(false);
  });

  it('restarts the 3s timer on every interaction', async () => {
    const { result } = await mount();
    advance(2000);
    act(() => result.current.touch());
    advance(2000);
    expect(result.current.visible).toBe(true);
    advance(1000);
    expect(result.current.visible).toBe(false);
  });

  it('toggles on a tap of the video', async () => {
    const { result } = await mount();
    advance(OVERLAY_AUTOHIDE_MS);
    expect(result.current.visible).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.visible).toBe(false);
  });

  it.each([
    ['paused', { ...playing, isPlaying: false }],
    ['buffering', { ...playing, isBuffering: true }],
    ['pinned by a sheet or a seek drag', { ...playing, pinned: true }],
  ])('does not auto-hide while %s', async (_label, options) => {
    const { result } = await mount(options);
    advance(OVERLAY_AUTOHIDE_MS * 3);
    expect(result.current.visible).toBe(true);
  });

  it('starts the countdown once a pinning condition clears', async () => {
    const { result, rerender } = await mount({ ...playing, pinned: true });
    advance(OVERLAY_AUTOHIDE_MS * 2);
    expect(result.current.visible).toBe(true);
    rerender(playing);
    advance(OVERLAY_AUTOHIDE_MS);
    expect(result.current.visible).toBe(false);
  });

  it('never hides under a screen reader', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const { result } = await mount();
    advance(OVERLAY_AUTOHIDE_MS * 3);
    expect(result.current.visible).toBe(true);
  });

  it('stays up, pinned, once the sermon has ended', async () => {
    const { result } = await mount({ ...playing, isEnded: true });
    act(() => result.current.toggle()); // a tap would hide it; ended pins it
    advance(OVERLAY_AUTOHIDE_MS * 2);
    expect(result.current.visible).toBe(true);
  });

  it('reports Reduce Motion so the surface can skip the fade', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { result } = await mount();
    expect(result.current.reduceMotion).toBe(true);
  });
});
