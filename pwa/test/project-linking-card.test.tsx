// Settings › Security › Project linking (D-8147, linking-standard plan Task 8): one row per project from
// `GET /api/projects`' `linking` cell. Neutral fixtures: `project-a`, `KEY`, `owner/repo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { LINKING_REFUSALS, type ProjectLinkingWire } from '../../shared/linking';
import type { ProjectRow } from '../../shared/api';
import type { HierarchyAnswer, HierarchyProjectRow } from '../../shared/plan';
import { HIERARCHY_TEXT } from '../src/fleet/hierarchyWords';
import { itemPath } from '../src/ledgers/ledgerWords';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { LINKING_REFUSAL_TEXT, LINKING_ROUTE_TEXT } from '../src/lib/refusalWords';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { LINKING_TEXT, ProjectLinkingCard } from '../src/screens/settings/ProjectLinkingCard';
import { candidateLabel, candidateWhy, evidenceWords, linkingRowsOf, teamLinkLine } from '../src/fleet/linkingWords';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const measured = (over: Partial<Extract<ProjectLinkingWire['measured'], { state: 'measured' }>> = {}): ProjectLinkingWire['measured'] =>
  ({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3 * 3_600_000, ...over });
const wire = (over: Partial<ProjectLinkingWire> = {}): ProjectLinkingWire =>
  ({ teamKey: null, override: null, measured: measured(), mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false, ...over });
const row = (name: string, linking?: ProjectLinkingWire): ProjectRow =>
  ({ name, workdir: `/w/${name}`, ...(linking === undefined ? {} : { linking }) });
