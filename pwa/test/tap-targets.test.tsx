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
import type { CoordCapsView } from '../../shared/api';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { CoordStatus, FleetSession, MailSummary, NotifyEvent, PrState, RunSummary, WsAudit } from '../../shared/api';
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
import { BARE_ROW, CONTROL_ROW, MailStrip, TEXT_INPUT, buttonVariants } from '@ccrc/ui';
import { PrKeycap } from '../src/session/PrKeycap';
import { PrSheet } from '../src/session/PrSheet';
import { ReapSheet } from '../src/session/ReapSheet';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');
/** The design system's own stylesheets — tokens.css lives in @ccrc/ui now. */
const readUi = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', ...seg), 'utf8');
const fleetCss = read('fleet', 'fleet.css');
const chatCss = read('session', 'chat.css');
const tokensCss = readUi('styles', 'tokens.css');
/** The mail strip is the design system's now, and its stylesheet travelled
 *  with it — the tap floor is asserted where the rule actually lives. */
const mailStripCss = readUi('components', 'mail-strip.css');

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
  branch: 'ws/quiet-basin', ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null, ...over,
});

const prState = (over: Partial<PrState> = {}): PrState => ({
  phase: 'none', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 3, reason: null, checkedAt: Date.now() - 60_000, mergedAt: null, retryAt: null, ...over,
});

const wsAudit: WsAudit = {
  id: 'demo-quiet-basin', branch: 'ws/quiet-basin', registryBranch: 'ws/quiet-basin', drift: '',
  base: 'origin/main', workdir: '/w/quiet-basin',
  project: 'custom-tools', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
  alive: true, started: true, unit: 'enabled',
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
  wave: 3, waveOf: 4, project: 'ccrc-pwa', homeProject: null,
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  // F7's per-run health facts. All-clear, deliberately: every case in this file
  // predates the warn row and must keep rendering exactly as it did.
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

const coordStatus = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });

const mailItem = (over: Partial<MailSummary> = {}): MailSummary => ({
  id: 1, deliveryId: 1, at: Date.now() - 30_000, fromId: 'coordinator', toId: 'ccrc-pwa-clear-cove',
  runId: 3, kind: 'question', subject: 'rebase before you start?',
  artifacts: [], state: 'delivered',
  attempts: 0, lastError: null,
  // D-792: no gate is holding this fixture — the shape of a delivery nothing
  // has refused. A test that wants a wedged one overrides these four.
  lastGate: null, gateCount: 0, gateSince: null, gateAt: null,
  ...over,
});

// — the token itself —

/** The caps dial's reader, held for every board render in this file. `RunsScreen`
 *  injects it (see that prop's own docstring): a loader left to the global
 *  `fetch` puts a request into every test that renders the board, and the
 *  assertions here are about which routes the board calls. `never` keeps the
 *  control unrendered, which is what these tests want it to be. */
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

describe('the tap-target token', () => {
  it('is the 44px acceptance criterion, so every rule below inherits it from one place', () => {
    // The DECLARATION, not the three spaces tokens.css currently aligns it
    // with: a formatter closing that gap is not a regression in the tap floor.
    expect(declValue(ruleIn(tokensCss, ':root'), '--tap-min')).toBe('44px');
  });
});

// — the four rules the gates review found uncovered —

// AND SO DID FIVE BARE ROWS. `.fleet-archived-row`, `.fleet-runs-row`,
// `.proj-released-toggle`, `.proj-archived-toggle` and `.archive-row`
// declared the same six declarations — a full-width left-aligned tap target
// with no chrome at all — and are `<BareRow>` now. Each render half below is
// untouched.
function expectBareRowIsATarget(): void {
  expect(BARE_ROW).toContain('min-h-tap');
  expect(BARE_ROW).not.toContain('44px');
}

