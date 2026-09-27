import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DownloadButton } from '../DownloadButton';
import { useDownloads } from '../../../../lib/downloads/useDownloads';
import type { DownloadRecord } from '../../../../lib/downloads/types';

jest.mock('../../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('@expo/vector-icons');

const mockedUseDownloads = useDownloads as jest.Mock;

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'sermon-1',
    title: 'A Great Sermon',
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

describe('DownloadButton', () => {
  it('renders nothing when the sermon has no audio rendition', () => {
    mockedUseDownloads.mockReturnValue(hook());
    const { toJSON } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio={false} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a Download control when nothing has been queued yet, and starts a download on press', () => {
    const download = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ download, find: jest.fn(() => undefined) }));
    const { getByText } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio />);

    fireEvent.press(getByText('Download for offline'));
    expect(download).toHaveBeenCalledWith('sermon-1', 'A Great Sermon');
  });

  it('shows a queued state', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'queued', progress: 0 })) }));
    const { getByText } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio />);
    expect(getByText('Queued for download')).toBeTruthy();
  });

  it('shows download progress while downloading', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'downloading', progress: 0.65 })) }));
    const { getByText } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio />);
    expect(getByText('Downloading… 65%')).toBeTruthy();
  });

  it('shows a Downloaded state with a working delete', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ remove, find: jest.fn(() => record({ state: 'ready' })) }));
    const { getByText, getByLabelText } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio />);

    expect(getByText('Downloaded for offline')).toBeTruthy();
    fireEvent.press(getByLabelText('Delete downloaded A Great Sermon'));
    expect(remove).toHaveBeenCalledWith('sermon-1');
  });

  it('shows the real failure reason with a working Retry', () => {
    const retry = jest.fn();
    mockedUseDownloads.mockReturnValue(
      hook({
        retry,
        find: jest.fn(() =>
          record({ state: 'failed', failureReason: 'no_audio', failureMessage: "This sermon doesn't have an audio version available to download." }),
        ),
      }),
    );
    const { getByText } = render(<DownloadButton sermonId="sermon-1" title="A Great Sermon" hasAudio />);

    expect(getByText("This sermon doesn't have an audio version available to download.")).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(retry).toHaveBeenCalledWith('sermon-1');
  });
});
