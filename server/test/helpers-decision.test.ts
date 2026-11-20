// Session helpers H1a: the pure decision of an Agent helper's state (spec 2026-11-19 §3.2, Figure 2), the
// exclusion of workflow agents from the Agent rows, the keep of a finished helper, the frame gate, and every bound
// of the Agent arm (review 2900 F9). Pure: every input is a value, no fs, no clock, no timer.
//
// RED FIRST: this file is committed before the code it tests, against origin/main, where none of it exists.
import { describe, expect, it } from 'vitest';
import {
  HELPER_DESCRIPTION_MAX,
  HELPER_FACTS_MAX,
  HELPER_FINISHED_KEEP_MS,
  HELPER_KEPT_MAX,
  HELPER_LABEL_MAX,
  HELPER_LISTED_MAX,
  HELPER_NONFINAL_MAX,
  HELPER_SUMMARY_MAX_BYTES,
  WORKFLOW_AGENT_TYPE,
  WORKFLOW_KEPT_AGENTS_MAX,
  AGENT_HELPER_STATES,
  AGENT_HELPER_STATE_WORDS,
  isFinalHelperState,
  type AgentHelperState,
  type WorkflowView,
} from '../../shared/workflows.js';
import {
  capKeptWorkflow,
  decideAgentHelpers,
  emptyHelperMemory,
  foldHelperFacts,
  frameDue,
  isFinishedKept,
  isWorkflowAgentName,
  type AgentArm,
  type AgentArmInput,
  type HelperIdFacts,
  type HelperMeta,
  type Proc,
  type RosterInput,
} from '../src/workflows/model.js';
import type { HelperFact } from '../src/transcript/parse.js';

const NOW = 1_800_000_000_000;
const ROSTER_AT = NOW - 1_000;
const MIN = 60_000;
const LIVE: Proc = { kind: 'live', startedAt: NOW - 3_600_000 };

const usable = (ids: Array<string | null>, at = ROSTER_AT): RosterInput => ({
  kind: 'usable',
  at,
  entries: ids.map((id, i) => ({ id, name: 'Explore', startedAt: NOW - 100_000 + i })),
});
const meta = (o: Partial<HelperMeta> = {}): HelperMeta => ({
  path: 'agent', agentType: 'Explore', description: 'look around', model: 'claude-sonnet-5-5', effort: 'high',
  finished: false, lastWriteAt: null, tokens: null, ...o,
});
const facts = (o: Partial<HelperIdFacts> = {}): HelperIdFacts => ({ launch: null, end: null, ...o });
const asyncLaunch = (at: number | null): NonNullable<HelperIdFacts['launch']> => ({ at, model: 'claude-opus-5-5', async: true, durationMs: null });
const end = (outcome: 'done' | 'failed' | 'stopped', at: number | null, from: 'notification' | 'launch' = 'notification'): NonNullable<HelperIdFacts['end']> =>
  ({ outcome, at, summary: 'one line', hasReport: true, from });

interface Setup {
  roster?: RosterInput;
  proc?: Proc;
  facts?: Record<string, HelperIdFacts>;
  metas?: Record<string, HelperMeta>;
  memory?: AgentArmInput['memory'];
  now?: number;
}
const run = (s: Setup = {}): AgentArm =>
  decideAgentHelpers({
    now: s.now ?? NOW,
    roster: s.roster ?? usable([]),
    proc: s.proc ?? LIVE,
    facts: new Map(Object.entries(s.facts ?? {})),
    metas: new Map(Object.entries(s.metas ?? {})),
    memory: s.memory ?? emptyHelperMemory(),
  });
const stateOf = (arm: AgentArm, id: string): AgentHelperState | undefined => arm.agents.find((a) => a.id === id)?.state;
const row = (arm: AgentArm, id: string) => arm.agents.find((a) => a.id === id)!;

describe('the states and their words (shared, L0)', () => {
  it('the runtime list derives from the type: the nine states, in one place', () => {
    expect([...AGENT_HELPER_STATES].sort()).toEqual(['done', 'failed', 'finished', 'gone', 'launched', 'running', 'stopped', 'unlisted', 'unmeasured']);
  });
  it('exactly done, failed, stopped and finished are final', () => {
    expect(AGENT_HELPER_STATES.filter(isFinalHelperState).sort()).toEqual(['done', 'failed', 'finished', 'stopped']);
  });
  it('the words: unlisted reads "no longer listed", gone reads "session ended", and a state left out has no word', () => {
    expect(AGENT_HELPER_STATE_WORDS.unlisted).toBe('no longer listed');
    expect(AGENT_HELPER_STATE_WORDS.gone).toBe('session ended');
    expect(AGENT_HELPER_STATE_WORDS.unmeasured).toBeNull();
    expect(AGENT_HELPER_STATE_WORDS.running).toBe('running');
    expect(AGENT_HELPER_STATE_WORDS.launched).toBe('launched');
  });
});

