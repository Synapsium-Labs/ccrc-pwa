// D-8955: THE DISK-LANE STALL ALERT'S DECISIONS. Ring L1, context C6 (Attention and Notification): pure, clock-free (`now`
// is an argument), IO-free. The lane (`diskLaneStallLane.ts`, L4) reads the facts and acts on these answers only.
//
// Three cleanup lanes free disk space on the fleet box: the child reclaim (`reclaim`, `ws-reclaim`), the temp-root
// collector (`collect`, `ws-collect`) and the dependency shed (`shed-deps`, `ws-shed-deps`). Each journals what it did to
// `lifecycle_events` with ccd's outcome words (`done`, `refused`, `failed`). A lane can stop finishing anything while work
// waits on it: one registry row that ccd cannot place (an entry identity that stays pending, say) holds every child reclaim
// on the box. Nothing in the disk alarm says so, because the alarm watches free space, not the lanes that make it.
//
// So, for each lane, from its journal rows of the last `DISK_LANE_STALL_READ_MS`: the subjects whose latest row says work
// stands BLOCKED WAIT, each lane asking its own owner which rows say so (`LaneWords.waits`: the child reclaim's failure line,
// the collector's and the shed's refusal tables), and only while the last registry listing still names a subject that is a
// registry row; a lane with waits is STUCK when nothing of its own was done for `DISK_LANE_STALL_MS` and the oldest wait
// has stood that long too. A refusal that says there is nothing to do now (a shed already done, a session awake, a child
// parked for the operator) is no wait. A stuck lane while the disk is under pressure (`DiskHealth.pressure`, a critical filesystem) is
// STALLED: one Waiting on you item and one push, keyed by lane and reason, saying which lane, how much is waiting, why, and
// the remedy. The reason is the holding row's word when a cleanup lane names one (`cleanupHeldBy`, the one owner of those
// words and sentences), else ccd's most common token for the waits, else `unknown`. An open item settles once its lane is no
// longer stuck (it finished one again, or nothing waits), or its reason changed, measured (a new item then says the new one).
// Pressure gates the raise only: a lane still stuck after the disk eased keeps its item until it finishes one.
//
// UNMEASURED IS NOT NONE (review 2 and 5): before the first coord frame (no held-by facts) or the first registry listing, a
// lane that reads them answers `unknown` and moves nothing. And the held-by facts live in the server's memory, re-read one
// audit at a time after a restart, so a holder's word this process has not seen since it started is not yet a change of
// cause: an open item of that word stands until a holder names another cause, or until this process has seen it and it went.
//
// LEGITIMATELY DIFFERENT from the child reclaim's attention list (`childReclaimAttention`, C4), which folds the same journal
// per child (slug reclaim-fold-is-lane-level, D-8955): that list is derived inside the reclaim sweep, below the registry
// read's fail-shut return, and answers per child; this lane runs above that return (a full disk is when the registry read
// fails) and asks a lane-level question, the oldest wait and the last done across every child. It does not re-decide what a
// row means: a reclaim row waits only on the owner's own failure line (`childReclaimFailureLine`), and its token is said in
// the owner's words (`childReclaimFailingWord`).
import type { DiskHealth } from '../../shared/disk.js';
import { HELD_BY_WORDS, type CleanupHeldByItem, type LifecycleAct } from '../../shared/api.js';
import { DISK_LANE_STALL_VERB, isDiskLaneStallAction, type ItemAction } from '../../shared/ledgers.js';
import { OVERLORD_PROJECT } from '../../shared/overlord-designation.js';
import { WAITING_URL } from './pushOutbox.js';
import { gib, usedPct } from './disk.js';
import { childReclaimFailingWord, childReclaimFailureLine } from './childReclaimSweep.js';
import { collectRefusalBlocks } from './collectLane.js';
import { depsShedRefusalBlocks } from './depsShed.js';
import { refusalSentence } from './wsaudit.js';
import type { RaiseItemInput } from './coord/ledgersStore.js';

