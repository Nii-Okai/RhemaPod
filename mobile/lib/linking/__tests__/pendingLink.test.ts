import { clearPendingLink, PENDING_LINK_TTL_MS, stashPendingLink, takePendingLink } from '../pendingLink';

describe('pendingLink', () => {
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    clearPendingLink();
  });
  afterEach(() => jest.restoreAllMocks());

  it('replays a stashed link exactly once', () => {
    stashPendingLink('/sermon/a');
    expect(takePendingLink()).toBe('/sermon/a');
    expect(takePendingLink()).toBeNull();
  });

  it('a second link overwrites the first', () => {
    stashPendingLink('/sermon/a');
    stashPendingLink('/series/b');
    expect(takePendingLink()).toBe('/series/b');
    expect(takePendingLink()).toBeNull();
  });

  it('still replays at the TTL boundary, not after it', () => {
    stashPendingLink('/sermon/a');
    now += PENDING_LINK_TTL_MS;
    expect(takePendingLink()).toBe('/sermon/a');
  });

  it('does not replay once the TTL has expired, and clears the slot', () => {
    stashPendingLink('/sermon/a');
    now += PENDING_LINK_TTL_MS + 1;
    expect(takePendingLink()).toBeNull();
    now -= PENDING_LINK_TTL_MS;
    expect(takePendingLink()).toBeNull();
  });

  it('clearPendingLink empties the slot', () => {
    stashPendingLink('/sermon/a');
    clearPendingLink();
    expect(takePendingLink()).toBeNull();
  });
});
