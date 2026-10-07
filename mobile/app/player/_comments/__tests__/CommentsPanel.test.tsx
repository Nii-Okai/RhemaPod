import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { CommentsPanel } from '../CommentsPanel';
import { api } from '../../../../lib/api/typedClient';
import { ApiError } from '../../../../lib/api/errors';
import { useIsOnline } from '../../../../lib/hooks/useIsOnline';
import { hasSeenAppearAsNotice } from '../../../../lib/settings/commentsNotice';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import { __resetReportedCommentIdsForTests } from '../../../../lib/query/hooks/useComments';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../../lib/hooks/useIsOnline', () => ({ useIsOnline: jest.fn(() => true) }));
// These flow tests exercise the name-then-terms-then-post gating, not the I2-pending
// release gate (covered on its own in TermsSheet.test.tsx against the real, still-pending
// COMMENTS_TERMS_TEXT) — stand in a shipped-looking string so "Agree and continue" only
// gates on the checkbox here, matching production once I2 lands.
jest.mock('../../../../lib/content/commentsCompliance', () => {
  const actual = jest.requireActual('../../../../lib/content/commentsCompliance');
  return { ...actual, COMMENTS_TERMS_TEXT: 'Be respectful. No harassment, hate or sexual content.' };
});
jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../../lib/settings/commentsNotice', () => {
  const actual = jest.requireActual('../../../../lib/settings/commentsNotice');
  // Wraps the real implementation by default so every existing notice test is unaffected;
  // individual tests can override with mockRejectedValueOnce to exercise the .catch fallback.
  return { ...actual, hasSeenAppearAsNotice: jest.fn(actual.hasSeenAppearAsNotice) };
});
jest.mock('expo-sqlite/kv-store', () => {
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;
const mockedOnline = useIsOnline as jest.Mock;

type Row = {
  id: string;
  sermon_id: string;
  author_display_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
  status: 'VISIBLE' | 'HIDDEN';
  hidden_label: 'under_review' | 'removed_by_moderator' | null;
};

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    sermon_id: 's1',
    author_display_name: 'Pat Q.',
    body: `Body of ${id}`,
    created_at: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    is_mine: false,
    status: 'VISIBLE',
    hidden_label: null,
    ...overrides,
  };
}

const readyUser = {
  id: 'user-1',
  email: 'ada@example.com',
  full_name: 'Ada Nwosu',
  role: 'member',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  activated_at: '2024-01-02T00:00:00Z',
  comments_terms_accepted_at: '2026-10-01T00:00:00Z',
};

let db: Row[];
let user: typeof readyUser | (Omit<typeof readyUser, 'full_name' | 'comments_terms_accepted_at'> & {
  full_name: string | null;
  comments_terms_accepted_at: string | null;
});

function serve() {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(user);
    if (path === '/sermons/{sermon_id}/comments') {
      return Promise.resolve({ items: db, total: db.length, limit: 25, offset: 0 });
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderPanel() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CommentsPanel sermonId="s1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.useRealTimers();
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedPatch.mockReset();
  mockedDelete.mockReset();
  mockedOnline.mockReturnValue(true);
  __resetReportedCommentIdsForTests();
  jest.requireMock('expo-sqlite/kv-store').AsyncStorage.__reset();
  db = [row('c1'), row('c2', { author_display_name: 'Lee R.' })];
  user = { ...readyUser };
  serve();
});

async function type(utils: ReturnType<typeof renderPanel>, text: string) {
  await act(async () => {
    fireEvent.changeText(utils.getByLabelText('Write a comment'), text);
  });
}

