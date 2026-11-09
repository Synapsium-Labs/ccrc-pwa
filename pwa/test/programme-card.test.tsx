// The programme card, quiet programmes and Finished (the runs rebuild, Task 18, D-8075; spec 2026-11-04 §8.2.2, §8.2.3, A26,
// A37, o5, o9, check 10). The card is a glance: lamp and word, the name, one marker, one context line. Placeholders only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FleetSession, ProgrammeEnding, RunStuck, RunSummary } from '../../shared/api';
import { navigate } from '../src/lib/router';
import { clearScreenCache } from '../src/lib/screenCache';
import { ProgrammeCard, cardLine } from '../src/screens/ProgrammeCard';
import { endingWords, openCards, quietSplit, sortCards, QUIET_AFTER_MS, type CardProgramme } from '../src/screens/usePrograms';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { itemView, waitingView } from './ledgersFixture';
import { RunsScreen, programmeRow, programmesAnswer } from './runs-board';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a', state: 'working', kind: 'work', reviews: null, claimedBy: 'sess-coord',
  resumed: false, clearedAt: null, openedAt: NOW - 1_000_000, dispatchStartedAt: null, dispatchedAt: NOW - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
    clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const stuck = (closes: RunStuck['closes'] = null): RunStuck => ({ reason: 'owner-gone', cause: 'coordinator-gone', since: NOW - 2 * D, closes });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<never> => new Promise<never>(() => {});

