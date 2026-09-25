import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SermonResultRow, type SermonListItem } from '../SermonResultRow';

// `formatDuration` itself is covered by lib/format/__tests__/duration.test.ts — this
// suite only proves the row composes title + duration + speaker correctly.

function makeSermon(overrides: Partial<SermonListItem> = {}): SermonListItem {
  return {
    id: 'sermon-1',
    title: 'Anchored in the Storm',
    description: null,
    thumbnail_url: null,
    duration_seconds: 2538,
    speaker_id: 'speaker-1',
    speaker_name: 'Ada Nwosu',
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    tier: 'FREE',
    locked: false,
    ...overrides,
  } as SermonListItem;
}

describe('SermonResultRow', () => {
  it('renders the title and "duration · speaker" meta line, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(
      <SermonResultRow sermon={makeSermon()} onPress={onPress} />,
    );

    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(getByText('42:18 · Ada Nwosu')).toBeTruthy();

    fireEvent.press(getByLabelText('Anchored in the Storm, 42:18 · Ada Nwosu'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the "--:--" probing placeholder instead of a speaker segment when both are absent', () => {
    const { getByLabelText, getByText } = render(
      <SermonResultRow
        sermon={makeSermon({ duration_seconds: null, speaker_name: null })}
        onPress={jest.fn()}
      />,
    );

    expect(getByText('--:--')).toBeTruthy();
    expect(getByLabelText('Anchored in the Storm, --:--')).toBeTruthy();
  });
});
