import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NowPlayingProvider, useNowPlaying, useSharedPlayer, type SharedPlayerInput } from '../NowPlaying';
import { MiniPlayer } from '../../../components/navigation/MiniPlayer';
import { StackMiniPlayer } from '../../../components/navigation/StackMiniPlayer';
import { api } from '../../api/typedClient';
import type { MockVideoPlayer } from '../../../__mocks__/expo-video';
import { addToQueue, queueStore, startQueue, type QueueItemInput } from '../queue';

jest.mock('expo-video');
jest.mock('@expo/vector-icons');
jest.mock('../../api/typedClient', () => ({ api: { post: jest.fn(() => Promise.resolve({})), get: jest.fn() } }));
jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
const mockPush = jest.fn();
let mockSegments: string[] = ['(tabs)'];
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useSegments: () => mockSegments }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const input = (sermonId: string, extra: Partial<SharedPlayerInput> = {}): SharedPlayerInput => ({
  sermonId,
  uri: `https://cdn.example/${sermonId}.m3u8?sig=${Math.random()}`,
  title: `Sermon ${sermonId}`,
  artist: 'Prophet',
  artworkUrl: null,
  mediaType: 'audio',
  ...extra,
});

let lastAcquired: { player: MockVideoPlayer; continued: boolean } | null = null;
function Screen({ sermon }: { sermon: SharedPlayerInput }) {
  const acquired = useSharedPlayer(sermon, (p) => {
    p.staysActiveInBackground = true;
  });
  lastAcquired = acquired as unknown as { player: MockVideoPlayer; continued: boolean };
  return <Text>screen {sermon.sermonId}</Text>;
}

let ctx: ReturnType<typeof useNowPlaying> = null;
function Probe() {
  ctx = useNowPlaying();
  return null;
}

// Mutations (the progress saves) get no garbage-collection timer, so Jest can exit.
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });

function App({ screen }: { screen: SharedPlayerInput | null }) {
  return (
    <QueryClientProvider client={client}>
      <NowPlayingProvider>
        <Probe />
        {screen ? <Screen key={screen.sermonId} sermon={screen} /> : null}
        <MiniPlayer />
      </NowPlayingProvider>
    </QueryClientProvider>
  );
}

const queueInput = (sermonId: string): QueueItemInput => ({
  sermonId,
  title: `Sermon ${sermonId}`,
  artist: 'Prophet',
  meta: null,
  category: null,
  artworkUrl: null,
  mediaType: 'audio',
  seriesId: null,
});

