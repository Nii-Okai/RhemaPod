/**
 * Client session context (plan §A.2 "Session bootstrap").
 *
 * The RSC layout resolves the user server-side and passes it in here. Client
 * components read it with `useSession()`. This is the value W5 uses to drive
 * role-gated nav; W4 only stands it up.
 */

"use client";

import { createContext, useContext } from "react";

import type { SessionUser } from "./session-types";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}

/** The signed-in user. Throws outside a `(portal)` subtree. */
export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) {
    throw new Error("useSession() must be used within <SessionProvider>");
  }
  return user;
}

export type { SessionUser } from "./session-types";
