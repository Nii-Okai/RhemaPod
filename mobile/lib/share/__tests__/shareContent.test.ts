import * as FileSystem from 'expo-file-system';
import RNShare from 'react-native-share';
import { shareContent } from '../shareContent';

jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn(async () => undefined),
}));

const mockedOpen = RNShare.open as jest.Mock;
const mockedDownload = FileSystem.downloadAsync as jest.Mock;
const mockedDelete = FileSystem.deleteAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedOpen.mockResolvedValue(undefined);
});

describe('shareContent', () => {
  it('composes title, description, and the rhemapod:// deep link, and downloads the thumbnail for attachment', async () => {
    mockedDownload.mockResolvedValue({ status: 200, uri: 'file:///cache/share-123.jpg' });

    await shareContent({
      title: 'Anchored in the Storm',
      description: 'A word for the weary.',
      thumbnailUrl: 'https://cdn.example.com/art.jpg',
      deepLinkPath: 'sermon/sermon-1',
    });

    expect(mockedDownload).toHaveBeenCalledWith('https://cdn.example.com/art.jpg', expect.stringContaining('file:///cache/share-'));
    expect(mockedOpen).toHaveBeenCalledWith({
      title: 'Anchored in the Storm',
      message: 'Anchored in the Storm\n\nA word for the weary.\n\nrhemapod://sermon/sermon-1',
      url: 'file:///cache/share-123.jpg',
      failOnCancel: false,
    });
    // Best-effort cleanup of the temp download after the share sheet closes.
    expect(mockedDelete).toHaveBeenCalledWith('file:///cache/share-123.jpg', { idempotent: true });
  });

  it('shares text-only (no url) when there is no thumbnail at all', async () => {
    await shareContent({
      title: 'A Sermon',
      description: null,
      thumbnailUrl: null,
      deepLinkPath: 'sermon/sermon-2',
    });

    expect(mockedDownload).not.toHaveBeenCalled();
    expect(mockedOpen).toHaveBeenCalledWith({
      title: 'A Sermon',
      message: 'A Sermon\n\nrhemapod://sermon/sermon-2',
      url: undefined,
      failOnCancel: false,
    });
  });

  it('falls back to text-only when the thumbnail fails to download, rather than failing the whole share', async () => {
    mockedDownload.mockRejectedValue(new Error('network error'));

    await shareContent({
      title: 'A Sermon',
      thumbnailUrl: 'https://cdn.example.com/missing.jpg',
      deepLinkPath: 'sermon/sermon-3',
    });

    expect(mockedOpen).toHaveBeenCalledWith(expect.objectContaining({ url: undefined }));
  });

  it('falls back to text-only when the download does not return a 200', async () => {
    mockedDownload.mockResolvedValue({ status: 404, uri: 'file:///cache/share-404.jpg' });

    await shareContent({ title: 'A Sermon', thumbnailUrl: 'https://cdn.example.com/x.jpg', deepLinkPath: 'sermon/sermon-4' });

    expect(mockedOpen).toHaveBeenCalledWith(expect.objectContaining({ url: undefined }));
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('truncates a long description rather than shoving the whole thing into the share text', async () => {
    const longDescription = 'x'.repeat(400);
    await shareContent({ title: 'A Sermon', description: longDescription, deepLinkPath: 'sermon/sermon-5' });

    const message = mockedOpen.mock.calls[0][0].message as string;
    const descriptionLine = message.split('\n\n')[1]!;
    expect(descriptionLine.length).toBeLessThan(longDescription.length);
    expect(descriptionLine.endsWith('…')).toBe(true);
  });
});
