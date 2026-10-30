import { ApiError, networkError } from '../../api/errors';
import { APPLE_UNAVAILABLE_DETAIL, deletionErrorFor, planReauth } from '../accountDeletion';

jest.mock('../../api/typedClient', () => ({ api: { post: jest.fn() } }));

describe('planReauth', () => {
  it.each([
    // [has_password, linked, appleAvailable] -> primary, nonApple, skipAppleFromStart
    [true, [], false, 'password', ['password'], false],
    [false, ['google'], false, 'google', ['google'], false],
    [true, ['google'], true, 'password', ['password', 'google'], false],
    [false, ['apple'], true, 'apple', [], false],
    [true, ['apple'], true, 'apple', ['password'], false],
    [true, ['apple'], false, 'password', ['password'], true],
    [false, ['apple', 'google'], false, 'google', ['google'], true],
    [false, ['apple'], false, null, [], true],
  ] as const)(
    'password=%s linked=%j apple=%s -> %s',
    (hasPassword, linked, appleAvailable, primary, nonApple, skip) => {
      const plan = planReauth({ has_password: hasPassword, linked_providers: [...linked] }, appleAvailable);
      expect(plan.primary).toBe(primary);
      expect(plan.nonApple).toEqual(nonApple);
      expect(plan.skipAppleFromStart).toBe(skip);
      expect(plan.appleLinked).toBe(linked.includes('apple' as never));
    },
  );

  it('treats a missing linked_providers as none', () => {
    expect(planReauth({ has_password: true }, true).primary).toBe('password');
  });
});

describe('deletionErrorFor', () => {
  it.each([
    [400, 'apple', 'badRequest'],
    [403, 'password', 'reauth'],
    [409, 'password', 'conflict'],
    [429, 'password', 'rateLimited'],
    [503, 'password', 'generic'],
    [500, 'google', 'generic'],
  ] as const)('%s on %s -> %s', (status, method, kind) => {
    expect(deletionErrorFor(new ApiError(status, 'detail'), method).kind).toBe(kind);
  });

  it('counts only the exact Apple detail as appleUnavailable', () => {
    expect(deletionErrorFor(new ApiError(503, APPLE_UNAVAILABLE_DETAIL), 'apple').kind).toBe('appleUnavailable');
  });

  it.each([
    'Account deletion is temporarily unavailable. Try again shortly.',
    'Sign-in temporarily unavailable',
    'Authentication service temporarily unavailable. Please retry.',
  ])('maps an Apple-path 503 with another detail (%s) to generic', (detail) => {
    const err = deletionErrorFor(new ApiError(503, detail), 'apple');
    expect(err.kind).toBe('generic');
    expect(err.message).toBe(detail);
  });

  it('gives a 403 one generic message (no account-state hints)', () => {
    const a = deletionErrorFor(new ApiError(403, 'Could not confirm your identity'), 'password');
    const b = deletionErrorFor(new ApiError(403, 'something else'), 'google');
    expect(a.message).toBe(b.message);
  });

  it('maps network and unknown errors', () => {
    expect(deletionErrorFor(networkError(), 'apple').kind).toBe('network');
    expect(deletionErrorFor(new Error('x'), 'apple').kind).toBe('generic');
  });
});
