import type { Presence } from './presence.js';
import type { Deps } from './server.js';
import type { FleetState } from './fleetstate.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { FleetSession } from '../../shared/api.js';
import { CCD_ARGV, sweepDec, verbSupported } from './ccdargv.js';
import {
  HIBERNATE_ACT_LINE_MS, HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER,
  HIBERNATE_PER_SWEEP, HIBERNATE_SHADOW_LINE_MS, HIBERNATE_SWEEP_ACTOR, NO_HIBERNATE_SUFFIX,
  hibernateAfterMs, hibernateVerdict, type HibernateInput, type HibernateLive, type HibernateMark, type HibernateRow,
  type HibernateStoreRead, type HibernateVerdict,
} from './coord/hibernate.js';

/**
 * HIBERNATION'S SWEEP (D-5242, plan Tasks 17a and 17b): L4, it reads, logs and — only when ARMED — acts; it decides
 * nothing: `hibernateVerdict` (`coord/hibernate.ts`, L1) holds the rule.
 *
 * SHADOW UNLESS ARMED. Without `$REG/hibernate-live` (or with `hibernate-disabled`, which wins), or on a box whose
 * `ccd caps` does not list `hibernate` (`verbSupported`), or before `buildServer` hands over the coordination
 * serialiser, a `hibernate` answer only logs its shadow line. Arming is the operator's act (plan Task 19): nothing in the
 * tree writes the marker (`single-definition.test.ts`). The act cannot ship without its wake paths — they are in the same
 * build (the mail lane's wake under the fleet-wide budget, the ensure route's and dispatch's asked wakes, the swap
 * route's `409 hibernated`).
 *
 * ONE PASS (`FleetWatcher.sweepHibernate`, every `HIBERNATE_SWEEP_MS`, on the tick's own rows and listing):
 *  1. `$REG/hibernate-disabled` listed → nothing is read, logged or done;
 *  2. N is `$REG/hibernate-after-hours` when listed (read then, and only then), else the default;
 *  3. per row with a registry record: the store's answers (open runs as worker through `openRunsForSession` and as
 *     claimant through `openRunsClaimedBy`, both `state NOT IN` the terminal set; the live claims, read once a pass;
 *     outstanding mail), `Presence.isOpen`, the opt-out marker from the listing; a read that fails, or no store at
 *     all, holds `runs-unreadable`;
 *  4. a row the verdict answers `measure` for has its raw live word and its turn marker read, and is asked again;
 *  5. a `hibernate` answer, unarmed, logs `ccrc-server: hibernate-shadow <id> idle=<h>h`, at most once per id per
 *     `HIBERNATE_SHADOW_LINE_MS`;
 *  6. ARMED, at most `HIBERNATE_PER_SWEEP` acts a pass, fleet-wide, each ON THE COORDINATION SERIALISER and then the
 *     session's own queue (hibernate-act-on-the-coord-serialiser (D-5428)), so a dispatch opening a run onto it, or a
 *     mail delivery typing into its pane, finishes first; inside them the registry record and its row, the store,
 *     presence, the live word and the turn marker are read AGAIN and the verdict asked again, and only a `hibernate`
 *     answer composes `ccd hibernate <id>` (`CCD_ARGV.hibernate`, the lane declared by `sweepDec`). ccd then
 *     re-measures the box-local half at the act and the one hold the server cannot see (`attached`); its refusal,
 *     `ccd: session-busy: <reason>` at exit 3, is a QUIET skip — one line per id per `HIBERNATE_ACT_LINE_MS`, never a
 *     warning per sweep — and the next sweep asks again.
 *
 * The verdict holds every candidate `viewer` for `PRESENCE_OPEN_TTL_MS` after `startedAt`, the process start the
 * watcher hands it: presence is never persisted, and a hidden tab that has not reconnected after a deploy is not an
 * empty screen.
 */

/** The act's half of the deps: absent in a shadow-only harness, and then nothing can act whatever the markers say. */
export interface HibernateActPort {
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over, and while it is
   *  the sweep stays in shadow. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: HibernateRow } | { ok: false }>;
}

export interface HibernateSweepDeps {
  /** Undefined without a coordination store: every row then holds `runs-unreadable`. */
  readonly coord: Pick<CoordStore, 'openRunsForSession' | 'openRunsClaimedBy' | 'activeClaims' | 'outstandingMailFor'> | undefined;
  /** Undefined: every row holds `viewer` (fail closed): a screen nothing measured is never an empty one. */
  readonly presence: Pick<Presence, 'isOpen'> | undefined;
  /** `turnverdict.ts`'s `liveWordFor`, over the watcher's thunks. */
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  /** `turnverdict.ts`'s `turnMarkFor`: the turn marker, judged against the live process. */
  readonly mark: (rec: SessionRecord) => Promise<HibernateMark>;
  /** `$REG/hibernate-after-hours`'s body; called only when the listing names it. */
  readonly readAfterHours: () => Promise<string | null>;
  readonly log: (line: string) => void;
  readonly startedAt: number;
  readonly now: () => number;
  /** Null: shadow only, whatever the markers say. */
  readonly act: HibernateActPort | null;
}

