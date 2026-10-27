// The inspector's shared sections and Refined's rail (W2 Task S8, D-5474; spec §5.1 and §5.3, Inspector).
//
// RED FIRST, and what each case catches:
//   the rail at `min-width: 1440px` ....................................... "…renders at 1600 and not at 1599…"
//   the column keeps the task strip at 1600 ............................... "…one instance per width"
//   a section re-implemented inside `InspectorRail.tsx` .................... "…are the shared components"
//   `useInspectorSession` reads the id from a prop the frame never passes .. "…nothing off a session route"
//   the section ignores `tasksTouchedAt` (D-5372 lost at >=1600) ............ "…a stale plan is a plan left open"
//   a section re-implemented as an arrow or an aliased import .............. "…the same markup as the shared ones"
//   the model and effort doors named by their value alone .................. "…named by their field"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TASKS_STALE_MS, type AccountUsage, type FleetSession, type MailSummary, type TaskItem } from '../../shared/api';
import {
  HistorySection, InspectorSections, LaneSection, MailSection, PrSection, RoutingSection, TasksSection,
} from '../src/inspector/InspectorSections';
import { navigate } from '../src/lib/router';
import { SessionScreen } from '../src/screens/SessionScreen';
import { SkinSetProvider } from '../src/skins/frame';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import { REFINED_SET } from '../src/skins/refined/parts';
import { createFleetStore, useFleetStore } from '../src/stores/fleet';
import { createSessionStore, getSessionStore } from '../src/stores/session';
import { fleetSession } from './fleetFixture';

const SRC = path.join(import.meta.dirname, '..', 'src');

/** A viewport `width` px wide: every `(min-width: Npx)` answers from it, a `max-width` from it too. */
function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]))
      && !q.includes('pointer: coarse');
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

const ID = 'lane-a-project-a-quiet-basin';
const task = (id: string, subject: string, status: TaskItem['status']): TaskItem => ({
  id, subject, description: `why ${subject}`, activeForm: `doing ${subject}`, status,
});
const PLAN: TaskItem[] = [task('1', 'write the spec', 'completed'), task('2', 'build the rail', 'in_progress'), task('3', 'ship it', 'pending')];
const MAIL: MailSummary[] = [{
  id: 1, deliveryId: 1, at: Date.now() - 30_000, fromId: 'coordinator', toId: ID, runId: 3, kind: 'question',
  subject: 'rebase before you start?', artifacts: [], state: 'delivered', attempts: 0, lastError: null,
  lastGate: null, gateCount: 0, gateSince: null, gateAt: null,
} as MailSummary];
const ROW: FleetSession = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin', model: 'model-x',
  effort: 'high',
  pr: { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
    checkedAt: Date.now(), mergedAt: null, retryAt: null },
});
const USAGE: AccountUsage = {
  wrapper: 'lane-a', five: 12, seven: 64, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false,
  sevenRolledOver: false, disabled: false, authDead: false,
} as AccountUsage;

function seed(): void {
  useFleetStore.setState({
    sessions: [ROW], usage: [USAGE],
    roster: [{ id: 'lane-a', label: 'Lane A', hue: 'acct-1', homeAble: true } as never],
  });
  const store = getSessionStore(ID);
  act(() => {
    store.getState().apply({ type: 'tasks', tasks: PLAN });
    store.getState().apply({ type: 'mail', mail: MAIL });
  });
}

function goTo(p: string): void {
  act(() => navigate(p));
}

