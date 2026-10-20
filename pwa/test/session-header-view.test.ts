// W2 Task S7a (D-5471): the session header's view, extracted. `sessionHeaderView` is the one derivation of what the
// header shows; `SessionHeader` renders from it, and both skins' session chrome will (S7c, S12). These cases hold the
// view and the header to each other: the view lists every chip the header draws, in its order, and the header draws
// nothing the view does not list (a chip dropped from the view vanishes from the header, so a header that derives a
// chip itself again is red here).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { UNCHECKED_PR, type FleetSession, type SessionStatus } from '../../shared/api';
import type { Coordination } from '../src/fleet/fleetTree';
import { sessionFacts } from '../src/fleet/sessionFacts';
import { sessionMenu } from '../src/session/SessionFlows';
import { sessionHeaderView, type HeaderChipKind, type SessionHeaderViewInput } from '../src/session/sessionHeaderView';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';

// The header renders whatever the view returns; `drop` removes chip kinds from it, so a case can ask whether the
// header follows the view or derives the chip itself.
const drop = vi.hoisted(() => ({ kinds: new Set<string>() }));
vi.mock('../src/session/sessionHeaderView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/session/sessionHeaderView')>();
  return {
    ...real,
    sessionHeaderView: (input: SessionHeaderViewInput) => {
      const v = real.sessionHeaderView(input);
      return { ...v, chips: v.chips.filter((c) => !drop.kinds.has(c.kind)) };
    },
  };
});

afterEach(() => {
  cleanup();
  drop.kinds.clear();
  vi.unstubAllGlobals();
});

const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

const NOW = Date.now();

/** A workspace session that carries every chip the header can draw at once. */
const allChips = (): FleetSession => fleetSession({
  id: 'claude:demo-quiet-basin', project: 'demo', workspace: 'quiet-basin', name: 'tidy-up',
  model: 'model-x', effort: 'high', branch: 'feat/tidy',
  archivedAt: NOW - 60_000, pr: { ...UNCHECKED_PR, number: 7 },
  lastEnd: { at: NOW - 3 * 60_000, cause: 'oom' },
});

const COORDINATION: Coordination = {
  workingOn: 'other-project', coordinator: null, coordinatorId: null, coordinatorState: null, card: 'other-project',
  run: null,
};

const hostProps = (session: FleetSession, status: SessionStatus): HeaderHostProps => ({
  session, status, statusUpdatedAt: null, onInterrupt: vi.fn(), onBack: vi.fn(),
  onOpenTerminal: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(), onMoveAccount: vi.fn(),
  onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
  roster: TEST_ROSTER, repo: 'example/demo', coordination: COORDINATION,
  facts: sessionFacts({ session, now: NOW, roster: TEST_ROSTER }),
});

const viewOf = (p: HeaderHostProps, finePointer = false) => sessionHeaderView({ ...p, now: NOW, finePointer });

// Each chip kind, by the class the header already draws it with (no attribute added for the test).
const CHIP_SELECTORS: readonly (readonly [HeaderChipKind, string])[] = [
  ['coordination', '.chat-coord'],
  ['status', '.chat-meta .status-line'],
  ['lane', '.chip--active'],
  ['restart', '.chip--restart'],
  ['repo', '.chip--repo'],
  ['archived', '.chip--archived'],
  ['model', '.metachip--model'],
  ['effort', '[data-command="session-effort"]'],
  ['branch', '.metachip--branch'],
  ['details', '.chat-details-toggle, .chat-facts'],
  ['pr', '.keycap--pr'],
];

/** The chip kinds the rendered header shows, in document order. */
function renderedKinds(root: HTMLElement): HeaderChipKind[] {
  const all = root.querySelectorAll(CHIP_SELECTORS.map(([, sel]) => sel).join(', '));
  const out: HeaderChipKind[] = [];
  for (const el of Array.from(all)) {
    const kind = CHIP_SELECTORS.find(([, sel]) => el.matches(sel))?.[0];
    if (kind !== undefined && out[out.length - 1] !== kind) out.push(kind);
  }
  return out;
}

