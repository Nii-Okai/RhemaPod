import { useWindowDimensions } from 'react-native';
import { deviceClassForWidth } from './useDeviceClass';

/**
 * Tablet layout rules (tablet mockups, Nii 2026-11-21). Like `useDeviceClass`, everything
 * here reads live window width, never the device model, so rotation and iPad Split View
 * resize the layout as they happen. Phones are narrower than every breakpoint below, so
 * they keep the layouts they have.
 */

/** The tablet rail's width (`TabletRail`), which tab screens lose from the window's width. */
export const TABLET_RAIL_WIDTH = 88;

/** Widest a column of reading content gets (lists, settings, sermon text), centred. */
export const READABLE_MAX_WIDTH = 760;

/** On a tablet, content this wide or wider gets two more grid columns than a phone (one
 * more below it). */
export const GRID_TWO_EXTRA_COLUMNS_WIDTH = 900;

/** At this window width and up the player and series screens split into two panes. */
export const TWO_PANE_MIN_WIDTH = 1000;

/**
 * How many columns a grid gets in `contentWidth`, given what it shows on a phone. Below
 * the tablet breakpoint (by window width, the same rule that brings in the rail) it's
 * always the phone count; on a tablet, portrait (about 750pt of content) gets one more,
 * landscape (about 1100pt) two.
 */
export function gridColumnsForWidth(contentWidth: number, phoneColumns = 2, windowWidth = contentWidth): number {
  if (deviceClassForWidth(windowWidth) === 'phone') return phoneColumns;
  return contentWidth >= GRID_TWO_EXTRA_COLUMNS_WIDTH ? phoneColumns + 2 : phoneColumns + 1;
}

/**
 * For a list that gives each of `columns` an equal share of `width` (FlashList with
 * `numColumns`): the left inset of a `cardWidth` card in `column`, so the row sits
 * `padding` from both edges with `gap` between cards.
 */
export function gridCellInset(
  column: number,
  columns: number,
  cardWidth: number,
  width: number,
  padding: number,
  gap: number,
): number {
  return padding + column * (cardWidth + gap) - column * (width / columns);
}

/** The width a tab screen gets: the window's, less the rail when the rail shows. */
export function tabContentWidth(windowWidth: number): number {
  return deviceClassForWidth(windowWidth) === 'tablet' ? windowWidth - TABLET_RAIL_WIDTH : windowWidth;
}

/** Width of the content area of a tab screen (beside the rail on tablets). */
export function useTabContentWidth(): number {
  const { width } = useWindowDimensions();
  return tabContentWidth(width);
}

/** Columns for a grid on a tab screen (sized to the content beside the rail). */
export function useTabGridColumns(phoneColumns = 2): number {
  const { width } = useWindowDimensions();
  return gridColumnsForWidth(tabContentWidth(width), phoneColumns, width);
}

/** Whether the window is wide enough for the two-pane player and series layouts. */
export function useTwoPane(): boolean {
  const { width } = useWindowDimensions();
  return width >= TWO_PANE_MIN_WIDTH;
}
