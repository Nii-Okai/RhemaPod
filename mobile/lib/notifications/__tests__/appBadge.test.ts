jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn(async () => true) }));
const mockNotifications = jest.requireMock('expo-notifications') as { setBadgeCountAsync: jest.Mock };

import { Platform } from 'react-native';
import { setAppIconBadge } from '../appBadge';

function onPlatform(os: 'ios' | 'android', run: () => Promise<void>) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
  return run().finally(() => Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true }));
}

beforeEach(() => jest.clearAllMocks());

describe('setAppIconBadge', () => {
  it('sets the iPhone icon number to the unread count', () =>
    onPlatform('ios', async () => {
      await setAppIconBadge(3);
      expect(mockNotifications.setBadgeCountAsync).toHaveBeenCalledWith(3);
    }));

  it('never sets a negative or fractional number', () =>
    onPlatform('ios', async () => {
      await setAppIconBadge(-2);
      await setAppIconBadge(2.7);
      expect(mockNotifications.setBadgeCountAsync.mock.calls).toEqual([[0], [2]]);
    }));

  it('leaves Android alone: its launcher counts notifications itself', () =>
    onPlatform('android', async () => {
      await setAppIconBadge(3);
      expect(mockNotifications.setBadgeCountAsync).not.toHaveBeenCalled();
    }));

  it('never throws when the badge cannot be set', () =>
    onPlatform('ios', async () => {
      mockNotifications.setBadgeCountAsync.mockRejectedValueOnce(new Error('no permission'));
      await expect(setAppIconBadge(1)).resolves.toBeUndefined();
    }));
});
