import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HeroCard } from '../HeroCard';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

jest.mock('@expo/vector-icons');

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
  it('renders the eyebrow (no separate title or meta line — the art carries the title, and duration already shows in the Watch label), and fires onPress from the Watch CTA', () => {
    const onPress = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(<HeroCard sermon={sermon} onPress={onPress} />);

    expect(queryByText('Anchored in the Storm')).toBeNull();
    expect(queryByText('31:02 · Ada Nwosu')).toBeNull();
    expect(getByText('New this week')).toBeTruthy();

    fireEvent.press(getByLabelText('Watch, 31:02'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('toggles the My List button label and state on press', () => {
    const { getByLabelText } = render(<HeroCard sermon={sermon} onPress={jest.fn()} />);

    const addButton = getByLabelText('Add to My List');
    expect(addButton.props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(addButton);

    const removeButton = getByLabelText('Remove from My List');
    expect(removeButton.props.accessibilityState).toEqual({ selected: true });
  });
});
