import React from 'react';
import { Linking, Platform, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { ApiError, networkError } from '../../../lib/api/errors';
import { QueryState } from '../../QueryState';
import { SectionError } from '../../SectionError';
import { DetailError } from '../../DetailError';
import { OfflineBanner } from '../OfflineBanner';
import { OfflineShelf } from '../OfflineShelf';
import { OfflineState } from '../OfflineState';
import { openConnectionSettings } from '../connectionSettings';
import { useIsOnline } from '../../../lib/hooks/useIsOnline';

jest.mock('@expo/vector-icons');
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../../lib/hooks/useIsOnline', () => ({ useIsOnline: jest.fn(() => true) }));
const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
}));

const mockedOnline = useIsOnline as jest.Mock;
const mockedNetworkState = Network.getNetworkStateAsync as jest.Mock;

function withClient(ui: React.ReactElement, client = new QueryClient()) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockNavigate.mockClear();
  mockedOnline.mockReturnValue(true);
  mockedNetworkState.mockReset();
});

describe('offline placeholders', () => {
  it('QueryState shows the offline card for a connection failure and opens the offline page', () => {
    const screen = render(
      <QueryState isLoading={false} isError error={networkError()} isEmpty={false} emptyTitle="x" loadingLabel="l">
        <Text>content</Text>
      </QueryState>,
    );
    expect(screen.queryByText(/Could not reach the server/)).toBeNull();
    expect(screen.getByText('You’re offline')).toBeTruthy();
    fireEvent.press(screen.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith('/offline');
  });

  it('QueryState keeps the red banner for a server error', () => {
    const screen = render(
      <QueryState isLoading={false} isError error={new ApiError(500, 'Boom.')} isEmpty={false} emptyTitle="x" loadingLabel="l">
        <Text>content</Text>
      </QueryState>,
    );
    expect(screen.getByText('Boom.')).toBeTruthy();
    expect(screen.queryByText('You’re offline')).toBeNull();
  });

  it('SectionError swaps to the offline card only for a connection failure', () => {
    const offline = render(<SectionError message="m" onRetry={jest.fn()} error={networkError()} />);
    expect(offline.getByText('You’re offline')).toBeTruthy();
    const server = render(<SectionError message="Server said no." onRetry={jest.fn()} error={new ApiError(500, 'x')} />);
    expect(server.getByText('Server said no.')).toBeTruthy();
  });

  it('OfflineShelf is one button that opens the offline page', () => {
    const screen = render(<OfflineShelf title="Keep listening" cardWidth={220} aspectRatio={16 / 9} />);
    fireEvent.press(screen.getByLabelText(/Keep listening: you.re offline/));
    expect(mockPush).toHaveBeenCalledWith('/offline');
  });

  it('OfflineBanner shows only while offline', () => {
    const online = render(<OfflineBanner />);
    expect(online.queryByText('You’re offline')).toBeNull();
    mockedOnline.mockReturnValue(false);
    const offline = render(<OfflineBanner />);
    fireEvent.press(offline.getByText('You’re offline'));
    expect(mockPush).toHaveBeenCalledWith('/offline');
  });
});

describe('OfflineState', () => {
  it('Open Settings opens the phone settings', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const screen = render(withClient(<OfflineState />));
    fireEvent.press(screen.getByText('Open Settings'));
    await waitFor(() => expect(openSettings).toHaveBeenCalled());
  });

  it('Try again reports when still offline', async () => {
    mockedNetworkState.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const onReconnected = jest.fn();
    const screen = render(withClient(<OfflineState onReconnected={onReconnected} />));
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(screen.getByText(/Still offline/)).toBeTruthy();
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it('Try again refetches and reports reconnecting once back online', async () => {
    mockedNetworkState.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const onReconnected = jest.fn();
    const screen = render(withClient(<OfflineState onReconnected={onReconnected} />, client));
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(invalidate).toHaveBeenCalled();
    expect(onReconnected).toHaveBeenCalled();
  });

  it('the downloads card goes to Library', () => {
    const screen = render(withClient(<OfflineState />));
    fireEvent.press(screen.getByText('Your downloads still play'));
    expect(mockNavigate).toHaveBeenCalledWith('/library');
  });

  it('DetailError shows the offline state for a connection failure', () => {
    const screen = render(withClient(<DetailError onRetry={jest.fn()} error={networkError()} />));
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });
});

describe('openConnectionSettings', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
  });

  it('opens Android network settings, falling back to the app page', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockRejectedValueOnce(new Error('blocked'));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await openConnectionSettings();
    expect(sendIntent).toHaveBeenCalledWith('android.settings.WIRELESS_SETTINGS');
    expect(openSettings).toHaveBeenCalled();
  });

  it('opens the app settings page on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    const sendIntent = jest.spyOn(Linking, 'sendIntent');
    sendIntent.mockClear();
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await openConnectionSettings();
    expect(sendIntent).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalled();
  });
});
