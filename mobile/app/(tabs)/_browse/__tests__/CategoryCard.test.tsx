import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CategoryCard } from '../CategoryCard';
import type { Category } from '../../../../lib/query/hooks/useCategories';

const category: Category = { id: 'c1', name: 'Teaching', slug: 'teaching', sermon_count: 54 };

describe('CategoryCard', () => {
  it('renders the name, keeps the pluralized sermon count in the accessibility label only, and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText, queryByText } = render(
      <CategoryCard category={category} onPress={onPress} width={160} />,
    );

    expect(getByText('Teaching')).toBeTruthy();
    // Visible count dropped (Isaac's ask, session 2026-10-02) — still reaches VoiceOver.
    expect(queryByText('54 sermons')).toBeNull();

    fireEvent.press(getByLabelText('Teaching, 54 sermons'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('singularizes the count in the accessibility label for exactly one', () => {
    const { getByLabelText } = render(
      <CategoryCard category={{ ...category, sermon_count: 1 }} onPress={jest.fn()} width={160} />,
    );

    expect(getByLabelText('Teaching, 1 sermon')).toBeTruthy();
  });
});