/** A lane is stuck when nothing of its own was done this long, and its oldest wait has stood this long. */
export const DISK_LANE_STALL_MS = 60 * 60_000;
/** How far back the journal is read: long enough that a lane retrying on a slow backoff is still seen waiting. */
export const DISK_LANE_STALL_READ_MS = 24 * 60 * 60_000;
/** At most this many of the newest rows are read in one pass (the window is bounded by the cap as well as by time). */
export const DISK_LANE_STALL_ROWS_MAX = 20_000;
/** The programme the item is raised on: the fleet's own (the untrusted-build item's precedent). */
export const DISK_LANE_STALL_ITEM_PROGRAMME = OVERLORD_PROJECT;

export type DiskStallLane = 'reclaim' | 'collect' | 'deps-shed';

interface LaneWords {
  /** The lane's journal act. */
  readonly act: LifecycleAct;
  /** Does this row say work stands blocked on the lane? Its owner's reading, never this file's. */
  readonly waits: (row: DiskLaneRow) => boolean;
  /** `registry`: a subject is a registry row, a wait only while the last listing names it. `temp-root`: it is not. */
  readonly subjects: 'registry' | 'temp-root';
  /** ccd's token in the item's words: the owner's sentence where it has one. */
  readonly tokenWords: (token: string) => string;
  /** The held-by count the lane's waits are named under (`CleanupHeldByItem.holds`), or null for a lane ccd names no
   *  holding rows for. */
  readonly holds: 'reclaim' | 'collect' | null;
  readonly name: string;
  readonly one: string;
  readonly many: string;
  readonly done: string;
}

/** One row per lane; a missing lane is a compile error. */
const failedOr = (blocks: (word: string | null) => boolean) => (r: DiskLaneRow): boolean =>
  r.outcome === 'failed' || (r.outcome === 'refused' && blocks(r.refusal));
const plainToken = (token: string): string => `ccd answered ${token}.`;
export const DISK_STALL_LANES: Readonly<Record<DiskStallLane, LaneWords>> = {
  reclaim: {
    act: 'reclaim', waits: childReclaimFailureLine, subjects: 'registry',
    tokenWords: (t) => childReclaimFailingWord(t, refusalSentence) ?? plainToken(t),
    holds: 'reclaim', name: 'Child workspace cleanup', one: 'closed child workspace', many: 'closed child workspaces', done: 'removed',
  },
  collect: {
    act: 'collect', waits: failedOr(collectRefusalBlocks), subjects: 'temp-root', tokenWords: plainToken,
    holds: 'collect', name: 'Temp folder cleanup', one: 'temp root', many: 'temp roots', done: 'collected',
  },
  'deps-shed': {
    act: 'shed-deps', waits: failedOr(depsShedRefusalBlocks), subjects: 'registry', tokenWords: plainToken,
    holds: null, name: 'Dependency shedding', one: 'sleeping session\'s dependency folders',
    many: 'sleeping sessions\' dependency folders', done: 'shed',
  },
};
export const DISK_STALL_LANE_NAMES = Object.keys(DISK_STALL_LANES) as DiskStallLane[];
/** The acts the lane reads, derived from the table. */
export const DISK_STALL_ACTS: readonly LifecycleAct[] = DISK_STALL_LANE_NAMES.map((l) => DISK_STALL_LANES[l].act);

/** One journal row (`CoordStore.lifecycleLaneRowsSince`), oldest first. */
export interface DiskLaneRow {
  readonly act: string;
  readonly outcome: string;
  readonly sessionId: string;
  readonly at: number;
  readonly refusal: string | null;
}

/** What a lane's rows say. `idle`: nothing waits. `flowing`: it finished one within the hour, or its waits are younger
 *  than that. `stuck`: `waiting` subjects wait, the oldest since `since`, and nothing was done since `lastDoneAt` (null:
 *  not in the window read); `token` is ccd's most common token on the waits' latest rows. */
