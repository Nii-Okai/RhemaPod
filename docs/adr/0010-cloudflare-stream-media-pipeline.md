# ADR 0010 — Media pipeline: Cloudflare Stream, with S3 Glacier as a non-severable condition

- **Status:** Accepted
- **Date:** 2026-09-23
- **Scope:** `fastapi_sermon` backend — `app/core/stream.py` (new provider
  seam), `app/services/media_service.py` (ingest, webhook, sweep, archival,
  `get_stream`/`get_audio_download`), `app/api/media.py` (webhook route,
  new audio-download route), `app/core/storage.py` (`copy_object`,
  `archive_key`), `app/core/config.py` / `app/scripts/preflight.py`
  (Stream + Glacier config, production/staging gating), migration
  `c7d8e9f0a1b2` (additive: `media_refs.stream_uid`, `upload_jobs`
  bookkeeping), `DEPLOYMENT.md` §12. Non-additive OpenAPI change: deleted
  `FREE_TIER_MAX_QUALITY`. Shipped in `84d6203` on `main`.
- **Deciders:** Isaac (+ architect, skeptic, senior-dev-backend,
  reviewer-gilfoyle, security-reviewer)
- **Relates to:** `plans/plan-mobile-app.md` §A.2 and Locked decisions
  L8–L10; supersedes nothing (this is the first ADR for the media
  pipeline — the pipeline predating this decision had no transcode/CDN
  path in production, only passthrough S3)

> Chooses Cloudflare Stream for transcode, delivery, and playback
> authorization, over building the equivalent in-house. The decision is
> conditional, not a plain vendor pick: source masters must be archived to
> S3 Glacier Deep Archive at ingest, in the same phase, not as a follow-up.
> Without that condition this is a one-way bet on a vendor for a permanent
> teaching archive; with it, the choice is reversible.

---

## Context

The mobile app needs adaptive-bitrate HLS playback and offline audio
download for a growing sermon catalogue that is meant to be a **permanent**
archive, not disposable content. The existing pipeline only did passthrough
S3 delivery (plus an unused, ungated legacy multi-rendition transcode path)
— no adaptive bitrate, no signed playback, nothing that scales past "serve
the file."

Three shapes were on the table:

1. **Cloudflare Stream** — vendor transcode, storage, delivery, and signed
   playback tokens, driven by an async ingest API and a ready/error webhook.
2. **Self-hosted FFmpeg + `arq`** — a worker queue running FFmpeg transcodes
   against the existing S3 buckets, in the idiom `app/api/auth.py`'s
   `BackgroundTasks` already establishes for lightweight async work (ADR
   0001 explicitly declined a real job queue for that single existing use
   case — this would have been the second use case justifying one).
3. **AWS MediaConvert + S3 + CloudFront** — AWS-native transcode into S3,
   served through CloudFront with signed cookies/URLs.

Two structural risks ruled out the in-house options rather than a pure
feature comparison:

- **Options 2 and 3 both require building and operating playback
  authorization from scratch** — a worker queue with retry/backoff
  semantics this codebase doesn't otherwise need (option 2), or a
  CloudFront signed-cookie/keypair integration against `expo-video`/AVPlayer
  that nothing in this stack has attempted before (option 3). Cloudflare
  Stream issues its own signed playback tokens; there is no keypair to
  manage and no cookie-jar problem on a native player.
- **Both push real engineering time into infrastructure that is not the
  product** — a church sermon archive's differentiator is never "we run our
  own transcode farm."

