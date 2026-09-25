import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { QueryState } from '../QueryState';
import { ApiError } from '../../lib/api/errors';

describe('QueryState', () => {
  it('shows a loading indicator and does not render children while loading', () => {
    const { getByLabelText, queryByText } = render(
      <QueryState isLoading isError={false} isEmpty={false} emptyTitle="Nothing" loadingLabel="Loading things">
        <Text>content</Text>
      </QueryState>,
    );

    expect(getByLabelText('Loading things')).toBeTruthy();
    expect(queryByText('content')).toBeNull();
  });

  it('shows the ApiError message and calls onRetry', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <QueryState
        isLoading={false}
        isError
        error={new ApiError(500, 'Could not load categories.')}
        isEmpty={false}
        emptyTitle="Nothing"
        loadingLabel="Loading"
        onRetry={onRetry}
      >
        <Text>content</Text>
      </QueryState>,
    );

    expect(getByText('Could not load categories.')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message for a non-ApiError', () => {
    const { getByText } = render(
      <QueryState
        isLoading={false}
        isError
        error={new Error('boom')}
        isEmpty={false}
        emptyTitle="Nothing"
        loadingLabel="Loading"
      >
        <Text>content</Text>
      </QueryState>,
    );

    expect(getByText('Something went wrong. Try again.')).toBeTruthy();
  });

  it('shows the empty title/description when isEmpty', () => {
    const { getByText } = render(
      <QueryState
        isLoading={false}
        isError={false}
        isEmpty
        emptyTitle="No categories yet"
        emptyDescription="Check back later."
        loadingLabel="Loading"
      >
        <Text>content</Text>
      </QueryState>,
    );

    expect(getByText('No categories yet')).toBeTruthy();
    expect(getByText('Check back later.')).toBeTruthy();
  });

  it('renders children on the populated path', () => {
    const { getByText } = render(
      <QueryState isLoading={false} isError={false} isEmpty={false} emptyTitle="Nothing" loadingLabel="Loading">
        <Text>content</Text>
      </QueryState>,
    );

    expect(getByText('content')).toBeTruthy();
  });
});
