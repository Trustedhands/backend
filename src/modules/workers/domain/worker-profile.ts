import {
  ConflictError,
  InvalidInputError,
} from '../../../shared/domain/domain-error.js';

export type WorkerStatus =
  'DRAFT' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'DECLINED';
export type DocumentKind = 'PHOTO' | 'ID_FRONT' | 'ID_BACK';

/** The fields the checklist looks at. */
export interface WorkerProfileFacts {
  fullName: string;
  dateOfBirth: Date | null;
  languages: string[];
  categories: string[];
  phone: string;
  district: string | null;
  sector: string | null;
  idType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVING_LICENCE' | null;
  idNumber: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
  payoutMsisdn: string | null;
  payoutBankName: string | null;
  payoutBankAccount: string | null;
  documents: DocumentKind[];
}

export interface ChecklistItem {
  key:
    'personal' | 'contact' | 'services' | 'identity' | 'nextOfKin' | 'payout';
  label: string;
  done: boolean;
  /** What's missing, e.g. "ID back missing" */
  missing: string | null;
}

/** The "Checklist" sidebar on Add a worker. */
export function workerChecklist(w: WorkerProfileFacts): ChecklistItem[] {
  const needsBack =
    w.idType === 'NATIONAL_ID' || w.idType === 'DRIVING_LICENCE';
  const idMissing = !w.idType
    ? 'ID type'
    : !w.idNumber
      ? 'ID number'
      : !w.documents.includes('ID_FRONT')
        ? 'ID front'
        : needsBack && !w.documents.includes('ID_BACK')
          ? 'ID back'
          : null;
  const items: Array<Omit<ChecklistItem, 'done'>> = [
    {
      key: 'personal',
      label: 'Personal details',
      missing: !w.fullName.trim()
        ? 'name'
        : !w.dateOfBirth
          ? 'date of birth'
          : !w.languages.length
            ? 'languages'
            : !w.documents.includes('PHOTO')
              ? 'photo'
              : null,
    },
    {
      key: 'contact',
      label: 'Contact & address',
      missing: !w.phone ? 'phone' : !w.district || !w.sector ? 'address' : null,
    },
    {
      key: 'services',
      label: 'Services',
      missing: w.categories.length ? null : 'at least one service',
    },
    { key: 'identity', label: 'ID', missing: idMissing },
    {
      key: 'nextOfKin',
      label: 'Next of kin',
      missing: !w.nextOfKinName ? 'name' : !w.nextOfKinPhone ? 'phone' : null,
    },
    {
      key: 'payout',
      label: 'Payout',
      missing:
        w.payoutMsisdn || (w.payoutBankName && w.payoutBankAccount)
          ? null
          : 'Mobile Money or bank account',
    },
  ];
  return items.map((i) => ({ ...i, done: i.missing === null }));
}

export function assertReadyForVerification(w: WorkerProfileFacts): void {
  const missing = workerChecklist(w).filter((i) => !i.done);
  if (missing.length) {
    throw new InvalidInputError(
      'profile_incomplete',
      `Complete the profile first: ${missing.map((i) => `${i.label} (${i.missing})`).join(', ')}`,
    );
  }
}

/** The "Check against the ID" table; every row must be ticked to verify. */
export const VERIFICATION_CHECKS = [
  'fullName',
  'dateOfBirth',
  'idNumber',
  'photo',
  'reference',
] as const;
export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

export function assertCanDecide(worker: { status: WorkerStatus }): void {
  if (worker.status !== 'PENDING_VERIFICATION') {
    throw new ConflictError(
      'not_pending',
      'Only workers pending verification can be verified or declined',
    );
  }
}

export function assertAllChecksPass(
  checks: Partial<Record<VerificationCheck, boolean>>,
): void {
  const failed = VERIFICATION_CHECKS.filter((c) => checks[c] !== true);
  if (failed.length) {
    throw new InvalidInputError(
      'checks_incomplete',
      `Tick every check before verifying (missing: ${failed.join(', ')})`,
    );
  }
}

/** Fields whose change after verification means the ID must be checked again. */
export const IDENTITY_FIELDS = [
  'fullName',
  'dateOfBirth',
  'idType',
  'idNumber',
] as const;

export function isAssignable(w: {
  status: WorkerStatus;
  active: boolean;
}): boolean {
  return w.status === 'VERIFIED' && w.active;
}