The W0.2 hardware spike (`plans/plan-mobile-app.md` §C) exists specifically
because architect judged the Stream + `expo-video` signed-HLS path
**lower-risk than the CloudFront/AVPlayer-cookie spike it replaces** — and
was explicit that the judgment itself is what the spike exists to test, not
an assumption to build on unverified. The spike passed (GATE M3, simulator
run, real-hardware confirmation deferred to M11 per Isaac's plan amendment).

**The condition that makes this reversible.** A vendor transcode+CDN choice
for a *permanent* archive is a real bet: if Cloudflare Stream becomes
unavailable, is deprecated, or the relationship ends for any reason, every
sermon becomes unplayable unless the source masters exist somewhere this
system controls. Architect was explicit that source-master archival to S3
Glacier Deep Archive is not an add-on to the Stream decision — it is the
thing that makes choosing a vendor over owned infrastructure reversible at
all. `plans/plan-mobile-app.md` §A.2 and Locked row L8 both record it as
**non-severable**: "W1.4 (Glacier) is inside the same phase and the same
gate as W1.3 (ingest). It is not separately gatable and not separately
skippable." Without it, this ADR would be documenting a decision to bet the
archive on a vendor with no fallback — a different, much riskier decision
Isaac never made.

## Decision

**Adopt Cloudflare Stream** for video transcode, adaptive-bitrate delivery,
and signed playback, replacing the passthrough-only pipeline and retiring
the ungated legacy multi-rendition transcode path from production use.

**Ingest, unchanged upload UI.** The admin portal's editor still
presigned-PUTs the raw master straight to the existing S3 raw bucket
(unchanged). On upload confirm, the server hands Stream a short-lived
presigned URL to that object and lets Stream pull it ("upload via link"),
then waits for a signature-verified, idempotent webhook (`ready`/`error`),
backed by a periodic sweep (`app/scripts/sweep_stream_jobs.py`) that
resolves missed webhooks and retries failed archival copies. This keeps the
S3 master as the ingest input by construction — the raw object the Glacier
copy operates on already exists as a required part of the pipeline, not as
a step someone could quietly skip. `MediaRef.stream_uid` (nullable, unique,
indexed) is the join point; placed on `MediaRef` rather than `Sermon`
because video and audio are separate Stream ingests with separate
`MediaRef` rows, and one `MediaRef` already models "one playable rendition"
— exactly Stream's granularity.

**Glacier archival, same phase, same gate as ingest.** After a successful
(or failed) Stream ingest, the raw master is copied to
`sermon_archives/{sermon_id}/...` with `StorageClass=DEEP_ARCHIVE`, verified
empirically by reading back `StorageClass` on the object rather than trusting
the copy call succeeded. Restore procedure (`aws s3api restore-object`,
Standard ~12h / Bulk ~48h — no Expedited tier exists for Deep Archive) is
documented in `DEPLOYMENT.md` §12.

**No worker queue, no CloudFront (L9).** Stream ingest is async via its own
API plus the ready webhook; no signing keypair, no signed-cookie design —
Stream issues its own signed playback tokens (RS256 JWT, `sub`=Stream
video uid, `kid`, `exp`), verified against Cloudflare's own documented token
format rather than assumed.

**Contract change: `get_stream` now returns Stream URLs, with a fallback.**
For any `MediaRef` with a `stream_uid`, `get_stream` (and the new
`GET /sermons/{id}/download/audio`, W1.6) resolve a Cloudflare
Stream-signed playback URL. For anything not yet ingested — audio (never
sent to Stream; served straight from S3), a sermon mid-rollout, or a
Stream-signing failure — both fall back to the pre-existing presigned-S3
path, through one shared resolver (`_resolve_variant_url`) rather than two
copies of the rule. This is deliberately incremental: there is no
all-or-nothing cutover, and today's catalogue (pending the W1.9 backfill)
serves almost entirely via the fallback. `StreamResponse`/`StreamVariant`'s
shape is byte-for-byte unchanged — only what `url` resolves to changed.

**Non-additive OpenAPI change: `FREE_TIER_MAX_QUALITY` deleted.**
`app/services/media_service.py`'s quality-tier filter for the free tier is
removed outright, along with its loop, per plan decision L10 — moot once
Stream owns the rendition ladder and picks quality client-side. This is a
real removal, not a deprecation: `openapi.json` and
`admin_portal/lib/api/schema.d.ts` were both regenerated and the diff is
confirmed additive apart from this one deletion. The only population this
affects is unsubscribed viewers of the legacy, still-technically-reachable
multi-rendition transcode path losing an SD-quality cap they had before —
not an authorization boundary (paid-tier gating is untouched, still 403s
before URL resolution) and gated separately, see Consequences.

**`CDN_BASE_URL` is not the seam Stream uses.** Cloudflare Stream is
unrelated to the pre-existing `cdn_base_url` setting fixed under the
earlier F4 CDN-unsigned-URL bypass (commit `bc194bc`). That setting has no
signing implementation behind it at all, and `Settings.production_preflight`
refuses to boot production with it set. Stream playback URLs come from
Stream's own signed-token API, through `app/core/stream.py`, full stop — a
future reader should not read "Stream is live" as "it's therefore safe to
set `CDN_BASE_URL`."

## Consequences

- **Positive:** no worker queue, no CloudFront signing keypair, no
  cookie-jar integration against a native video player had to be built or
  is now owned by this codebase — the two structural risks that ruled out
  the in-house alternatives are simply absent, not mitigated. Playback
  authorization is Cloudflare's problem; this service only decides *who*
  gets a token.
- **Positive:** the incremental fallback (`_resolve_variant_url`) means
  Phase 1 shipped with zero playback downtime risk — nothing was cut over,
  the pipeline runs in parallel with the existing path until each sermon is
  individually ingested.
- **Positive — reversibility is real, not assumed.** Because the S3 master
  is the mandatory input to Stream ingest and is archived to Glacier in the
  same phase, abandoning Cloudflare Stream later means re-ingesting from S3
  (or Glacier) into a replacement pipeline, not reconstructing lost content.
  The condition was verified empirically (`StorageClass` read back per
  object, not inferred from the copy call succeeding), with one disclosed
  gap: `DEEP_ARCHIVE` itself was proven only against MinIO (no AWS
  credentials in the build sandbox) — a real `head_object` against an
  actual archived object in `/sermon_archives` is still owed before this is
  treated as fully closed.
- **Negative — recurring vendor cost, usage-based.** Cloudflare Stream
  (storage per minute + delivery) and S3 Glacier Deep Archive (small, but
  restore costs money and takes hours) are both standing costs from GATE M2
  onward (`plans/plan-mobile-app.md` §J), not one-time setup.
- **Negative — non-additive OpenAPI change.** `FREE_TIER_MAX_QUALITY` and
  its filter are gone. No shipped client depended on the removed filtering
  behavior at the time of the change (the mobile app was the one client
  under active development against the new contract), but it is a real
  contract break, not a deprecation window.
- **Negative — the legacy multi-rendition transcode path lost its quality
  gate with nothing replacing it, and nothing stops re-enabling it.**
  Deleting `FREE_TIER_MAX_QUALITY` also stripped gating from the
  pre-existing `transcode_enabled` path, which Stream ingest deliberately
  skips (ambiguous multi-`MediaRef` case) and which never migrates to
  Stream. Flagged by security-reviewer; closed by adding a
  `production_preflight` refusal on `transcode_enabled=True`, so the path
  cannot silently go live ungated — but the path itself still exists in
  code, unused rather than removed.
- **Neutral — admin portal preview breakage identified as a distinct,
  tracked follow-up (W1.8), not fixed by this change.** The reviewer
  preview dialog's bare `<video src>` cannot play an HLS manifest outside
  Safari, so manager review of Stream-ingested content needs `hls.js` or
  Cloudflare's embed — a new frontend dependency, flagged per the standing
  "don't add dependencies without flagging the tradeoff" rule, out of scope
  for this ADR.
- **Coverage:** shipped and reviewed across two passes (security-reviewer,
  reviewer-gilfoyle) on both the ingest/webhook/archival core (W1.1–W1.4)
  and the `get_stream` contract + audio-download change (W1.5–W1.6). Every
  finding closed before merge: a retry-accounting bug where two ingest-skip
  branches never advanced `attempts`, so a stranded job would be
  re-selected and re-skipped by the sweep forever; a `jwt.encode` failure
  mode (malformed/encrypted signing key) that raised uncaught instead of
  degrading to the S3 fallback like an unset key does; and the
  `transcode_enabled` preflight guard above. `uv run pytest -q` at merge:
  648 passed, 1 skipped, 0 failed.

## Alternatives considered

- **Self-hosted FFmpeg + `arq`:** rejected. Requires standing up and
  operating a worker queue this codebase has explicitly declined once
  already for a single existing use case (ADR 0001, `app/api/auth.py`'s
  `BackgroundTasks`) — this would have been the first real justification
  for one, adding retry/backoff/dead-letter semantics as new surface area
  to own. Transcode correctness, rendition-ladder tuning, and delivery
  scaling all become engineering time spent on infrastructure that isn't
  the product, for a small church archive that doesn't need to own its
  transcode farm.
- **AWS MediaConvert + S3 + CloudFront:** rejected. MediaConvert handles
  transcode acceptably, but playback authorization then has to be built
  from scratch — a CloudFront signed-cookie or signed-URL scheme with a
  keypair this codebase would need to generate, rotate, and integrate
  against `expo-video`/AVPlayer on iOS, a combination architect judged
  meaningfully riskier than the Stream + `expo-video` signed-HLS path (the
  reason W0.2's spike targets the latter, not the former, and is framed as
  testing that exact judgment). Cloudflare Stream folds transcode,
  delivery, and signed playback into one seam with one webhook and no
  keypair to manage.

**Cost comparison** (architect's build-vs-buy analysis; baseline ~4 sermons/
week, ~500 active users × 2h/month — figures existed only in the planning
conversation, not previously written down anywhere durable, so recorded here):

| | Self-hosted FFmpeg+`arq` | MediaConvert+S3+CloudFront | Cloudflare Stream |
|---|---|---|---|
| Year 1 (~/mo) | ~$110–135 | ~$126 | **~$92** |
| Year 3 (~/mo) | ~$185 | ~$153 | ~$249 |

Stream is cheapest through roughly year 2; the storage line (not delivery)
is what ratchets upward after that, driven by catalogue depth, not audience
size — a sermon archive is append-only by nature. Crossover with
MediaConvert lands around month 20–24. The Glacier-archived masters (this
ADR's non-severable condition) are what make that crossover a scheduled
revisit rather than a trap: migrating off Stream later means re-transcoding
from the masters and swapping the playback seam, not reconstructing lost
content. Revisit trigger: Stream's storage cost passing ~$150/mo
(≈30,000 stored minutes, ≈500 sermons, ≈2.5 years at the baseline rate).
