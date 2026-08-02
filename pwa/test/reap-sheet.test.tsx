import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
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
  ignoredCount: 3, ignoredBytes: 420_002_000, sensitive: [], sensitiveFiltered: 0,
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

/** A fetch stub that hands back a resolver per URL substring instead of a
 *  value, so a test can choose the ORDER two in-flight audits land in. */
const deferredFetch = (): {
  resolve: (match: string, body: unknown) => void;
  reject: (match: string, message: string) => void;
  posts: (string | undefined)[];
} => {
  const pending = new Map<string, { ok: (r: Response) => void; no: (e: Error) => void }>();
  const posts: (string | undefined)[] = [];
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes('/audit')) { posts.push(init?.body === undefined ? undefined : String(init.body)); return json(reapBody); }
    return new Promise<Response>((ok, no) => { pending.set(u, { ok, no: no as (e: Error) => void }); });
  }));
  const take = (match: string): { ok: (r: Response) => void; no: (e: Error) => void } => {
    const hit = [...pending.entries()].find(([u]) => u.includes(match));
    if (hit === undefined) throw new Error(`no in-flight audit for ${match}`);
    pending.delete(hit[0]);
    return hit[1];
  };
  return {
    resolve: (match, body) => { take(match).ok(json(body)); },
    reject: (match, message) => { take(match).no(new Error(message)); },
    posts,
  };
};

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

  // F3 refinement (pre-merge fix round): excluded must never mean invisible.
  it('names how many secret-shaped matches the F3 refinement filtered as noise, pluralized', async () => {
    auditBody = audit({ sensitiveFiltered: 1 });
    open();
    expect(await screen.findByText('1 secret-shaped match filtered as vendored/template.')).toBeInTheDocument();
    cleanup();

    auditBody = audit({ sensitiveFiltered: 4 });
    open();
    expect(await screen.findByText('4 secret-shaped matches filtered as vendored/template.')).toBeInTheDocument();
  });

  it('shows no filtered-noise note at all when nothing was filtered', async () => {
    open();
    // Wait for the audit to actually land — checking synchronously right
    // after open() would still be in the "Checking…" state, where the note
    // is trivially absent regardless of whether the `> 0` guard is real.
    await screen.findByText(/3 entries, 420 MB/);
    expect(screen.queryByText(/filtered as vendored\/template/)).not.toBeInTheDocument();
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

  // Pre-merge fix round, finding F: `worktreeBytes` is `number | null` on the
  // wire now — `du` failing to fully read the worktree must not hand this
  // sheet a number to print, in the row OR on the confirm button, which is
  // the one figure the whole design exists to protect.
  it('says "unknown", never a number, when worktreeBytes is null — row and confirm button both', async () => {
    auditBody = audit({ worktreeBytes: null });
    open();
    expect(await screen.findByText('unknown')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove quiet-basin · unknown size' })).toBeInTheDocument();
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

// Final-round finding F2 (destructive review). 17-F1 closed the SYNCHRONOUS
// half of the stale-audit defect. The asynchronous half survived: two audits
// can be in flight at once, and before the generation guard whichever RESOLVED
// LAST won. With a slow audit for the PREVIOUS session, the reader was shown a
// confirmation whose title, header and button named one workspace and whose
// every measured row — path, size, ignored entries, clips — and whose TOKEN
// described another. ccd's own `id=$1` in `_ws_fingerprint` means nothing is
// destroyed, but "the human saw what would be destroyed before authorising it"
// is the entire safety model of this branch, and this broke it.
describe('out-of-order audits (final-round F2)', () => {
  const alphaSess = sess({ id: 'demo-alpha', workspace: 'alpha' });
  const bravoSess = sess({ id: 'demo-bravo', workspace: 'bravo' });
  const alphaAudit = audit({ id: 'demo-alpha', branch: 'ws/alpha', workdir: '/w/alpha',
    worktreeBytes: 1_200_000_000, token: 'a'.repeat(64) });
  const bravoAudit = audit({ id: 'demo-bravo', branch: 'ws/bravo', workdir: '/w/bravo',
    worktreeBytes: 500_000_000, token: 'b'.repeat(64) });

  const mount = (s: FleetSession): ReturnType<typeof render> =>
    render(<><ToastHost /><ReapSheet session={s} open onClose={() => {}} onReaped={() => {}} /></>);
  const swap = (rerender: (ui: ReactElement) => void, s: FleetSession): void =>
    rerender(<><ToastHost /><ReapSheet session={s} open onClose={() => {}} onReaped={() => {}} /></>);

  it('drops the previous session’s audit when it lands after the current one — no row, no size, no token', async () => {
    const net = deferredFetch();
    const { rerender } = mount(alphaSess);
    swap(rerender, bravoSess);

    // The current target answers first…
    await act(async () => { net.resolve('demo-bravo', bravoAudit); });
    // …and only then does the superseded request for alpha come back.
    await act(async () => { net.resolve('demo-alpha', alphaAudit); });

    // Every fact on screen is bravo's, and they agree with each other.
    expect(await screen.findByRole('button', { name: 'Remove bravo · 500 MB' })).toBeInTheDocument();
    expect(screen.getByText('/w/bravo')).toBeInTheDocument();
    expect(screen.getByText(/ws\/bravo — merged in #42/)).toBeInTheDocument();
    // Before the guard: '/w/alpha', 'ws/alpha …' and '1.2 GB' rendered under
    // the heading "Remove bravo?" and beside the button "Remove bravo · 1.2 GB".
    expect(screen.queryByText('/w/alpha')).not.toBeInTheDocument();
    expect(screen.queryByText(/ws\/alpha/)).not.toBeInTheDocument();
    expect(screen.queryByText('1.2 GB')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove bravo · 1\.2 GB$/ })).not.toBeInTheDocument();

    // And the token the confirm posts is the one that was measured for the
    // workspace the confirm names.
    fireEvent.click(screen.getByRole('button', { name: 'Remove bravo · 500 MB' }));
    await waitFor(() => expect(net.posts).toHaveLength(1));
    expect(JSON.parse(String(net.posts[0]))).toEqual({ expect: 'b'.repeat(64) });
  });

  it('does not toast a failure belonging to a workspace the reader already navigated away from', async () => {
    const net = deferredFetch();
    const { rerender } = mount(alphaSess);
    swap(rerender, bravoSess);

    await act(async () => { net.resolve('demo-bravo', bravoAudit); });
    await act(async () => { net.reject('demo-alpha', 'alpha audit died'); });

    await screen.findByRole('button', { name: 'Remove bravo · 500 MB' });
    expect(document.querySelector('.toast--error')).toBeNull();
    expect(screen.queryByText(/alpha audit died/)).not.toBeInTheDocument();
  });

  it('still renders — and still toasts — the CURRENT target’s own audit failure', async () => {
    // The guard must drop superseded responses, not all of them.
    const net = deferredFetch();
    mount(bravoSess);
    await act(async () => { net.reject('demo-bravo', 'bravo audit died'); });
    await waitFor(() => expect(document.querySelector('.toast--error')).toHaveTextContent('bravo audit died'));
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  // The second, independent gate. The generation guard reasons about ORDER;
  // this one does not have to: `WsAudit.id` is ccd's own first field and the
  // first line of the fingerprint the token hashes, so an audit that does not
  // name this session is not a description of it, whatever order it arrived
  // in. It also covers the window the generation guard structurally cannot —
  // `session` is `sessions.find(...) ?? null` at both call sites, so the fleet
  // can drop the target to null and bring a DIFFERENT one back, and that
  // render commits before the effect that would clear the old audit.
  it('refuses to describe a workspace the audit does not name — "Checking…", never the wrong facts', async () => {
    const net = deferredFetch();
    mount(bravoSess);
    // The response for bravo's URL, carrying alpha's measurements and token.
    await act(async () => { net.resolve('demo-bravo', alphaAudit); });
    expect(await screen.findByText('Checking…')).toBeInTheDocument();
    expect(screen.queryByText('/w/alpha')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('drops an audit that lands after the sheet closed, so re-opening never shows a pre-close measurement', async () => {
    const net = deferredFetch();
    const { rerender } = render(
      <><ToastHost /><ReapSheet session={bravoSess} open onClose={() => {}} onReaped={() => {}} /></>);
    // Close while the audit is in flight, then let it land.
    rerender(<><ToastHost /><ReapSheet session={bravoSess} open={false} onClose={() => {}} onReaped={() => {}} /></>);
    await act(async () => { net.resolve('demo-bravo', bravoAudit); });
    // Re-open: a fresh audit is issued, and until it lands the sheet says so
    // rather than resurrecting the one measured before the close.
    rerender(<><ToastHost /><ReapSheet session={bravoSess} open onClose={() => {}} onReaped={() => {}} /></>);
    expect(await screen.findByText('Checking…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

// Fix round 3, verifier P1/P2. F2 shipped the generation bump inside `load()`
// only, on the reasoning that the effect-cleanup bump would add nothing
// observable: "the only cases the cleanup would add are unmount and id ->
// null, neither of which is observable". `toast()` is the counter-example —
// it is a GLOBAL host that outlives this sheet's own render, so a failure
// belonging to a sheet the reader has left is still a red banner on their
// screen, about a workspace check they are no longer looking at. The three
// cases below are the ones `load()`'s own bump structurally cannot reach:
// nothing calls `load()` when a sheet is dismissed, when the target leaves
// the fleet, or when the screen unmounts. Each fails with the cleanup removed
// from the effect in ReapSheet.tsx.
describe('audits outliving the sheet that asked for them (fix round 3, P1)', () => {
  const alphaSess = sess({ id: 'demo-alpha', workspace: 'alpha' });
  const view = (s: FleetSession | null, isOpen: boolean): ReactElement => (
    <><ToastHost /><ReapSheet session={s} open={isOpen} onClose={() => {}} onReaped={() => {}} /></>
  );

  it('does not toast a failure for a sheet the reader has already dismissed', async () => {
    const net = deferredFetch();
    const { rerender } = render(view(alphaSess, true));
    // The reader dismisses the sheet — FleetScreen sets reapOpen=false — while
    // alpha's audit is still in flight. It then fails.
    rerender(view(alphaSess, false));
    await act(async () => { net.reject('demo-alpha', 'alpha audit died'); });
    expect(document.querySelector('.toast--error')).toBeNull();
    expect(screen.queryByText(/alpha audit died/)).not.toBeInTheDocument();
  });

  it('does not toast a failure for a session that has left the fleet', async () => {
    const net = deferredFetch();
    const { rerender } = render(view(alphaSess, true));
    // `session` is `sessions.find((s) => s.id === reapId) ?? null` at both
    // call sites: when the sweep stops listing the workspace it goes null
    // under an open sheet.
    rerender(view(null, true));
    await act(async () => { net.reject('demo-alpha', 'alpha audit died'); });
    expect(document.querySelector('.toast--error')).toBeNull();
    expect(screen.queryByText(/alpha audit died/)).not.toBeInTheDocument();
  });

  it('does not toast a failure after the screen holding the sheet has unmounted', async () => {
    const net = deferredFetch();
    // The host is mounted SEPARATELY and outlives the sheet — the app shell's
    // arrangement (main.tsx renders one ToastHost above the router). A toast
    // fired with no host at all is dropped silently by Toast.tsx, so a test
    // that unmounted the host along with the sheet would pass with the guard
    // removed and prove nothing.
    render(<ToastHost />);
    const { unmount } = render(
      <ReapSheet session={alphaSess} open onClose={() => {}} onReaped={() => {}} />);
    unmount();
    await act(async () => { net.reject('demo-alpha', 'alpha audit died'); });
    expect(document.querySelector('.toast--error')).toBeNull();
    expect(screen.queryByText(/alpha audit died/)).not.toBeInTheDocument();
  });
});