describe('CommentsPanel — list', () => {
  it('shows the count header and the rows, newest first, with no sort or like controls', async () => {
    const { findByText, getByText, queryByText } = renderPanel();
    expect(await findByText('2 comments')).toBeTruthy();
    expect(getByText('Body of c1')).toBeTruthy();
    expect(getByText('Body of c2')).toBeTruthy();
    expect(queryByText(/top|recent|sort|like/i)).toBeNull();
  });

  it('uses the singular for one comment and shows the empty state for none', async () => {
    db = [row('c1')];
    const one = renderPanel();
    expect(await one.findByText('1 comment')).toBeTruthy();
    one.unmount();

    db = [];
    const none = renderPanel();
    expect(await none.findByText('No comments yet. Be the first to share.')).toBeTruthy();
    expect(none.getByText('0 comments')).toBeTruthy();
  });

  it('shows a load error with a working retry', async () => {
    mockedGet.mockImplementation((path: string) =>
      path === '/auth/me' ? Promise.resolve(user) : Promise.reject(new ApiError(500, 'boom')),
    );
    const { findByText } = renderPanel();
    await findByText("Couldn't load comments.");

    serve();
    fireEvent.press(await findByText('Try again'));
    expect(await findByText('Body of c1')).toBeTruthy();
  });

  it('renders the offline state in place of the list and composer, without fetching comments', async () => {
    mockedOnline.mockReturnValue(false);
    const { findByText, queryByLabelText } = renderPanel();
    expect(await findByText('Comments unavailable offline')).toBeTruthy();
    expect(queryByLabelText('Write a comment')).toBeNull();
    expect(mockedGet).not.toHaveBeenCalledWith('/sermons/{sermon_id}/comments', expect.anything());
  });
});

describe('CommentsPanel — own hidden comments', () => {
  it('renders an auto-hidden own comment from status + hidden_label, never showing its body, with no actions', async () => {
    db = [row('mine', { is_mine: true, author_display_name: 'Ada N.', status: 'HIDDEN', hidden_label: 'under_review', body: 'SECRET BODY' })];
    const { findByText, queryByText, queryByLabelText } = renderPanel();
    expect(await findByText('Under review. This comment is hidden while we check it.')).toBeTruthy();
    expect(queryByText('SECRET BODY')).toBeNull();
    expect(queryByLabelText('Delete your comment')).toBeNull();
    expect(queryByLabelText(/Report comment/)).toBeNull();
  });

  it('renders a moderator-removed own comment without naming anyone', async () => {
    db = [row('mine', { is_mine: true, author_display_name: 'Ada N.', status: 'HIDDEN', hidden_label: 'removed_by_moderator', body: 'SECRET BODY' })];
    const { findByText, queryByText, queryByLabelText } = renderPanel();
    expect(await findByText('Removed by a moderator.')).toBeTruthy();
    expect(queryByText('SECRET BODY')).toBeNull();
    expect(queryByLabelText('Delete your comment')).toBeNull();
  });
});