beforeEach(() => {
  seed();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the inspector sections', () => {
  it('each section renders from the session store and the fleet row, and nothing off a session route', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    const { container, unmount } = render(<InspectorSections />);
    const section = (id: string): HTMLElement => {
      const el = container.querySelector<HTMLElement>(`[data-section='${id}']`);
      expect(el, id).not.toBeNull();
      return el!;
    };
    // From the session store.
    expect(within(section('tasks')).getByText('build the rail')).toBeInTheDocument();
    expect(within(section('mail')).getByText('rebase before you start?')).toBeInTheDocument();
    // From the fleet row.
    expect(section('pr').textContent).toContain('#123');
    expect(section('pr').querySelector("[data-command='session-pr']")).not.toBeNull();
    expect(within(section('routing')).getByText('model-x')).toBeInTheDocument();
    expect(within(section('routing')).getByText('high')).toBeInTheDocument();
    expect(section('routing').querySelector("[data-command='session-model']")).not.toBeNull();
    expect(section('routing').querySelector("[data-command='session-effort']")).not.toBeNull();
    // The lane: one meter, the binding (7d) window, its name in mono.
    expect(section('lane').querySelectorAll('.meter')).toHaveLength(1);
    expect(section('lane').querySelector('.insp-lane-name')?.textContent).toBe('Lane A');
    expect(section('lane').textContent).toContain('64%');
    expect(section('history').querySelector("[data-command='open-history']")).not.toBeNull();
    unmount();

    // Off a session route, every section renders nothing; a route with a param of its own is not a session either.
    for (const p of ['/runs', '/settings/nope']) {
      goTo(p);
      for (const S of [TasksSection, MailSection, PrSection, RoutingSection, LaneSection, HistorySection]) {
        const r = render(<S />);
        expect(r.container.innerHTML, `${p} ${S.name}`).toBe('');
        r.unmount();
      }
      const rail = render(<Rail />);
      expect(rail.container.innerHTML, p).toBe('');
      rail.unmount();
    }
  });

  it("the lane's reading is the fleet store's own read of the accounts, kept across a malformed answer", async () => {
    let answer: unknown = { accounts: [USAGE], projected: null, roster: [] };
    const fleet = createFleetStore({ fetchAccounts: async () => answer as never });
    expect(fleet.getState().usage).toBeNull();
    await fleet.getState().refreshAccounts();
    expect(fleet.getState().usage).toEqual([USAGE]);
    answer = { projected: null, roster: [] };
    await fleet.getState().refreshAccounts();
    expect(fleet.getState().usage).toEqual([USAGE]);
  });

  it('the tasks section is always expanded', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    const { container } = render(<TasksSection />);
    // Every task, completed ones included, with its description, and no control that folds them.
    for (const t of PLAN) {
      expect(screen.getByText(t.subject)).toBeInTheDocument();
      expect(screen.getByText(t.description)).toBeInTheDocument();
    }
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    // The terminal's order: running, then left, then done.
    expect([...container.querySelectorAll('.insp-task-subject')].map((e) => e.textContent))
      .toEqual(['build the rail', 'ship it', 'write the spec']);
  });

  it('a stale plan is a plan left open (D-5372): its age, "open", no running mark; a fresh one names its running work', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    const store = getSessionStore(ID);
    // Fresh: the running task's activeForm heads the plan, and its row says running.
    act(() => store.getState().apply({ type: 'tasks', tasks: PLAN, touchedAt: Date.now() - 60_000 }));
    let r = render(<TasksSection />);
    expect(r.container.querySelector('.insp-tasks-head')?.textContent).toBe('doing build the rail');
    expect(r.container.textContent).toContain('(running)');
    expect(r.container.textContent).not.toContain('untouched');
    r.unmount();

    // Stale: nothing has written the list for longer than TASKS_STALE_MS.
    act(() => store.getState().apply({ type: 'tasks', tasks: PLAN, touchedAt: Date.now() - TASKS_STALE_MS - 3_600_000 }));
    r = render(<TasksSection />);
    expect(r.container.querySelector('.insp-tasks-head')?.textContent).toBe('Plan · untouched 7h');
    expect(r.container.textContent).not.toContain('running');
    expect(r.container.textContent).not.toContain('doing build the rail');
    expect(r.container.textContent).toContain('(open)');
    expect(r.container.querySelector("[data-section='tasks'] .insp-tasks")?.getAttribute('data-stale')).toBe('true');
    r.unmount();
  });

  it('the model and effort doors are named by their field, not by their value alone', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    render(<RoutingSection />);
    expect(screen.getByRole('button', { name: 'Model: model-x, change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Effort: high, change' })).toBeInTheDocument();
  });
});

/** A session id the `seed()` never fills: its store holds no tasks and no mail. */
const BARE = 'lane-a-project-a-calm-ridge';
const sectionIds = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-section]')].map((e) => e.getAttribute('data-section')!);