describe('.fleet-archived-row — the fleet footer route into the archive', () => {
  it('is at least one tap tall, off the shared token', () => {
    expectBareRowIsATarget();
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
    expectBareRowIsATarget();
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
    //
    // THE FLOOR MOVED FROM A RULE TO A COMPONENT. This field and
    // `.pool-new-input` declared the same nine declarations; both are
    // `<TextInput>` wearing `TEXT_INPUT_INLINE` now, and the floor is the
    // component's — shared with the three fields that were already its.
    expect(TEXT_INPUT).toContain('min-h-tap');
    expect(TEXT_INPUT).not.toContain('44px');
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

  it('.proj-released-toggle and .proj-released-archive are on the rendered Released (n) sub-fold', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const releasedFrom = { runId: 1, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt: 1, child: false };
    act(() => {
      store.setState({ conn: 'open', sessions: [sess({ id: 'r', project: 'alpha', workspace: 'done-one', releasedFrom })] });
    });
    const toggle = screen.getByRole('button', { name: /released \(1\)/i });
    expect(toggle).toHaveClass('proj-released-toggle');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Archive all 1 released workspace in alpha' })).toHaveClass('proj-released-archive');
  });

  it('keeps every floored rule on the token, never a bare 44px literal', () => {
    // The title no longer states a COUNT. It said "eighteen" while the list
    // below held twenty-one — a hand-kept number beside a list that grows,
    // which is the exact defect the box-token census (D-1156/D-1162) exists to
    // stop, found in this file by wave 6's own self-review. The list IS the
    // claim; a number restating its length is a second thing to keep in step
    // with it and buys nothing, so it is gone rather than corrected.
    // A literal would not follow `--tap-min` if the acceptance criterion ever
    // moves, and would not be found by the scrapes above either. Build 7 Task
    // 4 (`.mail-badge`), Task 5 (`.fleet-runs-row`, `.run-row`, `.run-open`),
    // Task 6 (`.mail-strip-head`),  — `.mail-back` and `.runs-back` left this
    // loop with the other three back chevrons when they became `BackButton`;
    // their floor is asserted against the component below,
    // Build 4 Task 12 (`.run-abandon`) and Task 13
    // join the same loop rather than getting their own — one place where
    // "every floored rule stays on the token" is checked, not a second copy
    // of the assertion per branch.
    for (const rule of [
       ruleIn(chatCss, '.reap-go'), ruleIn(chatCss, '.keycap--pr'),
      ruleIn(fleetCss, '.mail-badge'),
      ruleIn(fleetCss, '.run-row'), ruleIn(fleetCss, '.run-row .run-open'),
      ruleIn(fleetCss, '.run-row .run-abandon'),
      ruleIn(fleetCss, '.caps-input'), ruleIn(fleetCss, '.mail-chip'),
      ruleIn(fleetCss, '.proj-released-archive'),
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

// THE BACK CHEVRON'S FLOOR MOVED FROM A RULE TO A COMPONENT. All five
// `.*-back` rules became @ccrc/ui's `BackButton`, so there is no stylesheet
// rule left to scrape. The claim is unchanged and the chain is one link
// longer: `min-w-tap`/`min-h-tap` resolve through theme.css's
// `--spacing-tap: var(--tap-min)`, which `test/theme-bridge.test.ts` pins —
// so a utility that silently stopped resolving to the token would red there.
// The render half of each pair below is untouched: the hook class is still on
// the element, which is the half that proves the floor reaches real markup.
const backButton = readUi('primitives', 'back-button.tsx');

// AND SO DID FOUR QUIET CONTROLS. `.coord-toggle`, `.child-reclaim-toggle`,
// `.caps-save` and `.program-start-door` declared the same eleven
// declarations — three of them byte-identical — and are one cva variant now.
// Their floor is asserted against the composed class string rather than four
// rules, and the render half of each pair below is untouched: the hook class
// is still on the element, which is the half that proves the floor reaches
// real markup.
const QUIET = buttonVariants({ variant: 'quiet', size: 'fit' });
function expectQuietIsATarget(): void {
  expect(QUIET).toContain('min-h-tap');
  expect(QUIET).not.toContain('44px');
}

// AND SO DID THREE CONTROL ROWS. `.coord-banner`, `.child-reclaim-banner` and
// `.caps-control` declared the same twelve; what is left of each in fleet.css
// is the two-declaration ground its descendants are measured against, so the
// floor is read off `<ControlRow>` instead.
describe('the control row — one shape where three rules were', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(CONTROL_ROW).toContain('min-h-tap');
    expect(CONTROL_ROW).not.toContain('44px');
  });
  it('supplies no ground of its own — the consumer keeps that, for the audit', () => {
    // The split this component exists to hold. A `bg-*` creeping in here is
    // the change that would un-measure nine descendant rules in fleet.css,
    // silently, with every gate still green.
    expect(CONTROL_ROW).not.toMatch(/\bbg-/);
    expect(CONTROL_ROW).not.toMatch(/\btext-ink-/);
  });
});

describe('.mail-back — the feed’s back control', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(backButton).toContain('min-w-tap');
    expect(backButton).toContain('min-h-tap');
    // No bare literal, the same bind the scrape loop above applies to rules.
    expect(backButton).not.toContain('44px');
  });
  it('is the class the rendered control actually carries', () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('mail-back');
  });
});