describe('Figure 2: the decision, strongest measured fact first', () => {
  const A = 'a1';
  const base = (o: Setup = {}): Setup => ({ metas: { [A]: meta() }, ...o });

  describe('a final task notification, or a completed launch result, decides first', () => {
    it.each([
      ['done', 'done'],
      ['failed', 'failed'],
      ['stopped', 'stopped'],
    ] as const)('%s: the state is %s, and ranks above a roster that lists the id, a process that is gone and a meta marker', (outcome, want) => {
      const arm = run(base({
        facts: { [A]: facts({ launch: asyncLaunch(NOW - 5 * MIN), end: end(outcome, NOW - 2 * MIN) }) },
        roster: usable([A]),
        proc: { kind: 'gone' },
        metas: { [A]: meta({ finished: true }) },
      }));
      expect(stateOf(arm, A)).toBe(want);
    });

    it('a foreground helper: its completed launch result is the end, its report the row\'s, its start is the end less the duration', () => {
      const arm = run({
        metas: { [A]: meta() },
        facts: { [A]: facts({ launch: { at: NOW - 2 * MIN, model: null, async: false, durationMs: 90_000 }, end: end('done', NOW - 2 * MIN, 'launch') }) },
      });
      const r = row(arm, A);
      expect(r).toMatchObject({ state: 'done', endedAt: NOW - 2 * MIN, startedAt: NOW - 2 * MIN - 90_000, hasReport: true, summary: 'one line' });
    });

    it('a foreground helper with no duration has no start from the launch: the roster\'s startedAt, else null', () => {
      const arm = run({
        metas: { [A]: meta() },
        facts: { [A]: facts({ launch: { at: NOW - 2 * MIN, model: null, async: false, durationMs: null }, end: end('done', NOW - 2 * MIN, 'launch') }) },
        roster: { kind: 'usable', at: ROSTER_AT, entries: [{ id: A, name: 'Explore', startedAt: NOW - 3 * MIN }] },
      });
      expect(row(arm, A).startedAt).toBe(NOW - 3 * MIN);
      const none = run({
        metas: { [A]: meta() },
        facts: { [A]: facts({ launch: { at: NOW - 2 * MIN, model: null, async: false, durationMs: null }, end: end('done', NOW - 2 * MIN, 'launch') }) },
      });
      expect(row(none, A).startedAt).toBeNull();
    });

    it('a notification with no report says hasReport false', () => {
      const arm = run(base({ facts: { [A]: facts({ end: { outcome: 'stopped', at: NOW - MIN, summary: null, hasReport: false, from: 'notification' } }) } }));
      expect(row(arm, A)).toMatchObject({ state: 'stopped', hasReport: false, summary: null });
    });
  });

  describe('the meta\'s finished marker comes next', () => {
    it('finished, with its end the helper transcript\'s last write, ranks above a process gone and a roster that lists it', () => {
      const arm = run(base({ metas: { [A]: meta({ finished: true, lastWriteAt: NOW - 3 * MIN }) }, proc: { kind: 'gone' }, roster: usable([A]) }));
      expect(row(arm, A)).toMatchObject({ state: 'finished', endedAt: NOW - 3 * MIN, hasReport: false });
    });
  });

  describe('a process that is gone cannot be running a helper', () => {
    it('gone, even when the roster lists the id and even when the roster is unusable', () => {
      expect(stateOf(run(base({ proc: { kind: 'gone' }, roster: usable([A]) })), A)).toBe('gone');
      expect(stateOf(run(base({ proc: { kind: 'gone' }, roster: { kind: 'unusable', why: { why: 'stale', hookAgeMs: 40 * MIN } } })), A)).toBe('gone');
    });
    it('an unmeasured process is NOT gone: it decides nothing and the roster is asked', () => {
      expect(stateOf(run(base({ proc: { kind: 'unmeasured' }, roster: usable([A]) })), A)).toBe('running');
    });
    it('a gone helper has no end time and claims no end: it never enters the fold', () => {
      const r = row(run(base({ proc: { kind: 'gone' } })), A);
      expect(r.endedAt).toBeNull();
      expect(isFinalHelperState(r.state)).toBe(false);
    });
  });

  describe('a roster that cannot be used leaves the state out', () => {
    it.each([
      [{ why: 'stale', hookAgeMs: 41 * MIN }],
      [{ why: 'absent' }],
      [{ why: 'unreadable' }],
      [{ why: 'foreign' }],
      [{ why: 'unregistered' }],
    ] as const)('%j: the state is left out (unmeasured) and the frame says why, once', (why) => {
      const arm = run(base({ roster: { kind: 'unusable', why } }));
      expect(stateOf(arm, A)).toBe('unmeasured');
      expect(arm.unmeasured).toEqual(why);
    });
  });

  describe('running: listed on a usable roster', () => {
    it('a listed id is running, whatever else (a launch fact, a seen listing) says', () => {
      expect(stateOf(run(base({ roster: usable([A]) })), A)).toBe('running');
      expect(stateOf(run(base({ roster: usable([A]), facts: { [A]: facts({ launch: asyncLaunch(NOW) }) } })), A)).toBe('running');
    });
    it('a listing ranks above "launched": a roster read after the launch that lists the id is positive evidence', () => {
      const arm = run(base({ roster: usable([A], ROSTER_AT), facts: { [A]: facts({ launch: asyncLaunch(ROSTER_AT + 5_000) }) } }));
      expect(stateOf(arm, A)).toBe('running');
    });
    it('the row carries what is measured: description, kind, model, effort, last activity, tokens', () => {
      const arm = run(base({ roster: usable([A]), metas: { [A]: meta({ lastWriteAt: NOW - 20_000, tokens: 41_000 }) } }));
      expect(row(arm, A)).toMatchObject({
        id: A, description: 'look around', agentType: 'Explore', model: 'claude-sonnet-5-5', effort: 'high',
        lastActivityAt: NOW - 20_000, tokens: 41_000, endedAt: null, summary: null, hasReport: false,
      });
    });
    it('a missing effort is left out (null), never guessed; the launch\'s resolved model stands in for a meta with none', () => {
      const arm = run({
        roster: usable([A]),
        metas: { [A]: meta({ effort: null, model: null }) },
        facts: { [A]: facts({ launch: asyncLaunch(NOW - 10 * MIN) }) },
      });
      expect(row(arm, A)).toMatchObject({ effort: null, model: 'claude-opus-5-5' });
    });
    it('its start is the launch result\'s time, else the roster\'s startedAt', () => {
      const withLaunch = run({ roster: usable([A]), metas: { [A]: meta() }, facts: { [A]: facts({ launch: asyncLaunch(NOW - 7 * MIN) }) } });
      expect(row(withLaunch, A).startedAt).toBe(NOW - 7 * MIN);
      const rosterOnly = run({ roster: { kind: 'usable', at: ROSTER_AT, entries: [{ id: A, name: 'Explore', startedAt: NOW - 9 * MIN }] }, metas: { [A]: meta() } });
      expect(row(rosterOnly, A).startedAt).toBe(NOW - 9 * MIN);
    });
  });

  describe('launched: between a launch result and the roster that lists it (review 2900 F6)', () => {
    it('a roster read BEFORE the launch result\'s time cannot list the helper yet: launched', () => {
      const arm = run(base({ roster: usable([], ROSTER_AT), facts: { [A]: facts({ launch: asyncLaunch(ROSTER_AT + 1) }) } }));
      expect(stateOf(arm, A)).toBe('launched');
      expect(arm.unmeasured).toBeNull();
    });
    it('a roster read AT the launch time or after, that does not list it, is not "launched"', () => {
      expect(stateOf(run(base({ roster: usable([], ROSTER_AT), facts: { [A]: facts({ launch: asyncLaunch(ROSTER_AT) }) } })), A)).toBe('unmeasured');
      expect(stateOf(run(base({ roster: usable([], ROSTER_AT), facts: { [A]: facts({ launch: asyncLaunch(ROSTER_AT - 1) }) } })), A)).toBe('unmeasured');
    });
    it('a launch with no readable time cannot be compared: not "launched"', () => {
      expect(stateOf(run(base({ roster: usable([]), facts: { [A]: facts({ launch: asyncLaunch(null) }) } })), A)).toBe('unmeasured');
    });
    it('no launch fact at all (known from its meta alone) is never "launched"', () => {
      expect(stateOf(run(base({ roster: usable([]) })), A)).toBe('unmeasured');
    });
    it('the roster\'s read time is an INPUT (HookReading.at), not the clock: now does not decide it', () => {
      const arm = run(base({ now: NOW + 3_600_000, roster: usable([], ROSTER_AT), facts: { [A]: facts({ launch: asyncLaunch(ROSTER_AT + 1) }) } }));
      expect(stateOf(arm, A)).toBe('launched');
    });
  });

  describe('no longer listed: only from a drop this reader SAW (review 2900 F13)', () => {
    const metasFor = (ids: string[]): Record<string, HelperMeta> => Object.fromEntries(ids.map((i) => [i, meta()]));
    const ALL = ['a1', 'a2', 'a3', 'z1'];
    const read = (ids: string[], extra: Setup = {}): AgentArm => run({ metas: metasFor(ids), roster: usable(ids), ...extra });
    /** A later reading of the same session: the helpers in `known` exist, the roster lists `ids`. */
    const later = (prev: AgentArm, ids: string[], known: string[], extra: Setup = {}): AgentArm =>
      run({ metas: metasFor(known), roster: usable(ids), memory: prev.memory, ...extra });

    it('listed in one reading, absent in the next, with another previously listed id still listed: no longer listed', () => {
      const one = read(['a1', 'a2']);
      expect(stateOf(one, 'a1')).toBe('running');
      const two = later(one, ['a2'], ['a1', 'a2']);
      expect(stateOf(two, 'a1')).toBe('unlisted');
      expect(stateOf(two, 'a2')).toBe('running');
      expect(two.unmeasured).toBeNull();
      expect(row(two, 'a1').endedAt).toBeNull();
    });

    it('a drop the reader did not see (no earlier reading of a usable roster) leaves the state out and counts it', () => {
      const two = run({ metas: metasFor(['a1', 'a2']), roster: usable(['a2']) });
      expect(stateOf(two, 'a1')).toBe('unmeasured');
      expect(two.unmeasured).toEqual({ why: 'unseen', helpers: 1 });
    });

    it('a roster that was unusable in between forgets: a drop across it is not seen', () => {
      const one = read(['a1', 'a2']);
      const mid = run({ metas: metasFor(['a1', 'a2']), roster: { kind: 'unusable', why: { why: 'stale', hookAgeMs: 31 * MIN } }, memory: one.memory });
      const two = later(mid, ['a2'], ['a1', 'a2']);
      expect(stateOf(two, 'a1')).toBe('unmeasured');
    });

    it('the LAST listed id dropping cannot be told from a roster reset: state left out, not called a drop (the residual)', () => {
      const one = read(['a1']);
      const two = later(one, [], ['a1']);
      expect(stateOf(two, 'a1')).toBe('unmeasured');
      expect(two.unmeasured).toEqual({ why: 'unseen', helpers: 1 });
    });

    it('a reset followed by new starts (no earlier id survives) is not a drop: state left out', () => {
      const one = read(['a1', 'a2']);
      const two = later(one, ['z1'], ['a1', 'a2', 'z1']);
      expect(stateOf(two, 'a1')).toBe('unmeasured');
      expect(stateOf(two, 'a2')).toBe('unmeasured');
      expect(stateOf(two, 'z1')).toBe('running');
      expect(two.unmeasured).toEqual({ why: 'unseen', helpers: 2 });
    });

    it('the process start time is a second witness: a process that restarted between the readings forbids the drop', () => {
      const one = read(['a1', 'a2'], { proc: { kind: 'live', startedAt: NOW - 3_600_000 } });
      const sameProc = later(one, ['a2'], ['a1', 'a2'], { proc: { kind: 'live', startedAt: NOW - 3_600_000 } });
      expect(stateOf(sameProc, 'a1')).toBe('unlisted');
      const restarted = later(one, ['a2'], ['a1', 'a2'], { proc: { kind: 'live', startedAt: NOW - 1_000 } });
      expect(stateOf(restarted, 'a1')).toBe('unmeasured');
    });

    it('an unmeasured process start does not forbid a drop the roster itself witnesses', () => {
      const one = read(['a1', 'a2']);
      const two = later(one, ['a2'], ['a1', 'a2'], { proc: { kind: 'unmeasured' } });
      expect(stateOf(two, 'a1')).toBe('unlisted');
      const noStart = later(one, ['a2'], ['a1', 'a2'], { proc: { kind: 'live', startedAt: null } });
      expect(stateOf(noStart, 'a1')).toBe('unlisted');
    });

    it('a full roster (32 listed) is not room: the oldest entry falls off the cap, so neither side of a drop counts', () => {
      const ids = Array.from({ length: HELPER_LISTED_MAX }, (_, i) => `f${i}`);
      const metas = metasFor([...ids, 'a1']);
      const full = run({ metas, roster: usable([...ids.slice(1), 'a1']) });
      expect(stateOf(full, 'a1')).toBe('running');
      // the previous reading was full: its drop is not seen
      const dropped = run({ metas, roster: usable(ids.slice(1)), memory: full.memory });
      expect(stateOf(dropped, 'a1')).toBe('unmeasured');
      // the current reading is full: an absence is the cap's, not a stop's
      const small = run({ metas, roster: usable(['a1', ids[1]!]) });
      const nowFull = run({ metas, roster: usable(ids), memory: small.memory });
      expect(stateOf(nowFull, 'a1')).toBe('unmeasured');
    });

    it('a seen drop stays seen while the roster stays usable: the row does not flicker back to "state left out"', () => {
      const one = read(['a1', 'a2']);
      const two = later(one, ['a2'], ['a1', 'a2']);
      const three = later(two, ['a2'], ['a1', 'a2']);
      const four = later(three, ['a2'], ['a1', 'a2']);
      expect(stateOf(three, 'a1')).toBe('unlisted');
      expect(stateOf(four, 'a1')).toBe('unlisted');
      expect(four.unmeasured).toBeNull();
    });

    it('a dropped id that is listed again is running again, and a later drop of it is a new drop', () => {
      const one = read(['a1', 'a2']);
      const two = later(one, ['a2'], ['a1', 'a2']);
      const back = later(two, ['a1', 'a2'], ['a1', 'a2']);
      expect(stateOf(back, 'a1')).toBe('running');
      const again = later(back, ['a2'], ['a1', 'a2']);
      expect(stateOf(again, 'a1')).toBe('unlisted');
    });

    it('a seen drop is forgotten when the roster becomes unusable (no claim survives what the reader cannot read)', () => {
      const one = read(['a1', 'a2']);
      const two = later(one, ['a2'], ['a1', 'a2']);
      const gap = run({ metas: metasFor(['a1', 'a2']), roster: { kind: 'unusable', why: { why: 'absent' } }, memory: two.memory });
      const after = later(gap, ['a2'], ['a1', 'a2']);
      expect(stateOf(after, 'a1')).toBe('unmeasured');
    });

    it('a roster entry with no id counts toward room and never matches a helper', () => {
      const one = run({ metas: metasFor(['a1', 'a2']), roster: usable(['a1', 'a2', null]) });
      const two = run({ metas: metasFor(['a1', 'a2']), roster: usable(['a2', null]), memory: one.memory });
      expect(stateOf(two, 'a1')).toBe('unlisted');
    });
  });
});

