// The session path, pinned before C7k builds one `sessionPath` (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 11; ARCH-75). `sessionPathLiterals()` (census-w7)
// counts 14 string expressions starting `/s/` in 12 files; two of them (`app.tsx#ArchiveRoute`,
// `AccountsScreen.tsx#AccountsScreen`) do not `encodeURIComponent` the id. Every id the server sends passes
// `shared/api.ts#isSessionIdShape`, and over that charset `encodeURIComponent` is the identity, so one helper that
// encodes every id changes no byte of any path the wire can produce.
//
// Each site is driven through its own door (a click, a command, a returned target) and read from where it lands, for
// a fixed id inside the charset (every site: `/s/session-a`) and for one built OUTSIDE it (a space and a slash, which no
// wire id carries), where the encoding sites and the two that do not encode part ways. The four create-flow doors
// (`NewSessionSheet`'s two, `useProgramAttempt`'s `finish` and `retry`) navigate only after a create or a kickoff
// answers; their paths are held by `new-session-sheet.test.tsx`, `new-session-name.test.tsx` and
// `start-program.test.tsx` (slug session-path-create-flows, in the C7a note).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { isSessionIdShape, type AccountUsage, type NotifyEvent, type RunSpend, type RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import { navigate } from '../src/lib/router';
import { api } from '../src/lib/api';
import { App } from '../src/app';
import { stepSession } from '../src/command/commands';
import { sessionEntries } from '../src/command/sessionEntries';
import { KickoffRecovery } from '../src/fleet/KickoffRecovery';
import { inboxTarget } from '../src/fleet/inboxTarget';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { RunRow } from '../src/screens/RunRow';
import { SessionCoordination } from '../src/session/SessionDetails';
import { sessionFacts } from '../src/fleet/sessionFacts';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { FleetScreen } from '../src/screens/FleetScreen';
import { FleetTable } from '../src/skins/instrument/FleetTable';

const INSIDE = 'session-a';
const OUTSIDE = 'session a/1';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => { useFleetStore.setState({ sessions: [], conn: 'connecting' }); });
  navigate('/');
});

/** Where a door lands: the router's pathname after it ran. */
const landed = (): string => location.pathname;

const run = (sessionId: string): RunSummary => ({
  id: 7, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 1, project: 'project-a', homeProject: null,
  sessionId, workspace: 'ws-a', branch: null, state: 'working', kind: 'work', reviews: null, claimedBy: 'coord-a', resumed: false, clearedAt: null,
  openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null,
});

const fleetStore = (): FleetStore => createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket });
/** The fleet chrome's own reads, held (`fleet-flows.test.tsx`'s set), so a board mount sends nothing. */
const chromeApis = (): void => {
  vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'projects').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
};

