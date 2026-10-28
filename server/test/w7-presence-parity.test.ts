// The PWA's test-side presence table, held to the server two ways (D-7179; Task C7a; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 19 and §Task C7c Step 1; ARCH-49).
//
// `pwa/test/presenceTable.ts` is imported by path (the `ask-pairing-table.test.ts` precedent: the server does not
// depend on the PWA, so the module is loaded dynamically and typed here). It is held:
//   1. equal to `server/src/sessionReading.ts#readSession`, row by row, over every fact combination (its ladder is the
//      PWA's copy of the server's, and this is what keeps the copy honest);
//   2. equal to `server/src/fleet.ts#assembleFleet` (a stubbed tmux verdict and a seeded registry row per table row, the
//      `bucket.test.ts` seam): the `FleetSession` the assembly sends, read back through the table's inverse rule, gives
//      the `presence` the assembly put on it.
// Printed apart: the rows where tmux did not answer. The assembly writes `status: 'dead'` for an unknown pane as for a
// gone one (D-309) and sends `presence: 'unknown'`; the inverse rule cannot tell the two from the status, so a test that
// means an unknown pane passes `presence: 'unknown'` itself (§Task C7c Step 1). And the skew row: a dead row with no
// lifecycle, which no server since ARCH-48 sends, has no `presence` from the rule and reads `unknown`, as
// `readSession` reads its facts.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_LIFECYCLES, type FleetSession, type Presence, type SessionLifecycle } from '../../shared/api.js';
import { readSession, type SessionFacts } from '../src/sessionReading.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { degradedReadIO } from './ioDoubles.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type RowFact = SessionFacts['row'];
type PaneFact = SessionFacts['pane'];
interface PresenceFacts { row: RowFact; pane: PaneFact; lifecycle: SessionLifecycle | null; hibernatedAt: number | null; turn: 'busy' | 'idle' | 'shell' | null }
type RuleInput = Pick<FleetSession, 'status' | 'lifecycle' | 'hibernatedAt' | 'substrate'>;
interface TableRow {
  name: string; group: 'server' | 'unlisted' | 'skew'; facts: PresenceFacts; substrate: boolean;
  presence: Presence | undefined; session: (RuleInput & Pick<FleetSession, 'bucket'>) | null;
}
interface PresenceTable {
  presenceOfFacts: (f: PresenceFacts) => Presence;
  factsOf: (s: RuleInput) => PresenceFacts | null;
  tablePresence: (s: RuleInput) => Presence | undefined;
  tableRows: () => TableRow[];
  HIBERNATED_AT: number;
}
const table = async (): Promise<PresenceTable> => await import(path.join(ROOT, 'pwa/test/presenceTable.ts')) as PresenceTable;

const ROWS: readonly RowFact[] = ['present', 'absent', 'unmeasurable', 'unlistable', 'bad-id'];
const PANES: readonly PaneFact[] = ['live', 'gone', 'unknown', null];

describe('the PWA presence table equals readSession, row by row', () => {
  it('every row × pane × lifecycle (each word and none) × hibernation stamp', async () => {
    const t = await table();
    const rows: string[] = [];
    for (const row of ROWS) {
      for (const pane of PANES) {
        for (const lifecycle of [...SESSION_LIFECYCLES, null]) {
          for (const hibernatedAt of [null, t.HIBERNATED_AT]) {
            const f: PresenceFacts = { row, pane, lifecycle, hibernatedAt, turn: null };
            const want = readSession(f).presence;
            if (t.presenceOfFacts(f) !== want) rows.push(`${row} ${String(pane)} ${String(lifecycle)} ${String(hibernatedAt)}: table ${t.presenceOfFacts(f)}, readSession ${want}`);
          }
        }
      }
    }
    expect(rows).toEqual([]);
  });

  it('each table row\'s presence is readSession\'s over its facts; the skew row reads unknown with no key', async () => {
    const t = await table();
    for (const r of t.tableRows()) {
      const want = readSession(r.facts).presence;
      expect(r.presence ?? 'unknown', r.name).toBe(want);
      if (r.session !== null) expect(t.tablePresence(r.session) ?? 'unknown', `${r.name}: the inverse rule over the row's session`).toBe(r.group === 'server' && r.facts.pane === 'unknown' ? t.presenceOfFacts({ ...r.facts, pane: 'gone' }) : want);
    }
    const skew = t.tableRows().filter((r) => r.group === 'skew');
    expect(skew.map((r) => [r.facts.pane, r.facts.lifecycle, r.presence, readSession(r.facts).presence])).toEqual([['gone', null, undefined, 'unknown']]);
    expect(t.tablePresence(skew[0]!.session!)).toBeUndefined();
  });
});

