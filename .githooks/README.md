# Git Hooks

This directory is the repository's hook path (configured via `git config core.hooksPath`). Hooks stored here are version-controlled and shared across all clones of the repository. They execute automatically during git operations without requiring manual setup.

## Current Hooks

- **pre-commit** — Scans staged changes for secrets: AWS credentials (AKIA/ASIA patterns, secret access keys), PEM private keys, Stripe live keys (sk_live_/rk_live_), and .env files. Blocks commits that contain detected secrets. Future: upgrade to gitleaks for comprehensive secret scanning.
