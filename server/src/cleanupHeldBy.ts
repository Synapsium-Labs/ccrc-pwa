/**
 * The registry rows that hold a cleanup (cleanup un-wedge R2, spec 2026-11-04 §4.3). Ring L1, context C4: pure, no
 * I/O. It imports L0 (`shared/api.ts`) and one L1 predicate, `expiryReportStands` (`archivedExpiry.ts`, which imports
 * `heldByRowsOf` from here: a cycle of function references only, neither module calls the other at load).
 *
 * ccd's rows rung adds `heldBy` and `heldByOwn` to each of the reclaim, expiry and collect audit documents. This file
 * reads that pair (`heldByOf`), composes one item per holding row with the sentence that says what to do about it
 * (`cleanupHeldBy`), decides the row's one control (`cleanupHeldByAct`), and folds the children that only those rows
 * hold into the row's line (`withCleanupHeldBy`).
 */
import { HELD_BY_WORDS } from '../../shared/api.js';
import { expiryReportStands, type ExpiryReport } from './archivedExpiry.js';
import type {
  ChildReclaimAttention, CleanupHeldByAct, CleanupHeldByItem, CoordStatus, ExpiryAttention, FleetSession, HeldByWord,
  LcRefusalToken,
} from '../../shared/api.js';

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

/** What a lane parser spreads onto its read: `{ heldBy }` only when the document NAMES rows, else nothing. Every other
 *  answer (absent, not-reached, none, malformed) contributes no item and folds nothing, exactly as no read does, so a
 *  read without rows keeps the shape it had before R2. */
export function heldByRowsOf(doc: unknown): { readonly heldBy?: HeldByRead } {
  const read = heldByOf(doc);
  return read.kind === 'rows' ? { heldBy: read } : {};
}

/** True when the read names at least one row and says the child has no fault of its own: the one case whose item
 *  folds into the rows' lines. */
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

/** The real pace (review 1580 F1, ruling 1): a pass asks a held child only once its own backoff has run, which is
 *  minutes for a new hold and, on the persistent tier, up to four hours. Nothing resets that backoff. */
const HELD_PACE = 'within minutes for a new hold, and up to four hours for children that have been failing a long time';

/** Where the fleet state stands on a row: listed (then its workspace decides), no longer listed (a row ccd has purged,
 *  often one just forgotten), or no fleet frame read yet. Each gets its own words (review 1580 F2, ruling 2). */
type FleetStanding = 'listed' | 'missing' | 'unframed';

const STANDING_REMEDY: Record<Exclude<FleetStanding, 'listed'>, string> = {
  missing: `This row is no longer registered. The line clears as each child it held is checked again, ${HELD_PACE}.`,
  unframed: 'This row\'s state in the fleet has not been read yet, and nothing is offered for it until it is. ' + RECHECK_TAIL,
};