describe('the exclusion of workflow agents from the Agent rows', () => {
  it('the name and the type read from one constant', () => {
    expect(WORKFLOW_AGENT_TYPE).toBe('workflow-subagent');
    expect(isWorkflowAgentName('workflow-subagent')).toBe(true);
    expect(isWorkflowAgentName('Explore')).toBe(false);
  });

  it('by name: a roster entry named workflow-subagent is no Agent row, with or without a meta, and is not counted known', () => {
    const roster: RosterInput = { kind: 'usable', at: ROSTER_AT, entries: [{ id: 'w1', name: 'workflow-subagent', startedAt: NOW - MIN }] };
    expect(run({ roster }).agents).toEqual([]);
    expect(run({ roster, metas: { w1: meta() } }).agents).toEqual([]);
    expect(run({ roster, metas: { w1: meta() } }).known).toBe(0);
  });

  it('by agent type: a meta at the Agent path whose agentType is workflow-subagent is no Agent row', () => {
    const arm = run({ roster: usable(['w1']), metas: { w1: meta({ agentType: 'workflow-subagent' }) } });
    expect(arm.agents).toEqual([]);
    expect(arm.known).toBe(0);
  });

  it('by meta path: a meta that sits under the workflow path is no Agent row, whatever its type says', () => {
    const arm = run({ roster: usable(['w1']), metas: { w1: meta({ path: 'workflow', agentType: 'Explore' }) } });
    expect(arm.agents).toEqual([]);
    expect(arm.known).toBe(0);
  });

  it('an Agent-path meta of another type is a row; a launch fact alone is a row; neither is no row', () => {
    expect(stateOf(run({ roster: usable(['a1']), metas: { a1: meta() } }), 'a1')).toBe('running');
    expect(run({ roster: usable(['a1']), facts: { a1: facts({ launch: asyncLaunch(NOW - 10 * MIN) }) } }).agents.map((a) => a.id)).toEqual(['a1']);
    expect(run({ roster: usable(['a1']) }).agents).toEqual([]);
  });

  it('a notification alone (a task id no Agent launch named, such as a workflow\'s) never makes a row', () => {
    expect(run({ facts: { w9: facts({ end: end('done', NOW - MIN) }) } }).agents).toEqual([]);
  });

  it('an excluded id still counts as a listing, so it is room taken on the roster', () => {
    const entries = Array.from({ length: HELPER_LISTED_MAX }, (_, i) => ({ id: `w${i}`, name: 'workflow-subagent', startedAt: null }));
    const arm = run({ roster: { kind: 'usable', at: ROSTER_AT, entries: [...entries, { id: 'a1', name: 'Explore', startedAt: null }] }, metas: { a1: meta() } });
    expect(arm.memory.listedFull).toBe(true);
  });
});

