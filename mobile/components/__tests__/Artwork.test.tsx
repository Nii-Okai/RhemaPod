import React from 'react';
import { render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { ART_FADE_MS, Artwork, artworkCacheKey } from '../Artwork';

describe('artworkCacheKey', () => {
  it('drops the signature so a re-signed URL hits the same cache entry', () => {
    expect(artworkCacheKey('https://media.example/thumbnails/sermon/1/abc.jpg?X-Amz-Signature=x&X-Amz-Date=y')).toBe(
      'https://media.example/thumbnails/sermon/1/abc.jpg',
    );
  });

  it('leaves unsigned and local paths alone', () => {
    expect(artworkCacheKey('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    expect(artworkCacheKey('file:///downloads/dl-1.thumb')).toBe('file:///downloads/dl-1.thumb');
  });
});

describe('Artwork', () => {
  it('caches on memory and disk, keyed and recycled by the path, and fades in', () => {
    const { UNSAFE_getByType } = render(<Artwork uri="https://cdn.example/a.jpg?sig=1" />);
    const image = UNSAFE_getByType(Image);
    expect(image.props.source).toEqual({ uri: 'https://cdn.example/a.jpg?sig=1', cacheKey: 'https://cdn.example/a.jpg' });
    expect(image.props.cachePolicy).toBe('memory-disk');
    expect(image.props.recyclingKey).toBe('https://cdn.example/a.jpg');
    expect(image.props.transition).toBe(ART_FADE_MS);
    expect(image.props.contentFit).toBe('cover');
  });

  it('shows the bundled fallback when there is no art', () => {
    const { UNSAFE_getByType } = render(<Artwork uri={null} fallback={42} />);
    expect(UNSAFE_getByType(Image).props.source).toBe(42);
  });
});
