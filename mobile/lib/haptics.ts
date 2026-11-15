import * as Haptics from 'expo-haptics';

/**
 * Light haptic feedback for the app's few key moments. Kept deliberately sparse: play/pause, starting a download,
 * liking or saving something, and picking up / setting down the mini player. Ordinary
 * navigation taps get none, so the ones that do stay meaningful.
 *
 * Every call is fire-and-forget and never throws. `expo-haptics` looks its native module
 * up optionally, so on a build that predates it (an over-the-air update reaching an older
 * binary) the calls reject and are swallowed here: no feedback, but no crash. iOS honours
 * the system "System Haptics" switch on its own.
 */

const quietly = (promise: Promise<void>) => {
  promise.catch(() => {});
};

const run = (fire: () => Promise<void>) => {
  try {
    quietly(fire());
  } catch {
    // A synchronous throw from a missing module is just as harmless as a rejection.
  }
};

export const haptics = {
  /** Play, pause, replay, next: the transport controls. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Liking or adding to My List: a touch firmer than a transport tap. */
  toggleOn: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Unliking or removing from My List: the faintest tick. */
  toggleOff: () => run(() => Haptics.selectionAsync()),
  /** A download starts (or a failed one is retried). */
  download: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** The mini player is picked up to drag. */
  grab: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** The mini player comes to rest after a drag. */
  settle: () => run(() => Haptics.selectionAsync()),
};
