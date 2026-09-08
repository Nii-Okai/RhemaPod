/** The session principal handed from the RSC bootstrap into the client
 *  `SessionProvider` (plan §A.2 "Session bootstrap", §A.7). Never written to a
 *  client-readable cookie or to `localStorage`. */
export interface SessionUser {
  id: string;
  email: string;
  /** `full_name` from the backend; may be unset. */
  name: string | null;
  /** `viewer | editor | manager | admin` — drives role-gated nav in W5. */
  role: string;
}
