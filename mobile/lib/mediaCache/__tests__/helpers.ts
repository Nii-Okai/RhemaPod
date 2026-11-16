/** Shared media-cache test helpers (plan "Cross-cutting: no URL or token anywhere"). */

export const SECRET_MARKER = 'X-Amz-Signature=SECRET123';
export const SECRET_HOST = 'bucket.r2.example-secret-host.com';
export const SECRET_URL = `https://${SECRET_HOST}/audio/sermon.mp3?${SECRET_MARKER}`;

/** Fails if the marker or host appears in any manifest row, path string, or console call argument. */
export function expectNoSecrets(
  manifestRows: readonly unknown[],
  paths: readonly string[],
  consoleSpies: readonly jest.SpyInstance[] = [],
): void {
  const haystacks = [
    JSON.stringify(manifestRows),
    ...paths,
    ...consoleSpies.map((s) => JSON.stringify(s.mock.calls)),
  ];
  for (const h of haystacks) {
    expect(h).not.toContain('SECRET123');
    expect(h).not.toContain(SECRET_HOST);
  }
}

// jest.config.js `testMatch` treats every file under `__tests__/` as a suite, so this
// helper carries a self-test for `expectNoSecrets` rather than an empty-suite failure.
describe('expectNoSecrets', () => {
  it('passes for clean inputs and fails when the marker or host leaks', () => {
    expect(() => expectNoSecrets([{ a: 1 }], ['file:///cache/x.mp3'])).not.toThrow();
    expect(() => expectNoSecrets([{ u: SECRET_URL }], [])).toThrow();
    expect(() => expectNoSecrets([], [`file:///${SECRET_HOST}/x`])).toThrow();
  });
});
