// T2d (D-6330): the Inbox and Runs badges count only what waits on the operator. The pure counts live in
// `fleet/navBadges.ts`: `waitingOnYou` (the sessions in the `attention` bucket, `operatorAsk`), `runsNeedYou` (the open
// runs whose worker or coordinator session is waiting, a run counted once), `runsLineLabel` (the fleet's runs line) and
// `badgePrint` (the one printed cap). `null` inputs answer `null`: "not heard yet" is not zero.
//
// MUTATION TABLE (plan Task T2d Step 3)
import { describe, expect, it } from 'vitest';
import { ACTIVE_RUN_STATES, IDLE_RUN_STATES, type RunState, type RunSummary } from '../../shared/api';
import { BADGE_PRINT_CAP, badgePrint, runsLineLabel, runsNeedYou, waitingOnYou } from '../src/fleet/navBadges';
import { fleetSession } from './fleetFixture';

const attention = (id: string) => fleetSession({ id, bucket: 'attention' });
const idle = (id: string) => fleetSession({ id, bucket: 'idle' });
const run = (id: number, state: RunState, sessionId: string | null, claimedBy: string | null): RunSummary =>
  ({ id, program: 'p', state, closedAt: null, sessionId, claimedBy }) as unknown as RunSummary;
const runIn = (state: RunState): RunSummary => run(1, state, null, null);

describe('the needs-you counts (T2d, D-6330)', () => {
  it('a session in the attention bucket is counted, a held child is not', () => {
    const held = fleetSession({ id: 'child-held', bucket: 'working', child: { kind: 'none' } });
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
    expect(runsLineLabel([...ACTIVE_RUN_STATES, 'planned', 'awaiting-review'].map(runIn))).toBe('3 active');
    expect(runsLineLabel(IDLE_RUN_STATES.filter((s) => s === 'planned' || s === 'merging').map(runIn))).toBe('2 open');
    expect(runsLineLabel(['done', 'failed'].map((s) => runIn(s as RunState)))).toBe('none active');
  });

  it('a badge prints its count up to the cap, and the cap and a plus past it', () => {
    expect(badgePrint(1)).toBe('1');
    expect(badgePrint(BADGE_PRINT_CAP)).toBe('99');
    expect(badgePrint(BADGE_PRINT_CAP + 1)).toBe('99+');
  });
});
