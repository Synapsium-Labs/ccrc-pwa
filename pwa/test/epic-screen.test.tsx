// The epic page and the Upkeep page (Linear hierarchy design §11.2 and §7.6, D-8184; plan Task 5.3). Neutral fixtures:
// `project-a`, `prog-a`, `KEY-123`, `owner/repo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { EpicView, CheckpointView, TicketView } from '../../shared/plan';
import type { ProjectRow } from '../../shared/api';
import { EPIC_TEXT, dayWords, notClosedWords } from '../src/ledgers/epicWords';
import { itemPath } from '../src/ledgers/ledgerWords';
import { EpicScreen } from '../src/ledgers/EpicScreen';
import { UpkeepScreen } from '../src/ledgers/UpkeepScreen';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { epicPath, matchRoute, runPath, upkeepPath } from '../src/lib/routes';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// A Linear address built from parts, so no literal tracker URL sits in the tree (`topology-clean`'s private tracker id class).
const linearUrl = (...p: string[]): string => ['https:', '', 'linear.app', ...p].join('/');
const EPIC_URL = linearUrl('ws-a', 'epic');

const cp = (over: Partial<CheckpointView>): CheckpointView => ({
  key: 'c1', title: 'Checkpoint one', kind: 'acceptance', state: 'open', proves: [], metAt: null, evidence: null, url: null,
  sync: 'none', syncWord: null, ...over,
});
const tk = (over: Partial<TicketView>): TicketView => ({
  key: 't1', kind: 'task', title: 'Ticket one', project: 'project-a', checkpoint: null, source: 'plan', state: 'open', runId: null,
  identifier: null, url: null, sync: 'none', syncWord: null, ...over,
});
const epic = (over: Partial<EpicView> = {}): EpicView => ({
  key: 'e1', title: 'Epic one', summary: 'The summary.', project: 'project-a', waves: [1], state: 'active', url: null, sync: 'none',
  syncWord: null, checkpoints: [], tickets: [], ...over,
});
const plan = (epics: EpicView[]) => ({ ok: true as const, plan: { program: 'prog-a', planned: true, initiatives: [], epics, doneWhen: [] } });
const projects = (slug: string | null) => vi.spyOn(api, 'projects').mockResolvedValue({
  roots: ['/w'],
  projects: [{
    name: 'project-a', workdir: '/w/project-a',
    ...(slug === null ? {} : { linking: { teamKey: 'KEY', override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
      measured: { state: 'measured', visibility: 'private', slug, template: 'absent', at: 1 } } }),
  } as ProjectRow],
});
const mountEpic = async (e: EpicView, slug: string | null = 'owner/repo'): Promise<void> => {
  projects(slug);
  vi.spyOn(api, 'plan').mockResolvedValue(plan([e]));
  render(<EpicScreen slug="prog-a" epicKey={e.key} />);
  await screen.findByRole('heading', { level: 1, name: e.title });
};

