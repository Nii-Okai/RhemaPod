import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as RN from 'react-native';
import { AsyncStorage } from 'expo-sqlite/kv-store';
import { AppearanceSection } from '../AppearanceSection';
import { ThemeProvider, useTheme } from '../../../../theme/ThemeContext';

jest.mock('@expo/vector-icons');
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

const storage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock; __store: Map<string, string> };

let shownScheme = '';
function SchemeProbe() {
  shownScheme = useTheme().scheme;
  return null;
}

function Harness() {
  const [error, setError] = React.useState<string | null>(null);
  return (
    <ThemeProvider lightModeAvailable>
      <AppearanceSection error={error} onError={setError} />
      <SchemeProbe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  storage.__store.clear();
  storage.setItem.mockClear();
  jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
});
afterEach(() => jest.restoreAllMocks());

describe('AppearanceSection', () => {
  it('marks System default as the current choice on first launch', async () => {
    const { getByRole } = render(<Harness />);
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    expect(getByRole('radio', { name: 'System default' }).props.accessibilityState).toEqual({ checked: true });
    expect(getByRole('radio', { name: 'Light' }).props.accessibilityState).toEqual({ checked: false });
    expect(shownScheme).toBe('dark');
  });

  it('applies and saves a new choice', async () => {
    const { getByRole } = render(<Harness />);
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Light' }));
    });
    expect(getByRole('radio', { name: 'Light' }).props.accessibilityState).toEqual({ checked: true });
    expect(shownScheme).toBe('light');
    expect(storage.__store.get('rhemapod-theme-preference')).toBe('light');
  });

  it('reverts and explains when the choice can\'t be saved', async () => {
    const { getByRole, findByText } = render(<Harness />);
    await waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: 'Light' }));
    });
    expect(await findByText("Couldn't save your appearance setting. Try again.")).toBeTruthy();
    expect(getByRole('radio', { name: 'System default' }).props.accessibilityState).toEqual({ checked: true });
    expect(shownScheme).toBe('dark');
  });
});
