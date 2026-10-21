import { renderHook, waitFor } from '@testing-library/react-native';
import { api } from '../../../api/typedClient';
import {
  churchContentFrom,
  safeHttpsUrl,
  useChurchContent,
  useChurchSettings,
  type ChurchSettingsPublic,
} from '../useChurchSettings';
import { COMMENTS_TERMS_TEXT, CONTACT_EMAIL } from '../../../content/commentsCompliance';
import { wrapWithQueryClient } from '../../testUtils';

jest.mock('../../../api/typedClient', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.Mock;

const SERVER: ChurchSettingsPublic = {
  church_name: 'Watered Garden Church',
  app_display_name: 'RhemaPod',
  tagline: null,
  about: null,
  contact_email: 'hello@wateredgarden.org',
  contact_phone: null,
  website_url: null,
  address: null,
  comment_guidelines: 'Updated Guidelines\n\nBe kind.',
  terms_of_use_url: null,
  privacy_policy_url: 'https://wateredgarden.org/privacy',
  copyright_notice: null,
  version: 2,
};

beforeEach(() => mockedGet.mockReset());

describe('useChurchSettings', () => {
  it('reads GET /settings/public', async () => {
    mockedGet.mockResolvedValue(SERVER);
    const { result } = renderHook(() => useChurchSettings(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith('/settings/public', expect.objectContaining({ init: expect.anything() }));
  });
});

describe('useChurchContent', () => {
  it('uses the server values once loaded', async () => {
    mockedGet.mockResolvedValue(SERVER);
    const { result } = renderHook(() => useChurchContent(), { wrapper: wrapWithQueryClient() });
    await waitFor(() => expect(result.current.contactEmail).toBe('hello@wateredgarden.org'));
    expect(result.current.commentGuidelines).toBe('Updated Guidelines\n\nBe kind.');
    expect(result.current.privacyPolicyUrl).toBe('https://wateredgarden.org/privacy');
    expect(result.current.termsOfUseUrl).toBeNull();
  });

  it('falls back to the shipped constants when the request fails (offline / error)', async () => {
    mockedGet.mockRejectedValue(new Error('Network request failed'));
    const { result } = renderHook(() => useChurchContent(), { wrapper: wrapWithQueryClient() });
    expect(result.current.contactEmail).toBe(CONTACT_EMAIL);
    expect(result.current.commentGuidelines).toBe(COMMENTS_TERMS_TEXT);
    expect(result.current.termsOfUseUrl).toBeNull();
    expect(result.current.privacyPolicyUrl).toBeNull();
  });
});

describe('churchContentFrom', () => {
  it('falls back field by field on first launch (no data yet)', () => {
    expect(churchContentFrom(undefined)).toEqual({
      contactEmail: CONTACT_EMAIL,
      commentGuidelines: COMMENTS_TERMS_TEXT,
      termsOfUseUrl: null,
      privacyPolicyUrl: null,
    });
  });
});

describe('safeHttpsUrl', () => {
  it.each([
    ['https://wateredgarden.org/terms', 'https://wateredgarden.org/terms'],
    ['http://wateredgarden.org/terms', null],
    ['javascript:alert(1)', null],
    ['mailto:x@example.com', null],
    ['tel:+233200000000', null],
    ['not a url', null],
    ['https://', null],
    ['https:///path', null],
    ['https://user@evil.example', null],
    ['https://ok.example/a b', null],
    ['https://ok.example/\nx', null],
    ['HTTPS://Watered.example/Privacy?x=1#top', 'HTTPS://Watered.example/Privacy?x=1#top'],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(safeHttpsUrl(input)).toBe(expected);
  });

  it("doesn't depend on URL getters React Native leaves unimplemented", () => {
    const realURL = global.URL;
    class RnLikeURL {
      constructor(public href: string) {}
      get protocol(): string {
        throw new Error('URL.protocol is not implemented');
      }
      get hostname(): string {
        throw new Error('URL.hostname is not implemented');
      }
    }
    (global as unknown as { URL: unknown }).URL = RnLikeURL;
    try {
      expect(safeHttpsUrl('https://wateredgarden.org/privacy')).toBe('https://wateredgarden.org/privacy');
    } finally {
      global.URL = realURL;
    }
  });
});
