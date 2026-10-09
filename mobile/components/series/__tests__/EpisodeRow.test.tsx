import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { EpisodeRow } from '../EpisodeRow';
import { useDownloads } from '../../../lib/downloads/useDownloads';
import type { SeriesEpisode } from '../../../lib/query/hooks/useSeries';

jest.mock('@expo/vector-icons');
jest.mock('../../../lib/downloads/useDownloads', () => ({ useDownloads: jest.fn() }));

const mockedUseDownloads = useDownloads as jest.Mock;

const episode: SeriesEpisode = {
  id: 'ep1',
  title: 'The Destiny of the Church - Part 1',
  description: null,
  duration_seconds: 175,
  episode_number: 1,
  category_id: null,
  category_name: null,
  series_id: 'se1',
  series_title: null,
  speaker_id: null,
  speaker_name: null,
  thumbnail_url: 'https://cdn.example.com/episode.jpg',
  locked: false,
  tier: 'free',
  media_type: 'audio',
} as SeriesEpisode;

beforeEach(() => {
  mockedUseDownloads.mockReturnValue({
    downloads: [],
    isLoading: false,
    wifiOnly: true,
    isSavingWifiOnly: false,
    setWifiOnly: jest.fn(),
    download: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(() => undefined),
  });
});

describe('EpisodeRow', () => {
  it('renders the episode thumbnail — a real per-episode image from the API, not a placeholder', () => {
    const { UNSAFE_getByType } = render(<EpisodeRow episode={episode} onPress={jest.fn()} />);
    expect(UNSAFE_getByType(Image).props.source).toEqual({ uri: 'https://cdn.example.com/episode.jpg' });
  });

  it('renders a fallback block (no crash) when the episode has no thumbnail_url', () => {
    const { UNSAFE_queryAllByType } = render(
      <EpisodeRow episode={{ ...episode, thumbnail_url: null }} onPress={jest.fn()} />,
    );
    expect(UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('renders the title, the thumbnail duration badge, and fires onPress — no visible episode number', () => {
    const onPress = jest.fn();
    const { getByText, getByLabelText, queryByText } = render(<EpisodeRow episode={episode} onPress={onPress} />);

    expect(queryByText('01')).toBeNull();
    expect(getByText('The Destiny of the Church - Part 1')).toBeTruthy();
    expect(getByText('2:55')).toBeTruthy();

    fireEvent.press(getByLabelText('Episode 01, The Destiny of the Church - Part 1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('never shows an episode number visually, numbered or unnumbered alike, but keeps it in the accessibility label when present', () => {
    const { queryByText, getByLabelText } = render(<EpisodeRow episode={episode} onPress={jest.fn()} />);
    expect(queryByText('00')).toBeNull();
    expect(queryByText('01')).toBeNull();
    expect(getByLabelText('Episode 01, The Destiny of the Church - Part 1')).toBeTruthy();
  });

  it('drops the episode number from the accessibility label when unnumbered, not a placeholder', () => {
    const { getByLabelText } = render(<EpisodeRow episode={{ ...episode, episode_number: null }} onPress={jest.fn()} />);
    expect(getByLabelText('The Destiny of the Church - Part 1')).toBeTruthy();
  });

  it('renders the speaker name as the meta line, and includes it in the accessibility label', () => {
    const { getByText, getByLabelText } = render(
      <EpisodeRow episode={{ ...episode, speaker_name: 'Pastor Grace' }} onPress={jest.fn()} />,
    );
    expect(getByText('Pastor Grace')).toBeTruthy();
    expect(getByLabelText('Episode 01, The Destiny of the Church - Part 1, Pastor Grace')).toBeTruthy();
  });

  it('renders no meta line when the episode has no speaker on file', () => {
    const { queryByText } = render(<EpisodeRow episode={{ ...episode, speaker_name: null }} onPress={jest.fn()} />);
    expect(queryByText('Pastor Grace')).toBeNull();
  });

  it('renders a synopsis line when the description is distinct from the title', () => {
    const { getByText } = render(
      <EpisodeRow episode={{ ...episode, description: 'A study of trust when the storm hits home.' }} onPress={jest.fn()} />,
    );
    expect(getByText('A study of trust when the storm hits home.')).toBeTruthy();
  });

  it('suppresses the synopsis line when the description just duplicates the title (content artifact regression)', () => {
    // The title still renders once (as the title) — this checks it does NOT render a
    // *second* time via the synopsis slot. A duplicate would show up as two host text
    // nodes with the same content, which `getAllByText` would then find 2 of.
    const { getAllByText } = render(
      <EpisodeRow episode={{ ...episode, description: episode.title }} onPress={jest.fn()} />,
    );
    expect(getAllByText(episode.title)).toHaveLength(1);
  });

  it('matches the title/description exactly regardless of surrounding whitespace or case', () => {
    const { getAllByText } = render(
      <EpisodeRow episode={{ ...episode, description: `  ${episode.title.toUpperCase()}  ` }} onPress={jest.fn()} />,
    );
    expect(getAllByText(episode.title)).toHaveLength(1);
  });

  it('renders the download control at the end of the row', () => {
    const { getByLabelText } = render(<EpisodeRow episode={episode} onPress={jest.fn()} />);
    expect(getByLabelText('Download The Destiny of the Church - Part 1')).toBeTruthy();
  });

  it('does not navigate when the download control is pressed', () => {
    const onPress = jest.fn();
    const download = jest.fn();
    mockedUseDownloads.mockReturnValue({
      downloads: [],
      isLoading: false,
      wifiOnly: true,
      isSavingWifiOnly: false,
      setWifiOnly: jest.fn(),
      download,
      retry: jest.fn(),
      remove: jest.fn(),
      find: jest.fn(() => undefined),
    });
    const { getByLabelText } = render(<EpisodeRow episode={episode} onPress={onPress} />);

    fireEvent.press(getByLabelText('Download The Destiny of the Church - Part 1'));

    expect(download).toHaveBeenCalledWith(
      'ep1',
      'The Destiny of the Church - Part 1',
      'audio',
      'https://cdn.example.com/episode.jpg',
      null,
    );
    expect(onPress).not.toHaveBeenCalled();
  });
});
