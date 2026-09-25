import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HeroCard } from '../HeroCard';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

const sermon: SermonListItem = {
  id: 's1',
  title: 'Anchored in the Storm',
  description: null,
  duration_seconds: 1862,
  episode_number: null,
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  speaker_id: 'sp1',
  speaker_name: 'Ada Nwosu',
  thumbnail_url: 'https://cdn.example.com/hero.jpg',
  locked: false,
  tier: 'free',
} as SermonListItem;

describe('HeroCard', () => {
  it('renders the title and meta line, and fires onPress on the whole card', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<HeroCard sermon={sermon} onPress={onPress} />);

    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('New this week')).toBeTruthy();
    expect(getByText('31:02 · Ada Nwosu')).toBeTruthy();

    fireEvent.press(getByLabelText('Anchored in the Storm, 31:02 · Ada Nwosu'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('omits the meta segment for a missing speaker without rendering a bare separator', () => {
    const { queryByText } = render(<HeroCard sermon={{ ...sermon, speaker_name: null }} onPress={jest.fn()} />);

    expect(queryByText('31:02 · Ada Nwosu')).toBeNull();
    expect(queryByText(/^·/)).toBeNull();
  });
});
