import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-sqlite/kv-store', () => {
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

jest.mock('../push', () => ({
  hasNotificationPermission: jest.fn(async () => true),
  requestNotificationPermission: jest.fn(async () => 'granted'),
  setDailyRhemaReminder: jest.fn(async () => undefined),
  syncPushRegistration: jest.fn(async () => undefined),
}));
const mockPush = jest.requireMock('../push') as Record<string, jest.Mock>;

import { useNotificationPreferences } from '../useNotificationPreferences';

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage.__reset();
});

describe('useNotificationPreferences', () => {
  it('starts with both off', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(mockPush.hasNotificationPermission).toHaveBeenCalled());
    expect(result.current.preferences).toEqual({ newSermons: false, dailyRhema: false });
  });

  it('turning new sermons on asks permission, saves and registers', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.setNewSermons(true);
    });
    expect(outcome).toBe('ok');
    expect(mockPush.requestNotificationPermission).toHaveBeenCalled();
    expect(mockPush.syncPushRegistration).toHaveBeenCalledWith({ newSermons: true, dailyRhema: false });
    expect(result.current.preferences.newSermons).toBe(true);
  });

  it('stays off when the listener declines the system prompt', async () => {
    mockPush.requestNotificationPermission.mockResolvedValueOnce('denied');
    const { result } = renderHook(() => useNotificationPreferences());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.setDailyRhema(true);
    });
    expect(outcome).toBe('denied');
    expect(mockPush.setDailyRhemaReminder).not.toHaveBeenCalled();
    expect(result.current.preferences.dailyRhema).toBe(false);
  });

  it('turning the reminder off does not ask permission', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    await act(async () => {
      await result.current.setDailyRhema(false);
    });
    expect(mockPush.requestNotificationPermission).not.toHaveBeenCalled();
    expect(mockPush.setDailyRhemaReminder).toHaveBeenCalledWith(false);
  });

  it('shows both off when the OS has notifications turned off, whatever was saved', async () => {
    const kv = jest.requireMock('expo-sqlite/kv-store').AsyncStorage;
    await kv.setItem('rhemapod-notification-preferences', JSON.stringify({ newSermons: true, dailyRhema: true }));
    mockPush.hasNotificationPermission.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(mockPush.hasNotificationPermission).toHaveBeenCalled());
    expect(result.current.preferences).toEqual({ newSermons: false, dailyRhema: false });
  });
});
