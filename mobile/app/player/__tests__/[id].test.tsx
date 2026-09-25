import React from 'react';
import { render } from '@testing-library/react-native';
import PlayerPlaceholder from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'sermon-1' }),
}));

/**
 * PLACEHOLDER coverage only — W4.2 builds the real player. This just proves the route
 * resolves and reads its `id` param, since the sermon-detail CTA (W4.1) already
 * navigates here.
 */
describe('PlayerPlaceholder', () => {
  it('renders using the id route param', () => {
    const { getByText } = render(<PlayerPlaceholder />);
    expect(getByText('Player for sermon sermon-1 — coming in W4.2.')).toBeTruthy();
  });
});
