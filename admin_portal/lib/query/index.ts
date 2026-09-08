// Server-state layer (plan §A.4). Server-safe surface only — the `QueryClient`
// config and the typed key factory. `QueryProvider` is a client component and
// the feature hooks are `"use client"`; import those from their own modules
// (`@/lib/query/provider`, `@/lib/query/hooks/*`) so this barrel stays usable
// from Server Components.

export { makeQueryClient } from "./client";
export {
  queryKeys,
  type QueryKeys,
  type SermonListParams,
} from "./keys";
