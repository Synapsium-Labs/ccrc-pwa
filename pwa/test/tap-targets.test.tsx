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
import { readFileSync } from 'node:fs';
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
import { MailStrip } from '../src/session/MailStrip';
import { PrKeycap } from '../src/session/PrKeycap';
import { PrSheet } from '../src/session/PrSheet';
import { ReapSheet } from '../src/session/ReapSheet';
import { RootFallback, ScreenFallback } from '../src/components/RenderBoundary';
import { DOCS_MAX_IMAGES_PER_PAGE, DOCS_RASTER_TYPES, type DocsProjectsResponse } from '../../shared/docs';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { DocsScreen } from '../src/screens/DocsScreen';
import { DocsFailureView } from '../src/docs/DocsFailureView';
import { DOC_MARKDOWN_ACTION } from '../src/docs/DocMarkdown';
import { DOC_IMAGE_TEXT, DOCS_BANNER_TEXT, DOCS_HEAD_TEXT, DOCS_VIEW_TEXT } from '../src/docs/docsText';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { SessionHeader } from '../src/session/SessionHeader';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { navigate } from '../src/lib/router';
import { draftOf, entry, failedAnswer, fakeLoaders, fileResponse, holder, okTree, treeOk, type FakeLoaders } from './docsFixtures';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');
const fleetCss = read('fleet', 'fleet.css');
const chatCss = read('session', 'chat.css');
const tokensCss = read('styles', 'tokens.css');
const docsCss = read('docs', 'docs.css');

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
      ruleIn(fleetCss, '.child-reclaim-banner'), ruleIn(fleetCss, '.child-reclaim-toggle'),
      ruleIn(fleetCss, '.run-row .run-abandon'),
      ruleIn(fleetCss, '.program-start-door'), ruleIn(fleetCss, '.program-start-go'),
      ruleIn(fleetCss, '.caps-control'), ruleIn(fleetCss, '.caps-save'),
      ruleIn(fleetCss, '.caps-input'), ruleIn(fleetCss, '.mail-chip'),
      ruleIn(fleetCss, '.proj-released-toggle'), ruleIn(fleetCss, '.proj-released-archive'),
      ruleIn(docsCss, '.docs-door'), ruleIn(docsCss, '.docs-back'), ruleIn(docsCss, '.docs-crumb'),
      ruleIn(docsCss, '.docs-row'), ruleIn(docsCss, '.docs-fresh'), ruleIn(docsCss, '.docs-copy'),
      ruleIn(docsCss, '.docs-action'), ruleIn(docsCss, '.docs-filter'), ruleIn(docsCss, '.docs-nodocs > summary'),
      ruleIn(docsCss, '.btn-ghost.docs-banner-action'), ruleIn(docsCss, '.doc-img-link'),
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
    expect(declValue(ruleIn(fleetCss, '.program-start-door'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered footer control actually carries', () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
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
      openRunProjects={new Set<string>()}
      loadProjects={async () => ({ roots: [], projects: [{ name: 'ccrc-pwa', workdir: '/w' }] })} />);
    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));
    expect(await screen.findByRole('button', { name: /^start/i })).toHaveClass('program-start-go');
  });
});

// — native Docs reader, W4 Task 8: the two RenderBoundary fallbacks' buttons (Reload, Back to the fleet) —
//
// Both are `.btn-primary`, whose own rule (components/primitives.css) carries the floor; `.render-fallback
// .btn-primary` (styles/shell.css) gives the width back and must not lower the height.

describe('.render-fallback .btn-primary — the boundary fallbacks’ Reload and Back to the fleet', () => {
  const primitivesCss = read('components', 'primitives.css');
  const shellCss = read('styles', 'shell.css');

  it('is at least one tap tall, off the shared token, and the fallback rule does not lower it', () => {
    expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
    const local = ruleIn(shellCss, '.render-fallback .btn-primary');
    expect(declValue(local, 'min-height')).toBeNull();
    expect(declValue(local, 'height')).toBeNull();
    expect(declValue(local, 'max-height')).toBeNull();
  });

  it('is the class both rendered fallback buttons actually carry, inside .render-fallback', () => {
    render(<RootFallback reload={() => {}} />);
    const reload = screen.getByRole('button', { name: 'Reload' });
    expect(reload).toHaveClass('btn-primary');
    expect(reload.closest('.render-fallback')).not.toBeNull();
    cleanup();
    render(<ScreenFallback />);
    const back = screen.getByRole('button', { name: 'Back to the fleet' });
    expect(back).toHaveClass('btn-primary');
    expect(back.closest('.render-fallback')).not.toBeNull();
  });
});

