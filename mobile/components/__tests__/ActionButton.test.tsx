import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActionButton } from '../ActionButton';

jest.mock('@expo/vector-icons');

describe('ActionButton', () => {
  it('renders the label and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(
      <ActionButton icon="add" label="My List" accessibilityLabel="Add to My List" onPress={onPress} />,
    );

    expect(getByText('My List')).toBeTruthy();
    fireEvent.press(getByLabelText('Add to My List'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reflects the selected state in accessibilityState', () => {
    const { getByLabelText } = render(
      <ActionButton icon="checkmark" label="My List" accessibilityLabel="Remove from My List" selected onPress={jest.fn()} />,
    );

    expect(getByLabelText('Remove from My List').props.accessibilityState).toEqual({ selected: true });
  });

  it('renders a two-line label (Download\'s own "Download\\n{N} Episodes")', () => {
    const { getByText } = render(
      <ActionButton
        icon="download-outline"
        label={'Download\n3 Episodes'}
        accessibilityLabel="Download all 3 episodes"
        onPress={jest.fn()}
      />,
    );

    expect(getByText('Download\n3 Episodes')).toBeTruthy();
  });
});