describe('the keep: one owner (review 2900 F5)', () => {
  it('isFinishedKept: kept strictly inside HELPER_FINISHED_KEEP_MS of the end time; an unreadable end time is not kept', () => {
    expect(HELPER_FINISHED_KEEP_MS).toBe(10 * MIN);
    expect(isFinishedKept(NOW - 10 * MIN + 1, NOW)).toBe(true);
    expect(isFinishedKept(NOW - 10 * MIN, NOW)).toBe(false);
    expect(isFinishedKept(NOW - 11 * MIN, NOW)).toBe(false);
    expect(isFinishedKept(NOW, NOW)).toBe(true);
    expect(isFinishedKept(null, NOW)).toBe(false);
  });

  const withEnd = (outcome: 'done' | 'failed' | 'stopped', at: number | null, from: 'notification' | 'launch' = 'notification') =>
    ({ metas: { a1: meta() }, facts: { a1: facts({ launch: asyncLaunch(NOW - 30 * MIN), end: end(outcome, at, from) }) } }) satisfies Setup;

  describe.each([
    ['done by a notification', 'done', 'notification'],
    ['failed by a notification', 'failed', 'notification'],
    ['stopped by a notification', 'stopped', 'notification'],
    ['done by a foreground launch result', 'done', 'launch'],
  ] as const)('%s: its end time is the record\'s own time', (_n, outcome, from) => {
    it('kept just inside ten minutes', () => {
      expect(stateOf(run(withEnd(outcome, NOW - 10 * MIN + 1, from)), 'a1')).toBe(outcome);
    });
    it('not kept at ten minutes', () => {
      expect(run(withEnd(outcome, NOW - 10 * MIN, from)).agents).toEqual([]);
    });
    it('the row says its end time', () => {
      expect(row(run(withEnd(outcome, NOW - MIN, from)), 'a1').endedAt).toBe(NOW - MIN);
    });
  });

  describe('finished by the meta marker: its end time is the helper transcript\'s last write', () => {
    const fin = (lastWriteAt: number | null): Setup => ({ metas: { a1: meta({ finished: true, lastWriteAt }) } });
    it('kept just inside ten minutes of its last write', () => {
      expect(stateOf(run(fin(NOW - 10 * MIN + 1)), 'a1')).toBe('finished');
    });
    it('not kept at ten minutes of it', () => {
      expect(run(fin(NOW - 10 * MIN)).agents).toEqual([]);
    });
  });

  describe('a finished row whose end time cannot be read is drawn in the reading that decided it and leaves with the next', () => {
    it('a notification with no time', () => {
      const s = withEnd('done', null);
      const one = run(s);
      expect(stateOf(one, 'a1')).toBe('done');
      expect(row(one, 'a1').endedAt).toBeNull();
      const two = run({ ...s, memory: one.memory });
      expect(two.agents).toEqual([]);
      const three = run({ ...s, memory: two.memory });
      expect(three.agents).toEqual([]);
    });
    it('a meta marker with no last write', () => {
      const s: Setup = { metas: { a1: meta({ finished: true, lastWriteAt: null }) } };
      const one = run(s);
      expect(stateOf(one, 'a1')).toBe('finished');
      expect(run({ ...s, memory: one.memory }).agents).toEqual([]);
    });
  });

  it('a final row that is not kept never counts as a known helper that is not final', () => {
    const arm = run({ ...withEnd('done', NOW - 20 * MIN), roster: { kind: 'unusable', why: { why: 'absent' } } });
    expect(arm.unmeasured).toBeNull();
  });
});

