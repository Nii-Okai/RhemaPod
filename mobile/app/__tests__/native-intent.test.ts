import { redirectSystemPath } from '../+native-intent';
import * as session from '../../lib/auth/session';
import { clearPendingLink, takePendingLink } from '../../lib/linking/pendingLink';
import { GOOGLE_CALLBACK_SCHEME } from '../../lib/linking/allowList';

jest.mock('../../lib/auth/session', () => ({ getStatus: jest.fn() }));

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const mockedStatus = session.getStatus as jest.Mock;

beforeEach(() => {
  mockedStatus.mockReset();
  clearPendingLink();
});

describe('redirectSystemPath', () => {
  it('signed in, warm: routes straight to the content and stashes nothing', () => {
    mockedStatus.mockReturnValue('signedIn');
    expect(redirectSystemPath({ path: `https://open.rhemapod.com/sermon/${ID}`, initial: false })).toBe(`/sermon/${ID}`);
    expect(takePendingLink()).toBeNull();
  });

  it.each(['signedOut', 'loading'])('%s: stashes the route and lands on /', (status) => {
    mockedStatus.mockReturnValue(status);
    expect(redirectSystemPath({ path: `rhemapod://series/${ID}`, initial: false })).toBe('/');
    expect(takePendingLink()).toBe(`/series/${ID}`);
  });

  it('cold start while signed in: stashes (home first, target replayed after) and lands on /', () => {
    mockedStatus.mockReturnValue('signedIn');
    expect(redirectSystemPath({ path: `https://open.rhemapod.com/playlist/${ID}`, initial: true })).toBe('/');
    expect(takePendingLink()).toBe(`/playlist/${ID}`);
  });

  it('a second link while signed out overwrites the first', () => {
    mockedStatus.mockReturnValue('signedOut');
    redirectSystemPath({ path: `rhemapod://sermon/${ID}`, initial: true });
    redirectSystemPath({ path: `rhemapod://series/${ID}`, initial: false });
    expect(takePendingLink()).toBe(`/series/${ID}`);
  });

  it('junk goes home and is never stashed', () => {
    mockedStatus.mockReturnValue('signedOut');
    expect(redirectSystemPath({ path: 'https://evil.com/sermon/x', initial: true })).toBe('/');
    expect(redirectSystemPath({ path: 'rhemapod://playlist/create', initial: false })).toBe('/');
    expect(takePendingLink()).toBeNull();
  });

  it('passes the Google sign-in callback through untouched', () => {
    mockedStatus.mockReturnValue('signedOut');
    const cb = `${GOOGLE_CALLBACK_SCHEME}:/oauthredirect`;
    expect(redirectSystemPath({ path: cb, initial: false })).toBe(cb);
  });

  it('sends a foreign Google-scheme link home', () => {
    mockedStatus.mockReturnValue('signedOut');
    expect(redirectSystemPath({ path: 'com.googleusercontent.apps.attacker:/oauthredirect', initial: false })).toBe('/');
  });
});
