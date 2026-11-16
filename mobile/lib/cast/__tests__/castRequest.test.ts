import { buildCastRequest, contentTypeFor } from '../castRequest';

describe('contentTypeFor', () => {
  it('reads the type from the path, ignoring the signed query string', () => {
    expect(contentTypeFor({ type: 'video', url: 'https://x.cloudflarestream.com/tok/manifest/video.m3u8?t=1' })).toBe(
      'application/x-mpegurl',
    );
    expect(contentTypeFor({ type: 'video', url: 'https://cdn.example.com/s/video.MP4?X-Amz-Signature=a.b' })).toBe('video/mp4');
    expect(contentTypeFor({ type: 'audio', url: 'https://cdn.example.com/s/audio.m4a' })).toBe('audio/mp4');
    expect(contentTypeFor({ type: 'audio', url: 'https://cdn.example.com/s/audio.mp3' })).toBe('audio/mpeg');
  });

  it('falls back by rendition type for an unknown extension', () => {
    expect(contentTypeFor({ type: 'audio', url: 'https://cdn.example.com/s/audio' })).toBe('audio/mpeg');
    expect(contentTypeFor({ type: 'video', url: 'https://cdn.example.com/s/master.bin' })).toBe('video/mp4');
  });
});

describe('buildCastRequest', () => {
  const variant = { type: 'video' as const, url: 'https://x.cloudflarestream.com/tok/manifest/video.m3u8' };

  it('labels the media with the title, subtitle and art, and resumes where asked', () => {
    expect(
      buildCastRequest(
        { sermonId: 'e2', title: 'Part 2', subtitle: 'The Destiny of the Church', imageUrl: 'https://img/2.jpg', startTime: 2940 },
        variant,
      ),
    ).toEqual({
      autoplay: true,
      startTime: 2940,
      mediaInfo: {
        contentId: 'e2',
        contentUrl: variant.url,
        contentType: 'application/x-mpegurl',
        metadata: {
          type: 'generic',
          title: 'Part 2',
          subtitle: 'The Destiny of the Church',
          images: [{ url: 'https://img/2.jpg' }],
        },
      },
    });
  });

  it('starts from the top with no art when none is given', () => {
    const request = buildCastRequest({ sermonId: 'e1', title: 'Part 1', startTime: 0 }, variant);
    expect(request.startTime).toBeUndefined();
    expect(request.mediaInfo?.metadata?.images).toBeUndefined();
  });
});
