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
    waitingForWifi: false,
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

  it('says it is waiting for Wi-Fi when that is why it is queued', () => {
    mockedUseDownloads.mockReturnValue(
      hook({ waitingForWifi: true, find: jest.fn(() => record({ state: 'queued', progress: 0 })) }),
    );
    const { getByText } = render(<DownloadPillButton items={items} />);
    expect(getByText('Waiting for Wi-Fi')).toBeTruthy();
  });

  it('cancels a queued or in-progress download on press', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(
      hook({ remove, find: jest.fn(() => record({ state: 'downloading', progress: 0.3 })) }),
    );
    const { getByLabelText } = render(<DownloadPillButton items={items} />);
    fireEvent.press(getByLabelText('Downloading… 30%. Cancel download'));
    expect(remove).toHaveBeenCalledWith('e1');
  });

  it('on a series, cancelling leaves already-downloaded episodes alone', () => {
    const remove = jest.fn();
    const series = [
      { sermonId: 'e1', title: 'One', mediaType: 'audio' as const },
      { sermonId: 'e2', title: 'Two', mediaType: 'audio' as const },
      { sermonId: 'e3', title: 'Three', mediaType: 'audio' as const },
    ];
    const states: Record<string, DownloadRecord> = {
      e1: record({ sermonId: 'e1', state: 'ready' }),
      e2: record({ sermonId: 'e2', state: 'downloading', progress: 0.5 }),
      e3: record({ sermonId: 'e3', state: 'queued', progress: 0 }),
    };
    mockedUseDownloads.mockReturnValue(hook({ remove, find: jest.fn((id: string) => states[id]) }));
    const { getByRole } = render(<DownloadPillButton items={series} label="Download all episodes" />);

    fireEvent.press(getByRole('button'));
    expect(remove.mock.calls.map((c) => c[0])).toEqual(['e2', 'e3']);
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

  it('keeps the compact pill short while keeping the full accessibility labels', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'downloading', progress: 0.65 })) }));
    const { getByText, getByLabelText, rerender } = render(<DownloadPillButton items={items} compact />);
    expect(getByText('65%')).toBeTruthy();
    expect(getByLabelText('Downloading… 65%. Cancel download')).toBeTruthy();

    mockedUseDownloads.mockReturnValue(
      hook({ find: jest.fn(() => record({ state: 'failed', failureMessage: 'Download failed.' })) }),
    );
    rerender(<DownloadPillButton items={items} compact />);
    expect(getByText('Retry')).toBeTruthy();
    expect(getByLabelText('Retry download')).toBeTruthy();
  });
});