describe('the epic page', () => {
  it('evidence {pr} links the pull request, {itemId} the item, {path} the Docs reader', async () => {
    await mountEpic(epic({ checkpoints: [
      cp({ key: 'a', title: 'A', state: 'met', metAt: Date.UTC(2026, 10, 3), evidence: { pr: 42 } }),
      cp({ key: 'b', title: 'B', evidence: { itemId: 7 } }),
      cp({ key: 'c', title: 'C', evidence: { path: 'docs/superpowers/specs/x.md' } }),
    ] }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'PR #42' })).toHaveAttribute('href', 'https://github.com/owner/repo/pull/42'));
    expect(screen.getByRole('link', { name: 'Item #7' })).toHaveAttribute('href', itemPath(7));
    const doc = screen.getByRole('link', { name: 'docs/superpowers/specs/x.md' });
    expect(doc.getAttribute('href')).toMatch(/^\/docs\/project-a\//);
    expect(screen.getByText('2026-11-03')).toBeInTheDocument();
  });

  it('a pull request with no repository known is plain text, no link', async () => {
    await mountEpic(epic({ checkpoints: [cp({ evidence: { pr: 42 } })] }), null);
    expect(screen.getByText('PR #42')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PR #42' })).toBeNull();
  });

  it('a ticket with a run links /runs/<id>; Open in Linear is the epic\'s url, absent when it has none', async () => {
    await mountEpic(epic({ url: EPIC_URL, tickets: [tk({ runId: 12, state: 'started', identifier: 'KEY-123' })] }));
    expect(screen.getByRole('link', { name: 'Run 12' })).toHaveAttribute('href', runPath(12));
    expect(screen.getByRole('link', { name: EPIC_TEXT.openInLinear })).toHaveAttribute('href', EPIC_URL);
    expect(screen.getByText('Started')).toBeInTheDocument();
  });

  it('an epic with no url shows no Linear link', async () => {
    await mountEpic(epic());
    expect(screen.queryByRole('link', { name: EPIC_TEXT.openInLinear })).toBeNull();
  });

  it('a reporter\'s title is plain text, never markup', async () => {
    await mountEpic(epic({ tickets: [tk({ title: '<img src=x onerror=alert(1)> **bold** [a](http://e)' })] }));
    expect(screen.getByText('<img src=x onerror=alert(1)> **bold** [a](http://e)')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('an unknown epic key says "No such epic in this programme"', async () => {
    projects('owner/repo');
    vi.spyOn(api, 'plan').mockResolvedValue(plan([epic()]));
    render(<EpicScreen slug="prog-a" epicKey="nope" />);
    expect(await screen.findByText('No such epic in this programme')).toBeInTheDocument();
  });

  it('a refused programme and a failed read are told apart', async () => {
    projects(null);
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    const view = render(<EpicScreen slug="prog-a" epicKey="e1" />);
    expect(await screen.findByText(EPIC_TEXT.noSuchProgramme)).toBeInTheDocument();
    view.unmount();
    vi.spyOn(api, 'plan').mockRejectedValue(new TypeError('offline'));
    render(<EpicScreen slug="prog-a" epicKey="e1" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(EPIC_TEXT.noSuchProgramme)).toBeNull();
    expect(screen.queryByText(EPIC_TEXT.noSuchEpic)).toBeNull();
  });

  it('a 404 (a server with no plan route) is a failed read, not "No such programme"', async () => {
    projects(null);
    vi.spyOn(api, 'plan').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    render(<EpicScreen slug="prog-a" epicKey="e1" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(EPIC_TEXT.noSuchProgramme)).toBeNull();
  });

  it('an unknown programme answers 200 with no epics, and reads as no such epic (what the server really says)', async () => {
    projects(null);
    vi.spyOn(api, 'plan').mockResolvedValue(plan([]));
    render(<EpicScreen slug="prog-a" epicKey="e1" />);
    expect(await screen.findByText(EPIC_TEXT.noSuchEpic)).toBeInTheDocument();
    expect(screen.queryByText(EPIC_TEXT.noSuchProgramme)).toBeNull();
  });

  it('a link address that is not https draws no Linear link (a script or a plain http address)', async () => {
    await mountEpic(epic({ url: 'javascript:alert(1)', tickets: [tk({ url: 'http://example.test/x' })] }));
    expect(screen.queryByRole('link', { name: EPIC_TEXT.openInLinear })).toBeNull();
  });

  it('every line state draws the page\'s own h1 (the route walk reads a heading)', async () => {
    projects(null);
    vi.spyOn(api, 'plan').mockRejectedValue(new TypeError('offline'));
    render(<EpicScreen slug="prog-a" epicKey="e1" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('the Upkeep page', () => {
  it('lists its tickets and no checkpoints, and the closes Linear refused', async () => {
    projects('owner/repo');
    vi.spyOn(api, 'upkeep').mockResolvedValue({
      ok: true,
      epic: epic({ key: 'upkeep', title: 'Upkeep', checkpoints: [cp({ title: 'Hidden checkpoint' })], tickets: [tk({ title: 'Fix the thing' })] }),
      notClosed: [{ identifier: 'KEY-123', teamKey: 'KEY', word: 'linear-forbidden', at: Date.UTC(2026, 10, 4) }],
    });
    render(<UpkeepScreen project="project-a" />);
    expect(await screen.findByText('Fix the thing')).toBeInTheDocument();
    expect(screen.queryByText('Hidden checkpoint')).toBeNull();
    expect(screen.queryByRole('heading', { name: EPIC_TEXT.checkpoints })).toBeNull();
    const closes = screen.getByRole('region', { name: EPIC_TEXT.notClosedHeading });
    expect(within(closes).getByText(/KEY-123/)).toBeInTheDocument();
    expect(within(closes).getByText(/no permission/)).toBeInTheDocument();
  });

  it.each([
    ['not-found', 'The issue is gone from Linear'],
    ['linear-forbidden', 'Linear refused the close: no permission'],
    ['linear-invalid', 'Linear did not accept the close'],
    ['malformed', 'Linear answered in a form ccrc could not read'],
    ['policy-denied', 'The write policy denied the close'],
    ['some-other-word', 'Linear refused the close (some-other-word)'],
  ])('a close given up with the word %s reads as its fixed sentence', (word, sentence) => {
    expect(notClosedWords(word)).toBe(sentence);
  });

  it('reads no project list: the Upkeep page has no pull request evidence', async () => {
    const list = projects('owner/repo');
    vi.spyOn(api, 'upkeep').mockResolvedValue({ ok: true, epic: epic({ tickets: [tk({ title: 'Fix the thing' })] }), notClosed: [] });
    render(<UpkeepScreen project="project-a" />);
    await screen.findByText('Fix the thing');
    expect(list).not.toHaveBeenCalled();
  });

  it('a close with no stamp draws no date, and a stamp the clock cannot place never throws', async () => {
    projects(null);
    vi.spyOn(api, 'upkeep').mockResolvedValue({ ok: true, epic: null, notClosed: [
      { identifier: 'KEY-123', teamKey: 'KEY', word: 'not-found', at: null },
      { identifier: 'KEY-124', teamKey: 'KEY', word: 'not-found', at: 1e20 },
    ] });
    render(<UpkeepScreen project="project-a" />);
    const closes = await screen.findByRole('region', { name: EPIC_TEXT.notClosedHeading });
    expect(within(closes).getAllByRole('listitem')).toHaveLength(2);
    expect(dayWords(1e20)).toBe('—');
  });

  it('says so, in a fixed sentence, before the epic\'s first use', async () => {
    projects(null);
    vi.spyOn(api, 'upkeep').mockResolvedValue({ ok: true, epic: null, notClosed: [] });
    render(<UpkeepScreen project="project-a" />);
    expect(await screen.findByText(EPIC_TEXT.noUpkeepYet)).toBeInTheDocument();
  });
});

describe('the two routes', () => {
  it('matchRoute parses both new paths and refuses a bad slug', () => {
    const e = matchRoute('/programmes/prog-a/epics/e-1');
    expect(e?.route.id).toBe('epic');
    expect(e?.param).toBe('prog-a');
    expect(e?.rest).toEqual(['e-1']);
    const u = matchRoute('/projects/project-a/upkeep/');
    expect(u?.route.id).toBe('upkeep');
    expect(u?.param).toBe('project-a');
    expect(u?.rest).toEqual([]);
    expect(matchRoute('/programmes/a.b/epics/e-1')).toBeNull();
    expect(matchRoute('/programmes/prog-a/epics/%zz')).toBeNull();
    expect(matchRoute('/projects/%zz/upkeep')).toBeNull();
  });

  it('the builders round-trip through matchRoute', () => {
    const e = matchRoute(epicPath('prog-a', 'a key/with+odd chars'));
    expect(e?.route.id).toBe('epic');
    expect(e?.rest).toEqual(['a key/with+odd chars']);
    const u = matchRoute(upkeepPath('proj ect/x'));
    expect(u?.route.id).toBe('upkeep');
    expect(u?.param).toBe('proj ect/x');
  });
});
