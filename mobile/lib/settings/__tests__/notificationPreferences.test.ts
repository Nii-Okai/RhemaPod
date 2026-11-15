jest.mock('expo-sqlite/kv-store', () => ({ AsyncStorage: { getItem: jest.fn(), setItem: jest.fn() } }));

import { formatReminderTime, parseNotificationPreferences } from '../notificationPreferences';

describe('parseNotificationPreferences', () => {
  it('gives settings saved before times existed the old 07:00', () => {
    expect(parseNotificationPreferences(JSON.stringify({ newSermons: true, dailyRhema: true }))).toEqual({
      newSermons: true,
      dailyRhema: true,
      dailyRhemaTime: { hour: 7, minute: 0 },
    });
  });

  it('keeps a saved time', () => {
    const parsed = parseNotificationPreferences(JSON.stringify({ dailyRhema: true, dailyRhemaTime: { hour: 21, minute: 30 } }));
    expect(parsed.dailyRhemaTime).toEqual({ hour: 21, minute: 30 });
  });

  it.each([
    { hour: 24, minute: 0 },
    { hour: 7, minute: 60 },
    { hour: -1, minute: 0 },
    { hour: 7.5, minute: 0 },
    { hour: '7', minute: 0 },
    null,
  ])('falls back to 07:00 for a bad time %p', (dailyRhemaTime) => {
    expect(parseNotificationPreferences(JSON.stringify({ dailyRhemaTime })).dailyRhemaTime).toEqual({ hour: 7, minute: 0 });
  });

  it('survives junk', () => {
    expect(parseNotificationPreferences('{not json').dailyRhemaTime).toEqual({ hour: 7, minute: 0 });
    expect(parseNotificationPreferences(null).dailyRhemaTime).toEqual({ hour: 7, minute: 0 });
  });
});

describe('formatReminderTime', () => {
  it.each([
    [{ hour: 7, minute: 0 }, '7:00 AM'],
    [{ hour: 0, minute: 5 }, '12:05 AM'],
    [{ hour: 12, minute: 30 }, '12:30 PM'],
    [{ hour: 21, minute: 45 }, '9:45 PM'],
  ])('%p reads %s', (time, label) => {
    expect(formatReminderTime(time)).toBe(label);
  });
});
