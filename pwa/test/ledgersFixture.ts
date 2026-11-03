// ONE `ItemView` / `WaitingView` / `RunSummary` fixture for the Waiting on you tests (desktop-polish PL5a). Neutral names
// only (`prog-a`, `project-a`): the repository is public. The defaults are an open, ordinary `do` item of programme
// `prog-a`; each case names what it is about.
import type { RunSummary } from '../../shared/api';
import type { ItemView, WaitingView } from '../../shared/ledgers';

export const NOW = 1_800_000_000_000;
export const MIN = 60_000;

export const itemView = (over: Partial<ItemView> = {}): ItemView => ({
  id: 1, program: 'prog-a', runId: null, kind: 'do', title: 'Switch the setting on', why: 'It keeps piling up until then.',
  how: ['Open Settings.', 'Set it to Live.'], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], ...over,
});

export const waitingView = (over: Partial<WaitingView> = {}): WaitingView => ({ items: [], cleared: [], goals: [], ...over });

/** A run row with only the fields the Waiting screens read. */
export const runRow = (over: Partial<RunSummary> & { id: number; program: string }): RunSummary =>
  ({ state: 'working', kind: 'work', wave: 1, waveOf: 3, closedAt: null, sessionId: null, claimedBy: null, programTitle: null, ...over }) as unknown as RunSummary;
