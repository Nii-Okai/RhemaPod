import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { PlayerHeroOverlay, flightStart } from '../PlayerHeroOverlay';
import {
  getPlayerHero,
  launchPlayerHero,
  reportHeroTarget,
  resetPlayerHeroForTests,
  setReduceMotionForTests,
} from '../../../lib/playback/playerHero';

const from = { x: 20, y: 700, width: 46, height: 46 };
const to = { x: 90, y: 150, width: 230, height: 230 };

describe('flightStart', () => {
  it('maps the landing box onto the tapped art, centre to centre', () => {
    const start = flightStart(from, to);
    expect(start.scaleX).toBeCloseTo(0.2);
    expect(start.scaleY).toBeCloseTo(0.2);
    expect(start.translateX).toBe(43 - 205);
    expect(start.translateY).toBe(723 - 265);
  });
});

describe('PlayerHeroOverlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlayerHeroForTests();
    setReduceMotionForTests(false);
  });
  afterEach(() => jest.useRealTimers());

  it('draws nothing between flights', () => {
    const screen = render(<PlayerHeroOverlay />);
    expect(screen.queryByTestId('player-hero')).toBeNull();
  });

  it('holds the art where it was tapped, flies it in, then clears', () => {
    const screen = render(<PlayerHeroOverlay />);
    act(() => {
      launchPlayerHero({ sermonId: 's1', uri: 'https://cdn.example.com/art.jpg', from, fromRadius: 12 });
    });
    const waiting = StyleSheet.flatten(screen.getByTestId('player-hero').props.style);
    expect(waiting).toMatchObject({ left: 20, top: 700, width: 46, height: 46 });

    act(() => reportHeroTarget('s1', to, 0));
    const flying = StyleSheet.flatten(screen.getByTestId('player-hero').props.style);
    expect(flying).toMatchObject({ left: 90, top: 150, width: 230, height: 230 });

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(getPlayerHero()).toBeNull();
    expect(screen.queryByTestId('player-hero')).toBeNull();
  });
});
