import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockReportError = jest.fn();
jest.mock('../../lib/observability/sentry', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

import { AppErrorScreen } from '../AppErrorScreen';

describe('AppErrorScreen', () => {
  beforeEach(() => mockReportError.mockClear());

  it('reports the error once and offers a retry', () => {
    const error = new Error('boom');
    const retry = jest.fn(() => Promise.resolve());
    const screen = render(<AppErrorScreen error={error} retry={retry} />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledWith(error, { boundary: 'route' });

    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
