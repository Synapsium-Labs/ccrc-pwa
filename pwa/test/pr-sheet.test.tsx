import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, PrState, PrView } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { PrSheet } from '../src/session/PrSheet';

const pr = (over: Partial<PrState> = {}): PrState => ({
  phase: 'none', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 3, reason: null, checkedAt: Date.now() - 60_000, mergedAt: null, retryAt: null, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: 'ws/quiet-basin', tasks: null, pr: pr(), archivedAt: null, ...over,
});

const view = (over: Partial<PrView> = {}): PrView => ({
  pr: pr(),
  draft: { title: 'the work', body: '## Commits\n\n- aaaaaaa the work\n' },
  facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'you/custom-tools', commits: 3, dirty: 0 },
  ...over,
});

let fetched: PrView;
beforeEach(() => {
  fetched = view();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/pr') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(fetched), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = (s: FleetSession = sess(), onReap = (): void => {}) =>
  render(<><ToastHost /><PrSheet session={s} open onClose={() => {}} onReap={onReap} /></>);

describe('opening the sheet refreshes', () => {
  it('fires one GET and shows the cached value meanwhile', async () => {
    open(sess({ pr: pr({ phase: 'merged', number: 42 }) }));
    expect(screen.getByText(/#42/)).toBeInTheDocument();
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => String(c[0]).endsWith('/pr'))).toBe(true));
  });
});

describe('unchecked', () => {
  it('says "not checked yet" and offers Check now — never "no PR"', async () => {
    fetched = view({ pr: pr({ phase: 'unchecked' }), draft: null, facts: null });
    open(sess({ pr: pr({ phase: 'unchecked' }) }));
    expect(await screen.findByText(/not checked yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/no pull request/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument();
  });
});

describe('no-commits', () => {
  it('disables Create and uses the reason as the disabled text', async () => {
    fetched = view({ pr: pr({ phase: 'no-commits', ahead: 0 }), draft: null });
    open(sess({ pr: pr({ phase: 'no-commits', ahead: 0 }) }));
    expect(await screen.findByText(/has no commits past/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open pull request/i })).toBeDisabled();
  });
});

describe('none — the composer', () => {
  it('prefills an editable single-line title and a READ-ONLY body preview', async () => {
    open();
    const title = await screen.findByLabelText(/title/i);
    expect(title).toHaveValue('the work');
    expect(title.tagName).toBe('INPUT');
    const body = screen.getByLabelText(/body preview/i);
    expect(body).toHaveAttribute('readonly');
  });

  it('shows the facts line', async () => {
    open();
    expect(await screen.findByText(/ws\/quiet-basin → main · you\/custom-tools · 3 commits/)).toBeInTheDocument();
  });

  it('warns about an uncommitted tree without blocking', async () => {
    fetched = view({ facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: 3, dirty: 2 } });
    open();
    expect(await screen.findByText(/2 files are not committed — they will not be in this PR/)).toBeInTheDocument();
  });

  it('says so when the tree could not be read, rather than saying nothing', async () => {
    // `dirty: null` is UNMEASURED (deviation 11) — the worktree could not be
    // corroborated as this workspace's, or its tree could not be read. The
    // advisory above is absent for `0` because there is genuinely nothing to
    // warn about; absent for `null` it would read as exactly that.
    fetched = view({ facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: 3, dirty: null } });
    open();
    expect(await screen.findByText(/could not read this worktree/i)).toBeInTheDocument();
    expect(screen.queryByText(/files are not committed/)).not.toBeInTheDocument();
  });

  it('does not print a commit count it never measured', async () => {
    // `commits: null` travels with `tip: null` — the branch the registry names
    // did not resolve. "0 commits" would be a measurement.
    fetched = view({ facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: null, dirty: 0 } });
    open();
    expect(await screen.findByText(/ws\/quiet-basin → main · o\/r · commits unknown/)).toBeInTheDocument();
  });

  it('requires a QuickConfirm naming the consequence before it posts', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /open pull request/i }));
    expect(await screen.findByText(/Reviewers are notified\. ccrc cannot undo this\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Open pull request$/ }));
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
  });

  it('sends the EDITED title and the generated body', async () => {
    open();
    const title = await screen.findByLabelText(/title/i);
    fireEvent.change(title, { target: { value: 'a better title' } });
    fireEvent.click(screen.getByRole('button', { name: /open pull request/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Open pull request$/ }));
    await waitFor(() => {
      const post = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
        .find((c) => c[1]?.method === 'POST')!;
      expect(JSON.parse(String(post[1].body))).toEqual({ title: 'a better title', body: fetched.draft!.body, draft: false });
    });
  });

  it('offers Open as draft as a SECONDARY action', async () => {
    open();
    expect(await screen.findByRole('button', { name: /open as draft/i })).toBeInTheDocument();
  });

  it('disables both while the session is busy and under unauthenticated', async () => {
    open(sess({ status: 'busy' }));
    expect(await screen.findByRole('button', { name: /open pull request/i })).toBeDisabled();
    cleanup();
    fetched = view({ pr: pr({ phase: 'unknown', reason: 'unauthenticated' }), draft: null });
    open(sess({ pr: pr({ phase: 'unknown', reason: 'unauthenticated' }) }));
    expect(screen.queryByRole('button', { name: /open pull request/i })).not.toBeInTheDocument();
  });
});

