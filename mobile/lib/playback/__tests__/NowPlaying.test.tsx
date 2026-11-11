import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NowPlayingProvider, useNowPlaying, useSharedPlayer, type SharedPlayerInput } from '../NowPlaying';
import { MiniPlayer } from '../../../components/navigation/MiniPlayer';
import { api } from '../../api/typedClient';
import type { MockVideoPlayer } from '../../../__mocks__/expo-video';

jest.mock('expo-video');
jest.mock('@expo/vector-icons');
jest.mock('../../api/typedClient', () => ({ api: { post: jest.fn(() => Promise.resolve({})) } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

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

beforeEach(() => {
  mockPush.mockClear();
  (api.post as jest.Mock).mockClear();
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