describe('a section with nothing to show renders nothing (desktop polish T3d, D-6334)', () => {
  it('an empty Tasks, Mail or PR section does not render', () => {
    stubWidth(1920);
    goTo(`/s/${BARE}`);
    const workspaceNoPr = fleetSession({
      id: BARE, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'calm-ridge', model: 'model-x',
      effort: 'high',
      pr: { phase: 'none', number: null, url: null, title: null, checks: 'none', checkNames: null, ahead: 0,
        reason: null, checkedAt: null, mergedAt: null, retryAt: null } as never,
    });
    const mainCheckout = fleetSession({
      id: BARE, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: null, model: 'model-x',
      effort: 'high',
    });
    for (const row of [workspaceNoPr, mainCheckout]) {
      act(() => useFleetStore.setState({ sessions: [row] }));
      const { container, unmount } = render(<InspectorSections />);
      for (const id of ['tasks', 'mail', 'pr']) {
        expect(container.querySelector(`[data-section='${id}']`), `${row.workspace} ${id}`).toBeNull();
      }
      for (const words of ['No plan', 'No mail', 'Not read yet', 'No PR']) {
        expect(container.textContent, words).not.toContain(words);
      }
      unmount();
    }
  });

  it('History renders alone when nothing else has content', () => {
    stubWidth(1920);
    goTo(`/s/${BARE}`);
    // No fleet row yet (a deep link), no tasks, no mail, no usage reading.
    act(() => useFleetStore.setState({ sessions: [], usage: null }));
    let r = render(<Rail />);
    expect(sectionIds(r.container)).toEqual(['history']);
    r.unmount();

    // A main checkout with a row: what runs is content, so Routing joins History and nothing else does.
    act(() => useFleetStore.setState({
      sessions: [fleetSession({ id: BARE, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', model: 'model-x', effort: 'high' })],
      usage: [],
    }));
    r = render(<Rail />);
    expect(sectionIds(r.container)).toEqual(['routing', 'history']);
    r.unmount();
  });

  it('the lane section renders only with a reading', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    for (const usage of [null, [{ ...USAGE, wrapper: 'lane-b' }], []] as (AccountUsage[] | null)[]) {
      act(() => useFleetStore.setState({ usage }));
      const r = render(<LaneSection />);
      expect(r.container.querySelector("[data-section='lane']"), JSON.stringify(usage)).toBeNull();
      expect(r.container.textContent).not.toMatch(/not read yet|No usage/i);
      r.unmount();
    }
    // A session whose row is not read yet has no lane to name.
    act(() => useFleetStore.setState({ sessions: [], usage: [USAGE] }));
    const r = render(<LaneSection />);
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });

  it('the routing section is one line that says what runs', () => {
    stubWidth(1920);
    goTo(`/s/${ID}`);
    const routed = (live: string, fields: NonNullable<FleetSession['route']>['fields']): FleetSession => ({
      ...ROW, model: live, route: { fields, degraded: null, inert: [], unreadable: [] },
    });
    const line = (): HTMLElement => {
      const { container } = render(<RoutingSection />);
      const el = container.querySelector<HTMLElement>('.insp-routing-row');
      expect(el).not.toBeNull();
      return el!;
    };

    let el = line();
    expect(el.textContent).toBe('Runs model-x on Lane A · effort high');
    expect(el.querySelector("[data-command='session-model']")).not.toBeNull();
    expect(el.querySelector("[data-command='session-effort']")).not.toBeNull();
    cleanup();

    // A class asked for, and the roster entry carries no provider: not measurable, so nothing is asked or queued.
    act(() => useFleetStore.setState({ sessions: [routed('Sonnet 5', { class: 'opus' })] }));
    el = line();
    expect(el.textContent).not.toMatch(/asked|queued/);
    cleanup();

    // The same ask on a lane known to be Anthropic's: asked, in the header's pending style.
    act(() => useFleetStore.setState({
      roster: [{ id: 'lane-a', label: 'Lane A', hue: 'acct-1', homeAble: true, provider: 'anthropic' } as never],
    }));
    el = line();
    expect(el.textContent).toMatch(/ · asked Opus 5\.5$/);
    expect(el.querySelector('.route-queued')?.textContent).toBe(' · asked Opus 5.5');
  });
});

function Rail(): ReactNode {
  const R = REFINED_SET.Inspector;
  if (R === null) throw new Error("Refined's set places no Inspector");
  return <R />;
}

describe("Refined's inspector rail", () => {
  it("Refined's rail renders at 1600 and not at 1599, only on a session route", () => {
    goTo(`/s/${ID}`);
    stubWidth(1600);
    let r = render(<Rail />);
    expect(r.container.querySelector('.ref-inspector')).not.toBeNull();
    expect(r.container.querySelectorAll('[data-section]').length).toBe(6);
    r.unmount();

    stubWidth(1599);
    r = render(<Rail />);
    expect(r.container.innerHTML).toBe('');
    r.unmount();

    stubWidth(1920);
    goTo('/');
    r = render(<Rail />);
    expect(r.container.innerHTML).toBe('');
    r.unmount();

    // The stylesheet gives the rail its 320 track at the same width, and an empty aside no cell.
    const css = readFileSync(path.join(SRC, 'skins/refined/refined.css'), 'utf8');
    expect(css).toMatch(/@media \(min-width: 1600px\)\s*\{[^@]*minmax\(0, 1fr\) 320px/);
    expect(css).toMatch(/\.ref-frame > \.shell-inspector:empty\s*\{\s*display: none;/);
  });

  it('at ≥1600 the task and mail strips are not in the column; below it they are (one instance per width)', () => {
    const store = createSessionStore(ID, {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
    });
    const strips = (width: number, set = REFINED_SET): { task: boolean; mail: boolean } => {
      stubWidth(width);
      // The screen's unmount disconnects, and a teardown clears the mail: every render starts from a fresh frame.
      act(() => {
        store.getState().apply({ type: 'tasks', tasks: PLAN });
        store.getState().apply({ type: 'mail', mail: MAIL });
      });
      const r = render(
        <SkinSetProvider set={set}>
          <SessionScreen id={ID} store={store} />
        </SkinSetProvider>,
      );
      const column = r.container.querySelector('.chat-strips')!;
      const out = { task: column.querySelector('.task-strip') !== null, mail: column.querySelector('.mail-strip') !== null };
      r.unmount();
      return out;
    };
    expect(strips(1600)).toEqual({ task: false, mail: false });
    expect(strips(1920)).toEqual({ task: false, mail: false });
    expect(strips(1599)).toEqual({ task: true, mail: true });
    expect(strips(390)).toEqual({ task: true, mail: true });
    // A skin that places no inspector yet (Instrument until S12) keeps its strips at every width.
    expect(INSTRUMENT_SET.Inspector).toBeNull();
    expect(strips(1920, INSTRUMENT_SET)).toEqual({ task: true, mail: true });
  });

  it("the rail's sections are the shared components", () => {
    const src = readFileSync(path.join(SRC, 'skins/refined/InspectorRail.tsx'), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    for (const name of ['TasksSection', 'MailSection', 'PrSection', 'RoutingSection', 'LaneSection', 'HistorySection']) {
      expect(code, name).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\.\\./\\.\\./inspector/`));
      expect(code, name).toContain(`<${name} />`);
    }
    // It defines one component, the rail, and reads no store itself: no arrow component, no aliased import.
    expect([...code.matchAll(/\bfunction\s+(\w+)/g)].map((m) => m[1])).toEqual(['InspectorRail']);
    expect(code).not.toMatch(/\bconst\s+[A-Z]\w*\s*=/);
    expect(code).not.toMatch(/import \{[^}]*\bas\b[^}]*\}/);
    expect(code).not.toMatch(/getSessionStore|useSyncExternalStore|useFleetStore|<section|<ol\b|<Meter|MailStrip|PrKeycap/);
  });

  it("the rail's sections render the same markup as the shared ones, in the spec's order", () => {
    stubWidth(1600);
    goTo(`/s/${ID}`);
    const rail = render(<Rail />);
    // React's generated ids differ between two renders; everything else must match.
    const markup = (e: Element): string => e.outerHTML.replace(/_r_\w+_/g, 'ID');
    const railSections = [...rail.container.querySelectorAll('[data-section]')].map(markup);
    rail.unmount();
    const shared = render(<InspectorSections />);
    const sharedSections = [...shared.container.querySelectorAll('[data-section]')].map(markup);
    shared.unmount();
    expect(railSections).toHaveLength(6);
    expect(railSections).toEqual(sharedSections);
  });
});
