/**
 * Client-side React Query provider (plan §A.4).
 *
 * Not mounted here — whoever owns the tree wiring drops `<QueryProvider>` into
 * the layout (the portal shell is W5). On the server a fresh client is made per
 * render; in the browser a single client is reused across renders so the cache
 * survives navigation.
 */

"use client";

import { useState } from "react";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { makeQueryClient } from "./client";

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server: never share a client between requests.
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * The one browser-side `QueryClient` — the same instance `<QueryProvider>`
 * hands the portal tree. Exposed for the few call sites that must reach the
 * cache from OUTSIDE the provider (the `(public)` login form lives above
 * `(portal)/layout.tsx`, where the provider is mounted): on a fresh sign-in it
 * invalidates the previous session's cached nav counts so the sidebar doesn't
 * open on stale numbers. Returns `undefined` on the server — there is no
 * shared client there.
 */
export function getBrowserQueryClient(): QueryClient | undefined {
  if (typeof window === "undefined") return undefined;
  return getQueryClient();
}
