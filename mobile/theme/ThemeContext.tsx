import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import {
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../lib/settings/themePreference';
import { palettes, type ColorScheme, type ColorTokens } from './colors';

/**
 * Light mode is built screen by screen (phased rollout, Isaac's decision 2026-10-21).
 * Until every screen reads its colours from the theme, the light palette stays behind
 * this flag: off, the app always resolves to dark and the appearance setting is hidden,
 * so no viewer ever sees a half-converted app. Turn it on locally with
 * `EXPO_PUBLIC_LIGHT_MODE=1` (Metro inlines it at build time). Remove the flag once the
 * conversion is complete.
 */
export const LIGHT_MODE_ENABLED = process.env.EXPO_PUBLIC_LIGHT_MODE === '1';

export interface ThemeValue {
  /** The palette in effect right now. */
  scheme: ColorScheme;
  colors: ColorTokens;
  /** What the viewer chose; `system` follows the phone. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
  /** False while light mode is behind its rollout flag — hide the appearance setting. */
  lightModeAvailable: boolean;
}

/** Resolve a preference against the phone's appearance. Exported for tests. */
export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
  lightModeAvailable: boolean = LIGHT_MODE_ENABLED,
): ColorScheme {
  if (!lightModeAvailable) return 'dark';
  if (preference === 'system') return system === 'light' ? 'light' : 'dark';
  return preference;
}

const DARK_DEFAULT: ThemeValue = {
  scheme: 'dark',
  colors: palettes.dark,
  preference: DEFAULT_THEME_PREFERENCE,
  setPreference: async () => {},
  lightModeAvailable: false,
};

// Default is the dark palette, so a component rendered outside the provider (most unit
// tests) behaves exactly as the app did before light mode existed.
const ThemeContext = createContext<ThemeValue>(DARK_DEFAULT);

export function ThemeProvider({
  children,
  lightModeAvailable = LIGHT_MODE_ENABLED,
}: {
  children: React.ReactNode;
  /** Override the rollout flag (tests, the dev gallery). */
  lightModeAvailable?: boolean;
}) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const mounted = useRef(true);
  const current = useRef(preference);
  current.current = preference;
  // Set once the viewer picks a theme, so a slower launch-time load can't overwrite it.
  const chosen = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void loadThemePreference().then((loaded) => {
      if (mounted.current && !chosen.current) setPreferenceState(loaded);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Optimistic, reverted on a failed write — same posture as usePlaybackPreferences.
  const setPreference = useCallback(async (next: ThemePreference) => {
    const previous = current.current;
    chosen.current = true;
    setPreferenceState(next);
    try {
      await saveThemePreference(next);
    } catch (err) {
      if (mounted.current) setPreferenceState(previous);
      throw err;
    }
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme = resolveScheme(preference, system, lightModeAvailable);
    return { scheme, colors: palettes[scheme], preference, setPreference, lightModeAvailable };
  }, [preference, system, lightModeAvailable, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * Themed replacement for a module-level `StyleSheet.create`. Write the styles as a
 * function of the palette; the returned hook hands back the sheet for the active scheme.
 * There are only two palettes, so each sheet is built once per scheme and cached — no
 * per-render or per-instance allocation.
 *
 *   const useStyles = createThemedStyles((c) => ({ card: { backgroundColor: c.surface.raised } }));
 *   function Card() { const styles = useStyles(); ... }
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ColorTokens) => T,
): () => T {
  const cache = new Map<ColorScheme, T>();
  return function useThemedStyles(): T {
    const { scheme, colors } = useTheme();
    let sheet = cache.get(scheme);
    if (!sheet) {
      sheet = StyleSheet.create(factory(colors));
      cache.set(scheme, sheet);
    }
    return sheet;
  };
}
