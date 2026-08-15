// The 44px tap floor, for the six controls this branch added.
//
// Final-round gates review, finding 5: `vitest` runs with `css: false` (no
// `css` key in `vite.config.ts`), so NO stylesheet is ever evaluated by any
// test and no test anywhere can assert a computed 44px. The branch mitigates
// that with text-scraping CSS tests — the right call — but only two of the six
// new `--tap-min` rules were scraped (`.keycap--pr` in pr-keycap-css.test.ts,
// `.proj-archived-toggle` in fleet-css.test.ts). `.fleet-archived-row`,
// `.archive-row`, `.pr-title-input` and `.reap-go` had no coverage of any
// kind: deleting the declaration, or renaming the class on the element, was a
// silent 20px-high control on a phone.
//
// Both halves are needed and neither is sufficient:
//   - the SCRAPE proves the rule exists and is written against the shared
//     token rather than a literal `44px` that would not follow the token;
//   - the RENDER proves a real element still carries the class, which is what
//     a rule with no matching element would silently stop doing.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CoordStatus, FleetSession, MailSummary, PrState, RunSummary, WsAudit } from '../../shared/api';
import { declValue, norm, ruleIn, stripComments } from './cssRule';
import { api } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { ArchiveScreen } from '../src/screens/ArchiveScreen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { MailScreen } from '../src/screens/MailScreen';
import { RunsScreen } from '../src/screens/RunsScreen';
import { CoordBanner } from '../src/fleet/CoordBanner';
import { MailBadge } from '../src/fleet/MailBadge';
import { StartProgramSheet } from '../src/fleet/StartProgramSheet';
import { MailStrip } from '../src/session/MailStrip';
import { PrKeycap } from '../src/session/PrKeycap';
import { PrSheet } from '../src/session/PrSheet';
import { ReapSheet } from '../src/session/ReapSheet';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');
const fleetCss = read('fleet', 'fleet.css');
const chatCss = read('session', 'chat.css');
const tokensCss = read('styles', 'tokens.css');

// Fix round 3, verifier P5. These three stylesheets belong to the ui-css lane
// and are being edited in parallel with this file, so the scrape must survive
// any reasonable reformatting of them — grouped selector lists, moved braces,
// re-indentation, comments — and fail only on the thing it asserts. It reads
// the rules through the shared, formatting-insensitive helper rather than a
// fourth hand-rolled regex; `test/cssRule.ts` carries the reasoning, including
// why a text scrape is the right tool here at all (jsdom evaluates no
// stylesheet, so no test can assert a computed 44px).

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// — fixtures —

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'custom-tools',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, ...over,
});

const prState = (over: Partial<PrState> = {}): PrState => ({
  phase: 'none', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 3, reason: null, checkedAt: Date.now() - 60_000, mergedAt: null, retryAt: null, ...over,
});

const wsAudit: WsAudit = {
  id: 'demo-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/w/quiet-basin',
  project: 'custom-tools', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
  dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
  clips: [], stashes: 0, worktreeBytes: 500_000_000, commitsAheadOfBase: 1,
  pr: { number: 7, url: 'u', mergeCommit: 'x', headRefOid: 'y' },
  merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) },
  transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'q'.repeat(64), sentence: '',
};

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless. */
const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

// Build 7 Task 5 — RunSummary as PR I actually shipped it (see
// runs-screen.test.tsx's own fixture comment for the field-shape reconciliation).
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0, ...over,
});

const coordStatus = (over: Partial<CoordStatus> = {}): CoordStatus => ({ pause: 'clear', mail: 'clear', ...over });

const mailItem = (over: Partial<MailSummary> = {}): MailSummary => ({
  id: 1, deliveryId: 1, at: Date.now() - 30_000, fromId: 'coordinator', toId: 'ccrc-pwa-clear-cove',
  runId: 3, kind: 'question', subject: 'rebase before you start?',
  artifacts: [], state: 'delivered', ...over,
});

// — the token itself —

describe('the tap-target token', () => {
  it('is the 44px acceptance criterion, so every rule below inherits it from one place', () => {
    // The DECLARATION, not the three spaces tokens.css currently aligns it
    // with: a formatter closing that gap is not a regression in the tap floor.
    expect(declValue(ruleIn(tokensCss, ':root'), '--tap-min')).toBe('44px');
  });
});

// — the four rules the gates review found uncovered —

describe('.fleet-archived-row — the fleet footer route into the archive', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.fleet-archived-row'), 'min-height')).toBe('var(--tap-min)');
  });

  it('is the class the rendered footer row actually carries', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => {
      store.setState({
        conn: 'open',
        sessions: [sess({ id: 'a', project: 'alpha', workspace: 'quiet-mesa',
          archivedAt: 100, archivedBytes: 1_200_000_000 })],
      });
    });
    const row = screen.getByRole('button', { name: /archived on disk · 1 · 1\.2 gb/i });
    expect(row).toHaveClass('fleet-archived-row');
  });
});

