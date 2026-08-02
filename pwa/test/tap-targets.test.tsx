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
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetSession, PrState, WsAudit } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { ArchiveScreen } from '../src/screens/ArchiveScreen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { PrKeycap } from '../src/session/PrKeycap';
import { PrSheet } from '../src/session/PrSheet';
import { ReapSheet } from '../src/session/ReapSheet';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');
const fleetCss = read('fleet', 'fleet.css');
const chatCss = read('session', 'chat.css');
const tokensCss = read('styles', 'tokens.css');

/** The declarations of the first rule whose selector list starts with `sel`,
 *  tolerating leading indentation. Same shape as fleet-css.test.ts's. */
function ruleIn(text: string, sel: string): string {
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\n[ \\t]*${escaped}[ \\t]*\\{`).exec(text);
  if (m === null) throw new Error(`no rule for ${sel}`);
  const brace = text.indexOf('{', m.index);
  return text.slice(brace + 1, text.indexOf('}', brace));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// — fixtures —

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'custom-tools',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: null, archivedBytes: null, ...over,
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
  transcript: '/t.jsonl', verdict: 'reapable', detail: '', token: 'q'.repeat(64), sentence: '',
};

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless. */
const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

// — the token itself —

describe('the tap-target token', () => {
  it('is the 44px acceptance criterion, so every rule below inherits it from one place', () => {
    expect(tokensCss).toContain('--tap-min:   44px;');
  });
});

// — the four rules the gates review found uncovered —

describe('.fleet-archived-row — the fleet footer route into the archive', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(ruleIn(fleetCss, '.fleet-archived-row')).toContain('min-height: var(--tap-min)');
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
    const row = screen.getByRole('button', { name: /archived · 1 · 1\.2 gb/i });
    expect(row).toHaveClass('fleet-archived-row');
  });
});

describe('.archive-row — every row on the archive screen', () => {
  it('is at least one tap tall, off the shared token', () => {
    expect(ruleIn(fleetCss, '.archive-row')).toContain('min-height: var(--tap-min)');
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
    expect(ruleIn(chatCss, '.pr-title-input')).toContain('min-height: var(--tap-min)');
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
    expect(ruleIn(chatCss, '.reap-go')).toContain('min-height: var(--tap-min)');
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
          sess({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100 }),
          sess({ id: 'b', project: 'alpha', workspace: 'live-one', archivedAt: null }),
        ],
      });
    });
    expect(screen.getByRole('button', { name: /archived \(1\)/i })).toHaveClass('proj-archived-toggle');
  });

  it('keeps every one of the six on the token, never a bare 44px literal', () => {
    // A literal would not follow `--tap-min` if the acceptance criterion ever
    // moves, and would not be found by the scrapes above either.
    for (const rule of [
      ruleIn(fleetCss, '.fleet-archived-row'), ruleIn(fleetCss, '.archive-row'),
      ruleIn(fleetCss, '.proj-archived-toggle'), ruleIn(chatCss, '.pr-title-input'),
      ruleIn(chatCss, '.reap-go'), ruleIn(chatCss, '.keycap--pr'),
    ]) {
      expect(rule).not.toContain('44px');
      expect(rule).toContain('var(--tap-min)');
    }
  });
});
