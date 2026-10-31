# plans/

Plan-as-contract documents. One file per initiative.

A plan is **immutable once approved** and contains `[HUMAN_GATE]` markers that
halt execution until Isaac approves in chat. Execution progress is logged
separately in the append-only `status.md` at the repo root — not in the plan.

| File | Initiative | Outcome |
|---|---|---|
| `plan.md` | API authentication hardening (auth review findings 1–4) | shipped — commit `9e8d366` |
| `plan-nonauth.md` | Non-auth code-review findings 1–8 | shipped — merge `a67218e` |
| `plan-admin-portal.md` | Admin portal frontend — architecture + Phase 1 build | shipped — W1–W14; amendments A1–A4 recorded in-file |
| `plan-admin-portal-phase2.md` | Admin portal Phase 2 — Users & roles, Subscriptions, Dashboard | shipped — `[HUMAN_GATE 4]` approved in chat 2026-10 (document itself is the approval record), W15–W24 merged to `dev`; outcome corrected 2026-10-15, was stale |
| `plan-admin-portal-phase2-DRAFT.md` | superseded working-out for the above | **not a contract** — see `plan-admin-portal-phase2.md` |
| `plan-mobile-app.md` | RhemaPod mobile viewer app (React Native + Expo, iOS · Android · tablet) — MVP | `[HUMAN_GATE M1]`–`[HUMAN_GATE M9]` all crossed (Sept 2026); in progress well beyond original MVP scope via later plans. Only `[HUMAN_GATE M10]` (EAS/Apple/Google provisioning, Isaac-only, real cost) and `[HUMAN_GATE M11]` (release readiness, store submission) remain — Isaac's own timing call; outcome corrected 2026-10-15, was stale |
| `plan-r2-storage.md` | R2 live storage + AWS S3 Deep Archive cold tier (cross-vendor archive, delete pass, dev cutover) | approved at R0; R1.1/R1.2 done, R1.3 landed informally; R1.7–R1.10 (incl. the smoke-test script itself) and R2.1–R2.4 not started — more remaining than "smoke owed" suggested, see status.md 2026-10-15 |
| `plan-sermon-comments.md` | Sermon Comments replacing Notes: backend, moderation, admin queue, mobile player restyle + comments (gates C1–C5) | shipped — `[HUMAN_GATE C1]`–`[HUMAN_GATE C5]` all approved, merged to `dev`; Isaac confirmed closed 2026-10-15 |
| `plan-media-cache.md` | Mobile media cache Phase 1 — silent LRU disk cache for streamed non-HLS audio, `/stream` re-validated, sign-out wiped (gates G0–G3) | shipped — merged to `dev` 2026-10-15 (`2e01215`), `[HUMAN_GATE G3]` crossed |
| `plan-stripe-removal.md` | Remove Stripe entirely (endpoints, service, DTOs, payment seam, config, dependency, admin portal link); no IAP replacement yet (gates SR0–SR4) | shipped — all gates (SR0–SR4) crossed, S0–S9 done, merged into `dev` (`f7b5b55`). ADR 0016 written |
| `plan-admin-settings.md` | Admin portal Settings: church profile + public settings contract, unified audit trail (incl. logins), usage reports + CSV export (gates AS0–AS7) | shipped — all gates (AS0–AS7) crossed, S0–S19 done, merged into `dev`. Independently re-verified before merge: backend 1793/1 skipped, admin portal 822/822, mobile 1010/1010. ADRs 0017–0019 written |
| `plan-account-deletion-backend.md` + `plan-account-deletion-clients.md` | Self-service account deletion with Apple token revocation: backend erasure, mobile flow, public web deletion page (gates AD0–AD5) | in progress — merged into `dev` early on Isaac's instruction; D15/D16/AD5 remain. ADR 0020 |
| `plan-ad5-retention-and-legal-pages.md` | AD5 prerequisites: 30-day audit IP/UA nulling on all rows + in-process daily retention task (also runs the 90-day snapshot purge on Render); public Privacy / Terms / Support pages on the admin portal (guidelines stay in-app) + mobile Me → Legal (gates P0–P4) | drafted 2026-10-30 — P2 facts answered; awaiting `[HUMAN_GATE P0]` |
| `plan-ad5-amendment-1-guidelines.md` | Amendment 1 to AD5: comment guidelines become a code-sourced public document (`app/content/comment_guidelines.txt`), public `/guidelines` page, portal editor removed, `church_settings.comment_guidelines` dropped; supersedes base §B.2 / P2 answer 7 (gates GA0–GA1, then base P3/P4) | drafted 2026-10-30 — awaiting `[HUMAN_GATE GA0]` |
| `plan-share-links.md` | https share links on `open.rhemapod.com` (Universal Links / App Links; apex untouched): new free Render Static Site with brand page, static fallback page + AASA/assetlinks, mobile link handling + signed-out replay (Phase 1, sermons + series); playlists private-by-default migration, non-owner read of public playlists, owner share with make-public prompt (Phase 2) (gates SL0–SL7). ADR 0021 | Phase 1 shipped — SL0–SL2 passed, S9 on-device PASS 2026-11-01 (TestFlight + APK); awaiting `[HUMAN_GATE SL3]`; Phase 2 (playlists) not started |
| `plan-android-google-auth-code.md` | Android Google sign-in + deletion re-auth via one-time server auth code exchanged by the backend (fixes Play Services cached-ID-token replay rejections); `id_token`/`server_auth_code` exactly-one on `/auth/oauth/google` + Google deletion proof; new `GOOGLE_OAUTH_CLIENT_SECRET`; revoke workarounds removed from sign-in (gates GC0–GC4). ADR 0015 addendum, ADR 0020 note | drafted 2026-11-01 — awaiting `[HUMAN_GATE GC0]` |

New plans go here.
