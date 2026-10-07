import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { RelatedSermons } from '../RelatedSermons';
import { api } from '../../../lib/api/typedClient';
import { wrapWithQueryClient } from '../../../lib/query/testUtils';

jest.mock('../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

function sermon(overrides: Record<string, unknown>) {
  return {
    id: 'sermon',
    title: 'Sermon',
    description: null,
    duration_seconds: 1800,
    episode_number: null,
    category_id: 'faith',
    category_name: 'Faith',
    series_id: null,
    series_title: null,
    speaker_id: null,
    speaker_name: null,
    thumbnail_url: null,
    locked: false,
    tier: 'free',
    ...overrides,
  };
}

const searchResults = {
  query: null,
  total: 3,
  limit: 20,
  offset: 0,
  series: [],
  series_total: 0,
  speakers: [],
  speakers_total: 0,
  results: [
    sermon({ id: 'own-episode', title: 'Own Episode', series_id: 'current-series' }),
    sermon({ id: 'itself', title: 'This Sermon' }),
    sermon({ id: 'standalone', title: 'Standing Firm', speaker_name: 'Pastor Grace' }),
  ],
};

beforeEach(() => {
  mockedGet.mockReset();
});

describe('RelatedSermons', () => {
  it('excludes a series\' own episodes via excludeSeriesId (series-detail usage)', async () => {
    mockedGet.mockResolvedValue(searchResults);
    const { findByLabelText, queryByLabelText } = render(
      <RelatedSermons categoryId="faith" excludeSeriesId="current-series" onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByLabelText('Standing Firm')).toBeTruthy();
    expect(queryByLabelText('Own Episode')).toBeNull();
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { category_id: 'faith' } } }),
    );
  });

  it('excludes the sermon itself via excludeSermonId (sermon-detail usage)', async () => {
    mockedGet.mockResolvedValue(searchResults);
    const { findByLabelText, queryByLabelText } = render(
      <RelatedSermons categoryId="faith" excludeSermonId="itself" onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByLabelText('Standing Firm')).toBeTruthy();
    expect(queryByLabelText('This Sermon')).toBeNull();
  });

  it('combines both exclusions when a sermon has its own series', async () => {
    mockedGet.mockResolvedValue(searchResults);
    const { findByLabelText, queryByLabelText } = render(
      <RelatedSermons
        categoryId="faith"
        excludeSermonId="itself"
        excludeSeriesId="current-series"
        onPressSermon={jest.fn()}
      />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByLabelText('Standing Firm')).toBeTruthy();
    expect(queryByLabelText('Own Episode')).toBeNull();
    expect(queryByLabelText('This Sermon')).toBeNull();
  });

  it('navigates to the pressed related sermon', async () => {
    mockedGet.mockResolvedValue(searchResults);
    const onPressSermon = jest.fn();
    const { findByLabelText } = render(
      <RelatedSermons categoryId="faith" excludeSermonId="itself" onPressSermon={onPressSermon} />,
      { wrapper: wrapWithQueryClient() },
    );

    fireEvent.press(await findByLabelText('Standing Firm'));
    expect(onPressSermon).toHaveBeenCalledWith('standalone');
  });

  it('shows an honest empty state when there is no category to match on', async () => {
    const { findByText } = render(
      <RelatedSermons categoryId={null} onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByText('No related sermons yet.')).toBeTruthy();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('shows an honest empty state when nothing else shares the category', async () => {
    mockedGet.mockResolvedValue({ ...searchResults, results: [searchResults.results[1]] });
    const { findByText } = render(
      <RelatedSermons categoryId="faith" excludeSermonId="itself" onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByText('No related sermons yet.')).toBeTruthy();
  });

  it('shows an error message rather than crashing when the search fails', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    const { findByText } = render(
      <RelatedSermons categoryId="faith" excludeSermonId="itself" onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    await waitFor(async () => {
      expect(await findByText('Something went wrong loading related sermons.')).toBeTruthy();
    });
  });

  it('grid mode renders the filtered items at a square aspect ratio, not the rail default', async () => {
    mockedGet.mockResolvedValue(searchResults);
    const { findByLabelText } = render(
      <RelatedSermons categoryId="faith" excludeSermonId="itself" onPressSermon={jest.fn()} grid />,
      { wrapper: wrapWithQueryClient() },
    );

    const card = await findByLabelText('Standing Firm');
    // Fixture sermons have no thumbnail_url, so the fallback block (a plain `View`) is
    // the one carrying the grid's computed `aspectRatio` straight through its style.
    const aspectRatios = card
      .findAllByType(View)
      .map((node: { props: { style: unknown } }) => {
        const flat = Object.assign({}, ...(Array.isArray(node.props.style) ? node.props.style : [node.props.style]));
        return flat.aspectRatio;
      })
      .filter((value: unknown): value is number => typeof value === 'number');

    expect(aspectRatios).toContainEqual(expect.closeTo(1, 3));
  });

  it('caps related results to one episode per series, keeping standalone sermons uncapped', async () => {
    mockedGet.mockResolvedValue({
      ...searchResults,
      results: [
        sermon({ id: 'other-series-ep1', title: 'Other Series Ep 1', series_id: 'other-series' }),
        sermon({ id: 'other-series-ep2', title: 'Other Series Ep 2', series_id: 'other-series' }),
        sermon({ id: 'standalone-a', title: 'Standalone A', series_id: null }),
        sermon({ id: 'standalone-b', title: 'Standalone B', series_id: null }),
      ],
    });
    const { findByLabelText, queryByLabelText } = render(
      <RelatedSermons categoryId="faith" onPressSermon={jest.fn()} />,
      { wrapper: wrapWithQueryClient() },
    );

    expect(await findByLabelText('Other Series Ep 1')).toBeTruthy();
    expect(queryByLabelText('Other Series Ep 2')).toBeNull();
    // Standalone sermons (no series_id) never dedupe against each other.
    expect(await findByLabelText('Standalone A')).toBeTruthy();
    expect(await findByLabelText('Standalone B')).toBeTruthy();
  });
});
