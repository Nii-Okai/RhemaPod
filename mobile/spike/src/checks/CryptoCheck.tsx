import * as ExpoCrypto from 'expo-crypto';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import QuickCrypto, { Buffer } from 'react-native-quick-crypto';

import { CheckCard, LogLine } from '../components/CheckCard';
import { formatBytes, formatMs } from '../lib/format';

const SIXTY_MB = 60 * 1024 * 1024;
const ALGORITHM = 'aes-256-cbc';

interface Result {
  genMs: number;
  encryptMs: number;
  decryptMs: number;
  integrityOk: boolean;
  originalDigest: string;
  decryptedDigest: string;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Items 3 and 5: a 60 MB round trip through `react-native-quick-crypto`
 * (the plan's L7 default for the JSI crypto module — no reason found here
 * to pick differently, so it isn't). Integrity is checked with `expo-crypto`
 * `digest('SHA-256', ...)`, a *different* library from the one under test,
 * so a bug in quick-crypto's own hashing can't quietly rubber-stamp a
 * broken decrypt.
 *
 * The item-5 number is the *decrypt* phase only, timed as a synchronous
 * whole-file operation: this spike assumes the simplest production
 * architecture (decrypt the whole downloaded file to a temp/cache location,
 * then hand the plain file to the player) rather than inventing a
 * chunked/streaming decrypt design mid-spike — that would be a real
 * engineering decision for whoever builds Slice 5, not something to smuggle
 * in here. If this number is high, a streaming decrypt is the natural next
 * question, but deciding that not this file's job.
 */
export function CryptoCheck() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setError(null);
    setResult(null);
    // Deferred so the "RUNNING…" status actually paints before the
    // synchronous JSI calls below block the JS thread — the block itself is
    // the point (it's what makes the timing below a true wall-clock number).
    setTimeout(async () => {
      try {
        const genStart = Date.now();
        const plaintext = QuickCrypto.randomBytes(SIXTY_MB);
        const key = QuickCrypto.randomBytes(32);
        const iv = QuickCrypto.randomBytes(16);
        const genMs = Date.now() - genStart;

        const originalDigestBuf = await ExpoCrypto.digest(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          plaintext,
        );
        const originalDigest = toHex(originalDigestBuf);

        const encryptStart = Date.now();
        const cipher = QuickCrypto.createCipheriv(ALGORITHM, key, iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const encryptMs = Date.now() - encryptStart;

        const decryptStart = Date.now();
        const decipher = QuickCrypto.createDecipheriv(ALGORITHM, key, iv);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const decryptMs = Date.now() - decryptStart;

        const decryptedDigestBuf = await ExpoCrypto.digest(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          decrypted,
        );
        const decryptedDigest = toHex(decryptedDigestBuf);

        setResult({
          genMs,
          encryptMs,
          decryptMs,
          integrityOk: originalDigest === decryptedDigest && decrypted.length === plaintext.length,
          originalDigest,
          decryptedDigest,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, []);

  const roundTripStatus = error ? 'fail' : result ? (result.integrityOk ? 'pass' : 'fail') : running ? 'running' : 'idle';
  const latencyStatus = error ? 'fail' : result ? 'pass' : running ? 'running' : 'idle';

  return (
    <>
      <CheckCard itemNumber="3" title={`JSI crypto round trip on a ${formatBytes(SIXTY_MB)} buffer (react-native-quick-crypto)`} status={roundTripStatus}>
        <Pressable style={styles.button} onPress={run} disabled={running}>
          <Text style={styles.buttonText}>{running ? 'Running…' : `Encrypt + decrypt ${formatBytes(SIXTY_MB)}`}</Text>
        </Pressable>
        {error && <LogLine>ERROR: {error}</LogLine>}
        {result && (
          <>
            <LogLine>random plaintext generated in {formatMs(result.genMs)}</LogLine>
            <LogLine>encrypt ({ALGORITHM}): {formatMs(result.encryptMs)}</LogLine>
            <LogLine>decrypt ({ALGORITHM}): {formatMs(result.decryptMs)}</LogLine>
            <LogLine>
              SHA-256 (expo-crypto, independent of quick-crypto) before/after:{' '}
              {result.integrityOk ? 'MATCH' : 'MISMATCH — decrypt did not round-trip correctly'}
            </LogLine>
            <LogLine>original:  {result.originalDigest.slice(0, 24)}…</LogLine>
            <LogLine>decrypted: {result.decryptedDigest.slice(0, 24)}…</LogLine>
          </>
        )}
      </CheckCard>

      <CheckCard itemNumber="5" title="Decrypt-to-first-audio latency (the P7 datum)" status={latencyStatus}>
        {result ? (
          <>
            <Text style={styles.bigNumber}>{formatMs(result.decryptMs)}</Text>
            <Text style={styles.bigNumberCaption}>
              Whole-file decrypt time for a {formatBytes(SIXTY_MB)} buffer on this device — read
              this number, it's the one Isaac needs off the device per the dispatch.
            </Text>
            <LogLine>P7 threshold: "Preparing…" UI state is needed only if p95 &gt; 400 ms.</LogLine>
            <LogLine>
              This single run is not a p95 — run it a few times (cold + warm) and record the
              range in status.md, per the README checklist.
            </LogLine>
            <LogLine>
              Per the 2026-09-22 plan amendment: if this run is on a simulator, this number is
              provisional — simulators run on host CPU, not real mobile silicon, and P7 must be
              re-measured on real (ideally oldest-target) hardware before GATE M11.
            </LogLine>
          </>
        ) : (
          <LogLine>Run the item-3 check above — this card reads the same decrypt timing.</LogLine>
        )}
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
  bigNumber: { fontSize: 36, fontWeight: '800', color: '#1F4276' },
  bigNumberCaption: { fontSize: 12, color: '#374151', marginTop: 4, marginBottom: 8, lineHeight: 18 },
});
