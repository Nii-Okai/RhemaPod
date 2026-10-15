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
| `plan-sermon-comments.md` | Sermon Comments replacing Notes: backend, moderation, admin queue, mobile player restyle + comments (gates C1–C5) | `[HUMAN_GATE C1]`–`[HUMAN_GATE C4]` approved, substantial post-C4 hardening (S11b) done, merged to `dev` — C5's explicit crossing not found in status.md, worth Isaac confirming it's fully closed; outcome corrected 2026-10-15, was stale |
| `plan-media-cache.md` | Mobile media cache Phase 1 — silent LRU disk cache for streamed non-HLS audio, `/stream` re-validated, sign-out wiped (gates G0–G3) | shipped — merged to `dev` 2026-10-15 (`2e01215`), `[HUMAN_GATE G3]` crossed |

New plans go here.
