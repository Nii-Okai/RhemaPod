import React, { useContext, useEffect, useState } from 'react';
import { Platform, StatusBar } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

/**
 * Light status-bar glyphs while a screen's dark cover art sits under the bar (series and
 * sermon detail). The root layout picks dark glyphs for the light theme, which vanish over
 * the art (Nii's phone test, 2026-11-11). Rendered only while the screen is focused, so a
 * screen pushed on top gets the root's choice back; `active` hands it back too once the
 * art has scrolled away.
 *
 * iOS only. On Android the root layout paints the bar in the palette's own colour, so the
 * art never sits under it, and light glyphs there would vanish on the light theme's bar.
 */
export function HeroStatusBar({ active = true }: { active?: boolean }) {
  // Read the context directly (not `useIsFocused`), so a screen rendered outside a
  // navigator, as in tests, simply counts as focused.
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (!navigation) return undefined;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  if (Platform.OS === 'android' || !focused || !active) return null;
  return <StatusBar barStyle="light-content" animated />;
}
