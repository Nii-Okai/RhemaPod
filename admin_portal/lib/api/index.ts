// Transport layer (plan §A.3). Generated `schema.d.ts` (via `npm run gen:api`),
// `openapi-fetch` client with mount-prefix rewrite + throw-on-error, and the
// typed `ApiError` for the backend's `{ detail, correlation_id }` envelope.

export {
  api,
  createApiClient,
  unwrap,
  BFF_BASE_URL,
  type ApiClient,
  type CreateApiClientOptions,
} from "./client";
export {
  ApiError,
  isApiError,
  parseErrorBody,
  type ErrorEnvelope,
  type FieldError,
} from "./errors";
export type { paths, components, operations } from "./schema";
