import * as Network from 'expo-network';
import { canStartDownload, isOnWifi } from '../network';

jest.mock('expo-network', () => ({
  __esModule: true,
  NetworkStateType: { UNKNOWN: 'UNKNOWN', NONE: 'NONE', WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
  getNetworkStateAsync: jest.fn(),
}));

const mockedGetNetworkState = Network.getNetworkStateAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isOnWifi', () => {
  it('is true only for WIFI + isConnected', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.WIFI, isConnected: true });
    await expect(isOnWifi()).resolves.toBe(true);
  });

  it('is false on cellular even if connected', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.CELLULAR, isConnected: true });
    await expect(isOnWifi()).resolves.toBe(false);
  });

  it('is false when Wi-Fi type is reported but isConnected is false', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.WIFI, isConnected: false });
    await expect(isOnWifi()).resolves.toBe(false);
  });

  it('treats NONE/UNKNOWN as not-Wi-Fi (never spends cellular data on an ambiguous read)', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.UNKNOWN, isConnected: undefined });
    await expect(isOnWifi()).resolves.toBe(false);
  });
});

describe('canStartDownload', () => {
  it('always allows starting when Wi-Fi-only is disabled, regardless of network type', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.CELLULAR, isConnected: true });
    await expect(canStartDownload(false)).resolves.toBe(true);
    expect(mockedGetNetworkState).not.toHaveBeenCalled();
  });

  it('defers to isOnWifi when Wi-Fi-only is enabled', async () => {
    mockedGetNetworkState.mockResolvedValueOnce({ type: Network.NetworkStateType.CELLULAR, isConnected: true });
    await expect(canStartDownload(true)).resolves.toBe(false);
  });
});
