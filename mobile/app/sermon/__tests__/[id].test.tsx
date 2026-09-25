import React from 'react';
import { render } from '@testing-library/react-native';
import SermonDetailPlaceholder from '../[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'sermon-1' }),
}));

/**
 * PLACEHOLDER coverage only — plan W4.3 explicitly does not build the real
 * sermon-detail screen (that's W4.1). This just proves the route resolves
 * and reads its `id` param, since search/browse already navigate here.
 */
describe('SermonDetailPlaceholder', () => {
  it('renders using the id route param', () => {
    const { getByText } = render(<SermonDetailPlaceholder />);
    expect(getByText('Sermon sermon-1 — detail screen coming in W4.1.')).toBeTruthy();
  });
});
