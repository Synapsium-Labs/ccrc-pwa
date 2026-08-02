import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, WsAudit } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { ReapSheet } from '../src/session/ReapSheet';

const audit = (over: Partial<WsAudit> = {}): WsAudit => ({
  id: 'demo-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/home/u/worktrees/custom-tools/quiet-basin',
  project: 'custom-tools', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
  dirty: [], ignored: [
    { path: 'node_modules/', bytes: 412_000_000, sensitive: false },
    { path: 'dist/', bytes: 8_000_000, sensitive: false },
    { path: '.ccrc/', bytes: 2_000, sensitive: false },
  ],
  ignoredCount: 3, ignoredBytes: 420_002_000, sensitive: [],
  clips: [{ name: 'paste-1.png', bytes: 3_800_000 }],
  stashes: 0,
  worktreeBytes: 1_200_000_000, commitsAheadOfBase: 3,
  pr: { number: 42, url: 'u', mergeCommit: '7a68ca0', headRefOid: 'deadbee' },
  merge: { proof: 'patch-id', fetchedAt: Math.floor(Date.now() / 1000) - 6 * 86_400 },
  transcript: '/t.jsonl', verdict: 'reapable', detail: '', token: 'a'.repeat(64), sentence: '', ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'custom-tools',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1, archivedBytes: null, ...over,
});

