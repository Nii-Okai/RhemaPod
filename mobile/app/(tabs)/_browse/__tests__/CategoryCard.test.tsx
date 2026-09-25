import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CategoryCard } from '../CategoryCard';
import type { Category } from '../../../../lib/query/hooks/useCategories';

const category: Category = { id: 'c1', name: 'Teaching', slug: 'teaching', sermon_count: 54 };

describe('CategoryCard', () => {
  it('renders the name and pluralized sermon count, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText } = render(<CategoryCard category={category} onPress={onPress} />);

    expect(getByText('Teaching')).toBeTruthy();
    expect(getByText('54 sermons')).toBeTruthy();

    fireEvent.press(getByLabelText('Teaching, 54 sermons'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('singularizes a count of exactly one', () => {
    const { getByText } = render(
      <CategoryCard category={{ ...category, sermon_count: 1 }} onPress={jest.fn()} />,
    );

    expect(getByText('1 sermon')).toBeTruthy();
  });
});
