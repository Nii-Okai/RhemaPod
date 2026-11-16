import React from 'react';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import { FadeTitle } from '../FadeTitle';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]));
}

describe('FadeTitle', () => {
  it('renders the title as a single line, clipped (no ellipsis) rather than wrapped', () => {
    const { getByText } = render(<FadeTitle width={160}>Understanding the Prophetic</FadeTitle>);

    const textNode = getByText('Understanding the Prophetic');
    expect(textNode.props.numberOfLines).toBe(1);
    expect(textNode.props.ellipsizeMode).toBe('clip');
  });

  it('sizes its container to the given width, not a fixed guess', () => {
    const { UNSAFE_root } = render(<FadeTitle width={220}>Anchored in the Storm</FadeTitle>);

    const outerView = UNSAFE_root.findAllByType(View)[0];
    expect(flattenStyle(outerView.props.style)).toMatchObject({ width: 220 });
  });

  it('renders no literal ellipsis character in the text content', () => {
    const { queryAllByText } = render(<FadeTitle width={160}>A very long series title that overflows</FadeTitle>);
    expect(queryAllByText(/…|\.\.\./)).toHaveLength(0);
  });
});
