import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScrollView } from 'react-native';
import { TermsSheet } from '../TermsSheet';
import { api } from '../../../../lib/api/typedClient';
import { COMMENTS_TERMS_TEXT, isComplianceContentPending } from '../../../../lib/content/commentsCompliance';
import { createTestQueryClient } from '../../../../lib/query/testUtils';

jest.mock('../../../../lib/api/typedClient', () => ({
  api: { post: jest.fn() },
}));
jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  initialWindowMetrics: null,
}));

const mockedPost = api.post as jest.Mock;

function renderSheet() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TermsSheet visible onClose={jest.fn()} onAccepted={jest.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({});
});

describe('TermsSheet — I2 release gate', () => {
  it('COMMENTS_TERMS_TEXT is real content on this build, not Isaac\'s placeholder (sanity check for the test below)', () => {
    expect(isComplianceContentPending(COMMENTS_TERMS_TEXT)).toBe(false);
  });

  it('enables "Agree and continue" once checked, now that the real terms text has shipped', async () => {
    const utils = renderSheet();
    const button = utils.getByRole('button', { name: 'Agree and continue' });
    expect(button.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(utils.getByLabelText('I agree to the comment guidelines'));
    expect(button.props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(button);
    });
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/me/comments-terms'));
  });
});

describe('TermsSheet — layout', () => {
  // The guidelines are taller than a phone screen; the agree controls must stay pinned
  // below the scrolled text rather than sitting at the end of the scroll (Android bug,
  // 2026-11-18: the checkbox ended up below the fold, behind the nav bar).
  it('keeps the agree checkbox and button outside the scrolling text', () => {
    const utils = renderSheet();
    const scroll = utils.UNSAFE_getByType(ScrollView);
    const isInside = (node: { parent: unknown } | null): boolean => {
      for (let n = node as { parent: unknown } | null; n; n = n.parent as typeof n) {
        if (n === scroll) return true;
      }
      return false;
    };
    expect(isInside(utils.getByText(/Watered Garden Church/).parent)).toBe(true);
    expect(isInside(utils.getByLabelText('I agree to the comment guidelines'))).toBe(false);
    expect(isInside(utils.getByRole('button', { name: 'Agree and continue' }))).toBe(false);
  });
});