export interface HibernateSweepMemory {
  /** The last shadow line per id. Pruned of ids the pass no longer sees. */
  readonly lastLine: Map<string, number>;
  /** The last skip or failure line per id after an act ccd refused or that failed. Pruned the same way. */
  readonly lastActLine: Map<string, number>;
}

/** What one row came to: the verdict the pass reached, and — armed, for a `hibernate` answer — what the act did. */
export type HibernateActOutcome =
  | { readonly kind: 'hibernated' }
  | { readonly kind: 'held-at-act'; readonly verdict: HibernateVerdict }
  | { readonly kind: 'skipped'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };
export interface HibernateSweepOutcome {
  readonly id: string;
  readonly verdict: HibernateVerdict;
  readonly act?: HibernateActOutcome;
}

/** ccd's refusal of an act it re-measured as not idle (`_hib_refuse`, exit 3): `ccd: session-busy: <reason>`. */
const SESSION_BUSY = /ccd: session-busy: ?(\S*)/;

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One session's store answers. The live claims are read once a pass and handed in (null when that read failed).
 *  FAIL CLOSED (hibernate-store-reads-fail-closed (D-5426)): mail is `outstandingMailFor`'s — delivered but not yet
 *  acknowledged counts, as it does for the stop-done lane — and a claim or mail read that fails, or no store at all,
 *  holds `runs-unreadable` exactly as a failed run read does. */
function storeRead(coord: HibernateSweepDeps['coord'], claimants: ReadonlySet<string> | null, id: string): HibernateStoreRead {
  if (coord === undefined) return { ok: false, detail: 'no coordination store' };
  if (claimants === null) return { ok: false, detail: 'the live claims could not be read' };
  try {
    const worker = coord.openRunsForSession(id);
    if (!worker.ok) return { ok: false, detail: worker.detail };
    const claimant = coord.openRunsClaimedBy(id);
    if (!claimant.ok) return { ok: false, detail: claimant.detail };
    return {
      ok: true, openWorker: worker.siblings.length > 0, openClaimant: claimant.siblings.length > 0,
      claim: claimants.has(id), mail: coord.outstandingMailFor(id, 1).length > 0,
    };
  } catch (err) {
    return { ok: false, detail: errText(err) };
  }
}

async function readLive(deps: HibernateSweepDeps, rec: SessionRecord): Promise<HibernateLive> {
  const w = await deps.liveWord(rec);
  const mark = await deps.mark(rec);
  return { kind: 'read', word: w.ok ? { ok: true, word: w.word } : { ok: false, reason: w.reason }, mark };
}

/** The live claims, read once (null when the read failed or there is no store). */
function claimantsOf(coord: HibernateSweepDeps['coord']): ReadonlySet<string> | null {
  if (coord === undefined) return null;
  try {
    return new Set(coord.activeClaims().map((c) => c.heldBy));
  } catch {
    return null;
  }
}

const hours = (ms: number): number => Math.floor(ms / (60 * 60_000));

/** The act's port once armed: its serialiser handed over. */
type ArmedPort = HibernateActPort & { readonly serial: NonNullable<HibernateActPort['serial']> };

/** The port, when this pass may act: armed, the verb on the box, the serialiser handed over. Null: shadow. */
function armedPort(deps: HibernateSweepDeps, names: readonly string[]): ArmedPort | null {
  const a = deps.act;
  if (a === null || a.serial === null || !names.includes(HIBERNATE_LIVE_MARKER)) return null;
  if (!verbSupported(a.fleetState, CCD_ARGV.hibernate('x', null))) return null;
  return { ...a, serial: a.serial };
}

