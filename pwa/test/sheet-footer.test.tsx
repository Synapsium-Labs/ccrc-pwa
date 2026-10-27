// The Sheet's pinned footer (D-5932, spec §2.5).
//
// WHAT WENT WRONG. A sheet's action row was the last child of its scrolling body, so a tall body scrolled it away:
// What's new with several releases put Update all below the fold of a phone, and a long consequence did the same to
// a confirm's answers. `Sheet` now takes a `footer`, drawn after `.sheet-body` as a `flex-none` row of the panel, so
// the body shrinks and scrolls while the footer stays inside the panel, at every width. The `full` variant (the
// terminal drawer) takes none: `sheet.test-d.tsx` holds that at the type level.
//
// jsdom lays nothing out, so the "stays inside the panel" row holds the flex arithmetic that pins it (a column panel
// capped in height, a body that may shrink below its content and scrolls, a footer that may not shrink); the real
// rects are `browser/sheet-footer.browser.test.tsx`'s, at 360/390/1280/1920 in both skins and both palettes.
//
// The seven `QC_ACTIONS` rows (`QuickConfirm` and six fleet sheets) each render in the footer, never in the body.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NodeWire, ReleaseWire, RunSummary, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { Button, QC_CONSEQUENCE, QuickConfirm, Sheet } from '@ccrc/ui';
import { AbandonSheet } from '../src/fleet/AbandonSheet';
import { ArchiveConflictSheet } from '../src/fleet/ArchiveConflictSheet';
import { ArchiveSheet } from '../src/fleet/ArchiveSheet';
import { ResumeSheet } from '../src/fleet/ResumeSheet';
import { UpdateMoveSheet } from '../src/fleet/UpdateMoveSheet';
import { WhatsNewSheet } from '../src/fleet/WhatsNewSheet';
import { planMove } from '../src/fleet/movePlan';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const panel = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.sheet-panel');
  if (el === null) throw new Error('no open sheet panel');
  return el;
};
const classes = (el: Element | null): string[] => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('Sheet: the footer is a row of the panel, outside the scrolling body', () => {
  const mount = (): void => {
    render(
      <Sheet open onClose={() => {}} title="A long question" footer={<Button>Answer</Button>}>
        {Array.from({ length: 60 }, (_, i) => <p key={i}>line {i}</p>)}
      </Sheet>,
    );
  };

  it('the footer is not a descendant of .sheet-body', () => {
    mount();
    const footer = panel().querySelector('.sheet-footer');
    expect(footer, 'no .sheet-footer drawn').not.toBeNull();
    expect(footer!.closest('.sheet-body')).toBeNull();
    expect(footer!.textContent).toBe('Answer');
    expect(panel().querySelector('.sheet-body')!.textContent).not.toContain('Answer');
  });

  it("with a body taller than the panel, the footer's rect stays inside the panel (the flex arithmetic; the browser leg measures)", () => {
    mount();
    const p = panel();
    const body = p.querySelector('.sheet-body');
    const footer = p.querySelector('.sheet-footer');
    expect(footer, 'no .sheet-footer drawn').not.toBeNull();
    // The panel is a column capped below the viewport…
    expect(classes(p)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
    expect(classes(p).some((c) => c.startsWith('max-h-'))).toBe(true);
    // …the body may shrink below its content and scrolls what it lost…
    expect(classes(body)).toEqual(expect.arrayContaining(['min-h-0', 'overflow-y-auto']));
    // …and the footer is the panel's last row, which may not shrink.
    expect(p.lastElementChild).toBe(footer);
    expect(classes(footer)).toContain('flex-none');
  });

  // D-6030: the footer may not shrink, so it carries its own ceiling. Uncapped, a tall footer (the resume sheet's
  // five reclaim controls) squeezed the body to 0px in a landscape phone and hid the title and the question.
  it('the footer has a ceiling and scrolls past it, with room for the focus rings at its sides', () => {
    mount();
    const rows = panel().querySelector('.sheet-footer > .sheet-footer-rows');
    expect(rows, 'no .sheet-footer-rows scroller inside the footer').not.toBeNull();
    expect(rows!.textContent).toBe('Answer');
    expect(classes(rows).some((c) => /^max-h-\[\d+dvh\]$/.test(c)), 'no viewport-relative max-h on the footer rows').toBe(true);
    expect(classes(rows)).toEqual(expect.arrayContaining(['overflow-y-auto', 'overscroll-contain', '-m-1', 'p-1']));
  });

  it('a full sheet draws no footer even when a caller slips one past the type', () => {
    render(<Sheet full open onClose={() => {}} title="t" {...({ footer: <b>pinned</b> } as object)}>body</Sheet>);
    expect(document.querySelector('.sheet-footer')).toBeNull();
  });

  it('a sheet given no footer draws none', () => {
    render(<Sheet open onClose={() => {}} title="t">body</Sheet>);
    expect(panel().querySelector('.sheet-footer')).toBeNull();
  });
});

// ── the seven consumers ─────────────────────────────────────────────────────

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'program-a', programTitle: 'Program A',
  wave: 3, waveOf: 4, project: 'project-a', homeProject: null,
  sessionId: 'project-a-worker', workspace: 'worker', branch: 'ws/worker',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'project-a-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, ...over,
});