export type LaneProgress =
  | { readonly kind: 'idle' }
  | { readonly kind: 'flowing' }
  | { readonly kind: 'stuck'; readonly waiting: number; readonly since: number; readonly lastDoneAt: number | null; readonly token: string | null };

/** The fold of one lane's rows (oldest first). `isLive`: whether a subject still stands (the last registry listing names it,
 *  for a lane whose subjects are registry rows); a subject that does not is no wait. */
export function laneProgressOf(lane: DiskStallLane, rows: readonly DiskLaneRow[], now: number, isLive: (subject: string) => boolean): LaneProgress {
  const { act, waits: isWait } = DISK_STALL_LANES[lane];
  let lastDoneAt: number | null = null;
  // Per subject: its latest row, and its first wait since its own last done.
  const latest = new Map<string, DiskLaneRow>();
  const firstWait = new Map<string, number>();
  for (const r of rows) {
    if (r.act !== act) continue;
    latest.set(r.sessionId, r);
    if (r.outcome === 'done') {
      lastDoneAt = lastDoneAt === null ? r.at : Math.max(lastDoneAt, r.at);
      firstWait.delete(r.sessionId);
    } else if (isWait(r) && !firstWait.has(r.sessionId)) firstWait.set(r.sessionId, r.at);
  }
  const waits = [...latest.values()].filter((r) => isWait(r) && isLive(r.sessionId));
  if (waits.length === 0) return { kind: 'idle' };
  const since = Math.min(...waits.map((r) => firstWait.get(r.sessionId) ?? r.at));
  if ((lastDoneAt !== null && now - lastDoneAt < DISK_LANE_STALL_MS) || now - since < DISK_LANE_STALL_MS) return { kind: 'flowing' };
  const tally = new Map<string, number>();
  for (const r of waits) if (r.refusal !== null && r.refusal !== '') tally.set(r.refusal, (tally.get(r.refusal) ?? 0) + 1);
  const token = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  return { kind: 'stuck', waiting: waits.length, since, lastDoneAt, token };
}

/** The `seen` keys (`diskLaneStallMoves`) this pass's verdicts add: each stuck lane's holder word. */
export const diskLaneHoldersSeen = (verdicts: readonly DiskLaneVerdict[]): string[] =>
  verdicts.flatMap((v) => (v.kind === 'stuck' && v.stall.holder !== null ? [`${v.lane}:${v.stall.holder.word}`] : []));

/** The holding row that holds the most of a lane's subjects (ties by row id), or null. */
function holderOf(lane: DiskStallLane, items: readonly CleanupHeldByItem[]): CleanupHeldByItem | null {
  const key = DISK_STALL_LANES[lane].holds;
  if (key === null) return null;
  return [...items].filter((i) => i.holds[key] > 0)
    .sort((a, b) => b.holds[key] - a.holds[key] || (a.rowId < b.rowId ? -1 : 1))[0] ?? null;
}

/** A stalled lane: its progress, the reason, and the holding row when one is named. */
export interface DiskLaneStall {
  readonly lane: DiskStallLane;
  readonly reason: string;
  readonly progress: Extract<LaneProgress, { kind: 'stuck' }>;
  readonly holder: CleanupHeldByItem | null;
}

/** Each lane's verdict for a pass. `unknown`: the journal could not be read, so nothing is raised or settled. `clear`:
 *  not stuck, so an open item settles with `note`. `stuck`: `stall`, raised only while `pressure`. */
export type DiskLaneVerdict =
  | { readonly lane: DiskStallLane; readonly kind: 'unknown' }
  | { readonly lane: DiskStallLane; readonly kind: 'clear'; readonly note: string }
  | { readonly lane: DiskStallLane; readonly kind: 'stuck'; readonly stall: DiskLaneStall; readonly pressure: boolean };

