import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import type { ColorTokens } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import {
  displayScale,
  monoScale,
  scaledLineHeight,
  uiScale,
  type DisplayVariant,
  type MonoVariant,
  type UiVariant,
} from '../theme/typography';

export type AppTextVariant = `display.${DisplayVariant}` | `ui.${UiVariant}` | `mono.${MonoVariant}`;

export type AppTextTone = 'primary' | 'secondary' | 'tertiary' | 'gold' | 'goldHover' | 'inverse';

export interface AppTextProps extends RNTextProps {
  variant?: AppTextVariant;
  tone?: AppTextTone;
}

function toneColor(colors: ColorTokens, tone: AppTextTone): string {
  switch (tone) {
    case 'primary':
      return colors.text.primary;
    case 'secondary':
      return colors.text.secondary;
    case 'tertiary':
      return colors.text.tertiary;
    case 'gold':
      return colors.accent.goldText;
    case 'goldHover':
      return colors.accent.goldHover;
    case 'inverse':
      return colors.primaryButton.text;
  }
}

function resolveTypeStyle(variant: AppTextVariant) {
  const separatorIndex = variant.indexOf('.');
  const family = variant.slice(0, separatorIndex);
  const key = variant.slice(separatorIndex + 1);

  if (family === 'display') return displayScale[key as DisplayVariant];
  if (family === 'mono') return monoScale[key as MonoVariant];
  return uiScale[key as UiVariant];
}

/**
 * Text primitive enforcing the app's strict font-role separation (theme/typography.ts):
 * `display.*` variants render Newsreader, `ui.*` render Figtree, `mono.*` render IBM Plex
 * Mono. Never override `fontFamily` at a call site — add a new variant instead.
 *
 * `allowFontScaling` is intentionally left at its RN default (`true`) so OS-level
 * text-size accessibility settings apply — do not pass `allowFontScaling={false}` here.
 */
export function AppText({ variant = 'ui.body', tone = 'primary', style, ...rest }: AppTextProps) {
  const typeStyle = resolveTypeStyle(variant);
  const { colors } = useTheme();

  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          lineHeight: scaledLineHeight(typeStyle.fontSize, typeStyle.lineHeightRatio),
          color: toneColor(colors, tone),
        },
        style,
      ]}
    />
  );
}
