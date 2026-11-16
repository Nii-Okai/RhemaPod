import { useFonts } from 'expo-font';
import { Fraunces_400Regular } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';

/**
 * Loads exactly the font weights the type system uses (theme/typography.ts) — no unused
 * weights bundled. The root layout keeps the splash up until `fontsLoaded` (or
 * `fontError`) so no screen ever paints in the OS fallback face first.
 *
 * Daybreak redesign (2026-11): Fraunces for display, Plus Jakarta Sans for UI. IBM Plex
 * Mono stays for numbers and times.
 */
export function useAppFonts(): { fontsLoaded: boolean; fontError: Error | null } {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    IBMPlexMono_400Regular,
  });

  return { fontsLoaded, fontError: fontError ?? null };
}
