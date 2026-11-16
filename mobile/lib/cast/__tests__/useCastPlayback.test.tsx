import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { api } from '../../api/typedClient';

jest.mock('../../api/typedClient', () => ({ api: { get: jest.fn() } }));

const mockClient = { loadMedia: jest.fn(() => Promise.resolve()), getMediaStatus: jest.fn() };
let mockConnected: typeof mockClient | null = null;
const mockShowExpandedControls = jest.fn(() => Promise.resolve(true));

// A build with the Cast SDK linked; the real module needs native code Jest doesn't have.
jest.mock('../googleCast', () => ({
  googleCast: {
    useRemoteMediaClient: () => mockConnected,
    CastContext: { showExpandedControls: () => mockShowExpandedControls() },
  },
}));

// Required after the mocks so `useCastPlayback` picks the native implementation.
const { useCastPlayback } = require('../useCastPlayback') as typeof import('../useCastPlayback');

const mockedGet = api.get as jest.Mock;
const media = { sermonId: 'e2', title: 'Part 2', subtitle: 'Anchored', startTime: 600 };
const stream = {
  sermon_id: 'e2',
  expires_in: 21600,
  variants: [
    { type: 'audio', quality: null, url: 'https://cdn.example.com/e2/audio.mp3' },
    { type: 'video', quality: null, url: 'https://x.cloudflarestream.com/tok/manifest/video.m3u8' },
  ],
};

beforeEach(() => {
  mockConnected = null;
  mockClient.loadMedia.mockClear();
  mockClient.getMediaStatus.mockReset();
  mockShowExpandedControls.mockClear();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(stream);
});

describe('useCastPlayback', () => {
  it('is not connected and does nothing before a TV is picked', () => {
    const { result } = renderHook(() => useCastPlayback(media));
    expect(result.current.connected).toBe(false);
    act(() => result.current.play(media));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('puts the screen\'s pick on an idle TV as soon as one connects, from the resume point', async () => {
    mockClient.getMediaStatus.mockResolvedValue(null);
    const { rerender } = renderHook(() => useCastPlayback(media));
    mockConnected = mockClient;
    rerender({});

    await waitFor(() => expect(mockClient.loadMedia).toHaveBeenCalledTimes(1));
    expect(mockedGet).toHaveBeenCalledWith('/sermons/{sermon_id}/stream', { params: { path: { sermon_id: 'e2' } } });
    expect(mockClient.loadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: 600,
        mediaInfo: expect.objectContaining({ contentUrl: stream.variants[1].url, contentType: 'application/x-mpegurl' }),
      }),
    );
    await waitFor(() => expect(mockShowExpandedControls).toHaveBeenCalled());
  });

  it('leaves a TV that is already playing something alone', async () => {
    mockClient.getMediaStatus.mockResolvedValue({ playerState: 'playing' });
    mockConnected = mockClient;
    renderHook(() => useCastPlayback(media));

    await waitFor(() => expect(mockClient.getMediaStatus).toHaveBeenCalled());
    expect(mockClient.loadMedia).not.toHaveBeenCalled();
  });

  it('plays a chosen episode on the connected TV', async () => {
    mockClient.getMediaStatus.mockResolvedValue({ playerState: 'playing' });
    mockConnected = mockClient;
    const { result } = renderHook(() => useCastPlayback(null));
    expect(result.current.connected).toBe(true);

    act(() => result.current.play({ sermonId: 'e3', title: 'Part 3' }));
    await waitFor(() => expect(mockClient.loadMedia).toHaveBeenCalledTimes(1));
    expect(mockedGet).toHaveBeenCalledWith('/sermons/{sermon_id}/stream', { params: { path: { sermon_id: 'e3' } } });
  });

  it('tells the viewer when the TV could not be loaded', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockedGet.mockRejectedValue(new Error('403'));
    mockClient.getMediaStatus.mockResolvedValue(null);
    mockConnected = mockClient;
    renderHook(() => useCastPlayback(media));

    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't cast", expect.any(String)));
    expect(mockClient.loadMedia).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
