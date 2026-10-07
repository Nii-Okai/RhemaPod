import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { ImageOnlyCard } from '../ImageOnlyCard';
import type { SermonListItem } from '../../../lib/query/hooks/useSermons';

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
  speaker_id: null,
  speaker_name: null,
  thumbnail_url: 'https://cdn.example.com/anchored.jpg',
  locked: false,
  tier: 'free',
} as SermonListItem;

describe('ImageOnlyCard', () => {
  it('renders only the image — no visible title/meta text — but still labels the control for screen readers', () => {
    const onPress = jest.fn();
    const { getByLabelText, queryByText, UNSAFE_getByType } = render(
      <ImageOnlyCard sermon={sermon} onPress={onPress} />,
    );

    expect(queryByText('Anchored in the Storm')).toBeNull();
    expect(UNSAFE_getByType(Image).props.source).toEqual({ uri: 'https://cdn.example.com/anchored.jpg' });

    fireEvent.press(getByLabelText('Anchored in the Storm'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a fallback block (no crash) when the sermon has no thumbnail_url', () => {
    const { UNSAFE_queryAllByType } = render(
      <ImageOnlyCard sermon={{ ...sermon, thumbnail_url: null }} onPress={jest.fn()} />,
    );
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('defaults to 160×16:9 sizing when no width/aspectRatio is given', () => {
    const { UNSAFE_getByType } = render(<ImageOnlyCard sermon={sermon} onPress={jest.fn()} />);

    const image = UNSAFE_getByType(Image);
    const flat = Object.assign({}, ...(Array.isArray(image.props.style) ? image.props.style : [image.props.style]));
    expect(flat.aspectRatio).toBeCloseTo(16 / 9);
  });

  it('honors a caller-supplied width/aspectRatio (Recommended/Trending\'s narrower, taller sizing)', () => {
    const { UNSAFE_getByType } = render(
      <ImageOnlyCard sermon={sermon} onPress={jest.fn()} width={120} aspectRatio={3 / 4} />,
    );

    const image = UNSAFE_getByType(Image);
    const flat = Object.assign({}, ...(Array.isArray(image.props.style) ? image.props.style : [image.props.style]));
    expect(flat.aspectRatio).toBeCloseTo(3 / 4);
  });

  it('uses resizeMode="cover" so the card is always filled edge-to-edge with no empty space', () => {
    const { UNSAFE_getByType } = render(<ImageOnlyCard sermon={sermon} onPress={jest.fn()} />);

    expect(UNSAFE_getByType(Image).props.resizeMode).toBe('cover');
  });
});
