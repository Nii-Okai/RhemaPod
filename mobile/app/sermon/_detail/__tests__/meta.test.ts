import { formatMediaFormat, formatPlacement, metaRow1, metaRow2 } from '../meta';
import type { SermonDetail } from '../isPlayable';

const base = {
  series_id: null,
  series_title: null,
  episode_number: null,
  duration_seconds: 1862,
  media_refs: [{ id: 'm1', type: 'video', quality: null, s3_key: 'x', hls_manifest_key: null }],
  published_at: '2026-09-04T12:00:00Z',
} as unknown as SermonDetail;

describe('formatPlacement', () => {
  it('is "Standalone" with no series', () => {
    expect(formatPlacement(base)).toBe('Standalone');
  });

  it('is "{series}, part {n}" when part of a series', () => {
    expect(formatPlacement({ ...base, series_id: 'se1', series_title: 'Storms', episode_number: 3 })).toBe(
      'Storms, part 3',
    );
  });
});

describe('formatMediaFormat', () => {
  it('is null for no media', () => {
    expect(formatMediaFormat([])).toBeNull();
  });

  it('is "audio + video" when both types are present', () => {
    expect(
      formatMediaFormat([
        { id: 'a', type: 'audio', quality: null, s3_key: 'x', hls_manifest_key: null },
        { id: 'v', type: 'video', quality: null, s3_key: 'y', hls_manifest_key: null },
      ]),
    ).toBe('audio + video');
  });

  it('is "audio" alone for an audio-only sermon', () => {
    expect(formatMediaFormat([{ id: 'a', type: 'audio', quality: null, s3_key: 'x', hls_manifest_key: null }])).toBe(
      'audio',
    );
  });
});

describe('metaRow1', () => {
  it('includes the format segment when playable', () => {
    expect(metaRow1(base, true)).toBe('Standalone · 31:02 · video');
  });

  it('omits the format segment outside the playable state', () => {
    expect(metaRow1(base, false)).toBe('Standalone · 31:02');
  });

  it('omits duration when null, without a bare separator', () => {
    expect(metaRow1({ ...base, duration_seconds: null }, true)).toBe('Standalone · video');
  });
});

describe('metaRow2', () => {
  it('includes the renditions clause when playable', () => {
    expect(metaRow2(base, true)).toBe('published Sep 4 · 1 rendition');
  });

  it('pluralizes for more than one rendition', () => {
    expect(
      metaRow2(
        { ...base, media_refs: [...base.media_refs, { id: 'a', type: 'audio', quality: null, s3_key: 'y', hls_manifest_key: null }] },
        true,
      ),
    ).toBe('published Sep 4 · 2 renditions');
  });

  it('drops the renditions clause outside the playable state, keeping the date', () => {
    expect(metaRow2(base, false)).toBe('published Sep 4');
  });

  it('is null when published_at is null', () => {
    expect(metaRow2({ ...base, published_at: null }, true)).toBeNull();
  });
});
