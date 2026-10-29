// The programme box's decider (Task G2): which rows of a project card make up a coordinator's box, its lead
// programme, its progress, its hue, its state and its movement words. Pure, skin-independent; the card that draws it
// is pinned in `programme-box-card.test.tsx`.
import { describe, expect, it } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { nestFleet } from '../src/fleet/nestFleet';
import {
  PROG_HUES, assignHues, boxNeeds, boxOrder, boxState, movementWords, programmeBoxes, type BoxState, type ProgrammeBoxView,
} from '../src/fleet/programmeBox';
import { HOUR, MIN, NOW, asking, run, sess } from './rollupFixture';

const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working' });
const kid = (id: string, over: Partial<FleetSession> = {}): FleetSession => sess(id, 'project-c', { role: 'child', ...over });

/** One card's rows, nested exactly as the fleet tree nests them. */
const boxesOf = (
  sessions: FleetSession[], runs: RunSummary[], lastMoveOf: (r: RunSummary) => number | null = () => null,
): ReturnType<typeof programmeBoxes> => programmeBoxes(nestFleet(sessions, runs), runs, lastMoveOf);

const only = (b: ReturnType<typeof programmeBoxes>): ProgrammeBoxView => {
  expect(b.boxes).toHaveLength(1);
  return b.boxes[0]!;
};

const view = (over: Partial<ProgrammeBoxView> = {}): ProgrammeBoxView => ({
  coordinatorId: 'coord', coordinator: coord,
  lead: { slug: 'port-api', title: 'Port the API', hue: 'blue' }, more: 0,
  progress: { wave: 1, waveOf: 3 }, children: [], abroad: [], lastMoveAt: null, waiting: null, ...over,
});

describe('assignHues', () => {
  it('pins the preferred hue to FNV-1a 32-bit of the slug, modulo 4', () => {
    // FNV-1a('port-api') = 0xe8a2d4eb (3: blue), ('billing') = 0x417000dc (0: cyan), ('docs-site') = 0x6d9561a6
    // (2: magenta), ('checkout-revamp') = 0x948fe9d5 (1: violet): one of each, so none collides.
    const m = assignHues(['port-api', 'billing', 'docs-site', 'checkout-revamp']);
    expect(Object.fromEntries(m)).toEqual({ 'port-api': 'blue', billing: 'cyan', 'docs-site': 'magenta', 'checkout-revamp': 'violet' });
    expect(PROG_HUES).toEqual(['cyan', 'violet', 'magenta', 'blue']);
  });

  it('is stable across calls and input order', () => {
    const a = assignHues(['search-index', 'billing', 'port-api']);
    const b = assignHues(['port-api', 'search-index', 'billing']);
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
    expect(Object.fromEntries(assignHues(['billing', 'port-api', 'search-index']))).toEqual(Object.fromEntries(a));
  });

  it('gives two slugs that share an FNV bucket different hues: the later in slug order takes the next free one', () => {
    // 'billing' and 'search-index' both hash to cyan.
    expect(assignHues(['search-index']).get('search-index')).toBe('cyan');
    expect(assignHues(['billing']).get('billing')).toBe('cyan');
    const m = assignHues(['search-index', 'billing']);
    expect(m.get('billing')).toBe('cyan');
    expect(m.get('search-index')).toBe('violet');
  });

  it('repeats exactly one hue for five slugs', () => {
    const m = assignHues(['port-api', 'billing', 'docs-site', 'checkout-revamp', 'search-index']);
    const counts = new Map<string, number>();
    for (const h of m.values()) counts.set(h, (counts.get(h) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 1, 1, 2]);
    // Every hue taken, the fifth falls back to its preferred hue.
    expect(m.get('search-index')).toBe('cyan');
  });
});

