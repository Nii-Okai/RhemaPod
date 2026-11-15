import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import type { ColorTokens } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import {
  MAX_FONT_SCALE,
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

  if (family === 'display') return { ...displayScale[key as DisplayVariant], maxScale: MAX_FONT_SCALE.display };
  if (family === 'mono') return { ...monoScale[key as MonoVariant], maxScale: MAX_FONT_SCALE.mono };
  return { ...uiScale[key as UiVariant], maxScale: MAX_FONT_SCALE.ui };
}

/**
 * Text primitive enforcing the app's strict font-role separation (theme/typography.ts):
 * `display.*` variants render Fraunces, `ui.*` render Plus Jakarta Sans, `mono.*` render IBM Plex
 * Mono. Never override `fontFamily` at a call site — add a new variant instead.
 *
 * `allowFontScaling` is intentionally left at its RN default (`true`) so OS-level
 * text-size accessibility settings apply — do not pass `allowFontScaling={false}` here.
 * Growth stops at the family's `MAX_FONT_SCALE` (theme/typography.ts) so the largest
 * accessibility sizes don't break layouts; a call site can pass its own
 * `maxFontSizeMultiplier`, and the line height follows it.
 */
export function AppText({ variant = 'ui.body', tone = 'primary', style, maxFontSizeMultiplier, ...rest }: AppTextProps) {
  const typeStyle = resolveTypeStyle(variant);
  const { colors } = useTheme();
  const maxScale = maxFontSizeMultiplier && maxFontSizeMultiplier >= 1 ? maxFontSizeMultiplier : typeStyle.maxScale;

  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          lineHeight: scaledLineHeight(typeStyle.fontSize, typeStyle.lineHeightRatio, maxScale),
          color: toneColor(colors, tone),
        },
        style,
      ]}
    />
  );
}
