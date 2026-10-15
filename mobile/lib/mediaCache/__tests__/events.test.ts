import { emitCacheEvent } from '../events';

describe('emitCacheEvent', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the event name and ids only in __DEV__', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    emitCacheEvent('hit', { sermonId: 's1', mediaRefId: 'm1' });
    expect(spy).toHaveBeenCalledWith('[mediaCache]', 'hit', { sermonId: 's1', mediaRefId: 'm1' });
  });

  it('is silent outside __DEV__', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const g = globalThis as unknown as { __DEV__: boolean };
    const prev = g.__DEV__;
    g.__DEV__ = false;
    try {
      emitCacheEvent('wipe');
    } finally {
      g.__DEV__ = prev;
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
