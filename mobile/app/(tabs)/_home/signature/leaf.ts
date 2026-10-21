import type { ViewStyle } from 'react-native';

/**
 * The Signature design's "leaf" corner — two opposite corners round, the other two stay
 * nearly square — taken from the shape of the RhemaPod flame-and-mic mark. Used on the
 * hero, the cards and the verse panel instead of a uniform radius.
 */
export function leaf(round: number, tight: number): ViewStyle {
  return {
    borderTopLeftRadius: round,
    borderTopRightRadius: tight,
    borderBottomRightRadius: round,
    borderBottomLeftRadius: tight,
  };
}

/** Large surfaces: the hero, Prophet's Pick. */
export const LEAF = leaf(28, 6);
/** Shelf cards, tiles and panels. */
export const LEAF_SM = leaf(16, 4);