// — Cross-repo wave 2, Task 8: the feed's programme filter chips —

describe('.mail-chip — the feed’s programme filter', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.mail-chip'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered chip actually carries — the All chip and a programme one alike', async () => {
    // `groups.size > 1` is what makes the filter row render at all — two
    // records naming two different runs, each resolved to its own programme.
    const events: NotifyEvent[] = [
      { seq: 1, at: Date.now() - 2000, kind: 'mail', sessionId: 'a', title: 'x', body: '', runId: 5 },
      { seq: 2, at: Date.now() - 1000, kind: 'mail', sessionId: 'b', title: 'y', body: '', runId: 6 },
    ];
    const runs = [
      { id: 5, program: 'build9b', programTitle: 'Build 9b' },
      { id: 6, program: 'crossrepo', programTitle: 'Cross-repo' },
    ] as unknown as RunSummary[];
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events })}
                        loadRuns={async () => ({ runs })} />);
    expect(await screen.findByRole('button', { name: 'Build 9b' })).toHaveClass('mail-chip');
    expect(screen.getByRole('button', { name: 'All' })).toHaveClass('mail-chip');
  });
});

// — Build 7, Task 5: the run board's footer door, back control and rows —

describe('.fleet-runs-row — the only door to /runs', () => {
  it('is at least one tap tall, off the shared token', () => {
    expectBareRowIsATarget();
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
    expect(backButton).toContain('min-h-tap');   // the same component .mail-back is
  });
  it('is the class the rendered control actually carries', () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
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
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    expect(screen.getByRole('button', { name: /clear-cove/i })).toHaveClass('run-open');
  });
});

// — Build 4, Task 11: the pause banner's own toggle —

describe('.coord-toggle — the pause banner’s own toggle', () => {
  it('is at least one tap tall, off the shared token', () => {
    expectQuietIsATarget();
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
    expectBareRowIsATarget();
  });
  it('is the class the rendered head control actually carries', () => {
    render(<MailStrip mail={[mailItem()]} />);
    expect(screen.getByRole('button', { expanded: false })).toHaveClass('mail-strip-head');
  });
});

// — Build 4, Task 12: the run row's own abandon control (spec §4.3, D-287 (was D-B4-14)) —

describe('.run-abandon — the wedge release, a sibling of .run-open', () => {
  it('is at least one tap tall AND wide, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.run-row .run-abandon'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.run-row .run-abandon'), 'min-width')).toBe('var(--tap-min)');
  });
  it('is the class the rendered row control actually carries', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    expect(screen.getByRole('button', { name: /abandon run 3/i })).toHaveClass('run-abandon');
  });
  // D-287's own reason for existing: an inert row (no session, so no
  // .run-open) still gets the control — that IS the wedge shape.
  it('is present on an inert row too, where .run-open is absent', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run({ sessionId: null, state: 'planned' })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    expect(screen.getByRole('button', { name: /abandon run 3/i })).toHaveClass('run-abandon');
  });
});

// — Build 4, Task 13: the run board's own door onto a new program, and the
// start-a-program sheet's own confirm control (spec §4.4) —

describe('.program-start-door — the only door onto a new program', () => {
  it('is at least one tap tall, off the shared token', () => {
    expectQuietIsATarget();
  });
  it('is the class the rendered footer control actually carries', () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    expect(screen.getByRole('button', { name: /start a program/i })).toHaveClass('program-start-door');
  });
});

describe('.program-start-go — the sheet’s own confirm control', () => {
  it('is at least one tap tall, off the shared token', () => {
    expectQuietIsATarget();
  });
  it('is the class the rendered confirm button actually carries', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [],
    });
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      openRunProjects={new Set<string>()}
      loadProjects={async () => ({ roots: [], projects: [{ name: 'ccrc-pwa', workdir: '/w' }] })} />);
    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));
    expect(await screen.findByRole('button', { name: /^start/i })).toHaveClass('program-start-go');
  });
});