let auditBody: unknown;
let reapBody: unknown;
beforeEach(() => {
  auditBody = audit();
  reapBody = { reaped: 'demo-quiet-basin', branch: 'ws/quiet-basin', pr: 42, proof: 'patch-id',
    tombstone: '/t.json', attic: 17, bytes: 1_200_000_000, resumed: null, sentence: '' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = String(url).includes('/audit') ? auditBody : reapBody;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = (onReaped = (): void => {}) =>
  render(<><ToastHost /><ReapSheet session={sess()} open onClose={() => {}} onReaped={onReaped} /></>);

describe('the manifest', () => {
  it('names the branch, its proof rung and how long ago it merged', async () => {
    open();
    expect(await screen.findByText(/ws\/quiet-basin — merged in #42 \(proof: patch-id\), 6 days ago/)).toBeInTheDocument();
  });

  it('shows the worktree path and size, and the uncommitted row', async () => {
    // The path exactly, not /quiet-basin/: the slug appears in the sheet
    // title, the branch row and the button too, and a loose regex would match
    // four nodes and throw.
    open();
    expect(await screen.findByText('/home/u/worktrees/custom-tools/quiet-basin')).toBeInTheDocument();
    expect(screen.getByText('1.2 GB')).toBeInTheDocument();
    expect(screen.getByText('uncommitted')).toBeInTheDocument();
    // Two rows legitimately read `none`: uncommitted and stashes.
    expect(screen.getAllByText('none')).toHaveLength(2);
  });

  it('names the ignored entries with a total that is never truncated', async () => {
    open();
    expect(await screen.findByText(/3 entries, 420 MB/)).toBeInTheDocument();
    expect(screen.getByText(/node_modules\/ · dist\/ · .ccrc\//)).toBeInTheDocument();
    expect(screen.getByText(/These are in no commit and cannot be recovered\./)).toBeInTheDocument();
  });

  it('says what is KEPT — the transcript and the attic', async () => {
    open();
    expect(await screen.findByText(/transcript, and .* pinned in the attic \(ccd ws-attic\)/)).toBeInTheDocument();
  });
});

describe('the confirm', () => {
  it('carries the byte count and the literal slug on the primary button', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' })).toBeInTheDocument();
  });

  it('sends the audit token back as expect', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await waitFor(() => {
      const post = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
        .find((c) => String(c[0]).includes('/reap'))!;
      expect(JSON.parse(String(post[1].body))).toEqual({ expect: 'a'.repeat(64) });
    });
  });

  it('reports what survived, then hands control back', async () => {
    const onReaped = vi.fn();
    open(onReaped);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await waitFor(() => expect(onReaped).toHaveBeenCalled());
  });
});

describe('refusals', () => {
  it('offers no confirm at all when the verdict is not reapable', async () => {
    auditBody = audit({ verdict: 'tree-differs', token: undefined,
      sentence: 'GitHub reports PR #42 merged, but ccrc cannot prove this branch’s work is in the merge (checked: ancestor, tree, patch-id, cherry). Not removing anything.' });
    open();
    expect(await screen.findByText(/cannot prove this branch’s work is in the merge/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    // There is no override anywhere in ccrc.
    expect(screen.queryByRole('button', { name: /remove anyway|force|override/i })).not.toBeInTheDocument();
  });

  it('offers Copy paths — and only that — on sensitive-ignored', async () => {
    auditBody = audit({ verdict: 'sensitive-ignored', token: undefined, sensitive: ['.env', 'config/id_rsa'],
      sentence: 'There are secret-shaped files here that are in no commit and cannot be recovered. Move them out, then try again — there is no override.' });
    open();
    expect(await screen.findByText(/\.env/)).toBeInTheDocument();
    expect(screen.getByText('config/id_rsa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy paths/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('renders a mid-flight refusal from the reap itself, and re-audits', async () => {
    reapBody = { refused: 'state-changed', detail: 'expected x', paths: [],
      sentence: 'This workspace changed since the list you were shown — nothing was removed.' };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    expect(await screen.findByText(/changed since the list you were shown/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-check/i })).toBeInTheDocument();
  });

  it('says ccrc lost contact on indeterminate, and never claims failure', async () => {
    reapBody = { indeterminate: true, sentence: 'ccrc lost contact while cleaning up. Re-open the workspace to see its state.' };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    expect(await screen.findByText(/lost contact while cleaning up/)).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it('explains a breadcrumb instead of certifying an empty workspace', async () => {
    auditBody = audit({ exists: false, reaping: 'branch', verdict: 'worktree-missing', token: undefined,
      sentence: 'The worktree is already gone; the branch and the registry entry are still here. `ccd ws-attic` lists the commits ccrc pinned.' });
    open();
    expect(await screen.findByText(/cleanup stopped part-way \(branch\)/i)).toBeInTheDocument();
  });

  it('never hands control back on a mid-flight refusal', async () => {
    reapBody = { refused: 'state-changed', detail: 'expected x', paths: [],
      sentence: 'This workspace changed since the list you were shown — nothing was removed.' };
    const onReaped = vi.fn();
    open(onReaped);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await screen.findByText(/changed since the list you were shown/);
    expect(onReaped).not.toHaveBeenCalled();
  });

  it('never hands control back on indeterminate either', async () => {
    reapBody = { indeterminate: true, sentence: 'ccrc lost contact while cleaning up. Re-open the workspace to see its state.' };
    const onReaped = vi.fn();
    open(onReaped);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await screen.findByText(/lost contact while cleaning up/);
    expect(onReaped).not.toHaveBeenCalled();
  });
});

// Task 17 whole-diff mutation sweep: each test below pins a property the
// brief's own tests above never exercised — a distinct value on one row, an
// untaken branch, a button's actual argument, a state mid-flight. Named for
// what it closes, same convention as PrSheet.tsx's own sweep (Task 16).
describe('mutation-sweep closures', () => {
  it('formats sub-kB, kB and the kB/MB boundary distinctly — not just the MB/GB this sheet already shows', async () => {
    auditBody = audit({ worktreeBytes: 500 });
    open();
    expect(await screen.findByText('500 B')).toBeInTheDocument();
    cleanup();

    auditBody = audit({ worktreeBytes: 1_000 });
    open();
    expect(await screen.findByText('1 kB')).toBeInTheDocument();
    cleanup();

    // Exactly the >= 1e6 boundary: a `>` mutant falls through to kB (999 kB
    // rounds to 1000 kB) instead of the MB branch.
    auditBody = audit({ worktreeBytes: 1_000_000 });
    open();
    expect(await screen.findByText('1 MB')).toBeInTheDocument();
    cleanup();

    // Exactly the >= 1e9 boundary: a `>` mutant falls through to MB (1000 MB)
    // instead of the GB branch.
    auditBody = audit({ worktreeBytes: 1_000_000_000 });
    open();
    expect(await screen.findByText('1.0 GB')).toBeInTheDocument();
  });

  it('says "today" at the merge-age boundary, not "0 days ago"', async () => {
    auditBody = audit({ merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) } });
    open();
    expect(await screen.findByText(/ws\/quiet-basin — merged in #42 \(proof: ancestor\), today/)).toBeInTheDocument();
  });

  it('counts uncommitted files instead of collapsing them to "none"', async () => {
    auditBody = audit({ dirty: ['a.ts', 'b.ts'] });
    open();
    expect(await screen.findByText('2 files')).toBeInTheDocument();
    // Only stashes reads `none` now — uncommitted no longer does.
    expect(screen.getAllByText('none')).toHaveLength(1);
  });

  it('truncates past 3 ignored entries and un-truncates on "show all", without ever truncating the count or total', async () => {
    auditBody = audit({
      ignored: [
        { path: 'node_modules/', bytes: 1, sensitive: false },
        { path: 'dist/', bytes: 1, sensitive: false },
        { path: '.ccrc/', bytes: 1, sensitive: false },
        { path: 'coverage/', bytes: 1, sensitive: false },
        { path: 'tmp/', bytes: 1, sensitive: false },
      ],
      ignoredCount: 5, ignoredBytes: 5,
    });
    open();
    expect(await screen.findByText(/5 entries, 5 B/)).toBeInTheDocument();
    expect(screen.getByText('node_modules/ · dist/ · .ccrc/')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'show all' });
    fireEvent.click(toggle);
    expect(screen.getByText('node_modules/ · dist/ · .ccrc/ · coverage/ · tmp/')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'show fewer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'show fewer' }));
    expect(screen.getByText('node_modules/ · dist/ · .ccrc/')).toBeInTheDocument();
  });

  it('reads `none` with no clips, and pluralizes both the count and the recovery note past one', async () => {
    auditBody = audit({ clips: [] });
    open();
    // uncommitted, stashes AND clips all read `none` now.
    expect(await screen.findByText('1.2 GB')).toBeInTheDocument();
    expect(screen.getAllByText('none')).toHaveLength(3);
    expect(screen.queryByText(/pasted image/)).not.toBeInTheDocument();
    cleanup();

    auditBody = audit({ clips: [{ name: 'a.png', bytes: 1_000_000 }, { name: 'b.png', bytes: 2_000_000 }] });
    open();
    expect(await screen.findByText('2 pasted images, 3 MB')).toBeInTheDocument();
    expect(screen.getByText('These pastes are in no commit and cannot be recovered.')).toBeInTheDocument();
  });

  it('counts stashes instead of collapsing them to "none"', async () => {
    auditBody = audit({ stashes: 4 });
    open();
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('disables the primary button the instant a reap is in flight, and it is gone once one lands', async () => {
    let resolveReap!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/audit')) {
        return new Response(JSON.stringify(auditBody), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Promise<Response>((resolve) => { resolveReap = resolve; });
    }));
    open();
    const btn = await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolveReap(new Response(JSON.stringify(reapBody), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument());
  });

  it('Copy paths copies exactly the sensitive paths, newline-joined — nothing more, nothing less', async () => {
    auditBody = audit({ verdict: 'sensitive-ignored', token: undefined, sensitive: ['.env', 'config/id_rsa'],
      sentence: 'x' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();
    fireEvent.click(await screen.findByRole('button', { name: /copy paths/i }));
    expect(writeText).toHaveBeenCalledWith('.env\nconfig/id_rsa');
    expect(await screen.findByText('Paths copied')).toBeInTheDocument();
    // 'info', not 'error' — text alone doesn't pin the toast KIND, and a
    // vaul Sheet marks ToastHost aria-hidden while open (see the
    // network-failure tests below), so this reaches the class directly.
    await waitFor(() => expect(document.querySelector('.toast--error')).toBeNull());
  });

  it('shows no refusal paragraph at all when the verdict is reapable', async () => {
    const { container } = open();
    await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' });
    expect(container.querySelector('.reap-refusal')).toBeNull();
  });

  it('replaces the pre-reap commit count with the reap result’s own attic figure once it lands — even when that figure is zero', async () => {
    reapBody = { ...(reapBody as Record<string, unknown>), attic: 0 };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    expect(await screen.findByText(/transcript, and 0 commits pinned in the attic/)).toBeInTheDocument();
    // Not the pre-reap 3 from `audit.commitsAheadOfBase` — a `??` -> `||`
    // mutant falls back to it because 0 is falsy.
    expect(screen.queryByText(/transcript, and 3 commits pinned in the attic/)).not.toBeInTheDocument();
  });

  it('renders nothing for a null session, even while "open" — the defensive path a stale id can reach', () => {
    const { container } = render(
      <ReapSheet session={null} open onClose={() => {}} onReaped={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders PR #0 rather than the "unknown" placeholder — 0 is a real number, not absence', async () => {
    // `audit.pr.number ?? '?'`: the fallback is for `null` (no PR resolved),
    // not for a falsy NUMBER. A `??` -> `||` mutant cannot be distinguished
    // by #42 (truthy) — only by a PR numbered 0.
    auditBody = audit({ pr: { number: 0, url: 'u', mergeCommit: '7a68ca0', headRefOid: 'deadbee' } });
    open();
    expect(await screen.findByText(/merged in #0 \(proof: patch-id\)/)).toBeInTheDocument();
  });

  it('uses the empty-string workspace as the slug rather than falling back to the id', async () => {
    // `session.workspace ?? session.id`: the type is `string | null`, and
    // `??` only falls back on `null` — not on a workspace name that happens
    // to be falsy. `''` is unrealistic from ccd's real slug generator, but
    // the type does not forbid it, and a `??` -> `||` mutant is otherwise
    // indistinguishable from every fixture above (all use a truthy slug).
    render(<ReapSheet session={sess({ workspace: '' })} open onClose={() => {}} onReaped={() => {}} />);
    // The accessible-name computation collapses the double space from the
    // empty slug down to one — the DOM text itself still reads `Remove  ·`.
    expect(await screen.findByRole('button', { name: 'Remove · 1.2 GB' })).toBeInTheDocument();
  });

  it('rounds merge age DOWN, not to the nearest day', async () => {
    // Every other test's `fetchedAt` is an exact multiple of 86 400s, where
    // floor and ceil agree. 6.5 days out, they diverge: floor says "6 days
    // ago" (still true), ceil would say "7" (not true yet).
    auditBody = audit({ merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) - 6.5 * 86_400 } });
    open();
    expect(await screen.findByText(/ws\/quiet-basin — merged in #42 \(proof: ancestor\), 6 days ago/)).toBeInTheDocument();
  });

  it('never offers "show all" at exactly 3 ignored entries — only past it', async () => {
    open();
    await screen.findByText(/3 entries, 420 MB/);
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });

  it('offers no Copy paths when a refusal carries nothing sensitive to move', async () => {
    auditBody = audit({ verdict: 'tree-differs', token: undefined, sensitive: [],
      sentence: 'GitHub reports PR #42 merged, but ccrc cannot prove this branch’s work is in the merge.' });
    open();
    await screen.findByText(/cannot prove this branch’s work is in the merge/);
    expect(screen.queryByRole('button', { name: /copy paths/i })).not.toBeInTheDocument();
  });

  it('shows no refusal paragraph and no Re-check after a clean success — only what survived, silently', async () => {
    const { container } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument());
    expect(container.querySelector('.reap-refusal')).toBeNull();
    expect(screen.queryByRole('button', { name: /re-check/i })).not.toBeInTheDocument();
  });

  it('offers no Re-check on indeterminate — only the sentence', async () => {
    reapBody = { indeterminate: true, sentence: 'ccrc lost contact while cleaning up. Re-open the workspace to see its state.' };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await screen.findByText(/lost contact while cleaning up/);
    expect(screen.queryByRole('button', { name: /re-check/i })).not.toBeInTheDocument();
  });

  it('re-enables the button and toasts an ERROR-kind alert after a network failure — busy never sticks', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/audit')) {
        return new Response(JSON.stringify(auditBody), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('network down');
    }));
    open();
    const btn = await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    // A vaul Sheet marks its siblings aria-hidden while open, so
    // `getByRole('alert')` cannot see ToastHost's rendered toast here — the
    // class carries the same kind-pin the role would (Toast.tsx: `role`
    // and `.toast--error` are set from the identical `item.kind === 'error'`
    // check), reached directly rather than through the accessibility tree.
    await waitFor(() => expect(document.querySelector('.toast--error')).toHaveTextContent('network down'));
  });

  it('toasts an ERROR-kind alert, not a quiet info note, when the audit itself fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<><ToastHost /><ReapSheet session={sess()} open onClose={() => {}} onReaped={() => {}} /></>);
    await waitFor(() => expect(document.querySelector('.toast--error')).toHaveTextContent('offline'));
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });
});

// Pre-merge fix round, finding 17-F1: `load()` cleared `result` but never
// `audit`, so while a fresh audit is in flight the sheet kept rendering the
// PREVIOUS audit — and its token. Two demonstrated consequences: Re-check
// re-posting the stale token (here), and FleetScreen showing one session's
// name/size next to another's path when the reap target switches
// (fleet-screen.test.tsx). Fixed by one line: `setAudit(null)` in `load()`.
describe('stale state (17-F1)', () => {
  it('does not resurrect the stale token’s Remove button while Re-check’s fresh audit is still in flight', async () => {
    const auditBody = audit();
    const freshAudit = audit({ token: 'b'.repeat(64) });
    let resolveSecondAudit!: (r: Response) => void;
    let auditCalls = 0;
    const reapCalls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/audit')) {
        auditCalls += 1;
        if (auditCalls === 1) {
          return new Response(JSON.stringify(auditBody), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        // The Re-check audit deliberately never resolves during this test —
        // it is the window in which the stale audit must NOT be rendered.
        return new Promise<Response>((resolve) => { resolveSecondAudit = resolve; });
      }
      reapCalls.push(init?.body);
      return new Response(JSON.stringify({
        refused: 'state-changed', detail: 'x', paths: [],
        sentence: 'This workspace changed since the list you were shown — nothing was removed.',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await screen.findByRole('button', { name: /re-check/i });
    expect(JSON.parse(String(reapCalls[0]))).toEqual({ expect: 'a'.repeat(64) });

    fireEvent.click(screen.getByRole('button', { name: /re-check/i }));
    // Before the fix: `load()` cleared only `result`, so
    // `audit.verdict === 'reapable' && result === null` re-armed the primary
    // button on THIS render, using the STALE audit — token 'a'.repeat(64) —
    // before the fresh fetch above ever resolves.
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText('Checking…')).toBeInTheDocument();

    resolveSecondAudit(new Response(JSON.stringify(freshAudit), { status: 200, headers: { 'content-type': 'application/json' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove quiet-basin · 1.2 GB' }));
    await waitFor(() => expect(reapCalls).toHaveLength(2));
    // The second POST carries the FRESH token, never the one Re-check set
    // out to invalidate.
    expect(JSON.parse(String(reapCalls[1]))).toEqual({ expect: 'b'.repeat(64) });
  });
});