describe('open and draft', () => {
  it('links out, copies, and refreshes — and offers nothing that merges', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'https://github.com/o/r/pull/42', title: 'the work' }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByRole('link', { name: /open on github/i }))
      .toHaveAttribute('href', 'https://github.com/o/r/pull/42');
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // No merge button, in any state, ever.
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
  });

  it('says merging happens on GitHub, and what will follow', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u' }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText(/Merging happens on GitHub\. When it merges, ccrc archives this workspace automatically\./))
      .toBeInTheDocument();
  });

  it('renders failing check names as INERT TEXT with no action beside them', async () => {
    // Check names come from GitHub and are attacker-controllable on any repo
    // taking fork PRs. A "fix the failing checks" button would inject that
    // text into an agent running --dangerously-skip-permissions.
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u', checks: 'fail', checkNames: ['e2e', 'lint'] }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText(/e2e/)).toBeInTheDocument();
    const names = screen.getByTestId('pr-check-names');
    expect(names.querySelector('button')).toBeNull();
    expect(names.querySelector('a')).toBeNull();
  });

  it('says "no checks configured" distinctly from pending', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u', checks: null }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText(/no checks configured/i)).toBeInTheDocument();
  });
});

describe('merged', () => {
  const merged = pr({ phase: 'merged', number: 42, url: 'u', mergedAt: Date.now() - 12 * 60_000 });

  it('derives ARCHIVED copy from archivedAt, never from the phase', async () => {
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: Math.floor(Date.now() / 1000) }));
    expect(await screen.findByText(/Archived — session stopped; nothing deleted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clean up/i })).toBeInTheDocument();
  });

  it('says NOT archived yet and offers Archive now when archivedAt is null', async () => {
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: null }));
    expect(await screen.findByText(/Not archived yet \(session busy\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clean up/i })).not.toBeInTheDocument();
  });

  it('hands cleanup to the caller rather than deleting anything itself', async () => {
    const onReap = vi.fn();
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: 1 }), onReap);
    fireEvent.click(await screen.findByRole('button', { name: /clean up/i }));
    expect(onReap).toHaveBeenCalledTimes(1);
  });
});

describe('closed', () => {
  it('offers NO cleanup, ever, and says why', async () => {
    // A closed PR's commits are not on main; removing that workspace is
    // precisely the destroy-unpushed-work case, and `closed` is a state a
    // remote party can set.
    const closed = pr({ phase: 'closed', number: 42, url: 'u' });
    fetched = view({ pr: closed, draft: null });
    open(sess({ pr: closed, archivedAt: 1 }));
    expect(await screen.findByText(/Closed without merging\. This branch's commits are not on main\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clean up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive now/i })).not.toBeInTheDocument();
  });
});

describe('unknown', () => {
  it('names the reason, says when it last checked, and offers only Retry', async () => {
    const unknown = pr({ phase: 'unknown', number: 42, reason: 'unauthenticated', checkedAt: Date.now() - 6 * 60_000 });
    fetched = view({ pr: unknown, draft: null });
    open(sess({ pr: unknown, archivedAt: null }));
    expect(await screen.findByText(/isn't logged in on the sessions box/i)).toBeInTheDocument();
    expect(screen.getByText(/last checked 6m ago/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open pull request/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clean up/i })).not.toBeInTheDocument();
  });
});
