import React from 'react';
import { render } from '@testing-library/react-native';
import { AnnouncementCard } from '../AnnouncementCard';
import type { AnnouncementListItem } from '../../../lib/query/hooks/useAnnouncements';

function buildAnnouncement(overrides: Partial<AnnouncementListItem> = {}): AnnouncementListItem {
  return {
    id: 'a1',
    title: 'Baptism Sunday',
    description: 'Sign up at the welcome desk.',
    image_url: null,
    pinned: false,
    publish_at: '2026-09-08T00:00:00Z',
    expires_at: null,
    created_at: '2026-09-08T00:00:00Z',
    ...overrides,
  } as AnnouncementListItem;
}

describe('AnnouncementCard — date range (Decision 5)', () => {
  it('renders a bounded window as "Mon DD → Mon DD" when both publish_at and expires_at are present', () => {
    const announcement = buildAnnouncement({
      publish_at: '2026-09-08T00:00:00Z',
      expires_at: '2026-10-04T00:00:00Z',
    });
    const { getByText } = render(<AnnouncementCard announcement={announcement} />);
    expect(getByText('Sep 8 → Oct 4')).toBeTruthy();
  });

  it('renders an open-ended window as "Mon DD → —" when expires_at is null', () => {
    const announcement = buildAnnouncement({
      publish_at: '2026-09-10T00:00:00Z',
      expires_at: null,
    });
    const { getByText } = render(<AnnouncementCard announcement={announcement} />);
    expect(getByText('Sep 10 → —')).toBeTruthy();
  });

  it('falls back to "—" on either side when the date is missing or unparseable', () => {
    const announcement = buildAnnouncement({
      publish_at: null,
      expires_at: null,
    });
    const { getByText } = render(<AnnouncementCard announcement={announcement} />);
    expect(getByText('— → —')).toBeTruthy();
  });
});
