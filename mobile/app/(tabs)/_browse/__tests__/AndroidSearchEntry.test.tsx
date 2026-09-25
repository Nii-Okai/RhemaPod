import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AndroidSearchEntry } from '../AndroidSearchEntry';

jest.mock('@expo/vector-icons');

describe('AndroidSearchEntry', () => {
  it('renders the drawn placeholder copy and navigates to Search on press', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<AndroidSearchEntry onPress={onPress} />);

    const entry = getByLabelText('Search sermons, series, speakers');
    expect(entry).toBeTruthy();

    fireEvent.press(entry);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
