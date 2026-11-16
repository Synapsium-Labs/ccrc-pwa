// The digest's "Out of step" section (D-5923, the drift section; plan Task DT4, D-5924; spec 2026-10-20 §4.5, §4.6): the
// drift reconciler's findings open at the window's end, under the decisions and never counted as one. Each line is a
// glance (the kind in words, its subject, its age), and a tap opens its target through the Inbox target model
// (`inboxTarget`, P4a), never a copy of that rule. No section when the answer carries no drift, an empty one, or one this
// build cannot read; the decisions render either way.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DRIFT_KINDS, type DigestAnswer, type DigestLine, type DriftKind, type DriftLine } from '../../shared/api';
import { DigestScreen, asDigestAnswer, digestTotalsText } from '../src/screens/DigestScreen';
import { DRIFT_FALLBACK_WORD, DRIFT_KIND_WORD, driftKindWord, driftSubjectText, driftTotalsText } from '../src/fleet/driftWords';
import * as target from '../src/fleet/inboxTarget';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const H = 3_600_000;
const SESSION = 'project-a-quiet-basin';
const zeroTotals = (): Record<DriftKind, number> =>
  Object.fromEntries(DRIFT_KINDS.map((k) => [k, 0])) as Record<DriftKind, number>;
const drift = (o: Partial<DriftLine> & Pick<DriftLine, 'kind' | 'key'>): DriftLine => ({
  subject: '{}', detail: 'in words', ageMs: 30 * H, sessionId: null, runId: null, ...o,
});
const LINES: DriftLine[] = [
  drift({ key: 'run-quiet:12', kind: 'run-quiet', subject: JSON.stringify({ runId: 12, program: 'prog-a' }), runId: 12, ageMs: 30 * H }),
  drift({ key: 'mail-parked:4', kind: 'mail-parked', subject: JSON.stringify({ deliveryId: 4, sessionId: SESSION }),
    sessionId: SESSION, ageMs: 3 * 24 * H }),
  drift({ key: 'review-waiting:9', kind: 'review-waiting', subject: JSON.stringify({ runId: 9, program: 'prog-b' }), runId: 9, ageMs: 5 * H }),
];
const DRIFT = { totals: { ...zeroTotals(), 'run-quiet': 1, 'mail-parked': 1, 'review-waiting': 1 }, lines: LINES };

const DECISION: DigestLine = {
  rowKind: 'ask', id: 1, kind: 'answer', at: Date.parse('2026-10-17T08:00:00Z'), coordinator: 'project-a-calm-mesa',
  childId: SESSION, text: 'Which colour?', tool: null, class: null, answer: 'Red', reason: null, corrected: false,
};
const BASE: DigestAnswer = {
  v: 1, day: '2026-10-18', hourUtc: 7, fromMs: Date.parse('2026-10-17T07:00:00Z'), toMs: Date.parse('2026-10-18T07:00:00Z'),
  totals: { decisions: 1, answers: 1, allows: 0, denies: 0, handOvers: 0, lapses: 0, calls: 0, guardForbidden: 0 },
  byCoordinator: [{ coordinator: 'project-a-calm-mesa', decisions: 1 }],
  lines: [DECISION], sentAt: null, pushed: false,
};
const WITH_DRIFT: DigestAnswer = { ...BASE, drift: DRIFT };

/** A fleet store holding `SESSION` and the open run 12 (run 9 is not on the board). */
const makeStore = (): FleetStore => {
  const store = createFleetStore({
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });
  store.setState({ sessions: [fleetSession({ id: SESSION, project: 'project-a' })], runs: [{ id: 12 } as never], runsFrameSeen: true });
  return store;
};

async function open(answer: unknown, store: FleetStore = makeStore()): Promise<void> {
  render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(answer)} store={store} />);
  await screen.findByText('Which colour?');
}
const section = (): HTMLElement | null => document.querySelector<HTMLElement>('.digest-drift');

