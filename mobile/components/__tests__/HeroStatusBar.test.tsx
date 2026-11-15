import React from 'react';
import { Platform, StatusBar } from 'react-native';
import { render } from '@testing-library/react-native';
import { HeroStatusBar } from '../HeroStatusBar';

const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
});

it('turns the status-bar glyphs light over the cover art on iOS', () => {
  Platform.OS = 'ios';
  const ui = render(<HeroStatusBar />);
  expect(ui.UNSAFE_getByType(StatusBar).props.barStyle).toBe('light-content');
});

it('turns them light on Android too, where the bar is transparent over the art', () => {
  Platform.OS = 'android';
  const ui = render(<HeroStatusBar />);
  expect(ui.UNSAFE_getByType(StatusBar).props.barStyle).toBe('light-content');
});

it('hands the bar back once the art has scrolled away', () => {
  Platform.OS = 'ios';
  const ui = render(<HeroStatusBar active={false} />);
  expect(ui.UNSAFE_queryByType(StatusBar)).toBeNull();
});
