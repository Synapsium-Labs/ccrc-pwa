// The danger variants (D-5099): every control that destroys something says so
// in its treatment, not only in its words.
//
// One case per call site. Each renders the flow at its confirm step, finds the
// button by its accessible name (what the operator reads), and asserts the
// variant's hook class. Before this task every one of them was `btn-primary`:
// the phosphor fill, the same "commit" the Release and Resume sheets wear, on
// the controls that abandon a run, archive a workspace, remove a worktree and
// reboot the whole fleet box.
//
// The hook class is the assertion because it is the variant's NAME, emitted by
// `buttonVariants` and owned by `@ccrc/ui` (design-system-boundary's OWNED
// list): a call site cannot reach it by hand without that suite reding.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Button, QuickConfirm, ToastHost, buttonVariants } from '@ccrc/ui';
import type { FleetHealth, FleetSession, NodeWire, ReleaseWire, RunSummary, UpdatesView, WsAudit } from '../../shared/api';
import { FLEET_SCOPE } from '../../shared/api';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { HaltBanner } from '../src/fleet/HaltBanner';
import { withdrawnRollbackText } from '../src/fleet/UpdateMoveSheet';
import { fleetSession } from './fleetFixture';
import { api } from '../src/lib/api';
import { AbandonSheet } from '../src/fleet/AbandonSheet';
import { ArchiveSheet } from '../src/fleet/ArchiveSheet';
import { ArchiveConflictSheet } from '../src/fleet/ArchiveConflictSheet';
import { ArchiveAllConfirm } from '../src/fleet/ArchiveAllPlane';
import { FleetHostBanner } from '../src/fleet/FleetHostBanner';
import { ReapSheet } from '../src/session/ReapSheet';
import { AuthSection } from '../src/screens/AuthSection';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } });

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'program-a', programTitle: 'Program A',
  wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'project-a-lane-a', workspace: 'lane-a', branch: 'ws/lane-a',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'project-a-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'project-a-lane-a', project: 'project-a', workspace: 'lane-a', branch: 'ws/lane-a', ...over });

describe('every destructive confirm is the danger variant', () => {
  it("Abandon's confirm", () => {
    render(<AbandonSheet run={run()} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Abandon' })).toHaveClass('btn-danger');
  });

  it("Archive's confirm", () => {
    render(<ArchiveSheet session={sess()} open onClose={() => {}} archive={vi.fn() as unknown as typeof api.archive} />);
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveClass('btn-danger');
  });

  it("Archive's second confirm, Stop only", async () => {
    // Offered after a refusal the phone cannot fix: it stops the pane.
    const { ApiError } = await import('../src/lib/api');
    const archive = vi.fn().mockRejectedValueOnce(
      new ApiError(409, { ok: false, error: 'worktree-gone' })) as unknown as typeof api.archive;
    render(<><ArchiveSheet session={sess()} open onClose={() => {}} archive={archive} onStopOnly={() => {}} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('button', { name: 'Stop only' })).toHaveClass('btn-danger');
  });

  it("the conflict sheet's force", () => {
    render(<ArchiveConflictSheet sessionId="project-a-lane-a" runs={[{ id: 17, program: 'program-a', wave: 1, waveOf: 2 }]}
      onClose={() => {}} archive={vi.fn() as unknown as typeof api.archive} />);
    expect(screen.getByRole('button', { name: 'Archive anyway' })).toHaveClass('btn-danger');
  });

  it("Archive all's confirm", () => {
    const rel = { runId: 1, program: 'program-a', programTitle: null, claimedBy: 'coord', closedAt: 1, child: false };
    render(<ArchiveAllConfirm project="project-a" onClose={() => {}} onConfirm={() => {}}
      sessions={[sess({ releasedFrom: rel }), sess({ id: 'project-a-lane-b', workspace: 'lane-b', releasedFrom: rel })]} />);
    expect(screen.getByRole('button', { name: 'Archive 2' })).toHaveClass('btn-danger');
  });

  describe("Reap's Remove", () => {
    const audit: WsAudit = {
      id: 'project-a-lane-a', branch: 'ws/lane-a', registryBranch: 'ws/lane-a', drift: '',
      base: 'origin/main', workdir: '/w/project-a/lane-a',
      project: 'project-a', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
      alive: true, started: true, unit: 'enabled',
      dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
      clips: [], stashes: 0, worktreeBytes: 1_200_000_000, commitsAheadOfBase: 3,
      pr: { number: 42, url: 'u', mergeCommit: '7a68ca0', headRefOid: 'deadbee' },
      merge: { proof: 'patch-id', fetchedAt: Math.floor(Date.now() / 1000) - 86_400 },
      transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'a'.repeat(64), sentence: '',
    };
    beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => json(200, audit))); });

    it('is danger, and keeps the reap-go hook the tap-target suite asserts', async () => {
      render(<><ToastHost /><ReapSheet session={sess({ archivedAt: 1 })} open onClose={() => {}} onReaped={() => {}} /></>);
      const btn = await screen.findByRole('button', { name: 'Remove lane-a · 1.2 GB' });
      expect(btn).toHaveClass('btn-danger');
      expect(btn).toHaveClass('reap-go');
    });
  });

  it('Sign out is the way out, a ghost, not a commit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/auth/status')) return json(200, { authed: true, passkeysEnrolled: 1, mode: 'passphrase' });
      if (u === '/api/auth/passkeys') return json(200, { credentials: [], storeUnreadable: false });
      return json(404, { error: 'not-found' });
    }));
    render(<AuthSection />);
    const btn = await screen.findByRole('button', { name: /^sign out$/i });
    expect(btn).toHaveClass('btn-ghost');
    expect(btn).not.toHaveClass('btn-primary');
  });
});

