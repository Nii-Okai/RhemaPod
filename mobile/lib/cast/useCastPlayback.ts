import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import type { RemoteMediaClient } from 'react-native-google-cast';
import { api } from '../api/typedClient';
import { selectPlaybackVariant } from '../query/hooks/useStream';
import { buildCastRequest, type CastMedia } from './castRequest';
import { googleCast } from './googleCast';

export interface CastPlayback {
  /** A TV is connected, so playing should go to it rather than the in-app player. */
  connected: boolean;
  /** Plays `media` on the connected TV and opens the Cast controls. */
  play: (media: CastMedia) => void;
}

/**
 * Loads one sermon on the receiver. A fresh `/stream` read every time, never the query
 * cache: the server re-checks access on each call, and the receiver needs a URL that
 * won't expire mid-sermon.
 */
export async function castSermon(client: RemoteMediaClient, media: CastMedia): Promise<void> {
  const stream = await api.get('/sermons/{sermon_id}/stream', { params: { path: { sermon_id: media.sermonId } } });
  const variant = selectPlaybackVariant(stream.variants);
  if (!variant) throw new Error('No playable media for this sermon yet.');
  await client.loadMedia(buildCastRequest(media, variant));
  await googleCast?.CastContext.showExpandedControls();
}

function reportFailure() {
  Alert.alert("Couldn't cast", 'Something went wrong sending this to your TV. Try again in a moment.');
}

/**
 * Casting for a screen that has something to play. `whenConnected` is what goes on the
 * TV the moment the viewer picks one from the cast button — the series page passes its
 * Resume/Play episode — unless the TV is already playing something, which is left alone.
 */
function useNativeCastPlayback(whenConnected: CastMedia | null): CastPlayback {
  const cast = googleCast as NonNullable<typeof googleCast>;
  const client = cast.useRemoteMediaClient();
  const pending = useRef(whenConnected);
  pending.current = whenConnected;

  // Runs each time a session appears: the viewer just picked a TV, or one was already
  // connected when the screen opened. Either way, an idle TV gets this screen's pick.
  useEffect(() => {
    if (!client || !pending.current) return;
    let cancelled = false;
    void client.getMediaStatus().then((status) => {
      if (cancelled || !pending.current) return;
      if (status && String(status.playerState) !== 'idle') return;
      castSermon(client, pending.current).catch(reportFailure);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const play = useCallback(
    (media: CastMedia) => {
      if (client) castSermon(client, media).catch(reportFailure);
    },
    [client],
  );

  return { connected: client !== null, play };
}

function useNoCast(): CastPlayback {
  return NO_CAST;
}

const NO_CAST: CastPlayback = { connected: false, play: () => {} };

/** `useNativeCastPlayback`, or a never-connected stand-in on builds without the Cast SDK. */
export const useCastPlayback: (whenConnected: CastMedia | null) => CastPlayback = googleCast
  ? useNativeCastPlayback
  : useNoCast;
