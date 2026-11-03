// Landing order, wave 5f (shared contract §3): the authority journal's ONE strict parser, ring L1, context C4. Pure:
// no `node:*`, no fs, no clock. The adapter (`landingJournal.ts`) reads the whole file and hands its text here; nothing
// else interprets `landing.log`. Framing is the kernel's (`journalKernel.ts#splitJournalRecords`, called once); this
// file never splits on a newline itself.
//
// The whole file is validated, the applied prefix included, before any record is returned, and the first violation in
// FILE ORDER answers. Within one record the checks run in a fixed order: JSON, version, kind, fields, sequence, then
// historical identity. A torn final record is judged after every complete record before it. No branch salvages, skips,
// truncates or rewrites: a history that cannot be read in full is not read.
//
// Names are "nonblank and already trimmed"; the tree has no shared validator for a project or caller name (the docs
// reader's project grammar is its own route's), and the contract forbids a new registry-name grammar here.
import type {
  LandingHistoricalBinding, LandingJournalInvalidReason, LandingJournalRecord, LandingSubjectRef,
} from '../../../shared/landingLine.js';
import { splitJournalRecords } from '../journalKernel.js';

export type LandingJournalParse =
  | { ok: true; records: LandingJournalRecord[]; lastSeq: number }
  | { ok: false; reason: LandingJournalInvalidReason; record: number | null };

const MAX = Number.MAX_SAFE_INTEGER;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasExactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
};
const isPositiveSafe = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= MAX;
const isNonnegativeSafe = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isName = (v: unknown): v is string => typeof v === 'string' && v !== '' && v === v.trim();
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

function readBinding(v: unknown): LandingHistoricalBinding | null {
  if (!isRecord(v)) return null;
  if (v.kind === 'no-run') return hasExactKeys(v, ['kind']) ? { kind: 'no-run' } : null;
  if (v.kind === 'run') {
    return hasExactKeys(v, ['kind', 'observedRunId']) && isPositiveSafe(v.observedRunId)
      ? { kind: 'run', observedRunId: v.observedRunId } : null;
  }
  return null;
}

function readSubject(v: unknown): LandingSubjectRef | null {
  if (!isRecord(v) || !hasExactKeys(v, ['id', 'project', 'pr', 'binding'])) return null;
  if (!isPositiveSafe(v.id) || !isName(v.project) || !isPositiveSafe(v.pr)) return null;
  const binding = readBinding(v.binding);
  return binding === null ? null : { id: v.id, project: v.project, pr: v.pr, binding };
}

type Shaped =
  | { ok: true; record: LandingJournalRecord }
  | { ok: false; reason: 'version' | 'kind' | 'fields' };

/** One parsed JSON value to a record: version, then kind, then the exact field shape. */
function shape(doc: unknown): Shaped {
  if (!isRecord(doc)) return { ok: false, reason: 'fields' };
  if (doc.v !== 1) return { ok: false, reason: 'version' };
  if (doc.kind !== 'entry' && doc.kind !== 'order') return { ok: false, reason: 'kind' };
  const fields = doc.kind === 'entry'
    ? ['v', 'seq', 'at', 'setBy', 'subject', 'kind', 'claim']
    : ['v', 'seq', 'at', 'setBy', 'subject', 'kind', 'after', 'fixesMain'];
  if (!hasExactKeys(doc, fields)) return { ok: false, reason: 'fields' };
  if (!isPositiveSafe(doc.seq) || !isNonnegativeSafe(doc.at) || !isName(doc.setBy)) return { ok: false, reason: 'fields' };
  const subject = readSubject(doc.subject);
  if (subject === null) return { ok: false, reason: 'fields' };
  const head = { v: 1 as const, seq: doc.seq, at: doc.at, setBy: doc.setBy, subject };
  if (doc.kind === 'entry') {
    const c = doc.claim;
    if (!isRecord(c) || !hasExactKeys(c, ['pinnedSha', 'handoffCommit']) || !isHash(c.pinnedSha) || !isHash(c.handoffCommit)) {
      return { ok: false, reason: 'fields' };
    }
    if (subject.binding.kind !== 'no-run') return { ok: false, reason: 'fields' };
    return { ok: true, record: { ...head, kind: 'entry', claim: { pinnedSha: c.pinnedSha, handoffCommit: c.handoffCommit } } };
  }
  if (!Array.isArray(doc.after) || typeof doc.fixesMain !== 'boolean') return { ok: false, reason: 'fields' };
  const after: LandingSubjectRef[] = [];
  const seen = new Set<number>();
  for (const raw of doc.after) {
    const ref = readSubject(raw);
    if (ref === null || ref.project !== subject.project || ref.id === subject.id || seen.has(ref.id)) {
      return { ok: false, reason: 'fields' };
    }
    seen.add(ref.id);
    after.push(ref);
  }
  return { ok: true, record: { ...head, kind: 'order', after, fixesMain: doc.fixesMain } };
}

/** Every identity the history has named, both ways: ID to its project and PR, and project and PR to its ID. */
class Identities {
  private readonly byId = new Map<number, string>();
  private readonly byKey = new Map<string, number>();
  private static key(project: string, pr: number): string { return JSON.stringify([project, pr]); }
  has(id: number): boolean { return this.byId.has(id); }
  /** `false` when this mention contradicts the history (one ID, two keys, or one key, two IDs). */
  mention(ref: LandingSubjectRef): boolean {
    const key = Identities.key(ref.project, ref.pr);
    const knownKey = this.byId.get(ref.id);
    const knownId = this.byKey.get(key);
    if (knownKey !== undefined && knownKey !== key) return false;
    if (knownId !== undefined && knownId !== ref.id) return false;
    this.byId.set(ref.id, key);
    this.byKey.set(key, ref.id);
    return true;
  }
}

/** The journal's one parse. Total over every string; never throws. */
export function parseLandingJournal(text: string): LandingJournalParse {
  if (text === '') return { ok: false, reason: 'empty', record: null };
  const framed = splitJournalRecords(text);
  const records: LandingJournalRecord[] = [];
  const identities = new Identities();
  for (let i = 0; i < framed.records.length; i += 1) {
    const position = i + 1;
    const raw = framed.records[i]!;
    if (raw.trim() === '') return { ok: false, reason: 'blank', record: position };
    let doc: unknown;
    try { doc = JSON.parse(raw); } catch { return { ok: false, reason: 'json', record: position }; }
    const shaped = shape(doc);
    if (!shaped.ok) return { ok: false, reason: shaped.reason, record: position };
    const rec = shaped.record;
    if (rec.seq !== position) return { ok: false, reason: 'sequence', record: position };
    // An entry introduces an identity never mentioned before; every mention must agree with the history.
    if (rec.kind === 'entry' && identities.has(rec.subject.id)) return { ok: false, reason: 'identity', record: position };
    if (!identities.mention(rec.subject)) return { ok: false, reason: 'identity', record: position };
    if (rec.kind === 'order') {
      for (const ref of rec.after) {
        if (!identities.mention(ref)) return { ok: false, reason: 'identity', record: position };
      }
    }
    records.push(rec);
  }
  // A non-empty tail is the final record with no newline: torn, at the position after the complete ones.
  if (framed.tail !== '') return { ok: false, reason: 'torn', record: framed.records.length + 1 };
  return { ok: true, records, lastSeq: records.length };
}
