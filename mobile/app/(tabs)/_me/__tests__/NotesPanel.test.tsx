import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NotesPanel } from '../NotesPanel';
import { buildSermonTitleMap } from '../../../../lib/format/sermonTitleMap';

const notes = [
  { id: 'n1', sermon_id: 's1', body: 'First note', position_seconds: 62, created_at: '2026-01-01T00:00:00Z', updated_at: null },
  { id: 'n2', sermon_id: 's2', body: 'Second note', position_seconds: 130, created_at: '2026-01-02T00:00:00Z', updated_at: null },
];

const sermonTitles = buildSermonTitleMap([
  { id: 's1', title: 'Anchored in the Storm' } as never,
  { id: 's2', title: 'A Second Sermon' } as never,
]);

describe('NotesPanel', () => {
  it('shows a loading state', () => {
    const { getByText } = render(
      <NotesPanel notes={[]} sermonTitles={sermonTitles} isLoading isError={false} onSeeAll={() => {}} />,
    );
    expect(getByText('Loading notes…')).toBeTruthy();
  });

  it('shows an error state', () => {
    const { getByText } = render(
      <NotesPanel notes={[]} sermonTitles={sermonTitles} isLoading={false} isError onSeeAll={() => {}} />,
    );
    expect(getByText("Couldn't load your notes.")).toBeTruthy();
  });

  it('shows an empty state with no "See all" link', () => {
    const { getByText, queryByText } = render(
      <NotesPanel notes={[]} sermonTitles={sermonTitles} isLoading={false} isError={false} onSeeAll={() => {}} />,
    );
    expect(getByText(/No notes yet/)).toBeTruthy();
    expect(queryByText('See all notes')).toBeNull();
  });

  it('renders each note with its resolved sermon title, capped at maxItems', () => {
    const { getByText, queryByText } = render(
      <NotesPanel
        notes={notes}
        sermonTitles={sermonTitles}
        isLoading={false}
        isError={false}
        onSeeAll={() => {}}
        maxItems={1}
      />,
    );
    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(queryByText('A Second Sermon')).toBeNull();
  });

  it('fires onSeeAll when the link is pressed', () => {
    const onSeeAll = jest.fn();
    const { getByText } = render(
      <NotesPanel notes={notes} sermonTitles={sermonTitles} isLoading={false} isError={false} onSeeAll={onSeeAll} />,
    );
    fireEvent.press(getByText('See all notes'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });
});