/** One pass. Returns every row's verdict (and, armed, what each act did), for the tests and the watcher's log. */
export async function hibernatePass(
  deps: HibernateSweepDeps, mem: HibernateSweepMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<HibernateSweepOutcome[]> {
  if (names.includes(HIBERNATE_DISABLED_MARKER)) return [];
  const afterMs = hibernateAfterMs(names.includes(HIBERNATE_AFTER_HOURS_FILE) ? await deps.readAfterHours() : null);
  const port = armedPort(deps, names);
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const claimants = claimantsOf(deps.coord);
  const out: HibernateSweepOutcome[] = [];
  let acted = 0;
  // Built again for each ask: the store and presence are re-read AFTER the live reads, which take real time.
  const inputFor = (row: HibernateRow, claims: ReadonlySet<string> | null, live: HibernateLive, at: number): HibernateInput => ({
    row, optedOut: names.includes(`${row.id}.${NO_HIBERNATE_SUFFIX}`), store: storeRead(deps.coord, claims, row.id),
    viewer: deps.presence?.isOpen(row.id) ?? true, sinceStartMs: at - deps.startedAt, live,
  });
  for (const s of sessions) {
    const rec = byId.get(s.id);
    if (rec === undefined) continue;
    const row: HibernateRow = s;
    let now = deps.now();
    let v = hibernateVerdict(inputFor(row, claimants, { kind: 'unread' }, now), now, afterMs);
    if (v.act === 'measure') {
      const live = await readLive(deps, rec);
      now = deps.now();
      v = hibernateVerdict(inputFor(row, claimants, live, now), now, afterMs);
    }
    if (v.act !== 'hibernate') { out.push({ id: s.id, verdict: v }); continue; }
    if (port !== null) {
      // ARMED. Past the per-sweep bound the row simply waits for the next sweep: no line, no act.
      if (acted >= HIBERNATE_PER_SWEEP) { out.push({ id: s.id, verdict: v }); continue; }
      acted++;
      const act = await actOn(deps, port, mem, row, rec, afterMs, inputFor);
      out.push({ id: s.id, verdict: v, act });
      continue;
    }
    out.push({ id: s.id, verdict: v });
    const last = mem.lastLine.get(s.id);
    if (last !== undefined && now - last < HIBERNATE_SHADOW_LINE_MS) continue;
    mem.lastLine.set(s.id, now);
    deps.log(`ccrc-server: hibernate-shadow ${s.id} idle=${hours(v.idleMs)}h`);
  }
  const seen = new Set(sessions.map((s) => s.id));
  for (const m of [mem.lastLine, mem.lastActLine]) for (const id of [...m.keys()]) if (!seen.has(id)) m.delete(id);
  return out;
}

/** The act, for one row the pass answered `hibernate` for: on the serialiser, then the session's queue; everything
 *  re-read and the verdict asked again inside them; only then `ccd hibernate`. Never throws. */
async function actOn(
  deps: HibernateSweepDeps, port: ArmedPort, mem: HibernateSweepMemory, row: HibernateRow, rec: SessionRecord, afterMs: number,
  inputFor: (row: HibernateRow, claims: ReadonlySet<string> | null, live: HibernateLive, at: number) => HibernateInput,
): Promise<HibernateActOutcome> {
  const id = row.id;
  const note = (line: string): void => {
    const now = deps.now();
    const last = mem.lastActLine.get(id);
    if (last !== undefined && now - last < HIBERNATE_ACT_LINE_MS) return;
    mem.lastActLine.set(id, now);
    deps.log(line);
  };
  try {
    return await port.serial(() => port.queueRun(id, async (): Promise<HibernateActOutcome> => {
      const fresh = await port.rowAtAct(rec);
      if (!fresh.ok) return { kind: 'held-at-act', verdict: { act: 'hold', reason: 'unmeasured' } };
      // Only the roster falls back to the tick's read, when the re-read row has none (the stop-done lane's rule).
      const again: HibernateRow = { ...fresh.row, subagents: fresh.row.subagents ?? row.subagents };
      const live = await readLive(deps, rec);
      const at = deps.now();
      const v = hibernateVerdict(inputFor(again, claimantsOf(deps.coord), live, at), at, afterMs);
      if (v.act !== 'hibernate') return { kind: 'held-at-act', verdict: v };
      // The verb is asked again here, beside the act (a box can be re-handshaken in the wait): never sent to a ccd that
      // does not list it.
      const argv = CCD_ARGV.hibernate(id, sweepDec(port.fleetState, HIBERNATE_SWEEP_ACTOR));
      if (!verbSupported(port.fleetState, argv)) return { kind: 'skipped', detail: 'no-verb' };
      const res = await port.runCcd(argv);
      if (res.ok) {
        mem.lastActLine.delete(id);
        deps.log(`ccrc-server: hibernated ${id} idle=${hours(v.idleMs)}h (D-5242)`);
        return { kind: 'hibernated' };
      }
      const busy = SESSION_BUSY.exec(res.stderr);
      if (busy !== null) {
        note(`ccrc-server: hibernate-skip ${id}: ccd re-measured it as ${busy[1] || 'busy'} — asked again next sweep`);
        return { kind: 'skipped', detail: busy[1] || 'busy' };
      }
      note(`ccrc-server: hibernate of ${id} failed (${res.stderr.trim() || 'no stderr'}) — asked again next sweep`);
      return { kind: 'failed', detail: res.stderr };
    }));
  } catch (err) {
    note(`ccrc-server: hibernate of ${id} failed (${errText(err)}) — asked again next sweep`);
    return { kind: 'failed', detail: errText(err) };
  }
}
