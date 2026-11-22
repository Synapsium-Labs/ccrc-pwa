// Session helpers H3 (D-8875; spec 2026-11-19-session-helpers-design §4.4 and §4.5, Table 13's H3 row): the session panel
// sheds what the Helpers section replaced. SessionDetails draws no subagent button or list, no `N delegated` chip, no title of
// it and no activity row; a worktree row says its path, its disposition and its controls, and no liveness word; and a word
// census over the whole session panel (the header, SessionDetails, its worktrees and the Helpers section) finds no word of
// `LIVENESS_QUALIFIER` (its titles included) and no `unmeasured`, at a phone, a desk and the rail's width, in both skins.
//
// RED FIRST: committed before the code, against origin/main, where SessionDetails still draws both disclosures and a worktree
// row still says its liveness.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastHost } from '@ccrc/ui';
import { DELEGATION_LIVENESS, type DelegationActivityWire, type DelegationLiveness, type FleetSession, type SessionStreamMsg } from '../../shared/api';
import type { AgentHelperView, WorkflowView } from '../../shared/workflows';
import { SessionDetails } from '../src/session/SessionDetails';
import { SessionScreen } from '../src/screens/SessionScreen';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import { sessionFacts, type FactInput } from '../src/fleet/sessionFacts';
import { LIVENESS_QUALIFIER, readDelegation } from '../src/fleet/delegationWords';
import { PANEL_BANNED, SECTION_4_4_WORDS, bannedIn } from './panelCensus';
import { worktreeSidesKey, worktreesOf } from '../src/fleet/sessionWorktrees';
import { createSessionStore, getSessionStore } from '../src/stores/session';
import { InspectorSections } from '../src/inspector/InspectorSections';
import { navigate } from '../src/lib/router';
import { createFleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';
import { fleetSession } from './fleetFixture';
import { activity, frame, lease } from './delegationFixture';
import { SessionHeaderHost } from './sessionHost';

// SessionScreen renders ChatList, and Virtuoso needs a real viewport jsdom does not have (the stand-in session-lifecycle uses).
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode; computeItemKey?: (i: number) => string | number }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) => React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)))),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && !q.includes('pointer: coarse');
    return { matches, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  });
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const SUBAGENTS = [{ name: 'code-reviewer', startedAt: NOW - 60_000 }, { name: 'explorer', startedAt: NOW - 30_000 }];
const SELF = fleetSession({
  id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a', status: 'busy', bucket: 'working',
  subagents: SUBAGENTS, tasks: { done: 1, total: 3, running: 1, active: null },
});
/** The recorded entries the broker holds for `coord-a`, one of each liveness an entry carries on the wire (an ended one is
 *  never sent), and both kinds. */
const ENTRIES = DELEGATION_LIVENESS.filter((l): l is DelegationActivityWire['liveness'] => l !== 'ended').map((l, i) => activity({
  activityId: `act-${i}`, parentId: 'coord-a', liveness: l, sourceKind: i % 2 === 0 ? 'agent' : 'workflow', displayName: `entry ${i}`,
}));
/** One worktree of each liveness, half of them with their presence on disk not measured, each held (its disposition said).
 *  Their names carry no liveness word, so the census reads only what the page says. */
const LEASES = DELEGATION_LIVENESS.map((l, i) => lease({
  leaseId: `lease-${i}`, parentId: 'coord-a', liveness: l, adminRecord: `agent-${i}`,
  canonicalPath: `/work/project-a/.claude/worktrees/agent-${i}`, workspace: i % 2 === 0 ? 'unmeasured' : 'present',
  sourceKind: i === 0 ? 'raw' : 'agent', disposition: 'retained', expiresAt: '2026-11-28T10:00:00.000Z',
}));

/** What a reader of `root` meets: its text, and every title, accessible name and description in it. */
function everything(root: ParentNode): string[] {
  const out = [(root as Element).textContent ?? ''];
  for (const el of root.querySelectorAll('*')) {
    for (const a of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v !== null && v !== '') out.push(v);
    }
  }
  return out;
}

/** SessionDetails at `width`, its door opened on a phone, over facts built from `input` (handed on as it is, so a field the
 *  model no longer takes is simply not read). */
