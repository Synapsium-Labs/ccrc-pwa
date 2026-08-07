import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, PrState, PrView } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { PrSheet } from '../src/session/PrSheet';
import { checkPhrase, prSentence, tooltipSentence } from '../src/session/PrKeycap';
import { UNSUPPORTED_VERB_TEXT } from '../src/lib/api';

const pr = (over: Partial<PrState> = {}): PrState => ({
  phase: 'none', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 3, reason: null, checkedAt: Date.now() - 60_000, mergedAt: null, retryAt: null, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: 'ws/quiet-basin', tasks: null, pr: pr(), archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, ...over,
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
    // Capital N, terminal period: the cap's own words, via checkPhrase.
    expect(await screen.findByText('No checks configured.')).toBeInTheDocument();
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

  // Fix round, finding 1. `archiveMerged` skips a held workspace on
  // `r.held !== null` BEFORE `archiveSafety` runs, so for a held session the
  // hold is the ONLY cause and the pane is usually idle — the sheet said
  // "session busy" and pointed at a wait that can never end. The reason is
  // rendered verbatim, and "Archive now" survives because `ccd ws-archive`
  // has no held rung (only ws-rm/ws-reap do).
  it('names the hold — not a busy session — when a merged workspace is held', async () => {
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: null, held: 'program:agent-evals wave:2/4' }));
    expect(await screen.findByText(/held: program:agent-evals wave:2\/4/)).toBeInTheDocument();
    expect(screen.queryByText(/session busy/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive now/i })).toBeInTheDocument();
  });

  // FIX-WAVE FINDING 6. The fix round above corrected the MERGED branch and
  // left the open/draft one saying "When it merges, ccrc archives this
  // workspace automatically" — and that branch is the one an operator reads
  // for the WHOLE of a wave, since a PR sits open for hours before it merges.
  // For a held session the promise is simply false: `archiveMerged` hits the
  // held rung before `archiveSafety` and skips for as long as the hold stands.
  it('an OPEN PR on a held workspace does not promise an automatic archive', async () => {
    const openPr = pr({ phase: 'open', number: 591, url: 'https://gh/591', checks: 'pass' });
    fetched = view({ pr: openPr, draft: null });
    open(sess({ pr: openPr, held: 'program:agent-evals wave:1/4' }));
    expect(await screen.findByText(/held — program:agent-evals wave:1\/4/)).toBeInTheDocument();
    expect(screen.queryByText(/archives this workspace automatically/i)).not.toBeInTheDocument();
  });

  it('an OPEN PR on an UNHELD workspace still promises it — the sentence is not simply gone', async () => {
    const openPr = pr({ phase: 'open', number: 591, url: 'https://gh/591', checks: 'pass' });
    fetched = view({ pr: openPr, draft: null });
    open(sess({ pr: openPr }));
    expect(await screen.findByText(/archives this workspace automatically/i)).toBeInTheDocument();
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
    // The sentence lives in the lede now — prSentence's own `closed` case —
    // and ONLY there: the sheet used to repeat it verbatim in a `.pr-note`
    // right below, so the same words rendered twice on one screen.
    expect(await screen.findByText(
      "Pull request #42: closed without merging. This branch's commits are not on main.",
    )).toBeInTheDocument();
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

  it('Retry re-fires the GET', async () => {
    const unknown = pr({ phase: 'unknown', number: 42, reason: 'unauthenticated', checkedAt: Date.now() - 6 * 60_000 });
    fetched = view({ pr: unknown, draft: null });
    open(sess({ pr: unknown, archivedAt: null }));
    await screen.findByRole('button', { name: /retry/i });
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length)
      .toBeGreaterThan(before));
  });
});

