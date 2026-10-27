# Git Hooks

This directory is the repository's hook path (configured via `git config core.hooksPath`). Hooks stored here are version-controlled and shared across all clones of the repository. They execute automatically during git operations without requiring manual setup.

## Current Hooks

- **pre-commit** — Scans staged changes for secrets with [gitleaks](https://github.com/gitleaks/gitleaks) (required: `brew install gitleaks`; the hook fails closed without it), plus targeted checks for AWS credentials, PEM private keys, Stripe live keys, long `SECRET_KEY` values and staged `.env` files. Reviewed false positives are listed by fingerprint in `.gitleaksignore` at the repo root.
