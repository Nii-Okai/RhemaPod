import { resolveCta } from '../cta';
import type { SermonDetail } from '../isPlayable';

const base = {
  locked: false,
  duration_seconds: 1862,
  media_refs: [{ id: 'm1', type: 'video', quality: null, s3_key: 'x', hls_manifest_key: null }],
} as unknown as SermonDetail;

describe('resolveCta', () => {
  it('is the disabled no-media state when media_refs is empty', () => {
    const cta = resolveCta({ ...base, media_refs: [] }, null);
    expect(cta).toEqual({
      disabled: true,
      label: 'Not available yet',
      accessibilityLabel: 'Not available yet',
      secondaryReadout: null,
      caption: 'Video is still processing — check back soon.',
    });
  });

  it('is the same disabled no-media state when locked, even with media present', () => {
    const cta = resolveCta({ ...base, locked: true }, null);
    expect(cta.disabled).toBe(true);
    expect(cta.label).toBe('Not available yet');
  });

  it('is Fresh (Play) with full duration when there is no progress and the sermon has video', () => {
    const cta = resolveCta(base, null);
    expect(cta).toMatchObject({ disabled: false, label: 'Play', accessibilityLabel: 'Play sermon', secondaryReadout: '31:02' });
  });

  it('is Fresh (Listen) when there is no video rendition', () => {
    const audioOnly: SermonDetail = {
      ...base,
      media_refs: [{ id: 'a', type: 'audio' as const, quality: null, s3_key: 'x', hls_manifest_key: null }],
    };
    const cta = resolveCta(audioOnly, null);
    expect(cta).toMatchObject({ label: 'Listen', accessibilityLabel: 'Listen to sermon' });
  });

  it('is Resume with remaining time when progress is incomplete and position > 0', () => {
    const cta = resolveCta(base, {
      sermon_id: 's1',
      position_seconds: 600,
      completed: false,
      play_count: 1,
      watched_seconds: 600,
      last_played_at: '2026-09-10T00:00:00Z',
    });
    expect(cta).toMatchObject({
      disabled: false,
      label: 'Resume',
      accessibilityLabel: 'Resume sermon, 21:02 remaining',
      secondaryReadout: '21:02',
    });
  });

  it('floors remaining time at 0 rather than going negative on a stale duration', () => {
    const cta = resolveCta(base, {
      sermon_id: 's1',
      position_seconds: 5000,
      completed: false,
      play_count: 1,
      watched_seconds: 5000,
      last_played_at: '2026-09-10T00:00:00Z',
    });
    expect(cta.secondaryReadout).toBe('0:00');
  });

  it('collapses a completed progress row to Fresh, not Resume', () => {
    const cta = resolveCta(base, {
      sermon_id: 's1',
      position_seconds: 1862,
      completed: true,
      play_count: 2,
      watched_seconds: 1862,
      last_played_at: '2026-09-10T00:00:00Z',
    });
    expect(cta.label).toBe('Play');
  });
});