describe('CommentsPanel — posting', () => {
  it('is not optimistic: the server row is prepended once the POST resolves, and the draft clears', async () => {
    let resolvePost: (value: Row) => void = () => {};
    mockedPost.mockReturnValue(new Promise<Row>((resolve) => (resolvePost = resolve)));
    const utils = renderPanel();
    await utils.findByText('Body of c1');

    await type(utils, 'Amen to that');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/sermons/{sermon_id}/comments', {
      params: { path: { sermon_id: 's1' } },
      body: { body: 'Amen to that' },
    });
    expect(utils.queryByText('Amen to that')).toBeNull(); // nothing shown before the server answers

    await act(async () => resolvePost(row('new', { is_mine: true, author_display_name: 'Ada N.', body: 'Amen to that' })));
    expect(await utils.findByText('Amen to that')).toBeTruthy();
    expect(utils.getByText('3 comments')).toBeTruthy();
    expect(utils.getByLabelText('Write a comment').props.value).toBe('');
  });

  it('keeps the draft and shows the server message when the post is rejected (422), with no client URL pre-check', async () => {
    mockedPost.mockRejectedValue(new ApiError(422, 'Links are not allowed in comments.'));
    const utils = renderPanel();
    await utils.findByText('Body of c1');

    await type(utils, 'see http://example.com');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });

    // The URL reached the server untouched — the client does not pre-check.
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(await utils.findByText('Links are not allowed in comments.')).toBeTruthy();
    expect(utils.getByLabelText('Write a comment').props.value).toBe('see http://example.com');
  });

  it('shows the rate-limit message on a 429', async () => {
    mockedPost.mockRejectedValue(new ApiError(429, 'Too many requests'));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await type(utils, 'hello');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(await utils.findByText("You're posting too fast. Try again in a minute.")).toBeTruthy();
  });

  it('disables send for empty or whitespace-only drafts', async () => {
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await type(utils, '   ');
    expect(utils.getByLabelText('Post comment').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('guards against a double-tap sending twice before isPosting re-renders', async () => {
    let resolvePost: (value: Row) => void = () => {};
    mockedPost.mockReturnValue(new Promise<Row>((resolve) => (resolvePost = resolve)));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await type(utils, 'hello');

    act(() => {
      fireEvent.press(utils.getByLabelText('Post comment'));
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    // The two presses land in the same tick (deliberately, via the sync `act` above, to
    // simulate a double-tap before `isPosting` re-renders) — but `mutateAsync` dispatching
    // through to `mockedPost` still needs a microtask tick to run. Flush one before
    // checking the guard actually limited it to a single call.
    await act(async () => {});

    expect(mockedPost).toHaveBeenCalledTimes(1);
    await act(async () => resolvePost(row('new', { is_mine: true, author_display_name: 'Ada N.', body: 'hello' })));
    expect(await utils.findByText('hello')).toBeTruthy();
  });

  it('does not clobber text typed while the post is still in flight', async () => {
    let resolvePost: (value: Row) => void = () => {};
    mockedPost.mockReturnValue(new Promise<Row>((resolve) => (resolvePost = resolve)));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await type(utils, 'hello');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(mockedPost).toHaveBeenCalledTimes(1);

    // Typed more while the first POST is still in flight.
    await type(utils, 'hello world');

    await act(async () => resolvePost(row('new', { is_mine: true, author_display_name: 'Ada N.', body: 'hello' })));
    // The draft wasn't cleared: what's shown no longer matches what was actually sent.
    expect(utils.getByLabelText('Write a comment').props.value).toBe('hello world');
  });
});

describe('CommentsPanel — name and terms gating', () => {
  it('asks for a name first when full_name is blank, keeps the draft, and does not post', async () => {
    user = { ...readyUser, full_name: null, comments_terms_accepted_at: null };
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));

    await type(utils, 'my draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });

    expect(await utils.findByText('Add your name')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(utils.getByLabelText('Write a comment').props.value).toBe('my draft');
  });

  it('walks name then terms, then lets the same draft post', async () => {
    user = { ...readyUser, full_name: null, comments_terms_accepted_at: null };
    mockedPatch.mockImplementation(async (_path: string, opts: { body: { full_name: string } }) => {
      user = { ...user, full_name: opts.body.full_name };
      return user;
    });
    mockedPost.mockImplementation(async (path: string) => {
      if (path === '/me/comments-terms') {
        user = { ...user, comments_terms_accepted_at: '2026-10-02T00:00:00Z' };
        return undefined;
      }
      return row('new', { is_mine: true, author_display_name: 'Ada N.', body: 'my draft' });
    });

    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await type(utils, 'my draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });

    // Name step: live "First L." preview, then save.
    await utils.findByText('Add your name');
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Full name'), 'Ada Nwosu');
    });
    expect(utils.getByText("You'll appear as Ada N.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getByText('Save and continue'));
    });
    expect(mockedPatch).toHaveBeenCalledWith('/auth/me', { body: { full_name: 'Ada Nwosu' } });

    // Terms step: agree is gated on the checkbox.
    await utils.findByText('Comment guidelines');
    expect(utils.getByRole('button', { name: 'Agree and continue' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(utils.getByLabelText('I agree to the comment guidelines'));
    await act(async () => {
      fireEvent.press(utils.getByRole('button', { name: 'Agree and continue' }));
    });
    expect(mockedPost).toHaveBeenCalledWith('/me/comments-terms');
    await waitFor(() => expect(utils.queryByText('Comment guidelines')).toBeNull());

    // Nothing was posted by the prompts themselves; the draft is intact and now posts.
    expect(mockedPost).not.toHaveBeenCalledWith('/sermons/{sermon_id}/comments', expect.anything());
    expect(utils.getByLabelText('Write a comment').props.value).toBe('my draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(mockedPost).toHaveBeenCalledWith('/sermons/{sermon_id}/comments', expect.anything());
  });

  it('declining the terms sheet ("Not now") closes it, keeps the draft, posts nothing and never calls /me/comments-terms', async () => {
    user = { ...readyUser, comments_terms_accepted_at: null };
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await type(utils, 'my draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    await utils.findByText('Comment guidelines');

    await act(async () => {
      fireEvent.press(utils.getByText('Not now'));
    });

    expect(utils.queryByText('Comment guidelines')).toBeNull();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalledWith('/me/comments-terms');
    expect(mockedPost).not.toHaveBeenCalledWith('/sermons/{sermon_id}/comments', expect.anything());
    expect(utils.getByLabelText('Write a comment').props.value).toBe('my draft');
  });

  it('shows the generic server message when a name is rejected (422) and does not proceed', async () => {
    user = { ...readyUser, full_name: null, comments_terms_accepted_at: null };
    mockedPatch.mockRejectedValue(new ApiError(422, "This name can't be used"));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await type(utils, 'draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Full name'), 'Dr Nobody');
    });
    await act(async () => {
      fireEvent.press(utils.getByText('Save and continue'));
    });
    expect(await utils.findByText("This name can't be used")).toBeTruthy();
    expect(utils.queryByText('Comment guidelines')).toBeNull();
  });

  it('offers no nickname hint in the name prompt (real name only)', async () => {
    user = { ...readyUser, full_name: null, comments_terms_accepted_at: null };
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await type(utils, 'draft');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    await utils.findByText('Add your name');
    expect(utils.queryByText(/nickname/i)).toBeNull();
  });

  it('backstop: a server 403 re-reads the profile and reopens the terms sheet', async () => {
    // The pre-check passes (cached profile says terms accepted) but the server disagrees.
    mockedPost.mockRejectedValue(new ApiError(403, 'forbidden'));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    await type(utils, 'hello');

    user = { ...readyUser, comments_terms_accepted_at: null as unknown as string };
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Post comment'));
    });
    expect(await utils.findByText('Comment guidelines')).toBeTruthy();
    expect(utils.getByLabelText('Write a comment').props.value).toBe('hello');
  });
});

describe('CommentsPanel — one-time "appear as" notice', () => {
  it('shows once with the public name, and stays dismissed afterwards', async () => {
    const first = renderPanel();
    expect(await first.findByText("You'll appear as 'Ada N.'")).toBeTruthy();
    await act(async () => {
      fireEvent.press(first.getByLabelText('Dismiss'));
    });
    expect(first.queryByText("You'll appear as 'Ada N.'")).toBeNull();
    first.unmount();

    const second = renderPanel();
    await second.findByText('Body of c1');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/auth/me', expect.anything()));
    expect(second.queryByText("You'll appear as 'Ada N.'")).toBeNull();
  });

  it('"Change" opens the name editor', async () => {
    const utils = renderPanel();
    await utils.findByText("You'll appear as 'Ada N.'");
    fireEvent.press(utils.getByText('Change'));
    expect(await utils.findByText('Your name')).toBeTruthy();
  });

  it('falls back to "not seen" without crashing when the local seen-flag read rejects', async () => {
    (hasSeenAppearAsNotice as jest.Mock).mockRejectedValueOnce(new Error('kv-store unavailable'));
    const utils = renderPanel();
    expect(await utils.findByText("You'll appear as 'Ada N.'")).toBeTruthy();
  });
});

describe('CommentsPanel — delete', () => {
  it('confirms, removes the row optimistically, and calls DELETE /comments/{id}', async () => {
    db = [row('mine', { is_mine: true, author_display_name: 'Ada N.', body: 'My own words' }), row('c2')];
    mockedDelete.mockImplementation(async () => {
      db = db.filter((r) => r.id !== 'mine');
    });
    const utils = renderPanel();
    await utils.findByText('My own words');

    fireEvent.press(utils.getByLabelText('Delete your comment'));
    expect(await utils.findByText('Delete this comment?')).toBeTruthy();
    expect(mockedDelete).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Delete'));
    });

    expect(mockedDelete).toHaveBeenCalledWith('/comments/{comment_id}', { params: { path: { comment_id: 'mine' } } });
    await waitFor(() => expect(utils.queryByText('My own words')).toBeNull());
  });

  it('puts the row back and says so when the delete fails', async () => {
    db = [row('mine', { is_mine: true, author_display_name: 'Ada N.', body: 'My own words' })];
    mockedDelete.mockRejectedValue(new ApiError(409, 'Conflict'));
    const utils = renderPanel();
    await utils.findByText('My own words');
    fireEvent.press(utils.getByLabelText('Delete your comment'));
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Delete'));
    });
    expect(await utils.findByText("Couldn't delete. Try again.")).toBeTruthy();
    expect(await utils.findByText('My own words')).toBeTruthy();
  });

  it('does nothing when the confirm is cancelled', async () => {
    db = [row('mine', { is_mine: true, author_display_name: 'Ada N.', body: 'My own words' })];
    const utils = renderPanel();
    await utils.findByText('My own words');
    fireEvent.press(utils.getByLabelText('Delete your comment'));
    fireEvent.press(await utils.findByText('Cancel'));
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(utils.getByText('My own words')).toBeTruthy();
  });
});

