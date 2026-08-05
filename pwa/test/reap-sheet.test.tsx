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
  transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'a'.repeat(64), sentence: '', ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'custom-tools',
  workdir: '/w', workspace: 'quiet-basin', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, ...over,
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

  /* ── F5: the "kept" row may not promise a count nobody has taken ──────────
   *
   * Final-round tests review. Before the reap this row printed
   * `commitsAheadOfBase` — `git rev-list --count "$base..refs/heads/$branch"`
   * — as though it were the attic's size. `_ws_attic_pin` pins one ref per
   * DISTINCT REFLOG SHA, `sort -u | head -200`, plus the tip: unequal to the
   * commit count in both directions (amends and rebases push the reflog above
   * it; past 200 the cap truncates). On a sheet describing an irreversible
   * delete, the row could therefore promise MORE retention than the attic
   * provides, which is the dangerous direction.
   */
  it('describes the attic RULE before the reap rather than a commit count it is not', async () => {
    auditBody = audit({ commitsAheadOfBase: 3 });
    open();
    expect(await screen.findByText(
      /transcript, and the branch tip plus up to 200 more commits from its reflog, pinned in the attic/,
    )).toBeInTheDocument();
    // The specific overstatement: 3 commits ahead of base is not a promise
    // that 3 commits are pinned, and this row no longer makes it.
    expect(screen.queryByText(/transcript, and 3 commits pinned/)).not.toBeInTheDocument();
  });

  it('does not invent a count when ccd could not take one either', async () => {
    // `commitsAheadOfBase` is `number | null` now (destructive review F2). The
    // row never reads it, so a null cannot reach the screen as the word
    // "null" — asserted rather than reasoned about, because the row DID read
    // it until this round.
    auditBody = audit({ commitsAheadOfBase: null });
    open();
    await screen.findByText(/pinned in the attic/);
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  // F3 refinement (pre-merge fix round): excluded must never mean invisible.
  it('names how many secret-shaped matches the F3 refinement filtered as noise, pluralized', async () => {
    auditBody = audit({ sensitiveFiltered: 1 });
    open();
    expect(await screen.findByText(/^1 secret-shaped match filtered as vendored\/template\./))
      .toBeInTheDocument();
    cleanup();

    auditBody = audit({ sensitiveFiltered: 4 });
    open();
    expect(await screen.findByText(/^4 secret-shaped matches filtered as vendored\/template\./))
      .toBeInTheDocument();
  });

  // destructive F8 residual (critic2). The filter POLICY is not under test and
  // is not changed — the human ruling on it is open. What is fixed is that the
  // count of filtered matches used to sit next to a list capped at three,
  // while a filtered entry is exactly the one that sorts last: ccd orders
  // `ignored` sensitive-first then bytes-descending (ccd:2561) and a
  // noise-filtered match leaves the entry non-sensitive (ccd:1996-2000). The
  // number was on screen; the name it counted was not.
  describe('the filtered count and the names it counts (F8 residual)', () => {
    const manyIgnored = [
      { path: 'node_modules/', bytes: 400_000_000, sensitive: false },
      { path: 'dist/', bytes: 8_000_000, sensitive: false },
      { path: '.ccrc/', bytes: 2_000, sensitive: false },
      { path: 'coverage/', bytes: 900, sensitive: false },
      // Last by ccd's own ordering — non-sensitive and smallest. This is the
      // shape of a noise-filtered secret, and the entry the cap used to eat.
      { path: 'config/secrets.template.env', bytes: 120, sensitive: false },
    ];

    it('shows every ignored entry by default when anything was filtered as noise', async () => {
      auditBody = audit({ ignored: manyIgnored, ignoredCount: 5, ignoredBytes: 408_003_020,
        sensitiveFiltered: 1 });
      open();
      expect(await screen.findByText(/config\/secrets\.template\.env/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'show fewer' })).toBeInTheDocument();
      expect(screen.getByText(/filtered as vendored\/template\./))
        .toHaveTextContent('Every ignored entry is named above.');
    });

    it('still caps the list when nothing was filtered — the default is about the count, not the length', async () => {
      auditBody = audit({ ignored: manyIgnored, ignoredCount: 5, ignoredBytes: 408_003_020,
        sensitiveFiltered: 0 });
      open();
      await screen.findByText(/5 entries/);
      expect(screen.queryByText(/config\/secrets\.template\.env/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'show all 5' })).toBeInTheDocument();
    });

    it('points at the toggle, by its exact label, when the reader has collapsed the list back', async () => {
      auditBody = audit({ ignored: manyIgnored, ignoredCount: 5, ignoredBytes: 408_003_020,
        sensitiveFiltered: 2 });
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'show fewer' }));
      expect(screen.queryByText(/config\/secrets\.template\.env/)).not.toBeInTheDocument();
      // The sentence follows the list rather than promising what is not there.
      expect(screen.getByText(/filtered as vendored\/template\./))
        .toHaveTextContent('Tap "show all 5" to see them.');
      expect(screen.getByRole('button', { name: 'show all 5' })).toBeInTheDocument();
    });

    // Fix round 4, controller item 2. `load()` resets `showAll` to null on
    // every new target and every Re-check, so each audit's list opens on a
    // default chosen from ITS OWN facts. The line was shipped in round 3 with
    // the behaviour claimed in prose and never measured: deleting
    // `setShowAll(null)` left the whole suite green. This is the pin.
    //
    // It matters here more than on most screens: this is the sheet whose
    // primary button is an irreversible `rm -rf`, and the entry a stale
    // `showAll = false` hides is precisely the noise-filtered secret-shaped
    // one — ccd sorts it last (non-sensitive, ccd:1996-2000; sensitive-first
    // then bytes-descending, ccd:2561), so it is the first thing the cap eats.
    it('lets a new target choose its own default instead of inheriting the last one', async () => {
      const first = audit({ ignored: manyIgnored, ignoredCount: 5, ignoredBytes: 408_003_020,
        sensitiveFiltered: 1 });
      const next = audit({ id: 'demo-far-shore', branch: 'ws/far-shore',
        ignored: manyIgnored, ignoredCount: 5, ignoredBytes: 408_003_020, sensitiveFiltered: 3 });
      vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        new Response(JSON.stringify(String(url).includes('far-shore') ? next : first),
          { status: 200, headers: { 'content-type': 'application/json' } })));
      const sheet = (s: FleetSession): ReactElement => (
        <><ToastHost /><ReapSheet session={s} open onClose={() => {}} onReaped={() => {}} /></>
      );

      // Session A filtered something, so its list opened expanded; the reader
      // collapses it back.
      const view = render(sheet(sess()));
      fireEvent.click(await screen.findByRole('button', { name: 'show fewer' }));
      expect(screen.queryByText(/config\/secrets\.template\.env/)).not.toBeInTheDocument();

      // The reap target changes to a session that filtered THREE. Its own
      // facts say expanded; the previous session's tap must not outvote them.
      view.rerender(sheet(sess({ id: 'demo-far-shore', workspace: 'far-shore',
        branch: 'ws/far-shore' })));
      expect(await screen.findByText(/config\/secrets\.template\.env/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'show fewer' })).toBeInTheDocument();
      expect(screen.getByText(/filtered as vendored\/template\./))
        .toHaveTextContent('Every ignored entry is named above.');
    });

    it('claims nothing about a list that is short enough to be whole', async () => {
      // Three entries are never capped, so the note must not send the reader
      // looking for a toggle that is not rendered.
      auditBody = audit({ sensitiveFiltered: 1 });
      open();
      expect(await screen.findByText(/filtered as vendored\/template\./))
        .toHaveTextContent('Every ignored entry is named above.');
      expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
    });
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

