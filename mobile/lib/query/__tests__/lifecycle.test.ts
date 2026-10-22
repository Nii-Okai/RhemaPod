import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { installQueryLifecycle } from '../lifecycle';

jest.mock('expo-network', () => ({
  __esModule: true,
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

it('feeds expo-network connectivity and AppState focus into TanStack Query', async () => {
  let appStateListener: ((status: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, cb: (status: string) => void) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);

  installQueryLifecycle();
  const networkListener = (Network.addNetworkStateListener as jest.Mock).mock.calls[0][0];

  networkListener({ isConnected: true, isInternetReachable: false });
  expect(onlineManager.isOnline()).toBe(false);
  networkListener({ isConnected: true, isInternetReachable: true });
  expect(onlineManager.isOnline()).toBe(true);

  appStateListener?.('background');
  expect(focusManager.isFocused()).toBe(false);
  appStateListener?.('active');
  expect(focusManager.isFocused()).toBe(true);
});