// THE STRIP CHROME'S HEAD, ALL THREE AT ONCE — and a census rather than a
// third named control, because naming them one at a time is how two of them
// came to have no floor.
//
// `CollapsibleStrip` gives MailStrip, TaskStrip and HotFilesStrip one shape,
// and each keeps its own skin — which is cheap (no rule moved, so no gate key
// moved) and leaves the floor re-stated three times. It had already drifted
// when the chrome was extracted: `.mail-strip-head` floored at `--tap-min`,
// `.task-head` at `--sp-8` (32px, under the spec criterion, on the control that
// opens the plan) and `.hotfiles-head` at nothing at all, sizing to its content.
// The tests above cover controls one by one, by design, so none of them was in
// scope for any of it.
//
// Derived from one list, so a fourth strip is a one-line addition here and a
// red suite until it is made — not a silent fourth spelling.
describe('every strip head clears the tap floor — the whole chrome, not one control', () => {
  const HEADS: [string, string, string][] = [
    ['mail-strip.css', '.mail-strip .mail-strip-head', mailStripCss],
    ['task-strip.css', '.task-head', readUi('components', 'task-strip.css')],
    ['fleet.css', '.hotfiles-head', fleetCss],
  ];

  // THE FLOOR MOVED FROM THREE RULES TO ONE COMPONENT. All three heads
  // declared the same ten declarations — two of them inside the design system
  // itself — and `CollapsibleStrip` builds its head from `BARE_ROW` now. Each
  // sheet keeps only its ink, so there is no `min-height` left to scrape; what
  // each rule still proves is that the head's hook class reaches real markup,
  // which is the half a constant cannot show.
  it('floors at var(--tap-min), once, in the component all three share', () => {
    expect(BARE_ROW).toContain('min-h-tap');
    expect(BARE_ROW).not.toContain('44px');
    // AND THE COMPONENT ACTUALLY WEARS IT. Asserting the constant alone left
    // a measured hole: a mutation that stopped `CollapsibleStrip` composing
    // `BARE_ROW` kept every head's flex and padding, lost the floor, the
    // left-align and the ring, and nothing went red. The constant is half the
    // claim; this is the other half.
    const strip = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'primitives', 'collapsible-strip.tsx'),
      'utf8');
    expect(strip).toMatch(/cn\(\s*BARE_ROW/);
  });

  for (const [sheet, selector, css] of HEADS) {
    it(`${sheet} ${selector} is still a rule, carrying this strip's own voice`, () => {
      const rule = ruleIn(css, selector);
      expect(rule, `${selector} has no rule in ${sheet}`).not.toBeNull();
      // Its ink, or its refusal to set one — `.hotfiles-head` says `inherit`
      // twice where the other two name `--ink-primary`.
      expect(rule!).toMatch(/color:/);
    });
  }

  it('is every strip CollapsibleStrip builds, found by walking both packages', () => {
    // WALKS the tree rather than reading three named files. The first spelling
    // of this test read exactly the three consumers it already knew about, so
    // a fourth strip anywhere else left it green — measured, by planting a
    // `<CollapsibleStrip` in a fourth file and watching all 43 pass. A census
    // that cannot see a newcomer is not a census.
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.tsx') && !e.name.endsWith('.stories.tsx')) out.push(full);
      }
      return out;
    };
    const roots = [
      path.join(import.meta.dirname, '..', 'src'),
      path.join(import.meta.dirname, '..', '..', 'ui', 'src'),
    ];
    const consumers = roots
      .flatMap(walk)
      .filter((f) => /<CollapsibleStrip\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f))
      .sort();
    expect(consumers).toEqual(['HotFilesStrip.tsx', 'mail-strip.tsx', 'task-strip.tsx']);
    expect(consumers).toHaveLength(HEADS.length);
  });
});

