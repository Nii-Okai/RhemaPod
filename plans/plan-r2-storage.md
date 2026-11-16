# Plan: R2 live storage + AWS S3 Deep Archive cold tier

Design source of truth: the consolidated council design (skeptic + architect + security-reviewer +
qa-strategist, two exchange rounds). The design file lives in a session scratchpad and will not
survive, so everything it binds is restated in §A. **§A is binding.** Changing any row there is a plan
amendment, not an executor's call.

Trigger: `app/scripts/backfill_stream.py --execute` failed on all 7 published sermons with a
Cloudflare Stream 400 "Invalid URL". `media_service._start_stream_ingest` hands Stream a presigned URL
for local MinIO, and Cloudflare cannot reach it. No cost was incurred. The only side effect is
`attempts`/`started_at` bookkeeping on 7 `upload_jobs`.

Predecessors whose decisions still hold: ADR 0010 (Cloudflare Stream, with the source-master archive
as a condition that cannot be severed: this plan finally meets that condition across vendors), ADR 0001
D5 (the leaked AWS key), `plans/plan-mobile-app.md` §A.2.

Execution log: the append-only root `status.md`, never this file. Every step names the entry it must
append, in the form `[R2STORE — <step id> <short title>] <agent: …>`.

Branch: `feat/r2-storage` off `main`. One controlled merge at `[HUMAN_GATE R8]`.

---

## Goal

Every live object (raw uploads, renditions, thumbnails) is stored in Cloudflare R2, dev included, so
Stream can ingest from a URL it can reach. Every Stream-ingested video master gets a verified copy in
an Object-Locked AWS S3 bucket in DEEP_ARCHIVE, recorded in a `media_archives` ledger. The R2 copy is
deleted only after a re-verified archive copy exists and a restore drill has passed.

## Definition of Done

- [ ] Dev runs against real R2 (`sermon-raw-dev` / `sermon-media-dev`). MinIO is gone from the compose
      runtime. The `S3_PUBLIC_ENDPOINT` shim and the presign-client split are deleted.
- [ ] The 7 previously failed sermons re-run `backfill_stream` and reach Stream `ready`.
- [ ] `_apply_stream_state` no longer archives. It writes a `media_archives` intent row in the same
      transaction as `job.finished_at`. A late or unmatched webhook never produces a 500 loop.
- [ ] `sweep_archives` copies R2 → AWS in DEEP_ARCHIVE with a FULL_OBJECT CRC32. It verifies by a
      VersionId-pinned HEAD and records ARCHIVED. Proven on real R2 + real AWS at `[HUMAN_GATE R5]`.
      This closes ADR 0010's disclosed debt (~line 172: DEEP_ARCHIVE only ever proven against MinIO).
- [ ] A restore drill (bulk restore by version-id, download, sha256 match) is logged in `status.md`
      and passed at `[HUMAN_GATE R6]`.
- [ ] The delete pass ships as its own step behind `[HUMAN_GATE R7]`, with every guard in §A.3.4.
      `ARCHIVE_DELETE_SOURCE=true` is set only in dev, only after R6.
- [ ] Production preflight refuses every condition in §A.2.4, and has a test for each.
- [ ] The structlog redaction processor scrubs `X-Amz-Signature=` / `X-Amz-Credential=` and has a test.
- [ ] `alembic upgrade head` → `downgrade -1` → `upgrade head` round-trips on real Postgres.
- [ ] `uv run pytest -q --tb=short` is green with no regression against the baseline R0.1 records.
      `uv run pytest -q --tb=short -m archive_integration` is green (Docker required).
      Admin portal: `npm run verify` is green.
- [ ] ADR 0011 exists. ADR 0010 carries "Amended by ADR 0011". `DEPLOYMENT.md` §5, §8 and §12 are
      updated, including the restore procedure proven by R5.1 and the re-ingest runbook.
- [ ] `security-reviewer` and `reviewer-gilfoyle` have passed the copy pass (R1.12) and the delete
      pass (R6.2).
- [ ] No secret in any committed file or any `.md`. Dev credentials exist only in the gitignored
      `docker-compose.override.yml`. Prod credentials exist only in Secrets Manager.
- [ ] **No scope creep.** Nothing in §Out of scope ships.

---

## Locked: Isaac's settled decisions (not relitigated)

| # | Decision |
|---|---|
| L1 | Cloudflare R2 replaces S3/MinIO for **all** live storage (raw + media buckets). This is a vendor decision, not a stopgap. |
| L2 | AWS S3 is kept **only** as the cold-archive tier. Archiving is a genuine cross-vendor move: copy R2 → AWS (DEEP_ARCHIVE), verify, then delete the R2 copy. |
| L3 | Local dev points at a **real** R2 bucket, not MinIO. This is the fix for Stream-ingest-from-localhost. |
| L4 | Isaac provisions R2 and AWS himself in the dashboards. The plan gives exact values and gates on them. |

---

## Decisions required at R0

Isaac answers each item in chat at `[HUMAN_GATE R0]`. Steps that depend on an answer say "per
decision (x)".

### (a) Config naming
- **Options:**
  - **A1 (council recommendation):** role-based names. Live store:
    `OBJECT_STORE_ENDPOINT_URL`, `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`,
    `OBJECT_STORE_RAW_BUCKET`, `OBJECT_STORE_MEDIA_BUCKET`. Archive: `ARCHIVE_STORE_BUCKET`,
    `ARCHIVE_STORE_REGION`, `ARCHIVE_STORE_ACCESS_KEY_ID`, `ARCHIVE_STORE_SECRET_ACCESS_KEY`,
    `ARCHIVE_STORE_STORAGE_CLASS`.
  - **A2:** vendor names, `R2_*` / `ARCHIVE_*`.
  - Both options reject `S3_*` for live storage, because S3 now names the archive vendor.
- **Consequence:** R1.1 renames to the chosen set, and every later step and every override snippet
  in this plan uses it. The plan is written in A1 names; under A2, substitute mechanically. Either
  way, ADR 0011 records this as a deviation from the global CLAUDE.md stack line.
- **Isaac's answer (R0):** **A1**, role-based `OBJECT_STORE_*` / `ARCHIVE_STORE_*`. A2 not chosen.

### (b) Editor deletes a video master before it is ARCHIVED
No council consensus. There is a moral and policy edge here: wrong file, private footage, a withdrawn
sermon.
- **Options:**
  - **B-A (architect) — not chosen:** defer the R2 purge. Archive first. Once the row is ARCHIVED, purge R2
    without waiting for retention. The master then lives in Deep Archive under a 180-day lock.
  - **B-B (skeptic) — chosen at R0:** cancel the intent (status `cancelled`) and purge R2 immediately. "Deleted"
    means gone.
- **Scoping rules that apply to either option:**
  - Deferral or cancel applies only when a `media_archives` row exists.
  - Audio, and `delete_upload_job` on failed or awaiting-upload jobs (`media_service.py` ~418/485),
    keep deleting immediately, as today.
- **(b-ii) Planner resolution, overridable here. Editor delete before Stream reaches a terminal state,
  when no intent row exists yet:**
  - Under B-A, the delete inserts the intent row immediately, with `stream_outcome =
    'deleted_before_terminal'` and `editor_purge_requested_at = now()`. The sweep archives it and the
    delete pass purges it.
  - Under B-B, the delete proceeds immediately and no row is written, which is today's behaviour.
- **(b-iii) Planner resolution, overridable here. Editor purge of a row whose `stream_outcome =
  'error'`:**
  - The design's rule "the delete pass never runs on an `error` outcome" governs retention-driven
    deletes only.
  - An explicit editor purge (B-A) is honoured whatever the outcome, because the editor asked. The
    alternative is that an errored master can never leave R2.
- **Consequence:**
  - Status set in the migration (R1.6): B-A keeps `editor_purge_requested_at`. B-B adds `cancelled`
    and omits `editor_purge_requested_at`.
  - Delete-path behaviour in R1.7.
  - The editor-purge branch of the delete pass (R6.1).
  - The withdrawal policy text in ADR 0011.
- **Council recommendation:** none.
- **Isaac's answer (R0):** **B-B**, with b-ii accepted. B-A is **not chosen**; its text above is kept
  as the decision record only. Consequences, applied by amendment AM2:
  - An editor delete before Stream reaches a terminal state deletes immediately, as today. No row is
    written.
  - `status` gains `cancelled`. `editor_purge_requested_at` does **not** exist in the schema, and
    neither does the `deleted_before_terminal` outcome.
  - b-iii is moot under B-B: every editor delete purges R2 immediately in R1.7, whatever the
    outcome. The delete pass (R6.1) has no editor-purge branch and runs on retention only.

### (c) Withdrawal / erasure policy
Under Object Lock GOVERNANCE with 180-day retention, and with a writer that can never delete,
withdrawing an archived master is an admin procedure: an identity with MFA and
`s3:BypassGovernanceRetention` deletes the specific object version.
- **Options:**
  - **C1 — chosen (revised after R0):** Isaac alone holds it, through his own admin identity with MFA.
  - **C2 — not chosen:** Isaac plus one named second admin, for continuity.
- **Consequence:** named in ADR 0011 and in `DEPLOYMENT.md` §12. The restorer role (R2.3) never holds
  this permission.
- **Council recommendation:** none on who; the council agrees on the mechanism.
- **Isaac's answer:** **C1** (revised after R0; the R0 relay said C2). Withdrawal/erasure authority is
  Isaac alone: his MFA human identity with `s3:BypassGovernanceRetention`. No second admin, and no
  second-identity precondition on R8. See AM6.

### (d) Object Lock mode and retention
- **Options:**
  - **D1 (council recommendation):** GOVERNANCE mode, 180-day default retention, enabled at bucket
    creation.
  - **D2:** a different retention period.
  - COMPLIANCE mode is rejected: it would make withdrawal impossible even for root.
- **Consequence:** R2.3 bucket settings. 180 days matches the DEEP_ARCHIVE minimum storage charge, so
  the lock adds no billing floor. Object Lock can only be enabled at creation in this walkthrough; a
  mistake means a new bucket name.
- **Isaac's answer (R0):** **D1**, GOVERNANCE, 180 days. D2 not chosen.