export interface DiskLaneStallInput {
  /** The disk alarm's block (`DiskAlarmLane.block`), null before its first pass. */
  readonly disk: DiskHealth | null;
  /** The journal rows (`CoordStore.lifecycleLaneRowsSince`), oldest first; null when they could not be read. */
  readonly rows: readonly DiskLaneRow[] | null;
  /** The holding rows the last coord frame carried (`CoordStatus.cleanupHeldBy`, empty when it carried none); null before
   *  the first frame, which a lane with holders reads as unmeasured, never as none. */
  readonly heldBy: readonly CleanupHeldByItem[] | null;
  /** The ids the last registry listing named; null before the first, which a lane of registry subjects reads as unmeasured. */
  readonly live: ReadonlySet<string> | null;
  readonly now: number;
}

/** The verdict of every lane, in table order. */
export function diskLaneVerdicts(i: DiskLaneStallInput): DiskLaneVerdict[] {
  const pressure = i.disk !== null && i.disk.pressure;
  return DISK_STALL_LANE_NAMES.map((lane): DiskLaneVerdict => {
    const w = DISK_STALL_LANES[lane];
    const live = i.live;
    if (i.rows === null || (w.holds !== null && i.heldBy === null) || (w.subjects === 'registry' && live === null)) return { lane, kind: 'unknown' };
    const p = laneProgressOf(lane, i.rows, i.now, live === null || w.subjects === 'temp-root' ? () => true : (id) => live.has(id));
    if (p.kind === 'idle') return { lane, kind: 'clear', note: `Nothing waits on ${w.name.toLowerCase()} any more.` };
    if (p.kind === 'flowing') return { lane, kind: 'clear', note: `${w.name} ${w.done} one again.` };
    const holder = holderOf(lane, i.heldBy ?? []);
    return { lane, kind: 'stuck', pressure, stall: { lane, reason: holder?.word ?? p.token ?? 'unknown', progress: p, holder } };
  });
}

/** The open stall items, by lane and reason, from the programme's open items (any other item is left out). */
export function openDiskLaneStallItems(open: readonly { readonly id: number; readonly action?: ItemAction | null }[]):
  { id: number; lane: string; reason: string }[] {
  return open.flatMap((i) => {
    const a = i.action ?? null;
    return isDiskLaneStallAction(a) ? [{ id: i.id, lane: a.lane, reason: a.reason }] : [];
  });
}

const hours = (ms: number): string => {
  const h = Math.floor(ms / (60 * 60_000));
  return h <= 1 ? 'an hour' : `${h} hours`;
};

/** The worst critical filesystem, said the disk notice's way, or the empty string. */
function spaceWords(disk: DiskHealth | null): string {
  const worst = (disk?.filesystems ?? []).filter((f) => f.level === 'critical').sort((a, b) => usedPct(b) - usedPct(a))[0];
  return worst === undefined ? '' : ` The disk holding ${worst.roots.join(', ')} is ${usedPct(worst)}% full, ${gib(worst.availBytes)} free.`;
}

/** The cause and its remedy, in the item's words. */
function causeWords(s: DiskLaneStall): { cause: string; remedy: string; short: string } {
  if (s.holder !== null) {
    // Conditional (review 4): the roll's own gates can keep it from that session, so no promise that it will.
    const self = s.holder.word === 'entry-pending'
      ? ' ccrc\'s automatic roll may stop and start that session by itself once it is idle, unless the roll is kept from it'
        + ' (its setting, a no-roll marker, the Overlord); stopping and starting it now clears this.' : '';
    return {
      cause: `Registry row ${s.holder.rowId} holds them (${s.holder.word}).`,
      remedy: `${s.holder.sentence}${self}`,
      short: `Held by ${s.holder.rowId} (${s.holder.word}).${self}`,
    };
  }
  if (s.reason !== 'unknown') {
    return {
      cause: `ccd's latest answer for them is ${s.reason}: ${DISK_STALL_LANES[s.lane].tokenWords(s.reason)}`,
      remedy: 'The fleet screen\'s cleanup section lists each one with ccd\'s sentence for what holds it; fix that cause.',
      short: `ccd answers ${s.reason}.`,
    };
  }
  return {
    cause: 'ccd journalled no reason for them.',
    remedy: 'The fleet screen\'s cleanup section lists each one; look there for what holds it.',
    short: 'No reason was journalled.',
  };
}

