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
| `plan-admin-portal-phase2.md` | Admin portal Phase 2 — Users & roles, Subscriptions, Dashboard | final; 12 decisions resolved — awaiting go/no-go at `[HUMAN_GATE 4]` |
| `plan-admin-portal-phase2-DRAFT.md` | superseded working-out for the above | **not a contract** — see `plan-admin-portal-phase2.md` |
| `plan-mobile-app.md` | RhemaPod mobile viewer app (React Native + Expo, iOS · Android · tablet) — MVP | final; 10 planner resolutions + 18 locked decisions — awaiting go/no-go at `[HUMAN_GATE M1]` |
| `plan-r2-storage.md` | R2 live storage + AWS S3 Deep Archive cold tier (cross-vendor archive, delete pass, dev cutover) | approved at R0; R1/R2 provisioned (smoke owed); in progress |
| `plan-sermon-comments.md` | Sermon Comments replacing Notes: backend, moderation, admin queue, mobile player restyle + comments (gates C1–C5) | draft — awaiting Isaac approval |
| `plan-media-cache.md` | Mobile media cache Phase 1 — silent LRU disk cache for streamed non-HLS audio, `/stream` re-validated, sign-out wiped (gates G0–G3) | S0–S10 complete, twice reviewed (all findings fixed); device checklist V1–V16 complete (2026-10-15); awaiting `[HUMAN_GATE G3]` merge decision |

New plans go here.
