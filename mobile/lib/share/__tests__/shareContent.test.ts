import RNShare from 'react-native-share';
import { resolveShareBaseUrl } from '../../api/config';
import { shareContent } from '../shareContent';

jest.mock('react-native-share', () => ({ __esModule: true, default: { open: jest.fn() } }));

const mockedOpen = RNShare.open as jest.Mock;
const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

beforeEach(() => {
  jest.clearAllMocks();
  mockedOpen.mockResolvedValue(undefined);
});

describe('shareContent', () => {
  it('composes title, description and the https share link, with no image attachment', async () => {
    await shareContent({
      title: 'Anchored in the Storm',
      description: 'A word for the weary.',
      deepLinkPath: `sermon/${ID}`,
    });

    expect(mockedOpen).toHaveBeenCalledTimes(1);
    const arg = mockedOpen.mock.calls[0][0];
    expect(arg).toEqual({
      title: 'Anchored in the Storm',
      message: `Anchored in the Storm\n\nA word for the weary.\n\nhttps://open.rhemapod.com/sermon/${ID}`,
      failOnCancel: false,
    });
    expect(arg).not.toHaveProperty('url');
    expect(arg.message.endsWith(`https://open.rhemapod.com/sermon/${ID}`)).toBe(true);
    expect(arg.message).not.toContain('rhemapod://');
  });

  it.each(['series', 'playlist'])('links %s shares to the https path', async (type) => {
    await shareContent({ title: 'T', description: null, deepLinkPath: `${type}/${ID}` });
    expect(mockedOpen.mock.calls[0][0].message).toBe(`T\n\nhttps://open.rhemapod.com/${type}/${ID}`);
  });

  it('truncates a long description before the link', async () => {
    await shareContent({ title: 'T', description: 'x'.repeat(300), deepLinkPath: `sermon/${ID}` });
    const [, description, link] = mockedOpen.mock.calls[0][0].message.split('\n\n');
    expect(description).toBe(`${'x'.repeat(200)}…`);
    expect(link).toBe(`https://open.rhemapod.com/sermon/${ID}`);
  });

  it('builds the link from the configured share base', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../api/config', () => ({ SHARE_BASE_URL: 'https://staging.example.com' }));
      // A fresh module graph, with its own `react-native-share` mock.
      const isolatedShare = (require('react-native-share') as { default: { open: jest.Mock } }).default;
      isolatedShare.open.mockResolvedValue(undefined);
      const { shareContent: isolated } = require('../shareContent') as typeof import('../shareContent');
      await isolated({ title: 'T', deepLinkPath: `sermon/${ID}` });
      expect(isolatedShare.open.mock.calls[0][0].message).toBe(`T\n\nhttps://staging.example.com/sermon/${ID}`);
    });
    jest.dontMock('../../api/config');
  });

  it('propagates a share-sheet failure to the caller', async () => {
    mockedOpen.mockRejectedValue(new Error('share unavailable'));
    await expect(shareContent({ title: 'T', deepLinkPath: `sermon/${ID}` })).rejects.toThrow('share unavailable');
  });
});

describe('resolveShareBaseUrl (EXPO_PUBLIC_SHARE_BASE_URL)', () => {
  it('defaults to the production share host', () => {
    expect(resolveShareBaseUrl(undefined)).toBe('https://open.rhemapod.com');
    expect(resolveShareBaseUrl('')).toBe('https://open.rhemapod.com');
  });

  it('honours the override and strips trailing slashes', () => {
    expect(resolveShareBaseUrl('https://staging.example.com/')).toBe('https://staging.example.com');
  });
});
