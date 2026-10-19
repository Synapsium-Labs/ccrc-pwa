// What's new (D-5549): the update banner's "See what's new" opens a sheet in
// place — every release newer than what the fleet runs, newest first, each
// with its notes grouped New / Fixed / Faster / Behind the scenes (the last
// folded), as PLAIN TEXT, every `#NNN` a link built from the number and the
// server's release source alone. Before this, the button navigated to
// /settings, whose release list sits far below the fold, so the tap read as
// doing nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { UpdateBanner } from '../src/fleet/UpdateBanner';
import { WhatsNewSheet, whatsNewReleases } from '../src/fleet/WhatsNewSheet';
import { ReleaseList } from '../src/screens/updates';
import { atBlock, declValue, ruleIn } from './cssRule';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const NOW = Date.now();
const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
const stamp = (version: string): BuildInfo => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version,
});
const fleetNode = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  channel: 'dev', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const serverNode = (over: Partial<NodeWire> = {}): NodeWire =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });

const NOTES_9 = [
  'Changes since v0.0.8', '',
  'New', '- The command palette and shortcuts #626', '',
  'Fixed', '- A claimant may coordinate from any project (#601) #630', '',
  'Behind the scenes', '- Default worker #14', '- Tidy the docs', '',
].join('\n');
const release = (tag: string, notes: string | null, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag.slice(1), channel: 'dev', publishedAt: Date.parse('2026-10-18T09:00:00Z'), commitSha: null,
  bundleListed: true, yanked: false, refused: [], notes, ...over,
});
const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: NOW - 60_000, lastError: null },
  releases: [
    release('v0.0.7', 'Changes since v0.0.6\n\nNew\n- Old news #1\n'),
    release('v0.0.8', null, { publishedAt: Date.parse('2026-10-17T09:00:00Z') }),
    release('v0.0.9', NOTES_9),
    release('v0.0.10', 'Changes since v0.0.9\n\nNew\n- Not offered yet #700\n'),
  ],
  nodes: [fleetNode(), serverNode()],
  intent: [],
  source: { owner: 'owner-a', repo: 'repo-a' },
  ...over,
});

const sheet = (): HTMLElement => screen.getByRole('dialog');
const releaseRow = (tag: string): HTMLElement => {
  const el = sheet().querySelector<HTMLElement>(`[data-tag="${tag}"]`);
  if (el === null) throw new Error(`no row for ${tag}`);
  return el;
};

describe('whatsNewReleases: what the update would bring', () => {
  it('every release above the oldest version a behind node runs, up to the banner tag, newest first', () => {
    const w = whatsNewReleases(view(), 'v0.0.9');
    expect(w.since).toBe('v0.0.7');
    expect(w.releases.map((r) => r.tag)).toEqual(['v0.0.9', 'v0.0.8']);
  });

  it('a node already on the tag does not narrow the range; the oldest behind node does', () => {
    const v = view({ nodes: [fleetNode({ current: stamp('v0.0.6'), highestVersion: 'v0.0.6' }), serverNode({ current: stamp('v0.0.9'), highestVersion: 'v0.0.9', desiredTag: 'v0.0.9' })] });
    expect(whatsNewReleases(v, 'v0.0.9').releases.map((r) => r.tag)).toEqual(['v0.0.9', 'v0.0.8', 'v0.0.7']);
  });

  it('no measured version behind: just the banner tag, and no "since"', () => {
    const v = view({ nodes: [fleetNode({ current: null, stampRead: 'absent' })] });
    const w = whatsNewReleases(v, 'v0.0.9');
    expect(w.since).toBeNull();
    expect(w.releases.map((r) => r.tag)).toEqual(['v0.0.9']);
  });
});

