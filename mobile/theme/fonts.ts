import { useFonts } from 'expo-font';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';

/**
 * Loads exactly the font weights the type system uses (theme/typography.ts) — no unused
 * weights bundled. Consumers should keep the splash screen visible / render a fallback
 * until `fontsLoaded` is true, since text rendered before then falls back to the OS
 * default font.
 */
export function useAppFonts(): { fontsLoaded: boolean; fontError: Error | null } {
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
    IBMPlexMono_400Regular,
  });

  return { fontsLoaded, fontError: fontError ?? null };
}
