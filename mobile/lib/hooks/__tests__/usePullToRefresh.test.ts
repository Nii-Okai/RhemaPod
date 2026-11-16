import { act, renderHook } from '@testing-library/react-native';
import { usePullToRefresh } from '../usePullToRefresh';

describe('usePullToRefresh', () => {
  it('refetches every source and stops spinning once they settle, even when one fails', async () => {
    const ok = { refetch: jest.fn().mockResolvedValue('ok') };
    const failing = jest.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePullToRefresh([ok, failing]));

    expect(result.current.refreshing).toBe(false);
    await act(async () => {
      result.current.onRefresh();
    });

    expect(ok.refetch).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
  });

  it('shows the spinner while a refetch is in flight', () => {
    const pending = { refetch: jest.fn(() => new Promise(() => {})) };
    const { result } = renderHook(() => usePullToRefresh([pending]));

    act(() => result.current.onRefresh());
    expect(result.current.refreshing).toBe(true);
  });
});
