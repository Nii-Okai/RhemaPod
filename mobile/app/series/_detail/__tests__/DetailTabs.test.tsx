import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DetailTabs } from '../DetailTabs';

describe('DetailTabs', () => {
  it('renders both tabs and marks the active one selected', () => {
    const { getByText, getByTestId } = render(<DetailTabs active="episodes" onChange={jest.fn()} />);

    expect(getByText('Episodes')).toBeTruthy();
    expect(getByText('Related')).toBeTruthy();
    expect(getByTestId('detail-tab-episodes').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('detail-tab-related').props.accessibilityState).toEqual({ selected: false });
  });

  it('fires onChange with the pressed tab\'s key', () => {
    const onChange = jest.fn();
    const { getByText } = render(<DetailTabs active="episodes" onChange={onChange} />);

    fireEvent.press(getByText('Related'));
    expect(onChange).toHaveBeenCalledWith('related');
  });
});