### (e) R2 jurisdiction / location
- **Options:**
  - **E1:** EU jurisdiction. The endpoint becomes `https://<CF_ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
    and data is guaranteed to stay in the EU.
  - **E2:** a location hint of Western Europe (WEUR). The standard endpoint is used, and the hint is
    a preference, not a guarantee.
  - **E3:** automatic, with no hint.
- **Consequence:** **Irreversible per bucket.** R2.1 applies the same choice to dev and prod. The prod
  preflight host check `*.r2.cloudflarestorage.com` accepts both endpoint forms.
- **Council recommendation:** none. This is a data-residency question, not an engineering one.
- **Isaac's answer (R0):** **E3**, automatic, no location hint. E1 and E2 not chosen. Isaac created
  the R2 buckets this way in R2.1. The endpoint is the standard
  `https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com`.

### (f) ADR 0001 D5: SECURITY BLOCK precondition of `[HUMAN_GATE R2]`
- **Confirm:**
  - The leaked key `***REMOVED-AWS-ACCESS-KEY***` is **deleted** in IAM, not merely deactivated.
  - No other clone holds the pre-rewrite history.
- **Consequence:** until this is confirmed, R2.3 does not start. It is the first checkbox of R2.3.
- **Isaac's answer (R0):** confirmed. `***REMOVED-AWS-ACCESS-KEY***` is **deleted** in IAM, not merely
  deactivated. The R2.3 precondition is met.
  - **Open item for R8:** "no other clone holds the pre-rewrite history" is not yet confirmed. Isaac
    is being asked separately. It blocks nothing before R8.

### (g) Global CLAUDE.md stack line
The stack line "S3 + Secrets Manager are already in the design" is now inaccurate: live storage is R2.
**Isaac edits it himself.** No agent touches `~/.claude/CLAUDE.md`.
- **Isaac's answer (R0):** Isaac updates it himself. This is not a plan action item.

### Planner resolutions (binding unless overridden at R0)

**R0 outcome:** no overrides were given. P1–P9 stand as written.

| # | Resolution | Why |
|---|---|---|
| P1 | `max_upload_bytes` = **5,000,000,000**, below R2's single-PUT cap of 5,363,466,240. | The portal's copy says "5 GB", and that stays true in decimal. The alternative is 5,261,334,937 (4.9 GiB). |
| P2 | **`sermon-archive-dev-<ACCOUNT_ID>` is provisioned**, not opt-in. | G-A (R5) and G-B (R6) need a real AWS bucket fed from real R2. Dev is the only environment with real masters and no prod compute exists. Pointing dev at the prod bucket would put Object-Locked dev objects in prod. |
| P3 | Prod R2 buckets are created in R2.1, so dev and prod share one jurisdiction decision. The prod R2 token, prod archive bucket and prod writer user are **optional in this plan** (R2.1b / R2.3b). Deferring them to a prod-deploy plan is Isaac's call at R0. | There is no prod compute yet. Credentials minted early only start rotation clocks. |
| P4 | The live-store region is hard-coded to `"auto"` in the R2 config builder. There is no env var. | R2 ignores region. An env var would only be a way to misconfigure it. |
| P5 | The MinIO → R2 copy (R3.3) reads from the **preserved `minio-data` volume** through a temporary MinIO container. | R1.3 removes MinIO from compose before the cutover can run, because the cutover needs R2 credentials. **Nobody runs `docker compose down -v` until R3.3 is logged.** |
| P6 | The raw-bucket mirror **excludes `sermon_archives/`**. | Those are the old same-vendor in-place "archives". They have no meaning on R2, and the raw master next to each is copied anyway. R3.2 reports the count. |
| P7 | The optional 30-day expiry on the dev buckets (a security suggestion) is **not applied**. | It would delete the dev masters of the 7 sermons. Revisit once dev holds only synthetic media. |
| P8 | `ARCHIVE_DELETE_SOURCE=true` is enabled **in dev only** by this plan. Prod enablement needs a prod restore drill and belongs to the prod-deploy plan. | G-B must pass before the flag is set "anywhere". A dev drill proves the dev bucket, not prod. |
| P9 | Writer IAM policy adds `s3:GetObjectVersion`. The restorer adds `s3:GetObjectVersionAttributes`. Both are beyond the design text. | A VersionId-pinned HEAD/GET is authorised by `GetObjectVersion`, not `GetObject`. Without it, the verify step in §A.3.3 returns 403 on real AWS. |

---

# A. Architecture: what the executors need to know

## A.1 Storage seam (`app/core/storage.py`)
- **Config and clients.** `ObjectStoreConfig` is a frozen dataclass: endpoint_url, region,
  access_key_id, secret_access_key, addressing_style, checksum_mode. One `_make_client(cfg)` factory
  builds every boto3 client. `S3Storage(cfg)` stops reading global settings.
- **Live `Storage` protocol** (`get_storage()`).
  - Keeps: `presigned_upload_url`, `presigned_download_url`, `object_exists`, `object_size`,
    `delete_object`.
  - Adds: `open_read(bucket, key) -> (stream, ObjectHead)`.
  - Drops: `copy_object(storage_class=)` and `object_storage_class`. Their only caller is
    `_archive_raw_master`; the drop lands in R1.7 with that caller.
- **`delete_object`.** A 404/NoSuchKey is success, logged at INFO. Anything else raises `StorageError`.
- **`ArchiveStore` protocol** (`get_archive_store()`), with two methods:
  - `head(bucket, key, version_id=None) -> ObjectHead | None`
  - `put_archive_object(bucket, key, source, *, size, storage_class, metadata) -> ArchiveReceipt`.
    It computes MD5, SHA-256 and full-object CRC32 while streaming. The receipt carries the
    `version_id`.
  - Implementations: `S3ArchiveStore` and `LocalArchiveStore` (the stub).
- **R2 client:** region `auto`, signature `s3v4`, path addressing, `request_checksum_calculation` /
  `response_checksum_validation` = `when_required` (boto3 1.43.63 in `uv.lock` supports these).
- **AWS archive client:** keeps boto3's **default** checksums, because Object Lock buckets require a
  checksum on PUT/UploadPart. A test asserts the archive client is not set to `when_required`.
- **Deleted:** the presign-client split, the `S3_PUBLIC_ENDPOINT` shim, and MinIO in the compose
  runtime.

## A.2 Config (`app/core/config.py`, `app/scripts/preflight.py`)

### A.2.1 Names and defaults
- Names follow decision (a).
- Dev bucket defaults: `sermon-raw-dev`, `sermon-media-dev`.
- `ARCHIVE_DELETE_SOURCE`: bool, default false.
- `ARCHIVE_SOURCE_RETENTION_DAYS`: default 14, minimum 1.
- `ARCHIVE_LEASE_MINUTES`: default 120.
- `ARCHIVE_STORE_STORAGE_CLASS`: one of {DEEP_ARCHIVE, GLACIER}, default DEEP_ARCHIVE.

### A.2.2 All-environment validators
- The endpoint must be https in every environment.
- A legacy `S3_*` env var still being present fails startup. This validator is removed one release
  cycle later, and that removal is out of scope here.
- `ARCHIVE_DELETE_SOURCE=true` is rejected unless both stores are live, not stubs. The sweep
  re-checks this in code.

### A.2.3 Upload cap
`max_upload_bytes` = 5,000,000,000 (P1). This changes the 413 message and the admin portal's
`MAX_UPLOAD_BYTES` (`admin_portal/lib/upload/constants.ts:14`). ADR 0011 records it.

### A.2.4 Production preflight refuses
- a stub live store, and separately a stub archive store
- an http endpoint
- an endpoint host other than `*.r2.cloudflarestorage.com`
- an `r2.dev` URL. `CDN_BASE_URL` stays refused, and the refusal message is extended to mention
  `*.r2.dev`.
- any bucket name containing `-dev` or `-staging`
- raw bucket == media bucket
- a storage class other than DEEP_ARCHIVE
- `ARCHIVE_DELETE_SOURCE` set while the archive is a stub
- a legacy `S3_*` var

### A.2.5 `preflight.py` network probes
- **R2:** `head_bucket`. If the object-scoped token refuses it with 403, fall back to
  `list_objects_v2(MaxKeys=1)`. The code implements both; R2.2 records which one the real token
  allows.
- **Archive:** `head_bucket`, then `GetBucketVersioning == Enabled`, then the abort-MPU lifecycle rule
  is present, then `GetObjectLockConfiguration` has a GOVERNANCE default.

## A.3 Archive mechanism

### A.3.1 Intent on the webhook path (`media_service.py`)
- `_apply_stream_state` (~969) stops calling `_archive_raw_master` (~929). That function is deleted.
- In the **same transaction** as `job.finished_at`, it inserts a `media_archives` row (status
  `pending`, `stream_outcome`) with `ON CONFLICT (source_bucket, source_key) DO NOTHING`.
- Intent rows are created only for VIDEO jobs ingested through Stream, filtered in SQL. Audio is never
  archived and never source-deleted.
- **Job resolution:**
  - Exact lookup only: `UploadJob.raw_key == ref.s3_key AND ref.bucket == <raw bucket>`.
  - The archive and delete paths never fall back to `_active_video_job_for_sermon`.
  - No exact match: outcome `no_job`, the ledger row is recorded, ERROR is logged, and the handler
    returns 200.
  - Job already finished: outcome `already_resolved`, and the handler returns 200.
  - Neither case can cause a 500 redelivery loop. This fixes today's StorageError-on-late-webhook bug.
- The dead archive-failed handling in `sweep_stream_jobs` case 1 (~1159) is removed.

### A.3.2 `app/scripts/sweep_archives.py`: copy pass
- **Locking and scheduling:**
  - Takes `pg_try_advisory_lock` and exits if it doesn't get it.
  - Works oldest-first, batch limit 5.
  - Claims each row with a conditional UPDATE lease that doubles as a fencing token. No `FOR UPDATE`
    is held across the transfer.
  - Runs the byte pump in `asyncio.to_thread`.
- **Resume first.** HEAD the archive key. If an object with matching size + `sha256` metadata exists,
  skip the upload.
- **Upload.**
  - Read R2 `get_object` in 64 MiB parts, bounded in memory.
  - Low-level multipart upload with `StorageClass=DEEP_ARCHIVE`, `ChecksumAlgorithm=CRC32`,
    `ChecksumType=FULL_OBJECT`.
  - Metadata: `sha256`, `source-etag`, `source`, `upload-job-id`, `sermon-id`.
- **Heartbeat.** After every part, a fenced UPDATE renews the lease; the returned value is the new
  token. On fence loss, abort the MPU and stop. Also abort the MPU on any exception.
- **Record.** A fenced UPDATE sets ARCHIVED with `archive_version_id`, `archived_at`, `sha256` and
  `size_bytes`.
- **Runs:**
  - Dev: manually only. Either `uv run python -m app.scripts.sweep_archives` or the compose one-shot
    `docker compose --profile ops run --rm archive-sweep`. Never cron on a laptop.
  - Prod: every 15 minutes, on the same scheduler as `sweep_stream_jobs` (documented, not deployed,
    by this plan).

### A.3.3 Verify
All of these must hold before ARCHIVED is recorded:
- size == R2 `ContentLength` == `job.size_bytes`
- R2 ETag == MD5, **only** for single-PUT sources. A `-N` ETag skips this check with an INFO log;
  it never fails.
- S3 accepts the CRC32 at `CompleteMultipartUpload`.
- A VersionId-pinned HEAD returns the expected size, `StorageClass` == the configured class, and the
  `sha256` metadata.
- Any other class on read-back, STANDARD included, sets status FAILED with
  `last_error = wrong_storage_class:<cls>` and logs ERROR.

### A.3.4 Delete pass (R6.1, behind `[HUMAN_GATE R7]`, never in the same step as the copy pass)
Every one of these must hold:
- `ARCHIVE_DELETE_SOURCE=true`, and the archive store is not the stub
- status = archived and `media_type` = VIDEO
- key guard: `ref.s3_key == job.raw_key == media_archives.source_key`
- `stream_outcome = ready AND archived_at < now - retention`. (Decision (b) is B-B, so there is no
  editor-purge path here; editor deletes purge immediately in R1.7. The B-A editor-purge branch was
  not chosen.)
- a VersionId-pinned re-HEAD matches the DB on size, class and sha256

Only then: delete from R2, then UPDATE to `source_deleted`. Retention-driven deletes never act on an
`error` outcome.

After a source is deleted, the `_resolve_variant_url` fallback raises instead of presigning a missing
key.

## A.4 Schema: one additive migration (`[HUMAN_GATE R3]`)

### A.4.1 New table `media_archives`
Append-only in spirit: no app path deletes rows.

| Column | Notes |
|---|---|
| `id` | |
| `sermon_id` | UUID, **no FK**, indexed. Rows outlive the sermon. |
| `upload_job_id` | UUID, no FK, indexed |
| `source_bucket`, `source_key` | **UNIQUE together** |
| `stream_outcome` | `ready` \| `error`. (`deleted_before_terminal` was B-A only; not chosen.) |
| `status` | `pending` \| `copying` \| `archived` \| `source_deleted` \| `failed` \| `cancelled` (B-B, chosen at R0) |
| `attempts` | int, not null, default 0 |
| `lease_until`, `last_error` | |
| `archive_bucket`, `archive_key`, `archive_version_id` | |
| `size_bytes`, `sha256` | `sha256` is char(64) |
| `requested_at`, `archived_at`, `source_deleted_at` | |

`editor_purge_requested_at` is **not** a column: it existed only under B-A, which was not chosen.

### A.4.2 Constraints and indexes
- CHECK: status in (archived, source_deleted) ⇒ `archived_at`, `sha256` and `archive_key` are all
  NOT NULL.
- CHECK: `source_deleted_at` NOT NULL ⇒ `archived_at` NOT NULL.
- Partial index on `status` for pending, copying and archived.
- UNIQUE index on `upload_jobs.raw_key`. Run a duplicate check before applying. Raw keys are uuid4,
  so zero duplicates are expected.
- No `media_refs` FK. `upload_jobs` gets no new columns.
- Downgrade drops only what this migration added, and its docstring says so.

## A.5 Tests
- **Unit tests** use `LocalStorage` + `LocalArchiveStore` as two independently overridable instances.
  - conftest forces both stubs before `main.app` is imported, and resets them per test.
  - A session-scoped autouse assertion checks that no real R2/AWS credential is in the environment.
- **Archive integration tests** use the pytest marker `archive_integration`. They are opt-in and need
  Docker.
  - New dev dependency: `testcontainers[postgres,minio]`.
  - Testcontainers Postgres covers the state machine, lease, heartbeat fence and CHECK constraints.
  - Two MinIO containers stand in for R2 and AWS, with distinct clients and endpoints, a forced small
    part size, and failure injection by pausing a container.
  - Stores are built from `ObjectStoreConfig` directly, bypassing Settings.
  - Only the new tests use Postgres. The rest of the suite stays on SQLite.
- **Failure-injection matrix.** Retry after each failure and assert the invariant.
  - Cases: before copy; mid-copy; verify mismatch; after verify, before the DB write; after ARCHIVED,
    before delete; delete fails; concurrent sweeps / lease takeover; lost fence.
  - **Invariant:** at every point at least one verified copy exists, and the DB never says
    `source_deleted` without a verified archive.
  - The copy-side cases land in R1.9. The two delete-side cases land in R6.1.

---

# B. Gate register

Nine gates. **Never cross one without explicit approval from Isaac in chat.** R1 and R2 are
Isaac-only provisioning gates and may be batched in one sitting. R3 is batchable with R1 or R2.

| Gate | Design name | Category | What it guards | Blocks |
|---|---|---|---|---|
| **R0** | G0 | scope | This plan; decisions (a)–(e), (g); P1–P9; confirmation of (f). **Approved.** | All execution |
| **R1** | G-R2 | cost · secrets · external contract · **Isaac-only** | R2 buckets, CORS, lifecycle, token; dev credentials in the override; R2.2 smoke passes | R3.1 onward, anything that touches real R2 |
| **R2** | G-AWS | cost · secrets · IAM · **Isaac-only** | D5 confirmed; archive bucket(s) with Object Lock, policies, writer user, restorer role; R2.4 smoke passes | R4.1 onward |
| **R3** | G-MIG | schema | The `media_archives` + `upload_jobs.raw_key` UNIQUE migration | `alembic upgrade head` on any real DB; R3.3 |
| **R4** | G-CUTOVER | data change | Exact MinIO → R2 copy, `media_refs.bucket` UPDATE, reset of the 7 jobs by id, the backfill `--execute` (7 Stream ingests) | R3.3 |
| **R5** | G-A | irreversible · first cross-vendor write | First real R2 → AWS copy (delete OFF) and the exit criteria in R4.1 | R5.1 |
| **R6** | G-B | irreversible prerequisite | Restore drill passed: bulk restore by version-id, sha256 match | R6.1, and any `ARCHIVE_DELETE_SOURCE=true` |
| **R7** | G-DEL | irreversible | Delete-pass code (after review) and enabling `ARCHIVE_DELETE_SOURCE=true` in dev | R6.3 |
| **R8** | final | merge | Final review and the controlled merge of `feat/r2-storage` into `main` | Merge |

Dependency shape:
```
R0 ─┬─ Track A (code, no credentials): R0.1 → R0.2 → R1.1 … R1.12 ──┐
    └─ Track B (Isaac): R2.1 → [R1] … R2.3 → [R2] ──────────────────┤
                                  R1.6 → [R3] ───────────────────────┤
                                          R3.2 → [R4] → R3.3 → R4.1 → [R5] → R5.1 → R5.2 → [R6]
                                          → R6.1 → R6.2 → [R7] → R6.3 → R7.1 → [R8]