beforeEach(() => { navigate('/runs', { replace: true }); clearScreenCache(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cardOf = (open: RunSummary[], rowOver: Parameters<typeof programmeRow>[1] = {}): CardProgramme => {
  const row = programmeRow('prog-a', { title: 'Programme A', lastMoveAt: NOW - 12 * 60_000, ...rowOver });
  return openCards(open, { ok: true, programmes: [row], closedToday: { operator: 0, sweep: 0, coordinator: 0 } })[0]!;
};
const draw = (card: CardProgramme, over: { quietMs?: number | null; paused?: boolean; needs?: number } = {}) =>
  render(<ul><ProgrammeCard card={card} nowMs={NOW} quietMs={over.quietMs ?? null} paused={over.paused ?? false} needs={over.needs ?? 0} /></ul>);

describe('the card', () => {
  it('is lamp and word, the name, and one context line of wave counts and the last move', () => {
    const card = cardOf([run(1)], { waves: { working: 2, waiting: 1, queued: 0, done: 4, failed: 0 } });
    draw(card);
    const el = screen.getByTestId('programme-card');
    expect(el).toHaveAttribute('data-word', 'moving');
    expect(within(el).getByRole('link', { name: 'Programme A' })).toHaveAttribute('href', '/programmes/prog-a');
    expect(el).toHaveTextContent('2 working · 1 waiting · 4 done · moved 12m ago');
  });

  it('the last move reads moved 12m ago, the app’s elapsed form (o9)', () => {
    expect(cardLine(cardOf([run(1)]), NOW)).toBe('moved 12m ago');
    expect(cardLine(cardOf([run(1)], { lastMoveAt: NOW - 30_000 }), NOW)).toBe('moved just now');
  });

  it('a needing card keeps its motion word and carries needs you · 1', () => {
    draw(cardOf([run(1)]), { needs: 1 });
    const el = screen.getByTestId('programme-card');
    expect(el).toHaveAttribute('data-word', 'moving');
    expect(within(el).getByRole('link', { name: 'needs you · 1' })).toHaveAttribute('href', '/waiting?programme=prog-a');
  });

  it('no marker at zero', () => {
    draw(cardOf([run(1)]));
    expect(screen.queryByText(/needs you/)).toBeNull();
  });

  it('a stalled programme reads stalled, and the operator’s pause reads paused', () => {
    const card = cardOf([run(1)], { lastMoveAt: NOW - 3 * H });
    draw(card, { quietMs: 2 * H });
    expect(screen.getByTestId('programme-card')).toHaveAttribute('data-word', 'stalled');
    cleanup();
    draw(card, { quietMs: 2 * H, paused: true });
    expect(screen.getByTestId('programme-card')).toHaveAttribute('data-word', 'paused');
  });

  it('a programme with 3 stuck runs and 1 queued behind a stuck one reads stuck (o5)', () => {
    const open = [run(1, { stuck: stuck() }), run(2, { stuck: stuck() }), run(3, { stuck: stuck() }),
      run(4, { state: 'planned', sessionId: null, blockedBy: 1 })];
    draw(cardOf(open));
    const el = screen.getByTestId('programme-card');
    expect(el).toHaveAttribute('data-word', 'stuck');
    expect(el).toHaveTextContent('3 stuck · nothing closes them on its own');
  });

  it('a programme with one healthy open run does not read stuck, and says how many are stuck', () => {
    draw(cardOf([run(1, { stuck: stuck({ at: NOW + 20 * H, armed: true }) }), run(2)]));
    const el = screen.getByTestId('programme-card');
    expect(el).toHaveAttribute('data-word', 'moving');
    expect(el).toHaveTextContent('1 stuck · ccrc closes it in 20 h');
  });

  it('no run number on a card', () => {
    draw(cardOf([run(410, { stuck: stuck() }), run(411)]));
    expect(screen.getByTestId('programme-card').textContent).not.toMatch(/410|411|run #|run \d/i);
  });

  it('the name is the title, and the slug only when no title was sent', () => {
    expect(openCards([run(1, { programTitle: '' })], null)[0]!.title).toBe('prog-a');
    expect(openCards([run(1)], null)[0]!.title).toBe('Programme A');
  });

  it('counts from the open runs alone while the read has not landed, and never counts a done wave it cannot know', () => {
    const card = openCards([run(1, { wave: 1 }), run(2, { wave: 2, state: 'planned', sessionId: null })], null)[0]!;
    expect(card.row.waves).toEqual({ working: 1, waiting: 0, queued: 1, done: 0, failed: 0 });
    expect(cardLine(card, NOW)).toMatch(/^1 working · 1 queued/);
  });

  it('a review nests under its wave and is never counted apart', () => {
    const card = openCards([run(1, { wave: 1 }), run(2, { wave: 1, kind: 'review', reviews: 1, state: 'awaiting-review' })], null)[0]!;
    expect(card.row.waves).toEqual({ working: 1, waiting: 0, queued: 0, done: 0, failed: 0 });
  });
});

describe('the order', () => {
  const cards = (): CardProgramme[] => {
    const open = [run(1, { program: 'p-old', programTitle: 'Old' }), run(2, { program: 'p-new', programTitle: 'New' }),
      run(3, { program: 'p-ask', programTitle: 'Asking' })];
    const rows = [programmeRow('p-old', { title: 'Old', lastMoveAt: NOW - 5 * H }), programmeRow('p-new', { title: 'New', lastMoveAt: NOW - H }),
      programmeRow('p-ask', { title: 'Asking', lastMoveAt: NOW - 9 * H })];
    return openCards(open, { ok: true, programmes: rows, closedToday: { operator: 0, sweep: 0, coordinator: 0 } });
  };

  it('cards sort needs you first, then by last move', () => {
    const sorted = sortCards(cards(), (slug) => (slug === 'p-ask' ? 1 : 0)).map((c) => c.row.slug);
    expect(sorted).toEqual(['p-ask', 'p-new', 'p-old']);
  });

  it('a programme with no run opened or closed in 7 days folds under quiet programmes, and one at 6 days does not', () => {
    const rows = [programmeRow('p-old', { title: 'Old', lastMoveAt: NOW - QUIET_AFTER_MS }), programmeRow('p-new', { title: 'New', lastMoveAt: NOW - 6 * D }),
      programmeRow('p-ask', { title: 'Asking', lastMoveAt: NOW - 30 * D })];
    const open = [run(1, { program: 'p-old' }), run(2, { program: 'p-new' }), run(3, { program: 'p-ask' })];
    const all = openCards(open, { ok: true, programmes: rows, closedToday: { operator: 0, sweep: 0, coordinator: 0 } });
    const split = quietSplit(all, NOW, (slug) => (slug === 'p-ask' ? 1 : 0));
    expect(split.quiet.map((c) => c.row.slug)).toEqual(['p-old']);
    expect(split.live.map((c) => c.row.slug).sort()).toEqual(['p-ask', 'p-new']);
  });
});

describe('Finished endings (§8.2.3, A26)', () => {
  const e = (over: Partial<ProgrammeEnding>): ProgrammeEnding => ({ outcome: 'ended', waves: 3, neverStarted: 0, closedBy: null, ...over });
  it('complete, ended with never-started waves, and ended by a closer', () => {
    expect(endingWords(e({ outcome: 'complete', waves: 5 }))).toBe('complete · 5 waves done');
    expect(endingWords(e({ outcome: 'complete', waves: 1 }))).toBe('complete · 1 wave done');
    expect(endingWords(e({ neverStarted: 3, closedBy: 'sweep' }))).toBe('ended · 3 never started (closed by ccrc)');
    expect(endingWords(e({ closedBy: 'operator' }))).toBe('ended · closed by you');
    expect(endingWords(e({ closedBy: 'coordinator' }))).toBe('ended · closed by the coordinator');
    expect(endingWords(e({}))).toBe('ended');
  });
});

describe('on the board', () => {
  const board = (live: RunSummary[], props: Partial<React.ComponentProps<typeof RunsScreen>> = {}, sessions: FleetSession[] = []) => {
    const store = makeStore();
    act(() => { store.setState({ runs: live, runsFrameSeen: true, sessions, fleetFrameSeen: true }); });
    const view = render(<RunsScreen store={store} loadCaps={NO_CAPS} {...props} />);
    return { store, ...view };
  };

  it('a programme with a gone coordinator has a card', () => {
    board([run(1, { claimedBy: 'sess-gone' })], {}, []);
    expect(screen.getByTestId('programme-card')).toHaveTextContent('Programme A');
  });

  it('the quiet fold is folded by default and holds the quiet cards', async () => {
    board([run(1, { program: 'p-old', programTitle: 'Old' }), run(2, { program: 'p-new', programTitle: 'New' })], {
      loadProgrammes: programmesAnswer([programmeRow('p-old', { title: 'Old', lastMoveAt: NOW - 8 * D }), programmeRow('p-new', { title: 'New', lastMoveAt: NOW - H })]),
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByTestId('programme-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /quiet programmes/i }));
    expect(screen.getAllByTestId('programme-card')).toHaveLength(2);
  });

  it('the marker reads the one needs-you source: a programme’s open item, and nothing for a programme without one', async () => {
    const store = makeStore();
    act(() => {
      store.setState({ runs: [run(1), run(2, { program: 'prog-b', programTitle: 'Programme B' })], runsFrameSeen: true, sessions: [],
        fleetFrameSeen: true, waiting: waitingView({ items: [itemView({ id: 1, program: 'prog-a', runId: 1 })] }) });
    });
    render(<RunsScreen store={store} loadCaps={NO_CAPS} />);
    await act(async () => { await Promise.resolve(); });
    const [a, b] = ['prog-a', 'prog-b'].map((slug) => document.querySelector<HTMLElement>(`[data-programme="${slug}"]`)!);
    expect(within(a!).getByRole('link', { name: 'needs you · 1' })).toBeInTheDocument();
    expect(within(b!).queryByText(/needs you/)).toBeNull();
    expect(screen.getAllByTestId('programme-card')[0]).toBe(a);
  });

  it('the card’s links keep the tap floor and the card carries no button', () => {
    board([run(1)]);
    expect(screen.getByTestId('programme-card').querySelector('button')).toBeNull();
  });
});
