/**
 * Type-level proof that `typedClient.ts` is actually checked against the
 * generated `schema.d.ts` (W3.3 verification: "typecheck fails if the
 * generated schema drifts from `openapi.json`"). Not a Jest test — no
 * `describe`/`it`, deliberately named `*.typetest.ts` (not `*.test.ts`, not
 * under `__tests__/`) so Jest's `testMatch` skips it, while `tsc --noEmit`
 * (this project's `include: ["**\/*.ts", ...]`) still checks it on every
 * `npm run typecheck` run.
 *
 * Two things are proved together:
 *  1. The "valid usage" functions below compile today, against the real
 *     current schema — if a future `npm run gen:api` regenerates the schema
 *     from a changed `openapi.json` and, say, `/catalog/sermons/{sermon_id}`
 *     is removed/renamed, or `SermonListItem` drops a field this file
 *     reads, these functions themselves start failing `tsc`.
 *  2. The `@ts-expect-error` lines prove the constraints are actually live,
 *     not accidentally erased into `any` — if the types ever went that
 *     loose, these lines would flip to "Unused '@ts-expect-error'
 *     directive" errors, which is itself a `tsc` failure.
 */
import { api } from './typedClient';

// --- Valid usage against the current schema — must compile. ---

export async function validListUsage(): Promise<string[]> {
  const sermons = await api.get('/catalog/sermons');
  // Reading a real, schema-declared field.
  return sermons.map((s) => s.id);
}

export async function validDetailUsage(sermonId: string) {
  const sermon = await api.get('/catalog/sermons/{sermon_id}', {
    params: { path: { sermon_id: sermonId } },
  });
  return sermon.title;
}

// --- Invalid usage — must NOT compile. If the schema drifts such that any
// of these becomes valid (or stays invalid for the wrong reason), the
// `@ts-expect-error` directive itself errors, failing `tsc`. ---

// @ts-expect-error - path does not exist in the generated schema
void api.get('/catalog/sermons/does-not-exist');

// @ts-expect-error - `/catalog/sermons/{sermon_id}` requires `params.path.sermon_id`
void api.get('/catalog/sermons/{sermon_id}');

async function readsWrongField() {
  const sermons = await api.get('/catalog/sermons');
  // @ts-expect-error - `SermonListItem` has no `not_a_real_field`
  return sermons[0].not_a_real_field;
}
void readsWrongField;
