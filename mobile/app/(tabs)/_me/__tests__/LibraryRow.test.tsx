import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LibraryRow } from '../LibraryRow';

jest.mock('@expo/vector-icons');

describe('LibraryRow', () => {
  it('renders the label and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<LibraryRow label="History" onPress={onPress} />);

    expect(getByText('History')).toBeTruthy();
    fireEvent.press(getByLabelText('History'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a detail line and folds it into the accessible name', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<LibraryRow label="Name" detail="Ada Nwosu" onPress={onPress} />);
    expect(getByText('Ada Nwosu')).toBeTruthy();
    fireEvent.press(getByLabelText('Name, Ada Nwosu'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('can hide the chevron for a row that does not navigate', () => {
    const { queryByText } = render(<LibraryRow label="Contact us" hideChevron onPress={() => {}} />);
    expect(queryByText('chevron-forward')).toBeNull();
  });

  it('never renders a count alongside the label (plan P8)', () => {
    const { queryByText } = render(<LibraryRow label="History" onPress={() => {}} />);
    expect(queryByText(/\d+/)).toBeNull();
  });
});
