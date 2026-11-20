// Desktop polish H4 (D-8828): the Archive screen's "Work no session owns" section (session helpers design 2026-11-19, §6 and
// Table 8). Two kinds of row: an unowned tree (`DelegationProjectionWire.unowned`) and a worktree whose parent and worker are
// both unlisted. The section draws the project, the path, a verdict or disposition word, an age and the existing doors' acts,
// and nothing the operator cannot act on: no liveness word and no bare `unmeasured`. Where presence on disk was not measured
// the head says so once. With nothing of either kind it draws nothing.
//
// RED FIRST, against origin/main: ArchiveScreen takes no `delegation` and draws no section there, so every render case
// fails on its first assertion ("Work no session owns" not found); the words cases call exports `delegationWords.ts` has not
// got (`VERDICT_WORD`, `unownedControls`, `unlistedLeases`, …) and fail as "is not a function". Neutral names only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from '@ccrc/ui';
import type { DelegationProjectionWire, FleetSession } from '../../shared/api';
import { fleetSession, DEAD_LIFECYCLE } from './fleetFixture';
import { frame, lease, unowned as unownedBase, activity } from './delegationFixture';
import { okJson } from './leaseCardFixture';
import { ArchiveScreen } from '../src/screens/ArchiveScreen';
import * as words from '../src/fleet/delegationWords';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const NOW = Date.parse('2026-11-20T09:00:00.000Z');
const THREE_DAYS_AGO = '2026-11-17T09:00:00.000Z';
const LEASE = '0b0c3f8e-5d55-4c1e-9a77-2f1d8c3e4a10';
const LEASE_2 = '1c1d4a9f-6e66-4d2f-8b88-3a2e9d4f5b21';
/** The fixtures' paths are fixed; a row found by its admin record needs a path that names it (null stays null). */
const unowned = (over: Parameters<typeof unownedBase>[0] = {}) => {
  const adminRecord = over.adminRecord ?? 'agent-u1';
  return unownedBase({ adminRecord, canonicalPath: `/work/project-a/.claude/worktrees/${adminRecord}`, ...over });
};
const SECTION = 'Work no session owns';
const SECTION_RE = /^Work no session owns/;

/** A session the fleet list carries (live bucket). */
const LISTED = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, name: 'coord-a' });
/** A session that is a row of the store but archived: unlisted, not gone. */
const ARCHIVED = fleetSession({
  id: 'coord-gone', project: 'project-a', workspace: 'coord-gone', status: 'dead', lifecycle: DEAD_LIFECYCLE,
  branch: 'ws/coord-gone', archivedAt: 1785300123, archivedBytes: 1000,
});

type Call = { url: string; body: unknown };
function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    return okJson({ ok: true, lease: LEASE, generation: 2, disposition: 'retained', expiresAt: '2026-11-24T12:00:00.000Z', carrier: 'pending' });
  }));
  return calls;
}

function draw(delegation: DelegationProjectionWire | null, sessions: readonly FleetSession[] = [LISTED]) {
  return render(<><ArchiveScreen sessions={sessions} delegation={delegation} nowMs={NOW} onOpen={() => {}} /><ToastHost /></>);
}
const section = (): HTMLElement => screen.getByRole('region', { name: SECTION_RE });
const rowOf = (text: string): HTMLElement =>
  [...section().querySelectorAll<HTMLElement>('[data-unowned-row]')].find((r) => r.textContent?.includes(text))!;
const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** A lease whose two sessions are not listed: `parentId` is absent from the store, and so is its worker. */
const orphanLease = (over: Parameters<typeof lease>[0] = {}) => lease({
  canonicalPath: `/work/project-a/.claude/worktrees/${over.adminRecord ?? 'agent-a1'}`,
  leaseId: LEASE, parentId: 'coord-missing', via: 'worker-missing', group: 'offline-coordinator',
  disposition: 'retained', expiresAt: null, ...over,
});

