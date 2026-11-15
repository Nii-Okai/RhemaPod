import * as Haptics from 'expo-haptics';
import { haptics } from '../haptics';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

const impact = Haptics.impactAsync as jest.Mock;
const selection = Haptics.selectionAsync as jest.Mock;

beforeEach(() => {
  impact.mockReset().mockResolvedValue(undefined);
  selection.mockReset().mockResolvedValue(undefined);
});

it('maps each moment to a light touch', () => {
  haptics.tap();
  haptics.toggleOn();
  haptics.toggleOff();
  haptics.download();
  haptics.grab();
  haptics.settle();
  expect(impact.mock.calls).toEqual([['light'], ['medium'], ['light'], ['light']]);
  expect(selection).toHaveBeenCalledTimes(2);
});

it('never throws on a build without the native module', async () => {
  impact.mockRejectedValue(new Error('UnavailabilityError'));
  selection.mockImplementation(() => {
    throw new Error('missing');
  });
  expect(() => haptics.tap()).not.toThrow();
  expect(() => haptics.settle()).not.toThrow();
  // Let the swallowed rejection settle; an unhandled one would fail the run.
  await Promise.resolve();
});
