// Settings › Integrations (D-8932): the section of its own that holds the Linear card, Project
// linking and the GitHub card. Linear and Project linking sat on Security; they moved here whole (the same cards, the
// same routes and writes: linear-section.test.tsx and project-linking-card.test.tsx hold those). This suite holds the
// section itself: its route, its index row and palette command, its card order, its one read of the project list, and the
// read-only GitHub card. Neutral fixtures: `project-a`, `owner/repo`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectRow } from '../../shared/api';
import type { ProjectLinkingWire } from '../../shared/linking';
import { CommandLayer } from '../src/command/CommandLayer';
import { GITHUB_TEXT } from '../src/fleet/githubWords';
import { SETTINGS_CARDS, SETTINGS_INDEX_TEXT, SETTINGS_SCOPE } from '../src/fleet/settingsText';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { navigate } from '../src/lib/router';
import { ROUTES, matchRoute } from '../src/lib/routes';
import { GitHubCard } from '../src/screens/settings/GitHubCard';
import { SettingsDataProvider } from '../src/screens/settings/SettingsDataProvider';
import { SettingsScreen } from '../src/screens/settings/SettingsFrame';
import { SECTION_ICON } from '../src/screens/settings/SettingsIndex';
import { INTEGRATIONS_GITHUB_STATUS } from '../src/screens/settings/sectionStatus';
import { renderSettings } from './settingsHost';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
});

const NOW = Date.UTC(2026, 10, 22, 12);
type Reading = ProjectLinkingWire['measured'];
const measured = (at: number): Reading => ({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at });
const wire = (m: Reading): ProjectLinkingWire =>
  ({ teamKey: null, override: null, measured: m, mode: 'unknown', initiatives: 'on', linearOwner: null, ownsTeam: false });
const row = (name: string, m: Reading): ProjectRow => ({ name, workdir: `/w/${name}`, linking: wire(m) });

/** Every Settings read pending but Linear's (an empty list) and the two the cards make: the project list and the hierarchy
 *  (an older server, 404). */
const reads = (projects: ProjectRow[] | 'pending' | 'failed' = []) => {
  const never = (): Promise<never> => new Promise(() => {});
  vi.stubGlobal('fetch', vi.fn((): Promise<never> => never()));
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.spyOn(api, 'updates').mockImplementation(never);
  vi.spyOn(api, 'stallWatch').mockImplementation(never);
  vi.spyOn(api, 'collectLane').mockImplementation(never);
  vi.spyOn(api, 'dispatchAbandon').mockImplementation(never);
  vi.spyOn(api, 'testbox').mockImplementation(never);
  return {
    linear: vi.spyOn(api, 'linearWorkspaces').mockResolvedValue({ store: 'ok', workspaces: [], legacy: null }),
    projects: projects === 'pending' ? vi.spyOn(api, 'projects').mockImplementation(never)
      : projects === 'failed' ? vi.spyOn(api, 'projects').mockRejectedValue(new ApiError(500, { ok: false }))
        : vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects }),
    hierarchy: vi.spyOn(api, 'hierarchy').mockRejectedValue(new ApiError(404, { ok: false })),
  };
};
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const github = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.integrations.github.title });
const state = (): string | null => github().querySelector('[data-github-state]')?.getAttribute('data-github-state') ?? null;

