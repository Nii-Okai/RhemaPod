import { AppState } from 'react-native';
import { renderHook } from '@testing-library/react-native';

jest.mock('expo-updates', () => ({
  __esModule: true,
  isEnabled: true,
  updateId: 'abc-123',
  channel: 'production',
  runtimeVersion: '0.0.1',
  isEmbeddedLaunch: false,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
}));

import {
  FOREGROUND_CHECK_INTERVAL_MS,
  fetchPendingUpdate,
  updateContext,
  useFetchUpdatesOnForeground,
} from '../otaUpdates';

type MockUpdates = {
  isEnabled: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  isEmbeddedLaunch: boolean;
  checkForUpdateAsync: jest.Mock;
  fetchUpdateAsync: jest.Mock;
};
const mockUpdates = jest.requireMock('expo-updates') as MockUpdates;

const g = globalThis as unknown as { __DEV__: boolean };

beforeEach(() => {
  g.__DEV__ = false;
  mockUpdates.isEnabled = true;
  mockUpdates.checkForUpdateAsync.mockReset().mockResolvedValue({ isAvailable: true });
  mockUpdates.fetchUpdateAsync.mockReset().mockResolvedValue({ isNew: true });
});

afterAll(() => {
  g.__DEV__ = true;
});

describe('updateContext', () => {
  it('names the running update', () => {
    expect(updateContext()).toEqual({
      'update.id': 'abc-123',
      'update.channel': 'production',
      'update.runtime_version': '0.0.1',
      'update.embedded': 'false',
    });
  });

  it('says embedded when no update has been downloaded', () => {
    mockUpdates.updateId = null;
    mockUpdates.channel = null;
    expect(updateContext()['update.id']).toBe('embedded');
    expect(updateContext()['update.channel']).toBe('none');
    mockUpdates.updateId = 'abc-123';
    mockUpdates.channel = 'production';
  });
});

describe('fetchPendingUpdate', () => {
  it('downloads an available update', async () => {
    await expect(fetchPendingUpdate()).resolves.toBe(true);
    expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('does not download when nothing is available', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(fetchPendingUpdate()).resolves.toBe(false);
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('never throws when offline', async () => {
    mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error('offline'));
    await expect(fetchPendingUpdate()).resolves.toBe(false);
  });

  it('does nothing in development or when updates are off', async () => {
    g.__DEV__ = true;
    await expect(fetchPendingUpdate()).resolves.toBe(false);
    g.__DEV__ = false;
    mockUpdates.isEnabled = false;
    await expect(fetchPendingUpdate()).resolves.toBe(false);
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});

describe('useFetchUpdatesOnForeground', () => {
  it('checks on foreground at most once per interval', () => {
    let listener: (state: string) => void = () => undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      listener = cb as (state: string) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    let time = 0;
    const { unmount } = renderHook(() => useFetchUpdatesOnForeground(() => time));

    time = FOREGROUND_CHECK_INTERVAL_MS - 1;
    listener('active');
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();

    time = FOREGROUND_CHECK_INTERVAL_MS;
    listener('background');
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
    listener('active');
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

    listener('active');
    expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
