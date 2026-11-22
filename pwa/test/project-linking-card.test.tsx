// Settings › Integrations › Project linking (D-8147, linking-standard plan Task 8; the compact list,
// D-8932): one row per project from `GET /api/projects`' `linking` cell. Neutral fixtures:
// `project-a`, `KEY`, `owner/repo`. The card takes the section's one read of the project list (`useProjectList`), so the
// mount below gives it one through a host, as `IntegrationsSection` does.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { LINKING_REFUSALS, type ProjectLinkingWire } from '../../shared/linking';
import type { ProjectRow } from '../../shared/api';
import type { HierarchyAnswer, HierarchyProjectRow } from '../../shared/plan';
import { HIERARCHY_TEXT, reshapeConsequence, reshapeTitle, ownerForAllConsequence, defaultOwnerWords, namedOwnerWords, ownerInheritedNote } from '../src/fleet/hierarchyWords';
import { itemPath } from '../src/ledgers/ledgerWords';
import { api } from '../src/lib/api';
import { upkeepPath } from '../src/lib/routes';
import { ApiError } from '../src/lib/apiError';
import { LINKING_REFUSAL_TEXT, LINKING_ROUTE_TEXT, MIGRATE_REFUSAL_TEXT, linkingErrorText } from '../src/lib/refusalWords';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import type { LinearLegacyRow, LinearWorkspaceView } from '../../shared/linear';
import { LINKING_TEXT, ProjectLinkingCard } from '../src/screens/settings/ProjectLinkingCard';
import { useProjectList } from '../src/screens/settings/useProjectList';
import { candidateLabel, candidateWhy, evidenceWords, linkingRowsOf, teamLinkLine } from '../src/fleet/linkingWords';

afterEach(() => { cleanup(); vi.restoreAllMocks(); supplied = null; suppliedLegacy = null; });

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const measured = (over: Partial<Extract<ProjectLinkingWire['measured'], { state: 'measured' }>> = {}): ProjectLinkingWire['measured'] =>
  ({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3 * 3_600_000, ...over });
const wire = (over: Partial<ProjectLinkingWire> = {}): ProjectLinkingWire =>
  ({ teamKey: null, override: null, measured: measured(), mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false, ...over });
const row = (name: string, linking?: ProjectLinkingWire): ProjectRow =>
  ({ name, workdir: `/w/${name}`, ...(linking === undefined ? {} : { linking }) });
