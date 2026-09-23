import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckCard, LogLine } from '../components/CheckCard';
import { classifyStreamUrl, getStream, SpikeApiError, StreamVariant } from '../lib/api';

/**
 * Items 1 and 4 share one player instance — lock-screen/notification
 * controls (item 4) are a property of the *same* playback session item 1
 * exercises, not a separate flow. Splitting them into two components would
 * mean either two players (wasteful, and no longer "the same session Isaac
 * locks the screen on") or prop-drilling one player between siblings for no
 * real benefit, so this file renders both `CheckCard`s from one component.
 */
export function StreamCheck() {
  const [variants, setVariants] = useState<StreamVariant[]>([]);
  const [selected, setSelected] = useState<StreamVariant | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const player = useVideoPlayer(null, (p) => {
    // Configures the two properties item 4 depends on. `supportsBackgroundPlayback: true`
    // on the expo-video config plugin (app.json) is the other half — it adds
    // `UIBackgroundModes: ["audio"]` on iOS and the foreground
    // MediaSessionService on Android; these two player properties are what
    // actually turns background audio + lock-screen controls on at runtime.
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
  });

  const playing = useEvent(player, 'playingChange', { isPlaying: player.playing })?.isPlaying;
  const status = useEvent(player, 'statusChange', { status: player.status })?.status;

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 20));
  }, []);

  const fetchAndLoad = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await getStream();
      setVariants(res.variants);
      appendLog(`GET /sermons/{id}/stream -> ${res.variants.length} variant(s)`);
      const first = res.variants[0] ?? null;
      if (first) {
        setSelected(first);
        await player.replaceAsync({ uri: first.url });
        appendLog(`Loaded ${classifyStreamUrl(first.url)} variant (${first.type}/${first.quality ?? 'n/a'})`);
      }
    } catch (err) {
      const message = err instanceof SpikeApiError ? err.message : String(err);
      setFetchError(message);
      appendLog(`ERROR: ${message}`);
    } finally {
      setFetching(false);
    }
  }, [appendLog, player]);

  const loadVariant = useCallback(
    async (variant: StreamVariant) => {
      setSelected(variant);
      await player.replaceAsync({ uri: variant.url });
      appendLog(`Loaded ${classifyStreamUrl(variant.url)} variant (${variant.type}/${variant.quality ?? 'n/a'})`);
    },
    [appendLog, player],
  );

  const seekForward = useCallback(() => {
    player.currentTime = player.currentTime + 10;
    appendLog(`Seek -> ${player.currentTime.toFixed(1)}s`);
  }, [appendLog, player]);

  const playbackStatus = fetchError
    ? 'fail'
    : selected && playing
      ? 'pass'
      : selected
        ? 'running'
        : 'idle';

  return (
    <>
      <CheckCard itemNumber="1" title="expo-video plays the backend's stream URL" status={playbackStatus}>
        <Pressable style={styles.button} onPress={fetchAndLoad} disabled={fetching}>
          <Text style={styles.buttonText}>{fetching ? 'Fetching…' : 'Fetch GET /sermons/{id}/stream'}</Text>
        </Pressable>
        {fetchError && <LogLine>ERROR: {fetchError}</LogLine>}
        {variants.length > 0 && (
          <View style={styles.variantList}>
            {variants.map((v, i) => (
              <Pressable
                key={`${v.type}-${v.quality}-${i}`}
                style={[styles.variantChip, selected === v && styles.variantChipSelected]}
                onPress={() => loadVariant(v)}
              >
                <Text style={styles.variantChipText}>
                  {v.type}/{v.quality ?? 'n/a'} — {classifyStreamUrl(v.url) === 'cloudflare-stream' ? 'STREAM (real HLS)' : 'S3 FALLBACK'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {selected && (
          <>
            <Text style={styles.urlKindBanner}>
              Currently loaded: {classifyStreamUrl(selected.url) === 'cloudflare-stream'
                ? 'CLOUDFLARE STREAM (genuine signed HLS)'
                : 'S3 PRESIGNED FALLBACK (signing key not set, or Stream ingest not done — expected per the dispatch until CF_STREAM_SIGNING_KEY_ID/_PEM are set)'}
            </Text>
            <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => player.play()}>
                <Text style={styles.buttonText}>Play</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => player.pause()}>
                <Text style={styles.buttonText}>Pause</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={seekForward}>
                <Text style={styles.buttonText}>Seek +10s</Text>
              </Pressable>
            </View>
            <LogLine>player.status: {status ?? 'unknown'} · playing: {String(playing)}</LogLine>
          </>
        )}
        <View style={styles.logBox}>
          {log.map((l, i) => (
            <LogLine key={i}>{l}</LogLine>
          ))}
        </View>
      </CheckCard>

      <CheckCard itemNumber="4" title="Lock-screen / notification transport controls" status={selected ? 'running' : 'idle'}>
        <LogLine>player.staysActiveInBackground = {String(player.staysActiveInBackground)}</LogLine>
        <LogLine>player.showNowPlayingNotification = {String(player.showNowPlayingNotification)}</LogLine>
        <LogLine>app.json expo-video plugin: supportsBackgroundPlayback = true (see app.json)</LogLine>
        <Text style={styles.manualNote}>
          Config above is a static confirmation only — this item cannot be asserted from JS.
          After tapping Play above: (1) lock the device / switch apps and confirm audio keeps
          playing, (2) open Control Center (iOS) or the notification shade (Android) and confirm
          play/pause/seek controls appear and work there. Record pass/fail in status.md per the
          README checklist — a simulator run for this item is explicitly lower-confidence than
          real hardware per the plan's 2026-09-22 amendment.
        </Text>
      </CheckCard>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#1F4276',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  variantList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  variantChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  variantChipSelected: { borderColor: '#1F4276', backgroundColor: '#eef2ff' },
  variantChipText: { fontSize: 12 },
  urlKindBanner: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#1F4276',
  },
  video: { width: '100%', height: 200, marginTop: 8, backgroundColor: '#000' },
  logBox: { marginTop: 8, gap: 2 },
  manualNote: { fontSize: 12, color: '#374151', marginTop: 6, lineHeight: 18 },
});