describe("the banner's See what's new opens the sheet in place", () => {
  it('stays on the fleet screen and shows the sheet: title, count, the releases newest first', () => {
    render(<UpdateBanner updates={view()} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    expect(location.pathname).toBe('/');
    expect(within(sheet()).getByText("What's new since v0.0.7")).toBeInTheDocument();
    expect(within(sheet()).getByText('2 releases')).toBeInTheDocument();
    const tags = [...sheet().querySelectorAll('[data-tag]')].map((e) => e.getAttribute('data-tag'));
    expect(tags).toEqual(['v0.0.9', 'v0.0.8']);
  });

  it('Update all in the footer opens the same move sheet as the banner\'s; Close closes', async () => {
    render(<UpdateBanner updates={view()} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update all' }));
    expect(await screen.findByRole('button', { name: 'Update v0.0.9' })).toBeInTheDocument();
    expect(screen.queryByText("What's new since v0.0.7")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText("What's new since v0.0.7")).toBeNull());
  });

  it('while a node halts the fleet, the footer\'s Update all is disabled and says why', () => {
    const halted = view({ nodes: [fleetNode({ update: { state: 'failed', target: 'v0.0.9', startedAt: 1, detail: 'gate' } }), serverNode()] });
    render(<UpdateBanner updates={halted} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    const button = within(sheet()).getByRole('button', { name: 'Update all' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
  });
});

describe('the notes, as plain text in groups', () => {
  const open = (v: UpdatesView = view()): void => {
    render(<WhatsNewSheet open view={v} tag="v0.0.9" halted={null} onClose={() => {}} onUpdateAll={() => {}} />);
  };

  it('New and Fixed are open; Behind the scenes is folded until asked', () => {
    open();
    const row = releaseRow('v0.0.9');
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(within(row).getByText('Fixed')).toBeInTheDocument();
    expect(row.textContent).toContain('The command palette and shortcuts');
    const fold = within(row).getByRole('button', { name: 'Behind the scenes (2)' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(row.textContent).not.toContain('Tidy the docs');
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(row.textContent).toContain('Tidy the docs');
  });

  it('the sheet already says "since"; a release block does not repeat its "Changes since" line', () => {
    open();
    expect(releaseRow('v0.0.9').textContent).not.toContain('Changes since');
  });

  it('each #NNN is a link to the source repo\'s pull request, built from the number alone', () => {
    open();
    const links = within(releaseRow('v0.0.9')).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['#626', 'https://github.com/owner-a/repo-a/pull/626'],
      ['#601', 'https://github.com/owner-a/repo-a/pull/601'],
      ['#630', 'https://github.com/owner-a/repo-a/pull/630'],
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('no release source from the server: the numbers stay text, never a guessed link', () => {
    const v = view();
    delete v.source;
    open(v);
    const row = releaseRow('v0.0.9');
    expect(within(row).queryAllByRole('link')).toEqual([]);
    expect(row.textContent).toContain('#626');
  });

  it('a release with no notes says so, with its date', () => {
    open();
    const row = releaseRow('v0.0.8');
    expect(row.textContent).toContain('No notes for this release');
    expect(row.textContent).toContain('2026-10-17');
  });

  it('a body in any other shape renders as text: no markup, no link taken from it', () => {
    const hostile = '<b>bold</b> <img src=x onerror=alert(1)>\n[click](https://evil.example/x) https://evil.example/y #12';
    open(view({ releases: [release('v0.0.9', hostile)] }));
    const row = releaseRow('v0.0.9');
    expect(row.querySelector('b, img, script')).toBeNull();
    expect(row.textContent).toContain('<b>bold</b>');
    const hrefs = within(row).queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://github.com/owner-a/repo-a/pull/12']);
  });

  it('a source name the PWA cannot trust builds no link', () => {
    open(view({ source: { owner: '..', repo: 'repo-a' } }));
    expect(within(releaseRow('v0.0.9')).queryAllByRole('link')).toEqual([]);
  });
});

describe('Settings → Updates renders a release row\'s notes the same way', () => {
  it('grouped notes in the row: the groups, the fold, the links', () => {
    render(<ReleaseList releases={[release('v0.0.9', NOTES_9)]} nodes={[fleetNode()]} source={{ owner: 'owner-a', repo: 'repo-a' }} onMove={() => {}} />);
    const row = document.querySelector<HTMLElement>('.settings-release[data-tag="v0.0.9"]')!;
    // D-5505: the notes sit behind the row's "Notes" disclosure. v0.0.9 is the waiting release (the node's arrow),
    // so its Notes are open by default and read inside.
    const notes = row.querySelector<HTMLDetailsElement>('details.settings-release-notes-fold')!;
    expect(notes.open).toBe(true);
    expect(within(notes).getByText('Fixed')).toBeInTheDocument();
    expect(within(notes).getByRole('button', { name: 'Behind the scenes (2)' })).toBeInTheDocument();
    expect(within(notes).getAllByRole('link').map((a) => a.textContent)).toEqual(['#626', '#601', '#630']);
    expect(notes.textContent).toContain('Changes since');
    // The row's one-line summary is the first New item, through the same NoteText, never the "Changes since" line.
    expect(row.querySelector('.settings-release-summary')!.textContent).toBe('The command palette and shortcuts #626');
  });
});

describe('the sheet is a centred dialog at ≥900, and paints no colour of its own', () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
  it('the panel rule sits inside a min-width: 900px query and centres the panel', () => {
    const rule = ruleIn(atBlock(css, '@media (min-width: 900px)'), '.whats-new-panel');
    expect(declValue(rule, 'inset')).toBe('0');
    expect(declValue(rule, 'margin')).toBe('auto');
    expect(declValue(rule, 'height')).toBe('fit-content');
    expect(declValue(rule, 'color')).toBeNull();
    expect(declValue(rule, 'background')).toBeNull();
    // vaul's overscroll cover under a bottom drawer would show as a strip below a centred dialog.
    expect(declValue(ruleIn(atBlock(css, '@media (min-width: 900px)'), '.whats-new-panel::after'), 'content')).toBe('none !important');
  });
});
