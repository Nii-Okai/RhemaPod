import { hasSeenOnboarding, markOnboardingSeen } from '../onboardingSeen';

jest.mock('expo-sqlite/kv-store', () => {
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

function mockedStorage() {
  return jest.requireMock('expo-sqlite/kv-store').AsyncStorage as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    __reset: () => void;
  };
}

describe('onboardingSeen', () => {
  beforeEach(() => {
    mockedStorage().__reset();
  });

  it('reports unseen when nothing has been saved yet', async () => {
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('round-trips seen after marking it', async () => {
    await markOnboardingSeen();
    expect(await hasSeenOnboarding()).toBe(true);
  });

  it('fails open (reports unseen) rather than throwing on a storage read error', async () => {
    mockedStorage().getItem.mockRejectedValueOnce(new Error('disk error'));
    expect(await hasSeenOnboarding()).toBe(false);
  });

  it('does not throw when the write fails (best-effort)', async () => {
    mockedStorage().setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
  });
});