function details(input: Record<string, unknown>, width = 1280): void {
  stubWidth(width);
  render(<><SessionDetails facts={sessionFacts(input as unknown as FactInput)} coordination={null} /><ToastHost /></>);
  const door = screen.queryByRole('button', { name: 'Session details' });
  if (door !== null && door.getAttribute('aria-expanded') === 'false') fireEvent.click(door);
}

describe('SessionDetails sheds the broker\'s lists (H3, §4.5)', () => {
  for (const width of [360, 1280]) {
    it(`H3-1 at ${width}: no subagent button or list, no N delegated chip, no title of it and no activity row`, () => {
      details({ session: SELF, now: NOW, delegated: ENTRIES }, width);
      const region = document.querySelector<HTMLElement>('.chat-facts');
      // Positive control: the details row is drawn, with the session's other facts.
      expect(region, 'the details row is drawn').not.toBeNull();
      expect(region!.textContent).toContain('1/3 tasks');
      const buttons = within(region!).queryAllByRole('button').map((b) => `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`);
      expect(buttons.filter((b) => /subagent|delegated|⑂/i.test(b)), 'no disclosure toggle').toEqual([]);
      const texts = everything(region!);
      expect(texts.filter((t) => /subagent|\bdelegat|⑂|recorded entr|execution/i.test(t)), 'no count, chip, title or note of either').toEqual([]);
      expect(texts.filter((t) => /code-reviewer|explorer|entry \d/.test(t)), 'no name of a helper or an entry').toEqual([]);
      expect(region!.querySelector('.sess-subagent-list, .sess-subagents, .sess-entries, .proj-work'), 'no list and no row').toBeNull();
    });
  }
});

describe('a worktree row says its path, its disposition and its controls, and no liveness word (H3, §4.4)', () => {
  for (const l of DELEGATION_LIVENESS) {
    for (const ws of ['present', 'unmeasured'] as const) {
      it(`H3-2: a ${l} worktree whose presence is ${ws}`, () => {
        const w = readDelegation(frame({ leases: [lease({
          leaseId: 'lease-x', parentId: 'coord-a', liveness: l as DelegationLiveness, workspace: ws, adminRecord: 'agent-x',
          canonicalPath: '/work/project-a/.claude/worktrees/agent-x', disposition: 'retained', expiresAt: '2026-11-28T10:00:00.000Z',
        })] }));
        const key = worktreeSidesKey('coord-a', w, [SELF]);
        details({ session: { ...SELF, subagents: null, tasks: null }, now: NOW, worktrees: worktreesOf(w.leases, key) });
        const section = document.querySelector<HTMLElement>('.sess-worktrees')!;
        expect(section, 'the section is drawn').not.toBeNull();
        const rows = section.querySelectorAll<HTMLElement>('.proj-work');
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        // Its path, its disposition and its controls.
        expect(row.textContent).toContain('/work/project-a/.claude/worktrees/agent-x');
        expect(row.textContent).toContain('worktree kept until 28 Nov');
        expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Not delegated']);
        // No liveness word, in the row's words, its title or its controls' names.
        expect(bannedIn(everything(row)), 'the row says no liveness word and no `unmeasured`').toEqual([]);
        // The presence not measured is said once, in the section's head, never on the row.
        const said = (section.textContent ?? '').split('presence on disk not measured for 1 tree').length - 1;
        expect(said, 'said once in the head').toBe(ws === 'unmeasured' ? 1 : 0);
        expect(row.textContent).not.toMatch(/presence on disk/);
      });
    }
  }
});

