import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { VerseStrip } from '../VerseStrip';
import { api } from '../../../../lib/api/typedClient';
import { ApiError } from '../../../../lib/api/errors';
import { wrapWithQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

beforeEach(() => {
  mockedGet.mockReset();
});

describe('VerseStrip', () => {
  it('renders the verse, reference, and uppercased translation once the fetch resolves', async () => {
    mockedGet.mockResolvedValue({
      id: 'v1',
      reference: 'Philippians 4:13',
      text: 'I can do all things through Christ which strengtheneth me.',
      translation: 'kjv',
    });

    const { findByText } = render(<VerseStrip />, { wrapper: wrapWithQueryClient() });

    expect(await findByText('“I can do all things through Christ which strengtheneth me.”')).toBeTruthy();
    expect(await findByText('Philippians 4:13 · KJV')).toBeTruthy();
  });

  it('renders nothing while loading', () => {
    mockedGet.mockReturnValue(new Promise(() => {}));

    const { toJSON } = render(<VerseStrip />, { wrapper: wrapWithQueryClient() });

    expect(toJSON()).toBeNull();
  });

  it('renders nothing on a 404 (no active verses) rather than an error banner', async () => {
    mockedGet.mockRejectedValue(new ApiError(404, 'No verses available'));

    const { queryByText, toJSON } = render(<VerseStrip />, { wrapper: wrapWithQueryClient() });

    await waitFor(() => expect(queryByText(/·/)).toBeNull());
    expect(toJSON()).toBeNull();
  });
});
