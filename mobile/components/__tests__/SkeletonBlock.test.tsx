import React from 'react';
import { render } from '@testing-library/react-native';
import { SkeletonBlock } from '../SkeletonBlock';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]));
}

describe('SkeletonBlock', () => {
  it('is hidden from the accessibility tree — a loading placeholder carries no content', () => {
    const tree = render(<SkeletonBlock height={120} />).toJSON();
    expect(tree?.props.accessible).toBe(false);
  });

  it('sizes itself to the given width/height rather than a fixed guess', () => {
    const tree = render(<SkeletonBlock width={200} height={16} />).toJSON();
    expect(flattenStyle(tree?.props.style)).toMatchObject({ width: 200, height: 16 });
  });
});
