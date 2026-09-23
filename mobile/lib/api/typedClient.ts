/**
 * Typed API client layer, generated-schema-aware, built ON TOP of the raw
 * `apiFetch` wrapper (`./client.ts`) — not a replacement for it. `apiFetch`
 * already owns every transport concern that matters here: bearer attach,
 * single-flight 401 refresh-and-retry, and the `ApiError` envelope. This
 * module owns nothing but *types*: it turns the generated `./schema.d.ts`
 * (`npm run gen:api`, see `package.json` — regenerate after any backend
 * contract change) into compile-time-checked path/params/body/response
 * types for every endpoint, so a backend contract change that
 * `openapi-typescript` picks up breaks `tsc`, not a runtime call site (the
 * plan's own stated reason for this layer, §A.8).
 *
 * The type-derivation helpers below (`ParamsOption`, `RequestBodyOption`,
 * `InitParam`) follow the same pattern `openapi-fetch` uses internally,
 * built on the same `openapi-typescript-helpers` package `openapi-fetch`
 * itself depends on. They are reimplemented thinly here rather than pulling
 * in `openapi-fetch`'s own client: that client owns its own `fetch` call
 * and constructs its own `Request`/`Response` pipeline, which would either
 * fight or duplicate `apiFetch`'s auth/refresh logic (the actual hard part
 * W3.2 built). Query-key conventions for the TanStack Query hooks built on
 * top of this live in `lib/query/queryClient.ts`; this module is
 * transport-plus-types only, no caching.
 *
 * Usage: `api.get('/catalog/sermons/{sermon_id}', { params: { path: { sermon_id } } })`
 * — note the path is *un*prefixed, matching every other `apiFetch` call
 * site's convention (see `MountPrefix`/`UnprefixedPaths` below for why this
 * is safe at the type level, not just the runtime one).
 */
import type {
  HttpMethod,
  IsOperationRequestBodyOptional,
  OperationRequestBodyContent,
  PathsWithMethod,
  Readable,
  RequiredKeysOf,
  SuccessResponseJSON,
} from 'openapi-typescript-helpers';

import { apiFetch, type ApiFetchInit } from './client';
import type { paths } from './schema';

type Method = Extract<HttpMethod, 'get' | 'post' | 'put' | 'patch' | 'delete'>;

/**
 * `schema.d.ts` keys every path with the backend's mount prefix
 * (`/api/v1/...`), matching `openapi.json`'s `paths` object verbatim. But
 * `apiFetch` → `apiUrl()` (`./config.ts`) already appends `/api/v1` itself —
 * every other caller of `apiFetch` (e.g. `authClient.ts`'s `/auth/login`)
 * passes a path *without* that prefix. `UnprefixedPaths` strips it at the
 * *type* level (not just at runtime) so the literal string callers write —
 * `'/catalog/sermons'`, not `'/api/v1/catalog/sermons'` — is what `tsc`
 * actually checks against `keyof UnprefixedPaths`. A version of this file once stripped
 * the prefix only inside `buildPath()` at runtime while still typing `Path`
 * as `keyof paths` (i.e. requiring the *prefixed* string at the call site) —
 * that compiles, but only if every call site passes the prefixed form, which
 * defeats the entire point of matching `apiFetch`'s own convention. Fixed
 * here by moving the strip into the type.
 */
type MountPrefix = '/api/v1';

type StripMountPrefix<S extends string> = S extends `${MountPrefix}${infer Rest}`
  ? Rest extends ''
    ? '/'
    : Rest
  : S;

type UnprefixedPaths = { [K in keyof paths as StripMountPrefix<K & string>]: paths[K] };

type OperationFor<Path extends keyof UnprefixedPaths, M extends Method> = UnprefixedPaths[Path][M];

/** Mirrors openapi-fetch's own `ParamsOption`: required only when the operation has a required path/query param. */
type ParamsOption<Op> = Op extends { parameters: unknown }
  ? RequiredKeysOf<Op['parameters']> extends never
    ? { params?: Op['parameters'] }
    : { params: Op['parameters'] }
  : { params?: { query?: Record<string, unknown> } };

/** Mirrors openapi-fetch's own `RequestBodyOption`: required unless the schema marks `requestBody` optional or absent. */
type RequestBodyOption<Op> = [OperationRequestBodyContent<Op>] extends [never]
  ? { body?: never }
  : IsOperationRequestBodyOptional<Op> extends true
    ? { body?: OperationRequestBodyContent<Op> }
    : { body: OperationRequestBodyContent<Op> };

type CallOptions<Op> = ParamsOption<Op> &
  RequestBodyOption<Op> & {
    /** Forwarded to `apiFetch` — e.g. `{ auth: false }` for a public endpoint, an `AbortSignal`, etc. */
    init?: Omit<ApiFetchInit, 'body' | 'method'>;
  };