// The tests above pin the brief's own prose verbatim. These close gaps a
// whole-diff mutation sweep found in that same prose's SURROUNDING behaviour
// — buttons whose click handler nobody exercised, a fallback ordering nobody
// distinguished, a busy flag nobody watched in flight. Recorded as plan
// deviations 95+ (docs/superpowers/plans/2026-07-29-ccrc-pr-lifecycle.md).
describe('mutation-sweep closures', () => {
  it('shows the freshly-fetched PR once the one-shot GET resolves, not the stale cached one', async () => {
    // `view?.pr ?? session.pr` must prefer the FRESH read once it lands —
    // the cached session value is only the gap-filler before it does.
    fetched = view({ pr: pr({ phase: 'open', number: 99, url: 'https://github.com/o/r/pull/99' }), draft: null });
    open(sess({ pr: pr({ phase: 'merged', number: 1 }) }));
    // The cached value renders first…
    expect(screen.getByText(/#1/)).toBeInTheDocument();
    // …and the fresh one wins once the GET resolves — the merged-phase
    // chrome (no GitHub link) would never yield this link if the stale
    // cached value stuck around instead.
    expect(await screen.findByRole('link', { name: /open on github/i }))
      .toHaveAttribute('href', 'https://github.com/o/r/pull/99');
  });

  it('names the workspace in the sheet heading', () => {
    open();
    expect(screen.getByRole('heading', { name: 'quiet-basin' })).toBeInTheDocument();
  });

  it('shows the generated body inside the read-only preview, not a blank one', async () => {
    open();
    const body = await screen.findByLabelText(/body preview/i);
    expect(body).toHaveValue(fetched.draft!.body);
  });

  it('shows no uncommitted-files warning when the tree is clean', async () => {
    // The default fixture's `dirty: 0` — genuinely nothing to warn about.
    open();
    await screen.findByText(/3 commits/);
    expect(screen.queryByText(/files are not committed/)).not.toBeInTheDocument();
  });

  it('says the FULL unmeasured-dirty sentence, not merely that reading failed', async () => {
    fetched = view({ facts: { branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: 3, dirty: null } });
    open();
    expect(await screen.findByText(
      'ccrc could not read this worktree, so it cannot say whether anything is uncommitted.',
    )).toBeInTheDocument();
  });

  it('titles the confirm "Open pull request?" for the primary action', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /^open pull request$/i }));
    expect(await screen.findByRole('heading', { name: 'Open pull request?' })).toBeInTheDocument();
  });

  it('titles the confirm "Open as draft?" and sends draft: true for the secondary action — a DIFFERENT consequence, not a synonym', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /open as draft/i }));
    expect(await screen.findByRole('heading', { name: 'Open as draft?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Open as draft$/ }));
    await waitFor(() => {
      const post = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
        .find((c) => c[1]?.method === 'POST')!;
      expect(JSON.parse(String(post[1].body))).toEqual({ title: 'the work', body: fetched.draft!.body, draft: true });
    });
  });

  it('prefers the freshly-measured branch over the session\'s cached one in the consequence line', async () => {
    fetched = view({ facts: { branch: 'fresh-branch', baseShort: 'main', repo: 'o/r', commits: 1, dirty: 0 } });
    open(sess({ branch: 'stale-branch' }));
    await screen.findByText(/fresh-branch/);
    fireEvent.click(screen.getByRole('button', { name: /open pull request/i }));
    const consequence = await screen.findByText(/Reviewers are notified/);
    expect(consequence.textContent).toContain('fresh-branch');
    expect(consequence.textContent).not.toContain('stale-branch');
  });

  it('disables the confirmed action while it is in flight, and re-enables it once it settles', async () => {
    let resolvePost: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/pr') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(fetched), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if ((init?.method ?? 'GET') === 'POST') {
        await new Promise<void>((resolve) => { resolvePost = resolve; });
      }
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    open();
    const openBtn = await screen.findByRole('button', { name: /^open pull request$/i });
    fireEvent.click(openBtn);
    fireEvent.click(await screen.findByRole('button', { name: /^Open pull request$/ }));
    await waitFor(() => expect(openBtn).toBeDisabled());
    expect(resolvePost).not.toBeNull();
    resolvePost!();
    await waitFor(() => expect(openBtn).not.toBeDisabled());
  });

  it('shows the PR title text for an open PR', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u', title: 'fix the flaky retry' }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText('fix the flaky retry')).toBeInTheDocument();
  });

  it('says "Checks passing" distinctly from "Checks running"', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u', checks: 'pass' }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText('Checks passing.')).toBeInTheDocument();
    cleanup();
    fetched = view({ pr: pr({ phase: 'open', number: 43, url: 'u', checks: 'pending' }), draft: null });
    open(sess({ pr: fetched.pr }));
    expect(await screen.findByText('Checks running.')).toBeInTheDocument();
  });

  it('does not render an empty inert check-names block', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u', checks: 'fail', checkNames: [] }), draft: null });
    open(sess({ pr: fetched.pr }));
    await screen.findByText('Checks failing.');
    expect(screen.queryByTestId('pr-check-names')).not.toBeInTheDocument();
  });

  it('Copy link writes the PR url to the clipboard and confirms with a toast', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'https://github.com/o/r/pull/42' }), draft: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open(sess({ pr: fetched.pr }));
    fireEvent.click(await screen.findByRole('button', { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith('https://github.com/o/r/pull/42');
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('Refresh re-fires the GET', async () => {
    fetched = view({ pr: pr({ phase: 'open', number: 42, url: 'u' }), draft: null });
    open(sess({ pr: fetched.pr }));
    await screen.findByRole('button', { name: /refresh/i });
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length)
      .toBeGreaterThan(before));
  });

  it('Restore calls api.restore', async () => {
    const merged = pr({ phase: 'merged', number: 42, url: 'u', mergedAt: Date.now() - 12 * 60_000 });
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: 1 }));
    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => String(c[0]).endsWith('/restore'))).toBe(true));
  });

  it('Archive now calls api.archive', async () => {
    const merged = pr({ phase: 'merged', number: 42, url: 'u', mergedAt: Date.now() - 12 * 60_000 });
    fetched = view({ pr: merged, draft: null });
    open(sess({ pr: merged, archivedAt: null }));
    fireEvent.click(await screen.findByRole('button', { name: /archive now/i }));
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => String(c[0]).endsWith('/archive'))).toBe(true));
  });

  // svc's round-4 residual. `/archive` and `/restore` grew a `verbSupported`
  // gate answering `501 { error: 'unsupported' }`. A 501 carries no `stderr`,
  // so `apiErrorText` fell through to `err.message` — which `ApiError` sets
  // from `body.error` — and the toast read "Archiving failed — unsupported".
  //
  // The condition is version skew on the fleet host, and the reader's next move
  // is to update the box, not to tap again. The sheet's own cap already says
  // exactly that in `REASON_TEXT.unsupported`, so the toast is routed to the
  // same sentence rather than given a second one.
  const gate501 = (path: string) => vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/pr') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(fetched), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith(path)) {
      return new Response(JSON.stringify({ ok: false, error: 'unsupported' }),
        { status: 501, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));

  for (const [path, button, label] of [
    ['/archive', /archive now/i, 'Archiving'],
    ['/restore', /restore/i, 'Restoring'],
  ] as const) {
    it(`says why the host cannot ${label.toLowerCase()}, not the bare "unsupported"`, async () => {
      const merged = pr({ phase: 'merged', number: 42, url: 'u', mergedAt: Date.now() - 12 * 60_000 });
      fetched = view({ pr: merged, draft: null });
      gate501(path);
      open(sess({ pr: merged, archivedAt: path === '/restore' ? 1 : null }));
      fireEvent.click(await screen.findByRole('button', { name: button }));
      // The whole toast, so the sentence is asserted IN the `${label} failed —`
      // frame it actually renders in and not in isolation.
      expect(await screen.findByText(`${label} failed — ${UNSUPPORTED_VERB_TEXT}`)).toBeInTheDocument();
      expect(screen.queryByText(`${label} failed — unsupported`)).not.toBeInTheDocument();
    });
  }

  it('still prefers ccd’s own stderr when the route actually ran and failed', async () => {
    // The precedence this must not have disturbed: a 502 carries ccd's words,
    // which are more specific than anything the client can say about a code.
    const merged = pr({ phase: 'merged', number: 42, url: 'u', mergedAt: Date.now() - 12 * 60_000 });
    fetched = view({ pr: merged, draft: null });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/pr') && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify(fetched), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false, error: 'unsupported', stderr: 'ccd: the session is busy' }),
        { status: 502, headers: { 'content-type': 'application/json' } });
    }));
    open(sess({ pr: merged, archivedAt: null }));
    fireEvent.click(await screen.findByRole('button', { name: /archive now/i }));
    expect(await screen.findByText('Archiving failed — ccd: the session is busy')).toBeInTheDocument();
  });

  it('is ONE sentence, shared with the cap that reports the same skew', async () => {
    // Not "the toast says a nice thing" — the toast says the SAME thing the PR
    // cap says when the sweep hits the same host. Two copies of this sentence
    // is the drift finding 6 and finding 7 are both about.
    expect(prSentence(pr({ phase: 'unknown', reason: 'unsupported', checkedAt: null })))
      .toContain(UNSUPPORTED_VERB_TEXT);
  });
});

