# plans/

Plan-as-contract documents. One file per initiative.

A plan is **immutable once approved** and contains `[HUMAN_GATE]` markers that
halt execution until Isaac approves in chat. Execution progress is logged
separately in the append-only `status.md` at the repo root — not in the plan.

| File | Initiative | Outcome |
|---|---|---|
| `plan.md` | API authentication hardening (auth review findings 1–4) | shipped — commit `9e8d366` |
| `plan-nonauth.md` | Non-auth code-review findings 1–8 | shipped — merge `a67218e` |

New plans go here.
