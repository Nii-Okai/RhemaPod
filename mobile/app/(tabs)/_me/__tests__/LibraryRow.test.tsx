import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LibraryRow } from '../LibraryRow';

jest.mock('@expo/vector-icons');

describe('LibraryRow', () => {
  it('renders the label and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<LibraryRow label="Notes" onPress={onPress} />);

    expect(getByText('Notes')).toBeTruthy();
    fireEvent.press(getByLabelText('Notes'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('never renders a count alongside the label (plan P8)', () => {
    const { queryByText } = render(<LibraryRow label="History" onPress={() => {}} />);
    expect(queryByText(/\d+/)).toBeNull();
  });
});