const agent = (id: string, o: Partial<AgentHelperView> = {}): AgentHelperView => ({
  id, description: `Measure ${id}`, agentType: 'general-purpose', model: 'Sonnet', effort: 'high', state: 'running',
  startedAt: NOW - 725_000, endedAt: null, lastActivityAt: NOW - 20_000, tokens: 41_000, summary: null, hasReport: false, ...o,
});
const wf = (id: string, o: Partial<WorkflowView> = {}): WorkflowView => ({
  id, name: 'review-panel', state: 'running', done: 7, failed: 0, total: 12, phase: 'Verify', phases: ['Build', 'Verify'],
  startedAt: NOW - 362_000, endedAt: null, tokens: null, tokensUnmeasured: 0,
  agents: [{ label: 'build', phase: 'Build', state: 'done' }, { label: 'verify-1', phase: 'Verify', state: 'running' }],
  agentsOmitted: 0, lastActivityAt: NOW - 4_000, ...o,
});
/** A Helpers frame with a row of every state, a workflow whose tokens and progress were not read, and a stale roster. */
const HELPERS: Partial<SessionStreamMsg & { type: 'workflows' }> = {
  workflows: [wf('wf_00000000-aaa'), wf('wf_00000000-bbb', { done: null, total: null, failed: null })],
  agents: [
    agent('running one'), agent('unlisted one', { state: 'unlisted' }), agent('gone one', { state: 'gone' }),
    agent('unknown one', { state: 'unmeasured' }), agent('launched one', { state: 'launched' }),
    agent('done one', { state: 'done', endedAt: NOW - 60_000, summary: 'it worked', hasReport: true }),
    agent('failed one', { state: 'failed', endedAt: NOW - 60_000, summary: 'it broke' }),
    agent('stopped one', { state: 'stopped', endedAt: NOW - 60_000 }), agent('finished one', { state: 'finished', endedAt: NOW - 60_000 }),
  ],
  agentsUnmeasured: { why: 'stale', hookAgeMs: 41 * 60_000 },
};

/** The real session page of `coord-a` at `width` in `set`, over a fleet store carrying the session and its frame and a
 *  session store carrying its helpers; every door of the panel opened (the details, the Helpers head, the finished fold). */
function panel(width: number, set = REFINED_SET): HTMLElement {
  stubWidth(width);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const fleet = createFleetStore();
  act(() => { fleet.setState({ roster: TEST_ROSTER, sessions: [SELF], delegation: frame({ activities: ENTRIES, leases: LEASES }) }); });
  const store = createSessionStore('coord-a', {
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, readyState: 1, close() {}, send() {} }) as unknown as WebSocket,
    api: { prompt: async () => {} },
  });
  act(() => {
    store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
    store.getState().apply({ type: 'workflows', workflows: [], ...HELPERS } as SessionStreamMsg);
  });
  // From 1600 px a skin with an inspector draws the Helpers section in its rail (`InspectorSections`, which reads the routed
  // session's own store), not under the transcript: both are drawn here, over the same frame.
  const rail = width >= 1600 && set === REFINED_SET;
  if (rail) {
    act(() => navigate('/s/coord-a'));
    act(() => getSessionStore('coord-a').getState().apply({ type: 'workflows', workflows: [], ...HELPERS } as SessionStreamMsg));
  }
  const r = render(<SkinSetProvider set={set}><SessionScreen id="coord-a" store={store} fleet={fleet} />{rail && <InspectorSections />}<ToastHost /></SkinSetProvider>);
  const door = screen.queryByRole('button', { name: 'Session details' });
  if (door !== null && door.getAttribute('aria-expanded') === 'false') fireEvent.click(door);
  // The Helpers head first (under the transcript; the rail's section is always open), then the finished fold. A finished row
  // is left closed, so no report is asked.
  const strip = r.container.querySelector<HTMLElement>('.chat-strips .helpers-strip');
  if (strip !== null) fireEvent.click(within(strip).getByRole('button', { name: /^Helpers/ }));
  for (const b of r.container.querySelectorAll<HTMLElement>('.helpers-fold-toggle[aria-expanded="false"]')) fireEvent.click(b);
  expect(r.container.querySelectorAll('.helpers-fold-toggle[aria-expanded="true"]').length, 'the finished fold is open').toBeGreaterThan(0);
  return r.container;
}

