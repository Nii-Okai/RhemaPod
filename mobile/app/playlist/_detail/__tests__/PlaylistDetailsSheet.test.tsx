import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { PlaylistDetailsSheet } from '../PlaylistDetailsSheet';
import { ApiError } from '../../../../lib/api/errors';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedGet = api.get as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

function playlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Morning Dew',
    description: null,
    is_public: false,
    is_owner: true,
    cover_url: null,
    owner_name: 'Nii K. O.',
    item_count: 0,
    total_duration_seconds: 0,
    created_at: '2026-10-10T00:00:00Z',
    updated_at: null,
    items: [],
    ...overrides,
  };
}

function renderSheet(overrides: Record<string, unknown> = {}, onClose = jest.fn()) {
  const client = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <PlaylistDetailsSheet visible onClose={onClose} onDeleted={jest.fn()} playlist={playlist(overrides) as never} />
    </QueryClientProvider>,
  );
  return { ...view, onClose };
}

describe('PlaylistDetailsSheet', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedGet.mockReset();
    mockedPatch.mockReset();
    mockedGet.mockResolvedValue({ id: 'u1', full_name: 'Nii Kwame Okai' });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alertSpy.mockRestore());

  const press = (label: string) => {
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === label)!.onPress?.();
  };

  async function pressMakePublic(view: ReturnType<typeof renderSheet>) {
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await waitFor(() => expect(view.getByLabelText('Make public').props.accessibilityState.disabled).toBeFalsy());
    fireEvent.press(view.getByLabelText('Make public'));
  }

  it('Make public asks first, naming the owner as First L.; No sends nothing', async () => {
    const view = renderSheet();
    await pressMakePublic(view);

    expect(alertSpy.mock.calls[0]![0]).toBe('Make this playlist public?');
    expect(alertSpy.mock.calls[0]![1]).toBe(
      "Anyone with the link can see it and its sermons. Your name shows as 'Nii O.'.",
    );
    press('No');
    expect(mockedPatch).not.toHaveBeenCalled();
  });

  it('is disabled while the profile loads, so the prompt never says a placeholder name', () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    const view = renderSheet();
    expect(view.getByLabelText('Make public').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(view.getByLabelText('Make public'));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Yes PATCHes is_public true and does not open any share sheet', async () => {
    mockedPatch.mockResolvedValue(playlist({ is_public: true }));
    const view = renderSheet();
    await pressMakePublic(view);
    press('Yes');

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/playlists/{playlist_id}', {
        params: { path: { playlist_id: 'p1' } },
        body: { is_public: true },
      }),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('Yes + 422: shows the server message and the playlist stays private', async () => {
    mockedPatch.mockRejectedValue(new ApiError(422, 'Links are not allowed in public playlists'));
    const view = renderSheet();
    await pressMakePublic(view);
    press('Yes');

    expect(await view.findByText('Links are not allowed in public playlists')).toBeTruthy();
    expect(view.getByLabelText('Make public')).toBeTruthy();
  });

  it('Yes + other failure: shows the generic message', async () => {
    mockedPatch.mockRejectedValue(new ApiError(500, 'boom'));
    const view = renderSheet();
    await pressMakePublic(view);
    press('Yes');
    expect(await view.findByText("Couldn't make this playlist public. Try again.")).toBeTruthy();
  });

  it('Make private: no prompt, PATCHes is_public false', async () => {
    mockedPatch.mockResolvedValue(playlist({ is_public: false }));
    const view = renderSheet({ is_public: true });
    fireEvent.press(view.getByLabelText('Make private'));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/playlists/{playlist_id}', {
        params: { path: { playlist_id: 'p1' } },
        body: { is_public: false },
      }),
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Make private failure shows a message', async () => {
    mockedPatch.mockRejectedValue(new ApiError(500, 'boom'));
    const view = renderSheet({ is_public: true });
    fireEvent.press(view.getByLabelText('Make private'));
    expect(await view.findByText("Couldn't make this playlist private. Try again.")).toBeTruthy();
  });

  it('Save + 422 shows the server detail, not the generic copy', async () => {
    mockedPatch.mockRejectedValue(new ApiError(422, 'Links are not allowed in public playlists'));
    const view = renderSheet({ is_public: true });
    fireEvent.press(view.getByText('Save'));
    expect(await view.findByText('Links are not allowed in public playlists')).toBeTruthy();
  });

  it('Save + other failure shows the generic copy and keeps the sheet open', async () => {
    mockedPatch.mockRejectedValue(new ApiError(500, 'boom'));
    const { findByText, getByText, onClose } = renderSheet();
    fireEvent.press(getByText('Save'));
    expect(await findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