describe('the section', () => {
  it('has its own route, a page under Settings, with a path of its own', () => {
    const route = ROUTES.find((r) => r.id === 'settings-integrations');
    expect(route).toMatchObject({ title: 'Integrations', path: '/settings/integrations', top: false });
    expect(matchRoute('/settings/integrations')?.route.id).toBe('settings-integrations');
    expect(matchRoute('/settings/integrations/')?.route.id).toBe('settings-integrations');
  });

  it('/settings/integrations is its page: the h2, the title, and the five cards in order, each a level-3 card with its scope', async () => {
    reads();
    renderSettings('integrations');
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const h2 = screen.getByRole('heading', { level: 2, name: 'Integrations' });
    expect(document.activeElement, 'opening a section moves focus to its heading').toBe(h2);
    expect(document.title).toBe('Integrations · Settings · ccrc');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Linear', 'Project linking', 'GitHub', 'Docs folders', 'Docs settings']);
    expect(within(screen.getByRole('region', { name: 'Docs settings' })).getByText(SETTINGS_SCOPE.box)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Linear' })).getByText(SETTINGS_SCOPE.box)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Project linking' })).getByText(SETTINGS_SCOPE.box)).toBeInTheDocument();
    expect(within(github()).getByText(SETTINGS_SCOPE.fleet)).toBeInTheDocument();
    // None of Security's cards came with them.
    for (const name of ['Sign-in gate', 'Box token', 'Approvals']) expect(screen.queryByRole('heading', { name }), name).toBeNull();
  });

  it('reads the project list once for both cards that draw from it, and the hierarchy once', async () => {
    const r = reads([row('project-a', measured(NOW - 3_600_000))]);
    renderSettings('integrations');
    await settle();
    expect(document.querySelector('[data-linking-row="project-a"]'), 'Project linking drew the row').not.toBeNull();
    expect(state(), 'and the GitHub card read the same rows').toBe('answered');
    expect(r.projects).toHaveBeenCalledTimes(1);
    expect(r.hierarchy).toHaveBeenCalledTimes(1);
    expect(r.linear).toHaveBeenCalledTimes(1);
  });
});

describe('its entry on the Settings index', () => {
  const entry = (): HTMLElement => screen.getByRole('navigation', { name: SETTINGS_INDEX_TEXT.navLabel }).querySelector<HTMLElement>('a[data-section="integrations"]')!;

  it('is the last section, with its icon, its one-line summary and a measured status', async () => {
    reads();
    renderSettings(null);
    await settle();
    const rows = [...document.querySelectorAll('a[data-section]')].map((a) => a.getAttribute('data-section'));
    expect(rows[rows.length - 1]).toBe('integrations');
    expect(entry()).toHaveAttribute('href', '/settings/integrations');
    expect(entry().querySelector('.settings-index-name')?.textContent).toBe('Integrations');
    expect(entry().querySelector('.settings-index-purpose')?.textContent).toBe(SETTINGS_INDEX_TEXT.purpose.integrations);
    expect(SETTINGS_INDEX_TEXT.purpose.integrations).toBe('The services ccrc works with: the Linear keys, the Linear team each project is linked to, and GitHub.');
    expect(SECTION_ICON.integrations).toBe('network');
    expect(entry().querySelectorAll('svg')).toHaveLength(2);
    expect(entry().querySelector('.settings-index-status')?.textContent).toBe(`Linear: no key yet · ${INTEGRATIONS_GITHUB_STATUS}`);
  });

  it('is the door of its Go to command: a click opens the page, and the palette offers the same command', async () => {
    reads();
    navigate('/settings');
    render(<><SettingsDataProvider active><SettingsScreen /></SettingsDataProvider><CommandLayer openNewSession={vi.fn()} /></>);
    await settle();
    expect(entry()).toHaveAttribute('data-command', 'go-settings-integrations');
    fireEvent.click(entry());
    expect(location.pathname).toBe('/settings/integrations');
    expect(await screen.findByRole('heading', { level: 2, name: 'Integrations' })).toBeInTheDocument();
    // The same place from the palette.
    act(() => navigate('/settings'));
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'integrations' } });
    fireEvent.click(screen.getByRole('option', { name: /^Go to Settings › Integrations/ }));
    expect(location.pathname).toBe('/settings/integrations');
  });
});

