// The right-side inspector hides and shows, remembered per device (desktop polish T3e, D-6385).
//
// RED FIRST, and what each case catches:
//   an unknown stored value read as hidden, or the read without try/catch ... "the stored choice: only 'hidden' hides…"
//   the choice written before it is applied in memory ......................... "a choice storage refuses still applies…"
//   the rail gated on INSPECTOR_QUERY alone, or the strips rule ignoring it .... "hidden at 1600 and 1920: …"
//   the door always mounted and hidden by CSS, or its own onClick ............. "the toggle is mounted in Refined's…"
//   `aria-expanded` dropped or inverted, `aria-controls` off the aside ......... "the toggle says its state…"
//   the target published only while shown, or `run` without its null guard .... "toggle-inspector is offered only…"
//   the focus repair removed (focus falls to the body) ......................... "hiding with focus inside the rail…"
//   a toggle or command placed by a skin with no Inspector part ............... "Instrument places no inspector…"
// The cases render the whole `App` in Refined (and Instrument for the last), as `skin-switch.test.tsx` does, so the
// rail, the session header, the strips and the command layer are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, MailSummary, TaskItem } from '../../shared/api';
import { fleetSession } from './fleetFixture';

const made = vi.hoisted(() => ({ virtuoso: null as Record<string, unknown> | null }));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: Record<string, unknown>) => {
      made.virtuoso = props;
      React.useImperativeHandle(props.ref as React.Ref<unknown>, () => ({ scrollToIndex: () => {} }));
      const count = props.totalCount as number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      const keyOf = props.computeItemKey as (i: number) => string | number;
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: count }, (_, i) => React.createElement('div', { key: keyOf(i), 'data-index': i }, content(i))),
      );
    },
  };
});

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { getSessionStore } = await import('../src/stores/session');
const { INSPECTOR_ID } = await import('../src/skins/frame');
const { DOOR_EVENT } = await import('../src/command/door');
const { INSPECTOR_STORAGE_KEY, resetInspectorChoiceForTests, setInspectorHidden, storedInspectorHidden } = await import(
  '../src/inspector/inspectorShown'
);

/** A viewport `width` px wide on a fine pointer: every `(min-width: Npx)` answers from it. */
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

/** A WebSocket that never connects. */
class QuietSocket extends EventTarget {
  readyState = 0;
  binaryType = 'blob';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 3; }
}

const ID = 'lane-a-project-a-quiet-basin';
const ROW: FleetSession = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin', model: 'model-x', effort: 'high',
});
const PLAN: TaskItem[] = [
  { id: '1', subject: 'build the rail', description: 'why', activeForm: 'building the rail', status: 'in_progress' },
];
const MAIL: MailSummary[] = [{
  id: 1, deliveryId: 1, at: Date.now() - 30_000, fromId: 'coordinator', toId: ID, runId: 3, kind: 'question',
  subject: 'rebase before you start?', artifacts: [], state: 'delivered', attempts: 0, lastError: null,
  lastGate: null, gateCount: 0, gateSince: null, gateAt: null,
} as MailSummary];

const TOGGLE = "[data-command='toggle-inspector']";
const aside = (): HTMLElement | null => document.getElementById(INSPECTOR_ID);
const toggle = (): HTMLElement | null => document.querySelector<HTMLElement>(TOGGLE);
const railShown = (): boolean => document.querySelector('.ref-inspector') !== null;
const strips = (): { task: boolean; mail: boolean } => ({
  task: document.querySelector('.chat-strips .task-strip') !== null,
  mail: document.querySelector('.chat-strips .mail-strip') !== null,
});

/** The whole app on a session route, its plan and mail seeded after the screen has mounted (a mount starts a fresh
 *  frame, and a teardown clears the mail). */
