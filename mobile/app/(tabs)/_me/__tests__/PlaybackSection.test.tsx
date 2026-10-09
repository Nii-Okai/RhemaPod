import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PlaybackSection } from '../PlaybackSection';

describe('PlaybackSection', () => {
  it('never renders a notify-on-publish toggle (plan L5 — push is cut entirely)', () => {
    const { queryByText, queryByLabelText } = render(
      <PlaybackSection autoplayNextInSeries onChangeAutoplay={() => {}} />,
    );
    expect(queryByText(/notify/i)).toBeNull();
    expect(queryByLabelText(/notify/i)).toBeNull();
  });

  it('no longer renders a default-speed picker (Isaac\'s ask, session 2026-10-09 — the Player screen\'s own in-session speed control covers it)', () => {
    const { queryByText, queryByLabelText } = render(
      <PlaybackSection autoplayNextInSeries onChangeAutoplay={() => {}} />,
    );
    expect(queryByText(/default speed/i)).toBeNull();
    expect(queryByLabelText(/default speed/i)).toBeNull();
  });

  it('reports the current autoplay value and calls onChangeAutoplay with the inverse on press', () => {
    const onChangeAutoplay = jest.fn();
    const { getByLabelText } = render(
      <PlaybackSection autoplayNextInSeries={false} onChangeAutoplay={onChangeAutoplay} />,
    );

    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(false);
    fireEvent.press(toggle);
    expect(onChangeAutoplay).toHaveBeenCalledWith(true);
  });

  it('disables the toggle while a save is in flight', () => {
    const onChangeAutoplay = jest.fn();
    const { getByLabelText } = render(
      <PlaybackSection autoplayNextInSeries onChangeAutoplay={onChangeAutoplay} disabled />,
    );

    fireEvent.press(getByLabelText('Autoplay next in series'));
    expect(onChangeAutoplay).not.toHaveBeenCalled();
  });

  it('renders no error text by default, and the given message when the caller passes one', () => {
    const { queryByText, rerender } = render(
      <PlaybackSection autoplayNextInSeries onChangeAutoplay={() => {}} />,
    );
    expect(queryByText(/couldn't save/i)).toBeNull();

    rerender(
      <PlaybackSection
        autoplayNextInSeries
        onChangeAutoplay={() => {}}
        error="Couldn't save your playback settings. Try again."
      />,
    );
    expect(queryByText("Couldn't save your playback settings. Try again.")).toBeTruthy();
  });
});
