import React from 'react';
import { render } from '@testing-library/react-native';
import { EqualizerBars } from '../EqualizerBars';

describe('EqualizerBars', () => {
  it('draws four decorative bars hidden from screen readers', () => {
    const { getByTestId } = render(<EqualizerBars active color="#fff" testID="bars" />);
    const row = getByTestId('bars', { includeHiddenElements: true });
    expect(row.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(row.children).toHaveLength(4);
  });

  it('renders still when inactive', () => {
    const { getByTestId } = render(<EqualizerBars active={false} color="#fff" testID="bars" />);
    expect(getByTestId('bars', { includeHiddenElements: true })).toBeTruthy();
  });
});
