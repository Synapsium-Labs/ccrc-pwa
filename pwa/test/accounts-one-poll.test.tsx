// One `/api/accounts` poll per tab (Task C8, D-6440).
//
// The fleet store is the one reader of `GET /api/accounts`: its poll (one read at connect, then one every 20 s) and
// `refreshAccounts()` are the only calls. Every surface that shows an account (the lanes row, the `+`'s projected
// home, the Accounts screen, the pickers in the sheets) subscribes to what that read wrote. So the fleet screen makes
// three requests in a minute at every width and in both skins, however many strips it mounts, and a malformed answer
// leaves every surface's last good rows standing, by the store's one rule.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import type { AccountsResponse, AccountUsage } from '../../shared/api';
import { TEST_ROSTER } from './rosterFixture';
import { fleetSession } from './fleetFixture';
import { parseTs } from './literalWalker';

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { useAccountUsage, useProjectedHome } = await import('../src/fleet/useProjectedHome');

/** Every width query answered against one viewport width (refined-shell.test.tsx's stub). */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]))
      && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

const usage = (wrapper: string, five: number, seven: number): AccountUsage => ({
  wrapper, five, seven, ts: 1_700_000_000, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});

const ANSWER: AccountsResponse = {
  accounts: [usage('claude', 12, 30), usage('claude9', 40, 55)],
  projected: { wrapper: 'claude', score: 12 },
  roster: TEST_ROSTER,
} as AccountsResponse;

// Two sessions, so the fleet screen draws its project cards and the `+` that names the projected home.
const SESSIONS = [
  fleetSession({ id: 'lane-a-project-a', wrapper: 'claude', home: 'claude', project: 'project-a', bucket: 'attention' }),
  fleetSession({ id: 'project-a-quiet-basin', wrapper: 'claude', home: 'claude', project: 'project-a', workspace: 'quiet-basin' }),
];

let accountsCalls = 0;

/** A fetch that counts `/api/accounts` and answers it; every other route is a bare `{}`. */
function countingFetch(answer: () => unknown): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/accounts')) {
      accountsCalls += 1;
      return new Response(JSON.stringify(answer()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

beforeEach(() => {
  accountsCalls = 0;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  cleanup();
  act(() => { useFleetStore.getState().disconnect(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => { navigate('/'); });
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false }));
});

describe('one /api/accounts poll per tab (C8, D-6440)', () => {
  const cases: Array<[number, SkinId]> = [[390, REFINED], [1280, REFINED], [390, INSTRUMENT], [1280, INSTRUMENT]];
  it.each(cases)('the fleet screen makes 3 /api/accounts requests in 60 s at %i, in the %s skin', async (width, skin) => {
    atWidth(width);
    setSkin(skin);
    countingFetch(() => ANSWER);
    act(() => useFleetStore.setState({ conn: 'open', sessions: SESSIONS }));
    render(<App />);
    // 59 s: the reads at 0, 20 and 40 s, and not the one at 60.
    for (let s = 0; s < 59; s += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(accountsCalls).toBe(3);
  });
});

const SRC = path.join(import.meta.dirname, '..', 'src');

/** Every `.ts`/`.tsx` file under `pwa/src`, repo-relative. */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [path.relative(path.join(SRC, '..', '..'), full)] : [];
  });
}

describe('the one reader (C8, D-6440)', () => {
  it('no module but stores/fleet.ts calls api.accounts', () => {
    // An AST walk, not a text grep: a comment that names `api.accounts` is not a call, and a line that calls it is.
    const callers: string[] = [];
    for (const rel of sourceFiles()) {
      const src = parseTs(path.join(SRC, '..', '..', rel));
      const visit = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'accounts' && ts.isIdentifier(n.expression) && n.expression.text === 'api') {
          callers.push(rel);
        }
        ts.forEachChild(n, visit);
      };
      visit(src);
    }
    expect([...new Set(callers)]).toEqual(['pwa/src/stores/fleet.ts']);
  });

  it('a malformed answer leaves the strip\'s and the sheets\' last good rows standing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    atWidth(1280);
    setSkin(REFINED);
    let good = true;
    countingFetch(() => (good ? ANSWER : { accounts: 'nope', roster: 'nope', projected: 'nope' }));
    // What the sheets read: SwapSheet's and NewSessionSheet's `useAccountUsage`, AddWorkspaceSheet's and
    // StartProgramSheet's `useProjectedHome`, each with its sheet open.
    function SheetProbe(): ReactNode {
      const usage = useAccountUsage(true);
      const projected = useProjectedHome(true);
      return <output data-testid="probe">{`${usage === null ? 'none' : usage.map((u) => u.wrapper).join(',')}|${projected === undefined ? 'unasked' : projected === null ? 'null' : projected.wrapper}`}</output>;
    }
    render(<><App /><SheetProbe /></>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const lanes = (): number => document.querySelectorAll('.account-gauge').length;
    expect(lanes()).toBe(2);
    expect(screen.getByTestId('probe')).toHaveTextContent('claude,claude9|claude');
    good = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(accountsCalls, 'the malformed poll ran').toBeGreaterThanOrEqual(2);
    expect(lanes(), 'the strip keeps its cards').toBe(2);
    expect(screen.queryByText(/checking accounts…/i)).toBeNull();
    expect(screen.getByTestId('probe')).toHaveTextContent('claude,claude9|claude');
  });
});