describe('agentsUnmeasured: only while a known helper is not final, and only for a state left out', () => {
  const FINAL = { metas: { a1: meta() }, facts: { a1: facts({ end: end('done', NOW - MIN) }) } } satisfies Setup;
  const STALE: RosterInput = { kind: 'unusable', why: { why: 'stale', hookAgeMs: 41 * MIN } };

  it('a stale roster and a helper that is not final: said', () => {
    expect(run({ metas: { a1: meta() }, roster: STALE }).unmeasured).toEqual({ why: 'stale', hookAgeMs: 41 * MIN });
  });
  it('a stale roster and every known helper final: nothing said', () => {
    expect(run({ ...FINAL, roster: STALE }).unmeasured).toBeNull();
  });
  it('a stale roster and no known helper: nothing said', () => {
    expect(run({ roster: STALE }).unmeasured).toBeNull();
  });
  it('a stale roster and a helper whose process is gone: its row says "session ended", so nothing is left out and nothing is said', () => {
    expect(run({ metas: { a1: meta() }, roster: STALE, proc: { kind: 'gone' } }).unmeasured).toBeNull();
  });
  it('a stale roster with one final and one not final helper: said', () => {
    const arm = run({
      metas: { a1: meta(), a2: meta() },
      facts: { a1: facts({ end: end('done', NOW - MIN) }) },
      roster: STALE,
    });
    expect(arm.unmeasured).toEqual({ why: 'stale', hookAgeMs: 41 * MIN });
  });
  it('a usable roster that lists everything: nothing said', () => {
    expect(run({ metas: { a1: meta() }, roster: usable(['a1']) }).unmeasured).toBeNull();
  });
  it('the unseen count is the number of rows whose state was left out for an unseen drop', () => {
    const one = run({ metas: { a1: meta(), a2: meta(), a3: meta() }, roster: usable(['a1', 'a2', 'a3']) });
    const two = run({ metas: { a1: meta(), a2: meta(), a3: meta() }, roster: usable(['a3']), memory: one.memory });
    expect(stateOf(two, 'a1')).toBe('unlisted');
    expect(two.unmeasured).toBeNull();
    const reset = run({ metas: { a1: meta(), a2: meta(), a3: meta() }, roster: usable([]), memory: one.memory });
    expect(reset.unmeasured).toEqual({ why: 'unseen', helpers: 3 });
  });
});

