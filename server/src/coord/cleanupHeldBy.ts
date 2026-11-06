/**
 * The registry rows that hold a cleanup (cleanup un-wedge R2, spec 2026-11-04 §4.3). Ring L1, context C4: pure, no
 * I/O, and it imports only L0 (`shared/api.ts`).
 *
 * ccd's rows rung adds `heldBy` and `heldByOwn` to each of the reclaim, expiry and collect audit documents. This file
 * reads that pair (`heldByOf`), composes one item per holding row with the sentence that says what to do about it
 * (`cleanupHeldBy`), decides the row's one control (`cleanupHeldByAct`), and folds the children that only those rows
 * hold into the row's line (`withCleanupHeldBy`).
 */
import { HELD_BY_WORDS } from '../../../shared/api.js';
import type {
  ChildReclaimAttention, CleanupHeldByAct, CleanupHeldByItem, CoordStatus, ExpiryAttention, FleetSession, HeldByWord,
  LcRefusalToken,
} from '../../../shared/api.js';

/** ccd's measurement of a holding row's `workspace` registry field: no field, a workspace, or unreadable (or a link). */
export type HeldByWorkspace = 'absent' | 'present' | 'unreadable';

/** One holding row as ccd printed it. `workspace` is null when ccd's word is missing or outside the three. */
export interface HeldByRow { readonly id: string; readonly word: HeldByWord; readonly workspace: HeldByWorkspace | null }

/** What one audit document says about holding rows. `absent` is an older ccd, `not-reached` is a rung that did not
 *  run, `none` is a rung that ran and found no holding row, and `malformed` is a read the server does not trust. `own`
 *  is true when the child also had a fault of its own. */
export type HeldByRead =
  | { readonly kind: 'absent' } | { readonly kind: 'not-reached' } | { readonly kind: 'none' }
  | { readonly kind: 'rows'; readonly rows: readonly HeldByRow[]; readonly own: boolean }
  | { readonly kind: 'malformed' };

/** The one `absent` read. */
export const HELD_BY_ABSENT: HeldByRead = { kind: 'absent' };

const HELD_BY_NOT_REACHED: HeldByRead = { kind: 'not-reached' };
const HELD_BY_NONE: HeldByRead = { kind: 'none' };
const HELD_BY_MALFORMED: HeldByRead = { kind: 'malformed' };
const ROW_ID = /^[A-Za-z0-9._-]+$/;
const WORKSPACE_WORDS: readonly string[] = ['absent', 'present', 'unreadable'];
const PROBE_UNMEASURED: LcRefusalToken = 'probe-unmeasured';

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Reads `heldBy` and `heldByOwn` from a parsed audit document. A missing key is `absent`; one bad member makes the
 *  whole read `malformed`; `own` is everything but an explicit `false`, so an unclear answer fails safe. */
export function heldByOf(doc: unknown): HeldByRead {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || !has(doc, 'heldBy')) return HELD_BY_ABSENT;
  const d = doc as Record<string, unknown>;
  const raw = d['heldBy'];
  if (raw === null) return HELD_BY_NOT_REACHED;
  if (!Array.isArray(raw)) return HELD_BY_MALFORMED;
  if (raw.length === 0) return HELD_BY_NONE;
  const out: HeldByRow[] = [];
  for (const m of raw as unknown[]) {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return HELD_BY_MALFORMED;
    const r = m as Record<string, unknown>;
    const id = r['id'];
    const word = r['word'];
    if (typeof id !== 'string' || !ROW_ID.test(id)) return HELD_BY_MALFORMED;
    if (typeof word !== 'string' || !(HELD_BY_WORDS as readonly string[]).includes(word)) return HELD_BY_MALFORMED;
    const ws = r['workspace'];
    out.push({
      id, word: word as HeldByWord,
      workspace: typeof ws === 'string' && WORKSPACE_WORDS.includes(ws) ? (ws as HeldByWorkspace) : null,
    });
  }
  return { kind: 'rows', rows: out, own: d['heldByOwn'] !== false };
}

/** True when the read names at least one row and says the child has no fault of its own. */
export function heldOnlyByListed(read: HeldByRead | undefined): boolean {
  return read !== undefined && read.kind === 'rows' && read.rows.length > 0 && read.own === false;
}

/** The row's one control. `forget` only for a dead row that is no workspace: ccd says `gone-unrecorded` and `absent`,
 *  and the fleet state lists the row with no workspace (`null`). A row the fleet state does not list (`undefined`), or
 *  one that is a workspace, is `recheck`. */
export function cleanupHeldByAct(
  word: HeldByWord, ccdWorkspace: HeldByWorkspace | null, fleetWorkspace: string | null | undefined,
): CleanupHeldByAct {
  return word === 'gone-unrecorded' && ccdWorkspace === 'absent' && fleetWorkspace === null ? 'forget' : 'recheck';
}

/** The lane an audit document came from. */
export type CleanupHeldByLane = 'reclaim' | 'expire' | 'collect';

/** One audit document's read, with the lane and the subject (session id or temp root) it was read for. */
export interface CleanupHeldByInput { readonly lane: CleanupHeldByLane; readonly subject: string; readonly read: HeldByRead }

interface SentenceParts { readonly found: string; readonly remedy: (act: CleanupHeldByAct) => string }

const RECHECK_TAIL = 'Then check again.';

