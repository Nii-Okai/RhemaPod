import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AnnouncementsEntry } from '../AnnouncementsEntry';

jest.mock('@expo/vector-icons');

describe('AnnouncementsEntry', () => {
  it('renders the entry point row and fires onPress (P2: Home entry into Announcements)', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<AnnouncementsEntry onPress={onPress} />);

    fireEvent.press(getByLabelText('Announcements'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