describe('programmeBoxes', () => {
  it('gives a coordinator with three children one box whose children are those three', () => {
    const kids = [kid('w1'), kid('w2'), kid('w3')];
    const b = only(boxesOf([coord, ...kids], kids.map((k, i) => run(10 + i, 'coord', k.id))));
    expect(b.coordinatorId).toBe('coord');
    expect(b.coordinator.id).toBe('coord');
    expect(b.children.map((r) => (r.kind === 'session' ? r.session.id : `spawn:${r.run.id}`))).toEqual(['w1', 'w2', 'w3']);
    expect(b.lead).toMatchObject({ slug: 'port-api', title: 'Port the API' });
    expect(b.more).toBe(0);
  });

  it('gives a coordinator holding runs of two programmes one box, led by the programme with more work runs', () => {
    const kids = [kid('w1'), kid('w2'), kid('w3')];
    const runs = [
      run(10, 'coord', 'w1', { program: 'billing', programTitle: 'Billing' }),
      run(11, 'coord', 'w2'),
      run(12, 'coord', 'w3'),
    ];
    const r = boxesOf([coord, ...kids], runs);
    const b = only(r);
    expect(b.more).toBe(1);
    expect(b.lead.slug).toBe('port-api');
    expect(b.children).toHaveLength(3);
    expect(r.hues.get('billing')).toBeDefined();
    expect(r.hues.get('billing')).not.toBe(r.hues.get('port-api'));
  });

  it('breaks a tie between two programmes toward the newest run', () => {
    const kids = [kid('w1'), kid('w2')];
    const runs = [run(10, 'coord', 'w1'), run(11, 'coord', 'w2', { program: 'billing', programTitle: 'Billing' })];
    expect(only(boxesOf([coord, ...kids], runs)).lead.slug).toBe('billing');
  });

  it('does not count a review run toward the lead or the progress', () => {
    const kids = [kid('w1'), kid('r1'), kid('r2')];
    const runs = [
      run(10, 'coord', 'w1', { wave: 2, waveOf: 6 }),
      run(11, 'coord', 'r1', { program: 'billing', kind: 'review', wave: 5, waveOf: 6 }),
      run(12, 'coord', 'r2', { program: 'billing', kind: 'review', wave: 5, waveOf: 6 }),
      run(13, 'coord', null, { kind: 'review', wave: 3, waveOf: 6, state: 'planned' }),
    ];
    const b = only(boxesOf([coord, ...kids], runs));
    expect(b.lead.slug).toBe('port-api');
    expect(b.progress).toEqual({ wave: 2, waveOf: 6 });
  });

  it('takes the furthest work wave of the lead, and a null total when it declared none', () => {
    const kids = [kid('w1'), kid('w2')];
    const runs = [run(10, 'coord', 'w1', { wave: 3, waveOf: null }), run(11, 'coord', 'w2', { wave: 62, waveOf: null })];
    expect(only(boxesOf([coord, ...kids], runs)).progress).toEqual({ wave: 62, waveOf: null });
  });

  it('sends a worker whose coordinator is on another card to elsewhere, not lone', () => {
    const far = sess('w9', 'project-b', { role: 'child' });
    const lone = sess('l1', 'project-b');
    const r = boxesOf([far, lone], [run(20, 'coord', 'w9', { project: 'project-b' })]);
    expect(r.boxes).toEqual([]);
    expect(r.elsewhere.map((x) => (x.kind === 'session' ? x.session.id : ''))).toEqual(['w9']);
    expect(r.lone.map((x) => (x.kind === 'session' ? x.session.id : ''))).toEqual(['l1']);
    expect(r.hues.get('port-api')).toBe('blue');
  });

  it('sends a spawn whose coordinator is not on this card to elsewhere', () => {
    const r = boxesOf([sess('l1', 'project-b')], [run(21, 'coord', null, { state: 'planned', dispatchStartedAt: NOW - MIN })]);
    expect(r.elsewhere.map((x) => x.kind)).toEqual(['pending']);
    expect(r.lone).toHaveLength(1);
  });

  it('keeps a coordinator with no open run in lone, as an ordinary row', () => {
    const r = boxesOf([coord, sess('l1', 'project-c')], []);
    expect(r.boxes).toEqual([]);
    expect(r.lone.map((x) => (x.kind === 'session' ? x.session.id : ''))).toEqual(['coord', 'l1']);
  });

  it('makes a coordinator whose only open run has no worker yet a box, its spawn in the tray', () => {
    const r = boxesOf([coord], [run(22, 'coord', null, { state: 'planned', dispatchStartedAt: NOW - MIN })]);
    expect(only(r).children.map((x) => x.kind)).toEqual(['pending']);
    expect(r.lone).toEqual([]);
  });

  it('lists a claimed run whose worker is on another card as the box\'s abroad, never as a child', () => {
    const kids = [kid('w1')];
    const runs = [run(10, 'coord', 'w1'), run(30, 'coord', 'far', { project: 'project-b', wave: 5 })];
    const b = only(boxesOf([coord, ...kids], runs));
    expect(b.children).toHaveLength(1);
    expect(b.abroad.map((r) => r.id)).toEqual([30]);
  });

  it('keeps the parent role of a coordinator that is also another coordinator\'s worker (nestFleet rule 4)', () => {
    const sub = kid('sub', { role: 'coordinator' });
    const runs = [run(10, 'coord', 'sub'), run(11, 'sub', 'w1'), run(12, 'coord', 'w2')];
    const r = boxesOf([coord, sub, kid('w1'), kid('w2')], runs);
    expect(r.boxes.map((b) => b.coordinatorId)).toEqual(['coord', 'sub']);
    expect(r.boxes[0]!.abroad).toEqual([]);
  });

  it('takes lastMoveAt as the newest move over the coordinator\'s open runs, and null when no move is known', () => {
    const kids = [kid('w1'), kid('w2')];
    const runs = [run(10, 'coord', 'w1'), run(11, 'coord', 'w2'), run(30, 'coord', 'far', { project: 'project-b' })];
    expect(only(boxesOf([coord, ...kids], runs)).lastMoveAt).toBeNull();
    const moves = new Map([[10, NOW - 3 * HOUR], [11, null], [30, NOW - 20 * MIN]]);
    expect(only(boxesOf([coord, ...kids], runs, (r) => moves.get(r.id) ?? null)).lastMoveAt).toBe(NOW - 20 * MIN);
  });

  it('names the lead run\'s wait when it is awaiting review or merging', () => {
    const kids = [kid('w1'), kid('w2')];
    const waitingOn = (state: RunSummary['state']): ProgrammeBoxView['waiting'] =>
      only(boxesOf([coord, ...kids], [run(10, 'coord', 'w1'), run(11, 'coord', 'w2', { wave: 2, state })])).waiting;
    expect(waitingOn('awaiting-review')).toBe('awaiting-review');
    expect(waitingOn('merging')).toBe('merging');
    expect(waitingOn('working')).toBeNull();
  });

  it('says a box needs the operator when its coordinator or a child is the operator\'s ask', () => {
    const kids = [kid('w1', asking()), kid('w2')];
    const runs = [run(10, 'coord', 'w1'), run(11, 'coord', 'w2')];
    expect(boxNeeds(only(boxesOf([coord, ...kids], runs)))).toBe(true);
    expect(boxNeeds(only(boxesOf([coord, kid('w1'), kid('w2')], runs)))).toBe(false);
    const askingCoord = sess('coord', 'project-c', { role: 'coordinator', ...asking() });
    expect(boxNeeds(only(boxesOf([askingCoord, kid('w1'), kid('w2')], runs)))).toBe(true);
  });
});