beforeEach(() => {
  mockPush.mockClear();
  (api.post as jest.Mock).mockClear();
  (api.get as jest.Mock).mockReset();
  (api.get as jest.Mock).mockImplementation((path: string, opts: { params: { path: { sermon_id: string } } }) => {
    if (path === '/sermons/{sermon_id}/stream') {
      const id = opts.params.path.sermon_id;
      return Promise.resolve({ sermon_id: id, expires_in: 60, variants: [{ type: 'audio', quality: 'aac', url: `https://cdn.example/${id}.m4a` }] });
    }
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(null);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  queueStore.reset();
  lastAcquired = null;
});

describe('NowPlayingProvider', () => {
  it('keeps the sermon playing in the mini player after the player screen closes', () => {
    const sermon = input('s1');
    const view = render(<App screen={sermon} />);
    const player = lastAcquired!.player;
    expect(lastAcquired!.continued).toBe(false);
    expect(player.staysActiveInBackground).toBe(true);
    act(() => player.play());
    // Full player open: no mini player.
    expect(view.queryByTestId('mini-player')).toBeNull();

    view.rerender(<App screen={null} />);
    expect(view.getByTestId('mini-player')).toBeTruthy();
    expect(view.getByText('Sermon s1')).toBeTruthy();
    expect(player.pause).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText('Pause'));
    expect(player.pause).toHaveBeenCalled();
    fireEvent.press(view.getByLabelText('Now playing: Sermon s1. Open the player.'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 's1' } });
  });

  it('picks up the same player when the same sermon reopens, even with a fresh stream URL', () => {
    const view = render(<App screen={input('s1')} />);
    const first = lastAcquired!.player;
    view.rerender(<App screen={null} />);
    view.rerender(<App screen={input('s1')} />);
    expect(lastAcquired!.player).toBe(first);
    expect(lastAcquired!.continued).toBe(true);
    expect(first.replace).not.toHaveBeenCalled();
  });

  it('switches the one player to a different sermon', () => {
    const view = render(<App screen={input('s1')} />);
    const first = lastAcquired!.player;
    view.rerender(<App screen={null} />);
    view.rerender(<App screen={input('s2')} />);
    expect(lastAcquired!.player).toBe(first);
    expect(lastAcquired!.continued).toBe(false);
    expect(first.replace).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ title: 'Sermon s2' }) }));
  });

  it('close stops the sermon and hides the mini player', () => {
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    act(() => player.play());
    view.rerender(<App screen={null} />);
    fireEvent.press(view.getByLabelText('Stop and close the player'));
    expect(player.pause).toHaveBeenCalled();
    expect(view.queryByTestId('mini-player')).toBeNull();
    expect(ctx?.session).toBeNull();
  });

  it('saves progress while only the mini player is showing', async () => {
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    act(() => player.play());
    view.rerender(<App screen={null} />);
    act(() => player.__simulateTimeUpdate(120));
    act(() => player.pause());
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/sermons/{sermon_id}/progress',
        expect.objectContaining({ params: { path: { sermon_id: 's1' } }, body: expect.objectContaining({ position_seconds: 120 }) }),
      ),
    );
  });
});