// — native Docs reader W5 part 1, Task 11: the Docs door, the session links and the Docs screen's controls (spec
// 2026-10-01 4.8 and 4.14) —
//
// Both halves for each: the rule in docs/docs.css (or, for a control that rides a shared class, that class's own
// rule) holds `min-height: var(--tap-min)`, and a rendered element carries the class. The Docs screen renders with
// injected loaders and a parser that parses in this thread; nothing reaches a server. Placeholders only: project
// `demo`, branch `main`, `example-org/example-repo`, `https://a.example`.

const docsParser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** The Docs screen at `url`, as the app's docs arm mounts it. */
function openDocs(url: string, f: FakeLoaders, parser: MarkdownParser = docsParser): void {
  navigate(url);
  render(<DocsScreen path={location.pathname} search={location.search} loaders={f.loaders} parser={parser} />);
}

/** A markdown leaf `specs/a.md` whose text is `text`. */
function markdownLeaf(text: string, entries = [entry('specs', 'a.md')]): FakeLoaders {
  const r = fileResponse(text);
  return fakeLoaders({
    tree: okTree(treeOk({ entries })),
    file: { s: 'ok', value: { ...r, show: { ...r.show, size: text.length } } },
  });
}

const DOCS_INDEX: DocsProjectsResponse = {
  ok: true, cacheAgeMs: 0,
  index: {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [],
    projects: [
      { project: 'demo', state: 'ready', github: { state: 'none' },
        default: { name: 'main', via: 'default:origin-head', commit: 'a'.repeat(40) },
        sections: { specs: 1, plans: 1, 'product-design': 0, conventions: 0 } },
      { project: 'a', state: 'linked-worktree', github: { state: 'none' }, owner: 'demo', branch: 'main' },
      { project: 'b', state: 'ready', github: { state: 'none' },
        default: { name: 'main', via: 'default:origin-head', commit: 'b'.repeat(40) },
        sections: { specs: 0, plans: 0, 'product-design': 0, conventions: 0 } },
    ],
  },
};

const floorIn = (css: string, sel: string): string | null => declValue(ruleIn(css, sel), 'min-height');

