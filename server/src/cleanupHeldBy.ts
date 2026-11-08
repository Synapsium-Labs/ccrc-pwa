/**
 * The registry rows that hold a cleanup (cleanup un-wedge R2, spec 2026-11-04 §4.3). Ring L1, context C4: pure, no
 * I/O. It imports L0 (`shared/api.ts`) and one L1 predicate, `expiryReportStands` (`archivedExpiry.ts`, which imports
 * `heldByFieldOf` from here: a cycle of function references only, neither module calls the other at load).
 *
 * ccd's rows rung adds `heldBy` and `heldByOwn` to each of the reclaim, expiry and collect audit documents. This file
 * reads that pair (`heldByOf`), composes one item per holding row with the sentence that says what to do about it
 * (`cleanupHeldBy`), decides the row's one control (`cleanupHeldByAct`), and folds the children that only those rows
 * hold into the row's line (`withCleanupHeldBy`).
 */
import { HELD_BY_WORDS } from '../../shared/api.js';
import { expiryReportStands, type ExpiryReport } from './archivedExpiry.js';
import type { HeldByRead, HeldByWorkspace } from './heldByRead.js';
import type {
  ChildReclaimAttention, CleanupHeldByAct, CleanupHeldByItem, CoordStatus, ExpiryAttention, FleetSession, HeldByWord,
  LcRefusalToken,
} from '../../shared/api.js';

const PROBE_UNMEASURED: LcRefusalToken = 'probe-unmeasured';

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

/** The pace (reviews 1580 F1 and 1585 F1): a pass asks a held child only once its own backoff has run, one ask a minute
 *  fleet-wide, so it is usually minutes for a new hold and a few hours or more on the persistent tier. Nothing resets
 *  that backoff. The console's confirm words carry the same two phrases (`heldByRowsWords.ts`; a parity test holds them
 *  equal). */
const HELD_PACE = 'usually within minutes for a new hold; a few hours or more for what has been failing a long time';
/** Said wherever a re-read is promised: the paused lanes read nothing. */
const HELD_PAUSED = 'Nothing is re-read while the cleanup is paused.';

/** Where the fleet state stands on a row: listed (then its workspace decides), not listed (a row ccd purged, often one
 *  just forgotten, or a partial registry entry the fleet state cannot build), or no fleet frame read yet. Each gets its
 *  own words, worded from what is measured (reviews 1580 F2 and 1585 F2). */
type FleetStanding = 'listed' | 'missing' | 'unframed';

const STANDING_REMEDY: Record<Exclude<FleetStanding, 'listed'>, string> = {
  missing: `The fleet state does not list this row. The line clears as each item it held is checked again, ${HELD_PACE}. If it stays after that, a partial registry entry remains for this id; remove it by hand once its session has ended. ${HELD_PAUSED}`,
  unframed: 'This row\'s state in the fleet has not been read yet, so only a re-check is offered. ' + RECHECK_TAIL,
};

/** One entry per word; a missing word is a compile error. */
const HELD_BY_SENTENCE: Record<HeldByWord, SentenceParts> = {
  'gone-unrecorded': {
    found: 'Its folder is gone with no record, or a directory or link on its path cannot be searched.',
    remedy: (act) => act === 'forget'
      ? `Forgetting the row removes only its registry entry. The cleanup it blocked goes ahead, wherever no other row still holds it, when ccrc next checks what this row holds: ${HELD_PACE}. ${HELD_PAUSED}`
      : 'This row is a workspace, or its workspace field could not be read, so only a person removes it, once its session has ended. Where git still records it, use the scoped `git -C <main> worktree remove <path>`, never a repo-wide prune. If its folder still stands but a directory on its path cannot be searched, make that directory searchable, or restore a link on its path to its original target. '
        + RECHECK_TAIL,
  },
  'not-plain': {
    found: 'This row\'s workdir is spelled in a way ccd will not trust.',
    remedy: () => 'Restart its session so that `ccd start` stores a plain absolute workdir, restore a link whose target opens with // to its original target, or purge the row once its session has ended; never replace a link to clear this. ' + RECHECK_TAIL,
  },
  'under-proc': {
    found: 'This row\'s workdir is under /proc, so a running process may still use it.',
    remedy: () => 'ccrc never stops that process. Stop and start the session from a plain path, or purge its row. ' + RECHECK_TAIL,
  },
  'workdir-unreadable': {
    found: 'This row\'s workdir record in the registry cannot be read (unreadable, or a link).',
    remedy: () => 'Purge the row once its session has ended, or restore the record to a readable regular file. ' + RECHECK_TAIL,
  },
  'entry-pending': {
    found: 'This row\'s session began a spawn that never recorded where its pane entered.',
    remedy: () => 'Stop and start that session, or purge its row once its session has ended. ' + RECHECK_TAIL,
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

/** The three lanes' latest reads, keyed by session id (or temp root). The expiry lane's entries carry their report too,
 *  REQUIRED, so a lane handed over without it does not type-check: an item whose report stands is never folded
 *  (reviews 1580 F5 and 1585 F5). */
export interface HeldByLanes {
  readonly reclaim: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
  readonly expire: ReadonlyMap<string, { readonly heldBy?: HeldByRead; readonly report: ExpiryReport | null }>;
  readonly collect: ReadonlyMap<string, { readonly heldBy?: HeldByRead }>;
}

/** Adds `cleanupHeldBy` (omitted while no row holds) and folds the items it replaces: a reclaim `failing` or `stuck`
 *  item with token `probe-unmeasured`, and an expiry `failing` item whose lane report does not stand (a final, `stuck`
 *  or persistent-tier report is the record of a row that may be part-cleaned, so it stays), whose child is held only by listed rows.
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
    return (entry !== undefined && expiryReportStands(entry.report)) || !heldOnlyByListed(entry?.heldBy);
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
