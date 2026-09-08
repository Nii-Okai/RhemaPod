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
