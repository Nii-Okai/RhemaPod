import { act, renderHook } from '@testing-library/react-native';
import { useSleepTimer } from '../useSleepTimer';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSleepTimer', () => {
  it('starts disarmed (null) until a duration is set', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire }));

    expect(result.current.remainingSeconds).toBeNull();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('counts down once per second after arming', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire }));

    act(() => {
      result.current.setMinutes(15);
    });
    expect(result.current.remainingSeconds).toBe(900);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.remainingSeconds).toBe(899);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.remainingSeconds).toBe(894);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('calls onExpire exactly once on reaching zero, then disarms', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire }));

    act(() => {
      result.current.setMinutes(1);
    });

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.remainingSeconds).toBeNull();

    // Nothing further fires from the now-cleared interval.
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('replacing an active timer resets the countdown rather than stacking it', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire }));

    act(() => {
      result.current.setMinutes(30);
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current.remainingSeconds).toBe(1790);

    act(() => {
      result.current.setMinutes(15);
    });
    expect(result.current.remainingSeconds).toBe(900);
  });

  it('disarming with null cancels the countdown without ever calling onExpire (failure-mode guard)', () => {
    const onExpire = jest.fn();
    const { result } = renderHook(() => useSleepTimer({ onExpire }));

    act(() => {
      result.current.setMinutes(1);
    });
    act(() => {
      result.current.setMinutes(null);
    });

    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
    expect(result.current.remainingSeconds).toBeNull();
  });
});
