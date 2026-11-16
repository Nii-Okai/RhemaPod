import { act, renderHook, waitFor } from '@testing-library/react-native';
import { formatCacheSize, useMediaCacheUsage } from '../useMediaCacheUsage';

describe('useMediaCacheUsage', () => {
  it('reads the cache size, clears it, and reads it again', async () => {
    let size = 300 * 1024 * 1024;
    const deps = {
      totalBytes: jest.fn(async () => size),
      clear: jest.fn(async () => {
        size = 0;
      }),
    };
    const { result } = renderHook(() => useMediaCacheUsage(deps));
    await waitFor(() => expect(result.current.bytes).toBe(300 * 1024 * 1024));

    await act(() => result.current.clear());
    expect(deps.clear).toHaveBeenCalledTimes(1);
    expect(result.current.bytes).toBe(0);
    expect(result.current.clearing).toBe(false);
  });
});

describe('formatCacheSize', () => {
  it('uses MB below a gigabyte and one decimal of GB above', () => {
    expect(formatCacheSize(0)).toBe('0 MB');
    expect(formatCacheSize(12.4 * 1024 * 1024)).toBe('12 MB');
    expect(formatCacheSize(1.25 * 1024 ** 3)).toBe('1.3 GB');
  });
});
