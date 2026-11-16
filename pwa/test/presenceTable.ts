// The test-side presence table (D-7179; Task C7a, §Task C7c Step 1; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 19; ARCH-49). Two things, both test-only:
//
// 1. THE LIVENESS TRUTH TABLE as the PWA sees it: every row ARCH-47's table places (`server/src/sessionReading.ts`'s
//    facts: the registry row, the pane, the lifecycle, the hibernation stamp), each beside the `FleetSession` the
//    assembly (`server/src/fleet.ts#assembleFleet`) sends for it and the `presence` the server derives, so a PWA site's
//    verdict can be read row by row beside the server's (`w7-presence-table.test.ts`).
// 2. THE INVERSE RULE, stated once: from a `FleetSession`'s `status`, `lifecycle`, `hibernatedAt` and `substrate` back to
//    the facts `readSession` reads, and the presence those facts give. C7c Step 1 derives a fixture's `presence` through
//    it. The rule: a live `status` (anything but `'dead'`) is a `live` pane; `status: 'dead'` is a GONE pane (a test that
//    means an unknown pane, D-309's other half, passes `presence: 'unknown'` itself); `lifecycle` and `hibernatedAt` are
//    read as given; `substrate` (the registry's fault stamp) is carried, never turned into a pane verdict. A dead row
//    with no lifecycle is the old-server SKEW row: no server since ARCH-48 sends it, and the rule leaves its presence
//    absent, as such a server does, so it reads `unknown`.
//
// `server/test/w7-presence-parity.test.ts` imports this file by path and holds it two ways: the ladder below equal to
// `readSession` row by row, and the inverse rule equal to `assembleFleet` (a `FleetSession` the assembly sends, read
// back through the rule, gives the `presence` the assembly put on it). The PWA package imports no server code; the
// ladder here is the copy that test keeps honest.
import { lifecycleIsDead, type FleetSession, type Presence, type SessionLifecycle } from '../../shared/api';

/** The registry's word for the one id (`sessionReading.ts#RowFact`). */
export type RowFact = 'present' | 'absent' | 'unmeasurable' | 'unlistable' | 'bad-id';
/** tmux's verdict on the pane, `null` when it was not asked (`sessionReading.ts#PaneFact`). */
export type PaneFact = 'live' | 'gone' | 'unknown' | null;

/** `readSession`'s facts, the parts this table varies (`turn` and `viewer` never move `presence`). */
export interface PresenceFacts {
  readonly row: RowFact;
  readonly pane: PaneFact;
  readonly lifecycle: SessionLifecycle | null;
  readonly hibernatedAt: number | null;
  readonly turn: 'busy' | 'idle' | 'shell' | null;
}

/** The ladder, `readSession`'s presence over its facts (held equal to it by `w7-presence-parity.test.ts`). */
export function presenceOfFacts(f: PresenceFacts): Presence {
  if (f.row === 'absent') return 'dead';
  if (f.row !== 'present') return 'unknown';
  if (f.pane === 'live') return 'alive';
  if (f.pane === 'unknown' || f.pane === null) return 'unknown';
  const lc = f.lifecycle;
  if (lc === 'stopped' && f.hibernatedAt !== null) return 'asleep';
  if (lc === null || lc === 'unmeasurable') return 'unknown';
  return lifecycleIsDead(lc) ? 'dead' : 'alive';
}

/** The parts of a `FleetSession` the inverse rule reads. */
export type RuleInput = Pick<FleetSession, 'status' | 'lifecycle' | 'hibernatedAt' | 'substrate'>;

/** The inverse rule: a fleet row back to `readSession`'s facts, or `null` for the skew row (a dead row with no
 *  lifecycle). The row is always `present` (the assembly lists only registry rows it read). */
export function factsOf(s: RuleInput): PresenceFacts | null {
  const lifecycle = s.lifecycle ?? null;
  if (s.status === 'dead') {
    if (lifecycle === null) return null;
    return { row: 'present', pane: 'gone', lifecycle, hibernatedAt: s.hibernatedAt ?? null, turn: null };
  }
  return { row: 'present', pane: 'live', lifecycle, hibernatedAt: s.hibernatedAt ?? null, turn: s.status };
}

/** The presence the rule gives a fleet row; `undefined` (no key, so it reads `unknown`) for the skew row. */
export function tablePresence(s: RuleInput): Presence | undefined {
  const f = factsOf(s);
  return f === null ? undefined : presenceOfFacts(f);
}