/** Each driveable site: run its door for `id` and return the path it produced. */
const SITES: Record<string, (id: string) => Promise<string>> = {
  'app.tsx#ArchiveRoute': async (id) => {
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id, workspace: 'quiet-basin', status: 'dead', bucket: 'archived', archivedAt: 1_784_500_000 })] }); });
    navigate('/archive');
    render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: /^workspace /i }));
    return landed();
  },
  'command/commands.ts#stepSession': async (id) => {
    const go = vi.fn();
    stepSession({ sessions: [fleetSession({ id })], path: '/', navigate: go } as never, 1);
    return go.mock.calls[0]![0] as string;
  },
  'command/sessionEntries.ts#sessionEntries': async (id) => {
    const go = vi.fn();
    sessionEntries([fleetSession({ id })], [], 'page')[0]!.run({ navigate: go } as never);
    return go.mock.calls[0]![0] as string;
  },
  'fleet/KickoffRecovery.tsx#KickoffRecovery': async (id) => {
    render(createElement(KickoffRecovery, { failure: { sessionId: id, slug: 'program-a', title: 'Program A', why: 'refused' }, retrying: false, onRetry: () => {} }));
    fireEvent.click(screen.getByRole('button', { name: 'Open it without a brief' }));
    return landed();
  },
  'fleet/inboxTarget.ts#inboxTarget': async (id) => {
    const ev = { seq: 1, at: 1, kind: 'mail', sessionId: id, title: 't', body: 'b', runId: null } as NotifyEvent;
    const t = inboxTarget(ev, new Map([[id, fleetSession({ id })]]), new Map());
    return t.kind === 'session' ? t.path : `(${t.kind})`;
  },
  'screens/AccountsScreen.tsx#AccountsScreen': async (id) => {
    const acct: AccountUsage = { wrapper: 'claude', five: 0, seven: 0, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false };
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [acct], projected: null, roster: TEST_ROSTER });
    act(() => { useFleetStore.setState({ sessions: [fleetSession({ id, wrapper: 'claude', home: 'claude', workspace: 'ws-a', name: 'session-a' })] }); });
    render(createElement(AccountsScreen));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(document.querySelector<HTMLElement>('.accounts-session')!);
    return landed();
  },
  'screens/RunRow.tsx': async (id) => {
    render(createElement('ul', null, createElement(RunRow, {
      run: run(id), nowMs: Date.now(), session: null, coordSession: null, frameSeen: true, programHasOpenRun: true,
      onAbandon: () => {}, onResume: () => {}, loadSpend: () => new Promise<RunSpend>(() => {}),
    })));
    fireEvent.click(document.querySelector<HTMLElement>('.run-open')!);
    return landed();
  },
  // A working row: a project with a working member is not rolled up (D-6088), so its line is on the card.
  'screens/FleetScreen.tsx#FleetScreen': async (id) => {
    chromeApis();
    const store = fleetStore();
    act(() => { store.setState({ conn: 'open', sessions: [fleetSession({ id, project: 'project-a', workspace: 'ws-a', status: 'busy', bucket: 'working' })], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store }, createElement(FleetScreen, { store })));
    fireEvent.click(document.querySelector<HTMLElement>('.sess-open')!);
    return landed();
  },
  'skins/instrument/FleetTable.tsx#openSession': async (id) => {
    chromeApis();
    // A working row: its status group does not fold, so the row is on the table.
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id, project: 'project-a', workspace: 'ws-a', status: 'busy', bucket: 'working' })], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
    fireEvent.click(document.querySelector<HTMLElement>('.sess-open')!);
    return landed();
  },
  'session/SessionDetails.tsx#SessionCoordination': async (id) => {
    const facts = sessionFacts({ session: fleetSession({ id: 'worker-a' }), now: Date.now() });
    render(createElement(SessionCoordination, { facts, coordination: { workingOn: null, coordinator: 'coord a', coordinatorId: id, coordinatorState: null, card: 'project-a', run: null } }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the coordinator — coord a' }));
    return landed();
  },
};

describe('encodeURIComponent is the identity over isSessionIdShape\'s charset', () => {
  it('every character the shape admits, alone and together, encodes to itself', () => {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
    expect(isSessionIdShape(charset)).toBe(true);
    for (const ch of charset) expect(encodeURIComponent(ch), ch).toBe(ch);
    expect(encodeURIComponent(charset)).toBe(charset);
    // The shape admits nothing else: a reserved character is outside it.
    for (const ch of [' ', '/', '%', '?', '#', ':', '+', '&']) expect(isSessionIdShape(`a${ch}b`), JSON.stringify(ch)).toBe(false);
  });
});

describe('each driveable site\'s path, for an id inside the charset and one outside it', () => {
  // Where `location.pathname` is read, the router has stored the href as given, so an unencoded space reads back as
  // `%20` (the URL parser's own encoding) and a slash stays a slash: the two sites that do not encode part ways there.
  const PATHS: Record<string, [string, string]> = {
    'app.tsx#ArchiveRoute': ['/s/session-a', '/s/session%20a/1'],
    'command/commands.ts#stepSession': ['/s/session-a', '/s/session%20a%2F1'],
    'command/sessionEntries.ts#sessionEntries': ['/s/session-a', '/s/session%20a%2F1'],
    'fleet/KickoffRecovery.tsx#KickoffRecovery': ['/s/session-a', '/s/session%20a%2F1'],
    'fleet/inboxTarget.ts#inboxTarget': ['/s/session-a', '/s/session%20a%2F1'],
    'screens/AccountsScreen.tsx#AccountsScreen': ['/s/session-a', '/s/session%20a/1'],
    'screens/RunRow.tsx': ['/s/session-a', '/s/session%20a%2F1'],
    'screens/FleetScreen.tsx#FleetScreen': ['/s/session-a', '/s/session%20a%2F1'],
    'skins/instrument/FleetTable.tsx#openSession': ['/s/session-a', '/s/session%20a%2F1'],
    'session/SessionDetails.tsx#SessionCoordination': ['/s/session-a', '/s/session%20a%2F1'],
  };
  for (const [site, door] of Object.entries(SITES)) {
    it(site, async () => {
      const inside = await door(INSIDE);
      cleanup();
      navigate('/');
      const outside = await door(OUTSIDE);
      expect([inside, outside]).toEqual(PATHS[site]);
    });
  }
});
