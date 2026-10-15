import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { usePlaylistPreview } from '../usePlaylistPreview';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import { __lastMockPlayer } from '../../../../__mocks__/expo-video';

jest.mock('expo-video');

// No mock needed for `mediaCache/clearMediaCache`: `session.ts` (pulled in transitively
// via the API client) reaches it via a lazy `require()` inside `clearSession()` (S8/S9
// re-check circular-import fix), not a static import, so this file never touches that
// module tree at require time. Confirmed empirically (not assumed) by removing the
// earlier wholesale mock and re-running.

// A faithful-enough stand-in for React Navigation's real `useFocusEffect` — runs the
// effect on mount, its cleanup on unmount, same as the real one does when a screen is
// popped off the stack (the scenario this file's own regression test exercises).
jest.mock('expo-router', () => {
  const ReactActual = require('react');
  return {
    useFocusEffect: (effect: () => (() => void) | void) => {
      ReactActual.useEffect(effect, [effect]);
    },
  };
});

describe('usePlaylistPreview — back-navigation crash', () => {
  it('does not throw on unmount even if the native player is already released (NativeSharedObjectNotFoundException)', () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { unmount } = renderHook(() => usePlaylistPreview(), { wrapper });
    const player = __lastMockPlayer!;

    // Simulates the real crash (Isaac's report, session 2026-10-11): on some
    // unmounts, `useVideoPlayer`'s own native object is already gone by the time
    // this hook's `useFocusEffect` cleanup tries to call a method on it.
    player.pause = jest.fn(() => {
      throw new Error('NativeSharedObjectNotFoundException: Unable to find the native shared object');
    });

    expect(() => unmount()).not.toThrow();
  });
});
