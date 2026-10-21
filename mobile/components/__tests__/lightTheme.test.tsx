import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import * as RN from 'react-native';
import { AsyncStorage } from 'expo-sqlite/kv-store';
import { AppText } from '../Text';
import { IconButton } from '../IconButton';
import { ThemeProvider } from '../../theme/ThemeContext';
import { darkColors, lightColors } from '../../theme/colors';

/* Converted shared components follow the active palette, and an explicit on-art colour
   still wins over the theme. */

jest.mock('@expo/vector-icons');
jest.mock('expo-sqlite/kv-store', () => ({
  AsyncStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

beforeEach(() => jest.spyOn(RN, 'useColorScheme').mockReturnValue('light'));
afterEach(() => jest.restoreAllMocks());

function Light({ children }: { children: React.ReactNode }) {
  return <ThemeProvider lightModeAvailable>{children}</ThemeProvider>;
}

function flatColor(style: unknown): string | undefined {
  return (RN.StyleSheet.flatten(style as RN.StyleProp<RN.TextStyle>) ?? {}).color as string | undefined;
}

it('AppText tones use the light palette', async () => {
  const { getByText } = render(
    <Light>
      <AppText>Primary</AppText>
      <AppText tone="gold">Gold</AppText>
    </Light>,
  );
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
  expect(flatColor(getByText('Primary').props.style)).toBe(lightColors.text.primary);
  expect(flatColor(getByText('Gold').props.style)).toBe(lightColors.accent.goldText);
});

it('AppText stays on the dark palette outside a provider', () => {
  const { getByText } = render(<AppText>Primary</AppText>);
  expect(flatColor(getByText('Primary').props.style)).toBe(darkColors.text.primary);
});

it('IconButton glyphs follow the theme unless given an on-art colour', async () => {
  const { UNSAFE_getAllByProps } = render(
    <Light>
      <IconButton icon="close" accessibilityLabel="Themed" onPress={() => {}} />
      <IconButton icon="search" accessibilityLabel="On art" onPress={() => {}} color={darkColors.text.primary} />
    </Light>,
  );
  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
  expect(UNSAFE_getAllByProps({ name: 'close' })[0].props.color).toBe(lightColors.text.primary);
  expect(UNSAFE_getAllByProps({ name: 'search' })[0].props.color).toBe(darkColors.text.primary);
});
