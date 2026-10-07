import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { SpotlightCard } from '../SpotlightCard';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

const sermon: SermonListItem = {
  id: 's1',
  title: 'A Word for the Season',
  description: null,
  duration_seconds: 1200,
  episode_number: null,
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  speaker_id: 'sp1',
  speaker_name: 'Pastor Grace',
  thumbnail_url: 'https://cdn.example.com/word.jpg',
  locked: false,
  tier: 'free',
} as SermonListItem;

describe('SpotlightCard', () => {
  it('renders only the "Prophet\'s Pick" chip — no visible title or speaker/meta line — and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(
      <SpotlightCard sermon={sermon} onPress={onPress} />,
    );

    expect(getByText("Prophet’s Pick")).toBeTruthy();
    expect(queryByText('A Word for the Season')).toBeNull();
    expect(queryByText('Pastor Grace')).toBeNull();

    // The accessibility label still always carries the title, even though nothing is
    // drawn on screen — VoiceOver/TalkBack users still need to know what they're about
    // to open.
    fireEvent.press(getByLabelText("A Word for the Season, Prophet's Pick"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a fallback block (no crash) when the sermon has no thumbnail_url', () => {
    const { UNSAFE_queryAllByType } = render(
      <SpotlightCard sermon={{ ...sermon, thumbnail_url: null }} onPress={jest.fn()} />,
    );
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });
});