/** One entry per word; a missing word is a compile error. */
const HELD_BY_SENTENCE: Record<HeldByWord, SentenceParts> = {
  'gone-unrecorded': {
    found: 'This row\'s folder no longer exists, and nothing records where it went.',
    remedy: (act) => act === 'forget'
      ? 'Forgetting the row removes only its registry entry, and the cleanup it blocked goes ahead on the next pass of the lanes.'
      : 'This row is a workspace, or its workspace field could not be read, so only a person removes it. Recreate its tree at its branch tip with `git worktree add`, or, once its session has ended, remove it by hand. Where git still records it, use the scoped `git -C <project> worktree remove <path>`, never a repo-wide prune. '
        + RECHECK_TAIL,
  },
  'not-plain': {
    found: 'This row\'s workdir is spelled in a way ccd will not trust.',
    remedy: () => 'Restart its session so that `ccd start` stores a plain absolute workdir, or purge the row once its session has ended. ' + RECHECK_TAIL,
  },
  'under-proc': {
    found: 'This row\'s workdir is under /proc, so a running process may still use it.',
    remedy: () => 'ccrc never stops that process. Stop and start the session from a plain path. ' + RECHECK_TAIL,
  },
  'workdir-unreadable': {
    found: 'This row\'s workdir cannot be read.',
    remedy: () => 'Make the path readable and searchable, or purge the row once its session has ended. ' + RECHECK_TAIL,
  },
  'entry-pending': {
    found: 'This row\'s session began a spawn that never recorded where its pane entered.',
    remedy: () => 'Stop and start that session. ' + RECHECK_TAIL,
  },
  'entry-unmeasured': {
    found: 'The record of where this row\'s session entered cannot be read.',
    remedy: () => 'Stop and start that session. ' + RECHECK_TAIL,
  },
  'entry-moved': {
    found: 'This row\'s session entered a directory other than the one its workdir names now, and where it entered can no longer be placed.',
    remedy: () => 'Stop and start that session. ' + RECHECK_TAIL,
  },
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One item per holding row, sorted by row id. Only `rows` reads contribute. A row named with several words takes the
 *  first in table order and its sentence names the others. `forget` is offered only when every read naming the row says
 *  `absent` and `cleanupHeldByAct` agrees. */
export function cleanupHeldBy(
  inputs: readonly CleanupHeldByInput[], fleetWorkspaceOf: (rowId: string) => string | null | undefined,
): CleanupHeldByItem[] {
  const byRow = new Map<string, {
    words: Set<HeldByWord>; allAbsent: boolean; subjects: Record<CleanupHeldByLane, Set<string>>;
  }>();
  for (const input of inputs) {
    if (input.read.kind !== 'rows') continue;
    for (const r of input.read.rows) {
      let e = byRow.get(r.id);
      if (!e) {
        e = { words: new Set(), allAbsent: true, subjects: { reclaim: new Set(), expire: new Set(), collect: new Set() } };
        byRow.set(r.id, e);
      }
      e.words.add(r.word);
      if (r.workspace !== 'absent') e.allAbsent = false;
      e.subjects[input.lane].add(input.subject);
    }
  }
  const ids = [...byRow.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids.map((rowId): CleanupHeldByItem => {
    const e = byRow.get(rowId)!;
    const sorted = HELD_BY_WORDS.filter((w) => e.words.has(w));
    const word = sorted[0]!;
    const act = cleanupHeldByAct(word, e.allAbsent ? 'absent' : null, fleetWorkspaceOf(rowId));
    const holds = { reclaim: e.subjects.reclaim.size, expire: e.subjects.expire.size, collect: e.subjects.collect.size };
    const parts = HELD_BY_SENTENCE[word];
    const others = sorted.slice(1);
    const also = others.length === 0 ? '' : ` Other lanes also found it as ${others.join(', ')}.`;
    const counts = `It holds ${plural(holds.reclaim, 'child workspace', 'child workspaces')}, `
      + `${plural(holds.expire, 'archived workspace', 'archived workspaces')} and `
      + `${plural(holds.collect, 'temp root', 'temp roots')} from being cleaned up.`;
    return { rowId, word, sentence: `${parts.found}${also} ${counts} ${parts.remedy(act)}`, holds, act };
  });
}

/** The three lanes' latest reads, keyed by session id (or temp root). */
export interface HeldByLanes {
  readonly reclaim: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
  readonly expire: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
  readonly collect: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
}

/** Adds `cleanupHeldBy` (always present, `[]` when nothing holds) and folds the items it replaces: a reclaim `failing`
 *  or `stuck` item with token `probe-unmeasured`, and an expiry `failing` item, whose child is held only by listed rows.
 *  Every other item stays, in order. */
export function withCleanupHeldBy(
  status: CoordStatus, lanes: HeldByLanes, fleet: readonly Pick<FleetSession, 'id' | 'workspace'>[] | null,
): CoordStatus {
  const inputs: CleanupHeldByInput[] = [];
  for (const lane of ['reclaim', 'expire', 'collect'] as const) {
    for (const [subject, entry] of lanes[lane]) if (entry.heldBy !== undefined) inputs.push({ lane, subject, read: entry.heldBy });
  }
  const ws = new Map<string, string | null>();
  if (fleet) for (const s of fleet) ws.set(s.id, s.workspace);
  const items = cleanupHeldBy(inputs, (id) => ws.get(id));
  const keepReclaim = (a: ChildReclaimAttention): boolean => {
    if ((a.kind !== 'failing' && a.kind !== 'stuck') || a.token !== PROBE_UNMEASURED) return true;
    return !heldOnlyByListed(lanes.reclaim.get(a.sessionId)?.heldBy);
  };
  const keepExpiry = (a: ExpiryAttention): boolean =>
    a.kind !== 'failing' || !heldOnlyByListed(lanes.expire.get(a.sessionId)?.heldBy);
  return {
    ...status,
    childReclaimAttention: status.childReclaimAttention.filter(keepReclaim),
    ...(status.expiryAttention ? { expiryAttention: status.expiryAttention.filter(keepExpiry) } : {}),
    cleanupHeldBy: items,
  };
}