describe("the fleet host's Reboot, the most destructive control in the app", () => {
  const health = (): FleetHealth => ({ mode: 'remote', connected: false, downSince: Date.now() - 5 * 60_000 });

  it("the fleet host's Reboot is danger-ghost in the banner, and its confirm is danger", async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    render(<FleetHostBanner />);
    const trigger = await screen.findByRole('button', { name: 'Reboot' });
    // A hairline in the dead-text ink: the banner is already the dead tint,
    // so a red fill on it would be red on red.
    expect(trigger).toHaveClass('btn-danger-ghost');
    // What fleet-host-banner.test.tsx pins, kept.
    expect(trigger).toHaveClass('w-auto');
    expect(trigger).toHaveClass('flex-none');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Reboot the fleet host' })).toHaveClass('btn-danger');
  });
});

describe('the disabled stand-down', () => {
  // A disabled control that keeps its armed look reads as broken (button.tsx's
  // header). `danger` takes primary's stand-down, `danger-ghost` ghost's
  // (D-5448): the Reboot is disabled while a reboot is in flight.
  it.each([
    ['danger', ['disabled:bg-edge-subtle', 'disabled:text-ink-disabled']],
    ['danger-ghost', ['disabled:text-ink-disabled', 'disabled:border-edge-subtle']],
  ] as const)('a disabled %s stands down', (variant, classes) => {
    render(<Button variant={variant} disabled>Remove</Button>);
    const cls = screen.getByRole('button', { name: 'Remove' }).className.split(/\s+/);
    for (const c of classes) expect(cls).toContain(c);
  });
});

