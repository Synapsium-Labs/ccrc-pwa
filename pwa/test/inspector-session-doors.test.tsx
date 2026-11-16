// Console speed C1, review 1464 F4: the inspector is eager and the session screen is a lazy chunk, so for the first
// moments of a session open the inspector's four session doors (PR, model, effort, history) are drawn before anyone can
// run their commands. Until the screen publishes its command target each door is `aria-disabled`, says it is not ready
// yet, and its tap does nothing; once it is published the doors act.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { DOOR_EVENT } from '../src/command/door';
import { InspectorSections } from '../src/inspector/InspectorSections';
import { SESSION_NOT_YET } from '../src/inspector/sessionDoor';
import { navigate } from '../src/lib/router';
import { SessionScreen } from '../src/screens/SessionScreen';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { useFleetStore } from '../src/stores/fleet';
import { getSessionStore } from '../src/stores/session';
import { fleetSession } from './fleetFixture';

const ID = 'lane-a-project-a-quiet-basin';
const ROW: FleetSession = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin', model: 'model-x',
  effort: 'high',
  pr: { phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
    checkedAt: Date.now(), mergedAt: null, retryAt: null },
});
const DOORS = ['session-pr', 'session-model', 'session-effort', 'open-history'] as const;

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

let ran: string[];
const onDoor = (e: Event): void => { ran.push((e as CustomEvent<string>).detail); };

beforeEach(() => {
  ran = [];
  window.addEventListener(DOOR_EVENT, onDoor);
  stubWidth(1920);
  useFleetStore.setState({
    sessions: [ROW], usage: [],
    roster: [{ id: 'lane-a', label: 'Lane A', hue: 'acct-1', homeAble: true } as never],
  });
  act(() => navigate(`/s/${ID}`));
});
afterEach(() => {
  window.removeEventListener(DOOR_EVENT, onDoor);
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the inspector’s session doors while the session screen loads', () => {
  it('before the screen publishes its target a tap does nothing and the doors say so; after, they act', () => {
    const { container } = render(<InspectorSections />);
    const door = (id: string): HTMLElement => {
      const el = container.querySelector<HTMLElement>(`[data-command='${id}']`);
      expect(el, id).not.toBeNull();
      return el!;
    };
    for (const id of DOORS) {
      expect(door(id).getAttribute('aria-disabled'), id).toBe('true');
      expect(door(id).getAttribute('title'), id).toBe(SESSION_NOT_YET);
      fireEvent.click(door(id));
    }
    expect(ran, 'no command runs before the screen can answer it').toEqual([]);

    // The session screen mounts beside the inspector, as the lazy chunk's arrival does, and publishes its target.
    const store = getSessionStore(ID);
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
    });
    render(<SkinSetProvider set={REFINED_SET}><SessionScreen id={ID} store={store} /></SkinSetProvider>);
    for (const id of DOORS) {
      expect(door(id).hasAttribute('aria-disabled'), id).toBe(false);
      expect(door(id).getAttribute('title'), id).not.toBe(SESSION_NOT_YET);
      fireEvent.click(door(id));
    }
    expect(ran).toEqual([...DOORS]);
  });
});
