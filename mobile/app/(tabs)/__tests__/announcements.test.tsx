import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Image, Platform } from 'react-native';
import AnnouncementsScreen from '../announcements';
import { AnnouncementCard } from '../../../components/announcements/AnnouncementCard';
import { api } from '../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));
// The screen gained a back button (`useRouter`) and safe-area padding after this file
// was written. Mocked the same way `me.test.tsx` does: the real `expo-router` pulls in
// `expo-linking`'s ESM build, which this Jest config doesn't transform, and there is no
// `SafeAreaProvider` in a unit render.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedGet = api.get as jest.Mock;

// Server returns pinned/unpinned interleaved on purpose here — proves the
// screen's own pinned-first re-sort (`sortPinnedFirst`) works even when the
// caller can't rely on response order.
const announcements = [
  {
    id: 'a1',
    title: 'Volunteers needed for the food pantry',
    description: 'Saturday mornings, two-hour shifts. Speak to Ruth if you can take one.',
    image_url: null,
    pinned: false,
    // Far in the past — still rendered, proving no client-side date filtering
    // (the server already windows visibility server-side).
    publish_at: '2020-01-01T00:00:00Z',
    created_at: '2020-01-01T00:00:00Z',
  },
  {
    id: 'a2',
    title: 'Baptism Sunday · October 4',
    description: 'Sign up at the welcome desk or in the app.',
    image_url: 'https://cdn.example.com/baptism.jpg',
    pinned: true,
    publish_at: '2026-09-08T00:00:00Z',
    created_at: '2026-09-08T00:00:00Z',
  },
  {
    id: 'a3',
    title: 'Midweek prayer moves to the chapel',
    description: 'Same time, 7pm. The hall is being re-carpeted through the end of the month.',
    image_url: null,
    pinned: false,
    // Far in the future — same point: still rendered, no client-side filtering.
    publish_at: '2030-01-01T00:00:00Z',
    created_at: '2030-01-01T00:00:00Z',
  },
];

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AnnouncementsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  Platform.OS = 'ios';
});

describe('AnnouncementsScreen — populated', () => {
  it('renders every item the server returns regardless of publish_at, with the pinned item first', async () => {
    mockedGet.mockResolvedValue(announcements);
    const { findByText, getByText, UNSAFE_getAllByType } = renderScreen();

    await findByText('Baptism Sunday · October 4');
    // No client-side date filtering — the past- and future-dated items both render.
    expect(getByText('Volunteers needed for the food pantry')).toBeTruthy();
    expect(getByText('Midweek prayer moves to the chapel')).toBeTruthy();

    const cards = UNSAFE_getAllByType(AnnouncementCard);
    expect(cards.map((c) => c.props.announcement.id)).toEqual(['a2', 'a1', 'a3']);
  });

  it('shows the wheat-notice "Pinned" label only on the pinned card', async () => {
    mockedGet.mockResolvedValue(announcements);
    const { findByText, getAllByText } = renderScreen();
    await findByText('Baptism Sunday · October 4');
    expect(getAllByText('Pinned')).toHaveLength(1);
  });

  it('renders the announcement image when present and omits it when absent', async () => {
    mockedGet.mockResolvedValue(announcements);
    const { findByText, UNSAFE_getAllByType } = renderScreen();
    await findByText('Baptism Sunday · October 4');
    const images = UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({ uri: 'https://cdn.example.com/baptism.jpg' });
  });
});

describe('AnnouncementsScreen — loading', () => {
  it('shows a loading state', () => {
    mockedGet.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText } = renderScreen();
    expect(getByLabelText('Loading announcements')).toBeTruthy();
  });
});

describe('AnnouncementsScreen — empty', () => {
  it('shows an empty state when there are no live announcements', async () => {
    mockedGet.mockResolvedValue([]);
    const { findByText } = renderScreen();
    await findByText('No announcements right now');
  });
});

describe('AnnouncementsScreen — error', () => {
  it('shows an error state with a working retry', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network down'));
    mockedGet.mockResolvedValueOnce(announcements);

    const { findByText, getByText } = renderScreen();
    await findByText('Something went wrong. Try again.');

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });
});

describe('AnnouncementsScreen — both chromes', () => {
  it.each(['ios', 'android'] as const)('renders correctly under Platform.OS=%s', async (os) => {
    Platform.OS = os;
    mockedGet.mockResolvedValue(announcements);
    const { findByText } = renderScreen();
    await findByText('Baptism Sunday · October 4');
  });
});
