/**
 * The archive door's ADMISSION (ARCH-36, #559; the `server.ts` template of the DECIDE epic): the gates
 * `POST /api/sessions/:id/archive` runs in front of its first measurement, as data and one decider. L1: no fs, no
 * fastify, no clock. The route supplies probes (what it can read); this file owns WHICH gate is asked next and WHICH
 * word a failed one answers, so a gate is a row here, never an `if` in the handler.
 *
 * THE ORDER IS THE CONTRACT (`ARCHIVE_GATES`), and each gate asks nothing beyond what an earlier gate let through:
 * the id's shape before any registry read, the registry's LISTING before the id is looked up (a registry that did not
 * list is `registry-unmeasurable`, never folded into `unknown-session`, D-5971), the id before the body, the body
 * before the row is read, and the row's identity last, before the turn read, the claim reads and the programme's end,
 * so a refused part ends nothing, stops nothing and composes no argv. `decideArchive` (archiveDoor.ts) takes over once
 * the door is admitted.
 *
 * Extensible by a row: a new precondition is one gate name in `ARCHIVE_GATES`, one probe and one line in `admitArchive`
 * at its place in the order, and one row in `archive-admission.test.ts`'s table.
 */
import type { RouteRefusal } from '../../../shared/refusal.js';
import { archiveFlags, type ArchiveFlags } from './archiveDoor.js';

/** The gates, in the order they are asked. */
export const ARCHIVE_GATES = ['id-shape', 'registry-listing', 'known-id', 'body', 'registry-row', 'identity'] as const;
export type ArchiveGate = (typeof ARCHIVE_GATES)[number];

/** What reading the session's registry row answered, keyed by what it could not do (`readSessionRecord`'s arms). */
export type AdmissionRecordRead<R> =
  | { readonly kind: 'found'; readonly record: R }
  | { readonly kind: 'unlistable' | 'absent' | 'bad-id' };

/** What the route can read. Each probe is asked at most once, and only when every earlier gate passed. */
export interface ArchiveAdmissionProbes<R, I> {
  idSafe(id: string): boolean;
  /** The registry directory lists at all. */
  registryListed(): Promise<boolean>;
  /** The registry names this id. */
  known(): Promise<boolean>;
  readRecord(): Promise<AdmissionRecordRead<R>>;
  /** The row's identity fields; `null` when one was not measured (never guessed at: the stop argv recomputes from them). */
  identityOf(record: R): I | null;
  /** `/stop`'s pair-part refusal (`stopPairRefused`). */
  pairRefused(record: R, identity: I): boolean;
}

export type ArchiveAdmission<R, I> =
  | { readonly ok: true; readonly flags: ArchiveFlags; readonly record: R; readonly identity: I }
  | { readonly ok: false; readonly gate: ArchiveGate; readonly word: RouteRefusal };

/** The word each unreadable row arm answers. An arm masked by `known-id` (`bad-id`, `absent` between two reads) answers
 *  its request-shape word all the same. */
const RECORD_WORD: Readonly<Record<'unlistable' | 'absent' | 'bad-id', RouteRefusal>> = {
  unlistable: 'registry-unmeasurable', absent: 'unknown-session', 'bad-id': 'bad-session-id',
};

const refused = (gate: ArchiveGate, word: RouteRefusal): { ok: false; gate: ArchiveGate; word: RouteRefusal } =>
  ({ ok: false, gate, word });

export async function admitArchive<R, I>(
  id: string, rawBody: unknown, p: ArchiveAdmissionProbes<R, I>,
): Promise<ArchiveAdmission<R, I>> {
  if (!p.idSafe(id)) return refused('id-shape', 'bad-session-id');
  if (!(await p.registryListed())) return refused('registry-listing', 'registry-unmeasurable');
  if (!(await p.known())) return refused('known-id', 'unknown-session');
  const flags = archiveFlags(rawBody);
  if (flags === null) return refused('body', 'bad-request');
  const read = await p.readRecord();
  if (read.kind !== 'found') return refused('registry-row', RECORD_WORD[read.kind]);
  const identity = p.identityOf(read.record);
  if (identity === null || p.pairRefused(read.record, identity)) return refused('identity', 'registry-unmeasurable');
  return { ok: true, flags, record: read.record, identity };
}
