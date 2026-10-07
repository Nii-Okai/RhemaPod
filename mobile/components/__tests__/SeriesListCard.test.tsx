import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { SeriesListCard } from '../SeriesListCard';
import type { SeriesPublic } from '../../lib/query/hooks/useSeries';

const series: SeriesPublic = {
  id: 'se1',
  title: 'New Beginnings',
  description: null,
  category_id: null,
  category_name: null,
  episode_count: 4,
  status: 'published',
  thumbnail_url: 'https://cdn.example.com/new-beginnings.jpg',
  tier: 'free',
} as SeriesPublic;

describe('SeriesListCard', () => {
  it('renders the series thumbnail, title, and pluralized episode count, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText, UNSAFE_getByType } = render(
      <SeriesListCard series={series} onPress={onPress} />,
    );

    expect(UNSAFE_getByType(Image).props.source).toEqual({ uri: 'https://cdn.example.com/new-beginnings.jpg' });
    expect(getByText('New Beginnings')).toBeTruthy();
    expect(getByText('4 episodes')).toBeTruthy();

    fireEvent.press(getByLabelText('New Beginnings, 4 episodes'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('singularizes a count of exactly one episode', () => {
    const { getByText } = render(
      <SeriesListCard series={{ ...series, episode_count: 1 }} onPress={jest.fn()} />,
    );
    expect(getByText('1 episode')).toBeTruthy();
  });

  it('renders a fallback block (no crash) when the series has no thumbnail_url', () => {
    const { UNSAFE_queryAllByType } = render(
      <SeriesListCard series={{ ...series, thumbnail_url: null }} onPress={jest.fn()} />,
    );
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });
});
