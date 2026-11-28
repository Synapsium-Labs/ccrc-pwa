// The act journal's head-signing lane, one pass (Overlord spec §7.6 H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-act-journal.md` Task A3). Ring L4, context C5: it gathers (today's head row, the journal's verified head, the isolation word,
// the approvals switch, the key) and acts (one row through the store's one writer, or one warn line); every decision is
// `overlordActHead.ts`'s (L1). The cadence is the `actHeadSign` row of the lane schedule's table, run by the watcher: no timer of its
// own. Its day is the digest's own (`digestDayFor`), so the digest reads the same day's head.
//
// IDS AND WORDS ONLY in what it writes and logs: a day, a sequence, a journal id, a digest, a signature, an unsigned word, and a
// warn line naming a verdict word. Never a record's field.
import type { DatabaseSync } from 'node:sqlite';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { ActHeadReadWire } from '../../../shared/actJournalHead.js';
import type { ApprovalSigner } from './approvalsign.js';
import { actHeadLanePlan, actHeadSignVerdict, digestAtSequence, type ActHeadLaneFile, type ActHeadLanePlan } from './overlordActHead.js';
import { actHeadForDay, newestActHead, recordActHeadInTx } from './overlordActHeadStore.js';
import type { ActFileRead } from './overlordActJournal.js';

/** What the head read gathers: the database, the journal, and the key's public half (null when the key could not be loaded). */
export interface ActHeadReadDeps {
  readonly db: () => DatabaseSync | null;
  readonly journal: { readVerified(): ActFileRead };
  readonly publicKeyPem: () => string | null;
}

/** `GET /api/overlord/act-head`'s answer, or why it could not be made (the door answers 503 `unavailable` naming it). The file
 *  is read only when `at` was asked. */
export function readActHeadAnswer(deps: ActHeadReadDeps, at: number | null): { readonly ok: true; readonly wire: ActHeadReadWire } | { readonly ok: false; readonly why: string } {
  const db = deps.db();
  if (db === null) return { ok: false, why: 'this server has no coordination store' };
  const newest = newestActHead(db);
  if (newest.kind === 'unmeasured') return { ok: false, why: 'the recorded heads could not be read' };
  const head = newest.value === 'absent' ? 'absent' as const
    : { day: newest.value.day, sequence: newest.value.sequence, journalId: newest.value.journalId, digest: newest.value.digest,
      signature: newest.value.signature, unsigned: newest.value.unsigned };
  return { ok: true, wire: { v: 1, head, publicKeyPem: deps.publicKeyPem(), at: at === null ? null : { sequence: at, digest: digestAtSequence(deps.journal.readVerified(), at) } } };
}

export interface ActHeadLaneDeps {
  /** The coordination database, or null on a server without one (no pass then). */
  readonly db: () => DatabaseSync | null;
  readonly journal: { readVerified(): ActFileRead };
  /** The server's one signing key, loaded once; null when it could not be loaded. */
  readonly signer: () => Pick<ApprovalSigner, 'signActHead'> | null;
  readonly isolation: () => IsolationRead;
  readonly approvalsDisabled: () => boolean;
  /** The digest's day for `now` (`digestDayFor` at the digest hour). */
  readonly dayOf: (now: number) => string;
  readonly warn: (line: string) => void;
}

/** What one pass did: the plan, and for a record whether the row was written (a concurrent pass's row is kept). */
export type ActHeadPass = { readonly plan: ActHeadLanePlan | { readonly kind: 'skipped' }; readonly written?: boolean };

const fileOf = (r: ActFileRead): ActHeadLaneFile => {
  if (r.kind === 'absent') return { kind: 'empty' };
  if (r.kind === 'unmeasured') return { kind: 'unverified', why: 'unreadable' };
  if (r.kind === 'malformed') return { kind: 'unverified', why: `malformed (${r.code})` };
  if (r.tail !== null) return { kind: 'unverified', why: 'a torn tail' };
  const last = r.records[r.records.length - 1];
  return last === undefined ? { kind: 'empty' } : { kind: 'head', sequence: last.sequence, journalId: last.journalId, digest: last.digest };
};

/** One beat. Never throws: a failure is one warn line, and the next beat tries again. */
export function runActHeadSignPass(deps: ActHeadLaneDeps, now: number): ActHeadPass {
  try {
    const db = deps.db();
    if (db === null) return { plan: { kind: 'skipped' } };
    const day = deps.dayOf(now);
    const todayRead = actHeadForDay(db, day);
    const today = todayRead.kind === 'unmeasured' ? { unmeasured: todayRead.why } : todayRead.value === 'absent' ? 'absent' as const : 'present' as const;
    let head: ActHeadLaneFile = { kind: 'empty' };
    const plan = actHeadLanePlan({
      today,
      file: () => (head = fileOf(deps.journal.readVerified())),
      verdict: () => actHeadSignVerdict({ isolation: deps.isolation(), approvalsDisabled: deps.approvalsDisabled(), keyAvailable: deps.signer() !== null }),
    });
    if (plan.kind === 'warn') deps.warn(`ccrc-server: the act journal's head for ${day} was not recorded (${plan.why}); the next beat tries again`);
    if (plan.kind !== 'record' || head.kind !== 'head') return { plan };
    const h = { day, sequence: head.sequence, journalId: head.journalId, digest: head.digest };
    const signature = plan.verdict.sign ? deps.signer()?.signActHead(h) ?? null : null;
    const unsigned = plan.verdict.sign ? (signature === null ? 'key-unavailable' : null) : plan.verdict.unsigned;
    const { written } = recordActHeadInTx(db, { ...h, signature, unsigned, at: now });
    return { plan, written };
  } catch (err) {
    deps.warn(`ccrc-server: the act journal's head-signing pass failed (${err instanceof Error ? err.name : 'error'}); the next beat tries again`);
    return { plan: { kind: 'warn', why: 'the pass threw' } };
  }
}
