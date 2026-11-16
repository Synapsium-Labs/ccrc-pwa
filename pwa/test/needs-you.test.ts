// The one needs-you source (runs rebuild §8.7, A5, F20; D-8075). Every badge and chip reads `needsYou`; none counts for
// itself, and no run state is in it (D-6170).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunState, RunSummary } from '../../shared/api';
import { needsYou, needsYouCount } from '../src/ledgers/needsYou';
import { programmeWaitingCount } from '../src/ledgers/ledgerWords';
import { runsNeedYou, waitingItemsCount } from '../src/fleet/navBadges';
import { fleetSession } from './fleetFixture';
import { itemView, runRow, waitingView } from './ledgersFixture';
import { withRunBinding } from './runBindingFixture';

const SRC = path.join(import.meta.dirname, '..', 'src');
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const attention = (id: string) => fleetSession({ id, bucket: 'attention' });
const idle = (id: string) => fleetSession({ id, bucket: 'idle' });
const run = (id: number, state: RunState, sessionId: string | null, claimedBy: string | null, program = 'prog-a'): RunSummary =>
  runRow({ id, program, state, sessionId, claimedBy });
const capped = (id: number, over: Partial<RunSummary> = {}): RunSummary =>
  runRow({ id, program: 'prog-a', reviewCap: { askedAt: 5, liftedAt: null }, ...over } as Partial<RunSummary> & { id: number; program: string });

describe('needsYou', () => {
  it('lists an open item, a session question and a waiting review cap, each with its programme and run', () => {
    const runs = [run(7, 'working', 'w1', 'c1'), capped(8)];
    const sessions = withRunBinding([attention('w1'), idle('c1')], runs);
    const entries = needsYou([itemView({ id: 1, program: 'prog-a', runId: 7 })], sessions, runs);
    expect(entries).toEqual([
      { programme: 'prog-a', runId: 7, kind: 'item' },
      { programme: 'prog-a', runId: 7, kind: 'question' },
      { programme: 'prog-a', runId: 8, kind: 'review-cap' },
    ]);
  });

  it('an item being checked is the coordinator\'s and a lifted cap is done: neither is listed', () => {
    const entries = needsYou(
      [itemView({ id: 1, state: 'checking' })], [],
      [capped(8, { reviewCap: { askedAt: 5, liftedAt: 9 } } as Partial<RunSummary>)],
    );
    expect(entries).toEqual([]);
  });

  it('a child\'s held ask does not count until handed over', () => {
    const held = fleetSession({
      id: 'child-held', bucket: 'working', hookState: 'waiting', child: { kind: 'child', runId: 7 },
      withCoordinator: { kind: 'question', parentId: 'c1', since: 4000, notifyAt: 184_000 },
    });
    expect(needsYou([], [held], [])).toEqual([]);
    expect(needsYou([], [attention('plain')], [])).toEqual([{ programme: '', runId: null, kind: 'question' }]);
  });

  it('stuck never counts, and no run state appears in it', () => {
    const runs: RunSummary[] = (['working', 'stalled', 'awaiting-review', 'planned', 'merging', 'unknown'] as RunState[])
      .map((s, i) => ({ ...run(i + 1, s, null, null), stuck: { since: 1 } }) as unknown as RunSummary);
    expect(needsYou([], withRunBinding([idle('a')], runs), runs)).toEqual([]);
    const kinds = new Set(needsYou([itemView({ id: 1 })], [attention('a')], [capped(2)]).map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['item', 'question', 'review-cap']);
  });

  it('a closed run\'s cap does not count', () => {
    expect(needsYou([], [], [capped(8, { state: 'done', closedAt: 5 } as Partial<RunSummary>)])).toEqual([]);
  });
});

describe('every badge reads the selector', () => {
  const view = waitingView({ items: [itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-b' })] });
  const runs = [run(1, 'working', 'w1', null, 'prog-a')];
  const sessions = withRunBinding([attention('w1'), attention('x')], runs);

  it('the Waiting door, a programme chip and the Runs badge are counts of the one list', () => {
    const entries = needsYou(view.items, sessions, runs);
    expect(waitingItemsCount(view, sessions, runs)).toBe(needsYouCount(entries));
    expect(waitingItemsCount(view, sessions, runs)).toBe(4);
    expect(programmeWaitingCount(view, sessions, runs, 'prog-a')).toBe(needsYouCount(entries, 'prog-a'));
    expect(programmeWaitingCount(view, sessions, runs, 'prog-a')).toBe(2);
    expect(runsNeedYou(runs, sessions)).toBe(1);
  });

  it('no door sums for itself: the three readers import the selector and not the old sum', () => {
    const nav = read('fleet/navBadges.ts');
    expect(nav).toMatch(/needsYou/);
    expect(nav).not.toMatch(/waitingTotal/);
    const words = read('ledgers/ledgerWords.ts');
    const chip = words.slice(words.indexOf('export function programmeWaitingCount'), words.indexOf('export const openRunsOf'));
    expect(chip).toMatch(/needsYou/);
    expect(chip).not.toMatch(/waitingTotal/);
  });
});

describe('review caps join the page (Task 24, F21)', () => {
  it('the door and a chip count a waiting cap, which /waiting lists with Lift cap', () => {
    const entries = needsYou([itemView({ id: 1, program: 'prog-a' })], [], [capped(8), capped(9, { program: 'prog-b' } as Partial<RunSummary>)]);
    expect(needsYouCount(entries)).toBe(3);
    expect(needsYouCount(entries, 'prog-a')).toBe(2);
    expect(needsYouCount(entries, 'prog-b')).toBe(1);
  });
});