// Final-round integration review, finding 5. `PrKeycap.tsx` exports
// `prSentence`, `prLegend` and `UNCHECKED_PR` precisely so the cap and the
// sheet can never disagree about what a phase means, and `UNCHECKED_PR`'s
// docstring says in as many words that a second copy would drift. A second
// copy was made one layer down — three phase-keyed fragments re-declared
// inside `PrSheet` — and one of them had already drifted ("no checks
// configured" vs the cap's "No checks configured."). Re-syncing the words
// would only have reset the clock. These tests pin the property, not the
// strings: whatever the words become, the two surfaces must say the same ones.
describe('one copy of the phase words (final-round integration finding 5)', () => {
  const CI = [null, 'pass', 'pending', 'fail'] as const;

  it('describes checks in the keycap sentence’s own words, in every CI state', async () => {
    for (const checks of CI) {
      const p = pr({ phase: 'open', number: 42, url: 'u', checks,
        checkNames: checks === 'fail' ? ['e2e', 'lint'] : null });
      fetched = view({ pr: p, draft: null });
      open(sess({ pr: p }));
      await screen.findByRole('button', { name: /copy link/i });
      const line = document.querySelector('.pr-checkline');
      const text = line?.textContent ?? '';
      expect(text).not.toBe('');
      // The sheet's line must be a literal clause of the sentence the cap
      // speaks as its aria-label — not a paraphrase of it. Pre-fix, the
      // `null` state rendered "no checks configured" against the cap's
      // "No checks configured." and both assertions below failed.
      //
      // Minus the terminal period, because the cap's sentence continues the
      // clause with the failing-check names ("Checks failing: e2e, lint.")
      // where the sheet stops and hands them to the inert block.
      expect(text.endsWith('.')).toBe(true);
      expect(prSentence(p)).toContain(text.slice(0, -1));
      // And it is the shared source that produced it, not a coincidence.
      expect(text).toBe(checkPhrase(p));
      cleanup();
    }
  });

  it('keeps the failing check NAMES out of the line and in the inert block, exactly once', async () => {
    // checkPhrase deliberately omits the names that prSentence appends: the
    // sheet has a dedicated inert block for them, and printing the same
    // GitHub-sourced text twice on one screen is what the split avoids.
    const p = pr({ phase: 'open', number: 42, url: 'u', checks: 'fail', checkNames: ['e2e', 'lint'] });
    fetched = view({ pr: p, draft: null });
    open(sess({ pr: p }));
    await screen.findByRole('button', { name: /copy link/i });
    expect(document.querySelector('.pr-checkline')?.textContent).toBe('Checks failing.');
    expect(screen.getByTestId('pr-check-names')).toHaveTextContent('e2e, lint');
    expect(screen.getAllByText(/e2e/)).toHaveLength(1);
  });

  it('uses the lede’s own words as the no-commits disabled reason, not a second sentence', async () => {
    const p = pr({ phase: 'no-commits', ahead: 0 });
    fetched = view({ pr: p, draft: null });
    open(sess({ pr: p }));
    const btn = await screen.findByRole('button', { name: /open pull request/i });
    // Pre-fix the tooltip was a hand-written "<branch> has no commits past
    // its base." beside a lede that said "Pull request: `<branch>` has no
    // commits past its base." — two sentences, one fact, already diverging in
    // form.
    //
    // Fix round 3, verifier P6: it is still ONE sentence, derived — but a
    // `title` is plain text. Reusing the lede byte-for-byte put literal
    // markdown backticks in the tooltip and repeated an opener the lede
    // directly above already says. Both assertions below fail if the tooltip
    // goes back to `title={lede}`, and the third fails if it is hand-written
    // again instead of derived.
    expect(btn.getAttribute('title')).toBe('ws/quiet-basin has no commits past its base.');
    expect(btn.getAttribute('title')).not.toContain('`');
    expect(btn.getAttribute('title')).toBe(tooltipSentence(prSentence(p, 'ws/quiet-basin')));
    // The visible lede keeps its own presentation, ticks and all.
    expect(document.querySelector('.pr-lede')?.textContent).toBe(prSentence(p, 'ws/quiet-basin'));
  });

  it('says the closed sentence exactly ONCE on the screen', async () => {
    const closed = pr({ phase: 'closed', number: 42, url: 'u' });
    fetched = view({ pr: closed, draft: null });
    open(sess({ pr: closed, archivedAt: 1 }));
    await screen.findByRole('link', { name: /open on github/i });
    const hits = [...document.querySelectorAll('p')]
      .filter((el) => (el.textContent ?? '').includes('commits are not on main'));
    // Pre-fix: two — the lede, and a `.pr-note` repeating its second sentence.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.className).toBe('pr-lede');
  });
});
