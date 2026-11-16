import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SpeakerListRow } from '../SpeakerListRow';
import type { Speaker } from '../../lib/query/hooks/useSpeakers';

jest.mock('../Avatar', () => {
  const actual = jest.requireActual('../Avatar');
  return {
    ...actual,
    // Spy shim: captures the props Avatar was called with (P6 — hashed on
    // `speaker.id`, not `speaker.name`) without needing to reverse-engineer
    // the rendered swatch color.
    Avatar: (props: { name: string; seed?: string }) => {
      mockAvatarProps.push(props);
      return actual.Avatar(props);
    },
  };
});

const mockAvatarProps: Array<{ name: string; seed?: string }> = [];

beforeEach(() => {
  mockAvatarProps.length = 0;
});

const withBio: Speaker = {
  id: 'speaker-1',
  name: 'Pastor Ada Nwosu',
  bio: 'Lead pastor at Grace Chapel since 2014',
  sermon_count: 61,
};

const withoutBio: Speaker = { id: 'speaker-2', name: 'Ruth Mensah', bio: null, sermon_count: 11 };

describe('SpeakerListRow', () => {
  it('renders name and bio, keeps the sermon count in the accessibility label only, and passes the speaker id (not name) as the P6 avatar hash seed', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText, queryByText } = render(<SpeakerListRow speaker={withBio} onPress={onPress} />);

    expect(getByText('Pastor Ada Nwosu')).toBeTruthy();
    expect(getByText('Lead pastor at Grace Chapel since 2014')).toBeTruthy();
    // Visible count dropped (Isaac's ask, session 2026-10-02) — still reaches VoiceOver.
    expect(queryByText('61')).toBeNull();
    expect(mockAvatarProps[0]).toEqual(expect.objectContaining({ seed: 'speaker-1' }));

    fireEvent.press(getByLabelText('Pastor Ada Nwosu, Lead pastor at Grace Chapel since 2014, 61 sermons'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the verbatim "No bio yet" fallback when bio is null', () => {
    const { getByText } = render(<SpeakerListRow speaker={withoutBio} onPress={jest.fn()} />);
    expect(getByText('No bio yet')).toBeTruthy();
  });
});
