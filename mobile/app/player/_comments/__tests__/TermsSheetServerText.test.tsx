import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { TermsSheet, splitTerms } from '../TermsSheet';
import { api } from '../../../../lib/api/typedClient';
import { COMMENTS_TERMS_TEXT } from '../../../../lib/content/commentsCompliance';
import { createTestQueryClient } from '../../../../lib/query/testUtils';

/* S18 — the sheet shows the guidelines staff edit in the admin portal
   (`GET /settings/public`), keeping the title/body split, and falls back to the
   shipped text when that read fails. */

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockedGet = api.get as jest.Mock;

function renderSheet() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TermsSheet visible readOnly onClose={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => mockedGet.mockReset());

describe('TermsSheet — server guidelines', () => {
  it('renders the server text with its first paragraph as the title', async () => {
    mockedGet.mockResolvedValue({
      contact_email: 'contact@rhemapod.com',
      comment_guidelines: 'Watered Garden Guidelines\n\nPlease be kind.\n\nNo spam.',
      terms_of_use_url: null,
      privacy_policy_url: null,
    });
    const { findByText, getByText } = renderSheet();
    const title = await findByText('Watered Garden Guidelines');
    expect(title.props.accessibilityRole).toBe('header');
    expect(getByText('Please be kind.\n\nNo spam.')).toBeTruthy();
  });

  it('falls back to the shipped text when the read fails', async () => {
    mockedGet.mockRejectedValue(new Error('offline'));
    const { findByText } = renderSheet();
    const { title } = splitTerms(COMMENTS_TERMS_TEXT);
    expect(await findByText(title)).toBeTruthy();
  });
});

describe('splitTerms', () => {
  it('splits once at the first blank line', () => {
    expect(splitTerms('T\n\nA\n\nB')).toEqual({ title: 'T', body: 'A\n\nB' });
  });
});
