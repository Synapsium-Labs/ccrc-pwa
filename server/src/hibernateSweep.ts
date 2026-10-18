import type { Presence } from './presence.js';
import type { SessionRecord } from './registry.js';
import type { CoordStore } from './coord/store.js';
import type { FleetSession } from '../../shared/api.js';
import {
  HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, HIBERNATE_SHADOW_LINE_MS, NO_HIBERNATE_SUFFIX,
  hibernateAfterMs, hibernateVerdict, type HibernateInput, type HibernateLive, type HibernateMark, type HibernateRow,
  type HibernateStoreRead, type HibernateVerdict,
} from './coord/hibernate.js';

/**
 * HIBERNATION'S SHADOW SWEEP (D-5242, plan Task 17a): L4, it reads and LOGS, and decides nothing — `hibernateVerdict`
 * (`coord/hibernate.ts`, L1) holds the rule. SHADOW ONLY, by construction: these deps carry no ccd runner, so no
 * build of this file can put a session to sleep, whatever `$REG/hibernate-live` says. The live act, and every path
 * that wakes a session, arrive together in Task 17b.
 *
 * ONE PASS (`FleetWatcher.sweepHibernateShadow`, every `HIBERNATE_SWEEP_MS`, on the tick's own rows and listing):
 *  1. `$REG/hibernate-disabled` listed → nothing is read and nothing is logged;
 *  2. N is `$REG/hibernate-after-hours` when listed (read then, and only then), else the default;
 *  3. per row with a registry record: the store's answers (open runs as worker through `openRunsForSession` and as
 *     claimant through `openRunsClaimedBy`, both `state NOT IN` the terminal set; the live claims, read once a pass;
 *     outstanding mail), `Presence.isOpen`, the opt-out marker from the listing; a read that fails, or no store at
 *     all, holds `runs-unreadable`;
 *  4. a row the verdict answers `measure` for has its raw live word and its turn marker read, and is asked again;
 *  5. a `hibernate` answer logs `ccrc-server: hibernate-shadow <id> idle=<h>h`, at most once per id per
 *     `HIBERNATE_SHADOW_LINE_MS`, and nothing else happens.
 *
 * The verdict holds every candidate `viewer` for `PRESENCE_OPEN_TTL_MS` after `startedAt`, the process start the
 * watcher hands it: presence is never persisted, and a hidden tab that has not reconnected after a deploy is not an
 * empty screen.
 */

export interface HibernateSweepDeps {
  /** Undefined without a coordination store: every row then holds `runs-unreadable`. */
  readonly coord: Pick<CoordStore, 'openRunsForSession' | 'openRunsClaimedBy' | 'activeClaims' | 'outstandingMailFor'> | undefined;
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
}

export interface HibernateShadowMemory {
  /** The last shadow line per id. Pruned of ids the pass no longer sees. */
  readonly lastLine: Map<string, number>;
}

export interface HibernateShadowOutcome { readonly id: string; readonly verdict: HibernateVerdict }

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

/** One shadow pass. Returns every row's verdict, for the tests; its only effect is the log. */
export async function hibernateShadowPass(
  deps: HibernateSweepDeps, mem: HibernateShadowMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<HibernateShadowOutcome[]> {
  if (names.includes(HIBERNATE_DISABLED_MARKER)) return [];
  const afterMs = hibernateAfterMs(names.includes(HIBERNATE_AFTER_HOURS_FILE) ? await deps.readAfterHours() : null);
  const byId = new Map(records.map((r) => [r.id, r] as const));
  let claimants: ReadonlySet<string> | null = null;
  try {
    if (deps.coord !== undefined) claimants = new Set(deps.coord.activeClaims().map((c) => c.heldBy));
  } catch {
    claimants = null;
  }
  const out: HibernateShadowOutcome[] = [];
  for (const s of sessions) {
    const rec = byId.get(s.id);
    if (rec === undefined) continue;
    const row: HibernateRow = s;
    const input = (live: HibernateLive, at: number): HibernateInput => ({
      row, optedOut: names.includes(`${s.id}.${NO_HIBERNATE_SUFFIX}`), store: storeRead(deps.coord, claimants, s.id),
      viewer: deps.presence?.isOpen(s.id) ?? false, sinceStartMs: at - deps.startedAt, live,
    });
    let now = deps.now();
    let v = hibernateVerdict(input({ kind: 'unread' }, now), now, afterMs);
    if (v.act === 'measure') {
      const live = await readLive(deps, rec);
      now = deps.now();
      v = hibernateVerdict(input(live, now), now, afterMs);
    }
    out.push({ id: s.id, verdict: v });
    if (v.act !== 'hibernate') continue;
    const last = mem.lastLine.get(s.id);
    if (last !== undefined && now - last < HIBERNATE_SHADOW_LINE_MS) continue;
    mem.lastLine.set(s.id, now);
    deps.log(`ccrc-server: hibernate-shadow ${s.id} idle=${Math.floor(v.idleMs / (60 * 60_000))}h`);
  }
  const seen = new Set(sessions.map((s) => s.id));
  for (const id of [...mem.lastLine.keys()]) if (!seen.has(id)) mem.lastLine.delete(id);
  return out;
}
