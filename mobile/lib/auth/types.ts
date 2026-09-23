/**
 * Shapes mirrored from the backend contract (openapi.json — `TokenPair`,
 * `UserPublic`). Kept here rather than re-exporting a generated client
 * because W3.3 owns the generated typed client; this layer only needs the
 * auth-specific slice.
 */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
}

export type UserRole = 'member' | 'editor' | 'manager' | 'admin';

export interface UserPublic {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  full_name: string | null;
  created_at: string;
  activated_at: string | null;
}

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';