describe('.archive-row — every row on the archive screen', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.archive-row'), 'min-height')).toBe('var(--tap-min)');
  });

  it('is the class every rendered archive row actually carries', () => {
    render(<ArchiveScreen
      sessions={[
        sess({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1 }),
        sess({ id: 'b', project: 'beta', workspace: 'still-cove', archivedAt: 200, archivedBytes: null }),
      ]}
      onOpen={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /^workspace / });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveClass('archive-row');
  });
});

describe('.pr-title-input — the one editable field in the PR composer', () => {
  it('is at least one tap tall, off the shared token', () => {
    // A text input below the floor is worse than a short button: the target
    // has to be hit to place a caret, not merely pressed.
    expect(declValue(ruleIn(chatCss, '.pr-title-input'), 'min-height')).toBe('var(--tap-min)');
  });

  it('is the class the rendered title field actually carries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pr: prState(),
      draft: { title: 'the work', body: '## Commits\n' },
      facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: 3, dirty: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<PrSheet session={sess({ pr: prState() })} open onClose={() => {}} onReap={() => {}} />);
    expect(await screen.findByLabelText(/^title$/i)).toHaveClass('pr-title-input');
  });
});

describe('.reap-go — the destructive confirm', () => {
  it('is at least one tap tall, off the shared token', () => {
    // The one button on this branch that deletes a worktree. A mis-tap here
    // is not recoverable by tapping again somewhere else.
    expect(declValue(ruleIn(chatCss, '.reap-go'), 'min-height')).toBe('var(--tap-min)');
  });

  it('is the class the rendered Remove button actually carries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(wsAudit),
      { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<ReapSheet session={sess({ archivedAt: 1 })} open onClose={() => {}} onReaped={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Remove quiet-basin · 500 MB' }))
      .toHaveClass('reap-go');
  });
});

// — the two the branch already scraped, checked for the ELEMENT half only —
//
// pr-keycap-css.test.ts and fleet-css.test.ts already scrape these rules. What
// neither does is prove the class is still on a rendered control, which is the
// other way a 44px floor stops applying.

describe('the two rules that were already scraped still reach a real element', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('.keycap--pr is on the rendered PR keycap', () => {
    render(<PrKeycap pr={prState({ phase: 'open', number: 42 })} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('keycap--pr');
  });

  it('.proj-archived-toggle is on the rendered Archived (n) sub-fold', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => {
      store.setState({
        conn: 'open',
        sessions: [
          sess({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, bucket: 'archived' }),
          sess({ id: 'b', project: 'alpha', workspace: 'live-one', archivedAt: null }),
        ],
      });
    });
    expect(screen.getByRole('button', { name: /archived \(1\)/i })).toHaveClass('proj-archived-toggle');
  });

  it('keeps every one of the eighteen on the token, never a bare 44px literal', () => {
    // A literal would not follow `--tap-min` if the acceptance criterion ever
    // moves, and would not be found by the scrapes above either. Build 7 Task
    // 4 (`.mail-badge`, `.mail-back`), Task 5 (`.fleet-runs-row`,
    // `.runs-back`, `.run-row`, `.run-open`), Task 6 (`.mail-strip-head`),
    // Build 4 Task 11 (`.coord-banner`, `.coord-toggle`), Task 12
    // (`.run-abandon`) and Task 13 (`.program-start-door`, `.program-start-go`)
    // join the same loop rather than getting their own — one place where
    // "every floored rule stays on the token" is checked, not a second copy
    // of the assertion per branch.
    for (const rule of [
      ruleIn(fleetCss, '.fleet-archived-row'), ruleIn(fleetCss, '.archive-row'),
      ruleIn(fleetCss, '.proj-archived-toggle'), ruleIn(chatCss, '.pr-title-input'),
      ruleIn(chatCss, '.reap-go'), ruleIn(chatCss, '.keycap--pr'),
      ruleIn(fleetCss, '.mail-badge'), ruleIn(fleetCss, '.mail-back'),
      ruleIn(fleetCss, '.fleet-runs-row'), ruleIn(fleetCss, '.runs-back'),
      ruleIn(fleetCss, '.run-row'), ruleIn(fleetCss, '.run-row .run-open'),
      ruleIn(chatCss, '.mail-strip .mail-strip-head'),
      ruleIn(fleetCss, '.coord-banner'), ruleIn(fleetCss, '.coord-toggle'),
      ruleIn(fleetCss, '.run-row .run-abandon'),
      ruleIn(fleetCss, '.program-start-door'), ruleIn(fleetCss, '.program-start-go'),
    ]) {
      // Comments off: a rule may legitimately MENTION 44px in prose
      // explaining the token, and that is not a hardcoded literal.
      expect(norm(stripComments(rule))).not.toContain('44px');
      expect(norm(stripComments(rule))).toContain('var(--tap-min)');
    }
  });
});

// — Build 7, Task 4: the mail door and its screen's own back control —

describe('.mail-badge — the only door to /mail', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.mail-badge'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.mail-badge'), 'min-width')).toBe('var(--tap-min)');
  });
  it('is the class the rendered head control actually carries', () => {
    render(<MailBadge unread={0} />);
    expect(screen.getByRole('button', { name: /mail/i })).toHaveClass('mail-badge');
  });
});