// ─── the assembly seam ───────────────────────────────────────────────────────────────────────────────────────────

const NOW_S = 1_784_600_000;
const ID = 'session-a';

/** One registry row, seeded so `sessionLifecycle` derives `lc` (the field files
 *  `lifecycleInputFor` reads; the pane is tmux's, below), with the hibernation stamp and the substrate fault when asked. */
const seed = (home: string, lc: SessionLifecycle, hib: boolean, sub: boolean): FleetIO => {
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: 'u-session-a', started: '1' };
  if (lc === 'running' || lc === 'restarting') fields['supervised'] = String(NOW_S);
  if (lc === 'stopped') fields['stopped'] = `${NOW_S - 60} ccd`;
  if (lc === 'unclaimed' || lc === 'never-started') delete fields['started'];
  if (hib) fields['hibernated'] = `${NOW_S - 600} 7`;
  if (sub) fields['substrate'] = `${NOW_S - 30} tmux server unreachable`;
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  // `unmeasurable`: a lifecycle field the registry listed and could not read back (`.started`, D-1140's row).
  return lc === 'unmeasurable' ? degradedReadIO((p) => p.endsWith(`${ID}.started`)) : localIO;
};

const tmuxSaying = (pane: 'live' | 'gone' | 'unknown'): Tmux => {
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') {
      return pane === 'live' ? { ran: true, code: 0, stdout: '', stderr: '' }
        : pane === 'gone' ? { ran: true, code: 1, stdout: '', stderr: "can't find session: cc-session-a" }
          : { ran: true, code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-0/default' };
    }
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return new Tmux(run);
};

describe('the PWA presence table equals assembleFleet (the bucket.test.ts seam)', () => {
  it('every server-producible row: the assembled session, read back through the inverse rule, gives the assembly\'s presence', async () => {
    const t = await table();
    const rows = t.tableRows().filter((r) => r.group === 'server');
    const held: string[] = [];
    const unknownPane: string[] = [];
    for (const r of rows) {
      const pane = r.facts.pane as 'live' | 'gone' | 'unknown';
      const home = mkTmp('ccrc-w7-presence-');
      const io = seed(home, r.facts.lifecycle!, r.facts.hibernatedAt !== null, r.substrate);
      const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), tmuxSaying(pane), NOW_S);
      const s = fleet.find((x) => x.id === ID);
      expect(s, r.name).toBeDefined();
      // The seed reached the row the table names: its lifecycle, its stamp, its fault, the assembly's status.
      expect([s!.lifecycle, s!.hibernatedAt !== null, s!.substrate !== null, s!.status === 'dead'], r.name)
        .toEqual([r.facts.lifecycle, r.facts.hibernatedAt !== null, r.substrate, pane !== 'live']);
      expect(s!.presence, `${r.name}: the assembly's presence is the table's`).toBe(r.presence);
      if (pane === 'unknown') {
        unknownPane.push(`${r.name}: assembly ${String(s!.presence)}, inverse rule ${String(t.tablePresence(s!))}`);
        expect(s!.presence).toBe('unknown');
      } else {
        expect(t.tablePresence(s!), `${r.name}: the inverse rule over the assembled session`).toBe(s!.presence);
        held.push(r.name);
      }
    }
    console.log(`w7-presence-parity: ${held.length} rows held to the assembly; ${unknownPane.length} pane-unknown rows printed apart (D-309)\n${unknownPane.map((x) => `  ${x}`).join('\n')}`);
    expect(held.length).toBe(36);
    expect(unknownPane.length).toBe(20);
  });
});
