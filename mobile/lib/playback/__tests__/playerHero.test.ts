import {
  TARGET_TIMEOUT_MS,
  clearPlayerHero,
  getPlayerHero,
  isHeroHiding,
  landPlayerHero,
  launchPlayerHero,
  reportHeroTarget,
  resetPlayerHeroForTests,
  setReduceMotionForTests,
} from '../playerHero';

const from = { x: 20, y: 700, width: 46, height: 46 };
const to = { x: 90, y: 150, width: 211, height: 211 };

describe('playerHero', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlayerHeroForTests();
    setReduceMotionForTests(false);
  });
  afterEach(() => jest.useRealTimers());

  it('waits, flies, lands and clears', () => {
    expect(launchPlayerHero({ sermonId: 's1', uri: 'art', from, fromRadius: 12 })).toBe(true);
    const id = getPlayerHero()!.id;
    expect(getPlayerHero()).toMatchObject({ phase: 'waiting', to: null });
    expect(isHeroHiding(getPlayerHero(), 's1')).toBe(true);

    reportHeroTarget('s1', to, 0);
    expect(getPlayerHero()).toMatchObject({ phase: 'flying', to });

    landPlayerHero(id);
    expect(getPlayerHero()!.phase).toBe('landed');
    expect(isHeroHiding(getPlayerHero(), 's1')).toBe(false);

    clearPlayerHero(id);
    expect(getPlayerHero()).toBeNull();
  });

  it('ignores a target for another sermon', () => {
    launchPlayerHero({ sermonId: 's1', uri: 'art', from, fromRadius: 12 });
    reportHeroTarget('s2', to, 0);
    expect(getPlayerHero()!.phase).toBe('waiting');
    expect(isHeroHiding(getPlayerHero(), 's2')).toBe(false);
  });

  it('drops a launch the player never answers', () => {
    launchPlayerHero({ sermonId: 's1', uri: 'art', from, fromRadius: 12 });
    jest.advanceTimersByTime(TARGET_TIMEOUT_MS);
    expect(getPlayerHero()).toBeNull();
  });

  it('keeps a flight in the air past the timeout', () => {
    launchPlayerHero({ sermonId: 's1', uri: 'art', from, fromRadius: 12 });
    reportHeroTarget('s1', to, 0);
    jest.advanceTimersByTime(TARGET_TIMEOUT_MS);
    expect(getPlayerHero()!.phase).toBe('flying');
  });

  it('starts nothing under Reduce Motion', () => {
    setReduceMotionForTests(true);
    expect(launchPlayerHero({ sermonId: 's1', uri: 'art', from, fromRadius: 12 })).toBe(false);
    expect(getPlayerHero()).toBeNull();
  });

  it('starts nothing without art', () => {
    expect(launchPlayerHero({ sermonId: 's1', uri: null, from, fromRadius: 12 })).toBe(false);
    expect(getPlayerHero()).toBeNull();
  });
});