function open(width: number, path = `/s/${ID}`): void {
  stubWidth(width);
  act(() => useFleetStore.setState({ conn: 'open', sessions: [ROW] }));
  navigate(path);
  render(<App />);
  act(() => {
    getSessionStore(ID).setState({ uuid: 'u1', status: 'idle', events: [] });
    getSessionStore(ID).getState().apply({ type: 'tasks', tasks: PLAN });
    getSessionStore(ID).getState().apply({ type: 'mail', mail: MAIL });
  });
}

const press = (key: string, target: Element = document.body): boolean => fireEvent.keyDown(target, { key });

beforeEach(() => {
  localStorage.clear();
  resetInspectorChoiceForTests();
  initSkin();
  act(() => { setSkin(REFINED); });
  vi.stubGlobal('WebSocket', QuietSocket);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  localStorage.clear();
  resetInspectorChoiceForTests();
  document.documentElement.removeAttribute('data-skin');
});

describe('the choice, per device', () => {
  it("the stored choice: only 'hidden' hides; absent, unknown and unreadable storage read shown", () => {
    expect(INSPECTOR_STORAGE_KEY).toBe('ccrc-inspector');
    expect(storedInspectorHidden(), 'absent').toBe(false);
    localStorage.setItem(INSPECTOR_STORAGE_KEY, 'hidden');
    expect(storedInspectorHidden(), 'hidden').toBe(true);
    for (const value of ['shown', 'Hidden', 'HIDDEN', ' hidden', 'true', '1', '', 'none', '{"hidden":true}']) {
      localStorage.setItem(INSPECTOR_STORAGE_KEY, value);
      expect(storedInspectorHidden(), JSON.stringify(value)).toBe(false);
    }
    // Storage that throws on read (a private window, blocked site data): shown, and no exception to a first render.
    localStorage.setItem(INSPECTOR_STORAGE_KEY, 'hidden');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(storedInspectorHidden(), 'unreadable').toBe(false);
    // And a page that boots with the stored word draws no rail: the hook reads the same function.
    vi.restoreAllMocks();
    resetInspectorChoiceForTests();
    open(1920);
    expect(railShown(), 'stored hidden, then shown').toBe(false);
    cleanup();
    localStorage.setItem(INSPECTOR_STORAGE_KEY, 'something else');
    resetInspectorChoiceForTests();
    open(1920);
    expect(railShown(), 'an unknown value').toBe(true);
  });

  it('a choice storage refuses still applies for this page', () => {
    open(1920);
    expect(railShown()).toBe(true);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    act(() => { fireEvent.click(toggle()!); });
    expect(set).toHaveBeenCalledWith(INSPECTOR_STORAGE_KEY, 'hidden');
    expect(railShown(), 'hidden although the write threw').toBe(false);
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    act(() => { fireEvent.click(toggle()!); });
    expect(railShown(), 'and shown again').toBe(true);
  });

  it('a choice that storage keeps survives a reload', () => {
    open(1920);
    act(() => { fireEvent.click(toggle()!); });
    expect(localStorage.getItem(INSPECTOR_STORAGE_KEY)).toBe('hidden');
    // A reload keeps storage and loses this page's memory.
    cleanup();
    resetInspectorChoiceForTests();
    open(1920);
    expect(railShown()).toBe(false);
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    act(() => { fireEvent.click(toggle()!); });
    expect(localStorage.getItem(INSPECTOR_STORAGE_KEY)).not.toBe('hidden');
  });
});

