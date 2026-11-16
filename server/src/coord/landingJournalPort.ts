// Landing order, wave 5f (shared contract §2): the authority journal's port, ring L2, context C4. The consumer (the
// store's guarded landing entrances) declares it; `landingJournal.ts` (L3) implements it. Type-only imports.
// The snapshot is opaque and adapter-owned: the consumer releases it in `finally`, releasing is idempotent and writes
// nothing, and no FD, path, Buffer or string a caller could substitute is ever part of it.
import type { LandingJournalRecord } from '../../../shared/landingLine.js';

export interface LandingJournalSnapshot { release(): void }
export type LandingJournalIoFailure =
  | 'unreadable' | 'changed' | 'unwritable' | 'durability';
export type LandingJournalRead =
  | { ok: true; kind: 'absent'; snapshot: LandingJournalSnapshot }
  | { ok: true; kind: 'present'; text: string; snapshot: LandingJournalSnapshot }
  | { ok: false; error: 'unreadable' };
export interface LandingJournalPort {
  read(): LandingJournalRead;
  confirmDurable(snapshot: LandingJournalSnapshot):
    { ok: true } | { ok: false; error: 'unreadable' | 'changed' | 'durability' };
  append(snapshot: LandingJournalSnapshot, record: LandingJournalRecord):
    { ok: true }
    | { ok: false; error: LandingJournalIoFailure; mayApply: true };
}
