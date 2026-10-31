import type { Db } from '../../../shared/database/prisma.service.js';

export interface AuthUserRecord {
  id: string;
  email: string | null;
  phone: string | null;
  emailConfirmedAt: Date | null;
  phoneConfirmedAt: Date | null;
}

/**
 * Reads contact details and verification state straight from Supabase's
 * auth.users, which stays the single source of truth for email and phone.
 */
export async function loadAuthUsers(
  db: Db,
  ids: string[],
): Promise<Map<string, AuthUserRecord>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.$queryRaw<AuthUserRecord[]>`
    select id::text as id,
           nullif(email, '') as email,
           nullif(phone, '') as phone,
           email_confirmed_at as "emailConfirmedAt",
           phone_confirmed_at as "phoneConfirmedAt"
      from auth.users
     where id = any(${unique}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r]));
}