```
R2.2 needs R1.3 + R1.10 merged on the branch and Isaac's R2.1. R2.4 needs R1.3 + R1.10 and Isaac's
R2.3.

At 28 steps, this is above the ~12-step guideline. It is phased rather than split into sub-plans,
because every phase shares one migration, one config surface and one gate register. Splitting would
duplicate §A three times.

---

# C. Phase 0: Stop the bleed, fix the test plan

### R0.1 — Pause the sweeps; baseline; branch (first action after R0)
- **Owner:** `senior-dev-backend`
- **What:**
  0. **(AM1, first action)** On `feat/r2-storage` (create the branch first; see item 6), add the
     `archive-sweep` service to base `docker-compose.yml`: the same build context and Dockerfile as
     the existing app services, `profiles: ["ops"]`, `environment: <<: *app-env`, and command
     `python -m app.scripts.sweep_archives`. It is a harmless stub until R1.9 writes the script.
     Until it exists, every compose command fails, because Isaac's override already defines
     `archive-sweep` with only an `environment:` block. Item 1 depends on it.
  1. Stop every runner of `sweep_stream_jobs` / `sweep_uploads`:
     `docker compose --profile sweeps stop sweeps`.
  2. Check that nothing else schedules them, with `crontab -l` and `launchctl list | grep -i sermon`.
  3. `sweep_stream_jobs` case 2 (`media_service.py` ~1172) retries the 7 failed jobs once each is
     over 60 minutes stale, until `attempts` reaches 5. Every retry is another Stream call against an
     unreachable MinIO URL.
  4. With a read-only SELECT, record the 7 job ids and their current `attempts` / `started_at`:
     VIDEO `upload_jobs` with status READY, `finished_at IS NULL`, `attempts > 0`, whose sermon's
     VIDEO `media_refs.stream_uid IS NULL`.
  5. Record the pytest baseline.
  6. Create branch `feat/r2-storage`.
- **Files / scope:** `docker-compose.yml` (the `archive-sweep` service only, per AM1). Otherwise no
  repo changes; reads the dev DB only.
- **Verification:**
  - `docker compose config --services` succeeds and lists `archive-sweep` (AM1).
  - `docker compose --profile sweeps ps` shows no running `sweeps` container.
  - The SELECT returns exactly 7 rows, and the ids are pasted into `status.md`.
  - `uv run pytest -q --tb=line | tail -3` count recorded.
  - `git branch --show-current` = `feat/r2-storage`.
- **Status update:** `[R2STORE — R0.1 sweeps paused + baseline] <agent: senior-dev-backend>`
- **Note:** the pause is reversible and protective. If R0 takes days, the Conductor may ask Isaac to
  authorise R0.1 steps 1–2 alone, ahead of R0. Burned attempts are recoverable either way, because
  R3.3 resets them.

### R0.2 — Test plan for the archive state machine and preflight
- **Owner:** `qa-strategist`
- **What:** Turn §A.5 into named cases:
  - every preflight refusal in §A.2.4
  - every failure-injection row, with the retry and invariant check spelled out
  - lease/fence races
  - the webhook `no_job` / `already_resolved` outcomes
  - decision-(b) delete paths
  - the redaction processor
  - the archive-client checksum assertion
- **Resolve with a spike:** can a MinIO Testcontainer stand in for AWS on `StorageClass=DEEP_ARCHIVE`
  and `ChecksumType=FULL_OBJECT`? MinIO historically accepts only STANDARD/REDUCED_REDUNDANCY. If it
  rejects either, specify the substitute (for example MinIO's configurable storage classes, or
  asserting the class through the stub while real-class proof is left to R4.1) and say which
  invariants lose coverage.
- **Files / scope:** output to `status.md` only. No test code.
- **Verification:** every row in §A.5 and §A.2.4 maps to at least one named case with its layer (unit
  / archive_integration / gate-time manual). The MinIO question is answered with evidence (the
  command run and its output).
- **Status update:** `[R2STORE — R0.2 test plan] <agent: qa-strategist>`

### [HUMAN_GATE R0] — G0: plan, decisions (a)–(e) + (g), P1–P9, and confirmation of (f)
Execution does not start until Isaac answers in chat. (f) may be confirmed here or at the start of
R2.3, but R2.3 does not start without it.

**Crossed.** Isaac approved R0 in chat: (a) A1, (b) B-B with b-ii, (c) C2 (later revised to C1,
see AM6), (d) D1, (e) E3, (f) confirmed deleted, (g) Isaac's own edit; P1–P9 unchanged. Amendments
AM1–AM3 below were recorded with the approval.

---

# D. Track A: Code that needs no real credentials

Everything in this phase runs against stubs, SQLite, or Testcontainers. None of it waits for R1/R2.

### R1.1 — Rename the storage settings (mechanical)
- **Owner:** `noob-dev`
- **What:** Pure rename per decision (a). No new behaviour, validators, or fields.

  | Old | New (A1 names) |
  |---|---|
  | `s3_endpoint_url` | `object_store_endpoint_url` |
  | `s3_access_key_id` | `object_store_access_key_id` |
  | `s3_secret_access_key` | `object_store_secret_access_key` |
  | `s3_raw_bucket` | `object_store_raw_bucket` |
  | `s3_media_bucket` | `object_store_media_bucket` |
  | `s3_archive_storage_class` | `archive_store_storage_class` |

  - Env var names follow the same mapping.
  - Leave `s3_region` and `s3_public_endpoint` untouched; R1.2 deletes them.
  - Update every reference: services, scripts, tests, the `docker-compose.yml` `x-app-env` anchor,
    and `.env.example`.
- **Files / scope:**
  - `app/core/{config,storage}.py`
  - `app/scripts/preflight.py`
  - `app/services/{media,content,announcement}_service.py`
  - `tests/test_{portal_batch2,portal_batch3,media,storage_public_endpoint,production_hardening,stream_ingest}.py`
  - `docker-compose.yml`, `.env.example`
- **Verification:**
  - `uv run pytest -q --tb=short` matches the R0.1 baseline.
  - `grep -rnE "s3_(endpoint_url|access_key_id|secret_access_key|raw_bucket|media_bucket|archive_storage_class)" app tests`
    returns nothing.
- **Status update:** `[R2STORE — R1.1 settings rename] <agent: noob-dev>`

### R1.2 — Storage seam refactor
- **Owner:** `senior-dev-backend`
- **What:** Implement §A.1, except that `copy_object`/`object_storage_class` stay until R1.7.
  - `ObjectStoreConfig`, `_make_client`, and `S3Storage(cfg)`.
  - `open_read`, and the 404-tolerant `delete_object`.
  - The `ArchiveStore` protocol, `S3ArchiveStore`, `LocalArchiveStore`, and `get_archive_store()`.
  - Delete the presign-client split, `s3_public_endpoint`, `s3_region` (P4) and their validator.
  - Rewrite conftest to force both stubs before `main.app` is imported, reset them per test, and
    assert no real credentials.
- **Files / scope:** `app/core/storage.py`, `app/core/config.py` (removals only), `tests/conftest.py`,
  `tests/test_storage_public_endpoint.py` (rewritten as `tests/test_storage_seam.py`), new
  `tests/test_archive_store.py`.
- **Verification:**
  - `uv run pytest -q --tb=short` is green.
  - A test asserts that the R2 client config is `when_required` and the archive client config is not.
  - A test covers `delete_object` on a missing key returning success.
  - `grep -rn "public_endpoint" app tests` returns nothing.
- **Status update:** `[R2STORE — R1.2 storage seam] <agent: senior-dev-backend>`

### R1.3 — Config, validators, preflight, compose
- **Owner:** `senior-dev-backend`
- **What:**
  - Everything in §A.2: new archive fields, the delete/retention/lease settings, all-environment
    validators, the legacy `S3_*` validator, `max_upload_bytes` = 5,000,000,000 (P1), the production
    preflight refusals, and the network probes including the HeadBucket→list fallback.
  - `docker-compose.yml`:
    - Remove the `minio` and `createbuckets` services and the `S3_*` block of `x-app-env`.
    - **Keep the `minio-data` volume declaration** (P5). R7.1 removes it.
    - Credentials are **not** placed in `x-app-env`. They come from the override, per service.
  - `.env.example`: the new names with placeholder values only.
  - **(AM7)** Wire `get_archive_store()` in `app/core/storage.py` to the new `ARCHIVE_STORE_*`
    settings: a real `S3ArchiveStore` when `archive_is_live`, the stub otherwise. Production refuses
    the stub. Nothing else in `storage.py` is touched.
- **Files / scope:** `app/core/config.py`, `app/scripts/preflight.py`, `docker-compose.yml`,
  `app/core/storage.py` (`get_archive_store()` wiring only, AM7),
  `.env.example`, `tests/test_production_hardening.py` (~130–170), `tests/test_portal_batch3.py`
  (~650–680), `tests/test_preflight_cdn.py`, new `tests/test_preflight_storage.py`.
- **Verification:**
  - `uv run pytest -q --tb=short` is green.
  - One test per refusal in §A.2.4.
  - `docker compose config --quiet` succeeds.
  - `docker compose config | grep -ci minio` = 0, apart from the volume name.
- **Status update:** `[R2STORE — R1.3 config + preflight] <agent: senior-dev-backend>`

### R1.4 — Admin portal upload cap
- **Owner:** `senior-dev-frontend`
- **What:** Set `MAX_UPLOAD_BYTES` to `5_000_000_000` (P1) and keep it in step with the backend. The
  "5 GB" copy stays accurate; correct the "5 GiB" comment.
- **Files / scope:** `admin_portal/lib/upload/constants.ts`, and
  `admin_portal/components/sermons/editor/media-jobs-card.tsx` only if its hint needs changing.
- **Verification:** `npm run verify` is green from `admin_portal/`.
- **Status update:** `[R2STORE — R1.4 portal upload cap] <agent: senior-dev-frontend>`

### R1.5 — Structlog redaction processor
- **Owner:** `senior-dev-backend`
- **What:** Add a processor to `shared_processors` that rewrites the values of `X-Amz-Signature=` and
  `X-Amz-Credential=` to `REDACTED` in every string field, including nested ones.
- **Files / scope:** `app/core/logging.py`, new `tests/test_log_redaction.py`.
- **Verification:** `uv run pytest -q --tb=short tests/test_log_redaction.py` is green. A test logs a
  real presigned URL shape and asserts neither value survives.
- **Status update:** `[R2STORE — R1.5 log redaction] <agent: senior-dev-backend>`

### R1.6 — Author the migration
- **Owner:** `senior-dev-backend`
- **What:** One additive Alembic revision implementing §A.4. Per decision (b) = B-B: the status set
  includes `cancelled`, `stream_outcome` is `ready` | `error` only, and there is no
  `editor_purge_requested_at` column. The ORM model is `MediaArchive` in `app/models/models.py`.
  - Before authoring, run a read-only duplicate check on the dev DB:
    `SELECT raw_key, count(*) FROM upload_jobs GROUP BY raw_key HAVING count(*) > 1;`
  - The downgrade docstring states that it drops only `media_archives` and the unique index.
- **Files / scope:** `alembic/versions/<new>_add_media_archives.py`, `app/models/models.py`.
- **Verification:**
  - The duplicate query returns 0 rows, logged.
  - `upgrade head` → `downgrade -1` → `upgrade head` round-trips on real Postgres
    (`uv run pytest -q --tb=short tests/test_migration_roundtrip.py` with `TEST_PG_DSN` set).
  - `uv run alembic upgrade head --sql | tail -40` output is attached to `status.md` for the R3
    review.
  - **Not applied to the dev DB** until R3.
- **Status update:** `[R2STORE — R1.6 migration authored] <agent: senior-dev-backend>`

### [HUMAN_GATE R3] — G-MIG: migration review
Isaac reviews the revision file, the offline SQL and the round-trip evidence. This may be batched with
R1 or R2. Crossing it allows `alembic upgrade head` on the dev DB, which happens in R3.3.

### R1.7 — Intent on the webhook path; job resolution; editor-delete behaviour
- **Owner:** `senior-dev-backend`
- **What:**
  - Implement §A.3.1: intent insert in the `finished_at` transaction, exact job resolution, the
    `no_job` / `already_resolved` outcomes returning 200.
  - Delete `_archive_raw_master`, `copy_object(storage_class=)`, `object_storage_class`, and the dead
    archive-failed branch of `sweep_stream_jobs` case 1.
  - Editor-delete paths (`delete_media_ref` ~688, `delete_media_by_type` ~740) per decision (b) =
    **B-B** (chosen at R0):
    - With a row in pending/copying/failed: set `cancelled` through a fenced UPDATE, so the sweep
      loses its fence and aborts the MPU, then delete from R2 immediately.
    - With a row in ARCHIVED: delete from R2 immediately and set `source_deleted`.
    - With no row (including Stream not yet terminal, per b-ii): delete immediately, as today. No
      row is written.
    - **(AM4 i) Losing cancel race.** The cancel UPDATE is fenced on the row state and lease the
      editor path read. If it matches 0 rows (a sweep renewed the lease or moved the row on), it
      must **not** purge R2. Re-read the row and act on its current state per the branches above.
    - **(AM4 ii)** With a row already `source_deleted`: an explicit no-op (no R2 call, no UPDATE).
    - The B-A branch (defer the purge via `editor_purge_requested_at`) was **not chosen** and is not
      implemented.
  - Audio and `delete_upload_job` are unchanged.
- **Files / scope:** `app/services/media_service.py`, `app/api/` (Stream webhook route, only if the
  outcome mapping lives there), `app/core/storage.py` (removals),
  `tests/test_stream_ingest.py`, `tests/test_media.py`, new `tests/test_archive_intent.py`.
- **Verification:**
  - `uv run pytest -q --tb=short` is green.
  - Tests cover the intent being written atomically with `finished_at`, a duplicate webhook producing
    a single row, `no_job` → 200 with no retry, `already_resolved` → 200, audio producing no row, and
    each B-B branch above (including the fence-loss abort when a copying row is cancelled). Per
    AM4: a losing cancel race (0-row UPDATE) makes no R2 delete call and re-reads the row, and an
    editor delete on a `source_deleted` row is a no-op.
  - `grep -rn "copy_object\|object_storage_class\|_archive_raw_master" app` returns nothing.
- **Status update:** `[R2STORE — R1.7 archive intent] <agent: senior-dev-backend>`

### R1.8 — Archive integration harness
- **Owner:** `senior-dev-backend`
- **What:**
  - Add `testcontainers[postgres,minio]` as a dev dependency. This is a flagged tradeoff: Docker is
    required for the opt-in marker only.
  - Register the `archive_integration` marker and exclude it from the default run.
  - Fixtures: a Postgres container with `alembic upgrade head`, two MinIO containers ("r2" and
    "aws") with stores built from `ObjectStoreConfig`, a forced small part size, and a
    pause-container failure injector. Apply the R0.2 answer on DEEP_ARCHIVE/FULL_OBJECT substitution
    (AM5): the MinIO "aws" store is built **without** the storage-class and checksum params, because
    MinIO rejects `DEEP_ARCHIVE`, cannot tell a good FULL_OBJECT CRC32 from a corrupt one, and never
    returns `StorageClass` on HEAD. This tier proves multipart, resume, lease/fence, VersionId-pinned
    HEAD and delete idempotency only. Real storage-class and checksum proof is R4.1 (G-A) only.
  - Tests at this step: the CHECK constraints reject an invalid ARCHIVED/source_deleted row; the
    unique source is enforced.
- **Files / scope:** `pyproject.toml`, `uv.lock`, `tests/archive_integration/conftest.py`,
  `tests/archive_integration/test_schema_constraints.py`.
- **Verification:**
  - `uv sync --frozen` succeeds.
  - `uv run pytest -q --tb=short -m archive_integration` is green.
  - `uv run pytest -q --tb=short` (default) is green and does not start Docker.
- **Status update:** `[R2STORE — R1.8 integration harness] <agent: senior-dev-backend>`

### R1.9 — `sweep_archives` copy pass (no delete)
- **Owner:** `senior-dev-backend`
- **What:**
  - Implement §A.3.2 and §A.3.3 in `app/scripts/sweep_archives.py`, with the service logic in
    `app/services/archive_service.py`.
  - **No delete code path exists in this step.**
  - The compose one-shot `archive-sweep` (`profiles: ["ops"]`, running
    `python -m app.scripts.sweep_archives`) already exists from R0.1 per AM1. This step only
    confirms it runs the real script; change the service definition only if the script needs it.
  - Tests: the copy-side failure-injection rows from §A.5 (before copy, mid-copy, verify mismatch,
    after verify before the DB write, concurrent sweeps / lease takeover, lost fence). Also resume
    skipping the upload, `-N` ETag skipping the MD5 check, and wrong storage class → FAILED.
  - **Tier split (AM5):**
    - Unit tier: assert the `StorageClass=DEEP_ARCHIVE`, `ChecksumAlgorithm=CRC32`,
      `ChecksumType=FULL_OBJECT` call shape by spying the kwargs of the client call (botocore
      `Stubber` or `LocalArchiveStore`). Wrong storage class → FAILED is also unit tier, since
      MinIO never returns `StorageClass` on HEAD.
    - archive_integration tier (MinIO "aws" store without class/checksum params): multipart,
      resume, lease/fence, VersionId-pinned HEAD.
    - Real storage-class and checksum proof is R4.1 (G-A) only.
  - **(AM8)** Replace or extend `S3ArchiveStore.put_archive_object` (R1.2 shipped a managed
    `upload_fileobj` plus a follow-up `head_object` for the VersionId) with the §A.3.2 low-level
    multipart path: CRC32 FULL_OBJECT declared on Create/Complete, a per-part callback hook that
    drives the fenced lease heartbeat, abort of the MPU on a lost fence or any exception, and the
    VersionId taken from `CompleteMultipartUpload`, never a later HEAD.
- **Files / scope:** `app/services/archive_service.py`, `app/scripts/sweep_archives.py`,
  `app/core/storage.py` (`S3ArchiveStore.put_archive_object` only, AM8),
  `app/services/media_service.py` (remove the old archive case only if R1.7 left anything),
  `docker-compose.yml`, `tests/archive_integration/test_sweep_archives.py`,
  `tests/test_sweep_archives_unit.py`.
- **Verification:**
  - `uv run pytest -q --tb=short` is green.
  - `uv run pytest -q --tb=short -m archive_integration` is green.
  - Every copy-side matrix row asserts the invariant after retry.
  - `grep -n "delete_object" app/services/archive_service.py` returns nothing.
- **Status update:** `[R2STORE — R1.9 sweep_archives copy pass] <agent: senior-dev-backend>`

### R1.10 — Smoke scripts for the provisioning gates
- **Owner:** `senior-dev-backend`
- **What:** `app/scripts/smoke_storage.py` with three subcommands. All of them read config through
  the R1.2 seam, print PASS/FAIL per check, and **never print credentials or full presigned URLs**.
  - **`r2`** checks:
    - presigned PUT, GET and HEAD round-trip
    - a 2-part multipart upload
    - HeadBucket vs `list_objects_v2`, reporting which is allowed
    - a checksum-header behaviour check
    - **Stream accepts a presigned R2 URL**: `POST /accounts/{id}/stream/copy` with a ~3 s test
      clip, poll until ready or error, then DELETE the Stream video
    - It cleans up every object it wrote.
  - **`archive`** runs the archive preflight probes and checks that HEAD on a nonexistent key returns
    404, not 403. It writes nothing.
  - **`archive-deny`** runs the R4.1 probes:
    - a corrupted FULL_OBJECT CRC32 at complete is rejected
    - an explicit `StorageClass=STANDARD` PUT is denied
    - `DeleteObject` on a given key/version is denied
- **Files / scope:** `app/scripts/smoke_storage.py`, `tests/archive_integration/test_smoke_storage.py`
  (runs `r2` against the MinIO pair with the Stream check skipped).
- **Verification:**
  - `uv run python -m app.scripts.smoke_storage --help` works.
  - The archive_integration test is green.
  - A test asserts that output contains no `X-Amz-Signature`.
- **Status update:** `[R2STORE — R1.10 smoke scripts] <agent: senior-dev-backend>`

### R1.11 — ADR 0011, ADR 0010 status line, DEPLOYMENT.md (first pass)
- **Owner:** `scribe`
- **What:**
  - **New ADR 0011:** "Object storage: Cloudflare R2 for live storage, AWS S3 Deep Archive as a
    cross-vendor cold tier". It records:
    - the invariant: the terminal outcome and the archive intent commit atomically, the sweep drives
      the copy to verified, and delete happens only after a re-verified copy exists
    - the delete flag and retention window
    - the multipart storage-class-condition trap (`StringNotEqualsIfExists`, and why
      `StringNotEquals` breaks UploadPart and Complete)
    - the upload cap change (P1)
    - the Cloudflare-account concentration risk
    - the deviation from the global CLAUDE.md, per decision (a) and (g)
    - dev running against real R2
    - the withdrawal policy per decision (c) = C1: single admin, Isaac's MFA human identity with
      `s3:BypassGovernanceRetention`
    - decision (b)
  - **ADR 0010:** add the status line "Amended by ADR 0011" only.
  - **`DEPLOYMENT.md`:**
    - §5: `sweep_archives` every 15 minutes in prod.
    - §8: R2 CORS, no MinIO.
    - §12: point at ADR 0011 and replace the same-bucket Glacier setup text.
    - The restore procedure is a placeholder heading; R5.2 fills it from the drill.
    - Add the re-ingest runbook: how to re-ingest an errored job from its live raw.
- **Files / scope:** `docs/adr/0011-object-storage-r2-and-deep-archive.md` (new),
  `docs/adr/0010-cloudflare-stream-media-pipeline.md` (status line only), `DEPLOYMENT.md`.
- **Verification:**
  - `grep -n "Amended by ADR 0011" docs/adr/0010-*.md` gives 1 hit.
  - `git diff --stat docs/adr/0010-*` shows ≤ 2 changed lines.
  - The ADR covers every bullet above, which the reviewer checks against this list.
  - `grep -rnE "AKIA|cfut_|-----BEGIN" docs DEPLOYMENT.md` returns nothing.
- **Status update:** `[R2STORE — R1.11 ADR 0011 + deployment docs] <agent: scribe>`

### R1.12 — Review the copy pass
- **Owner:** `security-reviewer`, then `reviewer-gilfoyle`, then `qa-strategist` (coverage against
  R0.2)
- **What:** Review R1.1–R1.11.
  - **security-reviewer:** credential handling, the redaction processor, preflight completeness,
    that no credential reaches host-run pytest, and the IAM/bucket policy JSON in §E against the
    code's actual API calls.
  - **reviewer-gilfoyle:** correctness of the lease/fence, to_thread boundaries, and the
    `ON CONFLICT` semantics, and that `put_archive_object` is the AM8 low-level multipart path
    (per-part heartbeat, MPU abort on fence loss, VersionId from Complete).
  - **qa-strategist:** every R0.2 case is implemented or explicitly deferred to a gate.
- **Files / scope:** read-only.
- **Verification:** three verdicts in `status.md`. Any Block finding returns work to the owning step.
  R3.3 does not start with an open Block.
- **Status update:** `[R2STORE — R1.12 copy-pass review] <agent: security-reviewer>` /
  `<agent: reviewer-gilfoyle>` / `<agent: qa-strategist>`

---

# E. Track B: Provisioning (Isaac, personally)

Placeholders used below. Real values **never** go in any `.md` file: the pre-commit secret scan skips
`*.md`.

| Placeholder | Meaning |
|---|---|
| `<CF_ACCOUNT_ID>` | Cloudflare account id (already in the override for Stream) |
| `<R2_ENDPOINT>` | `https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com`, or `https://<CF_ACCOUNT_ID>.eu.r2.cloudflarestorage.com` under decision (e) E1 |
| `<R2_DEV_ACCESS_KEY_ID>` / `<R2_DEV_SECRET_ACCESS_KEY>` | from the dev R2 token |
| `<ACCOUNT_ID>` | 12-digit AWS account id |
| `<ISAAC_IAM_USER>` | Isaac's human IAM user name (not root: root cannot assume roles) |
| `<AWS_DEV_WRITER_KEY_ID>` / `<AWS_DEV_WRITER_SECRET>` | access key of `sermon-archive-writer-dev` |

