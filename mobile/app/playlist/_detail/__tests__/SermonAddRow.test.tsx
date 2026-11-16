import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SermonAddRow } from '../SermonAddRow';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

jest.mock('@expo/vector-icons');

function sermon(overrides: Partial<SermonListItem> = {}): SermonListItem {
  return {
    id: 's1',
    title: 'Anchored in the Storm',
    description: null,
    thumbnail_url: null,
    duration_seconds: 1800,
    speaker_id: null,
    speaker_name: null,
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    episode_number: null,
    tier: 'free',
    locked: false,
    ...overrides,
  } as SermonListItem;
}

describe('SermonAddRow — meta line', () => {
  it('shows "Series · Episode N" for a numbered series episode', () => {
    const { getByText } = render(
      <SermonAddRow sermon={sermon({ series_title: 'Faith Series', episode_number: 3 })} onAdd={jest.fn()} />,
    );
    expect(getByText('Faith Series · Episode 3')).toBeTruthy();
  });

  it('shows just the series title when the episode has no number', () => {
    const { getByText } = render(
      <SermonAddRow sermon={sermon({ series_title: 'Faith Series', episode_number: null })} onAdd={jest.fn()} />,
    );
    expect(getByText('Faith Series')).toBeTruthy();
  });

  it('falls back to the category for a standalone sermon', () => {
    const { getByText } = render(<SermonAddRow sermon={sermon({ category_name: 'Teaching' })} onAdd={jest.fn()} />);
    expect(getByText('Teaching')).toBeTruthy();
  });

  it('renders no meta line at all when there is neither a series nor a category', () => {
    const { queryByText } = render(<SermonAddRow sermon={sermon()} onAdd={jest.fn()} />);
    expect(queryByText(/·/)).toBeNull();
  });
});

describe('SermonAddRow — add affordance', () => {
  it('fires onAdd on tap', () => {
    const onAdd = jest.fn();
    const { getByLabelText } = render(<SermonAddRow sermon={sermon()} onAdd={onAdd} />);
    fireEvent.press(getByLabelText('Add Anchored in the Storm'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows a checkmark instead of "+" when already added, and tapping it removes instead of adding', () => {
    const onAdd = jest.fn();
    const onRemove = jest.fn();
    const { getByLabelText } = render(<SermonAddRow sermon={sermon()} alreadyAdded onAdd={onAdd} onRemove={onRemove} />);
    const row = getByLabelText('Remove Anchored in the Storm from this playlist');
    fireEvent.press(row);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows a spinner in place of the add icon while adding', () => {
    const { getByLabelText, queryByText } = render(<SermonAddRow sermon={sermon()} isAdding onAdd={jest.fn()} />);
    expect(getByLabelText('Add Anchored in the Storm')).toBeTruthy();
    expect(queryByText('add')).toBeNull();
  });
});
