/**
 * React Query client factory (plan §A.4).
 *
 *   staleTime            30s  — lists stay warm across quick navigation
 *   gcTime               5m   — dropped queries survive a brief detour
 *   refetchOnWindowFocus off  — an admin tool that refetches on every alt-tab
 *                               is noise
 *   retry                5xx only, at most twice — never a 4xx, never a
 *                               mutation. A thrown `ApiError` carries `status`;
 *                               anything else (network, parse) is not retried.
 */

import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "@/lib/api/errors";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          isApiError(error) && error.status >= 500 && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