describe('the word census over the whole session panel (H3, §4.4)', () => {
  const VIEWS: ReadonlyArray<[string, number, typeof REFINED_SET]> = [
    ['Refined 360', 360, REFINED_SET], ['Refined 1280', 1280, REFINED_SET], ['Refined 1600', 1600, REFINED_SET],
    ['Instrument 360', 360, INSTRUMENT_SET], ['Instrument 1280', 1280, INSTRUMENT_SET],
  ];
  for (const [name, width, set] of VIEWS) {
    it(`H3-3 ${name}: the header, SessionDetails, its worktrees and Helpers say no liveness word and no unmeasured`, () => {
      const root = panel(width, set);
      // Positive controls: each part of the panel is drawn, so the census reads something.
      expect(root.querySelector('.chat-head'), 'the header').not.toBeNull();
      expect(root.querySelector('.sess-worktrees'), 'the worktrees section').not.toBeNull();
      expect(root.querySelectorAll('.sess-worktrees .proj-work')).toHaveLength(LEASES.length);
      expect(root.querySelector('[data-helper-row]'), 'a Helpers row').not.toBeNull();
      expect(root.textContent).toContain('Measure running one');
      const all = everything(root);
      expect(bannedIn(all), `no liveness word, no liveness sentence, no \`unmeasured\`: ${all.filter((t) => /unmeasured/i.test(t)).map((t) => t.slice(Math.max(0, t.toLowerCase().indexOf('unmeasured') - 80), t.toLowerCase().indexOf('unmeasured') + 40)).join(' | ')}`).toEqual([]);
    });
  }
});

// Review 2995 F2 (C51): the focus the worktree controls hand back when their row leaves is decided from the header's facts
// of the render that removes it. When the last worktree and the details row's only other fact leave in one frame, the row
// goes with them, and the focus rests on the header's title, never on the region that is leaving. RED FIRST: at `main`
// the section kept the previous render's answer (the other fact was there), so the focus went to the leaving region.
describe('the focus when the last worktree leaves with the row\'s other fact (review 2995 F2)', () => {
  it('H3-4: the header\'s title takes it', () => {
    stubWidth(1280);
    const w = readDelegation(frame({ leases: [lease({ leaseId: 'lease-x', parentId: 'coord-a', disposition: 'retained', expiresAt: null })] }));
    const key = worktreeSidesKey('coord-a', w, [SELF]);
    // A workspace session (a main checkout's details always name it): its tasks and its worktree are the row's only facts.
    const bare = { ...SELF, workspace: 'still-pond', name: null, subagents: null };
    const props = (session: FleetSession, worktrees: ReturnType<typeof worktreesOf>) => ({
      session, status: session.status, statusUpdatedAt: null, facts: sessionFacts({ session, now: NOW, worktrees }),
      onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
      onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
    });
    const r = render(<SessionHeaderHost {...props(bare, worktreesOf(w.leases, key))} />);
    const keep = screen.getByRole('button', { name: /^Keep worktree/ });
    act(() => keep.focus());
    expect(document.activeElement).toBe(keep);
    // The tasks were the details row's only other fact: both leave in the same frame.
    r.rerender(<SessionHeaderHost {...props({ ...bare, tasks: null }, [])} />);
    expect(document.querySelector('.chat-facts'), 'the details row is gone').toBeNull();
    expect(document.activeElement, 'the focus rests on the header\'s title').toBe(document.querySelector('.chat-head .chat-title'));
  });
});