describe('hidden', () => {
  it('hidden at 1600 and 1920: the rail renders nothing and the column renders the task and mail strips', () => {
    for (const width of [1600, 1920]) {
      open(width);
      expect(railShown(), `${width} shown`).toBe(true);
      expect(strips(), `${width} shown`).toEqual({ task: false, mail: false });
      act(() => setInspectorHidden(true));
      expect(railShown(), `${width} hidden`).toBe(false);
      expect(aside()?.innerHTML, `${width} hidden: the aside is empty`).toBe('');
      expect(strips(), `${width} hidden`).toEqual({ task: true, mail: true });
      // Each is mounted once at any width: the rail's copies are gone with the rail.
      expect(document.querySelectorAll('.task-strip'), `${width} task strips`).toHaveLength(1);
      expect(document.querySelectorAll('.mail-strip'), `${width} mail strips`).toHaveLength(1);
      expect(screen.queryByText('rebase before you start?')).not.toBeNull();
      act(() => setInspectorHidden(false));
      expect(railShown(), `${width} shown again`).toBe(true);
      expect(strips(), `${width} shown again`).toEqual({ task: false, mail: false });
      cleanup();
    }
  });

  it("the frame's attribute follows the choice: placed while shown, none while hidden", () => {
    open(1920);
    expect(document.querySelector('.app-shell')!.getAttribute('data-inspector')).toBe('placed');
    act(() => setInspectorHidden(true));
    expect(document.querySelector('.app-shell')!.getAttribute('data-inspector')).toBe('none');
  });
});

describe('the toggle', () => {
  it("the toggle is mounted in Refined's session header at 1600 and 1920, shown and hidden, not at 1599, 390 or off a session route, and is a door to toggle-inspector", () => {
    for (const width of [1600, 1920]) {
      for (const hidden of [false, true]) {
        resetInspectorChoiceForTests();
        act(() => setInspectorHidden(hidden));
        open(width);
        const doors = document.querySelectorAll(TOGGLE);
        expect(doors.length, `${width} hidden=${hidden}`).toBe(1);
        const door = doors[0] as HTMLElement;
        expect(door.closest('.ref-session-head'), 'in the session header').not.toBeNull();
        // Rightmost: after every other door and chip of the header's title row.
        for (const other of document.querySelectorAll('.ref-session-head .keycap')) {
          if (other === door) continue;
          expect(door.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING, `${width}: after ${other.className}`).toBeTruthy();
        }
        cleanup();
      }
    }
    resetInspectorChoiceForTests();
    for (const [width, path] of [[1599, `/s/${ID}`], [1280, `/s/${ID}`], [390, `/s/${ID}`], [1920, '/runs'], [1920, '/']] as const) {
      open(width, path);
      expect(document.querySelectorAll(TOGGLE).length, `${width} ${path}`).toBe(0);
      cleanup();
    }
    // A door, not a control with a handler of its own: a tap asks the one layer, and the result is the rail's flip.
    localStorage.clear();
    resetInspectorChoiceForTests();
    open(1920);
    expect(toggle()!.tagName).toBe('BUTTON');
    // One tap, one door event naming the command: the layer is the one that runs it.
    const heard: unknown[] = [];
    const listen = (e: Event): void => { heard.push((e as CustomEvent<string>).detail); };
    window.addEventListener(DOOR_EVENT, listen);
    try {
      act(() => { fireEvent.click(toggle()!); });
    } finally {
      window.removeEventListener(DOOR_EVENT, listen);
    }
    expect(heard, 'exactly one door event, naming the command').toEqual(['toggle-inspector']);
    expect(railShown()).toBe(false);
    act(() => { fireEvent.click(toggle()!); });
    expect(railShown()).toBe(true);
  });

  it("the toggle's door is built with commandDoor and carries no handler of its own", async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src/inspector/InspectorToggle.tsx'), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).toContain("commandDoor('toggle-inspector')");
    expect(code).not.toMatch(/onClick\s*=/);
    expect(code).not.toMatch(/setInspectorHidden|localStorage/);
  });

  it("the toggle says its state: aria-expanded follows the rail, aria-controls names the aside, its name is 'Inspector' either way", () => {
    open(1920);
    for (const hidden of [false, true, false]) {
      act(() => setInspectorHidden(hidden));
      const door = screen.getByRole('button', { name: 'Inspector' });
      expect(door.getAttribute('aria-expanded'), `hidden=${hidden}`).toBe(hidden ? 'false' : 'true');
      expect(door.getAttribute('aria-controls')).toBe(INSPECTOR_ID);
      expect(aside()!.tagName).toBe('ASIDE');
      expect(aside()!.getAttribute('aria-label')).toBe('Inspector');
      expect(door.getAttribute('aria-keyshortcuts')).toBe('i');
      expect(door.getAttribute('title'), 'what a tap does').toBe(hidden ? 'Show the inspector' : 'Hide the inspector');
      expect(door.getAttribute('aria-label')).toBe('Inspector');
    }
  });
});