/** The 2nd call-site argument is optional exactly when nothing inside `Init` is required. */
type InitParam<Init> = RequiredKeysOf<Init> extends never ? [Init?] : [Init];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `SuccessResponseJSON`'s own constraint (openapi-typescript-helpers) requires `Record<string | number, any>`; a narrower constraint here doesn't satisfy it.
type ResponseOf<Op extends Record<string, any>> = Readable<SuccessResponseJSON<Op>>;

/**
 * `Path` (the exported verbs' type parameter, below) is already unprefixed
 * at the type level via `UnprefixedPaths` — so unlike an earlier draft of
 * this module, there is nothing left to strip here at runtime. `path` comes
 * in exactly as the caller wrote it (e.g. `/catalog/sermons/{sermon_id}`)
 * and goes straight to `apiFetch`, which appends `/api/v1` itself via
 * `apiUrl()`.
 */
function buildPath(path: string, pathParams?: Record<string, unknown>): string {
  if (!pathParams) return path;
  return path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = pathParams[key];
    if (value === undefined || value === null) {
      throw new Error(`typedClient: missing path param "${key}" for "${path}"`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Untyped at this boundary on purpose — `Op` is only known precisely at each
 * exported verb's own call site (below), where TS resolves it to a concrete
 * operation object rather than a still-abstract type parameter. Threading a
 * `Record<string, any>`-constrained `Op` through this shared helper as a
 * *second* layer of genericity (on top of the exported verb's own generic
 * `Path`) runs into TS distributing the indexed-access type across the
 * whole `PathsWithMethod` union while still self-checking the generic
 * function body, which reintroduces the `| undefined` branches the
 * `PathsWithMethod` filter already ruled out for any real call. The
 * exported `get`/`post`/etc. functions below are what callers see and get
 * checked against; this stays a thin, honestly-untyped runtime helper.
 */
async function typedRequest(
  method: Method,
  path: string,
  options: { params?: { path?: Record<string, unknown>; query?: Record<string, unknown> }; body?: unknown; init?: Omit<ApiFetchInit, 'body' | 'method'> } | undefined,
): Promise<unknown> {
  const opts = options ?? {};
  const resolvedPath = buildPath(path, opts.params?.path) + buildQuery(opts.params?.query);
  return apiFetch(resolvedPath, {
    ...opts.init,
    method: method.toUpperCase(),
    body: opts.body,
  });
}

/**
 * Typed, schema-checked HTTP verbs on top of `apiFetch`. Every call is
 * checked against the generated `paths`/`operations` types from
 * `./schema.d.ts` — an unknown path, a missing required path/query param, a
 * wrong request-body shape, or reading a field the response type doesn't
 * have are all `tsc` errors, not runtime surprises.
 */
export const api = {
  get<Path extends PathsWithMethod<UnprefixedPaths, 'get'>>(
    path: Path,
    ...init: InitParam<CallOptions<OperationFor<Path, 'get'>>>
  ): Promise<ResponseOf<OperationFor<Path, 'get'>>> {
    return typedRequest('get', path, init[0]) as Promise<ResponseOf<OperationFor<Path, 'get'>>>;
  },
  post<Path extends PathsWithMethod<UnprefixedPaths, 'post'>>(
    path: Path,
    ...init: InitParam<CallOptions<OperationFor<Path, 'post'>>>
  ): Promise<ResponseOf<OperationFor<Path, 'post'>>> {
    return typedRequest('post', path, init[0]) as Promise<ResponseOf<OperationFor<Path, 'post'>>>;
  },
  put<Path extends PathsWithMethod<UnprefixedPaths, 'put'>>(
    path: Path,
    ...init: InitParam<CallOptions<OperationFor<Path, 'put'>>>
  ): Promise<ResponseOf<OperationFor<Path, 'put'>>> {
    return typedRequest('put', path, init[0]) as Promise<ResponseOf<OperationFor<Path, 'put'>>>;
  },
  patch<Path extends PathsWithMethod<UnprefixedPaths, 'patch'>>(
    path: Path,
    ...init: InitParam<CallOptions<OperationFor<Path, 'patch'>>>
  ): Promise<ResponseOf<OperationFor<Path, 'patch'>>> {
    return typedRequest('patch', path, init[0]) as Promise<ResponseOf<OperationFor<Path, 'patch'>>>;
  },
  delete<Path extends PathsWithMethod<UnprefixedPaths, 'delete'>>(
    path: Path,
    ...init: InitParam<CallOptions<OperationFor<Path, 'delete'>>>
  ): Promise<ResponseOf<OperationFor<Path, 'delete'>>> {
    return typedRequest('delete', path, init[0]) as Promise<ResponseOf<OperationFor<Path, 'delete'>>>;
  },
};

export type { paths as ApiPaths };
