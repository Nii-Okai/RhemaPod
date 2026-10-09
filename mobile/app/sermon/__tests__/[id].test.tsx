import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';
import RNShare from 'react-native-share';
import { QueryClientProvider } from '@tanstack/react-query';
import SermonDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

jest.mock('@expo/vector-icons');

// `react-native-share` resolves its real native module (`RNShare`) at import time —
// unavailable under Jest, same gap as every other native module this app mocks. This
// screen's own Share-button coverage only needs the call to go somewhere; the actual
// composed-message/thumbnail-download logic is `lib/share/__tests__/shareContent.test.ts`'s.
jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

// Explicit factory (not a bare automock) — an automock still has to `require()` the real
// module first, which pulls in `downloadManager.ts` -> `modules/rpa-crypto`'s real native
// module resolution (unavailable under Jest). This screen's own download-affordance
// coverage lives in `components/__tests__/DownloadPillButton.test.tsx`; here it's enough
// that `useDownloads()` returns a harmless "nothing downloaded yet" shape.
jest.mock('../../../lib/downloads/useDownloads', () => ({
  useDownloads: jest.fn(() => ({
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(() => undefined),
  })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'sermon-1' };
let mockPathname = '/sermon/sermon-1';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, push: mockPush, dismissAll: mockDismissAll }),
  usePathname: () => mockPathname,
}));

const mockedGet = api.get as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const baseDetail = {
  id: 'sermon-1',
  title: 'Anchored in the Storm',
  description: 'A word for the weary.',
  thumbnail_url: 'https://cdn.example.com/art.jpg',
  duration_seconds: 1862,
  category_id: 'c1',
  category_name: 'Teaching',
  speaker_id: 'sp1',
  speaker_name: 'Ada Nwosu',
  series_id: null,
  series_title: null,
  episode_number: null,
  tier: 'free',
  locked: false,
  tags: ['grief', 'hope'],
  media_type: 'video',
  media_refs: [{ id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' }],
  published_at: '2026-09-04T12:00:00Z',
  status: 'published',
  created_at: '2026-09-01T00:00:00Z',
  like_count: 0,
  liked_by_me: false,
};

const emptySearchResults = {
  query: null,
  total: 0,
  limit: 20,
  offset: 0,
  series: [],
  series_total: 0,
  speakers: [],
  speakers_total: 0,
  results: [],
};

function mockDetailAndProgress(detail: unknown, progress: unknown = null, searchResults: unknown = emptySearchResults) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(progress);
    if (path === '/search') return Promise.resolve(searchResults);
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderDetail() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SermonDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockBack.mockClear();
  mockPush.mockClear();
  mockDismissAll.mockClear();
  mockParams = { id: 'sermon-1' };
  mockPathname = '/sermon/sermon-1';
});

describe('SermonDetailScreen — loading', () => {
  it('shows the skeleton before the detail resolves', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderDetail();

    expect(getByLabelText('Loading sermon')).toBeTruthy();
  });
});

describe('SermonDetailScreen — error', () => {
  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { findByText } = renderDetail();

    await findByText('Something went wrong loading this sermon.');

    mockDetailAndProgress(baseDetail);
    fireEvent.press(await findByText('Try again'));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/catalog/sermons/{sermon_id}', expect.anything()));
  });
});

describe('SermonDetailScreen — fresh', () => {
  it('renders Play (has video), the single published/category/tier meta line, tags, and synopsis', async () => {
    mockDetailAndProgress(baseDetail, null);
    const { findByText, getByText, getByLabelText, queryByText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(queryByText('Ada Nwosu')).toBeNull(); // speaker eyebrow removed
    expect(getByText('2026 · Teaching')).toBeTruthy(); // single meta line: year + category, no "published"
    expect(getByText('Free')).toBeTruthy(); // tier, as the shared Tag chip
    expect(getByText('A word for the weary.')).toBeTruthy();
    expect(getByText('grief')).toBeTruthy();
    expect(getByText('hope')).toBeTruthy();

    const cta = getByLabelText('Play sermon');
    expect(cta).toBeTruthy();
  });

  it('renders Listen when no video rendition exists', async () => {
    mockDetailAndProgress({
      ...baseDetail,
      media_refs: [{ id: 'm1', type: 'audio', quality: null, s3_key: 'x', hls_manifest_key: null }],
    });
    const { findByLabelText } = renderDetail();

    await findByLabelText('Listen to sermon');
  });

  it('navigates to the player route when the CTA is pressed', async () => {
    mockDetailAndProgress(baseDetail, null);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Play sermon'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } });
  });

  it('renders a flat fallback hero (no icon) when thumbnail_url is null (§8.3)', async () => {
    mockDetailAndProgress({ ...baseDetail, thumbnail_url: null });
    const { findByText, queryByRole } = renderDetail();

    await findByText('Anchored in the Storm');
    // No <Image> should have mounted — the fallback is a flat surface.sunken fill.
    expect(queryByRole('image')).toBeNull();
  });
});

describe('SermonDetailScreen — Share', () => {
  it('shares the sermon title, description, and deep link via react-native-share', async () => {
    mockDetailAndProgress(baseDetail, null);
    const openSpy = RNShare.open as jest.Mock;
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Share this sermon'));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Anchored in the Storm',
          message: expect.stringContaining('Anchored in the Storm'),
        }),
      ),
    );
    const call = openSpy.mock.calls[0][0];
    expect(call.message).toContain('A word for the weary.');
    expect(call.message).toContain('rhemapod://sermon/sermon-1');
  });
});

