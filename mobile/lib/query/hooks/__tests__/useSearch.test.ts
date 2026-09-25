import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import { ApiError } from '../../../api/errors';
import { SUGGEST_MIN_LENGTH, useSearchResults, useSearchSuggest } from '../useSearch';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('useSearchResults', () => {
  it('passes q/category_id/speaker_id straight through as query params', async () => {
    mockedGet.mockResolvedValue({ query: 'storm', total: 1, limit: 20, offset: 0, results: [] });

    const { result } = renderHook(() => useSearchResults({ q: 'storm' }), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { q: 'storm' } } }),
    );
  });

  it('doubles as a filtered browse with no `q` — the category/speaker drill-down use case', async () => {
    mockedGet.mockResolvedValue({ query: '', total: 0, limit: 20, offset: 0, results: [] });

    const { result } = renderHook(() => useSearchResults({ category_id: 'cat-1' }), {
      wrapper: wrapWithQueryClient(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ params: { query: { category_id: 'cat-1' } } }),
    );
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useSearchResults({}, { enabled: false }), { wrapper: wrapWithQueryClient() });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('surfaces a fetch-boundary failure as an error state', async () => {
    mockedGet.mockRejectedValue(new ApiError(500, 'Something went wrong. Try again.'));

    const { result } = renderHook(() => useSearchResults({ q: 'storm' }), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSearchSuggest', () => {
  it(`does not call the fetch boundary below ${SUGGEST_MIN_LENGTH} characters`, () => {
    renderHook(() => useSearchSuggest('s'), { wrapper: wrapWithQueryClient() });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it(`calls /search/suggest once at ${SUGGEST_MIN_LENGTH} characters, trimmed`, async () => {
    mockedGet.mockResolvedValue(['storm', 'storms of life']);

    const { result } = renderHook(() => useSearchSuggest('  storm  '), { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['storm', 'storms of life']);
    expect(mockedGet).toHaveBeenCalledWith('/search/suggest', expect.objectContaining({ params: { query: { q: 'storm' } } }));
  });
});
