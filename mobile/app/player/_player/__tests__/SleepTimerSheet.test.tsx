import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SleepTimerSheet } from '../SleepTimerSheet';

jest.mock('@expo/vector-icons');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('SleepTimerSheet — End of this sermon', () => {
  it('arms the timer for the minutes left in the sermon, then closes', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const screen = render(
      <SleepTimerSheet visible hasActiveTimer={false} minutesToEnd={12.5} onSelect={onSelect} onClose={onClose} />,
    );
    fireEvent.press(screen.getByLabelText('End of this sermon'));
    expect(onSelect).toHaveBeenCalledWith(12.5);
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves it out while the length is unknown', () => {
    const screen = render(<SleepTimerSheet visible hasActiveTimer={false} onSelect={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('End of this sermon')).toBeNull();
  });
});