describe('SermonDetailScreen — Like', () => {
  it('shows the real like count and an unselected heart when the viewer has not liked it', async () => {
    mockDetailAndProgress({ ...baseDetail, like_count: 3, liked_by_me: false });
    const { findByText, getByLabelText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(getByLabelText('Like, 3 likes')).toBeTruthy();
  });

  it('likes via PUT and updates the count/heart from the response, no refetch', async () => {
    mockDetailAndProgress({ ...baseDetail, like_count: 3, liked_by_me: false });
    mockedPut.mockResolvedValue({ liked: true, like_count: 4 });
    const { findByLabelText, getByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Like, 3 likes'));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith('/catalog/sermons/{sermon_id}/like', {
        params: { path: { sermon_id: 'sermon-1' } },
      }),
    );
    await waitFor(() => expect(getByLabelText('Unlike, 4 likes')).toBeTruthy());
  });

  it('unlikes via DELETE when already liked', async () => {
    mockDetailAndProgress({ ...baseDetail, like_count: 4, liked_by_me: true });
    mockedDelete.mockResolvedValue({ liked: false, like_count: 3 });
    const { findByLabelText, getByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Unlike, 4 likes'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith('/catalog/sermons/{sermon_id}/like', {
        params: { path: { sermon_id: 'sermon-1' } },
      }),
    );
    await waitFor(() => expect(getByLabelText('Like, 3 likes')).toBeTruthy());
  });
});

