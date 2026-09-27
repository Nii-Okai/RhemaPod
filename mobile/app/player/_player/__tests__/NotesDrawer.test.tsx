import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { NotesDrawer } from '../NotesDrawer';
import { api } from '../../../../lib/api/typedClient';
import { usePlatformOS } from '../../../../components/navigation/platform';
import { createTestQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('@expo/vector-icons');

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;
const mockedUsePlatformOS = usePlatformOS as jest.Mock;

const existingNote = {
  id: 'n1',
  sermon_id: 's1',
  body: 'Grace abounds',
  position_seconds: 82,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

function renderDrawer(getCurrentPositionSeconds: () => number = () => 90) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NotesDrawer sermonId="s1" getCurrentPositionSeconds={getCurrentPositionSeconds} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPatch.mockReset();
  mockedDelete.mockReset();
  mockedUsePlatformOS.mockReturnValue('ios');
});

describe('NotesDrawer — empty state', () => {
  it('shows the real empty state when the sermon has no notes yet', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByText } = renderDrawer();

    expect(await findByText('No notes yet')).toBeTruthy();
    expect(await findByText('Tap + Note to add one without pausing.')).toBeTruthy();
  });
});

describe('NotesDrawer — list', () => {
  it('renders each note without a sermon-title line (scoped to this one sermon)', async () => {
    mockedGet.mockResolvedValue([existingNote]);
    const { findByText, queryByText } = renderDrawer();

    expect(await findByText('Grace abounds')).toBeTruthy();
    expect(queryByText('s1')).toBeNull();
  });
});

describe('NotesDrawer — create', () => {
  it('seeds the composer with the current playback position and POSTs on save', async () => {
    mockedGet.mockResolvedValue([]);
    mockedPost.mockResolvedValue({ ...existingNote, id: 'n2', position_seconds: 90, body: 'New thought' });
    const { findByText, findByLabelText, getByLabelText, getByText } = renderDrawer(() => 90);

    await findByText('No notes yet');
    fireEvent.press(await findByLabelText('Add note'));

    expect(getByText('1:30')).toBeTruthy(); // formatDuration(90)

    fireEvent.changeText(getByLabelText('Note text'), 'New thought');
    fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/sermons/{sermon_id}/notes',
        expect.objectContaining({ body: { position_seconds: 90, body: 'New thought' } }),
      ),
    );
  });

  it('disables Save while the body is empty (failure-mode guard, no blank notes)', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByText, findByLabelText, getByLabelText } = renderDrawer();

    await findByText('No notes yet');
    fireEvent.press(await findByLabelText('Add note'));

    expect(getByLabelText('Save note').props.accessibilityState.disabled).toBe(true);
  });

  it('surfaces a save failure instead of silently closing the sheet', async () => {
    mockedGet.mockResolvedValue([]);
    mockedPost.mockRejectedValue(new Error('boom'));
    const { findByText, findByLabelText, getByLabelText, getByText } = renderDrawer();

    await findByText('No notes yet');
    fireEvent.press(await findByLabelText('Add note'));
    fireEvent.changeText(getByLabelText('Note text'), 'New thought');
    fireEvent.press(getByText('Save'));

    await findByText("Couldn't save this note. Try again.");
    // Sheet stays open — the input is still there for the user to retry.
    expect(getByLabelText('Note text')).toBeTruthy();
  });
});

describe('NotesDrawer — edit', () => {
  it('opens the composer prefilled with the tapped note and PATCHes on save', async () => {
    mockedGet.mockResolvedValue([existingNote]);
    mockedPatch.mockResolvedValue({ ...existingNote, body: 'Edited' });
    const { findByText, getByLabelText } = renderDrawer();

    fireEvent.press(await findByText('Grace abounds'));
    expect(getByLabelText('Note text').props.value).toBe('Grace abounds');

    fireEvent.changeText(getByLabelText('Note text'), 'Edited');
    fireEvent.press(getByLabelText('Save note'));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith(
        '/notes/{note_id}',
        expect.objectContaining({ params: { path: { note_id: 'n1' } }, body: { body: 'Edited' } }),
      ),
    );
  });
});

describe('NotesDrawer — delete', () => {
  it('deletes a note from its own list item', async () => {
    mockedGet.mockResolvedValue([existingNote]);
    mockedDelete.mockResolvedValue(undefined);
    const { findByLabelText } = renderDrawer();

    fireEvent.press(await findByLabelText('Delete note'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/notes/{note_id}', expect.objectContaining({ params: { path: { note_id: 'n1' } } })),
    );
  });
});

describe('NotesDrawer — Android chrome', () => {
  it('renders exactly one "Add note" affordance (the extended FAB)', async () => {
    mockedUsePlatformOS.mockReturnValue('android');
    mockedGet.mockResolvedValue([]);
    const { findByText, getAllByLabelText } = renderDrawer();

    await findByText('No notes yet');
    expect(getAllByLabelText('Add note').length).toBe(1);
  });
});
