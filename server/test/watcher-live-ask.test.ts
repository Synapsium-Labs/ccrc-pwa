// Overlord W1, portfolio (plan w1-portfolio.md Task 2): `FleetWatcher#liveAskKey`, the `LiveAskRead` port's adapter. A pure
// read of the watcher's newest hookstate per child through `askKey`; it stores nothing.
import { describe, it, expect } from 'vitest';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { askKey } from '../src/askkey.js';
import type { HookState } from '../src/hookstate.js';
import type { HookAsk } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const hs = (over: Partial<HookState>): HookState =>
  ({ state: 'working', updatedAt: 1_790_000_000_000, event: null, ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0, interrupted: false, ...over });
const ASK: HookAsk = { questions: [{ question: 'Which way?', options: [{ label: 'left' }, { label: 'right' }] }] };

/** The watcher's hookstates are filled by its tick from the fixture HOME's files; here they are set as a tick would leave them. */
const watcherWith = (states: Record<string, HookState>): FleetWatcher => {
  const w = quietAtTestEnd(new FleetWatcher(testDeps(mkTmp('ccrc-live-ask-')), new Bus()));
  (w as unknown as { hookStates: Map<string, HookState> }).hookStates = new Map(Object.entries(states));
  return w;
};

describe('FleetWatcher#liveAskKey', () => {
  it('answers the key of the ask a waiting hookstate shows', () => {
    const w = watcherWith({ 'lane-a-project-a': hs({ state: 'waiting', ask: ASK }) });
    expect(w.liveAskKey('lane-a-project-a')).toBe(askKey(ASK));
    expect(w.liveAskKey('lane-a-project-a')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('answers null for a hookstate that shows no ask, and for one not waiting', () => {
    const w = watcherWith({ 'lane-a-project-a': hs({ state: 'waiting', ask: null }), 'lane-a-project-b': hs({ state: 'working', ask: ASK }) });
    expect(w.liveAskKey('lane-a-project-a')).toBeNull();
    expect(w.liveAskKey('lane-a-project-b')).toBeNull();
  });

  it('answers unmeasured for a child it never read', () => {
    expect(watcherWith({}).liveAskKey('lane-a-project-a')).toBe('unmeasured');
  });

  it('stores nothing: the hookstates are the same after a read', () => {
    const w = watcherWith({ 'lane-a-project-a': hs({ state: 'waiting', ask: ASK }) });
    const before = w.currentHookStates();
    w.liveAskKey('lane-a-project-a');
    w.liveAskKey('lane-a-project-z');
    expect(w.currentHookStates()).toEqual(before);
  });
});
