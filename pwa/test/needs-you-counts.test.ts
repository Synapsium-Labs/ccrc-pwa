// T2d (D-6330): the Inbox and Runs badges count only what waits on the operator. The pure counts live in
// `fleet/navBadges.ts`: `waitingOnYou` (the sessions in the `attention` bucket, `operatorAsk`), `runsNeedYou` (the open
// runs whose worker or coordinator session is waiting, a run counted once), `runsLineLabel` (the fleet's runs line) and
// `badgePrint` (the one printed cap). `null` inputs answer `null`: "not heard yet" is not zero.
//
// MUTATION TABLE (plan Task T2d Step 3; RUN at 3f0d1b78c, each mutant on the working tree, the named suites alone, then
// restored from a saved copy; every row killed):
//   the Inbox badge back to every unacked record (`useNavBadges` reads the feed's length)
//                                                        refined-shell "no badge at zero; …", instrument-shell "the rail's
//                                                        Inbox door says 'waiting for you' …" and "with nobody waiting …"
//   `waitingOnYou` counts every session ................ "a session in the attention bucket is counted, a held child is not",
//                                                        refined-shell "no badge at zero; …"
//   a badge at 0 (AppBar `count >= 0 &&`) .............. refined-shell "no badge at zero; …" (and the bar's order case)
//   "active" counting `planned` ........................ "the runs line: active counts …", fleet-screen "Runs · active counts
//                                                        dispatched, working and unknown only"
//   `0` before the runs frame .......................... "null before the fleet frame; null before the runs frame" (a door
//                                                        hides 0 and null alike, so only this case can see it)
//   the rail's Inbox door left on the unread count ..... instrument-shell "the rail's Inbox door says 'waiting for you' …"
//                                                        and "with nobody waiting …"
//   a second print-cap literal (AppBar's own PRINT_CAP)  "the badge's print cap has one definition"
//   `runsNeedYou` ignores the coordinator .............. "a run counts only while …", refined-shell "the Runs badge counts …"
//   `runsNeedYou` counts a closed run .................. "a run counts only while …", refined-shell "the Runs badge counts …"
//   FleetScreen's mail door ungated on the fleet frame . fleet-screen "the mail door counts the sessions waiting on the
//                                                        operator, never the unread mail"
//   `useNavBadges` ungated on the fleet frame .......... refined-shell "no badge at zero; …", instrument-shell (three cases)
// R32's F5, moved to the Inbox's own rows (mail-screen.test.tsx):
//   MailScreen's row mark without `isUnseenAt(...)` .... "a row at the ack's own stamp, or before it, is not unseen; …"
//   `isUnseenAt` as `>=` ............................... the same case
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVE_RUN_STATES, IDLE_RUN_STATES, type RunState, type RunSummary } from '../../shared/api';
import { BADGE_PRINT_CAP, badgePrint, runsLineLabel, runsNeedYou, waitingOnYou } from '../src/fleet/navBadges';
import { fleetSession } from './fleetFixture';

const SRC_DIR = path.join(import.meta.dirname, '..', 'src');

const attention = (id: string) => fleetSession({ id, bucket: 'attention' });
const idle = (id: string) => fleetSession({ id, bucket: 'idle' });
const run = (id: number, state: RunState, sessionId: string | null, claimedBy: string | null): RunSummary =>
  ({ id, program: 'p', state, closedAt: null, sessionId, claimedBy }) as unknown as RunSummary;
const runIn = (state: RunState): RunSummary => run(1, state, null, null);

describe('the needs-you counts (T2d, D-6330)', () => {
  it('a session in the attention bucket is counted, a held child is not', () => {
    const held = fleetSession({
      id: 'child-held', bucket: 'working', hookState: 'waiting', child: { kind: 'child', runId: 7 },
      withCoordinator: { kind: 'question', parentId: 'coordinator-a', since: 4000, notifyAt: 184_000 },
    });
    expect(waitingOnYou([attention('a'), attention('b'), held, idle('c')])).toBe(2);
  });

  it('a run counts only while its worker or coordinator waits on the operator', () => {
    const sessions = [attention('w1'), attention('c1'), attention('w2'), attention('c2'), idle('i1'), idle('i2'), attention('w6')];
    const runs = [
      run(1, 'working', 'w1', 'i1'), // worker waits: counts
      run(2, 'working', 'i1', 'c1'), // coordinator waits: counts
      run(3, 'working', 'w2', 'c2'), // both wait: counts once
      run(4, 'working', 'i1', 'i2'), // idle sessions only: no
      run(5, 'done', 'w6', 'i2'), // closed: no
      run(6, 'working', 'ghost-a', 'ghost-b'), // on no session: no
    ];
    expect(runsNeedYou(runs, sessions)).toBe(3);
  });

  it('null before the fleet frame; null before the runs frame', () => {
    const s = [attention('a')];
    const r = [run(1, 'working', 'a', null)];
    expect(waitingOnYou(null)).toBeNull();
    expect(runsNeedYou(null, s)).toBeNull();
    expect(runsNeedYou(r, null)).toBeNull();
    expect(waitingOnYou([])).toBe(0);
    expect(runsNeedYou([], [])).toBe(0);
  });

  it('the runs line: active counts dispatched, working and unknown only; open when none is active', () => {
    expect(runsLineLabel(null)).toBe('—');
    expect(runsLineLabel(([...ACTIVE_RUN_STATES, 'planned', 'awaiting-review'] as RunState[]).map(runIn))).toBe('3 active');
    expect(runsLineLabel(IDLE_RUN_STATES.filter((s) => s === 'planned' || s === 'merging').map(runIn))).toBe('2 open');
    // a state this build does not know reads `unknown` (runState), which is active
    expect(runsLineLabel([runIn('from-a-newer-server' as RunState)])).toBe('1 active');
    expect(runsLineLabel(['done', 'failed'].map((s) => runIn(s as RunState)))).toBe('none active');
  });

  it('a badge prints its count up to the cap, and the cap and a plus past it', () => {
    expect(badgePrint(1)).toBe('1');
    expect(badgePrint(BADGE_PRINT_CAP)).toBe('99');
    expect(badgePrint(BADGE_PRINT_CAP + 1)).toBe('99+');
  });

  it("the badge's print cap has one definition", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const code = new Map(files(SRC_DIR).map((f) => [
      path.relative(SRC_DIR, f).split(path.sep).join('/'),
      readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    ]));
    // (a) one file assigns a name ending in PRINT_CAP: the constant every door reads
    const defining = [...code].filter(([, text]) => /\b\w*PRINT_CAP\s*=/.test(text)).map(([f]) => f);
    expect(defining).toEqual(['fleet/navBadges.ts']);
    // (b) no other file prints a cap of its own: a `${...cap...}+` template (any case) or a literal '99+' in any quotes
    const printing = [...code]
      .filter(([f, text]) => f !== 'fleet/navBadges.ts' && (/\$\{\w*CAP\w*\}\+/i.test(text) || /['"`]99\+['"`]/.test(text)))
      .map(([f]) => f);
    expect(printing).toEqual([]);
  });
});
