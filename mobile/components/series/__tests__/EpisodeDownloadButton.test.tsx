import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EpisodeDownloadButton } from '../EpisodeDownloadButton';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import type { DownloadRecord } from '../../../lib/downloads/types';

jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));
jest.mock('@expo/vector-icons');

const mockedUseDownloads = useDownloads as jest.Mock;

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    sermonId: 'e1',
    title: 'Part One',
    thumbnailUrl: null,
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

describe('EpisodeDownloadButton', () => {
  it('shows a download icon when nothing has been queued yet, and starts a download on press', () => {
    const download = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ download }));
    const { getByLabelText } = render(
      <EpisodeDownloadButton episodeId="e1" episodeTitle="Part One" mediaType="audio" />,
    );

    fireEvent.press(getByLabelText('Download Part One'));
    expect(download).toHaveBeenCalledWith('e1', 'Part One', 'audio', null, null);
  });

  it('shows a progress indicator while queued or downloading', () => {
    mockedUseDownloads.mockReturnValue(hook({ find: jest.fn(() => record({ state: 'queued' })) }));
    const { getByLabelText } = render(
      <EpisodeDownloadButton episodeId="e1" episodeTitle="Part One" mediaType="audio" />,
    );
    expect(getByLabelText('Part One queued for download')).toBeTruthy();
  });

  it('shows a delete control once downloaded', () => {
    const remove = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ remove, find: jest.fn(() => record({ state: 'ready' })) }));
    const { getByLabelText } = render(
      <EpisodeDownloadButton episodeId="e1" episodeTitle="Part One" mediaType="audio" />,
    );

    fireEvent.press(getByLabelText('Delete downloaded Part One'));
    expect(remove).toHaveBeenCalledWith('e1');
  });

  it('shows a retry control on failure', () => {
    const retry = jest.fn();
    mockedUseDownloads.mockReturnValue(hook({ retry, find: jest.fn(() => record({ state: 'failed' })) }));
    const { getByLabelText } = render(
      <EpisodeDownloadButton episodeId="e1" episodeTitle="Part One" mediaType="audio" />,
    );

    fireEvent.press(getByLabelText('Retry download of Part One'));
    expect(retry).toHaveBeenCalledWith('e1');
  });
});