### R2.1 — Provision R2 · **[HUMAN_GATE R1]** after R2.2
- **Owner:** **Isaac, personally.** Not an agent.
- **What (Cloudflare dashboard):**
  1. **R2 Object Storage → Create bucket.** Create four buckets, one at a time:
     - `sermon-raw-dev`
     - `sermon-media-dev`
     - `sermon-raw-prod`
     - `sermon-media-prod`
     - For each: **Location**, per decision (e). E1: *Specify jurisdiction → European Union (EU)*.
       E2: *Provide a location hint → Western Europe (WEUR)*. E3: *Automatic*. Default storage class:
       **Standard**. Then **Create bucket**. **Irreversible:** the location cannot be changed later.
  2. **Each bucket → Settings:**
     - **Public access → R2.dev subdomain: Disabled / Not allowed.** **Custom Domains:** none. Leave
       it empty.
     - **CORS policy → Add CORS policy**, JSON editor. Dev buckets:
       ```json
       [{"AllowedOrigins":["http://localhost:3000"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["content-type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
       ```
       Prod buckets use the same JSON with `"AllowedOrigins":["https://<ADMIN_PORTAL_ORIGIN>","https://<WEB_APP_ORIGIN>"]`.
       If the prod origins don't exist yet, leave prod CORS empty and note it in `status.md`.
     - **Object lifecycle rules:** keep exactly one rule, the abort-incomplete-multipart rule
       (Cloudflare creates "Default Multipart Abort Rule" at 7 days; 1–7 days is acceptable). Delete
       any age-based expiry or transition rule. **No 30-day dev expiry** (P7).
  3. **R2 Object Storage → Manage R2 API Tokens → Create Account API Token** (this needs the Super
     Administrator role; a User API token with the same settings is acceptable):
     - Token name: `sermon-object-store-dev`
     - Permissions: **Object Read & Write**
     - Specify bucket(s): **Apply to specific buckets only** → `sermon-raw-dev`, `sermon-media-dev`
     - TTL: **1 year**
     - Client IP Address Filtering: none (dev)
     - **Create API Token**, then copy the **Access Key ID**, the **Secret Access Key** (shown once)
       and the **S3 endpoint** shown for your jurisdiction.
  4. **(R2.1b, optional per P3) Prod token:** `sermon-object-store-prod`, Object Read & Write,
     `sermon-raw-prod` + `sermon-media-prod` only, TTL **Forever**, with a 90-day manual rotation
     reminder in your calendar. Client IP filtering is added once prod compute exists. Store it in AWS
     Secrets Manager as `sermon/prod/object-store` with keys `OBJECT_STORE_ENDPOINT_URL`,
     `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`. It never goes on disk.
  5. **Paste dev values into `docker-compose.override.yml`** (gitignored). Add these keys under the
     existing `services.api.environment`, and repeat them under `services.sweeps.environment` and
     `services.archive-sweep.environment`. Create those two maps if absent; compose merges them.
     ```yaml
     OBJECT_STORE_ENDPOINT_URL: "<R2_ENDPOINT>"
     OBJECT_STORE_ACCESS_KEY_ID: "<R2_DEV_ACCESS_KEY_ID>"
     OBJECT_STORE_SECRET_ACCESS_KEY: "<R2_DEV_SECRET_ACCESS_KEY>"
     OBJECT_STORE_RAW_BUCKET: "sermon-raw-dev"
     OBJECT_STORE_MEDIA_BUCKET: "sermon-media-dev"
     ```
     **Not** root `.env`: host-run pytest loads that file (see the override's own header comment).
     `sweeps` also needs the existing `CF_*` keys to be useful. Copying them there is Isaac's call and
     is not required by this plan. (Isaac did copy them; see AM3.)
- **Files / scope:** `docker-compose.override.yml` (gitignored) only.
- **Verification:** Isaac posts in chat: "R2 provisioned, jurisdiction = __, override updated". The
  agent-run smoke is R2.2.
- **Status update:** `[R2STORE — R2.1 R2 provisioned] <agent: isaac>`. It records bucket names,
  jurisdiction and token TTL, **never values**.

### R2.2 — R2 smoke (after R2.1, R1.3, R1.10)
- **Owner:** `senior-dev-backend`
- **What:**
  - `docker compose build api && docker compose run --rm api python -m app.scripts.smoke_storage r2`
  - `docker compose run --rm api python -m app.scripts.preflight`
- **Files / scope:** none.
- **Verification:**
  - All `r2` checks PASS, including Stream reaching `ready` from a presigned R2 URL. This re-proves
    the original bug is fixed.
  - The Stream test video is deleted.
  - The HeadBucket-vs-list result is recorded.
  - `git status --porcelain` shows no tracked file changed.
- **Status update:** `[R2STORE — R2.2 R2 smoke] <agent: senior-dev-backend>`

### [HUMAN_GATE R1] — G-R2

**Status (recorded at R0):** Isaac's side (R2.1) is **done**: buckets created with automatic location
(E3), dev credentials in `docker-compose.override.yml` under `api`, `sweeps` and `archive-sweep`.
**The R2.2 smoke is still owed** (it needs R1.3 + R1.10). This gate is not crossed until R2.2 passes
and Isaac reviews it, and nothing that relies on real R2 credentials (R3.x cutover, R4.1) runs
before then.
Isaac reviews R2.2's output. Crossing it allows anything that touches real R2.

### R2.3 — Provision the AWS archive · **[HUMAN_GATE R2]** after R2.4
- **Owner:** **Isaac, personally.** Not an agent.
- **What (AWS console, region `eu-north-1` / Europe (Stockholm)):**
  - [ ] **0. D5 first.** In **IAM → Users → (each user) → Security credentials**, confirm access key
        `***REMOVED-AWS-ACCESS-KEY***` does not exist anywhere: deleted, not "Inactive". Confirm no other
        clone holds the old history. **If either fails, stop here.** This is a SECURITY BLOCK.
  - [ ] **1. Create the bucket.**
    - The bucket name needs the account-id suffix, because S3 names are global.
    - **S3 → Create bucket.**
      - Name: `sermon-archive-dev-<ACCOUNT_ID>` (P2). Repeat later for
        `sermon-archive-prod-<ACCOUNT_ID>` (R2.3b).
      - Object Ownership: **ACLs disabled (Bucket owner enforced)**.
      - Block Public Access: **all four ON**.
      - Bucket Versioning: **Enable**.
      - Default encryption: **SSE-S3**, Bucket Key default.
      - **Advanced settings → Object Lock: Enable**, and tick the acknowledgement.
      - **Create bucket.**
  - [ ] **2. Default retention.** **Bucket → Properties → Object Lock → Edit**: Default retention
        **Enable**, mode **Governance**, **180 days**, per decision (d). **Save.**
  - [ ] **3. Lifecycle.** **Bucket → Management → Create lifecycle rule**, twice:
    - `abort-incomplete-mpu`:
      - Scope: **Apply to all objects** (acknowledge the warning).
      - Action: **Delete expired object delete markers or incomplete multipart uploads** → Delete
        incomplete multipart uploads, **3 days**.
    - `backstop-deep-archive`:
      - Scope: prefix `sermon_archives/`.
      - Action: **Transition current versions of objects between storage classes** → **Glacier Deep
        Archive**, **0 days**.
      - Acknowledge the transition-cost notice.
    - **No** noncurrent-version expiry rule.
    - Expected result, visible via `aws s3api get-bucket-lifecycle-configuration`:
      ```json
      {"Rules":[
        {"ID":"abort-incomplete-mpu","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":3}},
        {"ID":"backstop-deep-archive","Status":"Enabled","Filter":{"Prefix":"sermon_archives/"},"Transitions":[{"Days":0,"StorageClass":"DEEP_ARCHIVE"}]}
      ]}
      ```
  - [ ] **4. Bucket policy.** **Bucket → Permissions → Bucket policy → Edit**. Replace `BUCKET` with
        the bucket name:
    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "DenyInsecureTransport",
          "Effect": "Deny",
          "Principal": "*",
          "Action": "s3:*",
          "Resource": ["arn:aws:s3:::BUCKET", "arn:aws:s3:::BUCKET/*"],
          "Condition": {"Bool": {"aws:SecureTransport": "false"}}
        },
        {
          "Sid": "DenyWrongStorageClass",
          "Effect": "Deny",
          "Principal": "*",
          "Action": "s3:PutObject",
          "Resource": "arn:aws:s3:::BUCKET/sermon_archives/*",
          "Condition": {"StringNotEqualsIfExists": {"s3:x-amz-storage-class": "DEEP_ARCHIVE"}}
        }
      ]
    }
    ```
    **Must be `StringNotEqualsIfExists`, not `StringNotEquals`.** UploadPart and
    CompleteMultipartUpload are authorised as `s3:PutObject` but carry no storage-class header, so
    `StringNotEquals` would deny every multipart upload.
  - [ ] **5. Writer user.**
    - **IAM → Users → Create user** `sermon-archive-writer-dev`. No console access.
    - Permissions: none at creation.
    - Then **Add permissions → Create inline policy → JSON**, name it `sermon-archive-writer`:
    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "WriteAndVerifyArchiveObjects",
          "Effect": "Allow",
          "Action": [
            "s3:PutObject",
            "s3:AbortMultipartUpload",
            "s3:ListMultipartUploadParts",
            "s3:GetObject",
            "s3:GetObjectVersion"
          ],
          "Resource": "arn:aws:s3:::BUCKET/sermon_archives/*"
        },
        {
          "Sid": "ReadBucketConfig",
          "Effect": "Allow",
          "Action": [
            "s3:ListBucket",
            "s3:GetBucketVersioning",
            "s3:GetLifecycleConfiguration",
            "s3:GetBucketObjectLockConfiguration"
          ],
          "Resource": "arn:aws:s3:::BUCKET"
        },
        {
          "Sid": "DenyNonDeepArchivePut",
          "Effect": "Deny",
          "Action": "s3:PutObject",
          "Resource": "arn:aws:s3:::BUCKET/*",
          "Condition": {"StringNotEqualsIfExists": {"s3:x-amz-storage-class": "DEEP_ARCHIVE"}}
        },
        {
          "Sid": "DenyDestructiveAndAdmin",
          "Effect": "Deny",
          "Action": [
            "s3:DeleteObject",
            "s3:DeleteObjectVersion",
            "s3:PutObjectAcl",
            "s3:PutObjectVersionAcl",
            "s3:PutBucket*",
            "s3:DeleteBucket*",
            "s3:PutLifecycleConfiguration",
            "s3:PutObjectRetention",
            "s3:PutObjectLegalHold",
            "s3:BypassGovernanceRetention",
            "s3:RestoreObject"
          ],
          "Resource": ["arn:aws:s3:::BUCKET", "arn:aws:s3:::BUCKET/*"]
        }
      ]
    }
    ```
    `ListBucket` is unconditional, so a missing key returns 404 rather than 403. `GetObjectVersion`
    is P9.
    - **Security credentials → Create access key** → use case *Application running outside AWS* →
      copy the Access key ID and Secret (shown once).
    - Rotation: every 90 days, with a calendar reminder. These keys are replaced by an ECS task role
      when compute moves to AWS.
  - [ ] **6. Break-glass restorer role.**
    - **IAM → Roles → Create role → Custom trust policy:**
    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": {"AWS": "arn:aws:iam::<ACCOUNT_ID>:user/<ISAAC_IAM_USER>"},
          "Action": "sts:AssumeRole",
          "Condition": {
            "Bool": {"aws:MultiFactorAuthPresent": "true"},
            "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"}
          }
        }
      ]
    }
    ```
    - Name: `sermon-archive-restorer`. **Maximum session duration: 1 hour.**
    - Attach no managed policies. Add an inline policy `sermon-archive-restore` that covers both
      archive buckets:
    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "RestoreAndRead",
          "Effect": "Allow",
          "Action": [
            "s3:RestoreObject",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:GetObjectAttributes",
            "s3:GetObjectVersionAttributes"
          ],
          "Resource": [
            "arn:aws:s3:::sermon-archive-dev-<ACCOUNT_ID>/*",
            "arn:aws:s3:::sermon-archive-prod-<ACCOUNT_ID>/*"
          ]
        },
        {
          "Sid": "List",
          "Effect": "Allow",
          "Action": ["s3:ListBucket", "s3:ListBucketVersions"],
          "Resource": [
            "arn:aws:s3:::sermon-archive-dev-<ACCOUNT_ID>",
            "arn:aws:s3:::sermon-archive-prod-<ACCOUNT_ID>"
          ]
        },
        {
          "Sid": "DenyWritesAndBypass",
          "Effect": "Deny",
          "Action": [
            "s3:Put*",
            "s3:DeleteObject*",
            "s3:DeleteBucket*",
            "s3:BypassGovernanceRetention"
          ],
          "Resource": [
            "arn:aws:s3:::sermon-archive-dev-<ACCOUNT_ID>",
            "arn:aws:s3:::sermon-archive-dev-<ACCOUNT_ID>/*",
            "arn:aws:s3:::sermon-archive-prod-<ACCOUNT_ID>",
            "arn:aws:s3:::sermon-archive-prod-<ACCOUNT_ID>/*"
          ]
        }
      ]
    }
    ```
    - Isaac's IAM user needs an MFA device, and `sts:AssumeRole` on this role's ARN if it is not
      already an admin.
    - The role never gets access keys and never enters app secrets.
    - Withdrawal is **not** this role. It is the decision (c) admin identity with MFA +
      `s3:BypassGovernanceRetention`.
  - [ ] **7. (R2.3b, optional per P3) Prod.** Repeat steps 1–5 for `sermon-archive-prod-<ACCOUNT_ID>`
        and `sermon-archive-writer-prod`. Store the prod writer keys in Secrets Manager as
        `sermon/prod/archive-store`. Nothing goes on disk.
  - [ ] **8. Paste dev values into `docker-compose.override.yml`** under the same three services as
        R2.1 (`api`, `sweeps`, `archive-sweep`):
    ```yaml
    ARCHIVE_STORE_BUCKET: "sermon-archive-dev-<ACCOUNT_ID>"
    ARCHIVE_STORE_REGION: "eu-north-1"
    ARCHIVE_STORE_ACCESS_KEY_ID: "<AWS_DEV_WRITER_KEY_ID>"
    ARCHIVE_STORE_SECRET_ACCESS_KEY: "<AWS_DEV_WRITER_SECRET>"
    ARCHIVE_STORE_STORAGE_CLASS: "DEEP_ARCHIVE"
    ```
    `ARCHIVE_DELETE_SOURCE` is **not** set. It stays false until R6.3.