describe('the digest\'s Out of step section (D-5923)', () => {
  it('an answer without drift renders no section, and the decisions still render', async () => {
    await open(BASE);
    expect(section()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Out of step' })).toBeNull();
    expect(document.querySelectorAll('.digest-row')).toHaveLength(1);
  });

  it('an empty drift renders no section', async () => {
    await open({ ...BASE, drift: { totals: zeroTotals(), lines: [] } });
    expect(section()).toBeNull();
  });

  it('a malformed drift renders no section and the decisions still render', async () => {
    for (const bad of [
      'nope', null, { totals: DRIFT.totals }, { lines: LINES }, { totals: DRIFT.totals, lines: 'x' },
      { totals: DRIFT.totals, lines: [{ ...LINES[0], ageMs: Number.NaN }] },
      { totals: DRIFT.totals, lines: [{ ...LINES[0], runId: '12' }] },
      { totals: DRIFT.totals, lines: [{ ...LINES[0], key: 7 }] },
      { totals: { 'run-quiet': -1 }, lines: LINES },
    ]) {
      await open({ ...BASE, drift: bad });
      expect(section(), JSON.stringify(bad)).toBeNull();
      expect(document.querySelectorAll('.digest-row')).toHaveLength(1);
      cleanup();
    }
    expect(asDigestAnswer({ ...BASE, drift: { totals: DRIFT.totals, lines: 'x' } })?.drift).toBeUndefined();
  });

  it('present drift: a titled section under the decisions, the totals per kind, one line each with its age', async () => {
    await open(WITH_DRIFT);
    const s = section()!;
    expect(s).not.toBeNull();
    expect(within(s).getByRole('heading', { name: 'Out of step' })).toBeInTheDocument();
    // Under the decisions: the section follows the decision list in the document.
    const list = document.querySelector('.digest-list')!;
    expect(list.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(s).getByText('1 run quiet · 1 mail parked · 1 review waiting')).toBeInTheDocument();
    const lines = [...s.querySelectorAll('.digest-drift-line')];
    expect(lines.map((l) => l.querySelector('.digest-drift-kind')?.textContent)).toEqual(['run quiet', 'mail parked', 'review waiting']);
    expect(lines.map((l) => l.querySelector('.digest-drift-subject')?.textContent)).toEqual(
      ['run 12 · prog-a', `delivery 4 · ${SESSION}`, 'run 9 · prog-b']);
    expect(lines.map((l) => l.querySelector('.digest-drift-age')?.textContent)).toEqual(['for 1 day', 'for 3 days', 'for 5 h']);
  });

  it('drift is kept out of the decision counts', async () => {
    const empty = { ...WITH_DRIFT, lines: [], byCoordinator: [], totals: { ...BASE.totals, decisions: 0, answers: 0 } };
    render(<DigestScreen day="2026-10-18" load={vi.fn().mockResolvedValue(empty)} store={makeStore()} />);
    expect(await screen.findByText('Coordinators decided nothing in your name in this window.')).toBeInTheDocument();
    expect(screen.getByText('0 decisions')).toBeInTheDocument();
    expect(section()).not.toBeNull();
    expect(digestTotalsText(WITH_DRIFT)).toBe(digestTotalsText(BASE));
    expect(document.querySelectorAll('.digest-row')).toHaveLength(0);
  });

  it('each kind reads in words, never its token, and an unknown kind reads the fallback word', async () => {
    for (const k of DRIFT_KINDS) {
      expect(DRIFT_KIND_WORD[k]).not.toBe(k);
      expect(driftKindWord(k)).toBe(DRIFT_KIND_WORD[k]);
    }
    expect(driftKindWord('claimant-revived')).toBe(DRIFT_FALLBACK_WORD);
    expect(DRIFT_FALLBACK_WORD).toBe('out of step');
    await open({ ...BASE, drift: { totals: { ...zeroTotals(), 'some-new-kind': 1 }, lines: [drift({ key: 'x:1', kind: 'some-new-kind' as DriftKind })] } });
    const s = section()!;
    expect(s.querySelector('.digest-drift-kind')?.textContent).toBe('out of step');
    expect(s.textContent).not.toContain('some-new-kind');
    expect(within(s).getByText('1 out of step')).toBeInTheDocument();
  });

  it('a run kind on the board opens /runs/<id> and a session kind /s/<id>, both through inboxTarget', async () => {
    const spy = vi.spyOn(target, 'inboxTarget');
    await open(WITH_DRIFT);
    const s = section()!;
    act(() => { fireEvent.click(within(s).getByRole('button', { name: /^run quiet/ })); });
    expect(window.location.pathname).toBe('/runs/12');
    act(() => { fireEvent.click(within(s).getByRole('button', { name: /^mail parked/ })); });
    expect(window.location.pathname).toBe(`/s/${SESSION}`);
    // The line, adapted to the model's input: its own session and run, nothing computed beside it.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION, runId: null }), expect.any(Map), expect.any(Map));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: '', runId: 12 }), expect.any(Map), expect.any(Map));
  });

  it('a line with no target is no control, and says why in a quiet word', async () => {
    await open(WITH_DRIFT);
    const s = section()!;
    const waiting = [...s.querySelectorAll('.digest-drift-line')][2]!;
    expect(waiting.querySelector('button')).toBeNull();
    expect(waiting.querySelector('.digest-drift-why')?.textContent).toBe('no target');
    expect(within(s).getAllByRole('button')).toHaveLength(2);
  });

  it('a row is one glance: kind, subject and age, never the detail sentence or the raw subject', async () => {
    await open(WITH_DRIFT);
    const first = section()!.querySelector('.digest-drift-line')!;
    expect(first.textContent).not.toContain('in words');
    expect(first.textContent).not.toContain('{');
    expect(first.querySelectorAll('.digest-drift-kind, .digest-drift-subject, .digest-drift-age')).toHaveLength(3);
  });

  for (const width of [390, 1280, 1920]) {
    it(`renders the section, every line and its controls at ${width} px`, async () => {
      window.innerWidth = width;
      window.dispatchEvent(new Event('resize'));
      await open(WITH_DRIFT);
      expect(section()!.querySelectorAll('.digest-drift-line')).toHaveLength(3);
      expect(within(section()!).getAllByRole('button')).toHaveLength(2);
    });
  }

  it('the stylesheet lets a line shrink to a phone and break a long subject', () => {
    const css = readFileSync(path.join(__dirname, '..', 'src', 'screens', 'digest.css'), 'utf8');
    const rule = (sel: string): string => {
      const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
      if (!m) throw new Error(`no rule for ${sel}`);
      return m[1]!;
    };
    expect(rule('.digest-drift-glance')).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    for (const sel of ['.digest-drift-line .digest-drift-subject', '.digest-drift .digest-drift-totals']) {
      expect(rule(sel), sel).toContain('overflow-wrap: anywhere');
    }
  });
});

describe('the drift words', () => {
  it('a subject reads as its ids in words, and one this build cannot parse reads as sent', () => {
    expect(driftSubjectText(JSON.stringify({ program: 'prog-a', claimant: 'c-1', runId: 3 }))).toBe('prog-a · c-1 · run 3');
    expect(driftSubjectText(JSON.stringify({ askId: 2, sessionId: SESSION }))).toBe(`ask 2 · ${SESSION}`);
    expect(driftSubjectText(JSON.stringify({ approvalId: 5, sessionId: SESSION }))).toBe(`approval 5 · ${SESSION}`);
    expect(driftSubjectText('not json')).toBe('not json');
  });
  it('the totals leave out zeros, in the kind order', () => {
    expect(driftTotalsText({ ...zeroTotals(), 'mail-held': 2, 'run-quiet': 1 })).toBe('1 run quiet · 2 mail held');
    expect(driftTotalsText(zeroTotals())).toBe('');
  });
});
