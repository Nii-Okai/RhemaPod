import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
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
    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
    expect(getByTestId('art').props.contentFit).toBe('contain');

    fireEvent(UNSAFE_root.findAll((n: { props: { onLayout?: unknown } }) => Boolean(n.props.onLayout))[0], 'layout', {
      nativeEvent: { layout: { width: 240, height: 135 } },
    });
    fireEvent(getByTestId('art'), 'load', { source: { width: 1080, height: 1080 } });

    expect(UNSAFE_getAllByType(Image)).toHaveLength(2);
    expect(getByTestId('art').props.contentFit).toBe('contain');
  });

  it('just fills the frame when the art matches it', () => {
    const { getByTestId, UNSAFE_getAllByType, UNSAFE_root } = render(<FittedArt uri="https://cdn.example/b.jpg" testID="art" />);
    fireEvent(UNSAFE_root.findAll((n: { props: { onLayout?: unknown } }) => Boolean(n.props.onLayout))[0], 'layout', {
      nativeEvent: { layout: { width: 150, height: 150 } },
    });
    fireEvent(getByTestId('art'), 'load', { source: { width: 1080, height: 1080 } });

    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
    expect(getByTestId('art').props.contentFit).toBe('cover');
  });

  it('forgets the previous art\'s shape when a recycled row is handed different art', () => {
    const { getByTestId, rerender, UNSAFE_getAllByType, UNSAFE_root } = render(<FittedArt uri="https://cdn.example/c.jpg" testID="art" />);
    fireEvent(UNSAFE_root.findAll((n: { props: { onLayout?: unknown } }) => Boolean(n.props.onLayout))[0], 'layout', {
      nativeEvent: { layout: { width: 240, height: 135 } },
    });
    fireEvent(getByTestId('art'), 'load', { source: { width: 1080, height: 1080 } });
    expect(UNSAFE_getAllByType(Image)).toHaveLength(2);

    rerender(<FittedArt uri="https://cdn.example/never-seen.jpg" testID="art" />);
    expect(UNSAFE_getAllByType(Image)).toHaveLength(1);
  });

  it('remembers a shape across sign windows, since the cache keys on the path', () => {
    const first = render(<FittedArt uri="https://cdn.example/d.jpg?X-Amz-Signature=day1" testID="art" />);
    fireEvent(first.getByTestId('art'), 'load', { source: { width: 1080, height: 1080 } });
    first.unmount();

    const second = render(<FittedArt uri="https://cdn.example/d.jpg?X-Amz-Signature=day2" testID="art" />);
    expect(second.UNSAFE_getAllByType(Image)).toHaveLength(2);
  });
});
