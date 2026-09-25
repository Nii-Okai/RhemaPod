import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SeriesCard } from '../SeriesCard';
import type { SeriesListItem } from '../../../../lib/query/hooks/useSeries';

const series: SeriesListItem = {
  id: 'se1',
  title: 'Storms',
  description: null,
  category_id: null,
  category_name: null,
  episode_count: 4,
  status: 'published',
  thumbnail_url: null,
  tier: 'free',
} as SeriesListItem;

describe('SeriesCard', () => {
  it('renders the title and pluralized episode count, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<SeriesCard series={series} onPress={onPress} />);

    expect(getByText('Storms')).toBeTruthy();
    expect(getByText('4 episodes')).toBeTruthy();

    fireEvent.press(getByLabelText('Storms, 4 episodes'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('singularizes a count of exactly one episode', () => {
    const { getByText } = render(<SeriesCard series={{ ...series, episode_count: 1 }} onPress={jest.fn()} />);
    expect(getByText('1 episode')).toBeTruthy();
  });
});
