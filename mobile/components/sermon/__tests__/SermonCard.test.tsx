import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Animated, Image } from 'react-native';
import { SermonCard } from '../SermonCard';
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
  speaker_id: 'sp1',
  speaker_name: 'Pastor Grace',
  thumbnail_url: 'https://cdn.example.com/anchored.jpg',
  locked: false,
  tier: 'free',
} as SermonListItem;

/** `PressableScale` nests the caller's `style` inside its own `[style, {transform}]` array,
    so a plain one-level `Object.assign(...)` spread over `card.props.style` leaves a caller
    array (e.g. `[styles.card, {width}, ...]`) un-flattened at index 0 instead of merged. */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  return (style as Record<string, unknown>) || {};
}

describe('SermonCard', () => {
  it('renders the title and speaker name, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<SermonCard sermon={sermon} onPress={onPress} />);

    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('Pastor Grace')).toBeTruthy();

    fireEvent.press(getByLabelText('Anchored in the Storm, Pastor Grace'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('falls back to the formatted duration when there is no speaker', () => {
    const { getByText } = render(
      <SermonCard sermon={{ ...sermon, speaker_name: null }} onPress={jest.fn()} />,
    );
    expect(getByText('31:02')).toBeTruthy();
  });

  it('renders a fallback block (no crash) when the sermon has no thumbnail_url', () => {
    const { UNSAFE_queryAllByType } = render(
      <SermonCard sermon={{ ...sermon, thumbnail_url: null }} onPress={jest.fn()} />,
    );
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('honors a caller-supplied width (New Releases\' wider card)', () => {
    const { UNSAFE_getByType } = render(
      <SermonCard sermon={sermon} onPress={jest.fn()} width={240} />,
    );
    const flat = flattenStyle(UNSAFE_getByType(Animated.View).props.style);
    expect(flat.width).toBe(240);
  });

  it('shows a gold ring when highlighted (Prophet\'s Catalog)', () => {
    const { UNSAFE_getByType } = render(
      <SermonCard sermon={sermon} onPress={jest.fn()} highlighted />,
    );
    const flat = flattenStyle(UNSAFE_getByType(Animated.View).props.style);
    expect(flat.borderColor).not.toBe('transparent');
  });

  it('hides the visible meta line when showMeta is false, but keeps it in the accessibility label', () => {
    const { queryByText, getByLabelText } = render(
      <SermonCard sermon={sermon} onPress={jest.fn()} showMeta={false} />,
    );
    expect(queryByText('Pastor Grace')).toBeNull();
    expect(getByLabelText('Anchored in the Storm, Pastor Grace')).toBeTruthy();
  });
});