describe('the Docs controls (docs W5 part 1, spec 4.14)', () => {
  afterEach(() => { history.replaceState(null, '', '/'); });

  describe('.docs-door — the fleet header’s door to /docs', () => {
    it('is at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-door')).toBe('var(--tap-min)');
    });
    it('is the class the rendered door actually carries', () => {
      render(<FleetScreen store={makeStore()} />);
      expect(screen.getByRole('button', { name: 'Docs: specs, plans and design notes' })).toHaveClass('docs-door');
    });
    it('reaches the main stylesheet: DocsScreen imports docs.css, and app.tsx imports DocsScreen statically', () => {
      // A text scan, NOT EXHAUSTIVE: a re-export, or a lazy import spelled another way, is not seen. The plan's build
      // check reads the BUILT index css for `.docs-door`, which is the proof; this pins the two imports it rests on.
      expect(read('screens', 'DocsScreen.tsx')).toMatch(/^import '\.\.\/docs\/docs\.css';$/m);
      expect(read('app.tsx')).toMatch(/^import \{ DocsScreen \} from '\.\/screens\/DocsScreen';$/m);
    });
  });

  describe('.docs-back, .docs-crumb and .docs-crumbs-more — the header’s way up', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-back')).toBe('var(--tap-min)');
      expect(declValue(ruleIn(docsCss, '.docs-back'), 'min-width')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-crumb')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-crumbs-more')).toBe('var(--tap-min)');
    });
    it('are the classes the rendered back button, crumb and … button carry (a phone folds the crumbs)', async () => {
      openDocs('/docs/demo/specs', fakeLoaders());
      expect(await screen.findByRole('button', { name: DOCS_HEAD_TEXT.back })).toHaveClass('docs-back');
      expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.crumbsMore })).toHaveClass('docs-crumbs-more');
      expect(screen.getByRole('link', { name: 'demo' })).toHaveClass('docs-crumb');
    });
  });

  describe('.docs-row and .docs-filter — every listing row, and the filter above it', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-row')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-filter')).toBe('var(--tap-min)');
    });
    it('are the classes a section’s rendered rows and filter carry', async () => {
      openDocs('/docs/demo/specs', fakeLoaders());
      const rows = await screen.findAllByRole('button', { name: /^a\.md|^b\.md/ });
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toHaveClass('docs-row');
      expect(screen.getByRole('searchbox', { name: DOCS_VIEW_TEXT.filterEntries })).toHaveClass('docs-filter');
    });
  });

  describe('the index: .docs-row, .docs-owner-link and the no-docs fold’s summary', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-owner-link')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-nodocs > summary')).toBe('var(--tap-min)');
    });
    it('are the classes the rendered index carries', async () => {
      const f = fakeLoaders();
      f.projects.mockResolvedValue({ s: 'ok', value: DOCS_INDEX });
      openDocs('/docs', f);
      expect(await screen.findByRole('button', { name: /^demo/ })).toHaveClass('docs-row');
      expect(screen.getByRole('link', { name: 'part of demo' })).toHaveClass('docs-owner-link');
      expect(document.querySelector('.docs-nodocs > summary')?.textContent).toBe('Projects with no docs (1)');
    });
  });

  describe('.docs-fresh, .docs-copy and .docs-action — the truth line’s chip, copy commit and View on GitHub', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-fresh')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-copy')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-action')).toBe('var(--tap-min)');
    });
    it('are the classes the rendered chip, copy button and GitHub link carry', async () => {
      openDocs('/docs/demo/specs', fakeLoaders());
      expect(await screen.findByRole('button', { name: /never fetched/ })).toHaveClass('docs-fresh');
      expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.copyCommit })).toHaveClass('docs-copy');
      expect(screen.getByRole('link', { name: DOCS_HEAD_TEXT.github })).toHaveClass('docs-action');
    });
  });

  describe('every banner action: .docs-banner-action (a btn-ghost) and .docs-hint-link', () => {
    it('are at least one tap tall, off the shared token, and the banner rule gives back only the width', () => {
      expect(floorIn(read('components', 'primitives.css'), '.btn-ghost')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.btn-ghost.docs-banner-action')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.docs-hint-link')).toBe('var(--tap-min)');
    });
    it('are the classes the rendered Retry and hint link carry', async () => {
      openDocs('/docs/demo/specs', fakeLoaders({
        tree: okTree(treeOk({ drafts: { state: 'unsettled', branch: 'main', worktree: '/repo/wt/a' } })),
      }));
      const retry = await screen.findByRole('button', { name: DOCS_BANNER_TEXT.retry });
      expect(retry).toHaveClass('btn-ghost', 'docs-banner-action');
      cleanup();
      openDocs('/docs/demo/specs', fakeLoaders({
        tree: okTree(treeOk({ drafts: holder(), entries: [entry('specs', 'a.md', { draft: draftOf('modified') })] })),
      }));
      expect(await screen.findByRole('link', { name: DOCS_VIEW_TEXT.openDraftView })).toHaveClass('docs-hint-link');
    });
  });

  describe('the failure view’s Retry and Fetch from origin (.docs-fail-action, a btn-ghost)', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(read('components', 'primitives.css'), '.btn-ghost')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.btn-ghost.docs-fail-action')).toBe('var(--tap-min)');
    });
    it('are the classes both rendered buttons carry', () => {
      render(<DocsFailureView answer={failedAnswer('unresolved-ref')} onFetchFromOrigin={() => {}} />);
      expect(screen.getByRole('button', { name: 'Fetch from origin' })).toHaveClass('btn-ghost', 'docs-fail-action');
      cleanup();
      render(<DocsFailureView answer={{ s: 'unreachable' }} onRetry={() => {}} />);
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('btn-ghost', 'docs-fail-action');
    });
  });

  describe('.docs-leaf-action — a leaf’s Source and Download', () => {
    it('is at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.docs-leaf-action')).toBe('var(--tap-min)');
    });
    it('is the class both rendered buttons of the html stand-in carry', async () => {
      const r = fileResponse('<p>a</p>');
      openDocs('/docs/demo/specs/x.html', fakeLoaders({
        tree: okTree(treeOk({ entries: [entry('specs', 'x.html')] })),
        file: { s: 'ok', value: { ...r, contentClass: 'html', show: { ...r.show, path: 'x.html' } } },
      }));
      expect(await screen.findByRole('button', { name: DOCS_VIEW_TEXT.source })).toHaveClass('docs-leaf-action');
      expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.download })).toHaveClass('docs-leaf-action');
    });
  });

  describe('.doc-gate-btn — the gate’s Format anyway and Show as text', () => {
    it('is at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.doc-gate-btn')).toBe('var(--tap-min)');
    });
    it('is the class both rendered choices carry', async () => {
      openDocs('/docs/demo/specs/a.md', markdownLeaf('a\n'.repeat(DOCS_RENDER_GATE_BYTES / 2 + 1)));
      expect(await screen.findByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway })).toHaveClass('doc-gate-btn');
      expect(screen.getByRole('button', { name: DOC_MARKDOWN_ACTION.showAsText })).toHaveClass('doc-gate-btn');
    });
  });

  describe('.doc-plain-action — the plain text’s Retry or Format anyway', () => {
    it('is at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.doc-plain-action')).toBe('var(--tap-min)');
    });
    it('is the class the rendered Retry carries when the worker failed', async () => {
      const failed: MarkdownParser = async () => ({ kind: 'worker-failed', error: 'Error' });
      openDocs('/docs/demo/specs/a.md', markdownLeaf('# A\n'), failed);
      expect(await screen.findByRole('button', { name: DOC_MARKDOWN_ACTION.retry })).toHaveClass('doc-plain-action');
    });
  });

  describe('.doc-img-load, .doc-img-action and .doc-img-link — Load image, Open image externally, and an image', () => {
    it('are at least one tap tall, off the shared token', () => {
      expect(floorIn(docsCss, '.doc-img-load')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.doc-img-action')).toBe('var(--tap-min)');
      expect(floorIn(docsCss, '.doc-img-link')).toBe('var(--tap-min)');
    });
    it('are the classes the rendered controls carry', async () => {
      const png = new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
      const images = Array.from({ length: DOCS_MAX_IMAGES_PER_PAGE + 1 }, (_, i) => `![i${i}](i.png)`).join('\n\n');
      const f = markdownLeaf(`${images}\n\n![e](https://a.example/x.png)\n`, [entry('specs', 'a.md'), entry('specs', 'i.png')]);
      f.raster.mockResolvedValue({ s: 'ok', value: { bytes: png, mime: 'image/png' } });
      openDocs('/docs/demo/specs/a.md', f);
      expect(await screen.findByRole('button', { name: DOC_IMAGE_TEXT.load })).toHaveClass('doc-img-load');
      expect(screen.getByRole('button', { name: DOC_IMAGE_TEXT.openExternal })).toHaveClass('doc-img-action');
      expect((await screen.findAllByRole('button', { name: 'i0' }))[0]).toHaveClass('doc-img-link');
    });
  });

  describe('the session links: the actions sheet’s row (a btn-ghost) and the session menu’s item (a menu-item)', () => {
    const session = sess({ project: 'demo', workspace: 'ws-old', branch: 'main' });
    it('ride the shared rules’ floors: .btn-ghost on the token, .menu-item at or above it', () => {
      expect(floorIn(read('components', 'primitives.css'), '.btn-ghost')).toBe('var(--tap-min)');
      // `.menu-item` (session/chat.css, which W5 does not edit) floors at 52px, above the 44px token; the Docs item
      // adds no rule that could lower it.
      const token = Number.parseFloat(declValue(ruleIn(tokensCss, ':root'), '--tap-min') ?? 'NaN');
      const menu = declValue(ruleIn(chatCss, '.menu-item'), 'min-height');
      expect(menu === 'var(--tap-min)' || Number.parseFloat(menu ?? 'NaN') >= token, String(menu)).toBe(true);
      // docs.css may carry OVERFLOW rules for the two (a long branch must not push the word off the row), but no rule
      // whose selector list names either class may declare a min-height: the floor stays the shared class's.
      const naming = stripComments(docsCss).split('}')
        .map((chunk) => chunk.split('{'))
        .filter(([sel]) => /\.docs-menu-item|\.docs-session-row/.test(sel ?? ''));
      expect(naming.length).toBeGreaterThan(0);
      for (const [sel, body] of naming) expect(body ?? '', sel).not.toMatch(/min-height/);
    });
    it('keep a long branch name on its own line: the hint truncates beside the word, the row label breaks (jsdom lays nothing out, so the declarations are pinned)', () => {
      // `.menu-hint` is `flex: none` in chat.css, so beside a 200-character branch the `.menu-label` ("Docs")
      // collapses; the Docs item's hint may shrink and ellipsise instead. The row's label is a bare text node in a
      // `display: flex` btn-ghost, which cannot break a branch with no space in it unless the row says it may.
      const hint = ruleIn(docsCss, '.docs-menu-item .menu-hint');
      expect(declValue(hint, 'flex')).toBe('0 1 auto');
      expect(declValue(hint, 'min-width')).toBe('0');
      expect(declValue(hint, 'overflow')).toBe('hidden');
      expect(declValue(hint, 'text-overflow')).toBe('ellipsis');
      expect(declValue(hint, 'white-space')).toBe('nowrap');
      const row = ruleIn(docsCss, '.docs-session-row');
      expect(declValue(row, 'overflow-wrap')).toBe('anywhere');
      expect(declValue(row, 'min-width')).toBe('0');
    });
    it('are the classes the rendered row and item carry', () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [], projected: null, roster: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } })));
      render(<SessionActionsSheet session={session} open onClose={() => {}} onReap={() => {}} />);
      expect(screen.getByRole('button', { name: 'Docs on main' })).toHaveClass('btn-ghost', 'docs-session-row');
      cleanup();
      render(<SessionHeader session={session} status="idle" statusUpdatedAt={null} onInterrupt={() => {}}
        onOpenTerminal={() => {}} onBack={() => {}} onChangeModel={() => {}} onChangeEffort={() => {}}
        onMoveAccount={() => {}} onArchive={() => {}} onRestore={() => {}} onOpenHistory={() => {}}
        onReapWorkspace={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('button', { name: 'Docs' })).toHaveClass('menu-item', 'docs-menu-item');
    });
  });
});