describe('boxState', () => {
  const quiet = 7_200_000;

  it('lets attention win over every other state', () => {
    const b = view({ lastMoveAt: NOW - 5 * HOUR });
    expect(boxState(b, true, NOW, quiet, true)).toBe('needs');
    expect(boxState(b, true, NOW, quiet, false)).toBe('needs');
  });

  it('lets paused win over stalled', () => {
    expect(boxState(view({ lastMoveAt: NOW - 5 * HOUR }), false, NOW, quiet, true)).toBe('paused');
  });

  it('stalls at the quiet threshold, not a millisecond before', () => {
    expect(boxState(view({ lastMoveAt: NOW - 7_199_999 }), false, NOW, quiet, false)).toBe('moving');
    expect(boxState(view({ lastMoveAt: NOW - 7_200_000 }), false, NOW, quiet, false)).toBe('stalled');
  });

  it('never stalls with no threshold or no known move (G1 absent)', () => {
    expect(boxState(view({ lastMoveAt: NOW - 50 * HOUR }), false, NOW, null, false)).toBe('moving');
    expect(boxState(view({ lastMoveAt: null }), false, NOW, quiet, false)).toBe('moving');
  });
});

describe('movementWords', () => {
  it('says how long ago a moving programme moved', () => {
    const b = view({ lastMoveAt: NOW - 3 * MIN });
    expect(movementWords(b, 'moving', NOW)).toBe('moved 3m ago');
    expect(movementWords(view({ lastMoveAt: NOW - 20_000 }), 'moving', NOW)).toBe('moved just now');
  });

  it('says how long a stalled programme has been quiet, and what it waits on', () => {
    const at = NOW - (2 * HOUR + 10 * MIN);
    expect(movementWords(view({ lastMoveAt: at }), 'stalled', NOW)).toBe('no move 2h 10m');
    expect(movementWords(view({ lastMoveAt: at, waiting: 'awaiting-review' }), 'stalled', NOW)).toBe('no move 2h 10m · awaiting review');
    expect(movementWords(view({ lastMoveAt: at, waiting: 'merging' }), 'stalled', NOW)).toBe('no move 2h 10m · merging');
  });

  it('says paused under the operator\'s pause', () => {
    expect(movementWords(view({ lastMoveAt: NOW - 5 * HOUR }), 'paused', NOW)).toBe('paused');
  });

  it('says nothing when no move is known', () => {
    expect(movementWords(view({ lastMoveAt: null }), 'moving', NOW)).toBe('');
    expect(movementWords(view({ lastMoveAt: null }), 'needs', NOW)).toBe('');
  });
});

describe('boxOrder', () => {
  const ranked = (state: BoxState, at: number | null, id: string): { state: BoxState; view: ProgrammeBoxView } =>
    ({ state, view: view({ coordinatorId: id, lastMoveAt: at }) });

  it('orders needs, then stalled, then moving and paused, then the longest quiet first', () => {
    const list = [
      ranked('moving', NOW - 10 * MIN, 'm-recent'),
      ranked('paused', NOW - 3 * HOUR, 'p-old'),
      ranked('stalled', NOW - 3 * HOUR, 's'),
      ranked('moving', NOW - 50 * MIN, 'm-older'),
      ranked('needs', NOW - MIN, 'n'),
    ];
    expect([...list].sort(boxOrder).map((b) => b.view.coordinatorId)).toEqual(['n', 's', 'p-old', 'm-older', 'm-recent']);
  });

  it('keeps the input order when no move is known', () => {
    const list = [ranked('moving', null, 'a'), ranked('moving', null, 'b'), ranked('moving', null, 'c')];
    expect([...list].sort(boxOrder).map((b) => b.view.coordinatorId)).toEqual(['a', 'b', 'c']);
  });
});
