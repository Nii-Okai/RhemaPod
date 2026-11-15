import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, type View } from 'react-native';

/**
 * The artwork "flight" into the full player (Nii, 2026-11-15: open the player the way the
 * big audio apps do, with the art growing out of the mini player rather than a plain
 * screen sliding up).
 *
 * The player route keeps its native slide-up and pull-down-to-close (both are
 * `react-native-screens`' own and hard-won, see `app/_layout.tsx`). On top of that, a layer
 * above the whole navigation stack (`PlayerHeroOverlay`) draws a copy of the art where it
 * was tapped and flies it to its place in the player while the screen rises underneath.
 * The player's own art stays hidden until the copy lands, then the copy fades away over it.
 *
 * The flow, all through this small store:
 * 1. `launchPlayerHero` (the mini player, before it navigates): the art's window rect.
 * 2. `reportHeroTarget` (`PlayerHeroTarget` in the player): where the art ends up, in the
 *    player screen's own coordinates, once that screen has laid out.
 * 3. `landPlayerHero`, then `clearPlayerHero` (the overlay, when its animation ends).
 *
 * A launch that never gets a target (the player redirected, or took too long to lay out)
 * is dropped after `TARGET_TIMEOUT_MS`, which shows the player's own art as usual.
 *
 * Built on React Native's own `Animated` with the native driver (transforms and opacity
 * only), so it needs no new native library and ships over the air. Off under Reduce Motion.
 */

export interface HeroRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HeroPhase = 'waiting' | 'flying' | 'landed';

export interface HeroFlight {
  id: number;
  sermonId: string;
  uri: string;
  /** Window coordinates of the art that was tapped. */
  from: HeroRect;
  fromRadius: number;
  /** Player-screen coordinates of where it lands; null until the player has laid out. */
  to: HeroRect | null;
  toRadius: number;
  phase: HeroPhase;
}

/** How long a launch waits for the player to report where the art goes. */
export const TARGET_TIMEOUT_MS = 700;

let flight: HeroFlight | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

function set(next: HeroFlight | null) {
  flight = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPlayerHero(): HeroFlight | null {
  return flight;
}

export function usePlayerHero(): HeroFlight | null {
  return useSyncExternalStore(subscribe, getPlayerHero, getPlayerHero);
}

// Reduce Motion, read once and kept current, so a launch can decide synchronously at tap time.
let reduceMotion = false;
let watchingMotion = false;
const motionListeners = new Set<(on: boolean) => void>();

function watchReduceMotion() {
  if (watchingMotion) return;
  watchingMotion = true;
  const update = (on: boolean) => {
    reduceMotion = on;
    motionListeners.forEach((listener) => listener(on));
  };
  AccessibilityInfo.isReduceMotionEnabled()
    .then(update)
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', update);
}

/** The system Reduce Motion setting (iOS) / Remove animations (Android), kept current. */
export function useReduceMotion(): boolean {
  watchReduceMotion();
  const [on, setOn] = useState(reduceMotion);
  useEffect(() => {
    motionListeners.add(setOn);
    setOn(reduceMotion);
    return () => {
      motionListeners.delete(setOn);
    };
  }, []);
  return on;
}

/** Exported for tests. */
export function setReduceMotionForTests(on: boolean) {
  watchingMotion = true;
  reduceMotion = on;
}

/**
 * Start a flight from `from` (window coordinates). Returns false, and starts nothing, under
 * Reduce Motion or without art to fly.
 */
export function launchPlayerHero(args: { sermonId: string; uri: string | null | undefined; from: HeroRect; fromRadius: number }): boolean {
  watchReduceMotion();
  if (reduceMotion || !args.uri || args.from.width <= 0 || args.from.height <= 0) return false;
  const id = ++sequence;
  set({ id, sermonId: args.sermonId, uri: args.uri, from: args.from, fromRadius: args.fromRadius, to: null, toRadius: 0, phase: 'waiting' });
  setTimeout(() => {
    if (flight?.id === id && flight.phase === 'waiting') set(null);
  }, TARGET_TIMEOUT_MS);
  return true;
}

/** The player has laid out the art for `sermonId` at `to` (its own screen coordinates). */
export function reportHeroTarget(sermonId: string, to: HeroRect, toRadius: number) {
  if (!flight || flight.phase !== 'waiting' || flight.sermonId !== sermonId) return;
  if (to.width <= 0 || to.height <= 0) return;
  set({ ...flight, to, toRadius, phase: 'flying' });
}

/** The copy has arrived: the player shows its own art again. */
export function landPlayerHero(id: number) {
  if (flight?.id === id && flight.phase === 'flying') set({ ...flight, phase: 'landed' });
}

/** The copy has faded away. */
export function clearPlayerHero(id: number) {
  if (flight?.id === id) set(null);
}

/** Whether the player should keep its own art for `sermonId` hidden right now. */
export function isHeroHiding(current: HeroFlight | null, sermonId: string): boolean {
  return !!current && current.sermonId === sermonId && current.phase !== 'landed';
}

/**
 * Measure `view` in window coordinates and start a flight from it. Calls `then` once either
 * way (measurement is asynchronous), so navigation never waits on the animation.
 */
export function launchPlayerHeroFrom(
  view: View | null,
  args: { sermonId: string; uri: string | null | undefined; radius: number },
  then: () => void,
) {
  watchReduceMotion();
  if (!view || reduceMotion || !args.uri) {
    then();
    return;
  }
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    then();
  };
  try {
    view.measureInWindow((x, y, width, height) => {
      launchPlayerHero({ sermonId: args.sermonId, uri: args.uri, from: { x, y, width, height }, fromRadius: args.radius });
      go();
    });
  } catch {
    go();
  }
  // measureInWindow can stay silent on a view that is mid-unmount; never strand the tap.
  setTimeout(go, 50);
}

/** Exported for tests. */
export function resetPlayerHeroForTests() {
  flight = null;
  sequence = 0;
}
