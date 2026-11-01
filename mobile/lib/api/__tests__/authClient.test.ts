import { oauthGoogle } from '../authClient';

const pair = { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 900 };

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => pair });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe('oauthGoogle', () => {
  it('posts exactly id_token for an id_token credential', async () => {
    await expect(oauthGoogle({ kind: 'id_token', idToken: 'tok' })).resolves.toEqual(pair);
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/oauth/google');
    expect(sentBody()).toEqual({ id_token: 'tok' });
  });

  it('posts exactly server_auth_code for a server_auth_code credential', async () => {
    await oauthGoogle({ kind: 'server_auth_code', code: 'code-1' });
    expect(sentBody()).toEqual({ server_auth_code: 'code-1' });
  });

  it('surfaces a network failure as an error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(oauthGoogle({ kind: 'server_auth_code', code: 'c' })).rejects.toBeDefined();
  });
});