describe('H4: the section and its two subheads', () => {
  it('names itself, says what it holds, and heads each kind of row under its own subhead', () => {
    draw(frame({ unowned: [unowned()], leases: [orphanLease()] }));
    const s = section();
    expect(within(s).getByRole('heading', { name: new RegExp(SECTION) })).toBeTruthy();
    expect(s.textContent).toContain('Delegated worktrees the broker could not give one owner, and worktrees whose two sessions are both gone.');
    expect(within(s).getByText('No single owner')).toBeTruthy();
    expect(within(s).getByText('Neither session listed')).toBeTruthy();
    // review 2900 minor: an archived session is unlisted, not gone, so the subhead never says "gone".
    expect(s.textContent).not.toMatch(/Both sessions gone/);
    // The head counts both kinds of row.
    expect(within(s).getByRole('heading', { name: new RegExp(`${SECTION}.*2`) })).toBeTruthy();
  });

  it('draws a subhead only for a kind that has a row', () => {
    draw(frame({ unowned: [unowned()] }));
    expect(screen.getByText('No single owner')).toBeTruthy();
    expect(screen.queryByText('Neither session listed')).toBeNull();
    cleanup();
    draw(frame({ leases: [orphanLease()] }));
    expect(screen.queryByText('No single owner')).toBeNull();
    expect(screen.getByText('Neither session listed')).toBeTruthy();
  });

  it('sits above the archived workspaces, which keep their own section', () => {
    draw(frame({ unowned: [unowned()] }), [LISTED, ARCHIVED]);
    const owns = screen.getByRole('region', { name: SECTION_RE });
    const archived = screen.getByRole('region', { name: /1 archived/ });
    expect(owns.compareDocumentPosition(archived) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws with nothing archived: the unowned work is the page\'s only list, and the empty line stays', () => {
    draw(frame({ unowned: [unowned()] }));
    expect(screen.getByRole('region', { name: SECTION_RE })).toBeTruthy();
    expect(screen.getByText('Nothing is archived.')).toBeTruthy();
  });
});

describe('H4: an unowned tree', () => {
  it('draws its project, its path, the verdict word and the attempt time as an age', () => {
    draw(frame({ unowned: [unowned({ attemptedAt: THREE_DAYS_AGO })] }));
    const row = rowOf('agent-u1');
    expect(row.textContent).toContain('project-a');
    expect(row.textContent).toContain('/work/project-a/.claude/worktrees/agent-u1');
    expect(row.textContent).toContain('no owner found');
    expect(row.textContent).toContain('tried 3 days ago');
  });

  it('says "two owners claimed it" for a conflicting verdict', () => {
    draw(frame({ unowned: [unowned({ verdict: 'conflicting', attemptedAt: THREE_DAYS_AGO })] }));
    expect(rowOf('agent-u1').textContent).toContain('two owners claimed it');
    expect(rowOf('agent-u1').textContent).not.toContain('no owner found');
  });

  it('draws the admin record when no path is known, and the path otherwise', () => {
    draw(frame({ unowned: [unowned({ canonicalPath: null, adminRecord: 'agent-u9' })] }));
    expect(rowOf('agent-u9').textContent).toContain('agent-u9');
    expect(section().textContent).not.toContain('/work/project-a/.claude/worktrees');
  });

  it('ages by the one ladder: minutes, hours, days, and "just now" under a minute; an unreadable time leaves the age out', () => {
    const at = (ms: number): string => new Date(NOW - ms).toISOString();
    draw(frame({ unowned: [
      unowned({ adminRecord: 'a-min', canonicalPath: null, attemptedAt: at(5 * 60_000) }),
      unowned({ adminRecord: 'a-hour', canonicalPath: null, attemptedAt: at(2 * 3_600_000) }),
      unowned({ adminRecord: 'a-day', canonicalPath: null, attemptedAt: at(86_400_000) }),
      unowned({ adminRecord: 'a-now', canonicalPath: null, attemptedAt: at(10_000) }),
      unowned({ adminRecord: 'a-bad', canonicalPath: null, attemptedAt: 'not a date' }),
    ] }));
    expect(rowOf('a-min').textContent).toContain('tried 5 minutes ago');
    expect(rowOf('a-hour').textContent).toContain('tried 2 hours ago');
    expect(rowOf('a-day').textContent).toContain('tried 1 day ago');
    expect(rowOf('a-now').textContent).toContain('tried just now');
    expect(rowOf('a-bad').textContent).not.toMatch(/tried/);
  });

  it('lists the newest attempt first, an unreadable time last, and equal times by admin record', () => {
    const at = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();
    draw(frame({ unowned: [
      unowned({ adminRecord: 'b-old', attemptedAt: at(9) }),
      unowned({ adminRecord: 'c-bad', attemptedAt: 'not a date' }),
      unowned({ adminRecord: 'b-new', attemptedAt: at(1) }),
      unowned({ adminRecord: 'a-new', attemptedAt: at(1) }),
    ] }));
    const order = [...section().querySelectorAll('[data-unowned-row="tree"] .archive-unowned-path')].map((e) => e.textContent?.split('/').pop());
    expect(order).toEqual(['a-new', 'b-new', 'b-old', 'c-bad']);
  });

  it('offers Not delegated only where a lease is hidden (leaseId), and no other act, ever', () => {
    draw(frame({ unowned: [
      unowned({ adminRecord: 'with-lease', leaseId: LEASE }),
      unowned({ adminRecord: 'no-lease' }),
      unowned({ adminRecord: 'blank-lease', leaseId: '' }),
    ] }));
    expect(within(rowOf('with-lease')).getByRole('button', { name: 'Not delegated (with-lease)' })).toBeTruthy();
    expect(within(rowOf('no-lease')).queryByRole('button')).toBeNull();
    expect(within(rowOf('blank-lease')).queryByRole('button')).toBeNull();
    // Attach and Keep wait on server fields the unowned wire does not carry (spec §6, Later).
    expect(screen.queryByRole('button', { name: /Keep worktree|Attach to/ })).toBeNull();
  });

  it('Not delegated asks first, then posts {action:\'foreign\'} to the hidden lease\'s resolve door', async () => {
    const calls = stubFetch();
    draw(frame({ unowned: [unowned({ adminRecord: 'with-lease', leaseId: LEASE })] }));
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (with-lease)' }));
    expect(calls).toEqual([]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not delegated' }));
    expect(calls).toEqual([{ url: expect.stringMatching(new RegExp(`/api/leases/${LEASE}/resolve$`)), body: { action: 'foreign' } }]);
  });
});

describe('H4: a worktree whose parent and worker are both unlisted', () => {
  it('draws its project, its path and its disposition word, with Keep worktree and Not delegated', () => {
    draw(frame({ leases: [orphanLease()] }));
    const row = rowOf('agent-a1');
    expect(row.textContent).toContain('project-a');
    expect(row.textContent).toContain('/work/project-a/.claude/worktrees/agent-a1');
    expect(row.textContent).toContain('worktree kept');
    expect(within(row).getByRole('button', { name: 'Keep worktree (agent-a1)' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Not delegated (agent-a1)' })).toBeTruthy();
  });

  it('never offers Attach to…: it needs a listed parent, and these rows have none', () => {
    draw(frame({ leases: [orphanLease({ sourceKind: 'raw' })] }));
    expect(screen.queryByRole('button', { name: /Attach to/ })).toBeNull();
    expect(within(rowOf('agent-a1')).getByRole('button', { name: 'Keep worktree (agent-a1)' })).toBeTruthy();
  });

  it('Keep worktree posts to operator-retain and Not delegated to resolve, each its existing door', async () => {
    const calls = stubFetch();
    draw(frame({ leases: [orphanLease()] }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(calls.map((c) => c.url)).toEqual([expect.stringMatching(new RegExp(`/api/leases/${LEASE}/operator-retain$`))]);
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not delegated' }));
    expect(calls[1]).toEqual({ url: expect.stringMatching(new RegExp(`/api/leases/${LEASE}/resolve$`)), body: { action: 'foreign' } });
  });

  it('says the disposition the words module says: a moving worktree has no controls, an older server\'s row neither word nor control', () => {
    draw(frame({ leases: [
      orphanLease({ leaseId: LEASE, adminRecord: 'moving', disposition: 'transferring' }),
      orphanLease({ leaseId: LEASE_2, adminRecord: 'old-server', disposition: undefined, expiresAt: undefined }),
    ] }));
    expect(rowOf('moving').textContent).toContain('moving to a run');
    expect(within(rowOf('moving')).queryByRole('button')).toBeNull();
    expect(within(rowOf('old-server')).queryByRole('button')).toBeNull();
    expect(rowOf('old-server').textContent).not.toMatch(/worktree kept|moving to a run|moved to a run/);
  });

  it('draws a lease only when NEITHER session is listed: one listed live side gives it a session page', () => {
    draw(frame({ leases: [
      orphanLease({ leaseId: LEASE, adminRecord: 'both-absent' }),
      orphanLease({ leaseId: LEASE_2, adminRecord: 'parent-listed', parentId: 'coord-a', via: 'worker-missing' }),
      orphanLease({ leaseId: 'lease-3', adminRecord: 'worker-listed', parentId: 'coord-missing', via: 'coord-a' }),
      orphanLease({ leaseId: 'lease-4', adminRecord: 'own-listed', parentId: 'coord-a', via: null }),
    ] }));
    expect(rowOf('both-absent')).toBeTruthy();
    for (const hidden of ['parent-listed', 'worker-listed', 'own-listed']) {
      expect(section().textContent, hidden).not.toContain(hidden);
    }
  });

  it('counts an archived session as unlisted, not gone: its lease is drawn here, under "Neither session listed"', () => {
    draw(frame({ leases: [orphanLease({ adminRecord: 'archived-parent', parentId: 'coord-gone', via: null })] }), [LISTED, ARCHIVED]);
    expect(rowOf('archived-parent')).toBeTruthy();
    expect(screen.getByText('Neither session listed')).toBeTruthy();
  });
});

describe('H4: no liveness word and no bare "unmeasured", ever', () => {
  const LIVENESS_WORDS = /not confirmed|stop not seen|session asleep|end recorded|unmeasured|unrecognised|\blive\b|running/i;

  it('draws no liveness word for any liveness the wire carries, on either kind of row', () => {
    draw(frame({
      unowned: [unowned({ workspace: 'unmeasured' }), unowned({ adminRecord: 'agent-u2', canonicalPath: null })],
      leases: (['live', 'ended', 'unmeasured', 'absent' as never]).map((liveness, i) =>
        orphanLease({ leaseId: `lease-${i}`, adminRecord: `wt-${i}`, liveness, workspace: i === 2 ? 'unmeasured' : 'present' })),
    }));
    expect(section().textContent).not.toMatch(LIVENESS_WORDS);
    // A phone shows no titles, and a title is where a liveness word would hide: the rows carry none (a control's own `title=""` is empty).
    expect(section().querySelector('[title]:not([title=""])')).toBeNull();
  });

  it('says it once in the head: presence on disk not measured for N trees, counted over both kinds', () => {
    draw(frame({
      unowned: [unowned({ workspace: 'unmeasured' }), unowned({ adminRecord: 'agent-u2', workspace: 'present' })],
      leases: [orphanLease({ workspace: 'unmeasured' })],
    }));
    const text = section().textContent ?? '';
    expect(occurrences(text, 'presence on disk not measured for 2 trees')).toBe(1);
    expect(occurrences(text, 'presence on disk')).toBe(1);
    // It is the head's, not a row's.
    expect(rowOf('agent-u1').textContent).not.toMatch(/presence|measured/);
  });

  it('says "1 tree" for one, and nothing when every tree was measured', () => {
    draw(frame({ unowned: [unowned({ workspace: 'unmeasured' })] }));
    expect(section().textContent).toContain('presence on disk not measured for 1 tree');
    expect(section().textContent).not.toContain('1 trees');
    cleanup();
    draw(frame({ unowned: [unowned({ workspace: 'present' })] }));
    expect(section().textContent).not.toMatch(/presence on disk/);
  });
});

describe('H4: with nothing of either kind the section draws nothing', () => {
  it('draws no section for an unavailable frame (null), an empty frame, or a frame holding only activities', () => {
    for (const d of [null, frame(), frame({ activities: [activity()] })]) {
      draw(d, [LISTED, ARCHIVED]);
      expect(screen.queryByRole('region', { name: SECTION_RE })).toBeNull();
      expect(screen.queryByText(SECTION)).toBeNull();
      expect(screen.getByRole('region', { name: /1 archived/ })).toBeTruthy();
      cleanup();
    }
  });

  it('draws none for a lease with a listed session, and ArchiveScreen without a delegation prop is as it was', () => {
    draw(frame({ leases: [lease({ parentId: 'coord-a', via: null })] }));
    expect(screen.queryByRole('region', { name: SECTION_RE })).toBeNull();
    cleanup();
    render(<ArchiveScreen sessions={[LISTED, ARCHIVED]} onOpen={() => {}} />);
    expect(screen.queryByRole('region', { name: SECTION_RE })).toBeNull();
    expect(screen.getByRole('region', { name: /1 archived/ })).toBeTruthy();
  });
});

describe('H4: the words (delegationWords.ts, L1)', () => {
  it('re-adds the verdict words C48 deleted, one for each verdict the wire has', () => {
    expect(words.VERDICT_WORD).toEqual({ unresolved: 'no owner found', conflicting: 'two owners claimed it' });
  });

  it('unownedControls gives Not delegated alone, and only for a non-empty hidden lease id', () => {
    expect(words.unownedControls(unowned({ leaseId: LEASE }))).toEqual({ leaseId: LEASE, controls: [{ act: 'foreign' }] });
    expect(words.unownedControls(unowned())).toBeNull();
    expect(words.unownedControls(unowned({ leaseId: '' }))).toBeNull();
    expect(words.unownedControls(unowned({ leaseId: 5 as never }))).toBeNull();
  });

  it('unlistedLeases keeps a lease only when neither of its sessions is listed live, in the order the leases opened', () => {
    const w = frame({ leases: [
      orphanLease({ leaseId: 'b', firstObservedAt: '2026-10-26T11:00:00.000Z' }),
      orphanLease({ leaseId: 'a', firstObservedAt: '2026-10-26T10:00:00.000Z' }),
      orphanLease({ leaseId: 'c', parentId: 'coord-a' }),
    ] });
    expect(words.unlistedLeases(w, [LISTED]).map((l) => l.leaseId)).toEqual(['a', 'b']);
    expect(words.unlistedLeases(w, [LISTED, ARCHIVED]).map((l) => l.leaseId)).toEqual(['a', 'b']);
  });

  it('presenceWord counts trees, in one sentence, and says nothing for none', () => {
    expect(words.presenceWord(0)).toBeNull();
    expect(words.presenceWord(1)).toBe('presence on disk not measured for 1 tree');
    expect(words.presenceWord(3)).toBe('presence on disk not measured for 3 trees');
  });
});
