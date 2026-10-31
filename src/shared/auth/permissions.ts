import type { StaffRole } from '../../generated/prisma/enums.js';

/** What staff can do in the admin console. Checked per endpoint with @RequirePermission(). */
export const PERMISSIONS = [
  'dashboard.view',
  'requests.view',
  /** Price, hold and confirm workers, remind, start, complete, cancel */
  'requests.manage',
  'workers.view',
  /** Create and edit workers, upload documents, send to verification */
  'workers.manage',
  /** Verify or decline workers pending verification */
  'workers.verify',
  'clients.view',
  'payments.view',
  /** Refunds and payouts */
  'payments.manage',
  'tickets.view',
  'tickets.manage',
  'reviews.view',
  'settings.manage',
  'team.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EVERYONE: Permission[] = [
  'dashboard.view',
  'requests.view',
  'workers.view',
  'clients.view',
  'reviews.view',
];

/** From the "Team & roles" table in the admin design. */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  VERIFICATION_LEAD: [...EVERYONE, 'workers.manage', 'workers.verify'],
  FINANCE: [...EVERYONE, 'payments.view', 'payments.manage', 'tickets.view'],
  CUSTOMER_SERVICE: [...EVERYONE, 'tickets.view', 'tickets.manage'],
};

export function can(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