describe('the memory the decision hands back', () => {
  it('a usable roster is remembered: its ids, whether it was full, and the process start', () => {
    const arm = run({ roster: usable(['a1', 'a2', null]), proc: { kind: 'live', startedAt: 123 }, metas: { a1: meta() } });
    expect([...arm.memory.listed!].sort()).toEqual(['a1', 'a2']);
    expect(arm.memory.listedFull).toBe(false);
    expect(arm.memory.procStartedAt).toBe(123);
  });
  it('an unusable roster is forgotten: no ids to compare with', () => {
    const arm = run({ roster: { kind: 'unusable', why: { why: 'absent' } } });
    expect(arm.memory.listed).toBeNull();
  });
  it('the input memory is never mutated (the decision is a pure function)', () => {
    const memory = emptyHelperMemory();
    const snap = (): string => JSON.stringify({ l: memory.listed === null ? null : [...memory.listed], n: [...memory.noEndShown], d: [...memory.dropped], f: memory.listedFull, p: memory.procStartedAt });
    const before = snap();
    run({ roster: usable(['a1']), metas: { a1: meta() }, memory });
    expect(snap()).toBe(before);
  });
});

describe('the order of the rows', () => {
  it('running rows first, then the rest of the main list by state, finished last and newest end first', () => {
    const arm = run({
      roster: usable(['r1']),
      metas: { r1: meta(), u1: meta(), d1: meta(), d2: meta(), g1: meta() },
      facts: {
        d1: facts({ end: end('done', NOW - 5 * MIN) }),
        d2: facts({ end: end('failed', NOW - MIN) }),
        u1: facts({ launch: asyncLaunch(ROSTER_AT + 1) }),
      },
    });
    expect(arm.agents.map((a) => [a.id, a.state])).toEqual([['r1', 'running'], ['u1', 'launched'], ['g1', 'unmeasured'], ['d2', 'failed'], ['d1', 'done']]);
  });
});

