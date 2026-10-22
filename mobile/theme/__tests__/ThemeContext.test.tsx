import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as RN from 'react-native';
import { AsyncStorage } from 'expo-sqlite/kv-store';
import { ThemeProvider, createThemedStyles, resolveScheme, useTheme } from '../ThemeContext';
import { darkColors, lightColors } from '../colors';

jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    AsyncStorage: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      __store: store,
    },
  };
});

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  __store: Map<string, string>;
};

let systemScheme: 'light' | 'dark' | null = 'light';
beforeEach(() => {
  storage.__store.clear();
  storage.setItem.mockClear();
  systemScheme = 'light';
  jest.spyOn(RN, 'useColorScheme').mockImplementation(() => systemScheme);
});
afterEach(() => jest.restoreAllMocks());

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('resolveScheme', () => {
  it('follows the phone for `system`, and an explicit choice otherwise', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});

describe('ThemeProvider', () => {
  it('outside a provider, components get the dark palette (pre-light-mode behaviour)', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.scheme).toBe('dark');
    expect(result.current.colors).toBe(darkColors);
  });

  it('defaults to following the phone', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(result.current.preference).toBe('system');
    expect(result.current.scheme).toBe('light');
    expect(result.current.colors).toBe(lightColors);
  });

  it('restores a saved choice on launch', async () => {
    storage.__store.set('rhemapod-theme-preference', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe('dark'));
    expect(result.current.scheme).toBe('dark');
  });

  it('ignores a corrupted saved value', async () => {
    storage.__store.set('rhemapod-theme-preference', 'sepia');
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(result.current.preference).toBe('system');
  });

  it('saves a new choice and applies it immediately', async () => {
    systemScheme = 'dark';
    const { result } = renderHook(() => useTheme(), { wrapper });
    await act(async () => {
      await result.current.setPreference('light');
    });
    expect(result.current.scheme).toBe('light');
    expect(storage.__store.get('rhemapod-theme-preference')).toBe('light');
  });

  it('reverts the choice when saving it fails', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      await expect(result.current.setPreference('dark')).rejects.toThrow('disk full');
    });
    expect(result.current.preference).toBe('system');
  });
});

describe('createThemedStyles', () => {
  const useStyles = createThemedStyles((c) => ({ box: { backgroundColor: c.surface.app } }));

  function Probe() {
    const styles = useStyles();
    return <Text testID="probe" style={styles.box} />;
  }

  it('builds the sheet from the active palette', async () => {
    const light = render(<Probe />, { wrapper });
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(light.getByTestId('probe').props.style).toEqual({ backgroundColor: lightColors.surface.app });

    const dark = render(<Probe />);
    expect(dark.getByTestId('probe').props.style).toEqual({ backgroundColor: darkColors.surface.app });
  });

  it('builds each scheme\'s sheet once and reuses it', () => {
    const { result: a } = renderHook(() => useStyles());
    const { result: b } = renderHook(() => useStyles());
    expect(a.current).toBe(b.current);
  });
});
