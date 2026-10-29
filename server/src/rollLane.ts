import type { Viewers } from './viewer.js';
import type { SessionRecord } from './registry.js';
import { ccdCan } from './ccdargv.js';
import {
  HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, IDLE_HOURS_POLICY, NO_HIBERNATE_SUFFIX,
  hibernateAfterMs, type HibernateLive, type HibernateMark, type HibernateStoreRead,
} from './coord/hibernate.js';
import {
  NO_ROLL_SUFFIX, ROLL_QUIET_MS, ROLL_SWEEP_ACTOR, autoRollVerdict, type AutoRollVerdict,
} from './coord/rollTarget.js';
import { idleHoursBindings, laneVerb, sleepPass, type IdleHoursCoordPort, type SleepActPort, type SleepLane } from './sleepLane.js';
import { readSwitches } from '../../shared/switches.js';
import type { FleetSession } from '../../shared/api.js';
import type { ClaudeRollTargets } from '../../shared/claudeVersion.js';

/**
 * THE AUTOMATIC COORDINATOR ROLL, RELEASE HALF (D-7452; the operator's rulings of 2026-10-29): L4, one row of the sleep
 * executor (`sleepLane.ts`'s `sleepPass` and `sleepAct`, the fleet's ONE `ccd hibernate` act site), whose `then: 'wake'`
 * follows the sleep with the wake. `autoRollVerdict` (`coord/rollTarget.ts`, L1) decides.
 *
 * THE ACT IS ONE ccd VERB (D-7458): `ccd hibernate --roll <id>`, the existing in-place resume (hibernate, then the
 * `cmd_ensure` every hibernated session wakes by) composed inside ccd, so the executor runs ccd once and the journal
 * carries one deliberate `hibernate` row with the declared actor `sweep:roll`. `cmd_hibernate` re-measures the box-local
 * half (a draft in the input box, `esc to interrupt`, an attached terminal, the turn marker's `done`, `bg` and `crons`, a
 * swap landing, `.no-roll`; NOT `.no-hibernate`) and refuses `ccd: session-busy: <reason>` at exit 3, which is a skip,
 * and nothing is woken. The wake clears the marker and starts the unit, whose spawn resumes the same conversation on the
 * release the node now runs; a failed wake exits 4 (`roll-wake-failed`). Sent only to a box whose `ccd caps` lists
 * `hibernate-roll`. Not `ccd roll`: it does not exist yet (binary-lifecycle wave 2). Not a swap: `cmd_swap` refuses a
 * same-account target. Everything is re-read and the verdict asked again on the coordination serialiser and
 * the session's queue (D-5428), the switches over a fresh listing (D-7047), and the fleet-wide wake budget as an
 * automatic wake, so a roll never lands on top of another wake. A failed wake leaves the coordinator hibernated, a
 * sanctioned state: mail, an open screen or a re-dispatch wakes it, on the current release.
 *
 * ONE PASS (`rollPass`): `hibernate-disabled` (the act's kill switch) or the Settings row at anything but
 * `coordinators` journals one line and reads nothing; otherwise the node's install time is read once, and the executor
 * asks every recorded row, measures the ones the verdict asks it to, and acts on at most ONE a pass (`ROLL_PER_PASS`),
 * so rolls never herd. Every skip is journalled with its reason, at most once per id per `ROLL_LINE_MS` unless the
 * reason changed; a row already on the current release is not a skip and writes nothing.
 */

/** One roll a pass, fleet-wide. */
export const ROLL_PER_PASS = 1;
/** At most one journal line per id this often, unless its reason changed. */
export const ROLL_LINE_MS = 60 * 60_000;