describe('SermonDetailScreen — Download', () => {
  it('shows the Download pill for a playable sermon even with no audio rendition (bug fix, session 2026-10-01)', async () => {
    // baseDetail's only media_ref is `type: 'video'` — the pill used to be gated on an
    // audio rendition existing, so almost no sermon ever showed it. It now only gates on
    // `playable`, matching series detail's own Download pill (which never checks for an
    // audio rendition either).
    mockDetailAndProgress(baseDetail, null);
    const { findByLabelText } = renderDetail();

    expect(await findByLabelText('Download Anchored in the Storm')).toBeTruthy();
  });

  it('shows no Download pill when the sermon is not playable at all', async () => {
    mockDetailAndProgress({ ...baseDetail, media_refs: [] });
    const { findByText, queryByLabelText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(queryByLabelText('Download Anchored in the Storm')).toBeNull();
  });
});

describe('SermonDetailScreen — resume', () => {
  it('renders Resume with remaining time when progress exists and is incomplete', async () => {
    mockDetailAndProgress(baseDetail, {
      sermon_id: 'sermon-1',
      position_seconds: 600,
      completed: false,
      play_count: 2,
      watched_seconds: 600,
      last_played_at: '2026-09-10T00:00:00Z',
    });
    const { findByLabelText } = renderDetail();

    // The remaining time still reaches screen readers via the CTA's own accessibility
    // label — there's no separate visible "timer" line under the CTA/Download pair
    // anymore (Isaac's ask, session 2026-10-01).
    await findByLabelText('Resume sermon, 21:02 remaining');
  });

  it('falls back to Fresh (Play) when the sermon is already completed', async () => {
    mockDetailAndProgress(baseDetail, {
      sermon_id: 'sermon-1',
      position_seconds: 1862,
      completed: true,
      play_count: 3,
      watched_seconds: 1862,
      last_played_at: '2026-09-10T00:00:00Z',
    });
    const { findByLabelText } = renderDetail();

    await findByLabelText('Play sermon');
  });
});

describe('SermonDetailScreen — no-media', () => {
  it('renders the disabled "Not available yet" state with the same single meta line', async () => {
    mockDetailAndProgress({ ...baseDetail, media_refs: [] });
    const { findByText, getByText, getByLabelText, queryByText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(getByText('2026 · Teaching')).toBeTruthy();
    expect(getByText('Video is still processing — check back soon.')).toBeTruthy();

    const cta = getByLabelText('Not available yet');
    expect(cta.props.accessibilityState.disabled).toBe(true);

    // No paywall/tier wording anywhere (L1).
    expect(queryByText(/paid|membership|subscribe|upgrade/i)).toBeNull();
  });
});

describe('SermonDetailScreen — locked (interim: same as no-media, L1)', () => {
  it('renders the identical disabled no-media state for a locked sermon with media present', async () => {
    mockDetailAndProgress({
      ...baseDetail,
      locked: true,
      media_refs: [{ id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' }],
    });
    const { findByText, getByText, getByLabelText, queryByText } = renderDetail();

    await findByText('Anchored in the Storm');
    const cta = getByLabelText('Not available yet');
    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(getByText('Video is still processing — check back soon.')).toBeTruthy();
    expect(queryByText(/paid|membership|subscribe|upgrade|tier/i)).toBeNull();
  });
});

describe('SermonDetailScreen — header', () => {
  it('fires router.dismissAll() when the close control is pressed — closes every page, not just one level', async () => {
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Close'));
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('renders a disabled cast control rather than a fake working one', async () => {
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    const cast = await findByLabelText('Cast');
    expect(cast.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('renders no back control', async () => {
    mockDetailAndProgress(baseDetail);
    const { findByText, queryByLabelText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(queryByLabelText('Back')).toBeNull();
  });
});

describe('SermonDetailScreen — opened from a Related item', () => {
  it('renders a back control that fires router.back(), alongside Cast/Close', async () => {
    mockParams = { id: 'sermon-1', related: '1' };
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);

    expect(await findByLabelText('Cast')).toBeTruthy();
    expect(await findByLabelText('Close')).toBeTruthy();
  });

  it('Close still dismisses every page, not just the one drill-down level Back would', async () => {
    mockParams = { id: 'sermon-1', related: '1' };
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Close'));
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

// Design spec §8.7 (W4.7 accessibility pass): "the title block... must not truncate or
// clip at large accessibility text sizes — no fixed height on its container, allow wrap
// past two lines." Real-device VoiceOver/Dynamic-Type verification isn't available in this
// sandbox (flagged in status.md) — this proves the same thing at the render-tree level:
// the title carries no `numberOfLines` cap, and its computed `lineHeight` actually grows
// under the OS's largest accessibility text-size setting rather than staying fixed.
describe('SermonDetailScreen — dynamic type (largest accessibility text size)', () => {
  const ORIGINAL_FONT_SCALE = PixelRatio.getFontScale();

  afterEach(() => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(ORIGINAL_FONT_SCALE);
  });

  it('never caps the title with numberOfLines, and grows its line-height under a large OS font scale', async () => {
    // iOS's largest non-"larger accessibility" Dynamic Type step is ~3.11x (AX5); Android's
    // largest standard font-scale setting is 2.0x — 3.11 exercises the larger of the two.
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(3.11);

    mockDetailAndProgress(baseDetail);
    const { findByText } = renderDetail();

    const title = await findByText('Anchored in the Storm');
    expect(title.props.numberOfLines).toBeUndefined();

    const flatStyle = Array.isArray(title.props.style)
      ? Object.assign({}, ...title.props.style.flat(Infinity).filter(Boolean))
      : title.props.style;
    // display.compact is fontSize 17, lineHeightRatio 1.2 — 17 * 1.2 * 3.11 ≈ 63.
    expect(flatStyle.lineHeight).toBeGreaterThan(60);
  });
});

describe('SermonDetailScreen — Related', () => {
  const relatedResults = {
    query: null,
    total: 2,
    limit: 20,
    offset: 0,
    series: [],
    series_total: 0,
    speakers: [],
    speakers_total: 0,
    results: [
      { ...baseDetail, id: 'sermon-1', title: 'Anchored in the Storm' }, // itself — must be excluded
      { ...baseDetail, id: 'sermon-2', title: 'Standing Firm', speaker_name: 'Pastor Grace' },
    ],
  };

  it('shows other sermons sharing the category, excluding this sermon itself', async () => {
    mockDetailAndProgress(baseDetail, null, relatedResults);
    const { findByLabelText, queryAllByLabelText } = renderDetail();

    expect(await findByLabelText('Standing Firm')).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { category_id: 'c1' } } }),
    );
    // The screen's own title is plain text, not an accessibility-labeled control — if the
    // self-referencing related card weren't excluded, this would find exactly one (the
    // card), since `AppText` never sets `accessibilityLabel` on its own.
    expect(queryAllByLabelText('Anchored in the Storm')).toHaveLength(0);
  });

  it('navigates to /sermon/[id] when a related sermon is pressed', async () => {
    mockDetailAndProgress(baseDetail, null, relatedResults);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Standing Firm'));
    // Pushes the *second* route (`sermon/related/[id]`, not this screen's own
    // `sermon/[id]`) so the regular horizontal push applies — see
    // `app/sermon/related/[id].tsx`'s own doc comment. `related: '1'` still rides along
    // so the screen itself shows a back chevron alongside Cast/Close.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related/[id]',
      params: { id: 'sermon-2', related: '1' },
    });
  });

  it('alternates to the second Related route when already on a Related screen (two consecutive taps must not repeat the same route name)', async () => {
    mockPathname = '/sermon/related/sermon-1';
    mockDetailAndProgress(baseDetail, null, relatedResults);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Standing Firm'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sermon/related2/[id]',
      params: { id: 'sermon-2', related: '1' },
    });
  });

  it('shows an honest empty state when nothing else shares the category', async () => {
    mockDetailAndProgress(baseDetail);
    const { findByText } = renderDetail();

    await findByText('No related sermons yet.');
  });
});

// Pull-to-dismiss is the Stack screen's own native gesture now (`app/_layout.tsx`'s
// `gestureDirection: 'vertical'`), not a hand-rolled scroll/animation handler this
// screen owns — it has no component-level behavior left to unit test here. See
// `app/_layout.tsx`'s doc comment on `sermon/[id]`'s `Stack.Screen` for why.
