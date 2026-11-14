jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
}));
const mockNotifications = jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'proj-1' } } } }));

const mockPut = jest.fn<Promise<unknown>, unknown[]>(async () => ({}));
const mockPost = jest.fn<Promise<unknown>, unknown[]>(async () => undefined);
jest.mock('../../api/typedClient', () => ({
  api: { put: (...a: unknown[]) => mockPut(...a), post: (...a: unknown[]) => mockPost(...a) },
}));

import {
  DAILY_RHEMA_REMINDER_ID,
  requestNotificationPermission,
  resetPushStateForTests,
  setDailyRhemaReminder,
  syncPushRegistration,
  teardownNotificationsForSignOut,
} from '../push';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop]';

beforeEach(() => {
  jest.clearAllMocks();
  resetPushStateForTests();
  mockNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
});

describe('requestNotificationPermission', () => {
  it('does not prompt when already granted', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports denied without prompting when the OS will not ask again', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts once and passes on the answer', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
  });
});

describe('syncPushRegistration', () => {
  it('registers the Expo token with the new-sermons choice', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    await syncPushRegistration({ newSermons: true, dailyRhema: false });
    expect(mockNotifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(mockPut).toHaveBeenCalledWith('/me/push-devices', {
      body: { token: TOKEN, platform: expect.any(String), new_sermons: true },
    });
  });

  it('does nothing without permission', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    await syncPushRegistration({ newSermons: true, dailyRhema: false });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('never throws when the API is unreachable', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    mockPut.mockRejectedValueOnce(new Error('offline'));
    await expect(syncPushRegistration({ newSermons: false, dailyRhema: false })).resolves.toBeUndefined();
  });
});

describe('daily reminder', () => {
  it('schedules one daily reminder at 07:00 and replaces any earlier one', async () => {
    await setDailyRhemaReminder(true);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(DAILY_RHEMA_REMINDER_ID);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: DAILY_RHEMA_REMINDER_ID,
        content: expect.objectContaining({ data: { kind: 'daily_rhema' } }),
        trigger: expect.objectContaining({ type: 'daily', hour: 7, minute: 0 }),
      }),
    );
  });

  it('turning it off only cancels', async () => {
    await setDailyRhemaReminder(false);
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('teardownNotificationsForSignOut', () => {
  it('cancels the reminder and unregisters the token it registered', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    await syncPushRegistration({ newSermons: true, dailyRhema: false });
    await teardownNotificationsForSignOut();
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(DAILY_RHEMA_REMINDER_ID);
    expect(mockPost).toHaveBeenCalledWith('/me/push-devices/remove', { body: { token: TOKEN } });
  });

  it('gives up after a few seconds rather than holding up sign-out', async () => {
    jest.useFakeTimers();
    try {
      mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
      await syncPushRegistration({ newSermons: true, dailyRhema: false });
      mockPost.mockImplementationOnce(() => new Promise(() => undefined));
      const done = teardownNotificationsForSignOut();
      await jest.advanceTimersByTimeAsync(3000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