describe('CommentsPanel — report', () => {
  it('submits the chosen reason, hides the row, and confirms', async () => {
    mockedPost.mockResolvedValue(undefined);
    const utils = renderPanel();
    await utils.findByText('Body of c1');

    fireEvent.press(utils.getAllByLabelText('Report comment by Pat Q.')[0]!);
    await utils.findByText('Why are you reporting this?');
    expect(utils.getByRole('button', { name: 'Submit report' }).props.accessibilityState.disabled).toBe(true);

    fireEvent.press(utils.getByLabelText('Harassment or bullying'));
    await act(async () => {
      fireEvent.press(utils.getByRole('button', { name: 'Submit report' }));
    });

    expect(mockedPost).toHaveBeenCalledWith('/comments/{comment_id}/report', {
      params: { path: { comment_id: 'c1' } },
      body: { reason: 'harassment' },
    });
    expect(await utils.findByText("Thanks. We'll review this comment.")).toBeTruthy();
    expect(utils.queryByText('Body of c1')).toBeNull();
  });

  it('sends the optional detail for "Something else"', async () => {
    mockedPost.mockResolvedValue(undefined);
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    fireEvent.press(utils.getAllByLabelText('Report comment by Pat Q.')[0]!);
    fireEvent.press(await utils.findByLabelText('Something else'));
    fireEvent.changeText(utils.getByLabelText('Optional details'), 'It targets a child');
    await act(async () => {
      fireEvent.press(utils.getByRole('button', { name: 'Submit report' }));
    });
    expect(mockedPost).toHaveBeenCalledWith('/comments/{comment_id}/report', {
      params: { path: { comment_id: 'c1' } },
      body: { reason: 'other', detail: 'It targets a child' },
    });
  });

  it('treats self-harm as an ordinary reason with no special UI', async () => {
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    fireEvent.press(utils.getAllByLabelText('Report comment by Pat Q.')[0]!);
    fireEvent.press(await utils.findByLabelText('Self-harm or safety concern'));
    expect(utils.queryByText(/emergency|crisis|hotline|call/i)).toBeNull();
  });

  it('keeps the row and shows an inline error when reporting fails (429)', async () => {
    mockedPost.mockRejectedValue(new ApiError(429, 'slow'));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    fireEvent.press(utils.getAllByLabelText('Report comment by Pat Q.')[0]!);
    fireEvent.press(await utils.findByLabelText('Spam'));
    await act(async () => {
      fireEvent.press(utils.getByRole('button', { name: 'Submit report' }));
    });
    expect(await utils.findByText("You're reporting too fast. Try again later.")).toBeTruthy();
    expect(utils.getByText('Body of c1')).toBeTruthy();
  });
});

