import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PlaybackSection } from '../PlaybackSection';

describe('PlaybackSection', () => {
  it('never renders a notify-on-publish toggle (plan L5 — push is cut entirely)', () => {
    const { queryByText, queryByLabelText } = render(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries
        onChangeSpeed={() => {}}
        onChangeAutoplay={() => {}}
      />,
    );
    expect(queryByText(/notify/i)).toBeNull();
    expect(queryByLabelText(/notify/i)).toBeNull();
  });

  it('marks the current default speed as selected and calls onChangeSpeed with the pressed one', () => {
    const onChangeSpeed = jest.fn();
    const { getByLabelText } = render(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries
        onChangeSpeed={onChangeSpeed}
        onChangeAutoplay={() => {}}
      />,
    );

    expect(getByLabelText('Default speed 1×').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Default speed 1.5×').props.accessibilityState.selected).toBe(false);

    fireEvent.press(getByLabelText('Default speed 1.5×'));
    expect(onChangeSpeed).toHaveBeenCalledWith(1.5);
  });

  it('reports the current autoplay value and calls onChangeAutoplay with the inverse on press', () => {
    const onChangeAutoplay = jest.fn();
    const { getByLabelText } = render(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries={false}
        onChangeSpeed={() => {}}
        onChangeAutoplay={onChangeAutoplay}
      />,
    );

    const toggle = getByLabelText('Autoplay next in series');
    expect(toggle.props.accessibilityState.checked).toBe(false);
    fireEvent.press(toggle);
    expect(onChangeAutoplay).toHaveBeenCalledWith(true);
  });

  it('disables every control while a save is in flight', () => {
    const onChangeSpeed = jest.fn();
    const onChangeAutoplay = jest.fn();
    const { getByLabelText } = render(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries
        onChangeSpeed={onChangeSpeed}
        onChangeAutoplay={onChangeAutoplay}
        disabled
      />,
    );

    fireEvent.press(getByLabelText('Default speed 1.5×'));
    fireEvent.press(getByLabelText('Autoplay next in series'));
    expect(onChangeSpeed).not.toHaveBeenCalled();
    expect(onChangeAutoplay).not.toHaveBeenCalled();
  });

  it('renders no error text by default, and the given message when the caller passes one', () => {
    const { queryByText, rerender } = render(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries
        onChangeSpeed={() => {}}
        onChangeAutoplay={() => {}}
      />,
    );
    expect(queryByText(/couldn't save/i)).toBeNull();

    rerender(
      <PlaybackSection
        defaultSpeed={1}
        autoplayNextInSeries
        onChangeSpeed={() => {}}
        onChangeAutoplay={() => {}}
        error="Couldn't save your playback settings. Try again."
      />,
    );
    expect(queryByText("Couldn't save your playback settings. Try again.")).toBeTruthy();
  });
});
