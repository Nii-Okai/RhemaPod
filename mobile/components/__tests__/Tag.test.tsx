import React from 'react';
import { render } from '@testing-library/react-native';
import { Tag } from '../Tag';

describe('Tag', () => {
  it('renders its label as plain text', () => {
    const { getByText } = render(<Tag label="grief" />);
    expect(getByText('grief')).toBeTruthy();
  });

  it('is not exposed as a button — inert label only (spec §8.7)', () => {
    const { queryByRole } = render(<Tag label="grief" />);
    expect(queryByRole('button')).toBeNull();
  });
});