describe('CommentsPanel — block', () => {
  it('confirms, removes the author optimistically, and offers Undo that calls DELETE /me/blocks/{id}', async () => {
    db = [row('c1'), row('c3'), row('c2', { author_display_name: 'Lee R.' })];
    mockedPost.mockImplementation(async () => {
      db = db.filter((r) => r.author_display_name !== 'Pat Q.');
      return { id: 'block-7' };
    });
    mockedDelete.mockResolvedValue(undefined);
    const utils = renderPanel();
    await utils.findByText('Body of c1');

    fireEvent.press(utils.getAllByLabelText('Block Pat Q.')[0]!);
    expect(await utils.findByText('Block Pat Q.?')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Block'));
    });

    expect(mockedPost).toHaveBeenCalledWith('/comments/{comment_id}/block', { params: { path: { comment_id: 'c1' } } });
    await waitFor(() => expect(utils.queryByText('Body of c1')).toBeNull());
    expect(utils.queryByText('Body of c3')).toBeNull(); // every row by that author
    expect(utils.getByText('Body of c2')).toBeTruthy();
    expect(await utils.findByText('Pat Q. blocked.')).toBeTruthy();

    await act(async () => {
      fireEvent.press(utils.getByText('Undo'));
    });
    expect(mockedDelete).toHaveBeenCalledWith('/me/blocks/{block_id}', { params: { path: { block_id: 'block-7' } } });
  });

  it('keeps the blocked confirmation and Undo up past MESSAGE_MS — too short for screen-reader/motor-impaired users', async () => {
    jest.useFakeTimers();
    mockedPost.mockResolvedValue({ id: 'block-7' });
    const utils = renderPanel();
    await utils.findByText('Body of c1');

    fireEvent.press(utils.getAllByLabelText('Block Pat Q.')[0]!);
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Block'));
    });
    expect(await utils.findByText('Pat Q. blocked.')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(utils.getByText('Pat Q. blocked.')).toBeTruthy();
    expect(utils.getByText('Undo')).toBeTruthy();
    jest.useRealTimers();
  });

  it('can be started from inside the report sheet, before any report is filed', async () => {
    mockedPost.mockResolvedValue({ id: 'block-8' });
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    fireEvent.press(utils.getAllByLabelText('Report comment by Pat Q.')[0]!);
    await utils.findByText('Why are you reporting this?');

    const sheetBlock = utils.getAllByLabelText('Block Pat Q.');
    fireEvent.press(sheetBlock[sheetBlock.length - 1]!);
    expect(await utils.findByText('Block Pat Q.?')).toBeTruthy();
    // No report was sent just to reach the block.
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('restores the rows and says so when the block fails', async () => {
    mockedPost.mockRejectedValue(new ApiError(500, 'boom'));
    const utils = renderPanel();
    await utils.findByText('Body of c1');
    fireEvent.press(utils.getAllByLabelText('Block Pat Q.')[0]!);
    await act(async () => {
      fireEvent.press(await utils.findByLabelText('Block'));
    });
    expect(await utils.findByText("Couldn't block. Try again.")).toBeTruthy();
    expect(await utils.findByText('Body of c1')).toBeTruthy();
  });

  it('keeps Undo off the message when there was nothing to block (own comment: id null)', async () => {
    db = [row('mine', { is_mine: false })];
    mockedPost.mockResolvedValue({ id: null });
    const utils = renderPanel();
    await utils.findByText('Body of mine');
    fireEvent.press(utils.getAllByLabelText('Block Pat Q.')[0]!);
    await act(async () => {
      fireEvent.press(await utils.findByLabelText('Block'));
    });
    await utils.findByText('Pat Q. blocked.');
    const message = utils.getByText('Pat Q. blocked.');
    expect(within(message.parent!.parent!).queryByText('Undo')).toBeNull();
  });
});