describe('NowPlayingProvider — the queue without the player screen', () => {
  it('moves on to the next queued sermon from the mini player, loading it itself', async () => {
    queueStore.set(startQueue(queueStore.get(), [queueInput('s1'), queueInput('s2')]));
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    act(() => player.play());
    view.rerender(<App screen={null} />);

    await act(async () => {
      player.__simulatePlayToEnd();
    });

    await waitFor(() =>
      expect(player.replace).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'https://cdn.example/s2.m4a', metadata: expect.objectContaining({ title: 'Sermon s2' }) }),
      ),
    );
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(await view.findByText('Sermon s2')).toBeTruthy();
    expect(queueStore.get().index).toBe(1);
  });

  it("shows Next on the mini player only while something is queued, and it plays that", async () => {
    queueStore.set(startQueue(queueStore.get(), [queueInput('s1')]));
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    view.rerender(<App screen={null} />);
    expect(view.queryByLabelText('Play next in queue')).toBeNull();

    act(() => queueStore.update((state) => addToQueue(state, queueInput('s3'))));
    fireEvent.press(view.getByLabelText('Play next in queue'));
    await waitFor(() => expect(player.replace).toHaveBeenCalledWith(expect.objectContaining({ uri: 'https://cdn.example/s3.m4a' })));
    expect(await view.findByText('Sermon s3')).toBeTruthy();
  });

  it('skips an item that cannot play rather than stalling', async () => {
    (api.get as jest.Mock).mockImplementation((path: string, opts: { params: { path: { sermon_id: string } } }) => {
      const id = opts.params.path.sermon_id;
      if (path === '/sermons/{sermon_id}/stream') {
        if (id === 's2') return Promise.reject(new Error('locked'));
        return Promise.resolve({ sermon_id: id, expires_in: 60, variants: [{ type: 'audio', quality: 'aac', url: `https://cdn.example/${id}.m4a` }] });
      }
      return Promise.resolve(null);
    });
    queueStore.set(startQueue(queueStore.get(), [queueInput('s1'), queueInput('s2'), queueInput('s3')]));
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    view.rerender(<App screen={null} />);

    await act(async () => {
      player.__simulatePlayToEnd();
    });
    await waitFor(() => expect(player.replace).toHaveBeenCalledWith(expect.objectContaining({ uri: 'https://cdn.example/s3.m4a' })));
    expect(queueStore.get().index).toBe(2);
  });

  it('resumes a queued sermon from where the listener left it', async () => {
    (api.get as jest.Mock).mockImplementation((path: string, opts: { params: { path: { sermon_id: string } } }) => {
      const id = opts.params.path.sermon_id;
      if (path === '/sermons/{sermon_id}/stream') {
        return Promise.resolve({ sermon_id: id, expires_in: 60, variants: [{ type: 'audio', quality: 'aac', url: `https://cdn.example/${id}.m4a` }] });
      }
      return Promise.resolve(id === 's2' ? { position_seconds: 300, completed: false } : null);
    });
    queueStore.set(startQueue(queueStore.get(), [queueInput('s1'), queueInput('s2')]));
    const view = render(<App screen={input('s1')} />);
    const player = lastAcquired!.player;
    view.rerender(<App screen={null} />);
    await act(async () => {
      player.__simulatePlayToEnd();
    });
    await waitFor(() => expect(player.replace).toHaveBeenCalled());
    act(() => player.__simulateReady(1800));
    expect(player.currentTime).toBe(300);
  });

  it('Play next with nothing playing starts it in the mini player', async () => {
    const view = render(<App screen={null} />);
    expect(view.queryByTestId('mini-player')).toBeNull();
    act(() => ctx!.enqueue(queueInput('s7'), 'next'));
    expect(await view.findByText('Sermon s7')).toBeTruthy();
    expect(queueStore.get().items.map((item) => item.sermonId)).toEqual(['s7']);
  });

  it('a long-press menu adds to the queue behind the playing sermon', async () => {
    queueStore.set(startQueue(queueStore.get(), [queueInput('s1'), queueInput('s2')]));
    const view = render(<App screen={input('s1')} />);
    act(() => ctx!.openQueueMenu(queueInput('s9')));
    fireEvent.press(view.getByLabelText('Add to queue'));
    expect(queueStore.get().items.map((item) => item.sermonId)).toEqual(['s1', 's9', 's2']);
    expect(view.queryByLabelText('Add to queue')).toBeNull();
  });

  it('the sleep timer carries on into the next sermon; closing the player clears it', () => {
    const view = render(<App screen={input('s1')} />);
    act(() => ctx!.sleepTimer.setMinutes(30));
    view.rerender(<App screen={null} />);
    view.rerender(<App screen={input('s2')} />);
    expect(ctx!.sleepTimer.remainingSeconds).not.toBeNull();
    view.rerender(<App screen={null} />);
    fireEvent.press(view.getByLabelText('Stop and close the player'));
    expect(ctx!.sleepTimer.remainingSeconds).toBeNull();
  });
});

describe('StackMiniPlayer (Nii, 2026-11-11: the mini player was missing on pushed screens)', () => {
  function Stacked({ screen }: { screen: SharedPlayerInput | null }) {
    return (
      <QueryClientProvider client={client}>
        <NowPlayingProvider>
          {screen ? <Screen key={screen.sermonId} sermon={screen} /> : null}
          <StackMiniPlayer />
        </NowPlayingProvider>
      </QueryClientProvider>
    );
  }

  it.each([['series'], ['sermon'], ['playlist'], ['speaker'], ['search'], ['notifications']])(
    'shows on a pushed %s screen',
    (first) => {
      mockSegments = [first, '[id]'];
      const view = render(<Stacked screen={input('s1')} />);
      view.rerender(<Stacked screen={null} />);
      expect(view.getByTestId('mini-player')).toBeTruthy();
    },
  );

  it.each([['(tabs)'], ['player'], ['devotional'], ['(auth)']])('stays out of the way on %s', (first) => {
    mockSegments = [first];
    const view = render(<Stacked screen={input('s1')} />);
    view.rerender(<Stacked screen={null} />);
    expect(view.queryByTestId('mini-player')).toBeNull();
  });
});
