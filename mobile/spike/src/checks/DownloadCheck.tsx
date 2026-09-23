import { DownloadPauseState, DownloadTask, File, Paths } from 'expo-file-system';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckCard, LogLine } from '../components/CheckCard';
import { getAudioDownload, SpikeApiError } from '../lib/api';
import { formatBytes, formatPercent } from '../lib/format';

const DEST_FILENAME = 'spike-download-test.audio';

type Phase = 'idle' | 'fetching-url' | 'downloading' | 'paused' | 'done' | 'error';

/**
 * Item 2: proves the audio-download endpoint's shape is actually fetchable
 * end to end by `expo-file-system`, and that a paused/interrupted download
 * can resume rather than restart from zero. `DownloadTask.savable()` /
 * `DownloadTask.fromSavable()` (expo-file-system's SDK-57 resumable API,
 * replacing the older `createDownloadResumable`) is the mechanism the real
 * offline-downloads feature (W4.5) would need for "app killed mid-download"
 * — this spike exercises the same pair, not a simplified stand-in.
 */
export function DownloadCheck() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const taskRef = useRef<DownloadTask | null>(null);
  const savedStateRef = useRef<DownloadPauseState | null>(null);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 20));
  }, []);

  const onProgress = useCallback(
    ({ bytesWritten: written, totalBytes: total }: { bytesWritten: number; totalBytes: number }) => {
      setBytesWritten(written);
      setTotalBytes(total);
      if (total > 0) setProgress(written / total);
    },
    [],
  );

  const start = useCallback(async () => {
    setError(null);
    setPhase('fetching-url');
    setProgress(0);
    setBytesWritten(0);
    setTotalBytes(0);
    try {
      const { url } = await getAudioDownload();
      appendLog(`GET /sermons/{id}/download/audio -> signed URL received`);

      const dest = new File(Paths.cache, DEST_FILENAME);
      if (dest.exists) dest.delete();

      const task = new DownloadTask(url, dest, { onProgress });
      taskRef.current = task;
      setPhase('downloading');
      appendLog('Download started (backgrounded on iOS by default — sessionType: "background")');

      const file = await task.downloadAsync();
      if (file) {
        setPhase('done');
        appendLog(`Download complete: ${file.uri} (${formatBytes(file.size ?? 0)})`);
      } else {
        // downloadAsync() resolves with null when pause() was requested
        // before completion — not a failure, see pause() below.
        setPhase('paused');
        appendLog('Download paused before completion');
      }
    } catch (err) {
      setPhase('error');
      const message = err instanceof SpikeApiError ? err.message : String(err);
      setError(message);
      appendLog(`ERROR: ${message}`);
    }
  }, [appendLog, onProgress]);

  const pauseAndSave = useCallback(async () => {
    const task = taskRef.current;
    if (!task) return;
    await task.pauseAsync();
    savedStateRef.current = task.savable();
    setPhase('paused');
    appendLog('Paused — resume data captured via task.savable() (simulates a network drop / app kill mid-download)');
  }, [appendLog]);

  const resumeFromSaved = useCallback(async () => {
    const saved = savedStateRef.current;
    if (!saved) {
      appendLog('No saved resume state yet — pause a download first');
      return;
    }
    setPhase('downloading');
    appendLog('Resuming from DownloadTask.fromSavable(...) — a fresh task instance, not the original object');
    try {
      const task = DownloadTask.fromSavable(saved, { onProgress });
      taskRef.current = task;
      const file = await task.resumeAsync();
      if (file) {
        setPhase('done');
        appendLog(`Resumed download complete: ${file.uri} (${formatBytes(file.size ?? 0)})`);
      } else {
        setPhase('paused');
        appendLog('Paused again before completion');
      }
    } catch (err) {
      setPhase('error');
      const message = err instanceof SpikeApiError ? err.message : String(err);
      setError(message);
      appendLog(`ERROR: ${message}`);
    }
  }, [appendLog, onProgress]);

  const status =
    phase === 'error' ? 'fail' : phase === 'done' ? 'pass' : phase === 'idle' ? 'idle' : 'running';

  return (
    <CheckCard itemNumber="2" title="expo-file-system fetches the audio-download endpoint to completion, backgrounded + resumable" status={status}>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={start} disabled={phase === 'fetching-url' || phase === 'downloading'}>
          <Text style={styles.buttonText}>Start download</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={pauseAndSave} disabled={phase !== 'downloading'}>
          <Text style={styles.buttonText}>Pause (simulate drop)</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={resumeFromSaved} disabled={phase !== 'paused'}>
          <Text style={styles.buttonText}>Resume from saved state</Text>
        </Pressable>
      </View>
      <Text style={styles.progressText}>
        {formatPercent(progress)} — {formatBytes(bytesWritten)} / {formatBytes(totalBytes)} (phase: {phase})
      </Text>
      {error && <LogLine>ERROR: {error}</LogLine>}
      <Text style={styles.manualNote}>
        Manual part of this check (JS can only prove pause/resume, not a real backgrounded app):
        after tapping "Start download", background the app (Home button / app-switcher) for a few
        seconds, then return — the progress bar should have kept moving or, at minimum, "Resume
        from saved state" should complete the file rather than restart from 0%. Also try airplane
        mode on/off mid-download as a real network-drop simulation.
      </Text>
      <View style={styles.logBox}>
        {log.map((l, i) => (
          <LogLine key={i}>{l}</LogLine>
        ))}
      </View>
    </CheckCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#1F4276',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  progressText: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  manualNote: { fontSize: 12, color: '#374151', marginTop: 8, lineHeight: 18 },
  logBox: { marginTop: 8, gap: 2 },
});
