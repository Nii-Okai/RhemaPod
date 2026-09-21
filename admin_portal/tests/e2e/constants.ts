/**
 * Shared E2E constants.
 *
 * The bootstrap admin (`admin@rhemapod.com`) is NOT a `seed_dev.py` row — there
 * is no admin to authorise the first admin, so it is created out-of-band by
 * `app/scripts/create_admin.py`. `global-setup.ts` creates it idempotently and
 * verifies it can log in before the suite starts; `users-lifecycle.spec.ts`
 * steps 4–6 depend on it. Keep the credentials here so the two files can never
 * drift.
 */

export const BOOTSTRAP_ADMIN = {
  email: "admin@rhemapod.com",
  password: "AdminPass1@@",
} as const;

/** The exact command `global-setup.ts` prints when the bootstrap admin is
 *  missing and `docker` was not on PATH to create it automatically. */
export const CREATE_ADMIN_COMMAND =
  `docker compose exec -T api python -m app.scripts.create_admin ` +
  `--email ${BOOTSTRAP_ADMIN.email} --password '${BOOTSTRAP_ADMIN.password}'`;
