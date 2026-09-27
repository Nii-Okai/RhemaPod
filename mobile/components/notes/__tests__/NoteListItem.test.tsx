import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NoteListItem } from '../NoteListItem';

jest.mock('@expo/vector-icons');

const note = {
  id: 'n1',
  sermon_id: 's1',
  body: 'A note about the sermon',
  position_seconds: 862,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

describe('NoteListItem', () => {
  it('renders the mono timestamp and the note body', () => {
    const { getByText } = render(<NoteListItem note={note} />);
    expect(getByText('14:22 →')).toBeTruthy();
    expect(getByText('A note about the sermon')).toBeTruthy();
  });

  it('renders the resolved sermon title when the caller supplies one', () => {
    const { getByText, queryByText } = render(<NoteListItem note={note} sermonTitle="Anchored in the Storm" />);
    expect(getByText('Anchored in the Storm')).toBeTruthy();
    expect(queryByText('s1')).toBeNull();
  });

  it('fires onPress when tappable', () => {
    const onPress = jest.fn();
    const { getByText } = render(<NoteListItem note={note} onPress={onPress} />);
    fireEvent.press(getByText('A note about the sermon'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a delete control only when onDelete is supplied, and it is independently pressable', () => {
    const onDelete = jest.fn();
    const { getByLabelText, rerender, queryByLabelText } = render(<NoteListItem note={note} onDelete={onDelete} />);
    fireEvent.press(getByLabelText('Delete note'));
    expect(onDelete).toHaveBeenCalledTimes(1);

    rerender(<NoteListItem note={note} />);
    expect(queryByLabelText('Delete note')).toBeNull();
  });
});
