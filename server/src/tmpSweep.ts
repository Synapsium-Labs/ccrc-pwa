// D-6624 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.1 and §2.1.1; plan Task DR-12). L1:
// pure, clock-free and `fs`-free; it imports L0 alone. What the server makes of the tmp sweep's census
// (`~/.ccrc/tmp-sweep.json`, which `ccd/ccd-tmp-sweep` replaces whole each pass and nothing else writes): the ONE
// reader, the receipts a session is mailed for what the sweep moved, the budget notice sent once per over-budget
// episode, and the "who is growing" holders. The lane that reads the file and queues the mail is `tmpSweepLane.ts`.
//
// EVERY UNCERTAIN ANSWER IS "UNMEASURED": a census that is not exactly the shape the sweep writes reads as `null`, so a
// half-written or foreign file never looks like an empty, healthy fleet. A notice or a receipt names only what the
// census states; it decides nothing about a deletion (the sweep's own rules and its marker do that).
import type { DiskHolder } from '../../shared/disk.js';
import { MAIL_BODY_MAX_BYTES } from '../../shared/api.js';

/** The grace before a quarantined entry is deleted, and the span a receipt tells the session it has to move it back:
 *  24 hours, one hour under pressure (the sweep's own `GRACE`, restated only as the words a session reads). */
export const TMP_QUARANTINE_GRACE_MS = 24 * 3_600_000;
export const TMP_QUARANTINE_GRACE_PRESSURE_MS = 3_600_000;
/** How many of a session's largest entries a budget notice names. */
export const TMP_NOTICE_TOP = 5;
/** How many sessions `disk.holders` names. */
export const TMP_HOLDERS_MAX = 5;
/** The census is bigger than the inventory's node files (a thousand `moved` rows), so its read has its own cap. */
export const TMP_SWEEP_CENSUS_CAP_BYTES = 1024 * 1024;

export interface TmpSweepMoved {
  readonly seq: number;
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly kind: string;
  readonly bytes: number;
  readonly at: number;
  readonly shadow: boolean;
  readonly quarantine: string | null;
}

export interface TmpSweepBudgetState {
  readonly state: string;
  readonly overSince: number | null;
  readonly enforceAt: number | null;
  readonly removedBytes: number;
  readonly kept: readonly { readonly name: string; readonly why: string }[];
}

export interface TmpSweepSession {
  readonly id: string;
  readonly uuid: string;
  readonly bytes: number;
  readonly budget: TmpSweepBudgetState;
  /** The session's largest top-level entries, when the writer carries them. Optional on the wire: absent reads `[]`. */
  readonly top: readonly { readonly name: string; readonly bytes: number }[];
}

export interface TmpSweepCensus {
  readonly v: 1;
  readonly at: number;
  readonly pressure: boolean;
  readonly arm: 'shadow' | 'live';
  readonly seq: number;
  readonly sessions: readonly TmpSweepSession[];
  readonly moved: readonly TmpSweepMoved[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseMoved(v: unknown): TmpSweepMoved | null {
  if (!isObj(v)) return null;
  const { seq, id, uuid, name, kind, bytes, at, shadow, quarantine } = v;
  if (!nat(seq) || !str(id) || !str(uuid) || !str(name) || !str(kind) || !nat(bytes) || !nat(at) || typeof shadow !== 'boolean') return null;
  if (quarantine !== null && quarantine !== undefined && typeof quarantine !== 'string') return null;
  return { seq, id, uuid, name, kind, bytes, at, shadow, quarantine: typeof quarantine === 'string' ? quarantine : null };
}

function parseBudget(v: unknown): TmpSweepBudgetState | null {
  if (!isObj(v)) return null;
  const { state, overSince, enforceAt, removedBytes, kept } = v;
  if (!str(state)) return null;
  if (overSince !== null && !nat(overSince)) return null;
  if (enforceAt !== null && !nat(enforceAt)) return null;
  if (!nat(removedBytes) || !Array.isArray(kept)) return null;
  const keptRows: { name: string; why: string }[] = [];
  for (const k of kept) {
    if (!isObj(k) || !str(k['name']) || !str(k['why'])) return null;
    keptRows.push({ name: k['name'], why: k['why'] });
  }
  return { state, overSince: overSince as number | null, enforceAt: enforceAt as number | null, removedBytes, kept: keptRows };
}

function parseSession(v: unknown): TmpSweepSession | null {
  if (!isObj(v)) return null;
  const { id, uuid, bytes } = v;
  if (!str(id) || !str(uuid) || !nat(bytes)) return null;
  const budget = parseBudget(v['budget']);
  if (budget === null) return null;
  const top: { name: string; bytes: number }[] = [];
  const rawTop = v['top'];
  if (rawTop !== undefined) {
    if (!Array.isArray(rawTop)) return null;
    for (const t of rawTop) {
      if (!isObj(t) || !str(t['name']) || !nat(t['bytes'])) return null;
      top.push({ name: t['name'], bytes: t['bytes'] });
    }
  }
  return { id, uuid, bytes, budget, top };
}

/** The ONE reader of the census. `null` for anything that is not exactly its shape (the whole file, not a salvaged
 *  part: a census one row of which cannot be read is one that was not written whole). */
export function parseTmpSweepCensus(text: string): TmpSweepCensus | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObj(raw) || raw['v'] !== 1 || !nat(raw['at']) || typeof raw['pressure'] !== 'boolean') return null;
  const arm = raw['arm'];
  if (arm !== 'shadow' && arm !== 'live') return null;
  if (!nat(raw['seq']) || !Array.isArray(raw['sessions']) || !Array.isArray(raw['moved'])) return null;
  const sessions: TmpSweepSession[] = [];
  for (const s of raw['sessions']) {
    const p = parseSession(s);
    if (p === null) return null;
    sessions.push(p);
  }
  const moved: TmpSweepMoved[] = [];
  for (const m of raw['moved']) {
    const p = parseMoved(m);
    if (p === null) return null;
    moved.push(p);
  }
  return { v: 1, at: raw['at'], pressure: raw['pressure'], arm, seq: raw['seq'], sessions, moved };
}