/** The push's once-only key: the lane, the reason and the last done it waits behind, so the next stall after a done is new. */
export const diskLaneStallKey = (s: DiskLaneStall): string =>
  `disk-lane-stall:${s.lane}:${s.reason}:${s.progress.lastDoneAt ?? 0}`;

/** The item and the push for one stall. */
export function diskLaneStallItemOf(s: DiskLaneStall, disk: DiskHealth | null, now: number): { item: RaiseItemInput; push: { title: string; body: string; dedupeKey: string; url: string } } {
  const w = DISK_STALL_LANES[s.lane];
  const n = s.progress.waiting;
  const noun = `${n} ${n === 1 ? w.one : w.many}`;
  const stalledFor = s.progress.lastDoneAt === null ? `in the last ${hours(DISK_LANE_STALL_READ_MS)}` : `for ${hours(now - s.progress.lastDoneAt)}`;
  const title = `${w.name} has stalled while the disk is under pressure`;
  const c = causeWords(s);
  const why = `${noun} ${n === 1 ? 'waits' : 'wait'} to be ${w.done}, and none has been ${w.done} ${stalledFor}.${spaceWords(disk)} ${c.cause}`;
  return {
    item: {
      program: DISK_LANE_STALL_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do', title, why,
      how: [c.remedy, `ccrc closes this item when ${w.name.toLowerCase()} ${w.done} one again.`],
      options: null,
      // `soon` with no label: the item pushes nothing itself; the lane sends the one push.
      neededBy: 'soon', soonLabel: null, secretSlot: null,
      action: { verb: DISK_LANE_STALL_VERB, lane: s.lane, reason: s.reason },
    },
    push: { title, body: `${noun} waiting, none ${w.done} ${stalledFor}. ${c.short}`, dedupeKey: diskLaneStallKey(s), url: WAITING_URL },
  };
}

/** Is an open item's reason a holder's word that this process cannot yet call gone? It is when no holder names the lane now
 *  and this process has not seen that holder for the lane since it started (`seen`: `<lane>:<word>` keys). */
const holderUnconfirmed = (lane: DiskStallLane, reason: string, stall: DiskLaneStall, seen: ReadonlySet<string>): boolean =>
  stall.holder === null && (HELD_BY_WORDS as readonly string[]).includes(reason) && !seen.has(`${lane}:${reason}`);

/** The pass's moves: the open items to settle (with their notes) and the stalls to raise. A lane whose verdict is
 *  `unknown` moves nothing; a stuck lane keeps an open item of the same reason (whatever the pressure), and one whose
 *  holder this process has not seen go (`holderUnconfirmed`), raising nothing beside it; it settles one of another reason,
 *  and is raised only while the disk is under pressure and no item of its reason is open. */
export function diskLaneStallMoves(verdicts: readonly DiskLaneVerdict[], open: readonly { id: number; lane: string; reason: string }[],
  seen: ReadonlySet<string>): { settle: { id: number; note: string }[]; raise: DiskLaneStall[] } {
  const settle: { id: number; note: string }[] = [];
  const raise: DiskLaneStall[] = [];
  for (const v of verdicts) {
    const mine = open.filter((o) => o.lane === v.lane);
    if (v.kind === 'unknown') continue;
    if (v.kind === 'clear') { for (const o of mine) settle.push({ id: o.id, note: v.note }); continue; }
    if (mine.some((o) => o.reason !== v.stall.reason && holderUnconfirmed(v.lane, o.reason, v.stall, seen))) continue;
    for (const o of mine) if (o.reason !== v.stall.reason) settle.push({ id: o.id, note: `The cause changed to ${v.stall.reason}; a new item says so.` });
    if (v.pressure && !mine.some((o) => o.reason === v.stall.reason)) raise.push(v.stall);
  }
  return { settle, raise };
}
