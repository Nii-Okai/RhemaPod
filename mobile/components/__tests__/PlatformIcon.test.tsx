import React from 'react';
import { render } from '@testing-library/react-native';
import { PlatformIcon } from '../PlatformIcon';
import { usePlatformOS } from '../navigation/platform';

jest.mock('../navigation/platform', () => ({ usePlatformOS: jest.fn(() => 'ios') }));
jest.mock('@expo/vector-icons');

const mockedUsePlatformOS = usePlatformOS as jest.Mock;

describe('PlatformIcon', () => {
  it('renders the Ionicons glyph on iOS', () => {
    mockedUsePlatformOS.mockReturnValue('ios');
    const { getByText } = render(<PlatformIcon name="heart" />);
    expect(getByText('heart')).toBeTruthy();
  });

  it('renders the Material Icons equivalent on Android, not the Ionicons name', () => {
    mockedUsePlatformOS.mockReturnValue('android');
    const { getByText, queryByText } = render(<PlatformIcon name="heart" />);
    expect(getByText('favorite')).toBeTruthy();
    expect(queryByText('heart')).toBeNull();
  });

  it('covers every mapped name with a distinct Android glyph pair (sanity check against a silent copy-paste duplicate)', () => {
    // Not exhaustive of the whole map — just the handful most likely to get the wrong
    // paired name copy-pasted during the file-by-file migration.
    const cases: [Parameters<typeof PlatformIcon>[0]['name'], string][] = [
      ['chevron-forward', 'chevron-right'],
      ['trash', 'delete'],
      ['checkmark-circle', 'check-circle'],
      ['download-outline', 'file-download'],
      ['share-outline', 'share'],
    ];
    mockedUsePlatformOS.mockReturnValue('android');
    for (const [name, expected] of cases) {
      const { getByText, unmount } = render(<PlatformIcon name={name} />);
      expect(getByText(expected)).toBeTruthy();
      unmount();
    }
  });
});