export interface RollSweepDeps {
  readonly coord: IdleHoursCoordPort | undefined;
  /** The Settings row (`rollTargetsOf` over `CoordStore.rollSettings`); null when it could not be read. */
  readonly targets: () => ClaudeRollTargets | null;
  /** When the node's current ccrc install completed: `~/.ccrc/installed`'s modification time. */
  readonly release: () => Promise<ReleaseRead>;
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  readonly mark: (rec: SessionRecord) => Promise<HibernateMark>;
  /** The live file's `startedAt` for the pane's process; null unmeasured. */
  readonly processStartedAt: (rec: SessionRecord) => Promise<number | null>;
  /** `$REG/hibernate-after-hours`'s body; called only when the listing names it. */
  readonly readAfterHours: () => Promise<string | null>;
  readonly log: (line: string) => void;
  /** When this server started (presence is never believed before `PRESENCE_OPEN_TTL_MS`). */
  readonly startedAt: number;
  readonly now: () => number;
  /** Null: the lane journals what it would roll and rolls nothing. */
  readonly act: SleepActPort<FleetSession> | null;
}

/** The node's install record, read for the roll. `none`: no completed install stands (a working-tree deploy, which
 *  writes no record, or a dev box), so there is no release for a coordinator to be behind on, and the pass is silent,
 *  as a row on the current release is. `unreadable`: it stands, or may, and could not be read: journalled, rolls
 *  nothing. Two arms, never one null, because the pass answers them differently. */