/** One entry per word; a missing word is a compile error. */
const HELD_BY_SENTENCE: Record<HeldByWord, SentenceParts> = {
  'gone-unrecorded': {
    found: 'Its folder is gone with no record, or a directory or link on its path cannot be searched.',
    remedy: (act) => act === 'forget'
      ? `Forgetting the row removes only its registry entry. The cleanup it blocked goes ahead, wherever no other row still holds it, when ccrc next checks the children this row holds: ${HELD_PACE}.`
      : 'This row is a workspace, or its workspace field could not be read, so only a person removes it, once its session has ended. Where git still records it, use the scoped `git -C <main> worktree remove <path>`, never a repo-wide prune. If a directory on its path only cannot be searched, make it searchable, or restore a link on its path to its original target. '
        + RECHECK_TAIL,
  },
  'not-plain': {
    found: 'This row\'s workdir is spelled in a way ccd will not trust.',
    remedy: () => 'Restart its session so that `ccd start` stores a plain absolute workdir, restore a link whose target opens with // to its original target, or purge the row once its session has ended; never replace a link to clear this. ' + RECHECK_TAIL,
  },
  'under-proc': {
    found: 'This row\'s workdir is under /proc, so a running process may still use it.',
    remedy: () => 'ccrc never stops that process. Stop and start the session from a plain path. ' + RECHECK_TAIL,
  },
  'workdir-unreadable': {
    found: 'This row\'s workdir record in the registry cannot be read (unreadable, or a link).',
    remedy: () => 'Purge the row once its session has ended, or restore the record to a readable regular file. ' + RECHECK_TAIL,
  },
  'entry-pending': {
    found: 'This row\'s session began a spawn that never recorded where its pane entered.',
    remedy: () => 'Stop and start that session. ' + RECHECK_TAIL,
  },
  'entry-unmeasured': {
    found: 'The record of where this row\'s session entered is not a regular file or cannot be read.',
    remedy: () => 'Remove what stands at that field, then stop and start that session. ' + RECHECK_TAIL,
  },
  'entry-moved': {
    found: 'This row\'s session entered a directory other than the one its workdir names now, and where it entered can no longer be placed.',
    remedy: () => 'Stop and start that session. ' + RECHECK_TAIL,
  },
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One item per holding row, sorted by row id. Only `rows` reads contribute. A row named with several words takes the
 *  first in table order and its sentence names the others. `forget` is offered only when every read naming the row says
 *  `absent` and `cleanupHeldByAct` agrees. `fleetWorkspaceOf` answers a listed row's workspace (`null` for none) or
 *  `undefined` for a row the fleet state no longer lists; it is itself `null` while no fleet frame has been read. */
export function cleanupHeldBy(
  inputs: readonly CleanupHeldByInput[], fleetWorkspaceOf: ((rowId: string) => string | null | undefined) | null,
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
    const fleetWs = fleetWorkspaceOf === null ? undefined : fleetWorkspaceOf(rowId);
    const standing: FleetStanding = fleetWorkspaceOf === null ? 'unframed' : fleetWs === undefined ? 'missing' : 'listed';
    const act = cleanupHeldByAct(word, e.allAbsent ? 'absent' : null, fleetWs);
    const holds = { reclaim: e.subjects.reclaim.size, expire: e.subjects.expire.size, collect: e.subjects.collect.size };
    const parts = HELD_BY_SENTENCE[word];
    const others = sorted.slice(1);
    const also = others.length === 0 ? '' : ` Other lanes also found it as ${others.join(', ')}.`;
    const counts = `It holds ${plural(holds.reclaim, 'child workspace', 'child workspaces')}, `
      + `${plural(holds.expire, 'archived workspace', 'archived workspaces')} and `
      + `${plural(holds.collect, 'temp root', 'temp roots')} from being cleaned up.`;
    const remedy = standing === 'listed' ? parts.remedy(act) : STANDING_REMEDY[standing];
    return { rowId, word, sentence: `${parts.found}${also} ${counts} ${remedy}`, holds, act };
  });
}

/** The three lanes' latest reads, keyed by session id (or temp root). The expiry lane's entries carry their report too:
 *  an item whose report stands is never folded (review 1580 F5). */
export interface HeldByLanes {
  readonly reclaim: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
  readonly expire: ReadonlyMap<string, { readonly heldBy?: HeldByRead; readonly report?: ExpiryReport | null }>;
  readonly collect: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
}

/** Adds `cleanupHeldBy` (omitted while no row holds) and folds the items it replaces: a reclaim `failing` or `stuck`
 *  item with token `probe-unmeasured`, and an expiry `failing` item whose lane report does not stand (a standing `stuck`
 *  or persistent-tier report is the record of a part-cleaned row, so it stays), whose child is held only by listed rows.
 *  Every other item stays, in order. */
export function withCleanupHeldBy(
  status: CoordStatus, lanes: HeldByLanes, fleet: readonly Pick<FleetSession, 'id' | 'workspace'>[] | null,
): CoordStatus {
  const inputs: CleanupHeldByInput[] = [];
  for (const lane of ['reclaim', 'expire', 'collect'] as const) {
    for (const [subject, entry] of lanes[lane]) if (entry.heldBy !== undefined) inputs.push({ lane, subject, read: entry.heldBy });
  }
  const ws = new Map<string, string | null>();
  if (fleet !== null) for (const s of fleet) ws.set(s.id, s.workspace);
  const items = cleanupHeldBy(inputs, fleet === null ? null : (id) => ws.get(id));
  const keepReclaim = (a: ChildReclaimAttention): boolean => {
    if ((a.kind !== 'failing' && a.kind !== 'stuck') || a.token !== PROBE_UNMEASURED) return true;
    return !heldOnlyByListed(lanes.reclaim.get(a.sessionId)?.heldBy);
  };
  const keepExpiry = (a: ExpiryAttention): boolean => {
    if (a.kind !== 'failing') return true;
    const entry = lanes.expire.get(a.sessionId);
    return expiryReportStands(entry?.report ?? null) || !heldOnlyByListed(entry?.heldBy);
  };
  return {
    ...status,
    childReclaimAttention: status.childReclaimAttention.filter(keepReclaim),
    ...(status.expiryAttention ? { expiryAttention: status.expiryAttention.filter(keepExpiry) } : {}),
    // OMITTED while no row holds, never `[]`: a frame with nothing held is byte-identical to the frame before R2, so the
    // byte-equality guard emits nothing new and every reader of today's frame sees today's frame. The PWA's one reader
    // reads absence as no items (the `childReclaimDoneAt` precedent).
    ...(items.length === 0 ? {} : { cleanupHeldBy: items }),
  };
}