describe('every bound of the Agent arm (review 2900 F9)', () => {
  it('the description is cut to HELPER_DESCRIPTION_MAX characters', () => {
    const r = row(run({ roster: usable(['a1']), metas: { a1: meta({ description: 'd'.repeat(HELPER_DESCRIPTION_MAX + 500) }) } }), 'a1');
    expect(r.description!.length).toBe(HELPER_DESCRIPTION_MAX);
  });
  it('a description at the cap is whole', () => {
    const r = row(run({ roster: usable(['a1']), metas: { a1: meta({ description: 'd'.repeat(HELPER_DESCRIPTION_MAX) }) } }), 'a1');
    expect(r.description!.length).toBe(HELPER_DESCRIPTION_MAX);
  });
  it('the agent type, model and effort are each cut to HELPER_LABEL_MAX characters', () => {
    const long = 'x'.repeat(HELPER_LABEL_MAX + 40);
    const r = row(run({ roster: usable(['a1']), metas: { a1: meta({ agentType: long, model: long, effort: long }) } }), 'a1');
    expect([r.agentType!.length, r.model!.length, r.effort!.length]).toEqual([HELPER_LABEL_MAX, HELPER_LABEL_MAX, HELPER_LABEL_MAX]);
  });
  it('the summary is cut to HELPER_SUMMARY_MAX_BYTES bytes', () => {
    const r = row(run({ metas: { a1: meta() }, facts: { a1: facts({ end: { outcome: 'done', at: NOW - MIN, summary: 'é'.repeat(300), hasReport: true, from: 'notification' } }) } }), 'a1');
    expect(Buffer.byteLength(r.summary!, 'utf8')).toBeLessThanOrEqual(HELPER_SUMMARY_MAX_BYTES);
  });

  it('listed rows: at most HELPER_LISTED_MAX, the newest started kept, the rest counted as omitted', () => {
    const n = HELPER_LISTED_MAX + 8;
    const ids = Array.from({ length: n }, (_, i) => `r${String(i).padStart(2, '0')}`);
    const arm = run({
      roster: { kind: 'usable', at: ROSTER_AT, entries: ids.map((id, i) => ({ id, name: 'Explore', startedAt: NOW - 1_000_000 + i * 1_000 })) },
      metas: Object.fromEntries(ids.map((i) => [i, meta()])),
    });
    const running = arm.agents.filter((a) => a.state === 'running');
    expect(running).toHaveLength(HELPER_LISTED_MAX);
    expect(running.map((a) => a.id)).not.toContain('r00');
    expect(running.map((a) => a.id)).toContain(`r${n - 1}`);
    expect(arm.omitted).toBe(8);
  });

  it('non-final rows that are not listed (launched, no longer listed, session ended, state left out): at most HELPER_NONFINAL_MAX together', () => {
    const n = HELPER_NONFINAL_MAX + 5;
    const ids = Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, '0')}`);
    const arm = run({
      roster: usable([]),
      metas: Object.fromEntries(ids.map((i) => [i, meta()])),
      facts: Object.fromEntries(ids.map((i, k) => [i, facts({ launch: asyncLaunch(ROSTER_AT + 1 + k) })])),
    });
    expect(arm.agents.filter((a) => a.state === 'launched')).toHaveLength(HELPER_NONFINAL_MAX);
    expect(arm.omitted).toBe(5);
    expect(arm.agents.map((a) => a.id)).toContain(`u${n - 1}`);
    expect(arm.agents.map((a) => a.id)).not.toContain('u00');
  });

  it('the gone rows are bounded the same way', () => {
    const n = HELPER_NONFINAL_MAX + 3;
    const ids = Array.from({ length: n }, (_, i) => `g${String(i).padStart(2, '0')}`);
    const arm = run({ proc: { kind: 'gone' }, metas: Object.fromEntries(ids.map((i) => [i, meta()])) });
    expect(arm.agents).toHaveLength(HELPER_NONFINAL_MAX);
  });

  it('finished rows kept: at most HELPER_KEPT_MAX, the newest ended', () => {
    const n = HELPER_KEPT_MAX + 6;
    const ids = Array.from({ length: n }, (_, i) => `d${String(i).padStart(2, '0')}`);
    const arm = run({
      metas: Object.fromEntries(ids.map((i) => [i, meta()])),
      facts: Object.fromEntries(ids.map((i, k) => [i, facts({ end: end('done', NOW - 9 * MIN + k * 1_000) })])),
    });
    expect(arm.agents).toHaveLength(HELPER_KEPT_MAX);
    expect(arm.agents.map((a) => a.id)).toContain(`d${n - 1}`);
    expect(arm.agents.map((a) => a.id)).not.toContain('d00');
    expect(arm.omitted).toBe(6);
  });

  it('a finished row evicted by the cap is counted omitted, one that merely aged out of the keep is not', () => {
    const arm = run({ metas: { a1: meta() }, facts: { a1: facts({ end: end('done', NOW - 30 * MIN) }) } });
    expect(arm.omitted).toBe(0);
  });

  it('the whole arm is at most HELPER_LISTED_MAX + HELPER_NONFINAL_MAX + HELPER_KEPT_MAX rows', () => {
    const per = 60;
    const mk = (p: string) => Array.from({ length: per }, (_, i) => `${p}${String(i).padStart(2, '0')}`);
    const run1 = mk('r'); const un = mk('u'); const dn = mk('d');
    const arm = run({
      roster: { kind: 'usable', at: ROSTER_AT, entries: run1.map((id, i) => ({ id, name: 'Explore', startedAt: NOW - 500_000 + i })) },
      metas: Object.fromEntries([...run1, ...un, ...dn].map((i) => [i, meta()])),
      facts: {
        ...Object.fromEntries(un.map((i, k) => [i, facts({ launch: asyncLaunch(ROSTER_AT + 1 + k) })])),
        ...Object.fromEntries(dn.map((i, k) => [i, facts({ end: end('done', NOW - 5 * MIN + k) })])),
      },
    });
    expect(arm.agents.length).toBeLessThanOrEqual(HELPER_LISTED_MAX + HELPER_NONFINAL_MAX + HELPER_KEPT_MAX);
    expect(arm.agents).toHaveLength(HELPER_LISTED_MAX + HELPER_NONFINAL_MAX + HELPER_KEPT_MAX);
  });

  it('an id outside the id grammar is never a row', () => {
    const arm = run({ roster: usable(['bad id;', 'x'.repeat(65)]), metas: { 'bad id;': meta(), ['x'.repeat(65)]: meta() } });
    expect(arm.agents).toEqual([]);
  });

  it('the fold of helper facts keeps at most HELPER_FACTS_MAX ids, evicting the oldest first', () => {
    const many: HelperFact[] = Array.from({ length: HELPER_FACTS_MAX + 10 }, (_, i) => ({
      source: 'notification', id: `t${i}`, status: 'completed', at: NOW, model: null, durationMs: null, summary: null, report: null, reportCut: false,
    }));
    const map = foldHelperFacts(new Map(), many);
    expect(map.size).toBe(HELPER_FACTS_MAX);
    expect(map.has('t0')).toBe(false);
    expect(map.has(`t${HELPER_FACTS_MAX + 9}`)).toBe(true);
  });

  it('a kept workflow carries at most WORKFLOW_KEPT_AGENTS_MAX agents, failed and running first, and says how many it left out', () => {
    const agents = Array.from({ length: 100 }, (_, i) => ({ label: `a${i}`, phase: null, state: (i === 3 ? 'failed' : 'done') as 'failed' | 'done' }));
    const v: WorkflowView = {
      id: 'wf_00000000-aaa', name: 'n', state: 'completed', done: 99, failed: 1, total: 100, phase: null, phases: null,
      startedAt: NOW - 20 * MIN, endedAt: NOW - MIN, tokens: null, tokensUnmeasured: 0, agents, agentsOmitted: 7,
    };
    const c = capKeptWorkflow(v);
    expect(c.agents).toHaveLength(WORKFLOW_KEPT_AGENTS_MAX);
    expect(c.agents.some((a) => a.label === 'a3')).toBe(true);
    expect(c.agentsOmitted).toBe(7 + (100 - WORKFLOW_KEPT_AGENTS_MAX));
    expect(c.done).toBe(99);
    expect(c.total).toBe(100);
  });

  it('a kept workflow already inside the bound is returned as it is', () => {
    const v: WorkflowView = {
      id: 'wf_00000000-aaa', name: 'n', state: 'completed', done: 1, failed: 0, total: 1, phase: null, phases: null,
      startedAt: NOW - 20 * MIN, endedAt: NOW - MIN, tokens: null, tokensUnmeasured: 0,
      agents: [{ label: 'a', phase: null, state: 'done' }], agentsOmitted: 0,
    };
    expect(capKeptWorkflow(v)).toEqual(v);
  });
});

describe('foldHelperFacts: the facts of one id, folded', () => {
  const fact = (o: Partial<HelperFact>): HelperFact => ({
    source: 'notification', id: 'a1', status: 'completed', at: NOW, model: null, durationMs: null, summary: 's', report: 'r', reportCut: false, ...o,
  });

  it('an async launch is a launch with its time and model, and no end', () => {
    const m = foldHelperFacts(new Map(), [fact({ source: 'launch', status: 'async_launched', at: NOW - MIN, model: 'm' })]);
    expect(m.get('a1')).toEqual({ launch: { at: NOW - MIN, model: 'm', async: true, durationMs: null }, end: null });
  });
  it('a completed launch is a foreground launch AND its end', () => {
    const m = foldHelperFacts(new Map(), [fact({ source: 'launch', status: 'completed', at: NOW - MIN, durationMs: 5, report: 'rep' })]);
    expect(m.get('a1')).toEqual({
      launch: { at: NOW - MIN, model: null, async: false, durationMs: 5 },
      end: { outcome: 'done', at: NOW - MIN, summary: null, hasReport: true, from: 'launch' },
    });
  });
  it.each([['completed', 'done'], ['failed', 'failed'], ['killed', 'stopped'], ['stopped', 'stopped']] as const)('a %s notification is the end %s', (status, outcome) => {
    expect(foldHelperFacts(new Map(), [fact({ status })]).get('a1')!.end).toMatchObject({ outcome, from: 'notification', summary: 's', hasReport: true });
  });
  it('a report that is null or empty is hasReport false', () => {
    expect(foldHelperFacts(new Map(), [fact({ report: null })]).get('a1')!.end!.hasReport).toBe(false);
    expect(foldHelperFacts(new Map(), [fact({ report: '' })]).get('a1')!.end!.hasReport).toBe(false);
  });
  it('the notification and the launch of one id fold together, in either order', () => {
    const launch = fact({ source: 'launch', status: 'async_launched', at: NOW - 5 * MIN });
    const done = fact({ status: 'completed', at: NOW - MIN });
    for (const order of [[launch, done], [done, launch]]) {
      const v = foldHelperFacts(new Map(), order).get('a1')!;
      expect(v.launch!.at).toBe(NOW - 5 * MIN);
      expect(v.end).toMatchObject({ outcome: 'done', at: NOW - MIN });
    }
  });
  it('two ends: the later one by its time wins, whatever the order they were read in', () => {
    const early = fact({ status: 'failed', at: NOW - 5 * MIN });
    const late = fact({ status: 'completed', at: NOW - MIN });
    for (const order of [[early, late], [late, early]]) {
      expect(foldHelperFacts(new Map(), order).get('a1')!.end).toMatchObject({ outcome: 'done' });
    }
  });
  it('an end with a time beats an end with none', () => {
    const timed = fact({ status: 'failed', at: NOW - MIN });
    const untimed = fact({ status: 'completed', at: null });
    expect(foldHelperFacts(new Map(), [timed, untimed]).get('a1')!.end).toMatchObject({ outcome: 'failed' });
    expect(foldHelperFacts(new Map(), [untimed, timed]).get('a1')!.end).toMatchObject({ outcome: 'failed' });
  });
  it('the input map is not mutated', () => {
    const prev = new Map<string, HelperIdFacts>();
    foldHelperFacts(prev, [fact({})]);
    expect(prev.size).toBe(0);
  });
});

describe('frameDue: the frame gate moved out of the delivery code', () => {
  const due = (o: Partial<Parameters<typeof frameDue>[0]> = {}): boolean =>
    frameDue({ workflows: 'absent', unreadable: false, knownHelpers: 0, sentBefore: false, ...o });

  it('no workflows directory, no known helper id, nothing sent before: no frame ("never had")', () => {
    expect(due()).toBe(false);
  });
  it('no workflows directory but a known helper id: a frame is due', () => {
    expect(due({ knownHelpers: 1 })).toBe(true);
  });
  it('no workflows directory and no helper now, but a frame was sent before: due (the rows must be cleared)', () => {
    expect(due({ sentBefore: true })).toBe(true);
  });
  it('a workflows read, whatever else: due', () => {
    expect(due({ workflows: 'read' })).toBe(true);
  });
  it('an unreadable read, and an absent read made unreadable by the hook\'s word: due', () => {
    expect(due({ workflows: 'unreadable', unreadable: true })).toBe(true);
    expect(due({ workflows: 'absent', unreadable: true })).toBe(true);
  });
});