describe('the GitHub card', () => {
  const mount = async (projects: Parameters<typeof reads>[0]): Promise<void> => {
    reads(projects);
    renderSettings('integrations');
    await settle();
  };

  it('says what ccrc uses for GitHub today, and that a stored key is coming, whatever the readings say', async () => {
    for (const projects of [[], 'pending', 'failed', [row('project-a', measured(NOW - 60_000))]] as const) {
      await mount(projects as Parameters<typeof reads>[0]);
      expect(within(github()).getByText(GITHUB_TEXT.uses), String(projects)).toBeInTheDocument();
      expect(within(github()).getByText(GITHUB_TEXT.coming), String(projects)).toBeInTheDocument();
      expect(within(github()).getByText(SETTINGS_CARDS.integrations.github.purpose)).toBeInTheDocument();
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it('a reading that succeeded: GitHub answered the fleet box then, said with its age, in the calm ink', async () => {
    await mount([row('project-a', measured(NOW - 3 * 3_600_000)), row('project-b', { state: 'unmeasured' })]);
    expect(state()).toBe('answered');
    const line = within(github()).getByText('GitHub answered the fleet box 3h ago, so its sign-in worked then.');
    expect(line).toHaveClass('settings-note');
    expect(line).not.toHaveClass('settings-catalogue--amber');
  });

  it('a reading refused for the sign-in: said in amber, with what to run on the fleet box', async () => {
    await mount([row('project-a', measured(NOW - 3 * 3_600_000)), row('project-b', { state: 'failed', reason: 'unauthenticated', at: NOW - 600_000 })]);
    expect(state()).toBe('refused');
    const line = within(github()).getByText("GitHub refused the fleet box's sign-in 10m ago. Run gh auth login on the fleet box, then ccrc doctor to check it.");
    expect(line).toHaveClass('settings-catalogue--amber');
  });

  it('no reading that speaks to the sign-in: it says it does not know, never that the box is signed in', async () => {
    await mount([row('project-a', { state: 'unmeasured' }), row('project-b', { state: 'failed', reason: 'offline', at: NOW - 60_000 })]);
    expect(state()).toBe('unknown');
    expect(within(github()).getByText(GITHUB_TEXT.unknown)).toBeInTheDocument();
  });

  it('a project list not read yet is a skeleton, and one that could not be read says so; neither is a status', async () => {
    await mount('pending');
    expect(state()).toBeNull();
    expect(within(github()).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();
    await mount('failed');
    expect(state()).toBe('unread');
    expect(within(github()).getByText(GITHUB_TEXT.unread)).toBeInTheDocument();
  });

  it('is read-only: no button, field, select, checkbox or link, in any state', () => {
    for (const list of [
      { kind: 'loading' as const }, { kind: 'failed' as const },
      { kind: 'read' as const, rows: [row('project-a', measured(NOW))] },
      { kind: 'read' as const, rows: [row('project-a', { state: 'failed', reason: 'unauthenticated', at: NOW })] },
    ]) {
      const { container, unmount } = render(<GitHubCard list={list} />);
      expect(container.querySelectorAll('button, input, select, textarea, a, [role="button"], [role="checkbox"], [tabindex]'), list.kind).toHaveLength(0);
      unmount();
    }
  });

  it('follows the list as Project linking changes it: a row a write stored is the row it reads', async () => {
    await mount([row('project-a', { state: 'unmeasured' })]);
    expect(state()).toBe('unknown');
    // A key saved on the row answers the stored cell, which now carries a reading; both cards draw from that one list.
    vi.spyOn(api, 'saveLinking').mockResolvedValue({ ok: true, linking: { ...wire(measured(NOW - 60_000)), teamKey: 'AAA' } });
    const linking = document.querySelector<HTMLElement>('[data-linking-row="project-a"]')!;
    // The project has no team, so its row is a plain line whose field is named for it.
    fireEvent.change(within(linking).getByRole('textbox', { name: 'Team key for project-a' }), { target: { value: 'AAA' } });
    fireEvent.click(within(linking).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state()).toBe('answered'));
  });
});