- **Files / scope:** `docker-compose.override.yml` (gitignored) only.
- **Verification:** Isaac posts in chat: "D5 confirmed; AWS provisioned; override updated".
- **Status update:** `[R2STORE — R2.3 AWS archive provisioned] <agent: isaac>`. It records the D5
  confirmation, bucket names, role/user names and the Object Lock settings, **never keys**.

### R2.4 — AWS smoke (after R2.3, R1.3, R1.10)
- **Owner:** `senior-dev-backend`
- **What:**
  - `docker compose run --rm api python -m app.scripts.smoke_storage archive`
  - `docker compose run --rm api python -m app.scripts.preflight`
  - Nothing is written to the bucket.
- **Files / scope:** none.
- **Verification:**
  - Versioning is Enabled.
  - The abort-MPU rule is present.
  - The Object Lock default is GOVERNANCE/180d, per decision (d).
  - A missing key returns 404.
  - `git status --porcelain` shows no tracked change.
- **Status update:** `[R2STORE — R2.4 AWS smoke] <agent: senior-dev-backend>`

### [HUMAN_GATE R2] — G-AWS
Isaac reviews R2.4's output. Crossing it allows the first real archive write (R4.1).

**Status (recorded at R0):** Isaac's side (R2.3) is **done**, with D5 confirmed (decision (f)) and
dev archive credentials in the override under `api`, `sweeps` and `archive-sweep`. **The R2.4 smoke
is still owed** (it needs R1.3 + R1.10). This gate is not crossed until R2.4 passes and Isaac reviews
it; R4.1 does not run before then.