// Found by the mutation run (`details-drawn-shown-only` survived): the details region is drawn at a desk and behind its door on
// a phone, so whether it stays is the width's answer too. A desk turned phone width with the door closed (a window narrowed)
// while the focus is in a worktree control removes the region; the focus rests on the header's title. Red at `main` as well.
describe('the focus when the details go behind their door (H3, review 2995 F2)', () => {
  it('H3-5: a desk narrowed to a phone with the focus in a worktree control rests it on the title', () => {
    let width = 1280;
    type Listener = (e: { matches: boolean; media: string }) => void;
    const listeners = new Map<Listener, () => boolean>();
    vi.stubGlobal('matchMedia', (q: string) => {
      const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
      const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
      const now = (): boolean => (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && !q.includes('pointer: coarse');
      return {
        get matches() { return now(); },
        media: q, onchange: null, dispatchEvent: () => false,
        addListener(f: Listener) { listeners.set(f, now); }, removeListener(f: Listener) { listeners.delete(f); },
        addEventListener(_: string, f: Listener) { listeners.set(f, now); }, removeEventListener(_: string, f: Listener) { listeners.delete(f); },
      };
    });
    const w = readDelegation(frame({ leases: [lease({ leaseId: 'lease-x', parentId: 'coord-a', disposition: 'retained', expiresAt: null })] }));
    const key = worktreeSidesKey('coord-a', w, [SELF]);
    // A workspace session whose details hold its tasks and its worktree: the row has facts at both widths.
    const session = { ...SELF, workspace: 'still-pond', name: null, subagents: null };
    render(<SessionHeaderHost session={session} status={session.status} statusUpdatedAt={null}
      facts={sessionFacts({ session, now: NOW, worktrees: worktreesOf(w.leases, key) })}
      onInterrupt={vi.fn()} onOpenTerminal={vi.fn()} onBack={vi.fn()} onChangeModel={vi.fn()} onChangeEffort={vi.fn()}
      onMoveAccount={vi.fn()} onArchive={vi.fn()} onRestore={vi.fn()} onOpenHistory={vi.fn()} onReapWorkspace={vi.fn()} />);
    const keep = screen.getByRole('button', { name: /^Keep worktree/ });
    act(() => keep.focus());
    expect(document.activeElement).toBe(keep);
    act(() => { width = 360; for (const [f, now] of [...listeners]) f({ matches: now(), media: '' }); });
    expect(document.querySelector('.chat-facts'), 'on a phone the details wait behind their door').toBeNull();
    expect(screen.getByRole('button', { name: 'Session details' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement, 'the focus rests on the header\'s title').toBe(document.querySelector('.chat-head .chat-title'));
  });
});

// Review 3123 F1 (HF2, D-8877): the census's banned list holds §4.4's five words as the spec spells them, on their own, so an
// edit to `LIVENESS_QUALIFIER` (kept as wire tolerance, read by no page) cannot loosen it. RED FIRST: at `main` the list was the
// table's words alone, and a row drawing "not confirmed" passed the census once the table's `live` word was changed.
describe('the census list is §4.4\'s five words (HF2, review 3123 F1)', () => {
  it('HF2-1: the banned list holds each of §4.4\'s five words, spelled as the spec spells them', () => {
    expect([...SECTION_4_4_WORDS]).toEqual(['not confirmed', 'stop not seen', 'session asleep', 'end recorded', 'unmeasured']);
    for (const w of SECTION_4_4_WORDS) expect(PANEL_BANNED, w).toContain(w);
    // And the table's own words and sentences, whatever they say.
    for (const q of Object.values(LIVENESS_QUALIFIER)) expect(PANEL_BANNED).toEqual(expect.arrayContaining([q.word, q.title]));
  });

  it('HF2-2: a row saying one of the five is caught by the census, whatever the table says', () => {
    for (const w of SECTION_4_4_WORDS) {
      expect(bannedIn([`agent worktree · ${w} · worktree kept`]), w).toContain(w);
    }
  });
});

// Review 3123 F12 (HF2): the head's count of trees whose presence was not measured is pinned at more than one tree.
describe('the worktrees head counts every tree whose presence was not measured (HF2, review 3123 F12)', () => {
  for (const [unmeasured, said] of [[2, '2 trees'], [3, '3 trees']] as const) {
    it(`HF2-3: ${unmeasured} of 4 not measured: the head says "${said}", once`, () => {
      const w = readDelegation(frame({ leases: [0, 1, 2, 3].map((i) => lease({
        leaseId: `lease-${i}`, parentId: 'coord-a', adminRecord: `agent-${i}`, canonicalPath: `/work/project-a/.claude/worktrees/agent-${i}`,
        workspace: i < unmeasured ? 'unmeasured' : 'present', disposition: 'retained', expiresAt: null,
      })) }));
      const key = worktreeSidesKey('coord-a', w, [SELF]);
      details({ session: { ...SELF, subagents: null, tasks: null }, now: NOW, worktrees: worktreesOf(w.leases, key) });
      const section = document.querySelector<HTMLElement>('.sess-worktrees')!;
      expect(section.querySelectorAll('.proj-work')).toHaveLength(4);
      expect((section.textContent ?? '').split(`presence on disk not measured for ${said}`).length - 1).toBe(1);
    });
  }
});
