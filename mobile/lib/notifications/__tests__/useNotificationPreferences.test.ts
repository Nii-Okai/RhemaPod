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
    expect(result.current.preferences).toEqual({
      newSermons: false,
      dailyRhema: false,
      dailyRhemaTime: { hour: 7, minute: 0 },
    });
  });

  it('turning new sermons on asks permission, saves and registers', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.setNewSermons(true);
    });
    expect(outcome).toBe('ok');
    expect(mockPush.requestNotificationPermission).toHaveBeenCalled();
    expect(mockPush.syncPushRegistration).toHaveBeenCalledWith({
      newSermons: true,
      dailyRhema: false,
      dailyRhemaTime: { hour: 7, minute: 0 },
    });
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
    expect(mockPush.setDailyRhemaReminder).toHaveBeenCalledWith(false, { hour: 7, minute: 0 });
  });

  it('shows both off when the OS has notifications turned off, but keeps the chosen time', async () => {
    const kv = jest.requireMock('expo-sqlite/kv-store').AsyncStorage;
    await kv.setItem(
      'rhemapod-notification-preferences',
      JSON.stringify({ newSermons: true, dailyRhema: true, dailyRhemaTime: { hour: 21, minute: 30 } }),
    );
    mockPush.hasNotificationPermission.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.preferences.dailyRhemaTime).toEqual({ hour: 21, minute: 30 }));
    expect(result.current.preferences).toEqual({
      newSermons: false,
      dailyRhema: false,
      dailyRhemaTime: { hour: 21, minute: 30 },
    });
  });

  it('turning the reminder on schedules it at the saved time', async () => {
    const kv = jest.requireMock('expo-sqlite/kv-store').AsyncStorage;
    await kv.setItem('rhemapod-notification-preferences', JSON.stringify({ dailyRhemaTime: { hour: 6, minute: 15 } }));
    const { result } = renderHook(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.preferences.dailyRhemaTime).toEqual({ hour: 6, minute: 15 }));
    await act(async () => {
      await result.current.setDailyRhema(true);
    });
    expect(mockPush.setDailyRhemaReminder).toHaveBeenCalledWith(true, { hour: 6, minute: 15 });
  });

  it('changing the time re-arms a reminder that is on, without asking permission', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    await act(async () => {
      await result.current.setDailyRhema(true);
    });
    jest.clearAllMocks();
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.setDailyRhemaTime({ hour: 20, minute: 45 });
    });
    expect(outcome).toBe('ok');
    expect(mockPush.requestNotificationPermission).not.toHaveBeenCalled();
    expect(mockPush.setDailyRhemaReminder).toHaveBeenCalledWith(true, { hour: 20, minute: 45 });
    expect(result.current.preferences.dailyRhemaTime).toEqual({ hour: 20, minute: 45 });
    const kv = jest.requireMock('expo-sqlite/kv-store').AsyncStorage;
    expect(JSON.parse(await kv.getItem('rhemapod-notification-preferences')).dailyRhemaTime).toEqual({
      hour: 20,
      minute: 45,
    });
  });

  it('changing the time while the reminder is off only saves it', async () => {
    const { result } = renderHook(() => useNotificationPreferences());
    await act(async () => {
      await result.current.setDailyRhemaTime({ hour: 8, minute: 0 });
    });
    expect(mockPush.setDailyRhemaReminder).not.toHaveBeenCalled();
    expect(result.current.preferences.dailyRhemaTime).toEqual({ hour: 8, minute: 0 });
  });
});