---

# F. Phase 3: Migrate and cut dev over

### R3.1 — Re-verify the sweep pause before touching data
- **Owner:** `senior-dev-backend`
- **What:** Before touching data, re-check that the R0.1 pause still holds, and that the 7 jobs'
  `attempts` / `started_at` are unchanged since R0.1.
- **Files / scope:** none. Read-only SELECT.
- **Verification:** `docker compose --profile sweeps ps` shows no running sweeps. The SELECT output
  matches R0.1.
- **Status update:** `[R2STORE — R3.1 pause verified] <agent: senior-dev-backend>`

### R3.2 — Cutover dry run (read-only)
- **Owner:** `senior-dev-backend`
- **What:**
  1. `docker volume ls | grep minio-data` confirms the preserved volume (P5).
  2. Start a temporary MinIO on it:
     `docker run -d --rm --name minio-cutover -v <project>_minio-data:/data -p 127.0.0.1:9100:9000 minio/minio:RELEASE.2025-09-07T16-13-09Z server /data`
  3. For `sermon-raw` and `sermon-media`, list the object count and total bytes. Report the
     `sermon_archives/` count separately; those objects are excluded (P6).
  4. Prepare, without running:
     - the mirror commands (`rclone copy` or `mc mirror`, same keys, `--exclude "sermon_archives/**"`
       on raw)
     - `UPDATE media_refs SET bucket = 'sermon-raw-dev' WHERE bucket = 'sermon-raw';`
     - `UPDATE media_refs SET bucket = 'sermon-media-dev' WHERE bucket = 'sermon-media';`
     - the reset `UPDATE upload_jobs SET attempts = 0, started_at = NULL WHERE id IN (<the 7 ids from R0.1>);`
     - the expected rowcounts from matching SELECTs
  5. Count finished VIDEO jobs with Stream ingest that will have **no** intent row. Pre-migration,
     this means any finished Stream-ingested job. If there are more than 0, prepare an
     `INSERT … ON CONFLICT DO NOTHING` of `pending` intent rows for them, for Isaac to approve.
     Otherwise they would never be archived.
  6. Grep for any other column holding a physical bucket name (`grep -n "bucket" app/models/models.py`),
     and report.
