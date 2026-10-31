import {
  assertAllChecksPass,
  assertCanDecide,
  assertReadyForVerification,
  workerChecklist,
  type WorkerProfileFacts,
} from './worker-profile.js';

const complete: WorkerProfileFacts = {
  fullName: 'Diane Uwase',
  dateOfBirth: new Date('1994-06-12'),
  languages: ['RW', 'EN'],
  categories: ['COOKING', 'CLEANING'],
  phone: '+250790002210',
  district: 'Gasabo',
  sector: 'Kimironko',
  idType: 'NATIONAL_ID',
  idNumber: '1199470012345012',
  nextOfKinName: 'Emmanuel Uwase',
  nextOfKinPhone: '+250788111222',
  payoutMsisdn: '+250790002210',
  payoutBankName: null,
  payoutBankAccount: null,
  documents: ['PHOTO', 'ID_FRONT', 'ID_BACK'],
};

describe('worker profile rules', () => {
  it('is complete when every section is filled', () => {
    expect(workerChecklist(complete).every((i) => i.done)).toBe(true);
    expect(() => assertReadyForVerification(complete)).not.toThrow();
  });

  it('reports what is missing, like the design', () => {
    const list = workerChecklist({
      ...complete,
      documents: ['PHOTO', 'ID_FRONT'],
      nextOfKinPhone: null,
    });
    expect(list.find((i) => i.key === 'identity')).toMatchObject({
      done: false,
      missing: 'ID back',
    });
    expect(list.find((i) => i.key === 'nextOfKin')).toMatchObject({
      done: false,
      missing: 'phone',
    });
    expect(() =>
      assertReadyForVerification({ ...complete, nextOfKinPhone: null }),
    ).toThrow(expect.objectContaining({ code: 'profile_incomplete' }));
  });

  it('needs only the front of a passport', () => {
    const passport = {
      ...complete,
      idType: 'PASSPORT' as const,
      documents: ['PHOTO', 'ID_FRONT'] as WorkerProfileFacts['documents'],
    };
    expect(
      workerChecklist(passport).find((i) => i.key === 'identity')?.done,
    ).toBe(true);
  });

  it('accepts a bank account instead of MoMo for payouts', () => {
    const bank = {
      ...complete,
      payoutMsisdn: null,
      payoutBankName: 'Bank of Kigali',
      payoutBankAccount: '00012345',
    };
    expect(workerChecklist(bank).find((i) => i.key === 'payout')?.done).toBe(
      true,
    );
  });

  it('needs a second admin to decide', () => {
    const pending = {
      status: 'PENDING_VERIFICATION' as const,
      createdById: 'admin-1',
    };
    expect(() => assertCanDecide(pending, 'admin-1')).toThrow(
      expect.objectContaining({ code: 'second_admin_required' }),
    );
    expect(() => assertCanDecide(pending, 'admin-2')).not.toThrow();
    expect(() =>
      assertCanDecide({ ...pending, status: 'DRAFT' }, 'admin-2'),
    ).toThrow(expect.objectContaining({ code: 'not_pending' }));
  });

  it('needs every ID check ticked to verify', () => {
    expect(() =>
      assertAllChecksPass({
        fullName: true,
        dateOfBirth: true,
        idNumber: true,
        photo: false,
        reference: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'checks_incomplete' }));
    expect(() =>
      assertAllChecksPass({
        fullName: true,
        dateOfBirth: true,
        idNumber: true,
        photo: true,
        reference: true,
      }),
    ).not.toThrow();
  });
});
