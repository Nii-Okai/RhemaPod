import { nextRelatedSermonRoute, RELATED_PARAM, RELATED_PARAM_VALUE } from '../detailTransition';

// `sermonDetailScreenOptions` (a function `Stack.Screen` `options` prop computing the
// transition per `route.params`) was removed after Isaac reported no visible animation
// change on-device despite it type-checking and unit-testing fine — see
// `app/sermon/related/[id].tsx`'s own doc comment for the two-route replacement. These
// two constants are the only piece of that mechanism still in use (the component's own
// back-chevron logic, not anything navigator-level), so that's all that's left to test
// here.
describe('RELATED_PARAM / RELATED_PARAM_VALUE', () => {
  it('are the exact key/value sermon/[id] and sermon/related/[id] both tag related pushes with', () => {
    expect(RELATED_PARAM).toBe('related');
    expect(RELATED_PARAM_VALUE).toBe('1');
  });
});

describe('nextRelatedSermonRoute', () => {
  it('pushes the first Related route when not already on a Related screen', () => {
    expect(nextRelatedSermonRoute('/sermon/abc123')).toBe('/sermon/related/[id]');
  });

  it('alternates to the second Related route when already on the first', () => {
    expect(nextRelatedSermonRoute('/sermon/related/abc123')).toBe('/sermon/related2/[id]');
  });

  it('alternates back to the first Related route when already on the second', () => {
    expect(nextRelatedSermonRoute('/sermon/related2/abc123')).toBe('/sermon/related/[id]');
  });
});