- **Files / scope:** none. All statements go to `status.md` verbatim, with credentials referenced by
  env-var name only.
- **Verification:** the statements, counts and expected rowcounts are in `status.md`. The temporary
  container is stopped afterwards.
- **Status update:** `[R2STORE — R3.2 cutover dry run] <agent: senior-dev-backend>`

### [HUMAN_GATE R4] — G-CUTOVER
- **Isaac approves:**
  - the exact statements and the 7 ids from R3.2
  - the optional intent back-fill
  - the `backfill_stream --execute`, which is 7 Stream ingests
- **Preconditions:** R1, R2 and R3 are crossed, and R1.12 has no open Block.

### R3.3 — Execute the dev cutover
- **Owner:** `senior-dev-backend`
- **What:** In this order, stopping at the first failure:
  1. `docker compose build api && docker compose run --rm api alembic upgrade head` (the R3 gate).
  2. Start `minio-cutover` (R3.2 step 2). Mirror both buckets to `sermon-raw-dev` /
     `sermon-media-dev` with the same keys, then compare object counts and sizes per bucket.
  3. Run the two `media_refs.bucket` UPDATEs in one transaction. Assert rowcounts equal R3.2's
     expected counts, otherwise ROLLBACK.
  4. The 7-id reset UPDATE, asserting rowcount = 7. Then the approved intent back-fill, if any.
  5. `docker compose up -d api`, then
     `docker compose run --rm api python -m app.scripts.backfill_stream` (dry run: must list exactly
     the 7), then `… backfill_stream --execute`.
  6. Wait for Stream `ready`, by webhook or by
     `docker compose run --rm api python -m app.scripts.sweep_stream_jobs` run by hand.
  7. **Resume `sweep_stream_jobs`**: `docker compose --profile sweeps up -d sweeps`.
     `sweep_archives` stays manual.
  8. Stop and remove `minio-cutover`. The volume itself is kept until R7.1.
- **Files / scope:** dev DB, dev R2 buckets. No repo changes.
- **Verification:**
  - Mirror counts and bytes match per bucket.
  - All 7 sermons have `media_refs.stream_uid` set and Stream status `ready`.
  - `SELECT status, count(*) FROM media_archives GROUP BY 1` shows 7 `pending` (plus any back-filled
    rows).
  - The admin portal plays one of them.
  - `uv run pytest -q --tb=short` is still green.
- **Status update:** `[R2STORE — R3.3 dev cutover] <agent: senior-dev-backend>`

---

# G. Phase 4: First real cross-vendor copy (delete OFF)

### R4.1 — First real archive run and exit-criteria probes
- **Owner:** `senior-dev-backend`
- **What:**
  1. `docker compose --profile ops run --rm archive-sweep`. The batch limit of 5 means two runs for 7
     rows.
  2. For one archived row, run `smoke_storage archive-deny` against its key and version.
  3. `docker compose run --rm api python -m app.scripts.preflight`.
- **Files / scope:** dev AWS bucket, dev DB. No repo changes. **`ARCHIVE_DELETE_SOURCE` is unset.**
- **Verification (G-A exit criteria):**
  - Rationale (AM5): the R0.2 spike showed MinIO rejects `DEEP_ARCHIVE`, cannot distinguish a correct
    FULL_OBJECT CRC32 from a corrupted one, and never returns `StorageClass` on HEAD. Below this
    gate the class and checksum are proven only as call shape at the unit tier. The first two
    criteria below are therefore the **only** real proof, and cannot be waived.
  - [ ] For every row: a VersionId-pinned HEAD shows `StorageClass = DEEP_ARCHIVE`, size = DB
        `size_bytes`, and `sha256` metadata = DB `sha256`.
  - [ ] A FULL_OBJECT CRC32 complete was accepted, and a deliberately corrupted CRC32 was rejected.
  - [ ] An explicit `StorageClass=STANDARD` PUT is denied (AccessDenied).
  - [ ] A writer `DeleteObject` on an archived version is denied.
  - [ ] Preflight passes the versioning, lifecycle and Object Lock probes.
  - [ ] The R2 source objects are all still present, and no row is `source_deleted`.
  - [ ] A second `archive-sweep` run is a no-op.
- **Status update:** `[R2STORE — R4.1 first cross-vendor archive] <agent: senior-dev-backend>`

### [HUMAN_GATE R5] — G-A
Isaac reviews the R4.1 evidence. This closes ADR 0010's ~line 172 debt. Crossing it starts the restore
drill.

---

# H. Phase 5: Restore drill

### R5.1 — Restore drill (bulk, by version-id)
- **Owner:** **Isaac, personally.** The restorer role requires his MFA; no agent can assume it.
  `senior-dev-backend` prepares the exact commands and posts them to `status.md` first.
- **What:** One archived row, chosen by the agent. Take `archive_key`, `archive_version_id` and
  `sha256` from `media_archives`.
  1. `aws sts assume-role --role-arn arn:aws:iam::<ACCOUNT_ID>:role/sermon-archive-restorer --role-session-name restore-drill --serial-number <MFA_ARN> --token-code <CODE> --duration-seconds 3600`
     and export the returned temporary credentials in that shell only.
  2. `aws s3api restore-object --bucket sermon-archive-dev-<ACCOUNT_ID> --key <archive_key> --version-id <archive_version_id> --restore-request '{"Days":3,"GlacierJobParameters":{"Tier":"Bulk"}}'`
  3. About 48 hours later, re-assume the role, then run
     `aws s3api head-object --bucket … --key … --version-id …`. The `Restore` field must show
     `ongoing-request="false"`.
  4. `aws s3api get-object --bucket … --key … --version-id … /tmp/restore-drill.bin`, then
     `shasum -a 256 /tmp/restore-drill.bin` must equal the DB `sha256`. Delete the local file.
  5. Negative check with the restorer session:
     `aws s3api delete-object --bucket … --key … --version-id …` must be AccessDenied.
- **Files / scope:** none.
- **Verification:** the sha256 match and the AccessDenied are pasted into `status.md`, together with
  the timestamps of request and completion.
- **Status update:** `[R2STORE — R5.1 restore drill] <agent: isaac>`

### R5.2 — Restore procedure in DEPLOYMENT.md
- **Owner:** `scribe`
- **What:** Fill the §12 restore-procedure heading from R5.1 as it actually ran: commands, timings, the
  Bulk vs Standard tier tradeoff, the MFA/role requirement, and a pointer to the decision (c)
  withdrawal procedure (C1: single admin, Isaac's MFA human identity with
  `s3:BypassGovernanceRetention`).
- **Files / scope:** `DEPLOYMENT.md` §12 only.
- **Verification:** each command in the doc matches the R5.1 log. No real ids or ARNs, only
  placeholders (`grep -nE "[0-9]{12}" DEPLOYMENT.md` returns no new hits).
- **Status update:** `[R2STORE — R5.2 restore procedure] <agent: scribe>`

### [HUMAN_GATE R6] — G-B
The restore drill passed. Until this is crossed, `ARCHIVE_DELETE_SOURCE=true` is set nowhere.

---

# I. Phase 6: Delete pass

### R6.1 — Delete pass
- **Owner:** `senior-dev-backend`
- **What:**
  - Implement §A.3.4 in `archive_service` and `sweep_archives`: every guard, the VersionId-pinned
    re-HEAD, R2 delete, then UPDATE to `source_deleted`.
  - No editor-purge path: decision (b) is B-B, so editor deletes already purge in R1.7 (AM2).
  - `_resolve_variant_url` raises after the source is deleted.
  - Delete-side failure-injection rows: after ARCHIVED before delete, and delete fails.
  - Tests for each guard, one failing at a time: flag off, archive stub, wrong status, audio, key
    mismatch, retention not elapsed, error outcome, re-HEAD mismatch.
- **Files / scope:** `app/services/archive_service.py`, `app/scripts/sweep_archives.py`,
  `app/services/media_service.py` (`_resolve_variant_url`), `tests/test_sweep_archives_unit.py`,
  `tests/archive_integration/test_delete_pass.py`.
- **Verification:**
  - `uv run pytest -q --tb=short` is green.
  - `uv run pytest -q --tb=short -m archive_integration` is green.
  - The invariant is asserted on every row.
- **Status update:** `[R2STORE — R6.1 delete pass] <agent: senior-dev-backend>`

### R6.2 — Review the delete pass
- **Owner:** `security-reviewer`, then `reviewer-gilfoyle`
- **What:** Review R6.1 only: the guard ordering, TOCTOU between the re-HEAD and the delete, and the
  interaction with R1.7's B-B editor deletes (a `cancelled` or editor-`source_deleted` row is never
  touched by the delete pass).
- **Files / scope:** read-only.
- **Verification:** both verdicts in `status.md`. Any Block returns to R6.1.
- **Status update:** `[R2STORE — R6.2 delete-pass review] <agent: security-reviewer>` /
  `<agent: reviewer-gilfoyle>`

