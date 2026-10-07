import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { BrowseSearchEntry } from '../BrowseSearchEntry';

jest.mock('@expo/vector-icons');

describe('BrowseSearchEntry', () => {
  it('renders the drawn placeholder copy and fires onPress on every platform', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<BrowseSearchEntry onPress={onPress} />);

    const entry = getByLabelText('Search sermons, series, speakers');
    expect(entry).toBeTruthy();

    fireEvent.press(entry);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
