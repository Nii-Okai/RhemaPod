import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import SermonDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/featureFlags', () => ({
  SIGNATURE_HOME_ENABLED: false,
  SIGNATURE_NOTIFICATIONS_ENABLED: false,
  SIGNATURE_PLAYER_ENABLED: true,
}));

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
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
const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = { id: 'sermon-1' };
let mockPathname = '/sermon/sermon-1';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, push: mockPush, dismissAll: mockDismissAll, replace: mockReplace }),
  usePathname: () => mockPathname,
}));

const mockedGet = api.get as jest.Mock;
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

function renderDetail(detail: unknown) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(null);
    if (path === '/search') return Promise.resolve({ query: null, total: 0, limit: 20, offset: 0, series: [], series_total: 0, speakers: [], speakers_total: 0, results: [] });
    if (path === '/playlists') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SermonDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockReplace.mockClear();
  mockParams = { id: 'sermon-1' };
});

describe('SermonDetailScreen with the Signature player', () => {
  it('opens a standalone sermon straight in the player', async () => {
    const screen = renderDetail(baseDetail);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/player/[id]', params: { id: 'sermon-1' } }));
    expect(screen.queryByText('Anchored in the Storm')).toBeNull();
  });

  it('keeps the detail page for a series episode', async () => {
    const screen = renderDetail({ ...baseDetail, series_id: 'se1', series_title: 'Storms', episode_number: 1 });
    expect(await screen.findByText('Anchored in the Storm')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps the detail page for a sermon with nothing to play yet', async () => {
    const screen = renderDetail({ ...baseDetail, media_refs: [] });
    expect(await screen.findByText('Anchored in the Storm')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
