/** The caller, as established from a verified Supabase access token. */
export interface AuthUser {
  /** Supabase auth.users.id; also the Profile id */
  id: string;
  email: string | null;
  phone: string | null;
}