// ── the floor is a token, and nothing may re-type it ───────────────────────
//
// This file's own header says the scrape must prove a rule is "written
// against the shared token rather than a literal `44px` that would not follow
// the token". SIX DECLARATIONS WERE LITERALS — `.sess-line`'s row floor and
// its actions column, `.sess-body`, `.sess-sheet .btn-ghost`,
// `.proj-card-toggle` and `.slash-item` — in rules this file does not scrape,
// so the drift it was built to stop had already happened five rules away from
// where it was looking.
//
// A LIST OF SCRAPES CANNOT CATCH THIS; a census can. `--tap-min` is 44px
// today, so every one of those rules rendered correctly and nothing looked
// wrong — which is exactly why it needed a mechanism rather than a reader:
// the day the token moves, a literal stays behind and the control silently
// stops meeting the floor it was written for.
//
// SIZE PROPERTIES ONLY. `tokens.css` defines the token itself, and its glow
// shadows carry a 44px BLUR that has nothing to do with a thumb; scoping to
// the properties where a tap floor is actually spelled keeps those out
// without an exemption list that would need maintaining.
//
// MEASURED, five mutations against the whole file (baseline 49 passed):
//
//   | mutation                                          | result |
//   |---------------------------------------------------|--------|
//   | one `var(--tap-min)` typed back as `44px`         | 1 red  |
//   | a `244px` column width                            | green  |
//   | `min-height: 44px` inside a COMMENT               | green  |
//   | the stylesheet walk returns nothing                | 1 red  |
//   | `grid-template-columns` dropped from SIZE_PROPS    | 1 red  |
//
// Rows two and three are the false positives this must NOT have. Rows four
// and five are holes that were open when this was first written: with
// `literals()` walking the sheets itself, emptying that walk left all 49
// green, and the property list could be narrowed past the very declaration
// the wave fixed. Both are closed by `reads the stylesheets at all`.
const SIZE_PROPS = [
  'height', 'min-height', 'max-height',
  'width', 'min-width', 'max-width',
  'block-size', 'min-block-size', 'inline-size', 'min-inline-size',
  'flex-basis', 'grid-template-columns', 'grid-template-rows',
  'grid-auto-rows', 'grid-auto-columns', 'inset',
];

describe('the tap floor is spelled as the token', () => {
  const UI_STYLES = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
  const SHEETS: [string, string][] = [
    ['pwa/src/fleet/fleet.css', read('fleet', 'fleet.css')],
    ['pwa/src/session/chat.css', read('session', 'chat.css')],
    ['pwa/src/styles/shell.css', read('styles', 'shell.css')],
    ['pwa/src/styles/base.css', read('styles', 'base.css')],
    ...readdirSync(UI_STYLES, { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'))
      .map((f): [string, string] => [
        `ui/src/${f}`, readFileSync(path.join(UI_STYLES, f), 'utf8'),
      ]),
  ];

  /** EVERY size declaration in every stylesheet, as `file:line prop: value`.
   *  One walk, so the census and the proof that it walked read the same list —
   *  measured: with `literals()` doing its own walk, emptying that walk left
   *  all 49 green. A guard whose evidence comes from a different loop than its
   *  verdict is a guard that can be switched off without going red. */
  const sizeDecls = (): string[] => {
    const out: string[] = [];
    for (const [name, src] of SHEETS) {
      stripComments(src).split('\n').forEach((line, i) => {
        const m = /^\s*([a-z-]+)\s*:\s*([^;]*)/.exec(line);
        if (m === null) return;
        const [, prop = '', value = ''] = m;
        if (!SIZE_PROPS.includes(prop)) return;
        out.push(`${name}:${i + 1} ${prop}: ${value.trim()}`);
      });
    }
    return out.sort();
  };

  /** The ones that type the floor out instead of naming it.
   *  `(?<![\d.])` so `244px` and `144px` are not 44px. */
  const literals = (): string[] =>
    sizeDecls().filter((d) => /(?<![\d.])44px/.test(d.slice(d.indexOf(': ') + 2)));

  it('finds no literal 44px in any size declaration', () => {
    expect(literals(), 'write var(--tap-min); a literal does not follow the token').toEqual([]);
  });

  it('reads the stylesheets at all', () => {
    // Without this the test above is green on an empty list for the wrong
    // reason — a renamed file, a changed path, a comment stripper that ate
    // everything, or a walk that stopped walking.
    expect(SHEETS.length).toBeGreaterThan(8);
    expect(sizeDecls().length).toBeGreaterThan(200);
    // And it reaches the rules this wave fixed, by PROPERTY as well as by
    // count — measured: dropping `grid-template-columns` from SIZE_PROPS left
    // all 49 green, and that property is where `.sess-line`'s actions column
    // spelled the floor.
    const named = sizeDecls().filter((d) => d.includes('var(--tap-min)'));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((d) => d.includes('grid-template-columns:'))).not.toEqual([]);
    expect(named.filter((d) => d.includes('min-height:')).length).toBeGreaterThan(8);
    // The token it is asking for still exists, with the value the six
    // replaced literals were spelling.
    const tokens = SHEETS.find(([n]) => n.endsWith('tokens.css'))?.[1] ?? '';
    expect(tokens).toMatch(/--tap-min:\s*44px/);
  });
});