export type ReleaseRead =
  | { readonly kind: 'installed'; readonly at: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' };

const releaseAt = (r: ReleaseRead): number | null => (r.kind === 'installed' ? r.at : null);

export interface RollSweepMemory {
  /** The last journal line per id (and the pass-level key `*`): when, and for what. */
  readonly lastAt: Map<string, number>;
  readonly lastWhat: Map<string, string>;
}

export type RollOutcome =
  | { readonly id: string; readonly kind: 'rolled'; readonly idleMs: number }
  | { readonly id: string; readonly kind: 'skipped'; readonly reason: string }
  | { readonly id: string; readonly kind: 'failed'; readonly detail: string }
  | { readonly id: string; readonly kind: 'woke-failed'; readonly detail: string };

/** The verdict as the executor reads it: a roll is its `hibernate` answer (the sleep its act starts with), every skip
 *  a hold named by its words, and a row on the current release the hold `current`, which writes nothing. */
type RollAnswer =
  | { readonly act: 'hibernate'; readonly idleMs: number }
  | { readonly act: 'measure' }
  | { readonly act: 'hold'; readonly reason: string };

const CURRENT = 'current';

function answerOf(v: AutoRollVerdict): RollAnswer {
  if (v.act === 'roll') return { act: 'hibernate', idleMs: v.idleMs };
  if (v.act === 'measure') return v;
  if (v.act === 'current') return { act: 'hold', reason: CURRENT };
  return { act: 'hold', reason: v.reason === 'idle-gate' ? `idle-gate:${v.hold}` : v.reason };
}

interface Pass {
  readonly targets: ClaudeRollTargets | null;
  readonly release: number | null;
  readonly hibernation: { readonly armed: boolean; readonly afterMs: number };
}

/** The pass's facts the executor's asks read, carried on the deps it is handed. */
type RollLaneDeps = RollSweepDeps & { readonly pass: Pass };

async function liveOf(deps: RollSweepDeps, rec: SessionRecord): Promise<{ live: HibernateLive; startedAt: number | null }> {
  const w = await deps.liveWord(rec);
  const mark = await deps.mark(rec);
  const startedAt = await deps.processStartedAt(rec);
  return { live: { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, mark }, startedAt };
}

function ask(deps: RollSweepDeps, p: Pass, names: readonly string[], row: FleetSession, store: HibernateStoreRead,
  live: HibernateLive, startedAt: number | null, now: number): RollAnswer {
  return answerOf(autoRollVerdict({
    targets: p.targets, role: row.role, release: p.release, startedAt,
    optedOut: { roll: names.includes(`${row.id}.${NO_ROLL_SUFFIX}`), hibernate: names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`) },
    hibernation: p.hibernation, statusUpdatedAt: row.statusUpdatedAt,
    sleep: { row, optedOut: false, store, viewer: deps.viewers?.isOpen(row.id) ?? true, sinceStartMs: now - deps.startedAt, live },
    now,
  }));
}

/** The roll's row of the sleep executor. Its policy row is hibernation's (`IDLE_HOURS_POLICY`): the roll's idle gate
 *  IS hibernation's, asked through `autoRollVerdict` with the roll's quiet window. */
export const ROLL_LANE: SleepLane<RollLaneDeps, RollSweepMemory, FleetSession, HibernateStoreRead, RollAnswer, RollOutcome | null> = {
  policy: IDLE_HOURS_POLICY,
  kill: [HIBERNATE_DISABLED_MARKER],
  arming: null,
  cadence: 'rollIdle',
  population: 'recorded-rows-in-frame-order',
  caps: { acts: ROLL_PER_PASS, measures: null, past: 'wait' },
  acts: 'inline',
  retry: { kind: 'ask-next-pass', lineMs: ROLL_LINE_MS, shadowLineMs: ROLL_LINE_MS, of: (m) => [m.lastAt] },
  store: 'optional',
  unarmed: 'shadow',
  verb: 'arms-and-asked-at-act',
  holdOk: false,
  then: 'wake',
  actor: ROLL_SWEEP_ACTOR,
  clock: 'per-row',
  quietMs: () => ROLL_QUIET_MS,
  port: (deps) => deps.act,
  bindings: (deps) => idleHoursBindings(deps),
  asks: {
    first: (deps, f, row, now) => ask(deps, deps.pass, f.names, row, f.storeOf(row.id), { kind: 'unread' }, null, now),
    measured: async (deps, f, row, rec) => {
      const { live, startedAt } = await liveOf(deps, rec);
      const now = deps.now();
      return { v: ask(deps, deps.pass, f.names, row, f.storeOf(row.id), live, startedAt, now), now };
    },
    atAct: async (deps, f, row, rec) => {
      const { live, startedAt } = await liveOf(deps, rec);
      const p: Pass = { ...deps.pass, targets: deps.targets(), release: releaseAt(await deps.release()) };
      const at = deps.now();
      const store = idleHoursBindings(deps)(row.id);
      return { v: ask(deps, p, f.names, row, store, live, startedAt, at), store };
    },
  },
  notices: null,
  // Unarmed (no act port, no serialiser yet, or no `hibernate` on the box), `judged` answers the row and `rollPass`
  // journals it as `unarmed`, so the shadow line is that one.
  shadow: () => { /* journalled by `rollPass` */ },
  said: () => { /* `rollPass` journals every outcome, so nothing is said twice */ },
  outcome: {
    judged: (id, v) => (v.act === 'hold' ? (v.reason === CURRENT ? null : { id, kind: 'skipped', reason: v.reason })
      : v.act === 'hibernate' ? { id, kind: 'skipped', reason: 'one-per-pass' } : null),
    acted: (id, v, r) => {
      if (r.kind === 'hibernated') {
        return r.woke === undefined || r.woke === true ? { id, kind: 'rolled', idleMs: v.idleMs } : { id, kind: 'woke-failed', detail: r.woke.failed };
      }
      if (r.kind === 'held-at-act') {
        const w = r.verdict === null ? 'idle-gate:unmeasured' : r.verdict.act === 'hold' ? r.verdict.reason : 'idle-gate:unmeasured';
        return w === CURRENT ? null : { id, kind: 'skipped', reason: w };
      }
      if (r.kind === 'skipped') return { id, kind: 'skipped', reason: r.by === 'ccd' ? `ccd:${r.detail}` : r.detail };
      if (r.kind === 'switched-off') return { id, kind: 'skipped', reason: r.detail };
      return { id, kind: 'failed', detail: r.detail };
    },
  },
};

function journal(deps: RollSweepDeps, mem: RollSweepMemory, key: string, what: string, line: string): void {
  const now = deps.now();
  const at = mem.lastAt.get(key);
  if (at !== undefined && mem.lastWhat.get(key) === what && now - at < ROLL_LINE_MS) return;
  mem.lastAt.set(key, now);
  mem.lastWhat.set(key, what);
  deps.log(line);
}

/** One pass. Returns what it did to every row it did not find current, for the caller's log and the tests. */
export async function rollPass(
  deps: RollSweepDeps, mem: RollSweepMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<RollOutcome[]> {
  const switches = readSwitches(names);
  if (switches[HIBERNATE_DISABLED_MARKER] === 'set') {
    journal(deps, mem, '*', HIBERNATE_DISABLED_MARKER, `ccrc-server: roll-skip all: ${HIBERNATE_DISABLED_MARKER} stands, so nothing is rolled`);
    return [];
  }
  const targets = deps.targets();
  if (targets !== 'coordinators') {
    const why = targets === null ? 'setting-unreadable' : 'setting-off';
    journal(deps, mem, '*', why, `ccrc-server: roll-skip all: ${why}`);
    return [];
  }
  if (!sessions.some((s) => records.some((r) => r.id === s.id))) return [];
  const afterMs = names.includes(HIBERNATE_AFTER_HOURS_FILE) ? hibernateAfterMs(await deps.readAfterHours()) : hibernateAfterMs(null);
  const armed = switches[HIBERNATE_LIVE_MARKER] === 'set' && ccdCan(deps.act?.fleetState, 'hibernate');
  const read = await deps.release();
  // No completed install on this node: nothing is behind, so nothing is a skip and nothing is written (D-7458).
  if (read.kind === 'none') return [];
  const release = releaseAt(read);
  if (release === null) {
    // Every row shares the node's install time, so its absence is one line for the pass, not one per coordinator.
    journal(deps, mem, '*', 'release-unmeasured', 'ccrc-server: roll-skip all: release-unmeasured (the node\'s ~/.ccrc/installed could not be read)');
    return [];
  }
  const pass: Pass = { targets, release, hibernation: { armed, afterMs } };
  mem.lastAt.delete('*');
  const actArmed = deps.act !== null && deps.act.serial !== null && laneVerb(ROLL_LANE.then, deps.act.fleetState);
  const out = (await sleepPass(ROLL_LANE, { ...deps, pass }, mem, sessions, records, names))
    .filter((o): o is RollOutcome => o !== null)
    // `judged` cannot tell a row past the pass's one act from one the unarmed executor passed over; this pass can.
    .map((o) => (!actArmed && o.kind === 'skipped' && o.reason === 'one-per-pass' ? { ...o, reason: 'unarmed' } : o));
  for (const k of [...mem.lastWhat.keys()]) if (k !== '*' && !mem.lastAt.has(k)) mem.lastWhat.delete(k);
  const done = new Set<string>();
  for (const o of out) {
    done.add(o.id);
    if (o.kind === 'rolled') {
      mem.lastAt.delete(o.id);
      deps.log(`ccrc-server: rolled ${o.id} onto the current release (idle ${Math.floor(o.idleMs / 60_000)} min; D-7452)`);
    } else if (o.kind === 'skipped') {
      journal(deps, mem, o.id, o.reason, `ccrc-server: roll-skip ${o.id}: ${o.reason}`);
    } else if (o.kind === 'failed') {
      journal(deps, mem, o.id, 'failed', `ccrc-server: roll of ${o.id} failed at its hibernate (${o.detail.trim() || 'no stderr'}); it was not stopped`);
    } else {
      journal(deps, mem, o.id, 'woke-failed', `ccrc-server: roll of ${o.id}: its wake failed (${o.detail.trim() || 'no stderr'}); it stays hibernated, and mail, an open screen or a re-dispatch wakes it on the current release`);
    }
  }
  // A row found current writes nothing and forgets its last line, so a later skip is journalled at once.
  for (const s of sessions) if (!done.has(s.id) && s.id !== '*') { mem.lastAt.delete(s.id); mem.lastWhat.delete(s.id); }
  return out;
}
