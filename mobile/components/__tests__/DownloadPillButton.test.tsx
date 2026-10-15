import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DownloadPillButton } from '../DownloadPillButton';
import { useDownloads } from '../../lib/downloads/useDownloads';
import type { DownloadRecord } from '../../lib/downloads/types';

jest.mock('../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('@expo/vector-icons');

const mockedUseDownloads = useDownloads as jest.Mock;

const items = [{ sermonId: 'e1', title: 'Part One', mediaType: 'audio' as const }];

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'e1',
    title: 'Part One',
    thumbnailUrl: null,
    thumbnailPath: null,
    category: null,
    mediaType: 'audio',
    state: 'ready',
    progress: 1,
    bytesTotal: 1000,
    failureReason: null,
    failureMessage: null,
    keyIdHex: '00',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function hook(overrides: Partial<ReturnType<typeof useDownloads>> = {}) {
  return {
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(() => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DownloadPillButton', () => {
  it('shows a Download pill when nothing has been queued yet, and starts a download on press', () => {
    const download = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ download }));
    const { getByText } = render(<DownloadPillButton items={items} />);

    fireEvent.press(getByText('Download'));
    expect(download).toHaveBeenCalledWith('e1', 'Part One', 'audio', undefined, undefined);
  });

  it('shows a queued state', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'queued', progress: 0 })) }));
    const { getByText } = render(<DownloadPillButton items={items} />);
    expect(getByText('Queued…')).toBeTruthy();
  });

  it('shows download progress while downloading', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'downloading', progress: 0.65 })) }));
    const { getByText } = render(<DownloadPillButton items={items} />);
    expect(getByText('Downloading… 65%')).toBeTruthy();
  });

  it('shows a Downloaded state with a working delete', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ remove, find: jest.fn(() => record({ state: 'ready' })) }));
    const { getByText, getByLabelText } = render(<DownloadPillButton items={items} />);

    expect(getByText('Downloaded')).toBeTruthy();
    fireEvent.press(getByLabelText('Delete downloaded Part One'));
    expect(remove).toHaveBeenCalledWith('e1');
  });

  it('shows the real failure reason with a working retry', () => {
    const retry = jest.fn();
    mockedUseDownloads.mockReturnValue(
      hook({
        retry,
        find: jest.fn(() => record({ state: 'failed', failureMessage: 'Download failed.' })),
      }),
    );
    const { getByText, getByLabelText } = render(<DownloadPillButton items={items} />);

    expect(getByText('Download failed.')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry download'));
    expect(retry).toHaveBeenCalledWith('e1');
  });
});
