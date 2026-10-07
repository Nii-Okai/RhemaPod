import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ContinueWatchingCard } from '../ContinueWatchingCard';
import type { ContinueWatchingItem } from '../../../../lib/query/hooks/useContinueWatching';

const item: ContinueWatchingItem = {
  id: 's1',
  title: 'Anchored in the Storm',
  description: null,
  duration_seconds: 1800,
  position_seconds: 600,
  percent_complete: 33,
  episode_number: null,
  category_id: null,
  category_name: null,
  series_id: null,
  series_title: null,
  speaker_id: null,
  speaker_name: null,
  thumbnail_url: null,
  locked: false,
  tier: 'free',
  last_played_at: '2026-09-20T00:00:00Z',
} as ContinueWatchingItem;

describe('ContinueWatchingCard', () => {
  it('renders the title and remaining-time meta, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<ContinueWatchingCard item={item} onPress={onPress} />);

    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('20:00 left')).toBeTruthy();

    fireEvent.press(getByLabelText('Anchored in the Storm, 20:00 left'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('floors remaining time at 0 rather than going negative', () => {
    const { getByText } = render(
      <ContinueWatchingCard item={{ ...item, position_seconds: 5000 }} onPress={jest.fn()} />,
    );

    expect(getByText('0:00 left')).toBeTruthy();
  });

  it('shows a progress bar reflecting percent_complete straight off the API response', () => {
    const { getByLabelText } = render(<ContinueWatchingCard item={item} onPress={jest.fn()} />);

    const bar = getByLabelText('33 percent watched');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 33 });
  });

  it('omits the progress bar when percent_complete is null (duration unknown)', () => {
    const { queryByLabelText } = render(
      <ContinueWatchingCard item={{ ...item, percent_complete: null }} onPress={jest.fn()} />,
    );

    expect(queryByLabelText(/percent watched/)).toBeNull();
  });
});
