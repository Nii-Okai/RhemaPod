import { TABLET_RAIL_WIDTH, gridCellInset, gridColumnsForWidth, tabContentWidth } from '../responsive';

const cellInset = (column: number, columns: number, card: number, width: number) =>
  gridCellInset(column, columns, card, width, 20, 12);

describe('gridColumnsForWidth', () => {
  it('keeps the phone count below the tablet breakpoint, however wide the content', () => {
    expect(gridColumnsForWidth(390)).toBe(2);
    // Jest's default window (750) and an iPad mini in portrait (744) are phone-class.
    expect(gridColumnsForWidth(750)).toBe(2);
    expect(gridColumnsForWidth(390, 3)).toBe(3);
  });

  it('adds one column on a tablet in portrait and two in landscape', () => {
    // iPad 11" portrait tab screen: 834 window, 746 beside the rail.
    expect(gridColumnsForWidth(746, 2, 834)).toBe(3);
    // iPad 11" landscape: 1194 window, 1106 beside the rail.
    expect(gridColumnsForWidth(1106, 2, 1194)).toBe(4);
    // Android tablet portrait (800dp) beside the rail.
    expect(gridColumnsForWidth(712, 2, 800)).toBe(3);
    expect(gridColumnsForWidth(1194, 3)).toBe(5);
  });
});

describe('tabContentWidth', () => {
  it('takes the rail off a tablet window only', () => {
    expect(tabContentWidth(390)).toBe(390);
    expect(tabContentWidth(834)).toBe(834 - TABLET_RAIL_WIDTH);
  });
});

describe('gridCellInset (category grid: 20 padding, 12 gap)', () => {
  it('matches the old two-column edges', () => {
    const width = 390;
    const card = (width - 20 * 2 - 12) / 2;
    expect(cellInset(0, 2, card, width)).toBe(20);
    // Second card's right edge sits 20 from the screen edge.
    expect(width / 2 + cellInset(1, 2, card, width) + card).toBeCloseTo(width - 20);
  });

  it('spaces any number of columns evenly', () => {
    const width = 1194;
    const columns = 4;
    const card = (width - 20 * 2 - 12 * (columns - 1)) / columns;
    const lefts = [0, 1, 2, 3].map((c) => (c * width) / columns + cellInset(c, columns, card, width));
    expect(lefts[0]).toBe(20);
    expect(lefts[1] - lefts[0]).toBeCloseTo(card + 12);
    expect(lefts[3] + card).toBeCloseTo(width - 20);
  });
});