const serve = (projects: ProjectRow[]) => vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
let answer: HierarchyAnswer | null = null;
// The frame's one workspace list, handed to the card as a prop (`serveWorkspaces` sets it).
let supplied: LinearWorkspaceView[] | null = null;
let suppliedLegacy: LinearLegacyRow | null = null;
/** The card over one read of the project list, as the Integrations section mounts it. */
function Card(): React.ReactNode {
  const list = useProjectList();
  return <ProjectLinkingCard workspaces={supplied} legacy={suppliedLegacy} list={list} />;
}
// `null`: an older server (the route is absent, 404); an Error: a read that failed; an answer: the route's answer.
const mount = async (projects: ProjectRow[], hier: HierarchyAnswer | Error | null = null): Promise<HTMLElement> => {
  serve(projects);
  answer = hier instanceof Error ? null : hier;
  const read = vi.spyOn(api, 'hierarchy');
  if (hier === null) read.mockRejectedValue(new ApiError(404, { ok: false }));
  else if (hier instanceof Error) read.mockRejectedValue(hier);
  else read.mockImplementation(async () => answer!);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await act(async () => { render(<><ToastHost /><Card /></>); });
  return screen.findByRole('region', { name: SETTINGS_CARDS.integrations.linking.title });
};
const rowOf = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-linking-row="${name}"]`)!;
// A listed row's field is labelled "Team key"; an unlinked row's has no visible label and is named for its project.
const keyField = (name: string): HTMLInputElement => within(rowOf(name)).getByLabelText(/^Team key( for .+)?$/) as HTMLInputElement;
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
      // A key write's team-ambiguous points at the picker (review 2971 F4); with no workspace list read, it says so.
      expect(sentence.textContent, word).toBe(word === 'team-ambiguous' ? PICKER_WORDS.ambiguousUnlisted : LINKING_REFUSAL_TEXT[word]);
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

  it('bad-request is a sentence, not a bare word; write-failed is a 503 the card reads as unconfirmed, never "Nothing was changed" (D-8186 A6)', async () => {
    await mount([row('project-a', wire({ teamKey: 'KEY' }))]);
    vi.spyOn(api, 'saveLinking').mockRejectedValueOnce(new ApiError(400, { ok: false, error: 'bad-request', detail: 'box text that must not show' }));
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    const sentence = await within(rowOf('project-a')).findByRole('status');
    expect(sentence.textContent).toBe(LINKING_ROUTE_TEXT['bad-request']);
    expect(sentence.textContent).not.toContain('box text');
    // The pair the server sends: `write-failed` is a 503 from a catch block, so the write may have landed.
    vi.spyOn(api, 'saveLinking').mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'write-failed', detail: 'box text that must not show' }));
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed);
    expect(within(rowOf('project-a')).queryByText(LINKING_ROUTE_TEXT['write-failed'])).toBeNull();
    expect(document.body.textContent).not.toContain('box text');
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
/** A coordinator select offers the live coordinators; the rest sit behind its "show" control (D-8932).
 *  These helpers open it first, so a case can pick `coord-b`, which is not live; the cases of the select's own shape, at the
 *  foot of this file, read it as it is drawn. */
const showNotLive = (scope: HTMLElement): void => {
  const more = scope.querySelector<HTMLElement>('[data-linking-more][aria-expanded="false"]');
  if (more !== null) fireEvent.click(more);
};
const ownerSelect = (n: string): HTMLSelectElement => {
  showNotLive(rowOf(n).querySelector<HTMLElement>('.linking-owner') ?? rowOf(n));
  return within(rowOf(n)).getByLabelText(HIERARCHY_TEXT.owner) as HTMLSelectElement;
};
const allPick = async (region: HTMLElement): Promise<HTMLSelectElement> => {
  const select = await within(region).findByLabelText(HIERARCHY_TEXT.allPick) as HTMLSelectElement;
  showNotLive(region.querySelector<HTMLElement>('[data-linking-all]')!);
  return select;
};
/** The row's state cell: the state is also said on the row's one line, so a case about the cell asks the cell. */
const stateCell = (n: string): HTMLElement => rowOf(n).querySelector<HTMLElement>('[data-linking-state]')!;

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
    await waitFor(() => expect(stateCell('project-b')).toHaveTextContent('Migrated on 2026-11-12'));
  });

  it('D-8797: the Upkeep link shows with a team key, nothing waiting or not; the inbound count only when issues wait; no key shows neither', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: null })), row('project-c', wire({ teamKey: 'BBB' }))], hier([
      hrow('project-a'), hrow('project-b', { teamKey: null }), hrow('project-c', { teamKey: 'BBB', inboundWaiting: 2 }),
    ]));
    const link = await within(rowOf('project-a')).findByRole('link', { name: HIERARCHY_TEXT.upkeep });
    expect(link.getAttribute('href')).toBe(upkeepPath('project-a'));
    expect(within(rowOf('project-a')).queryByText(/inbound issues? waits? for an owner/)).toBeNull();
    expect(within(rowOf('project-b')).queryByRole('link', { name: HIERARCHY_TEXT.upkeep })).toBeNull();
    expect(within(rowOf('project-b')).queryByText(/inbound issues? waits? for an owner/)).toBeNull();
    expect(within(rowOf('project-c')).getByRole('link', { name: HIERARCHY_TEXT.upkeep }).getAttribute('href')).toBe(upkeepPath('project-c'));
    expect(within(rowOf('project-c')).getByText('2 inbound issues wait for an owner')).toBeTruthy();
  });

  it('a 503 write-failed on a hierarchy write is unconfirmed, and its sentence never says nothing was changed (D-8186 A6)', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'saveHierarchy').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed', detail: 'disk path /x' }));
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    expect(await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed)).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByText(LINKING_ROUTE_TEXT['write-failed'])).toBeNull();
    expect(document.body.textContent).not.toContain('disk path');
  });

  it('a 503 unavailable on a hierarchy write is a refusal (nothing was written): its fixed sentence, and the row is not locked (D-8186 A7)', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const err = new ApiError(503, { ok: false, error: 'unavailable', detail: 'disk path /x' });
    vi.spyOn(api, 'saveHierarchy').mockRejectedValue(err);
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    expect(await within(rowOf('project-a')).findByText(linkingErrorText(err))).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByText(HIERARCHY_TEXT.unconfirmed)).toBeNull();
    expect(api.hierarchy).toHaveBeenCalledTimes(1);
    expect(ownerSelect('project-a')).not.toBeDisabled();
    expect(document.body.textContent).not.toContain('disk path');
  });

  it('an unknown-outcome linking write locks the row until the project list is read again (D-8186 A1)', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const list = vi.mocked(api.projects);
    expect(list).toHaveBeenCalledTimes(1);
    let land!: (r: { roots: string[]; projects: ProjectRow[] }) => void;
    list.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed' }));
    fireEvent.change(keyField('project-a'), { target: { value: 'BBB' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(keyField('project-a')).toBeDisabled();
    expect(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save })).toBeDisabled();
    expect(overrideSelect('project-a')).toBeDisabled();
    await act(async () => { land({ roots: ['/w'], projects: [row('project-a', wire({ teamKey: 'BBB' }))] }); });
    await waitFor(() => expect(keyField('project-a')).not.toBeDisabled());
    expect(keyField('project-a').value).toBe('BBB');
    expect(overrideSelect('project-a')).not.toBeDisabled();
  });

  it('M1: a hierarchy write, a team-key write and owner-for-all whose outcome is unknown never say nothing was changed', async () => {
    const region = await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'saveHierarchy').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed', detail: 'disk path /x' }));
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    expect(await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed)).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByText(LINKING_ROUTE_TEXT['write-failed'])).toBeNull();
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(502, { ok: false, error: 'write-failed' }));
    fireEvent.change(keyField('project-a'), { target: { value: 'BBB' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(api.saveLinking).toHaveBeenCalledTimes(1));
    expect(await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed)).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByText(LINKING_ROUTE_TEXT['write-failed'])).toBeNull();
    vi.spyOn(api, 'ownerForAll').mockRejectedValue(new ApiError(502, { ok: false, error: 'write-failed' }));
    fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
    fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
    fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
    await waitFor(() => expect(api.ownerForAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(region.querySelector('[data-linking-all]')!.textContent).toContain(HIERARCHY_TEXT.unconfirmed));
    expect(region.querySelector('[data-linking-all]')!.textContent).not.toContain(LINKING_ROUTE_TEXT['write-failed']);
  });

  it('I2: a 502 answer to owner-for-all locks every row behind a read newer than the write; a 409 unlocks at once', async () => {
    await twoRows();
    const region = screen.getByRole('region', { name: SETTINGS_CARDS.integrations.linking.title });
    const apply = async (n: number): Promise<void> => {
      fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
      fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
      fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
      await waitFor(() => expect(api.ownerForAll).toHaveBeenCalledTimes(n));
    };
    const all = vi.spyOn(api, 'ownerForAll').mockRejectedValue(new ApiError(409, { ok: false, error: LINKING_REFUSALS[0] }));
    await apply(1);
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(ownerSelect('project-b')).not.toBeDisabled();
    expect(api.hierarchy).toHaveBeenCalledTimes(1);
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    all.mockRejectedValue(new ApiError(502, { ok: false, error: 'write-failed' }));
    await apply(2);
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    expect(ownerSelect('project-b')).toBeDisabled();
    await act(async () => { held1.resolve(answer!); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(ownerSelect('project-b')).not.toBeDisabled();
  });

  it('making one coordinator the owner of every project asks first', async () => {
    const region = await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    const all = vi.spyOn(api, 'ownerForAll').mockResolvedValue({ ok: true, projects: 1 });
    fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
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
  // A hierarchy write raises the card's floor, so a second hierarchy write cannot start while the first's read is pending. The
  // concurrent second write of these tests is therefore a team-key save on the other row (it locks that row behind its own read).
  const saveKeyOfB = async (): Promise<void> => {
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'BBB' }) });
    fireEvent.change(keyField('project-b'), { target: { value: 'BBB2' } });
    fireEvent.click(within(rowOf('project-b')).getByRole('button', { name: LINKING_TEXT.save }));
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
    await saveKeyOfB();
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

  const OFF = { initiatives: 'off', linearOwner: null, ownsTeam: false } as const;
  const bothOff = (): HierarchyAnswer => hier([hrow('project-a', { initiatives: 'off' }), hrow('project-b', { teamKey: 'BBB', initiatives: 'off' })]);
  const aOffBOn = (): HierarchyAnswer => hier([hrow('project-a', { initiatives: 'off' }), hrow('project-b', { teamKey: 'BBB' })]);
  const twoRows = async (): Promise<ReturnType<typeof vi.spyOn>> => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a'), hrow('project-b', { teamKey: 'BBB' })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    return vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: OFF });
  };

  it('a failed re-read after a write keeps the row locked, says so, and a read again unlocks it on the server\'s answer', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const save = vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: OFF });
    vi.mocked(api.hierarchy).mockRejectedValue(new TypeError('offline'));
    fireEvent.click(initiativesBox('project-a'));
    expect(await screen.findByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    expect(screen.queryByText(HIERARCHY_TEXT.unreadable)).toBeNull();
    expect(ownerSelect('project-a')).toBeInTheDocument();
    // Still locked: no change can be made, so no body carries the old answer.
    expect(ownerSelect('project-a')).toBeDisabled();
    expect(initiativesBox('project-a')).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
    // Read again: the server's stored answer lands, the row unlocks, and the next body carries it.
    vi.mocked(api.hierarchy).mockImplementation(async () => hier([hrow('project-a', { initiatives: 'off' })]));
    fireEvent.click(screen.getByRole('button', { name: HIERARCHY_TEXT.readAgain }));
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(screen.queryByText(HIERARCHY_TEXT.rereadFailed)).toBeNull();
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('project-a', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
  });

  it('two rows write at once and the first re-read lands first: each row unlocks on a read newer than its own write', async () => {
    const save = await twoRows();
    const first = held<HierarchyAnswer>();
    const second = held<HierarchyAnswer>();
    // Later reads (a control change's) answer with what the server now stores.
    vi.mocked(api.hierarchy).mockImplementation(async () => bothOff());
    vi.mocked(api.hierarchy).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    await saveKeyOfB();
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(3));
    await act(async () => { first.resolve(aOffBOn()); });
    // A's own read landed: A unlocks on an answer newer than its write. B's has not: B stays locked.
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(ownerSelect('project-b')).toBeDisabled();
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('project-a', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
    await act(async () => { second.resolve(bothOff()); });
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
    fireEvent.change(ownerSelect('project-b'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save).toHaveBeenLastCalledWith('project-b', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
  });

  it('two rows write at once and the newer re-read lands first: the older one is dropped and both rows end on the stored values', async () => {
    const save = await twoRows();
    const first = held<HierarchyAnswer>();
    const second = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementation(async () => bothOff());
    vi.mocked(api.hierarchy).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    await saveKeyOfB();
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(3));
    await act(async () => { second.resolve(bothOff()); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    await act(async () => { first.resolve(aOffBOn()); });
    // The older answer was dropped: B still reads off, and nothing relocked.
    expect(initiativesBox('project-b').getAttribute('aria-checked')).toBe('false');
    expect(ownerSelect('project-a')).not.toBeDisabled();
    fireEvent.change(ownerSelect('project-a'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('project-a', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
    fireEvent.change(ownerSelect('project-b'), { target: { value: 'coord-b' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save).toHaveBeenLastCalledWith('project-b', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
  });

  it('after an owner-for-all save every row stays locked until a read as new as it has landed, then writes the stored owner', async () => {
    const save = await twoRows();
    vi.spyOn(api, 'ownerForAll').mockResolvedValue({ ok: true, projects: 2 });
    const held1 = held<HierarchyAnswer>();
    const stored = hier([hrow('project-a', { linearOwner: 'coord-b' }), hrow('project-b', { teamKey: 'BBB', linearOwner: 'coord-b' })]);
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    const region = screen.getByRole('region', { name: SETTINGS_CARDS.integrations.linking.title });
    fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
    fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
    fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    expect(ownerSelect('project-b')).toBeDisabled();
    expect(initiativesBox('project-a')).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    await act(async () => { held1.resolve(stored); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenLastCalledWith('project-a', { initiatives: 'off', linearOwner: 'coord-b', ownsTeam: false });
  });

  it('a failed re-read after an owner-for-all save keeps every row locked until Read again lands', async () => {
    await twoRows();
    vi.spyOn(api, 'ownerForAll').mockResolvedValue({ ok: true, projects: 2 });
    vi.mocked(api.hierarchy).mockRejectedValue(new TypeError('offline'));
    const region = screen.getByRole('region', { name: SETTINGS_CARDS.integrations.linking.title });
    fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
    fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
    fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
    expect(await screen.findByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    expect(ownerSelect('project-a')).toBeDisabled();
    expect(ownerSelect('project-b')).toBeDisabled();
    vi.mocked(api.hierarchy).mockImplementation(async () => hier([hrow('project-a', { linearOwner: 'coord-b' }), hrow('project-b', { teamKey: 'BBB', linearOwner: 'coord-b' })]));
    fireEvent.click(screen.getByRole('button', { name: HIERARCHY_TEXT.readAgain }));
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
    expect(ownerSelect('project-a')).not.toBeDisabled();
  });

  const sharedKey = async (): Promise<ReturnType<typeof vi.spyOn>> => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' }))],
      hier([hrow('project-a'), hrow('project-b', { ownsTeam: true })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    return vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'on', linearOwner: null, ownsTeam: true } });
  };
  const owning = (n: string) => within(rowOf(n)).getByRole('checkbox', { name: HIERARCHY_TEXT.owning });
  const aOwns = (): HierarchyAnswer => hier([hrow('project-a', { ownsTeam: true }), hrow('project-b', { ownsTeam: false })]);

  it('an owning-project write locks the sibling row too: its body never carries the old ownsTeam, and carries the stored one after the read', async () => {
    const save = await sharedKey();
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    fireEvent.click(owning('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-b')).toBeDisabled();
    expect(initiativesBox('project-b')).toBeDisabled();
    vi.mocked(api.hierarchy).mockImplementation(async () => aOwns());
    await act(async () => { held1.resolve(aOwns()); });
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
    fireEvent.click(initiativesBox('project-b'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('project-b', { initiatives: 'off', linearOwner: null, ownsTeam: false });
  });

  it('a failed re-read after an owning-project write keeps the sibling locked until Read again lands', async () => {
    const save = await sharedKey();
    vi.mocked(api.hierarchy).mockRejectedValue(new TypeError('offline'));
    fireEvent.click(owning('project-a'));
    expect(await screen.findByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    expect(ownerSelect('project-b')).toBeDisabled();
    vi.mocked(api.hierarchy).mockImplementation(async () => aOwns());
    fireEvent.click(screen.getByRole('button', { name: HIERARCHY_TEXT.readAgain }));
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
    fireEvent.click(initiativesBox('project-b'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith('project-b', { initiatives: 'off', linearOwner: null, ownsTeam: false });
  });

  it('a hierarchy write in flight locks every other row from the moment it starts', async () => {
    const save = await sharedKey();
    const inFlight = held<{ ok: true; settings: { initiatives: 'on'; linearOwner: null; ownsTeam: true } }>();
    save.mockImplementationOnce(() => inFlight.promise);
    fireEvent.click(owning('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(ownerSelect('project-b')).toBeDisabled();
    expect(initiativesBox('project-b')).toBeDisabled();
    expect(owning('project-b')).toBeDisabled();
    await act(async () => { inFlight.resolve({ ok: true, settings: { initiatives: 'on', linearOwner: null, ownsTeam: true } }); });
    vi.mocked(api.hierarchy).mockImplementation(async () => aOwns());
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
  });

  it('an owner-for-all save in flight locks every row from the moment it starts', async () => {
    await twoRows();
    const inFlight = held<{ ok: true; projects: number }>();
    vi.spyOn(api, 'ownerForAll').mockImplementation(() => inFlight.promise);
    const region = screen.getByRole('region', { name: SETTINGS_CARDS.integrations.linking.title });
    fireEvent.change(await allPick(region), { target: { value: 'coord-b' } });
    fireEvent.click(within(region).getByRole('button', { name: HIERARCHY_TEXT.allAct }));
    fireEvent.click(await screen.findByRole('button', { name: HIERARCHY_TEXT.allConfirm }));
    await waitFor(() => expect(api.ownerForAll).toHaveBeenCalledTimes(1));
    expect(ownerSelect('project-a')).toBeDisabled();
    expect(ownerSelect('project-b')).toBeDisabled();
    await act(async () => { inFlight.resolve({ ok: true, projects: 2 }); });
    await waitFor(() => expect(ownerSelect('project-b')).not.toBeDisabled());
  });

  it('the stale note stays while a row is locked behind a failed read, even when an older read lands after it', async () => {
    await twoRows();
    const r2 = held<HierarchyAnswer>();
    const r3 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => r2.promise).mockImplementationOnce(() => r3.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    await saveKeyOfB();
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(3));
    await act(async () => { r3.reject(new TypeError('offline')); });
    expect(await screen.findByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    await act(async () => { r2.resolve(aOffBOn()); });
    // Read 2 covers A's write, so A unlocks; B's write needs read 3, which failed: B stays locked, so the note and the retry stay.
    expect(ownerSelect('project-a')).not.toBeDisabled();
    expect(ownerSelect('project-b')).toBeDisabled();
    expect(screen.getByText(HIERARCHY_TEXT.rereadFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: HIERARCHY_TEXT.readAgain })).toBeInTheDocument();
  });

  it('a write whose result is unknown locks behind a re-read; a definite refusal unlocks at once', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const save = vi.spyOn(api, 'saveHierarchy').mockRejectedValue(new ApiError(409, { ok: false, error: LINKING_REFUSALS[0] }));
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(api.hierarchy).toHaveBeenCalledTimes(1);
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    save.mockRejectedValue(new TypeError('timeout'));
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    await act(async () => { held1.resolve(hier([hrow('project-a', { initiatives: 'off' })])); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
  });

  it.each([502, 503])('a %i answer to a hierarchy write may follow a commit: the row stays locked until a read newer than the write lands', async (status) => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const save = vi.spyOn(api, 'saveHierarchy').mockRejectedValue(new ApiError(status, { ok: false, error: 'write-failed' }));
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    await act(async () => { held1.resolve(hier([hrow('project-a', { initiatives: 'off' })])); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
  });

  it('a 502 answer to a team-key write locks the row behind a re-read too', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(502, { ok: false, error: 'write-failed' }));
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    fireEvent.change(keyField('project-a'), { target: { value: 'BBB' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    await act(async () => { held1.resolve(hier([hrow('project-a')])); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
  });

  it('a project missing from the hierarchy answer is drawn at the server defaults, and a write sends them with the change', async () => {
    await mount([row('project-a', wire())], hier([]));
    expect(await within(rowOf('project-a')).findByText('Default: none live')).toBeInTheDocument();
    // An unlinked row keeps everything but its key behind "More settings".
    fireEvent.click(rowOf('project-a').querySelector<HTMLElement>('[data-linking-rest]')!);
    expect(ownerSelect('project-a').value).toBe('');
    expect(initiativesBox('project-a')).toBeChecked();
    expect(within(rowOf('project-a')).getByText('Not migrated')).toBeInTheDocument();
    const save = vi.spyOn(api, 'saveHierarchy').mockResolvedValue({ ok: true, settings: { initiatives: 'off', linearOwner: null, ownsTeam: false } });
    const held1 = held<HierarchyAnswer>();
    vi.mocked(api.hierarchy).mockImplementationOnce(() => held1.promise);
    fireEvent.click(initiativesBox('project-a'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { initiatives: 'off', linearOwner: null, ownsTeam: false }));
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(ownerSelect('project-a')).toBeDisabled();
    await act(async () => { held1.resolve(hier([hrow('project-a', { initiatives: 'off', teamKey: null })])); });
    await waitFor(() => expect(ownerSelect('project-a')).not.toBeDisabled());
    expect(initiativesBox('project-a')).not.toBeChecked();
  });

  it('a stamp the clock cannot place says no date rather than throwing', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { state: 'migrated', stateAt: 1e20 })]));
    await waitFor(() => expect(within(stateCell('project-a')).getByText('Migrated')).toBeInTheDocument());
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

  it('the empty option names the default owner and its liveness for a named, a default and a none source alike', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire({ teamKey: 'CCC' }))], hier([
      hrow('project-a', { ownerNow: { id: 'coord-a', source: 'named', live: true, project: 'project-a' } }),
      hrow('project-b', { teamKey: 'BBB', ownerNow: { id: 'coord-b', source: 'default', live: false, project: 'project-b' } }),
      hrow('project-c', { teamKey: 'CCC', ownerNow: { id: null, source: 'none', live: false, project: 'project-c' } }),
    ]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-b')).getByText('Default: coord-b (not live)')).toBeInTheDocument();
    expect(within(rowOf('project-c')).getByText('Default: none live')).toBeInTheDocument();
    expect(screen.queryByText(/latest programme/)).toBeNull();
    expect(screen.queryByText(/own owner setting is not used/)).toBeNull();
  });

  it('a project whose owner comes from the project owning its key says so, with that coordinator liveness', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' }))], hier([
      hrow('project-a', { ownsTeam: true, linearOwner: 'coord-b', ownerNow: { id: 'coord-b', source: 'named', live: false, project: 'project-a' } }),
      hrow('project-b', { ownerNow: { id: 'coord-b', source: 'named', live: false, project: 'project-a', ifUnnamed: { id: 'coord-a', live: true } } }),
    ]));
    // I1: the option names the sibling's own default (ifUnnamed); the note names who owns it now, and whether that one is live.
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-b')).getByText('The owner now is coord-b (not live), from project-a, which owns team key AAA. This project\'s own owner setting is not used meanwhile.')).toBeInTheDocument();
    expect(within(rowOf('project-a')).queryByText(/own owner setting is not used/)).toBeNull();
  });

  it('an inherited owner with none live says so, and an own named owner outside the list is not labelled with another coordinator liveness', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA', linearOwner: 'coord-z' }))], hier([
      hrow('project-a', { ownsTeam: true, ownerNow: { id: null, source: 'none', live: false, project: 'project-a' } }),
      hrow('project-b', { linearOwner: 'coord-z', ownerNow: { id: 'coord-a', source: 'named', live: true, project: 'project-a' } }),
    ]));
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-b')).getByText('coord-z (not live)')).toBeInTheDocument();
    expect(within(rowOf('project-a')).getByText('Default: none live')).toBeInTheDocument();
  });

  it('F2: the empty option names who choosing it gives (ifUnnamed), not the named owner; absent ifUnnamed reads as today', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA', linearOwner: 'coord-z' })), row('project-b', wire({ teamKey: 'BBB' })),
      row('project-c', wire({ teamKey: 'CCC' })), row('project-d', wire({ teamKey: 'DDD', linearOwner: 'coord-z' }))], hier([
      hrow('project-a', { linearOwner: 'coord-z', ownerNow: { id: 'coord-z', source: 'named', live: false, project: 'project-a', ifUnnamed: { id: 'coord-a', live: true } } }),
      hrow('project-b', { teamKey: 'BBB', ownerNow: { id: 'coord-b', source: 'named', live: true, project: 'project-b', ifUnnamed: { id: null, live: false } } }),
      hrow('project-c', { teamKey: 'CCC', ownerNow: { id: 'coord-a', source: 'default', live: true, project: 'project-c' } }),
      hrow('project-d', { teamKey: 'DDD', linearOwner: 'coord-z', ownerNow: { id: 'coord-z', source: 'named', live: false, project: 'project-d' } }),
    ]));
    // The named row: the empty option names the default rule's coordinator, coord-a, never the named coord-z.
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-a')).queryByText('Default: coord-z (not live)')).toBeNull();
    expect(within(rowOf('project-a')).getByText('coord-z (not live)')).toBeInTheDocument();
    expect(within(rowOf('project-b')).getByText('Default: none live')).toBeInTheDocument();
    expect(within(rowOf('project-c')).getByText('Default: coord-a (live)')).toBeInTheDocument();
    // Absent ifUnnamed (an older server): today's words from ownerNow.
    expect(within(rowOf('project-d')).getByText('Default: coord-z (not live)')).toBeInTheDocument();
  });

  it('F2: a shared-key sibling\'s empty option names its own default and the note says its own setting is not used', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' }))], hier([
      hrow('project-a', { ownsTeam: true, linearOwner: 'coord-b', ownerNow: { id: 'coord-b', source: 'named', live: false, project: 'project-a', ifUnnamed: { id: 'coord-b', live: false } } }),
      hrow('project-b', { ownerNow: { id: 'coord-b', source: 'named', live: false, project: 'project-a', ifUnnamed: { id: 'coord-a', live: true } } }),
    ]));
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    expect(within(rowOf('project-b')).getByText(/own owner setting is not used meanwhile/)).toBeInTheDocument();
  });

  it('a missing project field reads as the project own owner', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { ownerNow: { id: 'coord-a', source: 'default', live: true } })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(screen.queryByText(/own owner setting is not used/)).toBeNull();
  });

  it('shows when the current Linear owner could not be measured', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([
      hrow('project-a', { ownerNow: { id: null, source: 'none', live: false, unmeasured: true, ifUnnamed: { id: 'coord-a', live: true } } }),
    ]));
    const card = rowOf('project-a');
    expect(await within(card).findByText('The current Linear owner could not be measured.')).toBeInTheDocument();
    expect(within(card).getByText('Default: coord-a (live)')).toBeInTheDocument();
  });

  it('the none-live words for an inherited owner', () => {
    const r = hrow('project-b', { ownerNow: { id: null, source: 'none', live: false, project: 'project-a' } });
    expect(defaultOwnerWords(r)).toBe('Default: none live');
    expect(ownerInheritedNote(r)).toBe('No owner is live now. That comes from project-a, which owns team key AAA. This project\'s own owner setting is not used meanwhile.');
    expect(namedOwnerWords(r, 'coord-z')).toBe('coord-z (not live)');
    expect(namedOwnerWords(hrow('project-a', { ownerNow: { id: 'coord-z', source: 'named', live: true } }), 'coord-z')).toBe('coord-z');
  });

  it('M3: the all-projects words claim only the projects with Linear settings', () => {
    expect(ownerForAllConsequence('coord-b')).toBe('Every project with Linear settings gets coord-b as its Linear owner. Each project\'s other settings stay as they are.');
    expect(HIERARCHY_TEXT.allDone).toBe('Saved. Every project with Linear settings now names that coordinator.');
  });
});

// D-8808 (wave 8, Task 8.6): the workspace picker, the candidates' workspaces and suggestions, an Overlord link as its call.
import type { TeamCandidateWire } from '../../shared/linking';
import { callPath, waitingPath } from '../src/lib/routes';
import { KEY_WRITE_WORDS, OVERLORD_LINK_WORDS, PICKER_WORDS, candidateAriaLabel } from '../src/fleet/linkingWords';

const wsView = (id: string, name: string, keys: string[]): LinearWorkspaceView =>
  ({ state: 'details-unknown', why: 'absent', id, name, urlKey: null, user: null, teams: keys.map((key) => ({ key, name: key })), keyTail: null, checkedAt: null });
const serveWorkspaces = (workspaces: LinearWorkspaceView[] | 'unreadable'): void => { supplied = workspaces === 'unreadable' ? null : workspaces; };
const picker = (name: string): HTMLSelectElement | null =>
  within(rowOf(name)).queryByLabelText(PICKER_WORDS.label) as HTMLSelectElement | null;

describe('the team key\'s workspace picker (D-8808)', () => {
  it('appears for a key two connected workspaces hold, preselects the stored one, and its choice rides the same write', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    expect(picker('project-a')!.value).toBe('id-b');
    expect(within(picker('project-a')!).getAllByRole('option').map((o) => o.textContent)).toEqual([PICKER_WORDS.choose, 'ws-a', 'ws-b']);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }) });
    fireEvent.change(picker('project-a')!, { target: { value: 'id-a' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'AAA', override: null, workspace: 'id-a' }));
  });

  it('Save and Enter write nothing while a key held by two workspaces has no workspace chosen, and say so', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA' }) });
    const btn = within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save });
    expect(btn).toBeDisabled();
    expect(within(rowOf('project-a')).getByText(PICKER_WORDS.needed)).toBeInTheDocument();
    fireEvent.keyDown(keyField('project-a'), { key: 'Enter' });
    fireEvent.click(btn);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(picker('project-a')!, { target: { value: 'id-a' } });
    expect(btn).toBeEnabled();
    expect(within(rowOf('project-a')).queryByText(PICKER_WORDS.needed)).toBeNull();
  });

  it('is left out for a key one workspace holds (that workspace rides the write), a key none holds, and an unreadable list', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['BBB'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'ZZZ' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA' }) });
    expect(picker('project-a')).toBeNull();
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('project-a', { teamKey: 'AAA', override: null, workspace: 'id-a' }));
    fireEvent.click(within(rowOf('project-b')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('project-b', { teamKey: 'ZZZ', override: null }));
    expect(picker('project-b')).toBeNull();
  });

  it('offers a key held by a file slot and the legacy workspace as two choices, and writes the legacy one (review 2971 A1)', async () => {
    const ID_L = '00000000-0000-4000-8000-0000000000c3';
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA'])]);
    suppliedLegacy = { view: { state: 'not-connected' }, superseded: false, workspace: { workspaceId: ID_L, name: 'ws-l', urlKey: 'ws-l', teams: [{ key: 'AAA', name: 'AAA' }] } };
    await mount([row('project-a', wire({ teamKey: 'AAA' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    expect(within(picker('project-a')!).getAllByRole('option').map((o) => o.textContent)).toEqual([PICKER_WORDS.choose, 'ws-a', 'ws-l']);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamWorkspace: ID_L }) });
    fireEvent.change(picker('project-a')!, { target: { value: ID_L } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'AAA', override: null, workspace: ID_L }));
  });

  it('reads no workspace list of its own: the frame hands it the one read', async () => {
    const own = vi.spyOn(api, 'linearWorkspaces');
    await mount([row('project-a', wire({ teamKey: 'AAA' }))]);
    expect(own).not.toHaveBeenCalled();
  });

  it('the picker is locked while the list re-read after an unknown-outcome write is in flight (D-8186 A1, review 2997 A1)', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    const list = vi.mocked(api.projects);
    let land!: (r: { roots: string[]; projects: ProjectRow[] }) => void;
    list.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed' }));
    fireEvent.change(picker('project-a')!, { target: { value: 'id-b' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(picker('project-a')).toBeDisabled();
    await act(async () => { land({ roots: ['/w'], projects: [row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }))] }); });
    await waitFor(() => expect(picker('project-a')).not.toBeDisabled());
  });

  it('an unreadable list leaves the picker out and the write as it was', async () => {
    serveWorkspaces('unreadable');
    await mount([row('project-a', wire({ teamKey: 'AAA' }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA' }) });
    expect(picker('project-a')).toBeNull();
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'AAA', override: null }));
  });
});

describe('the candidates (D-8808)', () => {
  const same: TeamCandidateWire[] = [
    { key: 'AAA', name: 'Alpha', evidence: { kind: 'pr-attachments', ids: 4, of: 5 }, workspaceId: 'id-a', workspaceName: 'ws-a' },
    { key: 'AAA', name: 'Alpha two', evidence: { kind: 'suggested', by: 'lane-a', why: '<b>the branches name it</b>' }, workspaceId: 'id-b', workspaceName: 'ws-b' },
  ];
  it('two candidates of one key render as two rows with their workspaces, and a tap sends its own workspace', async () => {
    serveWorkspaces('unreadable');
    await mount([row('project-a', wire({ teamCandidates: same }))]);
    const r = within(rowOf('project-a'));
    expect(r.getAllByRole('button', { name: /^Link AAA/ })).toHaveLength(2);
    expect(r.getByText('In workspace ws-a')).toBeInTheDocument();
    expect(r.getByText('In workspace ws-b')).toBeInTheDocument();
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }) });
    fireEvent.click(r.getByRole('button', { name: candidateAriaLabel(same[1]!) }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'AAA', override: null, workspace: 'id-b' }));
  });
  it('a tap on a candidate with no workspace whose key two workspaces hold writes nothing and opens the picker (final review I2)', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    const bare: TeamCandidateWire = { key: 'AAA', name: 'Alpha', evidence: { kind: 'suggested', by: 'lane-a', why: 'the branches name it' } };
    await mount([row('project-a', wire({ teamCandidates: [bare] }))]);
    const save = vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }) });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: candidateLabel(bare) }));
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    expect(save).not.toHaveBeenCalled();
    expect(keyField('project-a').value).toBe('AAA');
    expect(picker('project-a')!.value).toBe('');
    expect(within(rowOf('project-a')).getByText(PICKER_WORDS.needed)).toBeInTheDocument();
    // The workspace chosen, Save writes the pair.
    fireEvent.change(picker('project-a')!, { target: { value: 'id-b' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-a', { teamKey: 'AAA', override: null, workspace: 'id-b' }));
  });
  it('the candidate buttons are locked while the list re-read after an unknown-outcome tap is in flight (D-8186 A1, review 2997 A1)', async () => {
    serveWorkspaces('unreadable');
    await mount([row('project-a', wire({ teamCandidates: same }))]);
    const list = vi.mocked(api.projects);
    let land!: (r: { roots: string[]; projects: ProjectRow[] }) => void;
    list.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed' }));
    const buttons = (): HTMLElement[] => within(rowOf('project-a')).getAllByRole('button', { name: /^Link AAA/ });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: candidateAriaLabel(same[0]!) }));
    await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(buttons()).toHaveLength(2);
    for (const b of buttons()) expect(b).toBeDisabled();
    await act(async () => { land({ roots: ['/w'], projects: [row('project-a', wire({ teamCandidates: same }))] }); });
    await waitFor(() => { for (const b of buttons()) expect(b).not.toBeDisabled(); });
  });
  it('one pair offered by the pass and by two suggesters renders three rows with no duplicate key (review 2971 A2)', async () => {
    serveWorkspaces('unreadable');
    const pass: TeamCandidateWire = { key: 'AAA', name: 'Alpha', evidence: { kind: 'pr-attachments', ids: 4, of: 5 }, workspaceId: 'id-a', workspaceName: 'ws-a' };
    const by = (who: string): TeamCandidateWire => ({ ...pass, evidence: { kind: 'suggested', by: who, why: 'the branches name it' } });
    const errors = vi.spyOn(console, 'error');
    await mount([row('project-a', wire({ teamCandidates: [pass, by('lane-a'), by('lane-b')] }))]);
    expect(within(rowOf('project-a')).getAllByRole('button', { name: /^Link AAA/ })).toHaveLength(3);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
  it('a key write refused team-ambiguous points at the picker the card shows (review 2971 F4)', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(409, { ok: false, error: 'team-ambiguous' }));
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    const sentence = await within(rowOf('project-a')).findByRole('status');
    expect(sentence.textContent).toBe(PICKER_WORDS.ambiguous);
    expect(picker('project-a')).not.toBeNull();
  });
  it('a key write refused unavailable says the Linear keys could not be read and nothing was changed (review 2997 A3)', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' }))]);
    await waitFor(() => expect(picker('project-a')).not.toBeNull());
    const err = new ApiError(503, { ok: false, error: 'unavailable', detail: 'the Linear store could not be read' });
    vi.spyOn(api, 'saveLinking').mockRejectedValue(err);
    fireEvent.change(keyField('project-a'), { target: { value: 'BBB' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    const sentence = await within(rowOf('project-a')).findByRole('status');
    expect(sentence.textContent).toBe(KEY_WRITE_WORDS.unavailable);
    expect(sentence.textContent).toMatch(/Linear keys, or a Linear workspace, could not be read, so nothing was changed\. Try again later\./);
    expect(document.body.textContent).not.toContain('the Linear store could not be read');
    // A refusal before any write: the row is not locked behind a re-read.
    expect(keyField('project-a')).not.toBeDisabled();
    // The hierarchy controls keep their own sentence for the same word.
    expect(KEY_WRITE_WORDS.unavailable).not.toBe(linkingErrorText(err));
  });
  it('a suggestion shows its session and its reason as text, never as markup', async () => {
    serveWorkspaces('unreadable');
    await mount([row('project-a', wire({ teamCandidates: same }))]);
    const r = within(rowOf('project-a'));
    expect(r.getByText('Alpha two: suggested by lane-a — <b>the branches name it</b>')).toBeInTheDocument();
    expect(rowOf('project-a').querySelector('b')).toBeNull();
    expect(r.getByText(candidateWhy(same[0]!))).toBeInTheDocument();
  });
});

describe('an Overlord link (D-8809, D-8808)', () => {
  it('shows as a call made for the operator, links to Calls made for you and says how to overturn it', async () => {
    serveWorkspaces('unreadable');
    const l = wire({ teamKey: 'AAA', teamLink: { source: 'overlord', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, at: NOW, callId: 7 } });
    await mount([row('project-a', l)]);
    const r = within(rowOf('project-a'));
    expect(r.getByText(teamLinkLine(l)!)).toBeInTheDocument();
    expect(teamLinkLine(l)).toContain(OVERLORD_LINK_WORDS.overturn);
    const link = r.getByRole('link', { name: OVERLORD_LINK_WORDS.openCall });
    expect(link.getAttribute('href')).toBe(callPath(7));
  });

  it('with no readable call id the link is the list, in the old words', async () => {
    serveWorkspaces('unreadable');
    const l = wire({ teamKey: 'AAA', teamLink: { source: 'overlord', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, at: NOW } as never });
    await mount([row('project-a', l)]);
    const link = within(rowOf('project-a')).getByRole('link', { name: OVERLORD_LINK_WORDS.call });
    expect(link.getAttribute('href')).toBe(waitingPath());
  });
});

// Reshape in Linear (Linear hierarchy design §11.1, D-8186, Task 5.1): the button, its confirm, the re-read and the fixed sentences.
describe('Reshape in Linear', () => {
  const STATES = ['not-migrated', 'map-waiting', 'migrating', 'migrated', 'put-back', 'unmeasured'] as const;
  const reshape = (n: string): HTMLElement | null => within(rowOf(n)).queryByRole('button', { name: HIERARCHY_TEXT.reshape });

  it('the control shows only when not migrated or put back (each of the six states)', async () => {
    for (const state of STATES) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { state })]));
      await within(rowOf('project-a')).findByText('Default: coord-a (live)');
      expect(reshape('project-a') !== null, state).toBe(state === 'not-migrated' || state === 'put-back');
      vi.restoreAllMocks();
    }
  });

  it('a project with no team key has no control', async () => {
    await mount([row('project-a', wire({ teamKey: null }))], hier([hrow('project-a', { teamKey: null })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(reshape('project-a')).toBeNull();
  });

  it('the confirm names the team, and Confirm sends migrate(project), then reads the hierarchy again and says the owner was asked', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const call = vi.spyOn(api, 'migrate').mockResolvedValue({ ok: true, migrationId: 5 });
    fireEvent.click(reshape('project-a')!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(reshapeTitle('AAA'))).toBeInTheDocument();
    expect(dialog.textContent).toContain(reshapeConsequence('AAA'));
    expect(reshapeTitle('AAA')).toBe('Reshape team AAA in Linear?');
    expect(call).not.toHaveBeenCalled();
    answer = hier([hrow('project-a', { state: 'migrating' })]);
    fireEvent.click(within(dialog).getByRole('button', { name: HIERARCHY_TEXT.reshapeConfirm }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('project-a'));
    expect(await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.reshapeAsked)).toBeInTheDocument();
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reshape('project-a')).toBeNull());
  });

  it('each refusal is its fixed sentence, never the box\'s text', async () => {
    const cases: [number, string, string][] = [
      [409, 'no-team-key', MIGRATE_REFUSAL_TEXT['no-team-key']],
      [409, 'migration-in-flight', MIGRATE_REFUSAL_TEXT['migration-in-flight']],
      [503, 'unreachable', MIGRATE_REFUSAL_TEXT.unreachable],
      [503, 'unavailable', linkingErrorText(new ApiError(503, { ok: false, error: 'unavailable' }))],
    ];
    for (const [status, error, sentence] of cases) {
      cleanup();
      await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
      await within(rowOf('project-a')).findByText('Default: coord-a (live)');
      vi.spyOn(api, 'migrate').mockRejectedValue(new ApiError(status, { ok: false, error, detail: 'box text that must not show' }));
      fireEvent.click(reshape('project-a')!);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: HIERARCHY_TEXT.reshapeConfirm }));
      const line = await within(rowOf('project-a')).findByText(sentence);
      expect(line.textContent, error).toBe(sentence);
      expect(document.body.textContent).not.toContain('box text');
      expect(api.hierarchy).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
  });

  it('a 503 write-failed or a lost answer is unconfirmed and the hierarchy is read again', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    vi.spyOn(api, 'migrate').mockRejectedValue(new ApiError(503, { ok: false, error: 'write-failed', detail: 'box text that must not show' }));
    fireEvent.click(reshape('project-a')!);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: HIERARCHY_TEXT.reshapeConfirm }));
    expect(await within(rowOf('project-a')).findByText(HIERARCHY_TEXT.unconfirmed)).toBeInTheDocument();
    await waitFor(() => expect(api.hierarchy).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toContain('box text');
  });
});

// The compact list (D-8932): one line per linked project, a row that waits for the operator open and
// flagged with its reason, every project with no team in one group, and coordinator selects that offer the live ones first.
// The kinds, the reasons and the words are `linkingWords.ts`'s and `hierarchyWords.ts`'s (linking-list-words.test.ts);
// these cases hold what the card DRAWS for each.
import { LINKING_ROW_WORDS, linkingCountsWords, unlinkedGroupWords } from '../src/fleet/linkingWords';
import { COORDINATOR_SHORT_LIST, NOT_LIVE_WORDS, inboundUnownedWords, mapWaitingWords, owningUnchosenWords } from '../src/fleet/hierarchyWords';
import type { ProjectList, ProjectListRead } from '../src/screens/settings/useProjectList';

describe('the compact list', () => {
  const fold = (n: string): HTMLDetailsElement => rowOf(n).querySelector<HTMLDetailsElement>(':scope > details')!;
  const line = (n: string): HTMLElement => fold(n).querySelector<HTMLElement>(':scope > summary')!;
  const kindOf = (n: string): string | null => rowOf(n).getAttribute('data-linking-kind');
  const flag = (n: string): HTMLElement | null => rowOf(n).querySelector<HTMLElement>('[data-linking-flag]');
  const reasons = (n: string): string[] => [...rowOf(n).querySelectorAll('[data-linking-decision]')].map((e) => e.textContent ?? '');
  const group = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-linking-group] button');
  const order = (): string[] => [...document.querySelectorAll('.linking-list > li')]
    .map((e) => e.getAttribute('data-linking-row') ?? (e.hasAttribute('data-linking-group') ? '(group)' : '?'));
  const AUTO = { source: 'auto', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 12, of: 12 }, at: NOW } as const;
  const QUIET = measured({ template: 'present' });
  /** "More settings": the control, and the rest of the form it shows. */
  const rest = (n: string): HTMLButtonElement => rowOf(n).querySelector<HTMLButtonElement>('[data-linking-rest]')!;
  const restBody = (n: string): HTMLElement => document.getElementById(rest(n).getAttribute('aria-controls')!)!;
  /** What Tab reaches in a row as it is drawn: every control that is not inside something hidden, in the page's order. */
  const stops = (n: string): string[] => [...rowOf(n).querySelectorAll<HTMLElement>('summary, input, select, button, a[href], [role="checkbox"]')]
    .filter((e) => e.closest('[hidden]') === null && !(e as HTMLButtonElement).disabled)
    .map((e) => (e.tagName === 'SUMMARY' ? 'line' : e.tagName === 'INPUT' ? 'key' : e.tagName === 'SELECT' ? `select:${(e as HTMLSelectElement).labels[0]?.textContent ?? ''}` : (e.textContent ?? '')));
  const counts = (): string | null => document.querySelector('[data-linking-counts]')?.textContent ?? null;

  it('a linked project is one line, shut: its name, its team by key and name, how it was linked, its owner and its state', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA', teamLink: AUTO, measured: QUIET }))], hier([hrow('project-a')]));
    await waitFor(() => expect(line('project-a')).toHaveTextContent('owner: coord-a'));
    expect(kindOf('project-a')).toBe('linked');
    expect(fold('project-a').open, 'one line until the operator opens it').toBe(false);
    expect([...line('project-a').querySelectorAll('.linking-line > *')].map((e) => e.textContent))
      .toEqual(['project-a', 'AAA · Alpha, linked automatically', 'owner: coord-a', 'Not migrated']);
    expect(counts()).toBe(linkingCountsWords({ decisions: 0, linked: 1, unlinked: 0 }));
    expect(flag('project-a')).toBeNull();
    expect(reasons('project-a')).toEqual([]);
    expect(group(), 'no project is unlinked, so there is no group').toBeNull();
  });

  it('the line opens to every control the row had: nothing is removed', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    fireEvent.click(line('project-a'));
    expect(fold('project-a').open).toBe(true);
    const body = within(fold('project-a'));
    expect(body.getByLabelText(LINKING_TEXT.teamKey)).toBeInTheDocument();
    expect(body.getByRole('button', { name: LINKING_TEXT.save })).toBeInTheDocument();
    expect(body.getByLabelText(LINKING_TEXT.override)).toBeInTheDocument();
    expect(body.getByRole('button', { name: LINKING_TEXT.openTemplate })).toBeInTheDocument();
    expect(body.getByLabelText(HIERARCHY_TEXT.owner)).toBeInTheDocument();
    expect(body.getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives })).toBeInTheDocument();
    expect(body.getByRole('button', { name: HIERARCHY_TEXT.reshape })).toBeInTheDocument();
    expect(body.getByRole('link', { name: HIERARCHY_TEXT.upkeep })).toBeInTheDocument();
  });

  it('a suggested team waiting: the row is listed, open and flagged, with the reason in words and its one-tap Link', async () => {
    const candidates: TeamCandidateWire[] = [{ key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } }];
    await mount([row('project-a', wire({ teamKey: 'BBB' })), row('project-b', wire({ teamCandidates: candidates })), row('project-c', wire())]);
    expect(kindOf('project-b')).toBe('decision');
    expect(fold('project-b').open).toBe(true);
    expect(flag('project-b')).toHaveTextContent(LINKING_ROW_WORDS.flag);
    expect(reasons('project-b')).toEqual(['Team AAA (Alpha) is suggested for this project. Link it, or type another key.']);
    expect(line('project-b')).toHaveTextContent(LINKING_ROW_WORDS.notLinked);
    expect(within(rowOf('project-b')).getByRole('button', { name: 'Link AAA' })).toBeInTheDocument();
    // It comes first, before the linked rows, never in the group; the head of the card counts each kind once.
    expect(order()).toEqual(['project-b', 'project-a', '(group)', 'project-c']);
    expect(counts()).toBe('1 needs a decision · 1 linked · 1 not linked');
    expect(fold('project-a').open, 'a row with nothing to decide stays one line').toBe(false);
    expect(flag('project-a')).toBeNull();
  });

  it('linking the suggested team settles the row: the flag and the reason go, and it stays open on its answer', async () => {
    const candidates: TeamCandidateWire[] = [{ key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } }];
    await mount([row('project-a', wire({ teamCandidates: candidates }))]);
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamLink: { source: 'manual', at: NOW } }) });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: 'Link AAA' }));
    await waitFor(() => expect(kindOf('project-a')).toBe('linked'));
    expect(flag('project-a')).toBeNull();
    expect(reasons('project-a')).toEqual([]);
    expect(fold('project-a').open).toBe(true);
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
    expect(line('project-a')).toHaveTextContent('AAA, set by hand');
  });

  it('a key that exists in two workspaces: open and flagged, the reason says to choose, and the picker is there', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: null })), row('project-b', wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }))]);
    expect(kindOf('project-a')).toBe('decision');
    expect(fold('project-a').open).toBe(true);
    expect(flag('project-a')).not.toBeNull();
    expect(reasons('project-a')).toEqual(['Team key AAA exists in more than one Linear workspace. Choose its workspace, then Save.']);
    expect(picker('project-a')).not.toBeNull();
    // The row that has stored its workspace waits for nothing.
    expect(kindOf('project-b')).toBe('linked');
    expect(flag('project-b')).toBeNull();
    expect(fold('project-b').open).toBe(false);
  });

  it('two projects share a key and neither owns it: both are open and flagged; ticking Owning project on one settles both', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' })), row('project-c', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a'), hrow('project-b'), hrow('project-c', { teamKey: 'BBB' })]));
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(kindOf('project-b')).toBe('decision');
    expect(kindOf('project-c')).toBe('linked');
    expect(fold('project-a').open, 'it opened when the hierarchy answer said so').toBe(true);
    expect(fold('project-b').open).toBe(true);
    expect(reasons('project-a')).toEqual([owningUnchosenWords({ key: 'AAA', others: ['project-b'] })]);
    expect(reasons('project-b')).toEqual([owningUnchosenWords({ key: 'AAA', others: ['project-a'] })]);
    vi.spyOn(api, 'saveHierarchy').mockImplementation(async () => {
      answer = hier([hrow('project-a', { ownsTeam: true }), hrow('project-b'), hrow('project-c', { teamKey: 'BBB' })]);
      return { ok: true, settings: { initiatives: 'on', linearOwner: null, ownsTeam: true } };
    });
    fireEvent.click(within(rowOf('project-a')).getByRole('checkbox', { name: HIERARCHY_TEXT.owning }));
    await waitFor(() => expect(kindOf('project-a')).toBe('linked'));
    expect(kindOf('project-b')).toBe('linked');
    expect(flag('project-a')).toBeNull();
    expect(flag('project-b')).toBeNull();
    expect(fold('project-a').open, 'the row that was acted on keeps its answer in view').toBe(true);
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
  });

  it('a row that starts to wait after it was drawn opens then: the hierarchy answer lands late', async () => {
    serve([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' }))]);
    let land!: (a: HierarchyAnswer) => void;
    vi.spyOn(api, 'hierarchy').mockReturnValue(new Promise<HierarchyAnswer>((resolve) => { land = resolve; }));
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await act(async () => { render(<><ToastHost /><Card /></>); });
    await waitFor(() => expect(rowOf('project-a')).not.toBeNull());
    // Drawn from the project list alone: nothing says the key is shared yet, so each is one line.
    expect(kindOf('project-a')).toBe('linked');
    expect(fold('project-a').open).toBe(false);
    await act(async () => { land(hier([hrow('project-a'), hrow('project-b')])); });
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(fold('project-a').open, 'it opens when it starts to wait').toBe(true);
    expect(fold('project-b').open).toBe(true);
    expect(flag('project-a')).not.toBeNull();
  });

  it('a map waiting: open and flagged, the reason in words, and the link to the item in the row', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { state: 'map-waiting', itemId: 42 })]));
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(fold('project-a').open).toBe(true);
    expect(flag('project-a')).not.toBeNull();
    expect(reasons('project-a')).toEqual([mapWaitingWords('AAA')]);
    expect(within(rowOf('project-a')).getByRole('link', { name: HIERARCHY_TEXT.mapWaiting }).getAttribute('href')).toBe(itemPath(42));
  });

  it('projects with no team and nothing to decide fold into one counted group, shut, after the listed rows', async () => {
    await mount([row('project-a', wire()), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]);
    expect(order()).toEqual(['project-b', '(group)', 'project-a', 'project-c']);
    expect(group()).toHaveTextContent(unlinkedGroupWords(2));
    expect(unlinkedGroupWords(2)).toBe('2 projects not linked to Linear');
    expect(group()!.getAttribute('aria-expanded')).toBe('false');
    for (const n of ['project-a', 'project-c']) {
      expect(kindOf(n)).toBe('unlinked');
      expect(rowOf(n).hidden, n).toBe(true);
      expect(within(rowOf(n)).queryByRole('button', { name: LINKING_TEXT.save }), `${n}: nothing in a shut group is reachable`).toBeNull();
    }
    expect(rowOf('project-b').hidden).toBe(false);
    fireEvent.click(group()!);
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
    for (const n of ['project-a', 'project-c']) {
      expect(rowOf(n).hidden, n).toBe(false);
      expect(within(rowOf(n)).getByRole('button', { name: LINKING_TEXT.save })).toBeInTheDocument();
    }
    fireEvent.click(group()!);
    expect(rowOf('project-a').hidden).toBe(true);
  });

  it('an unlinked row is a plain line: its name, the key field and Save; the rest sits behind More settings', async () => {
    await mount([row('project-a', wire())], hier([hrow('project-a', { teamKey: null })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    const plain = rowOf('project-a').querySelector<HTMLElement>('.linking-plain')!;
    expect(within(plain).getByText('project-a')).toBeInTheDocument();
    expect(within(plain).getByRole('textbox', { name: LINKING_ROW_WORDS.keyFor('project-a') })).toBeInTheDocument();
    expect(within(plain).getByRole('button', { name: LINKING_TEXT.save })).toBeInTheDocument();
    expect(within(plain).queryByLabelText(LINKING_TEXT.override), 'only the key is on the plain line').toBeNull();
    // The line: the key field, Save and "More settings", and nothing else until that is opened.
    expect(stops('project-a')).toEqual(['key', LINKING_TEXT.save, LINKING_ROW_WORDS.moreShort]);
    expect(within(plain).getByRole('button', { name: LINKING_ROW_WORDS.moreFor('project-a') })).toBe(rest('project-a'));
    expect(LINKING_ROW_WORDS.moreFor('project-a'), 'the name holds the word that is drawn').toContain(LINKING_ROW_WORDS.moreShort);
    expect(rest('project-a').getAttribute('aria-expanded')).toBe('false');
    expect(restBody('project-a').hidden).toBe(true);
    expect(within(rowOf('project-a')).queryByRole('combobox', { name: LINKING_TEXT.override }), 'hidden, so not reachable').toBeNull();
    fireEvent.click(rest('project-a'));
    expect(rest('project-a').getAttribute('aria-expanded')).toBe('true');
    expect(restBody('project-a').hidden).toBe(false);
    expect(within(restBody('project-a')).getByRole('combobox', { name: LINKING_TEXT.override })).toBeInTheDocument();
    expect(within(restBody('project-a')).getByRole('combobox', { name: HIERARCHY_TEXT.owner })).toBeInTheDocument();
    expect(flag('project-a')).toBeNull();
    fireEvent.click(rest('project-a'));
    expect(restBody('project-a').hidden).toBe(true);
  });

  it('the unlinked list says "Team key" once: no row repeats the label, and each field is named for its project', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire()), row('project-c', wire())]);
    expect(document.querySelector('[data-linking-hint]'), 'nothing is said while the group is shut').toBeNull();
    fireEvent.click(group()!);
    expect(document.querySelectorAll('[data-linking-hint]')).toHaveLength(1);
    expect(document.querySelector('[data-linking-hint]')).toHaveTextContent(LINKING_ROW_WORDS.unlinkedHint);
    expect(LINKING_ROW_WORDS.unlinkedHint).toContain(LINKING_TEXT.teamKey);
    for (const n of ['project-b', 'project-c']) {
      expect(rowOf(n).querySelector('.linking-plain label'), `${n}: no label of its own on the line`).toBeNull();
      expect(within(rowOf(n)).getByRole('textbox', { name: `Team key for ${n}` })).toBe(keyField(n));
    }
    // A listed row keeps its visible label.
    fireEvent.click(line('project-a'));
    expect(within(rowOf('project-a')).getByLabelText(LINKING_TEXT.teamKey)).toBe(keyField('project-a'));
  });

  it('the group starts open only when it is the whole card, and does not shut under a row once the first key is saved', async () => {
    await mount([row('project-a', wire()), row('project-b', wire())]);
    expect(group()!.getAttribute('aria-expanded'), 'nothing is linked: the list of keys to type is shown').toBe('true');
    expect(rowOf('project-b').hidden).toBe(false);
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', teamLink: { source: 'manual', at: NOW } }) });
    fireEvent.change(keyField('project-a'), { target: { value: 'AAA' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(kindOf('project-a')).toBe('linked'));
    expect(order()).toEqual(['project-a', '(group)', 'project-b']);
    expect(group()).toHaveTextContent(unlinkedGroupWords(1));
    expect(group()!.getAttribute('aria-expanded'), 'a listed row now exists, and the group stays as it was').toBe('true');
    expect(rowOf('project-b').hidden).toBe(false);
  });

  it('a key saved in the group moves the row up among the linked ones, open on its answer, with focus on its line', async () => {
    await mount([row('project-a', wire({ teamKey: 'BBB' })), row('project-b', wire())], hier([hrow('project-a', { teamKey: 'BBB' }), hrow('project-b', { teamKey: null })]));
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    fireEvent.click(group()!);
    const before = rowOf('project-b');
    vi.spyOn(api, 'saveLinking').mockImplementation(async () => {
      answer = hier([hrow('project-a', { teamKey: 'BBB' }), hrow('project-b', { teamKey: 'CCC' })]);
      return { ok: true, linking: wire({ teamKey: 'CCC', teamLink: { source: 'manual', at: NOW } }) };
    });
    fireEvent.change(keyField('project-b'), { target: { value: 'ccc' } });
    fireEvent.click(within(rowOf('project-b')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(kindOf('project-b')).toBe('linked'));
    expect(order()).toEqual(['project-a', 'project-b']);
    expect(rowOf('project-b'), 'the same row, moved: its state came with it').toBe(before);
    await waitFor(() => expect(fold('project-b').open).toBe(true));
    expect(within(rowOf('project-b')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(line('project-b')));
  });

  it('a key cleared on a linked row moves it into the group, which opens on it, with its answer and focus on its key field', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]);
    expect(group()!.getAttribute('aria-expanded')).toBe('false');
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamLink: { source: 'manual', at: NOW } }) });
    fireEvent.change(keyField('project-a'), { target: { value: '' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(kindOf('project-a')).toBe('unlinked'));
    expect(order()).toEqual(['project-b', '(group)', 'project-a', 'project-c']);
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
    expect(rowOf('project-a').hidden).toBe(false);
    expect(within(rowOf('project-a')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(keyField('project-a')));
  });

  it('a row that a read moves, not its own write, is left as it was: not opened, and focus is not taken', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire())]);
    expect(rowOf('project-b').hidden).toBe(true);
    // project-a's write is answered 502, so the list is read again; that read finds project-b linked by someone else.
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(502, { ok: false }));
    serve([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB', teamLink: AUTO }))]);
    const save = within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(kindOf('project-b')).toBe('linked'));
    expect(fold('project-b').open).toBe(false);
    expect(document.activeElement).not.toBe(line('project-b'));
    expect(group()).toBeNull();
  });

  // The three rules of a row moved by a write, each held apart (a mutation of any one alone turns its case red).
  /** The card over a list the case drives by hand: its rows, and a `refresh` that settles when the case says. */
  const driven = async (first: ProjectRow[]): Promise<{ set: (rows: ProjectRow[]) => void; settle: () => void; refreshes: () => number }> => {
    let setRead!: (r: ProjectListRead) => void;
    let settle: () => void = () => undefined;
    let refreshes = 0;
    function Host(): React.ReactNode {
      const [read, set] = useState<ProjectListRead>({ kind: 'read', rows: first });
      setRead = set;
      const list: ProjectList = {
        read,
        stored: (project, linking) => set((r) => (r.kind !== 'read' ? r : { kind: 'read', rows: r.rows.map((p) => (p.name === project ? { ...p, linking } : p)) })),
        refresh: () => { refreshes++; return new Promise<void>((resolve) => { settle = resolve; }); },
      };
      return <ProjectLinkingCard workspaces={null} list={list} />;
    }
    vi.spyOn(api, 'hierarchy').mockRejectedValue(new ApiError(404, { ok: false }));
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await act(async () => { render(<><ToastHost /><Host /></>); });
    return { set: (rows) => setRead({ kind: 'read', rows }), settle: () => settle(), refreshes: () => refreshes };
  };

  it('a refused key write is not a move of this row: a later read that moves it neither opens the group nor takes focus', async () => {
    const list = await driven([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]);
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    const save = within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save });
    save.focus();
    fireEvent.click(save);
    await within(rowOf('project-a')).findByRole('status');
    // Someone else clears project-a's key; the list is read again and the row moves into the group.
    await act(async () => { list.set([row('project-a', wire()), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]); });
    expect(kindOf('project-a')).toBe('unlinked');
    expect(group()!.getAttribute('aria-expanded'), 'the group is not opened for a move the operator did not make').toBe('false');
    expect(rowOf('project-a').hidden).toBe(true);
    expect(document.activeElement).not.toBe(keyField('project-a'));
  });

  it('a write that saved without moving the row is spent: a later read that moves it neither opens the group nor takes focus', async () => {
    const list = await driven([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]);
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: wire({ teamKey: 'AAA', override: 'public', mode: 'public' }) });
    fireEvent.change(overrideSelect('project-a'), { target: { value: 'public' } });
    await within(rowOf('project-a')).findByText(LINKING_TEXT.saved);
    expect(kindOf('project-a'), 'the override changed nothing about where the row is').toBe('linked');
    await act(async () => { list.set([row('project-a', wire({ override: 'public', mode: 'public' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]); });
    expect(kindOf('project-a')).toBe('unlinked');
    expect(group()!.getAttribute('aria-expanded')).toBe('false');
    expect(rowOf('project-a').hidden).toBe(true);
    expect(document.activeElement).not.toBe(keyField('project-a'));
  });

  it('a row its own write moved takes focus only once its lock lifts: the list re-read is still in flight when the row moves', async () => {
    const list = await driven([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]);
    // Clearing the key is answered 502: the write may have landed, so the list is read again and the row stays locked.
    vi.spyOn(api, 'saveLinking').mockRejectedValue(new ApiError(502, { ok: false }));
    fireEvent.change(keyField('project-a'), { target: { value: '' } });
    fireEvent.click(within(rowOf('project-a')).getByRole('button', { name: LINKING_TEXT.save }));
    await waitFor(() => expect(list.refreshes()).toBe(1));
    // The rows land (the key was cleared) before the re-read settles: the row moves while its field is still locked.
    await act(async () => { list.set([row('project-a', wire()), row('project-b', wire({ teamKey: 'BBB' })), row('project-c', wire())]); });
    expect(kindOf('project-a')).toBe('unlinked');
    expect(group()!.getAttribute('aria-expanded'), 'the group opened on the row').toBe('true');
    expect(keyField('project-a'), 'still locked behind the re-read').toBeDisabled();
    expect(document.activeElement).not.toBe(keyField('project-a'));
    await act(async () => { list.settle(); });
    await waitFor(() => expect(keyField('project-a')).not.toBeDisabled());
    await waitFor(() => expect(document.activeElement, 'focus waited for the lock').toBe(keyField('project-a')));
  });
});

describe('a row that needs a decision: the control that settles it sits under its reason', () => {
  const fold = (n: string): HTMLDetailsElement => rowOf(n).querySelector<HTMLDetailsElement>(':scope > details')!;
  const line = (n: string): HTMLElement => fold(n).querySelector<HTMLElement>(':scope > summary')!;
  const kindOf = (n: string): string | null => rowOf(n).getAttribute('data-linking-kind');
  const flag = (n: string): HTMLElement | null => rowOf(n).querySelector<HTMLElement>('[data-linking-flag]');
  const rest = (n: string): HTMLButtonElement => rowOf(n).querySelector<HTMLButtonElement>('[data-linking-rest]')!;
  const restBody = (n: string): HTMLElement => document.getElementById(rest(n).getAttribute('aria-controls')!)!;
  const slot = (n: string, control: string): HTMLElement | null => rowOf(n).querySelector<HTMLElement>(`[data-linking-control="${control}"]`);
  const slots = (n: string): Array<string | null> => [...rowOf(n).querySelectorAll('[data-linking-control]')].map((e) => e.getAttribute('data-linking-control'));
  const order = (): string[] => [...document.querySelectorAll('.linking-list > li')]
    .map((e) => e.getAttribute('data-linking-row') ?? (e.hasAttribute('data-linking-group') ? '(group)' : '?'));
  /** What Tab reaches in a row as it is drawn: every enabled control that is not inside something hidden, in the page's order. */
  const stops = (n: string): string[] => [...rowOf(n).querySelectorAll<HTMLElement>('summary, input, select, button, a[href], [role="checkbox"]')]
    .filter((e) => e.closest('[hidden]') === null && !(e as HTMLButtonElement).disabled)
    .map((e) => (e.tagName === 'SUMMARY' ? 'line' : e.tagName === 'INPUT' ? 'key' : e.tagName === 'SELECT' ? `select:${(e as HTMLSelectElement).labels[0]?.textContent ?? ''}` : (e.textContent ?? '')));
  const NONE = { id: null, source: 'none', live: false } as const;

  it('a shared key with no owning project: the Owning project box is the first control in the row, the rest waits behind More settings', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'AAA' }))], hier([hrow('project-a'), hrow('project-b')]));
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(slots('project-a')).toEqual(['owning']);
    const s = slot('project-a', 'owning')!;
    expect(s.querySelector('[data-linking-decision="owning"]')).toHaveTextContent(owningUnchosenWords({ key: 'AAA', others: ['project-b'] }));
    expect(within(s).getByRole('checkbox', { name: HIERARCHY_TEXT.owning })).toBeInTheDocument();
    // Three stops, where the whole form was eleven: the line, the box the reason names, and "More settings".
    expect(stops('project-a')).toEqual(['line', HIERARCHY_TEXT.owning, LINKING_ROW_WORDS.more]);
    expect(rest('project-a').getAttribute('aria-expanded')).toBe('false');
    expect(restBody('project-a').hidden).toBe(true);
    // The box is drawn once: it is not also in the form behind "More settings", and everything else is.
    expect(within(rowOf('project-a')).getAllByRole('checkbox', { name: HIERARCHY_TEXT.owning, hidden: true })).toHaveLength(1);
    fireEvent.click(rest('project-a'));
    const body = within(restBody('project-a'));
    expect(body.getByLabelText(LINKING_TEXT.teamKey)).toBeInTheDocument();
    expect(body.getByLabelText(LINKING_TEXT.override)).toBeInTheDocument();
    expect(body.getByLabelText(HIERARCHY_TEXT.owner)).toBeInTheDocument();
    expect(body.getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives })).toBeInTheDocument();
    expect(body.queryByRole('checkbox', { name: HIERARCHY_TEXT.owning })).toBeNull();
    expect(body.getByRole('button', { name: HIERARCHY_TEXT.reshape })).toBeInTheDocument();
  });

  it('a suggested team for a project with no team: the key cell is under the reason; owner, initiatives and state are not drawn until asked for', async () => {
    const candidates: TeamCandidateWire[] = [{ key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'project', on: 'name' } }];
    await mount([row('project-a', wire({ teamCandidates: candidates }))], hier([hrow('project-a', { teamKey: null })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(slots('project-a')).toEqual(['key']);
    expect(slot('project-a', 'key')!.querySelector('[data-linking-decision="suggested"]')).not.toBeNull();
    expect(stops('project-a')).toEqual(['line', 'key', LINKING_TEXT.save, 'Link AAA', LINKING_ROW_WORDS.more]);
    expect(restBody('project-a').hidden).toBe(true);
    expect(restBody('project-a').querySelector('[data-linking-hier]'), 'the hierarchy cell is behind More settings').not.toBeNull();
    expect(within(rowOf('project-a')).queryByRole('combobox', { name: HIERARCHY_TEXT.owner })).toBeNull();
    expect(within(rowOf('project-a')).queryByRole('checkbox', { name: HIERARCHY_TEXT.initiatives })).toBeNull();
  });

  it('a key in two workspaces: the key cell, with its picker, is under the reason', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: null }))]);
    expect(slots('project-a')).toEqual(['key']);
    expect(slot('project-a', 'key')!.querySelector('[data-linking-decision="workspace"]')).not.toBeNull();
    expect(slot('project-a', 'key')!.querySelector('[data-linking-workspace]')).not.toBeNull();
    expect(stops('project-a')).toEqual(['line', 'key', `select:${PICKER_WORDS.label}`, LINKING_ROW_WORDS.more]);
  });

  it('a map waiting: the link to the item is under the reason, and is not drawn twice', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], hier([hrow('project-a', { state: 'map-waiting', itemId: 42 })]));
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(slots('project-a')).toEqual(['map']);
    expect(slot('project-a', 'map')!.querySelector('[data-linking-decision="map"]')).toHaveTextContent(mapWaitingWords('AAA'));
    expect(within(slot('project-a', 'map')!).getByRole('link', { name: HIERARCHY_TEXT.mapWaiting }).getAttribute('href')).toBe(itemPath(42));
    expect(stops('project-a')).toEqual(['line', HIERARCHY_TEXT.mapWaiting, LINKING_ROW_WORDS.more]);
    expect(within(rowOf('project-a')).getAllByRole('link', { name: HIERARCHY_TEXT.mapWaiting, hidden: true })).toHaveLength(1);
  });

  it('inbound issues with no live owner: flagged, with the Linear owner select under the reason; with a live owner the line says the count and nothing waits', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a', { inboundWaiting: 2, ownerNow: NONE }), hrow('project-b', { teamKey: 'BBB', inboundWaiting: 3 })]));
    await waitFor(() => expect(kindOf('project-a')).toBe('decision'));
    expect(flag('project-a')).not.toBeNull();
    expect(slots('project-a')).toEqual(['owner']);
    expect(slot('project-a', 'owner')!.querySelector('[data-linking-decision="inbound"]')).toHaveTextContent(inboundUnownedWords(2));
    expect(within(slot('project-a', 'owner')!).getByRole('combobox', { name: HIERARCHY_TEXT.owner })).toBeInTheDocument();
    expect(within(rowOf('project-a')).getAllByRole('combobox', { name: HIERARCHY_TEXT.owner, hidden: true })).toHaveLength(1);
    expect(line('project-a')).toHaveTextContent('no live owner');
    expect(line('project-a')).toHaveTextContent('2 inbound issues waiting');
    // A live owner takes them: the row stays one line, shut, and its line still says they wait.
    expect(kindOf('project-b')).toBe('linked');
    expect(fold('project-b').open).toBe(false);
    expect(flag('project-b')).toBeNull();
    expect(line('project-b')).toHaveTextContent('3 inbound issues waiting');
  });

  it('the line says what differs from a quiet row: a public repository, a missing template, a visibility that was not read', async () => {
    await mount([
      row('project-a', wire({ teamKey: 'AAA', measured: measured({ template: 'present' }) })),
      row('project-b', wire({ teamKey: 'BBB', mode: 'public', measured: measured({ visibility: 'public', template: 'present' }) })),
      row('project-c', wire({ teamKey: 'CCC' })),
      row('project-d', wire({ teamKey: 'DDD', mode: 'unknown', measured: { state: 'failed', reason: 'offline', at: NOW } })),
    ]);
    const notes = (n: string): Array<string | null> => [...line(n).querySelectorAll('[data-linking-sum="note"]')].map((e) => e.textContent);
    expect(notes('project-a'), 'private, with its template: nothing to add').toEqual([]);
    expect(notes('project-b')).toEqual([LINKING_ROW_WORDS.public]);
    expect(notes('project-c')).toEqual([LINKING_ROW_WORDS.noTemplate]);
    expect(notes('project-d')).toEqual([LINKING_ROW_WORDS.notRead]);
  });

  it('the rows that wait come first, and a row the operator settles keeps its place, its control and its answer', async () => {
    await mount([row('project-a', wire({ teamKey: 'BBB' })), row('project-b', wire({ teamKey: 'AAA' })), row('project-c', wire({ teamKey: 'AAA' }))],
      hier([hrow('project-a', { teamKey: 'BBB' }), hrow('project-b'), hrow('project-c')]));
    await waitFor(() => expect(kindOf('project-b')).toBe('decision'));
    expect(order()).toEqual(['project-b', 'project-c', 'project-a']);
    expect(document.querySelector('[data-linking-counts]')).toHaveTextContent('2 need a decision · 1 linked');
    vi.spyOn(api, 'saveHierarchy').mockImplementation(async () => {
      answer = hier([hrow('project-a', { teamKey: 'BBB' }), hrow('project-b'), hrow('project-c', { ownsTeam: true })]);
      return { ok: true, settings: { initiatives: 'on', linearOwner: null, ownsTeam: true } };
    });
    const box = within(rowOf('project-c')).getByRole('checkbox', { name: HIERARCHY_TEXT.owning });
    fireEvent.click(box);
    await waitFor(() => expect(kindOf('project-c')).toBe('linked'));
    expect(kindOf('project-b')).toBe('linked');
    // Nothing jumped: both rows are where they were, above the row that never waited.
    expect(order()).toEqual(['project-b', 'project-c', 'project-a']);
    expect(document.querySelector('[data-linking-counts]')).toHaveTextContent('3 linked');
    // The box that was ticked is the same element, still under where its reason was, now checked; the reason is gone.
    expect(within(rowOf('project-c')).getByRole('checkbox', { name: HIERARCHY_TEXT.owning })).toBe(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(slot('project-c', 'owning')!.querySelector('[data-linking-decision]')).toBeNull();
    expect(within(rowOf('project-c')).getByText(LINKING_TEXT.saved)).toBeInTheDocument();
    // Shut and opened again, a settled row is the whole form, with no control lifted out of it.
    fireEvent.click(line('project-c'));
    fold('project-c').open = false;
    fireEvent(fold('project-c'), new Event('toggle'));
    fold('project-c').open = true;
    fireEvent(fold('project-c'), new Event('toggle'));
    await waitFor(() => expect(slots('project-c')).toEqual([]));
    expect(rowOf('project-c').querySelector('[data-linking-rest]')).toBeNull();
    expect(within(rowOf('project-c')).getByLabelText(LINKING_TEXT.teamKey)).toBeInTheDocument();
    expect(within(rowOf('project-c')).getByRole('checkbox', { name: HIERARCHY_TEXT.owning })).toBeChecked();
  });

  it('one key stored in two different Linear workspaces is two teams: neither row is flagged, and each still has its Owning project box', async () => {
    serveWorkspaces([wsView('id-a', 'ws-a', ['AAA']), wsView('id-b', 'ws-b', ['AAA'])]);
    await mount([row('project-a', wire({ teamKey: 'AAA', teamWorkspace: 'id-a' })), row('project-b', wire({ teamKey: 'AAA', teamWorkspace: 'id-b' }))],
      hier([hrow('project-a'), hrow('project-b')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    for (const n of ['project-a', 'project-b']) {
      expect(kindOf(n), n).toBe('linked');
      expect(flag(n), n).toBeNull();
      expect(fold(n).open, n).toBe(false);
      expect(rowOf(n).querySelector('[data-linking-decision]'), n).toBeNull();
      expect(within(rowOf(n)).getByRole('checkbox', { name: HIERARCHY_TEXT.owning })).toBeInTheDocument();
    }
  });
});

describe('a coordinator select offers the live coordinators first', () => {
  const many = (projects: HierarchyProjectRow[]): HierarchyAnswer => ({
    ok: true, projects,
    coordinators: [{ id: 'coord-a', live: true }, { id: 'coord-b', live: false }, { id: 'coord-c', live: true }, { id: 'coord-d', live: false }],
  });
  const owner = (n: string): HTMLSelectElement => within(rowOf(n)).getByLabelText(HIERARCHY_TEXT.owner) as HTMLSelectElement;
  const options = (s: HTMLSelectElement): Array<string | null> => [...s.querySelectorAll('option')].map((o) => o.textContent);
  const more = (scope: HTMLElement): HTMLElement => scope.querySelector<HTMLElement>('[data-linking-more]')!;

  it('the Linear owner: the default stated first, then the live ones; the rest are counted behind a control, not listed', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], many([hrow('project-a')]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(options(owner('project-a'))).toEqual(['Default: coord-a (live)', 'coord-a', 'coord-c']);
    expect(owner('project-a').querySelector('optgroup')).toBeNull();
    const show = more(rowOf('project-a'));
    expect(show).toHaveTextContent(NOT_LIVE_WORDS.show(2));
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(show.getAttribute('aria-expanded')).toBe('true');
    expect(show).toHaveTextContent(NOT_LIVE_WORDS.hide);
    expect(options(owner('project-a'))).toEqual(['Default: coord-a (live)', 'coord-a', 'coord-c', 'coord-b (not live)', 'coord-d (not live)']);
    const grouped = owner('project-a').querySelector('optgroup')!;
    expect(grouped.getAttribute('label')).toBe(NOT_LIVE_WORDS.group);
    expect([...grouped.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['coord-b (not live)', 'coord-d (not live)']);
    fireEvent.click(show);
    expect(options(owner('project-a'))).toEqual(['Default: coord-a (live)', 'coord-a', 'coord-c']);
  });

  it('a stored owner that is not live stays the shown choice while the rest are hidden', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))],
      many([hrow('project-a', { linearOwner: 'coord-d', ownerNow: { id: 'coord-d', source: 'named', live: false, ifUnnamed: { id: 'coord-a', live: true } } })]));
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(owner('project-a').value).toBe('coord-d');
    expect(options(owner('project-a'))).toEqual(['Default: coord-a (live)', 'coord-d (not live)', 'coord-a', 'coord-c']);
  });

  it('a fleet with more live coordinators than the short list: the select holds the default and the stored owner, and one control shows them all', async () => {
    const live = Array.from({ length: COORDINATOR_SHORT_LIST + 4 }, (_, i) => ({ id: `coord-${String(i + 1).padStart(2, '0')}`, live: true }));
    const coordinators = [...live, { id: 'coord-x', live: false }];
    await mount([row('project-a', wire({ teamKey: 'AAA' }))], {
      ok: true, coordinators,
      projects: [hrow('project-a', { linearOwner: 'coord-05', ownerNow: { id: 'coord-05', source: 'named', live: true, ifUnnamed: { id: 'coord-01', live: true } } })],
    });
    await within(rowOf('project-a')).findByText('Default: coord-01 (live)');
    expect(options(owner('project-a')), 'no wall of ids').toEqual(['Default: coord-01 (live)', 'coord-05']);
    expect(owner('project-a').value).toBe('coord-05');
    const show = more(rowOf('project-a'));
    expect(show).toHaveTextContent(NOT_LIVE_WORDS.showAll(coordinators.length));
    fireEvent.click(show);
    expect(options(owner('project-a'))).toEqual(['Default: coord-01 (live)', ...live.map((c) => c.id), 'coord-x (not live)']);
    expect(owner('project-a').value).toBe('coord-05');
    expect(show).toHaveTextContent(NOT_LIVE_WORDS.fewer);
  });

  it('the coordinator for every project: the act follows its select in the page, and the "show" control comes after both', async () => {
    const region = await mount([row('project-a', wire({ teamKey: 'AAA' }))], many([hrow('project-a')]));
    const all = region.querySelector<HTMLElement>('[data-linking-all]')!;
    await within(all).findByLabelText(HIERARCHY_TEXT.allPick);
    // Tab's order is the page's order: what is drawn beside the select has to be next in it.
    expect([...all.querySelectorAll('select, button')].map((e) => (e.tagName === 'SELECT' ? 'select' : e.textContent)))
      .toEqual(['select', HIERARCHY_TEXT.allAct, NOT_LIVE_WORDS.show(2)]);
  });

  it('with every coordinator live there is nothing to show, and no control', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' }))],
      { ok: true, projects: [hrow('project-a')], coordinators: [{ id: 'coord-a', live: true }] });
    await within(rowOf('project-a')).findByText('Default: coord-a (live)');
    expect(rowOf('project-a').querySelector('[data-linking-more]')).toBeNull();
  });

  it('the coordinator for every project is offered the same way, and a not-live pick stays picked when they are hidden again', async () => {
    const region = await mount([row('project-a', wire({ teamKey: 'AAA' }))], many([hrow('project-a')]));
    const all = region.querySelector<HTMLElement>('[data-linking-all]')!;
    const pick = await within(all).findByLabelText(HIERARCHY_TEXT.allPick) as HTMLSelectElement;
    expect(options(pick)).toEqual([HIERARCHY_TEXT.allNone, 'coord-a', 'coord-c']);
    fireEvent.click(more(all));
    expect(options(pick)).toEqual([HIERARCHY_TEXT.allNone, 'coord-a', 'coord-c', 'coord-b (not live)', 'coord-d (not live)']);
    fireEvent.change(pick, { target: { value: 'coord-d' } });
    fireEvent.click(more(all));
    expect(pick.value).toBe('coord-d');
    expect(options(pick)).toEqual([HIERARCHY_TEXT.allNone, 'coord-d (not live)', 'coord-a', 'coord-c']);
  });
});

describe('Reshape in Linear stays one confirm per team', () => {
  it('two projects of two teams: each row has its own control, and its confirm names its own team and consequence', async () => {
    await mount([row('project-a', wire({ teamKey: 'AAA' })), row('project-b', wire({ teamKey: 'BBB' }))],
      hier([hrow('project-a'), hrow('project-b', { teamKey: 'BBB' })]));
    await within(rowOf('project-b')).findByText('Default: coord-a (live)');
    const call = vi.spyOn(api, 'migrate').mockResolvedValue({ ok: true, migrationId: 5 });
    fireEvent.click(within(rowOf('project-b')).getByRole('button', { name: HIERARCHY_TEXT.reshape }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(reshapeTitle('BBB'))).toBeInTheDocument();
    expect(dialog.textContent).toContain(reshapeConsequence('BBB'));
    expect(dialog.textContent).not.toContain('AAA');
    expect(call, 'nothing is asked before the confirm').not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: HIERARCHY_TEXT.reshapeConfirm }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call).toHaveBeenCalledWith('project-b');
  });
});