/** The lifecycles `sessionLifecycle` returns with a live pane, and with the pane not live (`alive: false`). */
export const LIVE_LIFECYCLES: readonly SessionLifecycle[] = ['running', 'unsupervised', 'unclaimed', 'unmeasurable'];
export const GONE_LIFECYCLES: readonly SessionLifecycle[] = ['stopped', 'restarting', 'orphan', 'never-started', 'unmeasurable'];

/** The hibernation stamp a row carries when it has one (epoch ms), and the substrate fault a faulted row carries. */
export const HIBERNATED_AT = 1_784_500_000_000;
export const SUBSTRATE_FAULT = { at: 1_784_500_100_000, text: 'tmux server unreachable' } as const;

/** Which group a row is printed in: what the server can produce (OA-C15 is ruled on these), a registry fact the
 *  fleet never lists (no row in the frame at all), or the old-server skew row. */
export type RowGroup = 'server' | 'unlisted' | 'skew';

/** One row of the table. `session` is the `FleetSession` the assembly sends for it (`null` for an unlisted row: the
 *  frame carries none), `presence` the server's word (the skew row's is `undefined`: such a server sends no key). */
export interface TableRow {
  readonly name: string;
  readonly group: RowGroup;
  readonly facts: PresenceFacts;
  readonly substrate: boolean;
  readonly presence: Presence | undefined;
  readonly session: TableSession | null;
}

/** The stop stamp a `stopped` row carries (the assembly sends `stoppedBy` from the same `.stopped` file). */
export const STOPPED_BY = { at: 1_784_400_000_000, surface: 'ccd' } as const;

/** The parts of a fleet row the table sets: the assembly's status (`dead` for any pane not live, D-309), its bucket
 *  for that status, the lifecycle, the stop stamp a `stopped` row carries, the hibernation stamp and the fault. */
export type TableSession = RuleInput & Pick<FleetSession, 'bucket' | 'stoppedBy'>;

const sessionFor = (pane: PaneFact, lifecycle: SessionLifecycle | null, hib: boolean, sub: boolean): TableSession => ({
  status: pane === 'live' ? 'idle' : 'dead',
  bucket: pane === 'live' ? 'idle' : 'dead',
  lifecycle,
  stoppedBy: lifecycle === 'stopped' ? STOPPED_BY : null,
  hibernatedAt: hib ? HIBERNATED_AT : null,
  substrate: sub ? SUBSTRATE_FAULT : null,
});

/** Every row: the server-producible grid (pane live × the live lifecycles, pane gone and pane unknown × the not-live
 *  lifecycles, each × hibernation stamp × substrate fault), the four registry facts the frame never lists, and the skew
 *  row (pane gone, lifecycle absent). */
export function tableRows(): TableRow[] {
  const out: TableRow[] = [];
  for (const row of ['absent', 'unmeasurable', 'unlistable', 'bad-id'] as const) {
    const facts: PresenceFacts = { row, pane: null, lifecycle: null, hibernatedAt: null, turn: null };
    out.push({ name: `row ${row}`, group: 'unlisted', facts, substrate: false, presence: presenceOfFacts(facts), session: null });
  }
  const grid: Array<[PaneFact, readonly SessionLifecycle[]]> = [['live', LIVE_LIFECYCLES], ['gone', GONE_LIFECYCLES], ['unknown', GONE_LIFECYCLES]];
  for (const [pane, lifecycles] of grid) {
    for (const lc of lifecycles) {
      for (const hib of [false, true]) {
        for (const sub of [false, true]) {
          const facts: PresenceFacts = { row: 'present', pane, lifecycle: lc, hibernatedAt: hib ? HIBERNATED_AT : null, turn: pane === 'live' ? 'idle' : null };
          out.push({
            name: `pane ${pane} · ${lc}${hib ? ' · hibernated' : ''}${sub ? ' · substrate fault' : ''}`,
            group: 'server', facts, substrate: sub, presence: presenceOfFacts(facts), session: sessionFor(pane, lc, hib, sub),
          });
        }
      }
    }
  }
  const skew: PresenceFacts = { row: 'present', pane: 'gone', lifecycle: null, hibernatedAt: null, turn: null };
  out.push({ name: 'skew · pane gone · lifecycle absent (a server older than ARCH-48)', group: 'skew', facts: skew, substrate: false, presence: undefined, session: sessionFor('gone', null, false, false) });
  return out;
}