describe("QuickConfirm's tone", () => {
  it('QuickConfirm with tone danger renders btn-danger and still closes on confirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<QuickConfirm open onClose={onClose} title="Remove it?" consequence="It is gone."
      confirmLabel="Remove" onConfirm={onConfirm} tone="danger" />);
    const btn = screen.getByRole('button', { name: 'Remove' });
    expect(btn).toHaveClass('btn-danger');
    expect(btn).not.toHaveClass('btn-primary');
    act(() => { fireEvent.click(btn); });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('defaults to commit: an untoned QuickConfirm is still primary', async () => {
    render(<QuickConfirm open onClose={() => {}} title="Release it?" consequence="It is released."
      confirmLabel="Release" onConfirm={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Release' })).toHaveClass('btn-primary'));
  });
});

// Settings spec §6.3 (D-5507): Roll back (release and node) and Ack (the node row and the home screen's halt banner)
// are danger actions. Each trigger is the red hairline, `danger-ghost`, and each opens a confirm whose commit is the
// filled red `danger`. Install and Update stay ghost. Every move button, either tone, sizes through Button's own
// `size="fit"`: the old `.btn-ghost.settings-move` rule is gone and an app rule for it would be a reach-in.
describe('the Updates danger actions (D-5507)', () => {
  const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
  const A = '77777777-7777-4777-8777-777777777777';
  const B = '88888888-8888-4888-8888-888888888888';
  const stamp = (version: string) => ({ sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-10-18T12:00:00Z', dirty: false, version });
  const node = (over: Partial<NodeWire> = {}): NodeWire => ({
    nodeId: A, role: 'fleet', label: 'fleet', os: 'linux',
    current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['verify', 'node-id', 'floor', 'update-gate'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
    floorRead: 'measured', previousRead: 'measured',
    measuredAt: T0, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
    request: null, report: null,
    update: { state: 'failed', target: 'v0.0.10', startedAt: T0, detail: null },
    ...over,
  });
  const release = (tag: string): ReleaseWire => ({
    tag, version: tag, channel: 'stable', publishedAt: T0, commitSha: 'd'.repeat(40),
    bundleListed: true, yanked: false, refused: [], notes: null,
  });
  const view = (over: Partial<ReleaseWire> = {}): UpdatesView => ({
    catalogue: { lastOkAt: T0, lastError: null },
    releases: [release('v0.0.10'), release('v0.0.9'), { ...release('v0.0.8'), ...over }],
    nodes: [node(), node({ nodeId: B, role: 'server', label: 'server', agentOps: null, update: { state: 'idle', target: null, startedAt: null, detail: null } })],
    intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: T0, setBy: 'test' }],
  });
  const renderSettings = async (over: Partial<ReleaseWire> = {}) => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(over));
    render(<><ToastHost /><SettingsScreen /></>);
    const releases = await screen.findByRole('region', { name: 'Releases' });
    const nodes = await screen.findByRole('list', { name: 'Nodes' });
    const nodeRow = nodes.querySelector<HTMLElement>(`li[data-node-id="${A}"]`)!;
    const releaseRow = releases.querySelector<HTMLElement>('li[data-tag="v0.0.8"]')!;
    return { releases, nodes, nodeRow, releaseRow };
  };

  it("the release row's Roll back is danger-ghost, and its sheet commits in danger", async () => {
    const { releaseRow } = await renderSettings();
    const trigger = within(releaseRow).getByRole('button', { name: 'Roll back' });
    expect(trigger).toHaveClass('btn-danger-ghost');
    expect(trigger).not.toHaveClass('btn-ghost');
    fireEvent.click(trigger);
    expect(await screen.findByRole('button', { name: 'Roll back 2 nodes' })).toHaveClass('btn-danger');
  });

  it("the node row's Roll back is danger-ghost, and its sheet commits in danger", async () => {
    const { nodeRow } = await renderSettings();
    const trigger = within(nodeRow).getByRole('button', { name: 'Roll back' });
    expect(trigger).toHaveClass('btn-danger-ghost');
    expect(trigger).not.toHaveClass('btn-ghost');
    fireEvent.click(trigger);
    expect(await screen.findByRole('button', { name: 'Roll back fleet' })).toHaveClass('btn-danger');
  });

  it("the node row's Ack is danger-ghost, and its confirm commits in danger", async () => {
    const { nodeRow } = await renderSettings();
    const trigger = within(nodeRow).getByRole('button', { name: 'Ack' });
    expect(trigger).toHaveClass('btn-danger-ghost');
    expect(trigger).not.toHaveClass('btn-ghost');
    fireEvent.click(trigger);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Ack' })).toHaveClass('btn-danger');
  });

  it("the halt banner's Ack is danger-ghost, and its confirm commits in danger", async () => {
    render(<><ToastHost /><HaltBanner updates={view()} seq={1} onAcked={() => 2} /></>);
    const trigger = screen.getByRole('button', { name: 'Ack fleet' });
    expect(trigger).toHaveClass('btn-danger-ghost');
    expect(trigger).not.toHaveClass('btn-primary');
    fireEvent.click(trigger);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Ack' })).toHaveClass('btn-danger');
  });

  it('Install and Update stay ghost', async () => {
    const { releases, nodeRow } = await renderSettings();
    expect(within(releases.querySelector<HTMLElement>('li[data-tag="v0.0.10"]')!).getByRole('button', { name: 'Install' })).toHaveClass('btn-ghost');
    expect(within(nodeRow).getByRole('button', { name: 'Update' })).toHaveClass('btn-ghost');
  });

  it("every move button, ghost or danger-ghost, carries buttonVariants({ size: 'fit' })'s classes", async () => {
    const { releases, nodes } = await renderSettings();
    const moves = [...releases.querySelectorAll<HTMLElement>('.settings-move'), ...nodes.querySelectorAll<HTMLElement>('.settings-move')];
    const tones = new Set(moves.map((b) => (b.classList.contains('btn-danger-ghost') ? 'danger-ghost' : b.classList.contains('btn-ghost') ? 'ghost' : 'other')));
    expect(tones).toEqual(new Set(['ghost', 'danger-ghost']));
    for (const b of moves) {
      const variant = b.classList.contains('btn-danger-ghost') ? 'danger-ghost' : 'ghost';
      const want = buttonVariants({ variant, size: 'fit' }).split(/\s+/).filter(Boolean);
      const cls = b.className.split(/\s+/);
      for (const c of want) expect(cls, `${b.textContent}: ${c}`).toContain(c);
    }
  });

  // D-5611: Settings hands the rollback sheet the target's catalogue row. Without it the sheet cannot say the target
  // was withdrawn, and `rollbackTargetRefusal(undefined)` reads an unknown tag, so it would print a false
  // "Roll back not offered" line for every node.
  it("Settings passes the target's catalogue row: a withdrawn target reads withdrawn, with no false blocked line", async () => {
    const { releaseRow } = await renderSettings({ yanked: true });
    fireEvent.click(within(releaseRow).getByRole('button', { name: 'Roll back' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveTextContent(withdrawnRollbackText('v0.0.8'));
    expect(sheet).not.toHaveTextContent('Roll back not offered');
  });

  // D-5610: each Roll back sheet opens with Cancel focused, and closing it hands the focus back to its trigger.
  for (const where of ['release', 'node'] as const) {
    it(`the ${where} row's Roll back: Cancel has the focus, and Cancel gives it back to the trigger`, async () => {
      const { releaseRow, nodeRow } = await renderSettings();
      const trigger = within(where === 'release' ? releaseRow : nodeRow).getByRole('button', { name: 'Roll back' });
      trigger.focus();
      fireEvent.click(trigger);
      const sheet = await screen.findByRole('dialog');
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const cancel = within(sheet).getByRole('button', { name: 'Cancel' });
      expect(document.activeElement).toBe(cancel);
      fireEvent.click(cancel);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(document.activeElement).toBe(trigger);
    });
  }
});
