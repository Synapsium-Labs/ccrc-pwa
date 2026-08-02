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
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1, ...over,
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
});
