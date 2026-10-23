import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { artFitFor, FittedArt } from '../FittedArt';

describe('artFitFor', () => {
  it('fills the frame when the art is (nearly) the same shape', () => {
    expect(artFitFor(1, 1)).toBe('fill');
    expect(artFitFor(16 / 9, 1.8)).toBe('fill');
  });

  it('fits the whole piece when the shapes differ', () => {
    expect(artFitFor(1, 16 / 9)).toBe('fit');
    expect(artFitFor(1, 130 / 190)).toBe('fit');
  });

  it('fits until both shapes are known', () => {
    expect(artFitFor(null, 1)).toBe('fit');
    expect(artFitFor(1, null)).toBe('fit');
  });
});

describe('FittedArt', () => {
  it('adds the blurred backdrop only once a mismatched shape is known', () => {
    const { getByTestId, UNSAFE_getAllByType, UNSAFE_root } = render(<FittedArt uri="https://cdn.example/a.jpg" testID="art" />);
    const { Image } = jest.requireActual('react-native');
    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
    expect(getByTestId('art').props.resizeMode).toBe('contain');

    fireEvent(UNSAFE_root.findAll((n: { props: { onLayout?: unknown } }) => Boolean(n.props.onLayout))[0], 'layout', {
      nativeEvent: { layout: { width: 240, height: 135 } },
    });
    fireEvent(getByTestId('art'), 'load', { nativeEvent: { source: { width: 1080, height: 1080 } } });

    expect(UNSAFE_getAllByType(Image)).toHaveLength(2);
    expect(getByTestId('art').props.resizeMode).toBe('contain');
  });

  it('just fills the frame when the art matches it', () => {
    const { getByTestId, UNSAFE_getAllByType, UNSAFE_root } = render(<FittedArt uri="https://cdn.example/b.jpg" testID="art" />);
    const { Image } = jest.requireActual('react-native');
    fireEvent(UNSAFE_root.findAll((n: { props: { onLayout?: unknown } }) => Boolean(n.props.onLayout))[0], 'layout', {
      nativeEvent: { layout: { width: 150, height: 150 } },
    });
    fireEvent(getByTestId('art'), 'load', { nativeEvent: { source: { width: 1080, height: 1080 } } });

    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
    expect(getByTestId('art').props.resizeMode).toBe('cover');
  });
});