const GIB = 1024 ** 3;
/** Bytes as the words a session reads. */
const gib = (bytes: number): string => `${(bytes / GIB).toFixed(1)} GiB`;
const stamp = (ms: number): string => new Date(ms).toISOString();

export interface TmpSweepReceiptMail { readonly toId: string; readonly subject: string; readonly body: string }

const bytesOf = (s: string): number => Buffer.byteLength(s);

/** `lines` while they fit in `limit` bytes (joined by newlines, `used` already spent), then ONE line saying how many
 *  more there are and where the rest is. The overflow line itself is always inside the limit. */
function fitLines(lines: readonly string[], limit: number, used: number): string[] {
  const more = (k: number): string => `and ${k} more entries; the census ~/.ccrc/tmp-sweep.json lists them`;
  const out: string[] = [];
  let spent = used;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const rest = lines.length - i - 1;
    // Keep room for the overflow line unless this is the last one and it fits outright.
    const reserve = rest === 0 ? 0 : bytesOf(more(lines.length)) + 1;
    if (spent + bytesOf(line) + 1 + reserve > limit) {
      out.push(more(lines.length - i));
      return out;
    }
    out.push(line);
    spent += bytesOf(line) + 1;
  }
  return out;
}

/**
 * One mail per session per PASS (every row of one sweep pass carries the same `at`; journal-folded rows keep their
 * pass's), for the NON-SHADOW rows of the census. The pass is in the subject, and the subject is the identity: a re-read
 * or a cold start rebuilds exactly the subjects already sent (the lane's subject check then sends nothing), and a
 * recreated census, whose `seq` restarts, cannot collide with an old pass. `_mailed` (the lane's high-water) is no
 * longer a filter, since `seq` alone cannot tell a recreated census whose seq reaches the old one. Rows whose quarantine time has
 * already passed are not mailed (the entry is gone; telling the session to move it back would be false). `mailed`
 * returns as the census's own `seq`, shadow passes included. The body lists each entry, its size and its quarantine
 * path, the sentence "move it back before <time> to keep it", and the entries the budget kept, with why, within
 * MAIL_BODY_MAX_BYTES; what does not fit is one line pointing at the census.
 */
