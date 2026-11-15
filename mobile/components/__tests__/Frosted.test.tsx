import React from 'react';
import { Platform, StyleSheet, Text, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  BottomChromeInsetProvider,
  FrostedBackdrop,
  FrostedHeader,
  FrostedStatusBar,
  useBottomChromeInset,
  useFrostedScroll,
} from '../Frosted';
import { palettes } from '../../theme/colors';

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => setOS(originalOS));

const styleOf = (node: { props: { style?: unknown } }): ViewStyle => StyleSheet.flatten(node.props.style as ViewStyle) ?? {};

describe('frosted chrome', () => {
  it('blurs on iOS, with the variant tint and its colour over the blur', () => {
    setOS('ios');
    const { UNSAFE_getByType, getByTestId } = render(<FrostedBackdrop variant="dock" borderRadius={34} />);
    const blur = UNSAFE_getByType('ExpoBlurView' as never);
    expect(blur.props.tint).toBe(palettes.dark.frost.dockTint);
    expect(getByTestId('frost-dock')).toBeTruthy();
  });

  it('draws no blur on Android; the header carries the near-solid colour instead', () => {
    setOS('android');
    const { queryByTestId, getByTestId } = render(
      <FrostedHeader>
        <Text>Discover</Text>
      </FrostedHeader>,
    );
    expect(queryByTestId('frost-header')).toBeNull();
    expect(styleOf(getByTestId('frosted-header')).backgroundColor).toBe(palettes.dark.frost.headerSolid);
  });

  it('shows the header hairline only once the page has scrolled', () => {
    const { getByTestId, rerender } = render(<FrostedHeader scrolled={false} />);
    expect(styleOf(getByTestId('frosted-header')).borderBottomColor).toBe('transparent');
    rerender(<FrostedHeader scrolled />);
    expect(styleOf(getByTestId('frosted-header')).borderBottomColor).toBe(palettes.dark.frost.hairline);
  });

  it('skips the status-bar strip when there is no status bar inset', () => {
    const { queryByTestId } = render(<FrostedStatusBar height={0} />);
    expect(queryByTestId('frosted-status-bar')).toBeNull();
  });

  it('hands the dock height down to the tab screens', () => {
    let seen = -1;
    function Probe() {
      seen = useBottomChromeInset();
      return null;
    }
    render(
      <BottomChromeInsetProvider value={132}>
        <Probe />
      </BottomChromeInsetProvider>,
    );
    expect(seen).toBe(132);
  });

  it.each([
    ['ios', { paddingTop: 16, paddingBottom: 132 }, { top: 90 }, undefined],
    ['android', { paddingTop: 106, paddingBottom: 132 }, undefined, 90],
  ] as const)('on %s starts the scroll below the header and ends it above the dock', (os, padding, inset, spinner) => {
    setOS(os);
    let result: ReturnType<typeof useFrostedScroll> | null = null;
    function Probe() {
      result = useFrostedScroll(90);
      return null;
    }
    render(
      <BottomChromeInsetProvider value={100}>
        <Probe />
      </BottomChromeInsetProvider>,
    );
    expect(result!.contentPadding(16, 32)).toEqual(padding);
    expect(result!.scrollProps.contentInset).toEqual(inset);
    expect(result!.scrollProps.scrollIndicatorInsets).toEqual({ top: 90, bottom: 100 });
    expect(result!.progressViewOffset).toBe(spinner);
  });
});
