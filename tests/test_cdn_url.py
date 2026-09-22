"""Unit tests for `cdn_url_for` — the single seam that decides CDN vs.
presigned URL for every CDN-eligible asset (media playback, thumbnails,
announcement images).

Live security bug this guards against: three services used to independently
overwrite an already-correct presigned URL with a bare, unsigned
`f"{cdn_base_url}/{key}"` string whenever `cdn_base_url` was set. For
deterministic, publicly-guessable keys (media_key()'s sermon_id/kind/quality
path) that let anyone bypass the paid-quality gate by editing the URL. There
is no CDN request-signing implementation in this codebase, so the only safe
behavior today is: never emit an unsigned CDN URL, always fall back to the
presigned one.
"""
from app.core import storage as storage_module

PRESIGNED = "https://s3.example.com/bucket/key?X-Amz-Signature=abc123"


def test_cdn_unset_returns_presigned_unchanged(monkeypatch):
    monkeypatch.setattr(storage_module.settings, "cdn_base_url", None)
    assert (
        storage_module.cdn_url_for("sermons/x/video/1080p/index.m3u8", presigned_fallback=PRESIGNED)
        == PRESIGNED
    )


def test_cdn_set_still_returns_presigned_never_unsigned(monkeypatch):
    """The exact bug: cdn_base_url set, no signing available. Must fall back
    to the presigned URL rather than emit a bare, unsigned CDN URL."""
    monkeypatch.setattr(storage_module.settings, "cdn_base_url", "https://cdn.example.com")
    key = "sermons/00000000-0000-0000-0000-000000000001/video/1080p/index.m3u8"

    url = storage_module.cdn_url_for(key, presigned_fallback=PRESIGNED)

    assert url == PRESIGNED
    assert "cdn.example.com" not in url


def test_cdn_set_logs_the_misconfiguration(monkeypatch, capsys):
    monkeypatch.setattr(storage_module.settings, "cdn_base_url", "https://cdn.example.com")
    storage_module.cdn_url_for("thumbnails/sermons/x/y.jpg", presigned_fallback=PRESIGNED)
    assert "cdn_signing_unavailable" in capsys.readouterr().out