const stamp = (version: string): BuildInfo => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version,
});
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  measuredAt: Date.now() - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const release = (tag: string): ReleaseWire => ({
  tag, version: tag.slice(1), channel: 'stable', publishedAt: Date.parse('2026-10-18T09:00:00Z'), commitSha: null,
  bundleListed: true, yanked: false, refused: [], notes: 'Changes since v0.0.9\n\nNew\n- A thing #1\n',
});
const updates: UpdatesView = {
  catalogue: { lastOkAt: Date.now() - 60_000, lastError: null },
  releases: [release('v0.0.10')], nodes: [node()], intent: [],
};

const SEVEN: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ['QuickConfirm', () => <QuickConfirm open title="Release it?" consequence="It goes." confirmLabel="Release"
                                       onConfirm={() => {}} onClose={() => {}} />],
  ['ArchiveConflictSheet', () => <ArchiveConflictSheet sessionId="project-a-worker" runs={[{ id: 17, program: 'program-a', wave: 2, waveOf: 3 }]}
                                                       onClose={() => {}} archive={vi.fn()} />],
  ['AbandonSheet', () => <AbandonSheet run={run()} onClose={() => {}} abandonRun={vi.fn()} />],
  ['ArchiveSheet', () => <ArchiveSheet session={fleetSession({ id: 'project-a-worker', workdir: '/w/project-a/worker', workspace: 'worker' })}
                                       open onClose={() => {}} archive={vi.fn()} fleet={createFleetStore()} />],
  ['WhatsNewSheet', () => <WhatsNewSheet open view={updates} tag="v0.0.10" halted={null}
                                         onClose={() => {}} onUpdateAll={() => {}} />],
  ['UpdateMoveSheet', () => <UpdateMoveSheet open plan={planMove(updates, { scope: 'fleet', direction: 'update', tag: 'v0.0.10' })}
                                             onClose={() => {}} onDone={() => {}} />],
  ['ResumeSheet', () => <ResumeSheet run={run()} onClose={() => {}} ensure={async () => {}}
                                     kickoff={async () => ({ queued: true })} reclaimRun={vi.fn()} />],
];

describe('each of the seven renders its actions in .sheet-footer', () => {
  for (const [name, draw] of SEVEN) {
    it(name, () => {
      render(<>{draw()}</>);
      const p = panel();
      const row = p.querySelector('.qc-actions');
      expect(row, `${name} draws no .qc-actions row`).not.toBeNull();
      expect(row!.closest('.sheet-footer'), `${name}'s actions are not in the footer`).not.toBeNull();
      expect(p.querySelector('.sheet-body .qc-actions'), `${name} left an actions row in the body`).toBeNull();
      expect(row!.querySelectorAll('button').length).toBeGreaterThan(0);
    });
  }
});

describe('a consequence that ends its body spends no margin there', () => {
  // The answers used to follow the last consequence inside the body (or a sheet's card); now nothing does, and its
  // `mb-5` would only pad the card's foot. Between lines, and above an error line, the margin stays.
  it('QC_CONSEQUENCE drops its bottom margin when it is the last child', () => {
    expect(QC_CONSEQUENCE.split(' ')).toEqual(expect.arrayContaining(['mb-5', 'last:mb-0']));
  });
});