const serve = (projects: ProjectRow[]) => vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
let answer: HierarchyAnswer | null = null;
// `null`: an older server (the route is absent, 404); an Error: a read that failed; an answer: the route's answer.
const mount = async (projects: ProjectRow[], hier: HierarchyAnswer | Error | null = null): Promise<HTMLElement> => {
  serve(projects);
  answer = hier instanceof Error ? null : hier;
  const read = vi.spyOn(api, 'hierarchy');
  if (hier === null) read.mockRejectedValue(new ApiError(404, { ok: false }));
  else if (hier instanceof Error) read.mockRejectedValue(hier);
  else read.mockImplementation(async () => answer!);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await act(async () => { render(<><ToastHost /><ProjectLinkingCard /></>); });
  return screen.findByRole('region', { name: SETTINGS_CARDS.security.linking.title });
};
const rowOf = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-linking-row="${name}"]`)!;
const keyField = (name: string): HTMLInputElement => within(rowOf(name)).getByLabelText(LINKING_TEXT.teamKey) as HTMLInputElement;
const overrideSelect = (name: string): HTMLSelectElement => within(rowOf(name)).getByLabelText(LINKING_TEXT.override) as HTMLSelectElement;

describe('the card', () => {
  it('renders one row per project with its key, visibility and template', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'KEY', measured: measured({ template: 'present' }) })),
      row('project-b', wire({ measured: { state: 'unmeasured' }, mode: 'unknown' })),
      row('project-c', wire({ measured: { state: 'failed', reason: 'offline', at: NOW - 60_000 }, mode: 'unknown' })),
    ]);
    const a = within(rowOf('project-a'));
    expect(a.getByText('project-a')).toBeInTheDocument();
    expect(keyField('project-a').value).toBe('KEY');
    expect(a.getByText('Private, read 3h ago')).toBeInTheDocument();
    expect(a.getByText(LINKING_TEXT.templatePresent)).toBeInTheDocument();
    expect(overrideSelect('project-a').value).toBe('');
    expect(within(rowOf('project-b')).getByText(LINKING_TEXT.notRead)).toBeInTheDocument();
    expect(within(rowOf('project-c')).getByText("Couldn't read: offline")).toBeInTheDocument();
  });

  it('saving a key renders the stored row', async () => {
    await mount([row('project-a', wire())]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'KEY' }) });
    fireEvent.change(keyField('project-a'), { target: { value: 'key' } });
    expect(keyField('project-a').value).toBe('KEY');
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'KEY', override: null }));
    await within(rowOf('project-a')).findByText(LINKING_TEXT.saved);
    expect(keyField('project-a').value).toBe('KEY');
  });

  it('an empty key clears it', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire() });
    fireEvent.change(keyField('project-a'), { target: { value: '  ' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: null, override: null }));
  });

  it('an override change sends override and renders the answer', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: wire({ teamKey: 'KEY', override: 'public', mode: 'public' }),
    });
    fireEvent.change(overrideSelect('project-a'), { target: { value: 'public' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'KEY', override: 'public' }));
    await waitFor(() => expect(overrideSelect('project-a').value).toBe('public'));
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
  });

  it('the template button shows only for a private project with no template and a key', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'KEY' })),
      row('project-b', wire({ teamKey: null })),
      row('project-c', wire({ teamKey: 'KEY', mode: 'public', measured: measured({ visibility: 'public' }) })),
      row('project-d', wire({ teamKey: 'KEY', measured: measured({ template: 'present' }) })),
      row('project-e', wire({ teamKey: 'KEY', measured: { state: 'unmeasured' }, mode: 'unknown' })),
    ]);
    const button = (n: string) => within(rowOf(n)).queryByRole('button', { name: LINKING_TEXT.openTemplate });
    expect(button('project-a')).toBeInTheDocument();
    for (const n of ['project-b', 'project-c', 'project-d', 'project-e']) expect(button(n), n).toBeNull();
  });

  it('the template act confirms first and shows the PR link', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    const open = vi.spyOn(api, 'openTemplatePr').mockResolvedValue({ ok: true, url: 'https://github.com/owner/repo/pull/7' });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.openTemplate }));
    expect(open).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('owner/repo');
    expect(dialog).toHaveTextContent('.github/pull_request_template.md');
    fireEvent.click(within(dialog).getByRole('button', { name: LINKING_TEXT.openTemplateConfirm }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('project-a'));
    const link = await within(rowOf('project-a')).findByRole('link', { name: LINKING_TEXT.templatePr });
    expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/7');
  });

  it('each refusal word renders its fixed sentence', async () => {
    for (const word of LINKING_REFUSALS) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
      vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(400, { ok: false, error: word, detail: 'box text that must not show' }));
      fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
      const sentence = await within(rowOf('project-a')).findByRole('status');
      expect(sentence.textContent, word).toBe(LINKING_REFUSAL_TEXT[word]);
      expect(sentence.textContent).not.toContain('box text');
      vi.restoreAllMocks();
    }
  });

  it('the template act\'s refusal is its fixed sentence, never the box\'s stderr', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    vi.spyOn(api, 'openTemplatePr').mockRejectedValue(new ApiError(502, { ok: false, error: 'template-failed', stderr: 'pr-template: push failed for ccrc/linking-template — nothing was opened' }));
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.openTemplate }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: LINKING_TEXT.openTemplateConfirm }));
    const sentence = await within(rowOf('project-a')).findByRole('status');
    expect(sentence.textContent).toBe(LINKING_REFUSAL_TEXT['template-failed']);
    expect(sentence.textContent).not.toContain('push failed');
  });

  it('the write route\'s own words (write-failed, bad-request) are sentences, not bare words', async () => {
    for (const word of ['write-failed', 'bad-request']) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
      vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(503, { ok: false, error: word, detail: 'box text that must not show' }));
      fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
      const sentence = await within(rowOf('project-a')).findByRole('status');
      expect(sentence.textContent, word).toBe(LINKING_ROUTE_TEXT[word as 'write-failed' | 'bad-request']);
      expect(sentence.textContent).not.toBe(word);
      expect(sentence.textContent).not.toContain('box text');
      vi.restoreAllMocks();
    }
  });

  it('a project with no linking cell renders nothing', async () => {
    await mount([row('project-a'), row('project-b', wire())]);
    expect(rowOf('project-a')).toBeNull();
    expect(rowOf('project-b')).not.toBeNull();
  });

  it('uses the long word for an internal repository', async () => {
    await mount([row('project-a', wire({ measured: measured({ visibility: 'internal' }) }))]);
    expect(within(rowOf('project-a')).getByText('Internal, read 3h ago')).toBeInTheDocument();
  });
});

describe('D-8405: one row per project, and the automatic team link', () => {
  it('a project the route answers once per checkout directory is ONE row (the first cell wins)', async () => {
    const dup = (workdir: string, linking: ProjectLinkingWire): ProjectRow => ({ name: 'project-a', workdir, linking });
    const rows = [
      dup('/w/project-a', wire({ teamKey: 'KEY' })), dup('/w2/project-a', wire()), dup('/w3/project-a', wire()),
      dup('/w4/project-a', wire()), row('project-b', wire()), row('project-c'),
    ];
    expect(linkingRowsOf(rows).map((r) => [r.name, r.linking.teamKey])).toEqual([['project-a', 'KEY'], ['project-b', null]]);
    await mount(rows);
    expect([...document.querySelectorAll('[data-linking-row]')].map((e) => e.getAttribute('data-linking-row'))).toEqual(['project-a', 'project-b']);
    expect(keyField('project-a').value).toBe('KEY');
  });

  it('a key the pass linked says so, with its evidence; a typed key says nothing more', async () => {
    const auto = wire({ teamKey: 'AAA', teamLink: { source: 'auto', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, at: NOW } });
    await mount([row('project-a', auto), row('project-b', wire({ teamKey: 'BBB', teamLink: { source: 'manual', at: NOW } }))]);
    const line = 'Linked automatically to Alpha: 9 of 10 ticket ids in its branches, pull requests and commits use AAA.';
    expect(teamLinkLine(auto)).toBe(line);
    expect(within(rowOf('project-a')).getByText(line)).toBeInTheDocument();
    expect(rowOf('project-b').querySelector('[data-linking-auto]')).toBeNull();
  });

  it('a project with no key offers the candidates; one tap saves that key as the operator\'s', async () => {
    const candidates = [
      { key: 'AAA', name: 'Alpha', evidence: { kind: 'ticket-ids' as const, ids: 2, of: 3 } },
      { key: 'BBB', name: 'project-a', evidence: { kind: 'name-match' as const, matched: 'project' as const, on: 'name' as const } },
    ];
    await mount([row('project-a', wire({ override: 'private', teamCandidates: candidates }))]);
    const r = within(rowOf('project-a'));
    expect(r.getByRole('group', { name: LINKING_TEXT.candidates })).toBeInTheDocument();
    expect(r.getByText(candidateWhy(candidates[1]!))).toBeInTheDocument();
    expect(candidateWhy(candidates[1]!)).toBe('project-a: the project name matches the team name');
    expect(candidateLabel(candidates[0]!)).toBe('Link AAA');
    expect(evidenceWords(candidates[0]!.evidence, 'AAA')).toBe('2 of 3 ticket ids in its branches, pull requests and commits use AAA');
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({
      ok: true, linking: wire({ teamKey: 'BBB', override: 'private', teamLink: { source: 'manual', at: NOW } }),
    });
    fireEvent.click(r.getByRole('button', { name: candidateLabel(candidates[1]!) }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'BBB', override: 'private' }));
    await waitFor(() => expect(keyField('project-a').value).toBe('BBB'));
    expect(r.queryByRole('group', { name: LINKING_TEXT.candidates })).toBeNull();
  });

  it('a key the operator cleared says why it stays unlinked; an older server\'s row says nothing', async () => {
    await mount([row('project-a', wire({ teamLink: { source: 'manual', at: NOW } })), row('project-b', wire())]);
    expect(within(rowOf('project-a')).getByText('The key was cleared here, so it is not linked automatically.')).toBeInTheDocument();
    expect(rowOf('project-b').querySelector('[data-linking-auto]')).toBeNull();
    expect(within(rowOf('project-b')).queryByRole('group', { name: LINKING_TEXT.candidates })).toBeNull();
  });
});

// The hierarchy settings (Linear hierarchy design §11.1, D-8184, plan Task 5.1). Neutral fixtures: `AAA`, `BBB`, `coord-a`.
const hrow = (project: string, over: Partial<HierarchyProjectRow> = {}): HierarchyProjectRow => ({
  project, teamKey: 'AAA', initiatives: 'on', linearOwner: null, ownerNow: { id: 'coord-a', source: 'default', live: true },
  ownsTeam: false, state: 'not-migrated', stateAt: null, itemId: null, inboundWaiting: 0, ...over,
});
const hier = (projects: HierarchyProjectRow[]): HierarchyAnswer =>
  ({ ok: true, projects, coordinators: [{ id: 'coord-a', live: true }, { id: 'coord-b', live: false }] });
const ownerSelect = (n: string): HTMLSelectElement => within(rowOf(n)).getByLabelText(HIERARCHY_TEXT.owner) as HTMLSelectElement;

describe('the hierarchy settings', () => {
  it('the empty owner option names the default and whether it is live', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))], hier([
      hrow('project-a'),
      hrow('project-b', { teamKey: 'BBB', ownerNow: { id: null, source: 'none', live: false } }),
    ]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-b')).getByText('Default: none live')).toBeInTheDocument();
  });

  it('saving the owner renders the stored row', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const save = vi.spyOn(api, 'saveHierarchy').mockImplementation(async () => {
      answer = hier([hrow('project-a', { linearOwner: 'coord-b', ownerNow: { id: 'coord-b', source: 'named', live: false } })]);
      return { ok: true, settings: { initiatives: 'on', linearOwner: 'coord-b', ownsTeam: false } };
    });
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { initiatives: 'on', linearOwner: 'coord-b', ownsTeam: false }));
    await waitFor(() => expect(ownerSelect('project-a').value).toBe('coord-b'));
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
  });

  it('the initiatives toggle saves the other way round', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    const save = vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'off', linearOwner: null, ownsTeam: false } });
    fireEvent.click(await within(rowOf('project-a')).findByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { initiatives: 'off', linearOwner: null, ownsTeam: false }));
  });

  it('the owning-project control shows only for a shared key', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'aaa' })), row('project-c', wire({ teamKey: 'BBB' })),
    ], hier([hrow('project-a'), hrow('project-b'), hrow('project-c', { teamKey: 'BBB' })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const own = (n: string) => within(rowOf(n)).queryByRole('checkbox', { name: HIERARCHY_TEXT.owning });
    expect(own('project-a')).not.toBeNull();
    expect(own('project-b')).not.toBeNull();
    expect(own('project-c')).toBeNull();
  });

  it('the state line links the map item and counts inbound issues', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))], hier([
      hrow('project-a', { state: 'map-waiting', itemId: 42, inboundWaiting: 3 }),
      hrow('project-b', { teamKey: 'BBB', state: 'migrated', stateAt: Date.UTC(2026, 10, 12, 8) }),
    ]));
    const link = await within(rowOf('project-a')).findByRole('link', { name: HIERARCHY_TEXT.mapWaiting });
    expect(link.getAttribute('href')).toBe(itemPath(42));
    expect(within(rowOf('project-a')).getByText('3 inbound issues wait for an owner')).toBeInTheDocument();
    expect(await within(rowOf('project-b')).findByText('Migrated on 2026-11-12')).toBeInTheDocument();
  });

  it('a refusal shows its fixed sentence', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'saveHierarchy').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed', detail: 'disk path /x' }));
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    expect(await within(rowOf('project-a')).findByText(LINKING_ROUTE_TEXT['write-failed'])).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('disk path');
  });

  it('making one coordinator the owner of every project asks first', async () => {
    const region = await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    const all = vi.spyOn(api, 'ownerForAll').mockResolvedValue({ ok: true, projects: 1 });
    fireEvent.change(await within(region).findByLabelText(HIERARCHY_TEXT.allPick), { target: { value: 'coord-b' } });
    fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
    expect(all).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
    await waitFor(() => expect(all).toHaveBeenCalledWith('coord-b'));
  });

  it('a sibling that lost the team loses its checked box and its next write sends ownsTeam false (one source)', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA', ownsTeam: true }))],
      hier([hrow('project-a'), hrow('project-b', { ownsTeam: true })]));
    const own = (n: string) => within(rowOf(n)).findByRole('checkbox', { name: HIERARCHY_TEXT.owning });
    expect((await own('project-b')).getAttribute('aria-checked')).toBe('true');
    const save = vi.spyOn(api, 'saveHierarchy').mockImplementation(async (project) => {
      if (project === 'project-a') answer = hier([hrow('project-a', { ownsTeam: true }), hrow('project-b', { ownsTeam: false })]);
      return { ok: true, settings: { initiatives: 'on', linearOwner: null, ownsTeam: project === 'project-a' } };
    });
    fireEvent.click(await own('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { initiatives: 'on', linearOwner: null, ownsTeam: true }));
    await waitFor(async () => expect((await own('project-b')).getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(within(rowOf('project-b')).getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('project-b', { initiatives: 'off', linearOwner: null, ownsTeam: false }));
  });

  it('a team key Save re-reads the hierarchy, so the owning-project control follows the key', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a'), hrow('project-b', { teamKey: 'BBB' })]));
    const own = () => within(rowOf('project-b')).queryByRole('checkbox', { name: HIERARCHY_TEXT.owning });
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    expect(own()).toBeNull();
    vi.spyOn(api, 'saveLinking').mockImplementation(async () => {
      answer = hier([hrow('project-a'), hrow('project-b', { teamKey: 'AAA' })]);
      return { ok: true, linking: wire({ teamKey: 'AAA' }) };
    });
    fireEvent.change(keyField('project-b'), { target: { value: 'AAA' } });
    fireEvent.click(within(rowOf('project-b')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(own()).not.toBeNull());
  });

  it('a failed hierarchy read says so; an older server (404) draws no hierarchy controls and no note', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], new Error('offline'));
    expect(await screen.findByText(HIERARCHY_TEXT.unreadable)).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByLabelText(HIERARCHY_TEXT.owner)).toBeNull();
    cleanup();
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], null);
    expect(screen.queryByText(HIERARCHY_TEXT.unreadable)).toBeNull();
    expect(screen.queryByText(HIERARCHY_TEXT.allAct)).toBeNull();
  });

  // I2 (final review): a write's re-read is held pending, so the answer shown is the old one for a while.
  const held = <T,>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
    let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const initiativesBox = (n: string) => within(rowOf(n)).getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives });

  it('the controls stay locked until the write\'s re-read settles, so back-to-back writes do not undo each other', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const reread = held<HierarchyAnswer>();
    const save = vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'off', linearOwner: null, ownsTeam: false } });
    vi.mocked(api.hierarchy).mockImplementation(() => reread.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The POST has landed and the GET is in flight: the select and the checkbox are locked, so no stale body can go out.
    await waitFor(() => expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument());
    expect(ownerSelect('project-a')).toBeDisabled();
    fireEvent.click(initiativesBox('project-a'));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { reread.resolve(hier([hrow('project-a', { initiatives: 'off' })])); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('project-a', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false }));
  });

  it('a re-read that was started earlier and settles later is ignored (only the newest lands)', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a'), hrow('project-b', { teamKey: 'BBB' })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const first = held<HierarchyAnswer>();
    const second = held<HierarchyAnswer>();
    vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'off', linearOwner: null, ownsTeam: false } });
    vi.mocked(api.hierarchy).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    fireEvent.click(initiativesBox('project-b'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(3));
    // The third read (the second write's) lands with both off; then the first read lands late with the old, both-on answer.
    const newest = hier([hrow('project-a', { initiatives: 'off' }), hrow('project-b', { teamKey: 'BBB', initiatives: 'off' })]);
    const old = hier([hrow('project-a'), hrow('project-b', { teamKey: 'BBB' })]);
    vi.mocked(api.hierarchy).mockImplementation(async () => newest);
    await act(async () => { second.resolve(newest); });
    await act(async () => { first.resolve(old); });
    await waitFor(() => expect(initiativesBox('project-a').getAttribute('aria-checked')).toBe('false'));
    expect(initiativesBox('project-b').getAttribute('aria-checked')).toBe('false');
  });

  it('a failed re-read after a write keeps the last good answer and its controls, and says the re-read failed', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'off', linearOwner: null, ownsTeam: false } });
    vi.mocked(api.hierarchy).mockRejectedValue(new TypeError('offline'));
    fireEvent.click(initiativesBox('project-a'));
    expect(await screen.findByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    expect(screen.queryByText(HIERARCHY_TEXT.unreadable)).toBeNull();
    expect(ownerSelect('project-a')).toBeInTheDocument();
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
  });

  it('a stamp the clock cannot place says no date rather than throwing', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { state: 'migrated', stateAt: 1e20 })]));
    expect(await within(rowOf('project-a')).findByText('Migrated')).toBeInTheDocument();
  });

  it('the all-projects act is not drawn while the project list is empty', async () => {
    await mount([], hier([]));
    expect(screen.queryByText(HIERARCHY_TEXT.allAct)).toBeNull();
  });

  it('a default owner that is not live says so, and so does a named one', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA', linearOwner: 'coord-z' })), row('project-b', wire({ teamKey: 'BBB' }))], hier([
      hrow('project-a', { linearOwner: 'coord-z', ownerNow: { id: 'coord-z', source: 'named', live: false } }),
      hrow('project-b', { teamKey: 'BBB', ownerNow: { id: 'coord-b', source: 'default', live: false } }),
    ]));
    expect(await within(rowOf('project-b')).findByText('Default: coord-b (not live)')).toBeInTheDocument();
    expect(within(rowOf('project-a')).getByText('coord-z (not live)')).toBeInTheDocument();
  });
});
