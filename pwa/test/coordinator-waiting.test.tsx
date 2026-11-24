// A COORDINATOR WAITING ON ITS WORKERS (desktop polish wave 173, the operator's goal of 2026-11-24: "done" is misleading
// for a coordinator whose children are still working; keep "done" for when the coordinator and its workers are all
// doing nothing). The rule (`waitingOnWorkers`, `sessionFacts.ts`): a session whose role is coordinator, whose own bucket
// is done or idle, with at least one worker row working or still spawning (`workerBusy` over `workersOf`), reads
// `waiting on workers`. Everything else reads as before. These cases are the rule's table, the row and the header
// saying one word, the lamp's look and spoken label, the width budget and the one spelling of the words.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { StatusDot } from '@ccrc/ui';
import type { FleetSession, RunSummary, SessionBucket } from '../../shared/api';
import {
  cardFacts, headerFacts, headerStatusWord, NAME_BUDGET, sessionFacts, STATE_WORD, WAITING_ON_WORKERS,
  WAITING_ON_WORKERS_TITLE, waitingOnWorkers, workerBusy,
} from '../src/fleet/sessionFacts';
import { coordinationOf, workersBusyOf, workersOf } from '../src/fleet/fleetTree';
import { summaryParts, type WorkerRow } from '../src/fleet/rollup';
import { SessionLine } from '../src/fleet/SessionLine';
import { sessionHeaderView } from '../src/session/sessionHeaderView';
import { useFleetStore } from '../src/stores/fleet';
import { setSkin, storedSkin } from '../src/lib/skin';
import { DEAD_LIFECYCLE, fleetSession, hibernatedSession } from './fleetFixture';
import { HOUR, MIN, NOW, run, sess } from './rollupFixture';
import { withRunBinding } from './runBindingFixture';

afterEach(() => {
  cleanup();
  act(() => useFleetStore.setState({ sessions: [], runs: [] }));
});

const coord = (over: Partial<FleetSession> = {}): FleetSession =>
  sess('coord', 'project-c', { role: 'coordinator', status: 'idle', bucket: 'done', bucketSince: NOW - 10 * MIN, statusUpdatedAt: NOW - 10 * MIN, ...over });

const working: Partial<FleetSession> = { status: 'busy', bucket: 'working' };

/** A fleet of `head` and one worker per entry of `kids` (each worker bound to its own run claimed by `head`). */
function fleetOf(head: FleetSession, kids: readonly Partial<FleetSession>[], extraRuns: readonly RunSummary[] = []):
  { sessions: FleetSession[]; runs: RunSummary[] } {
  const workers = kids.map((k, i) => sess(`w${i + 1}`, 'project-c', { role: 'child', ...k }));
  const runs = [...workers.map((w, i) => run(10 + i, head.id, w.id)), ...extraRuns];
  return { sessions: withRunBinding([head, ...workers], runs), runs };
}

/** The row word the card draws for `head` over this fleet. */
function rowWord(head: FleetSession, f: { sessions: FleetSession[]; runs: RunSummary[] }): string {
  const self = f.sessions.find((s) => s.id === head.id)!;
  return cardFacts(sessionFacts({ session: self, now: NOW, workersBusy: workersBusyOf(self, f.sessions, f.runs) })).status.text;
}