describe('sessionHeaderView (W2 Task S7a, D-5471)', () => {
  it('the view lists every chip the header renders, in the header\'s order', () => {
    stubPointer(false);
    const p = hostProps(allChips(), 'idle');
    const kinds = viewOf(p).chips.map((c) => c.kind);
    // Step 0's measure: the all-chips fixture carries every kind the header can draw beside the status word.
    expect(kinds).toEqual([
      'coordination', 'status', 'lane', 'restart', 'repo', 'archived', 'model', 'effort', 'branch', 'details', 'pr',
    ]);
    const { container } = render(createElement(SessionHeaderHost, p));
    expect(renderedKinds(container)).toEqual(kinds);
    cleanup();

    // The header draws nothing the view does not list: each chip dropped from the view is gone from the header.
    for (const k of kinds) {
      drop.kinds.clear();
      drop.kinds.add(k);
      const { container: c } = render(createElement(SessionHeaderHost, p));
      expect(renderedKinds(c), `dropping ${k}`).toEqual(kinds.filter((x) => x !== k));
      cleanup();
    }
  });

  it('the view\'s words are the header\'s words', () => {
    stubPointer(false);
    const p = hostProps(allChips(), 'idle');
    const v = viewOf(p);
    const { container } = render(createElement(SessionHeaderHost, p));
    expect(container.querySelector('.chat-title')?.textContent).toBe(`${v.title}›${v.crumb ?? ''}`);
    for (const c of v.chips) {
      const sel = CHIP_SELECTORS.find(([k]) => k === c.kind)?.[1] ?? '';
      const el = container.querySelector(sel);
      if (c.kind === 'status') expect(el?.textContent).toBe(c.word);
      if (c.kind === 'lane' || c.kind === 'restart' || c.kind === 'repo' || c.kind === 'archived') {
        expect(el?.textContent).toBe(c.text);
      }
      // The archived chip draws `archived` and ` · merged #N` as two text runs, as main did: one joined run shapes the
      // glyphs a subpixel differently and moves every chip after it (measured in Chrome at 1280 and 1920).
      if (c.kind === 'archived') {
        const runs = Array.from(el?.childNodes ?? []).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent);
        expect(runs).toEqual(c.parts);
      }
      if (c.kind === 'model' || c.kind === 'effort' || c.kind === 'branch') {
        expect(el?.querySelector('.metachip-text')?.textContent).toBe(c.text);
      }
    }
  });

  it('the view\'s menu items are the menu\'s, each with its command id', () => {
    stubPointer(false);
    for (const session of [allChips(), fleetSession({ id: 'claude:demo', project: 'demo' })]) {
      const p = hostProps(session, 'idle');
      const v = viewOf(p);
      expect(v.menu).toEqual(sessionMenu(session));
      render(createElement(SessionHeaderHost, p));
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      const rows = Array.from(document.querySelectorAll('.menu-item'));
      expect(rows.map((r) => r.getAttribute('data-command'))).toEqual(v.menu.map((m) => m.id));
      expect(rows.map((r) => r.querySelector('.menu-label')?.textContent)).toEqual(v.menu.map((m) => m.label));
      expect(rows.map((r) => !(r as HTMLButtonElement).disabled)).toEqual(v.menu.map((m) => m.enabled));
      cleanup();
    }
  });

  it('Stop\'s state follows busy', () => {
    const session = fleetSession({ id: 'claude:demo', project: 'demo', bucket: 'working', status: 'busy' });
    for (const [status, enabled] of [['busy', true], ['idle', false]] as const) {
      stubPointer(false);
      const p = hostProps(session, status);
      expect(viewOf(p).stop).toEqual({ shown: true, enabled });
      render(createElement(SessionHeaderHost, p));
      expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(!enabled);
      cleanup();
    }
    // Where a physical Escape key exists the cap is absent, busy or not.
    stubPointer(true);
    const p = hostProps(session, 'busy');
    expect(viewOf(p, true).stop).toEqual({ shown: false, enabled: true });
    render(createElement(SessionHeaderHost, p));
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});
