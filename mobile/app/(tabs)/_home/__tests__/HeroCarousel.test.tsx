import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeroCarousel } from '../HeroCarousel';
import { api } from '../../../../lib/api/typedClient';
import { createTestQueryClient } from '../../../../lib/query/testUtils';
import type { SermonListItem } from '../../../../lib/query/hooks/useSermons';

jest.mock('@expo/vector-icons');

// `HeroCard` (every card in the carousel) now reads `useAddToDefaultLibrary`, a
// react-query hook, for its real +/checkmark state (Isaac's ask, session 2026-10-11:
// "add sermon to default library") — every render here needs a provider under it now.
jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
const mockedGet = api.get as jest.Mock;

function renderCarousel(sermons: SermonListItem[], onPress: (id: string) => void) {
  mockedGet.mockResolvedValue([]);
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HeroCarousel sermons={sermons} onPress={onPress} />
    </QueryClientProvider>,
  );
}

function makeSermon(overrides: Partial<SermonListItem>): SermonListItem {
  return {
    id: 's1',
    title: 'Anchored in the Storm',
    description: null,
    duration_seconds: 1862,
    episode_number: null,
    category_id: null,
    category_name: null,
    series_id: null,
    series_title: null,
    speaker_id: null,
    speaker_name: null,
    thumbnail_url: 'https://cdn.example.com/hero.jpg',
    locked: false,
    tier: 'free',
    ...overrides,
  } as SermonListItem;
}

describe('HeroCarousel', () => {
  it('renders nothing when given no sermons', () => {
    const { toJSON } = renderCarousel([], jest.fn());
    expect(toJSON()).toBeNull();
  });

  it('renders a single plain HeroCard (no dots) when given exactly one sermon', () => {
    const onPress = jest.fn();
    const sermon = makeSermon({ id: 's1' });
    const { getByLabelText, queryAllByLabelText } = renderCarousel([sermon], onPress);

    fireEvent.press(getByLabelText('Watch, 31:02'));
    expect(onPress).toHaveBeenCalledWith('s1');
    // "Featured sermons, N of M" only appears once there's more than one page.
    expect(queryAllByLabelText(/Featured sermons/)).toHaveLength(0);
  });

  it('renders a paged carousel with one dot per sermon when given several', () => {
    const onPress = jest.fn();
    const sermons = [makeSermon({ id: 's1' }), makeSermon({ id: 's2' }), makeSermon({ id: 's3' })];
    const { getAllByLabelText, getByLabelText, getByTestId } = renderCarousel(sermons, onPress);

    fireEvent(getByTestId('hero-carousel'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });

    // All three cards' Watch CTAs are mounted in the horizontal ScrollView.
    expect(getAllByLabelText('Watch, 31:02')).toHaveLength(3);
    expect(getByLabelText('Featured sermons, 1 of 3')).toBeTruthy();
  });

  // Regression (fixed 2026-10-16, Isaac's report — "hero grows in height, then snaps
  // back"): before `onLayout` reports a real pixel width, the carousel renders nothing
  // at all rather than a page sized off a `width: '100%'` guess.
  it('renders no pages until onLayout reports a real width', () => {
    const sermons = [makeSermon({ id: 's1' }), makeSermon({ id: 's2' })];
    const { queryAllByLabelText, getByTestId } = renderCarousel(sermons, jest.fn());

    expect(queryAllByLabelText(/Watch,/)).toHaveLength(0);
    expect(queryAllByLabelText(/Featured sermons/)).toHaveLength(0);

    fireEvent(getByTestId('hero-carousel'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
    expect(queryAllByLabelText(/Watch,/)).toHaveLength(2);
  });

  it('fires onPress with the id of the specific sermon pressed', () => {
    const onPress = jest.fn();
    const sermons = [
      makeSermon({ id: 's1', duration_seconds: 60 }),
      makeSermon({ id: 's2', duration_seconds: 120 }),
    ];
    const { getByLabelText, getByTestId } = renderCarousel(sermons, onPress);

    fireEvent(getByTestId('hero-carousel'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });

    fireEvent.press(getByLabelText('Watch, 2:00'));
    expect(onPress).toHaveBeenCalledWith('s2');
  });

  describe('auto-advance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('pages forward on its own after the interval, and wraps back to the first page', () => {
      const sermons = [makeSermon({ id: 's1' }), makeSermon({ id: 's2' }), makeSermon({ id: 's3' })];
      const { getByTestId, getByLabelText } = renderCarousel(sermons, jest.fn());

      fireEvent(getByTestId('hero-carousel'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
      });

      expect(getByLabelText('Featured sermons, 1 of 3')).toBeTruthy();

      jest.advanceTimersByTime(6000);
      expect(getByLabelText('Featured sermons, 2 of 3')).toBeTruthy();

      jest.advanceTimersByTime(6000);
      expect(getByLabelText('Featured sermons, 3 of 3')).toBeTruthy();

      jest.advanceTimersByTime(6000);
      expect(getByLabelText('Featured sermons, 1 of 3')).toBeTruthy();
    });

    it('does not advance while the user is actively dragging', () => {
      const sermons = [makeSermon({ id: 's1' }), makeSermon({ id: 's2' })];
      const { getByTestId, getByLabelText } = renderCarousel(sermons, jest.fn());

      fireEvent(getByTestId('hero-carousel'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
      });
      const scrollView = getByLabelText(/Featured sermons/);

      fireEvent(scrollView, 'scrollBeginDrag');
      jest.advanceTimersByTime(6000);

      expect(getByLabelText('Featured sermons, 1 of 2')).toBeTruthy();
    });
  });
});