export function tmpSweepReceipts(census: TmpSweepCensus, _mailed: number): { mails: TmpSweepReceiptMail[]; mailed: number } {
  const grace = census.pressure ? TMP_QUARANTINE_GRACE_PRESSURE_MS : TMP_QUARANTINE_GRACE_MS;
  const byPass = new Map<string, { id: string; at: number; rows: TmpSweepMoved[] }>();
  for (const r of census.moved) {
    if (r.shadow || r.at + grace <= census.at) continue;
    const key = `${r.id}\u0000${r.at}`;
    const g = byPass.get(key);
    if (g === undefined) byPass.set(key, { id: r.id, at: r.at, rows: [r] }); else g.rows.push(r);
  }
  const mails: TmpSweepReceiptMail[] = [];
  for (const { id, at, rows } of byPass.values()) {
    const lo = Math.min(...rows.map((r) => r.seq));
    const hi = Math.max(...rows.map((r) => r.seq));
    const lines = rows.map((r) => `- ${r.kind === 'budget' ? '(budget) ' : ''}${r.name} (${gib(r.bytes)}) -> ${r.quarantine ?? 'no quarantine path'}; ` +
      `move it back before ${stamp(r.at + grace)} to keep it`);
    const kept = (census.sessions.find((s) => s.id === id)?.budget.kept ?? []).map((k) => `- kept ${k.name}: ${k.why}`);
    const head = 'The tmp sweep moved these entries out of your scratch into quarantine:';
    const keptHead = 'The size budget kept these:';
    // Entries get at most three quarters of the body; the kept list takes what is left.
    const rowLines = fitLines(lines, Math.floor(MAIL_BODY_MAX_BYTES * 0.75), bytesOf(head) + 1);
    const used = bytesOf(head) + 1 + rowLines.reduce((n, l) => n + bytesOf(l) + 1, 0);
    const keptLines = kept.length > 0 ? fitLines(kept, MAIL_BODY_MAX_BYTES, used + bytesOf(keptHead) + 1) : [];
    const body = [head, ...rowLines, ...(kept.length > 0 ? [keptHead, ...keptLines] : [])].join('\n');
    mails.push({ toId: id, subject: `tmp-sweep: moved ${rows.length} entries (seq ${lo}-${hi}, pass ${at})`, body });
  }
  return { mails, mailed: census.seq };
}

export interface TmpSweepBudgetNotice {
  readonly sessionId: string;
  /** The episode's identity: the session's uuid and the `overSince` that started it. The lane latches on it. */
  readonly key: string;
  readonly subject: string;
  readonly body: string;
  /** The same words for the session's coordinator, which names the session they are about. */
  readonly coordinatorBody: string;
}

/**
 * One notice per over-budget episode, keyed on the session's `overSince`: `noticed` holds the keys already sent. The
 * notice deletes nothing, so it is sent whether the sweep's arm is shadow or live. It names the total, the largest
 * entries and the instant `enforceAt`; at critical pressure it says enforcement has already begun.
 */
export function tmpSweepBudget(census: TmpSweepCensus, noticed: ReadonlySet<string>): TmpSweepBudgetNotice[] {
  const out: TmpSweepBudgetNotice[] = [];
  for (const s of census.sessions) {
    const { overSince, enforceAt } = s.budget;
    if (overSince === null) continue;
    const key = `${s.uuid}:${overSince}`;
    if (noticed.has(key)) continue;
    const top = [...s.top].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1)).slice(0, TMP_NOTICE_TOP);
    const largest = top.length > 0 ? `Its largest entries: ${top.map((t) => `${t.name} (${gib(t.bytes)})`).join(', ')}. ` : '';
    const when = enforceAt === null ? 'the grace ends' : stamp(enforceAt);
    const begun = census.pressure
      ? 'The disk is at critical pressure, so enforcement has begun: no grace is left. '
      : `After ${when} the sweep removes `;
    const rule = census.pressure
      ? 'The sweep removes entries untouched for 48 hours, oldest first, until the session is under 15 GiB. '
      : 'entries untouched for 48 hours, oldest first, until the session is under 15 GiB. ';
    const body = `Your scratch and task output hold ${gib(s.bytes)}, over the 20 GiB budget. ${largest}${begun}${rule}` +
      'Entries move to quarantine first and can be moved back; delete or move what you no longer need.';
    out.push({
      sessionId: s.id, key, subject: `tmp-sweep: ${s.id} over budget (since ${stamp(overSince)})`, body,
      coordinatorBody: `Session ${s.id}: ${body}`,
    });
  }
  return out;
}

/** `disk.holders` from the census: the five largest sessions, by bytes. `null` (unmeasured) names none. */
export function tmpSweepHolders(census: TmpSweepCensus | null): DiskHolder[] {
  if (census === null) return [];
  return [...census.sessions].sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1)).slice(0, TMP_HOLDERS_MAX)
    .map((s) => ({ label: s.id, bytes: s.bytes }));
}