describe('.mail-back — the feed’s back control', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.mail-back'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered control actually carries', () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('mail-back');
  });
});

// — Build 7, Task 5: the run board's footer door, back control and rows —

describe('.fleet-runs-row — the only door to /runs', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.fleet-runs-row'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered footer row actually carries, once a runs frame has landed', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => { store.setState({ conn: 'open', sessions: [sess()], runs: [], runsFrameSeen: true }); });
    expect(screen.getByRole('button', { name: /runs · none active/i })).toHaveClass('fleet-runs-row');
  });
  // Review finding 11/23: before any `{type:'runs'}` frame has landed, the
  // row must not assert "none active" as fact — `runsFrameSeen` distinguishes
  // "genuinely none" from "hasn't said yet", the same way `RunsScreen` itself
  // already reads the flag.
  it('reads unknown, not "none active", before runsFrameSeen', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => { store.setState({ conn: 'open', sessions: [sess()] }); });
    expect(screen.queryByRole('button', { name: /runs · none active/i })).toBeNull();
    expect(screen.getByRole('button', { name: /runs · —/i })).toHaveClass('fleet-runs-row');
  });
  // Review finding 20: this is the only door to /runs, so it must render in
  // EVERY arm of the `sessions.length` ternary, not only the populated one —
  // including spec §8's "fleet host unreachable" case, which renders the
  // first-run panel (an honest `sessions: []`, `conn: 'open'`).
  it('renders in the first-run (zero-session) arm, not only the populated one', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    act(() => { store.setState({ conn: 'open', sessions: [] }); });
    expect(screen.getByText('No sessions yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /runs ·/i })).toHaveClass('fleet-runs-row');
  });
});

describe('.runs-back — the run board’s own back control', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.runs-back'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered control actually carries', () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('runs-back');
  });
});

describe('.run-row and .run-open — every row on the run board', () => {
  it('.run-row is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.run-row'), 'min-height')).toBe('var(--tap-min)');
  });
  it('.run-open is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.run-row .run-open'), 'min-height')).toBe('var(--tap-min)');
  });
  it('.run-open is the class the rendered row’s own button actually carries', () => {
    const store = makeStore();
    // `runsFrameSeen: true` alongside `runs` — the real store only ever sets
    // these together (`onMessage`'s `{type:'runs'}` arm, stores/fleet.ts), so
    // this is what makes the row trustworthy enough to render immediately
    // rather than the "no answer yet" loading state (review finding 19).
    act(() => { store.setState({ runs: [run()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('button', { name: /clear-cove/i })).toHaveClass('run-open');
  });
});

// — Build 4, Task 11: the pause banner's own toggle —

describe('.coord-toggle — the pause banner’s own toggle', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.coord-toggle'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered toggle actually carries, once a coord frame has landed', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coordStatus({ pause: 'set' }), coordFrameSeen: true }); });
    render(<CoordBanner store={store} />);
    expect(screen.getByRole('button')).toHaveClass('coord-toggle');
  });
  // The banner's own "frame not yet seen" gate (`CoordBanner.tsx`) — before
  // any `coord` frame has landed, there is no toggle to find at all.
  it('renders no toggle before any coord frame has landed', () => {
    render(<CoordBanner store={makeStore()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// — Build 7, Task 6: the session mail strip's own collapsed head —

describe('.mail-strip-head — the session mail strip’s door to its rows', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(chatCss, '.mail-strip .mail-strip-head'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered head control actually carries', () => {
    render(<MailStrip mail={[mailItem()]} />);
    expect(screen.getByRole('button', { expanded: false })).toHaveClass('mail-strip-head');
  });
});

// — Build 4, Task 12: the run row's own abandon control (spec §4.3, D-B4-14) —

describe('.run-abandon — the wedge release, a sibling of .run-open', () => {
  it('is at least one tap tall AND wide, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.run-row .run-abandon'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.run-row .run-abandon'), 'min-width')).toBe('var(--tap-min)');
  });
  it('is the class the rendered row control actually carries', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('button', { name: /abandon run 3/i })).toHaveClass('run-abandon');
  });
  // D-B4-14's own reason for existing: an inert row (no session, so no
  // .run-open) still gets the control — that IS the wedge shape.
  it('is present on an inert row too, where .run-open is absent', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run({ sessionId: null, state: 'planned' })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('button', { name: /abandon run 3/i })).toHaveClass('run-abandon');
  });
});

// — Build 4, Task 13: the run board's own door onto a new program, and the
// start-a-program sheet's own confirm control (spec §4.4) —

describe('.program-start-door — the only door onto a new program', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.program-start-door'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered footer control actually carries', () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('button', { name: /start a program/i })).toHaveClass('program-start-door');
  });
});

describe('.program-start-go — the sheet’s own confirm control', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.program-start-go'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered confirm button actually carries', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [],
    });
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [{ name: 'ccrc-pwa', workdir: '/w' }] })} />);
    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));
    expect(await screen.findByRole('button', { name: /^start/i })).toHaveClass('program-start-go');
  });
});
