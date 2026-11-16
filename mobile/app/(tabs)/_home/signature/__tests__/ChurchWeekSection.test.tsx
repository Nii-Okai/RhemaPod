import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChurchWeekSection } from '../ChurchWeekSection';

let mockData: unknown[] | undefined;
jest.mock('../../../../../lib/query/hooks/useAnnouncements', () => ({ useAnnouncements: () => ({ data: mockData }) }));

const item = (id: string, title: string, extra: object = {}) => ({
  id,
  title,
  description: null,
  image_url: null,
  pinned: false,
  publish_at: '2026-11-15T09:00:00',
  created_at: '2026-11-10T09:00:00',
  ...extra,
});

describe('ChurchWeekSection', () => {
  it('shows the first two announcements with a date chip and opens the news on press', () => {
    mockData = [
      item('a1', 'Thanksgiving service', { pinned: true }),
      item('a2', 'Youth retreat registration', { publish_at: null, created_at: '2026-11-13T09:00:00', description: 'Closes Friday\nMore' }),
      item('a3', 'Choir rehearsal'),
    ];
    const onOpenAll = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(<ChurchWeekSection onOpenAll={onOpenAll} />);

    expect(getByText('This week at church')).toBeTruthy();
    expect(getByText('SUN')).toBeTruthy();
    expect(getByText('15')).toBeTruthy();
    expect(getByText('Pinned')).toBeTruthy();
    expect(getByText('FRI')).toBeTruthy();
    expect(getByText('Closes Friday')).toBeTruthy();
    expect(queryByText('Choir rehearsal')).toBeNull();

    fireEvent.press(getByLabelText('Thanksgiving service, pinned'));
    fireEvent.press(getByLabelText('All church news'));
    expect(onOpenAll).toHaveBeenCalledTimes(2);
  });

  it('renders nothing with no announcements', () => {
    mockData = [];
    expect(render(<ChurchWeekSection onOpenAll={jest.fn()} />).toJSON()).toBeNull();
  });
});
