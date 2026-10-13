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

  describe('badgeCount (Like\'s own counter)', () => {
    it('shows no badge at all when the count is 0', () => {
      const { queryByText } = render(
        <ActionButton icon="heart-outline" label="Like" accessibilityLabel="Like" badgeCount={0} onPress={jest.fn()} />,
      );
      expect(queryByText('0')).toBeNull();
    });

    it('shows no badge when badgeCount is omitted', () => {
      const { queryByText } = render(
        <ActionButton icon="heart-outline" label="Like" accessibilityLabel="Like" onPress={jest.fn()} />,
      );
      expect(queryByText('0')).toBeNull();
    });

    it('shows the real count once it is 1 or more', () => {
      const { getByText } = render(
        <ActionButton icon="heart" label="Like" accessibilityLabel="Unlike, 5 likes" badgeCount={5} onPress={jest.fn()} />,
      );
      expect(getByText('5')).toBeTruthy();
      // The label itself stays plain "Like" — the count lives on the badge, not a second line.
      expect(getByText('Like')).toBeTruthy();
    });

    it('caps a very large count at "99+" rather than overflowing the badge', () => {
      const { getByText } = render(
        <ActionButton icon="heart" label="Like" accessibilityLabel="Unlike, 250 likes" badgeCount={250} onPress={jest.fn()} />,
      );
      expect(getByText('99+')).toBeTruthy();
    });
  });
});