describe('the rule (waitingOnWorkers): its table', () => {
  it('a coordinator done with one working worker reads waiting on workers', () => {
    const head = coord();
    expect(rowWord(head, fleetOf(head, [working]))).toBe(WAITING_ON_WORKERS);
  });

  it('a coordinator done with one spawning worker reads waiting on workers', () => {
    const head = coord();
    const spawn = run(30, 'coord', null, { state: 'planned', dispatchStartedAt: NOW - MIN });
    const f = fleetOf(head, [], [spawn]);
    expect(workersOf('coord', f.sessions, f.runs).map((r) => r.kind)).toEqual(['pending']);
    expect(rowWord(head, f)).toBe(WAITING_ON_WORKERS);
  });

  const quietWorkers: readonly [string, Partial<FleetSession>][] = [
    ['done', { status: 'idle', bucket: 'done' }],
    ['idle', { status: 'idle', bucket: 'idle' }],
    ['merged', { status: 'idle', bucket: 'cleanup' }],
    ['exited', { status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' }],
    ['archived', { status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'archived' }],
    ['asleep', { status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead', hibernatedAt: NOW - HOUR }],
    // Item 6: a worker blocked on the operator's question changes nothing in this wave; its row word is `waiting`.
    ['asking the operator', { status: 'idle', dialogPending: true, hookState: 'waiting', bucket: 'attention' }],
  ];
  for (const [name, w] of quietWorkers) {
    it(`a coordinator done whose workers are all ${name} reads done`, () => {
      const head = coord();
      expect(rowWord(head, fleetOf(head, [w, w]))).toBe(STATE_WORD.done);
    });
  }

  it('a coordinator idle with a working worker reads waiting on workers (done decays to idle; the wait does not)', () => {
    const head = coord({ bucket: 'idle', bucketSince: NOW - 3 * HOUR });
    expect(rowWord(head, fleetOf(head, [working, { status: 'idle', bucket: 'idle' }]))).toBe(WAITING_ON_WORKERS);
  });

  const ownWordWins: readonly [string, Partial<FleetSession>, string][] = [
    ['working', { status: 'busy', bucket: 'working' }, STATE_WORD.working],
    ['asking', { status: 'idle', dialogPending: true, hookState: 'waiting', bucket: 'attention' }, STATE_WORD.attention],
    ['exited', { status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' }, STATE_WORD.dead],
    ['archived', { status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'archived' }, STATE_WORD.archived],
  ];
  for (const [name, over, word] of ownWordWins) {
    it(`a coordinator ${name} with a working worker keeps its own word (${word})`, () => {
      const head = coord(over);
      expect(rowWord(head, fleetOf(head, [working]))).toBe(word);
    });
  }

  it('a coordinator asleep with a working worker keeps its hibernated word', () => {
    const head = hibernatedSession(NOW - HOUR, { id: 'coord', project: 'project-c', workspace: 'coord', role: 'coordinator' });
    const word = rowWord(head, fleetOf(head, [working]));
    expect(word).toMatch(/^hibernated · /);
  });

  it('a head that is not a coordinator, with children working, reads done', () => {
    const head = coord({ role: 'child' });
    const f = fleetOf(head, [working]);
    expect(workersOf('coord', f.sessions, f.runs)).toHaveLength(1);
    expect(rowWord(head, f)).toBe(STATE_WORD.done);
  });

  it('a closed run is no worker of it: its session still working leaves the coordinator done', () => {
    const head = coord();
    const w = sess('w1', 'project-c', { role: 'child', ...working });
    const runs = [run(10, 'coord', 'w1', { state: 'done', closedAt: NOW - MIN })];
    const f = { sessions: withRunBinding([head, w], runs), runs };
    expect(workersOf('coord', f.sessions, f.runs)).toEqual([]);
    expect(rowWord(head, f)).toBe(STATE_WORD.done);
  });

  it('a run the coordinator claims for itself is no worker of it', () => {
    const head = coord();
    const runs = [run(10, 'coord', 'coord')];
    const f = { sessions: withRunBinding([head], runs), runs };
    expect(workersOf('coord', f.sessions, f.runs)).toEqual([]);
  });

  it('a worker two of its runs name is one worker row', () => {
    const head = coord();
    // The wire binds it to both: its open run is 11 and its newest run is 12 (`workerOf` accepts either).
    const w = sess('w1', 'project-c', {
      role: 'child', ...working,
      openRun: { id: 11, state: 'working', claimedBy: 'coord' }, run: { id: 12, state: 'working', claimedBy: 'coord' },
    });
    const runs = [run(11, 'coord', 'w1', { state: 'working' }), run(12, 'coord', 'w1', { state: 'working' })];
    expect(workersOf('coord', [head, w], runs).map((r) => (r.kind === 'session' ? r.session.id : 'spawn'))).toEqual(['w1']);
  });

  it('a session the run names but whose binding names another run is no worker of it (workerOf, #746)', () => {
    const head = coord();
    const w = sess('w1', 'project-c', { role: 'child', ...working });
    const bound = withRunBinding([head, w], [run(11, 'other', 'w1')]);
    const runs = [run(10, 'coord', 'w1'), run(11, 'other', 'w1')];
    expect(workersOf('coord', bound, runs)).toEqual([]);
    expect(rowWord(head, { sessions: bound, runs })).toBe(STATE_WORD.done);
  });

  it('a dispatch whose session row already exists is that session, never a spawn as well', () => {
    const head = coord();
    const w = sess('w1', 'project-c', { role: 'child', status: 'idle', bucket: 'idle' });
    const runs = [run(10, 'coord', 'w1', { state: 'planned', dispatchStartedAt: NOW - MIN })];
    const f = { sessions: withRunBinding([head, w], runs), runs };
    expect(workersOf('coord', f.sessions, f.runs).map((r) => r.kind)).toEqual(['session']);
    expect(rowWord(head, f)).toBe(STATE_WORD.done);
  });

  it('a coordinator with no workers reads done', () => {
    const head = coord();
    expect(rowWord(head, fleetOf(head, []))).toBe(STATE_WORD.done);
  });

  it('the decider alone: only done or idle, only a coordinator, only awake, only with a busy worker', () => {
    const buckets: SessionBucket[] = ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'];
    const yes = buckets.filter((bucket) => waitingOnWorkers({ coordinator: true, bucket, asleep: false, workersBusy: true }));
    expect(yes).toEqual(['done', 'idle']);
    expect(waitingOnWorkers({ coordinator: false, bucket: 'done', asleep: false, workersBusy: true })).toBe(false);
    expect(waitingOnWorkers({ coordinator: true, bucket: 'done', asleep: true, workersBusy: true })).toBe(false);
    expect(waitingOnWorkers({ coordinator: true, bucket: 'done', asleep: false, workersBusy: false })).toBe(false);
  });

  it('a worker is busy when it is spawning or its row word is working, and not otherwise', () => {
    const pending: WorkerRow = { kind: 'pending', depth: 1, run: run(1, 'coord', null, { state: 'planned', dispatchStartedAt: NOW }) };
    const row = (over: Partial<FleetSession>): WorkerRow => ({ kind: 'session', depth: 1, session: fleetSession(over) });
    expect(workerBusy(pending)).toBe(true);
    expect(workerBusy(row(working))).toBe(true);
    expect(workerBusy(row({ status: 'idle', bucket: 'done' }))).toBe(false);
  });

  it('the worker summary line counts workers and is not changed by the coordinator word', () => {
    const head = coord();
    const f = fleetOf(head, [working, { status: 'idle', bucket: 'idle' }]);
    const rows = workersOf('coord', f.sessions, f.runs);
    expect(summaryParts(rows).map((p) => `${p.n} ${p.word}`)).toEqual(['2 workers', '1 working', '1 idle']);
  });
});

describe('the header says the row word for the same facts', () => {
  const head = coord();
  const f = fleetOf(head, [working]);
  const self = f.sessions.find((s) => s.id === 'coord')!;
  const facts = sessionFacts({ session: self, now: NOW, workersBusy: workersBusyOf(self, f.sessions, f.runs) });

  it('the status chip and the header facts say waiting on workers, as the card does', () => {
    const view = sessionHeaderView({ session: self, status: null, statusUpdatedAt: null, facts, now: NOW, finePointer: false });
    const chip = view.chips.find((c) => c.kind === 'status');
    expect(chip?.kind === 'status' ? chip.word : null).toBe(WAITING_ON_WORKERS);
    expect(chip?.kind === 'status' ? chip.waiting : null).toBe(true);
    expect(chip?.kind === 'status' ? chip.title : null).toBe(WAITING_ON_WORKERS_TITLE);
    expect(cardFacts(facts).status.text).toBe(WAITING_ON_WORKERS);
    expect(headerFacts(facts).find((x) => x.key === 'status')?.text).toBe(WAITING_ON_WORKERS);
  });

  it('the header applies the rule to the bucket it paints: a live stream that says dead reads exited, not waiting', () => {
    const view = sessionHeaderView({ session: self, status: 'dead', statusUpdatedAt: NOW - MIN, facts, now: NOW, finePointer: false });
    const chip = view.chips.find((c) => c.kind === 'status');
    expect(chip?.kind === 'status' ? chip.word : null).toBe(STATE_WORD.dead);
    expect(chip?.kind === 'status' ? chip.waiting : null).toBe(false);
  });

  it('headerStatusWord says the words when told, and only for done or idle', () => {
    const base = { asleepAt: null, background: null, at: NOW - MIN, now: NOW, waiting: true } as const;
    expect(headerStatusWord({ ...base, bucket: 'done' })).toBe(WAITING_ON_WORKERS);
    expect(headerStatusWord({ ...base, bucket: 'idle' })).toBe(WAITING_ON_WORKERS);
    expect(headerStatusWord({ ...base, bucket: 'working' })).toMatch(/^working/);
    expect(headerStatusWord({ ...base, bucket: 'done', waiting: false })).toBe('done · 1m ago');
  });

  it('a worker header names its coordinator waiting on workers when the coordinator waits', () => {
    const worker = f.sessions.find((s) => s.id === 'w1')!;
    const c = coordinationOf(worker, [self], f.runs, true);
    expect(c?.coordinatorState).toBe(WAITING_ON_WORKERS);
    expect(coordinationOf(worker, [self], f.runs)?.coordinatorState).toBe(STATE_WORD.done);
  });
});

describe('the lamp', () => {
  it('speaks waiting on workers in the matte idle tone, with a glyph that is not done’s check', () => {
    const { container } = render(<StatusDot status="done" waitingLabel={WAITING_ON_WORKERS} />);
    const dot = container.querySelector('[role="img"]')!;
    expect(dot.getAttribute('aria-label')).toBe(WAITING_ON_WORKERS);
    expect(dot.className).toContain('dot--idle');
    expect(dot.className).not.toContain('dot--attention');
    expect(dot.className).not.toContain('dot--busy');
    expect(dot.textContent).not.toBe('✓');
    expect(dot.textContent).not.toBe('○');
  });

  it('only a done or idle lamp reads the label: a working lamp stays working', () => {
    const { container } = render(<StatusDot status="working" waitingLabel={WAITING_ON_WORKERS} />);
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('working');
  });
});

// Both skins draw this one row (`ProjectCard` and `FleetTable` both place `SessionLine`). Its desk and phone forms differ
// only in CSS (container queries and the name's `fit-short`/`fit-full` pair, both in the DOM), which jsdom does not lay
// out: the width budget below is the measured character budget of the phone's column, read off the rendered cell.
describe('the row, in both skins', () => {
  const before = storedSkin();
  afterEach(() => { setSkin(before); });
  for (const skin of ['refined', 'instrument'] as const) {
    {
      it(`${skin}: the word on the meta line within the phone budget, the lamp speaking it, the name on its own`, () => {
        setSkin(skin);
        const head = coord({ name: 'a-rather-long-coordinator-name-here' });
        const f = fleetOf(head, [working]);
        act(() => useFleetStore.setState({ sessions: f.sessions, runs: f.runs }));
        const self = f.sessions.find((s) => s.id === 'coord')!;
        const { container } = render(<SessionLine session={self} onOpen={() => {}} onActions={() => {}} now={NOW} />);
        const cell = container.querySelector('.sess-state');
        expect(cell?.textContent).toBe(WAITING_ON_WORKERS);
        expect(cell?.getAttribute('title')).toBe(WAITING_ON_WORKERS_TITLE);
        expect(container.querySelector('.sess-lamp [role="img"]')?.getAttribute('aria-label')).toBe(WAITING_ON_WORKERS);
        // The word is never inside the name's button, so it cannot push the name off its line.
        expect(container.querySelector('.sess-open')?.textContent).not.toContain(WAITING_ON_WORKERS);
        // The budget: the drawn word is no longer than a phone name (`NAME_BUDGET`, measured at 360 px for the same
        // 226 px column), so at 360 it fits the meta line whole beside nothing longer than it.
        expect(cell?.textContent?.length ?? Infinity).toBeLessThanOrEqual(NAME_BUDGET);
      });
    }
  }

  it('the word follows the store: the worker goes quiet and the coordinator reads done again', () => {
    const head = coord();
    const f = fleetOf(head, [working]);
    act(() => useFleetStore.setState({ sessions: f.sessions, runs: f.runs }));
    const self = f.sessions.find((s) => s.id === 'coord')!;
    const { container } = render(<SessionLine session={self} onOpen={() => {}} onActions={() => {}} now={NOW} />);
    expect(container.querySelector('.sess-state')?.textContent).toBe(WAITING_ON_WORKERS);
    act(() => useFleetStore.setState({
      sessions: f.sessions.map((s) => (s.id === 'w1' ? { ...s, status: 'idle', bucket: 'done' } : s)),
    }));
    expect(container.querySelector('.sess-state')?.textContent).toBe(STATE_WORD.done);
  });
});

describe('the words are spelt once', () => {
  const ROOTS = ['src', '../ui/src', '../shared'].map((r) => path.resolve(__dirname, '..', r));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === 'node_modules' || n === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
  });

  it('the literal `waiting on workers` is written in one source file, once', () => {
    const all = ROOTS.flatMap(files);
    expect(all.length).toBeGreaterThan(100);
    const hits = all.flatMap((p) => {
      const n = readFileSync(p, 'utf8').split(/['"`]waiting on workers['"`]/).length - 1;
      return n === 0 ? [] : [[path.relative(path.resolve(__dirname, '../..'), p), n] as const];
    });
    expect(hits).toEqual([['pwa/src/fleet/sessionFacts.ts', 1]]);
  });
});
