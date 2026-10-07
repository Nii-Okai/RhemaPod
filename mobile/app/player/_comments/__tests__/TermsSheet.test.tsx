import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
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
});

describe('TermsSheet — I2 release gate', () => {
  it('COMMENTS_TERMS_TEXT is still Isaac\'s placeholder on this build (sanity check for the test below)', () => {
    expect(isComplianceContentPending(COMMENTS_TERMS_TEXT)).toBe(true);
  });

  it('keeps "Agree and continue" disabled even once checked, while the terms text is a placeholder', async () => {
    const utils = renderSheet();
    fireEvent.press(utils.getByLabelText('I agree to the comment guidelines'));
    const button = utils.getByRole('button', { name: 'Agree and continue' });
    expect(button.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(button);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