describe('the command and its key', () => {
  const offered = (): boolean => {
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'inspector' } });
    const found = screen.queryByRole('option', { name: /Show or hide the inspector/ }) !== null;
    fireEvent.keyDown(box, { key: 'Escape' });
    return found;
  };
  const choice = (): string | null => localStorage.getItem(INSPECTOR_STORAGE_KEY);

  it('toggle-inspector is offered only while a part places an inspector; i on the page body flips it, i in the composer stays text, i where nothing is placed does nothing', () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent): void => { errors.push(e.error ?? e.message); };
    window.addEventListener('error', onError);
    try {
      // Placed: offered, hidden or shown.
      open(1920);
      expect(offered(), 'offered while shown').toBe(true);
      expect(press('i'), 'the key was taken').toBe(false);
      expect(railShown(), 'i hides it').toBe(false);
      expect(choice()).toBe('hidden');
      expect(offered(), 'offered while hidden').toBe(true);
      press('i');
      expect(railShown(), 'i shows it again').toBe(true);
      // The composer keeps its text: the key is typed, not taken.
      const box = screen.getByRole('textbox', { name: 'Message' });
      expect(press('i', box), 'the composer keeps the key').toBe(true);
      expect(railShown()).toBe(true);
      cleanup();

      // Nowhere placed: below 1600, off a session route. Not offered, and the key does nothing (and throws nothing:
      // a single key skips `when`, so `run` must be null-safe).
      for (const [width, path] of [[1599, `/s/${ID}`], [390, `/s/${ID}`], [1920, '/runs'], [1920, '/']] as const) {
        resetInspectorChoiceForTests();
        localStorage.clear();
        open(width, path);
        expect(offered(), `${width} ${path}: not offered`).toBe(false);
        press('i');
        expect(choice(), `${width} ${path}: nothing written`).toBeNull();
        cleanup();
      }
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('a toggle made while the choice is read on another route is the same choice: hide at 1920, leave and return', () => {
    open(1920);
    press('i');
    act(() => navigate('/runs'));
    expect(toggle(), 'off a session route').toBeNull();
    act(() => navigate(`/s/${ID}`));
    expect(railShown()).toBe(false);
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('focus', () => {
  it('hiding with focus inside the rail puts focus on the toggle', () => {
    open(1920);
    const inside = document.querySelector<HTMLElement>('.ref-inspector button, .ref-inspector a, .ref-inspector [tabindex]');
    expect(inside, 'the rail holds a focusable control').not.toBeNull();
    act(() => inside!.focus());
    expect(aside()!.contains(document.activeElement)).toBe(true);
    press('i', inside!);
    expect(railShown()).toBe(false);
    expect(document.activeElement, 'on the toggle, never the body').toBe(toggle());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('hiding with focus elsewhere moves focus nowhere', () => {
    open(1920);
    const box = screen.getByRole('textbox', { name: 'Message' });
    act(() => box.focus());
    act(() => setInspectorHidden(true));
    expect(document.activeElement).toBe(box);
  });
});

describe('Instrument', () => {
  it('Instrument places no inspector: no toggle and no command', () => {
    act(() => { setSkin(INSTRUMENT); });
    open(1920);
    expect(document.querySelectorAll('aside.shell-inspector')).toHaveLength(0);
    expect(document.querySelectorAll(TOGGLE)).toHaveLength(0);
    const header = within(document.querySelector('.chat-head') as HTMLElement);
    expect(header.queryByRole('button', { name: 'Inspector' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inspector' } });
    expect(screen.queryByRole('option', { name: /inspector/i })).toBeNull();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    press('i');
    expect(localStorage.getItem(INSPECTOR_STORAGE_KEY)).toBeNull();
  });
});