### [HUMAN_GATE R7] — G-DEL
Isaac approves the delete-pass code and setting `ARCHIVE_DELETE_SOURCE=true` in dev.

### R6.3 — Enable the delete pass in dev
- **Owner:** `senior-dev-backend`
- **What:**
  - Add `ARCHIVE_DELETE_SOURCE: "true"` to the `archive-sweep` service environment in
    `docker-compose.override.yml`. This is not a secret; no other key is touched.
  - Run `docker compose --profile ops run --rm archive-sweep`.
  - With the default 14-day retention, nothing retention-driven is eligible yet. Log the eligible-row
    query result.
- **Files / scope:** `docker-compose.override.yml` (one key).
- **Verification:**
  - Preflight passes.
  - Rows eligible under retention = 0, logged.
  - Every R2 source of an `archived` row is still present. (Editor deletes under B-B are already
    `cancelled` or `source_deleted` and are out of scope here.)
  - The first retention-driven delete is observed and logged by whoever runs the sweep after
    `archived_at + 14d`. That observation is a follow-up entry, not a blocker for R8.
- **Status update:** `[R2STORE — R6.3 delete enabled (dev)] <agent: senior-dev-backend>`

---

# J. Phase 7: Close

### R7.1 — Remove the MinIO volume declaration
- **Owner:** `noob-dev`
- **What:** Delete the `minio-data` volume from `docker-compose.yml`. Isaac removes the Docker volume
  itself (`docker volume rm <project>_minio-data`) when he chooses. It is not required.
- **Files / scope:** `docker-compose.yml`.
- **Verification:** `docker compose config --quiet` succeeds, and
  `docker compose config | grep -c minio` = 0.
- **Status update:** `[R2STORE — R7.1 minio volume removed] <agent: noob-dev>`

### [HUMAN_GATE R8] — Final review and merge
- Isaac reviews the branch diff summary and the full `status.md` trail.
- The merge of `feat/r2-storage` into `main` is his.
- Conventional commits on the branch: `feat:` / `refactor:` / `docs:` / `chore:`.
- Open item carried to this gate: decision (f), "no other clone holds the pre-rewrite history",
  unless Isaac has confirmed it earlier.

---

## Rollback

| Failure point | Revert |
|---|---|
| Any Track A step | `git revert` / reset on `feat/r2-storage`. Nothing is external yet. |
| R2.1 / R2.3 wrong settings | R2 buckets are empty: delete and recreate, but **jurisdiction is irreversible**, so a wrong jurisdiction means new names or accepting it. AWS without Object Lock: delete it and create a new bucket (a name change only if the old name is still held). A wrong retention period can be edited down only in GOVERNANCE. |
| R3.3 before the UPDATEs | Nothing to undo. The mirror is additive, and MinIO is untouched. |
| R3.3 after the UPDATEs | Reverse UPDATEs (`-dev` → old names) in one transaction. Point the override back at `minio-cutover`, as a temporary rollback only. `alembic downgrade -1` drops only this plan's objects. |
| R3.3 backfill | Stream ingests are the existing rollback path: delete the Stream video, then clear `stream_uid` with a gated UPDATE. |
| R4.1 bad archive object | Mark the row FAILED with `last_error`. The object is locked for 180 days; leave it, and the next sweep writes a new version. There is no data loss, because the R2 source is untouched. |
| R6.3 | Remove `ARCHIVE_DELETE_SOURCE` from the override. Deletes already done are recoverable only through the R5 restore procedure. **That is why R6 precedes R7.** |
| Legacy `S3_*` validator bites a stale env | Remove the var. Don't weaken the validator. |

## Out of scope

- Mobile W3.4 (uncommitted in `mobile/`), and W1.8.
- Migrating the whole test suite to Postgres.
- Changing `media_refs.bucket` from physical bucket names to logical roles. This is a flagged
  follow-up; R3.3's UPDATE is the cost of not doing it.
- A CDN or custom domain for media, and any R2 public access.
- Archiving renditions, thumbnails or audio.
- Prod deployment, prod compute, `ARCHIVE_DELETE_SOURCE=true` in prod, and the prod restore drill
  (P3, P8).
- Staging buckets.
- Removing the legacy `S3_*` validator (next cycle).
- Editing `~/.claude/CLAUDE.md` (decision (g) is Isaac's).
- An R2 token rotation runbook, beyond the calendar reminder.

## Risks accepted

- **Cloudflare-account concentration.** Audio, thumbnails and renditions live only on R2. Video is
  served from Stream on the same account. One account suspension or compromise takes down all live
  media. Only video masters have a second-vendor copy. Recorded in ADR 0011.
- **Loss of offline dev.** Dev now needs internet and R2 credentials. Host-run unit tests stay offline
  on stubs, and archive_integration needs Docker only.
- **Uplink cost in dev.** Every dev upload crosses the internet, and the cutover pushes the entire
  MinIO corpus to R2. R2 egress is free; the cost is local uplink time.
- **The 180-day minimum charge.** DEEP_ARCHIVE bills 180 days per object version, and Object Lock
  holds versions for 180 days. A mistaken, test or superseded archive object costs 180 days of
  storage, and a withdrawn master still bills out its minimum. Negligible at sermon volume, but it is
  not zero.
- **A PUT that omits the storage-class header is allowed by both Deny statements** (`…IfExists`). This
  is unavoidable if multipart is to work. It is caught by three layers: the code always sets the
  class; read-back verify fails anything but the configured class; and the `backstop-deep-archive`
  lifecycle rule transitions it.
- **Dev holds real published masters** for the 7 sermons. Unpublished masters must never be uploaded
  in dev.
- **The IAM user writer (long-lived keys)** stays until compute moves to AWS, on 90-day rotation.

---

# Amendments

Recorded at `[HUMAN_GATE R0]` (2026-09-24), relayed from Isaac by the Conductor. Each is a
deliberate deviation from the plan body as drafted; the plan body is otherwise still the contract.
Named AM* so they don't collide with decision option A1.

## AM1 — `archive-sweep` compose service moves forward to R0.1

- **Problem:** Isaac's `docker-compose.override.yml` already defines an `archive-sweep` service with
  only an `environment:` block (R2.1 step 5, R2.3 step 8). Base `docker-compose.yml` does not define
  it yet (it was scheduled for R1.9), so `docker compose config` fails with "service archive-sweep
  has neither an image nor a build context". Every compose command is broken until this is fixed,
  including the R0.1 sweep pause.
- **Change:** the first action of R0.1 (item 0) adds `archive-sweep` to base `docker-compose.yml`:
  the app build context and Dockerfile, `profiles: ["ops"]`, `<<: *app-env`, command
  `python -m app.scripts.sweep_archives`. It is a harmless stub until R1.9 writes the script; R1.9
  no longer creates the service.
- **Verification:** `docker compose config --services` succeeds.
- **Rollback:** remove the service block. Compose then fails again until the override entry is
  removed too.

## AM2 — Decision (b) resolved to B-B

- §A.3.4, §A.4.1, R1.6, R1.7, R6.1, R6.2 and R6.3 now state the B-B branch only. The decision
  record in "Decisions required at R0" (b) keeps both options, with B-A marked not chosen.
- Schema: `status` includes `cancelled`. There is no `editor_purge_requested_at` column and no
  `deleted_before_terminal` outcome.
- Editor delete before Stream is terminal (b-ii): deletes immediately, as today, with no row.
- b-iii is moot: the delete pass is retention-driven only and has no editor-purge branch.

## AM3 — `sweeps` service now holds live and archive credentials

- The existing `sweeps` service (compose profile `sweeps`, the loop running `sweep_uploads` /
  `sweep_stream_jobs`) now carries `OBJECT_STORE_*`, `ARCHIVE_STORE_*` and `CF_*` in Isaac's
  override. This resolves the planner's earlier gap #10 (`sweeps` lacking `CF_*`).
- Consequence: a running `sweeps` container would now call Stream with real credentials against
  unmigrated data. It **must stay stopped until R3.3 step 7** resumes it, per the R0.1 pause rule.
  It is not running as of R0. R0.1 and R3.1 still verify this.

## AM4 — R1.7 editor-delete hardening (qa-strategist, R0.2)

- **(i) Losing cancel race.** The editor's cancel UPDATE is fenced on the row state and lease it
  read. A 0-row match (the sweep renewed the lease or advanced the row) must **not** purge R2; the
  path re-reads the row and acts on its current state.
- **(ii)** An editor delete on a row already `source_deleted` is an explicit no-op.
- Both are in R1.7's scope and each has a test.

## AM5 — MinIO cannot stand in for AWS on class or checksum (R0.2 spike)

- Evidence: `status.md` entry `[R2STORE — R0.2 test plan]`. MinIO rejects
  `StorageClass=DEEP_ARCHIVE` (`InvalidStorageClass`), cannot tell a correct FULL_OBJECT CRC32 from
  a corrupted one, and never returns `StorageClass` on HEAD. It does return a real VersionId, and
  deleting a missing key returns 204.
- R1.8 / R1.9: the MinIO "aws" store is built without the storage-class and checksum params. The
  archive_integration tier proves multipart, resume, lease/fence, VersionId-pinned HEAD and delete
  idempotency.
- The DEEP_ARCHIVE + FULL_OBJECT CRC32 call shape is asserted at the unit tier by spying the client
  call kwargs (`Stubber` or `LocalArchiveStore`).
- Real storage-class and checksum proof is R4.1 (G-A) only; its exit criteria say so.
- §A.5's "two MinIO containers stand in for R2 and AWS" is read subject to this amendment.

## AM6 — Decision (c) revised to C1

- Isaac revised (c) after R0: withdrawal/erasure authority is **Isaac alone** (C1), via his MFA
  human identity with `s3:BypassGovernanceRetention`. C2 is not chosen.
- The second-admin name blank and the "second identity must exist before R8" requirement are
  removed. R1.11 (ADR 0011, `DEPLOYMENT.md` §12) and R5.2 describe a single-admin procedure.

## AM7 — R1.3 wires `get_archive_store()`

- R1.2 had to leave `get_archive_store()` always returning `LocalArchiveStore`: the `ARCHIVE_STORE_*`
  settings did not exist yet, and no later step scoped `app/core/storage.py`.
- R1.3's scope gains `app/core/storage.py`, limited to that wiring: a real `S3ArchiveStore` when
  `archive_is_live`, the stub otherwise; production preflight refuses the stub.
- Recorded as done in R1.2: the 8 tests tied to the deleted `s3_public_endpoint` field
  (`tests/test_production_hardening.py`, `tests/test_portal_batch3.py`) were removed to keep the
  suite green. R1.3 still owns rewriting the preflight tests in those files.

## AM8 — `put_archive_object` must be the §A.3.2 low-level multipart path

- R1.2's `S3ArchiveStore.put_archive_object` streams a checksumming reader into boto3's managed
  `upload_fileobj` and recovers the VersionId with a follow-up `head_object`. That conflicts with
  §A.3.2: no per-part fenced heartbeat, no MPU abort on a lost fence, no CRC32 FULL_OBJECT declared
  on Create/Complete, and a later HEAD can return a different version than the one written.
- R1.9's scope gains replacing or extending `put_archive_object` with the low-level path, plus a
  per-part callback hook for the heartbeat, with the VersionId taken from `CompleteMultipartUpload`.
- `reviewer-gilfoyle` checks it at R1.12.