// D4: nested checkouts the audit found under this workspace's own worktree.
// `WsAudit.children` is `null` when Phase A refused before the independent
// child walk ran, `[]` when the walk ran and found none, and populated
// (registered children plus any filesystem strays) when it found something —
// same null-vs-[] discipline as `dirty`/`ignored`/`clips` above, one rung
// earlier. These are display-only pins: the refusal token
// (`nested-checkouts-present`) and its sentence are server-side already
// (`shown.sentence`), so what this sheet owns is naming each child on its own
// line and scoping the "cannot be recovered" note so it does not lie about a
// live nested repository.
describe('nested children (D4)', () => {
  it('renders children as named checkouts with branch and state, never inside the ignored total', async () => {
    auditBody = audit({
      verdict: 'nested-checkouts-present', token: undefined,
      sentence: 'Checkouts of their own live under this worktree. Move or remove them first — there is no override.',
      children: [
        { path: '/w/.claude/worktrees/agent-a', branch: 'ca', headOid: 'a'.repeat(40), dirty: 2, busy: null, stray: false },
        { path: '/w/.claude/worktrees/rogue', branch: null, headOid: null, dirty: null, busy: null, stray: true },
      ],
    });
    open();
    expect(await screen.findByText(/agent-a/)).toBeInTheDocument();
    expect(screen.getByText(/2 uncommitted/)).toBeInTheDocument();
    expect(screen.getByText(/not registered/)).toBeInTheDocument();
    // Never folded into the ignored-total row — that figure is unrelated to
    // nested checkouts, and this fixture's own ignored set is the default
    // three-entry one from `audit()`.
    expect(screen.getByText(/3 entries, 420 MB/)).toBeInTheDocument();
  });

  // `childLine`'s `busy !== null` branch — every other fixture in this file
  // leaves `busy: null`, so nothing had ever rendered the "mid-<op>" half of
  // a registered child's line before this closed it.
  it('renders "mid-<op>" for a child stopped mid-operation', async () => {
    auditBody = audit({
      children: [
        { path: '/w/.claude/worktrees/agent-r', branch: 'cr', headOid: 'a'.repeat(40), dirty: 0, busy: 'rebase', stray: false },
      ],
    });
    open();
    expect(await screen.findByText(/mid-rebase/)).toBeInTheDocument();
  });

  // I1 (whole-branch review): the children block used to render with no
  // label at all, so a reapable workspace never said these checkouts are
  // going too. Both arms of the intro line, pinned against the SAME child.
  it('names what happens to the children — removed with the workspace on reapable, informational otherwise', async () => {
    const oneChild = [
      { path: '/w/.claude/worktrees/agent-a', branch: 'ca', headOid: 'a'.repeat(40), dirty: 0, busy: null, stray: false },
    ];
    auditBody = audit({ children: oneChild });
    open();
    expect(await screen.findByText(
      'These checkouts are removed with the workspace — each branch is deleted with plain -d:',
    )).toBeInTheDocument();
    cleanup();

    auditBody = audit({
      verdict: 'nested-checkouts-present', token: undefined,
      sentence: 'Checkouts of their own live under this worktree. Move or remove them first — there is no override.',
      children: oneChild,
    });
    open();
    expect(await screen.findByText('Checkouts of their own live under this workspace:')).toBeInTheDocument();
  });

  it('scopes the cannot-be-recovered sentence when live checkouts sit inside the total', async () => {
    auditBody = audit({
      children: [
        { path: '/w/.claude/worktrees/agent-a', branch: 'ca', headOid: 'a'.repeat(40), dirty: 0, busy: null, stray: false },
      ],
    });
    open();
    expect(await screen.findByText(
      /These are in no commit and cannot be recovered — the total includes the nested checkouts listed below, which are live repositories, not disposable output\./,
    )).toBeInTheDocument();
    cleanup();

    // Measured-and-empty: the original, unqualified sentence.
    auditBody = audit({ children: [] });
    open();
    expect(await screen.findByText(/^These are in no commit and cannot be recovered\.$/)).toBeInTheDocument();
    cleanup();

    // Unmeasured: the original sentence too — a `null` children list is not a
    // claim that anything is live, so it earns no qualifier either.
    auditBody = audit({ children: null });
    open();
    expect(await screen.findByText(/^These are in no commit and cannot be recovered\.$/)).toBeInTheDocument();
  });

  it('renders no children row at all for children:null — "not scanned" stays at three', async () => {
    auditBody = audit({
      verdict: 'detached-head', sentence: 'git records this worktree on a detached HEAD.',
      token: undefined,
      dirty: null, ignored: null, ignoredCount: null, ignoredBytes: null,
      sensitive: null, sensitiveFiltered: null, stashes: null,
      merge: { proof: null, fetchedAt: null },
      children: null,
    });
    open();
    // Same count the pre-existing "not scanned" pin asserts (uncommitted,
    // not-in-git, stashes) — a children block must not add or remove one.
    expect(await screen.findAllByText('not scanned')).toHaveLength(3);
    expect(screen.queryByText(/not registered with git/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent-a|rogue/)).not.toBeInTheDocument();
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

  // Verifier round 3, P3 — the twelfth measurement-forgery instance. ccd
  // answers a failed `du` on an ignored entry with `bytes=0` (ccd:1990) and
  // folds it into `ignoredBytes` (ccd:2559-2560), so an unreadable tree of
  // gigabytes was printed as "1 entries, 0 B" as the sole size figure above an
  // irreversible Remove. The producer half is the ccd lane's and the wire type
  // (`ignoredBytes: number`) is svc's; THIS is the display half, and it lands
  // first on purpose — the screen must already be honest on the day the 0
  // stops being fabricated, and it must not print `NaN B` in the meanwhile if
  // the field goes missing between ccd and here.
  //
  // Both fixtures therefore go round the compile-time type deliberately: they
  // are what the RUNTIME can hand this component, which is the only thing the
  // rendering can be judged against.
  it('says "size unknown", never a number, when ignoredBytes is not a measurement', async () => {
    auditBody = { ...audit(), ignoredBytes: null };
    open();
    expect(await screen.findByText(/3 entries, size unknown/)).toBeInTheDocument();
    // The count and the names are still stated — refusing the TOTAL is not
    // refusing the row.
    expect(screen.getByText(/node_modules\/ · dist\/ · .ccrc\//)).toBeInTheDocument();
  });

  it('degrades to "size unknown" rather than NaN when the field is absent entirely', async () => {
    const { ignoredBytes: _dropped, ...withoutTheField } = audit();
    auditBody = withoutTheField;
    open();
    expect(await screen.findByText(/3 entries, size unknown/)).toBeInTheDocument();
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
    // The collapsed label states how many entries it is hiding (F8 residual):
    // the size of what is off-screen is not itself off-screen.
    const toggle = screen.getByRole('button', { name: 'show all 5' });
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

  // Same class as the two rows above, and the only figure on this sheet that
  // is a SUM: `clips.reduce((n, c) => n + c.bytes, 0)` under-counts an
  // unmeasured clip silently (`3 + null === 3`) and NaNs a missing one, either
  // way stating a total the sheet was not given. The disclosure is
  // ArchiveScreen's existing answer for a partially measured set.
  //
  // PRODUCER LANDED (cross-lane seam round). These two were written while
  // `clips[].bytes` was still `number` on the wire and ccd still fabricated a
  // `0`, so they had to assign through `auditBody: unknown` to get past the
  // compile-time type, and were disclosed as such. `_ws_clip_manifest` now
  // emits `null` (ccd:3162/3171) and `WsAudit` declares `number | null`, so
  // they go through `audit()` — which is `Partial<WsAudit>` and therefore
  // TYPE-CHECKED. That conversion is itself the check that the two halves
  // agree: if the producer had landed as `-1`, or as an omitted field, or if
  // the wire type had not been widened, this line would not compile, and the
  // pwa suite runs `--typecheck`.
  it('discloses an unmeasured clip instead of folding it into the total', async () => {
    auditBody = audit({ clips: [{ name: 'a.png', bytes: 1_000_000 }, { name: 'b.png', bytes: null }] });
    open();
    expect(await screen.findByText('2 pasted images, 1 MB + 1 unmeasured')).toBeInTheDocument();
  });

  it('refuses the clips total outright when no clip was measured at all', async () => {
    auditBody = audit({ clips: [{ name: 'a.png', bytes: null }] });
    open();
    expect(await screen.findByText('1 pasted image, size unknown')).toBeInTheDocument();
  });

  /* ── THE SIXTEENTH FORGERY: the LIST, not the size ────────────────────────
   *
   * Final-round confirmation-surface review. The three tests above are about
   * a clip whose SIZE ccd could not take; this is about a clips directory ccd
   * could not OPEN. `_ws_clip_manifest` answered `[]` for it, at exit 0, and
   * this row rendered that as **none** — the most reassuring word available,
   * about full-resolution pastes that exist in no commit and nowhere else, on
   * a sheet whose Remove button was reachable. `WsAudit['clips']` is
   * `… [] | null` now, so the honest branch is reachable from a real audit and
   * this fixture is type-checked (`--typecheck` runs in this suite): if ccd's
   * refusal had landed as an omitted field or as `[]` with a flag beside it,
   * this line would not compile.
   */
  it('says the clips list could not be READ, never "none", when ccd could not open the directory', async () => {
    auditBody = audit({
      clips: null, verdict: 'clips-unreadable', token: undefined,
      sentence: 'ccrc could not list this session’s pasted images (`~/.cc-clips/<session>`), '
        + 'so it cannot say what removing them would destroy. Nothing was removed. '
        + 'Check that directory’s permissions.',
    });
    open();
    expect(await screen.findByText('could not be read')).toBeInTheDocument();
    // The word this row must not print for this state — "none" IS the defect.
    // Two remain and they are the honest ones: `dirty: []` and `stashes: 0`
    // are measurements in this fixture (the sibling test with `clips: []`
    // finds three), so counting them is what proves the missing one is the
    // clips row rather than a query that matched nothing.
    expect(screen.getAllByText('none')).toHaveLength(2);
    // A COUNT is the other way of implying the list was read — and the match
    // is anchored on the digit, because the refusal paragraph below the rows
    // says "pasted images" too and saying it there is the point.
    expect(screen.queryByText(/\d+ pasted image/)).not.toBeInTheDocument();
    // And no promise ABOUT a set the screen was never given — same rule the
    // not-in-git row follows for its own `null`.
    expect(screen.queryByText(/pastes? (is|are) in no commit/)).not.toBeInTheDocument();
    // No token, no confirm: an unlisted deletion is one nobody consented to.
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/could not list this session/)).toBeInTheDocument();
  });

  it('states the measured total unchanged when every clip WAS measured', async () => {
    // The other side of the same branch: widening the type must not make the
    // ordinary sheet start hedging. `clipsSizeText`'s `unmeasured === 0` arm
    // is the one a reader sees every day.
    auditBody = audit({ clips: [{ name: 'a.png', bytes: 1_000_000 }, { name: 'b.png', bytes: 2_000_000 }] });
    open();
    expect(await screen.findByText('2 pasted images, 3 MB')).toBeInTheDocument();
  });

  it('counts stashes instead of collapsing them to "none"', async () => {
    auditBody = audit({ stashes: 4 });
    open();
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  /* ── F3: a refusal must not read like a clean scan ────────────────────────
   *
   * Final-round tests review, and the fourteenth instance of the
   * measurement-forgery class — the first to land on this surface. ccd emitted
   * `_ws_reap_reset`'s defaults on every verdict, and this component rendered
   * them unconditionally, so a workspace refused in Phase A (before
   * `_ws_collect_ignored`, before the stash read, before the PR fetch) was
   * described to the reader as "uncommitted: none / not in git: 0 entries, 0 B
   * / stashes: none". Those Phase-A refusals all leave the worktree ON DISK.
   *
   * The Remove button is NOT reachable from this state — it renders on
   * `verdict === 'reapable'` alone, and ccd converts the one
   * reapable-without-measurement path to `reap-interrupted` — so the harm is a
   * false description above a refusal, not a delete. That is why these are
   * assertions about words rather than about the button.
   *
   * `WsAudit` now types all six `| null`, so every case below goes through
   * `audit()` (which is `Partial<WsAudit>`) and is TYPE-CHECKED against the
   * producer's shape — the pwa suite runs `--typecheck`. If ccd had landed
   * this as an omitted field instead, these lines would not compile.
   */
  const unscanned = (): Partial<WsAudit> => ({
    verdict: 'detached-head', sentence: 'git records this worktree on a detached HEAD.',
    token: undefined,
    dirty: null, ignored: null, ignoredCount: null, ignoredBytes: null,
    sensitive: null, sensitiveFiltered: null, stashes: null,
    merge: { proof: null, fetchedAt: null },
  });

  it('says "not scanned", never "none" or "0 entries", for a refusal that measured nothing', async () => {
    auditBody = audit(unscanned());
    open();
    // One word, four rows: uncommitted, not-in-git, stashes, and the merge age
    // on the branch line.
    expect(await screen.findAllByText('not scanned')).toHaveLength(3);
    expect(screen.getByText(/merge not scanned/)).toBeInTheDocument();
    // The exact strings the sheet used to print about an unscanned workspace.
    expect(screen.queryByText('none')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 entries/)).not.toBeInTheDocument();
    expect(screen.queryByText(/days ago|today/)).not.toBeInTheDocument();
  });

  it('does not promise the unrecoverable-content note when there is no content list', async () => {
    // "These are in no commit and cannot be recovered" under a row that just
    // said `not scanned` reads as a statement about a set the screen has.
    auditBody = audit(unscanned());
    open();
    await screen.findAllByText('not scanned');
    expect(screen.queryByText(/These are in no commit/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show all/ })).not.toBeInTheDocument();
    // And the refusal itself is still rendered, below the rows.
    expect(screen.getByText(/detached HEAD/)).toBeInTheDocument();
  });

  it('keeps every honest row unchanged when the scan DID run', async () => {
    // The other direction. Widening six fields to `| null` must not make the
    // sheet a reader sees every day start hedging — the `0`/`[]` that IS a
    // measurement still reads `none`.
    auditBody = audit({ dirty: [], stashes: 0, clips: [] });
    open();
    expect(await screen.findByText(/3 entries, 420 MB/)).toBeInTheDocument();
    expect(screen.getAllByText('none')).toHaveLength(3);
    expect(screen.queryByText('not scanned')).not.toBeInTheDocument();
    expect(screen.getByText(/6 days ago/)).toBeInTheDocument();
  });

  it('renders the count and the total together — an unscanned count never keeps a size beside it', async () => {
    // The half-honest state the fix removes: `sizeText` already refused to
    // invent the TOTAL, so before this the row read "0 entries, size unknown"
    // — and "0 entries" is the half a reader takes as "there is nothing here".
    auditBody = audit({ ignoredCount: null, ignoredBytes: null, ignored: null });
    open();
    await screen.findByText('not scanned');
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument();
    expect(screen.queryByText(/size unknown/)).not.toBeInTheDocument();
  });

  it('suppresses the filtered-secrets note when the filter never ran', async () => {
    // `sensitiveFiltered ?? 0`: null means no scan, so there is nothing it hid
    // and nothing for the expand default to open.
    auditBody = audit({ ...unscanned(), sensitiveFiltered: null });
    open();
    await screen.findAllByText('not scanned');
    expect(screen.queryByText(/filtered as vendored/)).not.toBeInTheDocument();
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
    // ZERO IS A RESULT, and it must not fall back to the pre-reap sentence.
    // The old shape guarded with `result?.attic ?? …`, where the distinguishing
    // mutant was `??` -> `||`; the guard is now `!== undefined`, where it is
    // truthiness (`result?.attic ? … : …`). Same falsy 0, same fallback, same
    // assertion — an attic of 0 is the reap's own measurement and the row
    // states it rather than reverting to a description of the rule.
    expect(screen.queryByText(/branch tip plus up to 200 more/)).not.toBeInTheDocument();
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
