import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import SermonDetailScreen from '../[id]';
import { api } from '../../../lib/api/typedClient';
import { usePlatformOS } from '../../../components/navigation/platform';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

jest.mock('../../../components/navigation/platform', () => ({
  usePlatformOS: jest.fn(() => 'ios'),
}));

jest.mock('@expo/vector-icons');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'sermon-1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

const mockedGet = api.get as jest.Mock;
const mockedUsePlatformOS = usePlatformOS as jest.Mock;

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
  media_refs: [{ id: 'm1', type: 'video', quality: '720p', s3_key: 'x', hls_manifest_key: 'y' }],
  published_at: '2026-09-04T12:00:00Z',
  status: 'published',
  created_at: '2026-09-01T00:00:00Z',
};

function mockDetailAndProgress(detail: unknown, progress: unknown = null) {
  mockedGet.mockImplementation((path: string) => {
    if (path === '/catalog/sermons/{sermon_id}') return Promise.resolve(detail);
    if (path === '/sermons/{sermon_id}/progress') return Promise.resolve(progress);
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
  mockedUsePlatformOS.mockReturnValue('ios');
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
  it('renders Play (has video), full duration, tags, and synopsis', async () => {
    mockDetailAndProgress(baseDetail, null);
    const { findByText, getByText, getByLabelText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(getByText('Teaching · Ada Nwosu')).toBeTruthy();
    expect(getByText('Standalone · 31:02 · video')).toBeTruthy();
    expect(getByText('published Sep 4 · 1 rendition')).toBeTruthy();
    expect(getByText('A word for the weary.')).toBeTruthy();
    expect(getByText('grief')).toBeTruthy();
    expect(getByText('hope')).toBeTruthy();

    const cta = getByLabelText('Play sermon');
    expect(cta).toBeTruthy();
    expect(getByText('31:02')).toBeTruthy();
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
    const { findByLabelText, getByText } = renderDetail();

    await findByLabelText('Resume sermon, 21:02 remaining');
    expect(getByText('21:02')).toBeTruthy();
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
  it('renders the disabled "Not available yet" state and omits the format/renditions segments', async () => {
    mockDetailAndProgress({ ...baseDetail, media_refs: [] });
    const { findByText, getByText, getByLabelText, queryByText } = renderDetail();

    await findByText('Anchored in the Storm');
    expect(getByText('Standalone · 31:02')).toBeTruthy();
    expect(getByText('published Sep 4')).toBeTruthy();
    expect(queryByText(/renditions?/)).toBeNull();
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

describe('SermonDetailScreen — back control', () => {
  it('fires router.back() from the back IconButton', async () => {
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    fireEvent.press(await findByLabelText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('SermonDetailScreen — Android chrome', () => {
  it('renders a solid top app bar back control on Android too', async () => {
    mockedUsePlatformOS.mockReturnValue('android');
    mockDetailAndProgress(baseDetail);
    const { findByLabelText } = renderDetail();

    expect(await findByLabelText('Back')).toBeTruthy();
  });
});
