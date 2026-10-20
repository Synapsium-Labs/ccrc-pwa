// Settings' frame (settings Task R2b1; spec §3.2, §4.1, §4.4; D-5503, D-5504): the index, the five section routes
// inside the frame, focus on the way in and out, the not-found line, and the one provider whose reads every page and
// the index share. The rendering cases mount the frame as `app.tsx` does (`settingsHost.tsx`), with the command
// layer beside it so an index row's door navigates.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CommandLayer } from '../src/command/CommandLayer';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { SETTINGS_SECTIONS } from '../src/lib/routes';
import { SettingsDataProvider, useSettingsView } from '../src/screens/settings/SettingsDataProvider';
import { SettingsScreen } from '../src/screens/settings/SettingsFrame';
import { useFleetStore } from '../src/stores/fleet';
import { renderSettings } from './settingsHost';
import { updatesView } from './settingsViewFixture';

const SRC = path.join(import.meta.dirname, '..', 'src');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

/** Every Settings read, pending forever, counted. */
const pendingReads = () => {
  const never = (): Promise<never> => new Promise(() => {});
  const fetch = vi.fn((_url: unknown): Promise<never> => never());
  vi.stubGlobal('fetch', fetch);
  return {
    updates: vi.spyOn(api, 'updates').mockImplementation(never),
    stall: vi.spyOn(api, 'stallWatch').mockImplementation(never),
    collect: vi.spyOn(api, 'collectLane').mockImplementation(never),
    fetch,
  };
};

const index = (): HTMLElement => screen.getByRole('navigation', { name: 'Settings sections' });
const row = (id: string): HTMLElement => index().querySelector<HTMLElement>(`a[data-section="${id}"]`)!;

describe('the index and the section routes', () => {
  it('/settings is the index: five rows with icon, name, purpose and a status, each a link to its page', () => {
    pendingReads();
    renderSettings(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const links = within(index()).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    for (const a of links) {
      expect(a).toHaveClass('settings-index-row');
      expect(a.querySelectorAll('svg')).toHaveLength(2);   // the section's icon and the chevron
      expect(a.getAttribute('data-command')).toBe(`go-settings-${a.getAttribute('data-section')}`);
    }
    expect(within(row('automation')).getByText(/clearing what dead sessions leave behind/)).toBeInTheDocument();
  });

  it('a row\'s visible purpose line is not repeated as its title, so a screen reader says it once', () => {
    pendingReads();
    renderSettings(null);
    for (const a of within(index()).getAllByRole('link')) {
      expect(a.querySelector('.settings-index-purpose')?.textContent).not.toBe('');
      expect(a).not.toHaveAttribute('title');
    }
  });

  it('/settings/<id> renders that section\'s bodies under its h2, and the h1 stays Settings', async () => {
    pendingReads();
    const marks: Record<string, () => Promise<unknown>> = {
      updates: () => screen.findByRole('status', { name: 'Loading' }),
      appearance: () => screen.findByRole('group', { name: 'Theme' }),
      notifications: () => screen.findByText(/Push notifications for this browser|This browser cannot receive Web Push\./),
      automation: () => screen.findByRole('heading', { level: 3, name: 'Temp root collector' }),
      security: () => screen.findByRole('status', { name: 'Loading' }),
    };
    for (const s of SETTINGS_SECTIONS) {
      renderSettings(s.id);
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([s.title]);
      await marks[s.id]!();
      expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
      expect(document.title).toBe(`${s.title} · Settings · ccrc`);
      cleanup();
    }
  });

  it('an unknown id renders the not-found line above the index', () => {
    pendingReads();
    navigate('/settings/bogus');
    render(<SettingsDataProvider active><SettingsScreen /></SettingsDataProvider>);
    const line = screen.getByText('That section does not exist.');
    expect(line.compareDocumentPosition(index()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(index()).getAllByRole('link')).toHaveLength(5);
  });

  it('headings nest h1, h2, h3 with no level skipped (the Automation page, its two cards)', () => {
    pendingReads();
    renderSettings('automation');
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    expect(levels).toEqual([1, 2, 3, 3]);
  });
});

describe('focus', () => {
  it('moving to a section focuses its h2, and Back returns focus to its row', () => {
    pendingReads();
    navigate('/settings');
    render(
      <>
        <SettingsDataProvider active><SettingsScreen /></SettingsDataProvider>
        <CommandLayer openNewSession={vi.fn()} />
      </>,
    );
    act(() => { fireEvent.click(row('notifications')); });
    expect(location.pathname).toBe('/settings/notifications');
    const h2 = screen.getByRole('heading', { level: 2, name: 'Notifications' });
    expect(document.activeElement).toBe(h2);
    expect(h2).toHaveAttribute('tabindex', '-1');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' })); });
    expect(location.pathname).toBe('/settings');
    expect(document.activeElement).toBe(row('notifications'));
  });
});

describe('the provider: reads made once (spec §4.4)', () => {
  for (const desk of [false, true]) {
    it(`one useUpdatesView poll serves the index and every section across a walk of all five, and refetches nothing between them (${desk ? '1280' : 'phone'})`, () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: desk && q.includes('min-width: 900px'), media: q, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }));
      const reads = pendingReads();
      renderSettings(null);
      for (const s of SETTINGS_SECTIONS) {
        act(() => { navigate(`/settings/${s.id}`); });
        expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeInTheDocument();
        act(() => { navigate('/settings'); });
      }
      expect(reads.updates).toHaveBeenCalledTimes(1);
      expect(reads.stall).toHaveBeenCalledTimes(1);
      expect(reads.collect).toHaveBeenCalledTimes(1);
      // The auth status, once per mount (its own fetch: `readAuthStatus` never raises auth-lost).
      expect(reads.fetch.mock.calls.filter(([u]) => String(u).includes('/api/auth/status'))).toHaveLength(1);
    });
  }

  /** A browser that can do Web Push, with the given permission and a subscription the test can flip. */
  const stubPush = (permission: NotificationPermission) => {
    const state = { subscribed: false };
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', { permission, requestPermission: vi.fn() });
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription: async () => (state.subscribed ? {} : null) } }),
      },
    });
    return state;
  };
  const pushLine = (): string => row('notifications').querySelector('.settings-index-status')?.textContent ?? '';

  it('the index reads the push state again when it mounts, so a toggle on the Notifications page shows after Back', async () => {
    pendingReads();
    const push = stubPush('granted');
    renderSettings(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(pushLine()).toMatch(/^Pushes off in this browser/);
    act(() => { navigate('/settings/notifications'); });
    push.subscribed = true;
    act(() => { navigate('/settings'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(pushLine()).toMatch(/^Pushes on in this browser/);
  });

  it('a denied notification permission reads as blocked, never off', async () => {
    pendingReads();
    stubPush('denied');
    let seen: ReturnType<typeof useSettingsView> = null;
    function Probe(): null { seen = useSettingsView(); return null; }
    navigate('/settings');
    render(<SettingsDataProvider active><SettingsScreen /><Probe /></SettingsDataProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(seen!.push).toBe('blocked');
    expect(pushLine()).toMatch(/^Pushes blocked in this browser/);
  });

  it('no Settings read starts while active is false, and the view is null', () => {
    const reads = pendingReads();
    let seen: unknown = 'unset';
    function Probe(): null { seen = useSettingsView(); return null; }
    render(<SettingsDataProvider active={false}><Probe /></SettingsDataProvider>);
    expect(seen).toBeNull();
    expect(reads.updates).not.toHaveBeenCalled();
    expect(reads.stall).not.toHaveBeenCalled();
    expect(reads.collect).not.toHaveBeenCalled();
    expect(reads.fetch).not.toHaveBeenCalled();
  });

  it('turning inactive stops the reads and nulls the view; turning active again starts them afresh', () => {
    const reads = pendingReads();
    let seen: unknown = 'unset';
    function Probe(): null { seen = useSettingsView(); return null; }
    const view = render(<SettingsDataProvider active><Probe /></SettingsDataProvider>);
    expect(seen).not.toBeNull();
    view.rerender(<SettingsDataProvider active={false}><Probe /></SettingsDataProvider>);
    expect(seen).toBeNull();
    view.rerender(<SettingsDataProvider active><Probe /></SettingsDataProvider>);
    expect(seen).not.toBeNull();
    expect(reads.updates).toHaveBeenCalledTimes(2);
  });

  it('no file under screens/settings/ but the provider imports a read hook or lib/push\'s reads', () => {
    const dir = path.join(SRC, 'screens', 'settings');
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files).toContain('SettingsDataProvider.tsx');
    expect(files.length).toBeGreaterThanOrEqual(9);
    const READS = new Set(['useUpdatesView', 'useStallWatchView', 'useCollectLaneView', 'readAuthStatus', 'pushEnabled', 'pushSupported']);
    /** The value names a file imports (a `type` import reads nothing). */
    const imported = (text: string): string[] => [...text.matchAll(/^import \{([^}]*)\} from '[^']+';/gm)]
      .flatMap((m) => m[1]!.split(',').map((n) => n.trim()).filter((n) => n !== '' && !n.startsWith('type ')))
      .map((n) => n.split(' as ')[0]!.trim());
    const importers = files.filter((f) => imported(readFileSync(path.join(dir, f), 'utf8')).some((n) => READS.has(n)));
    expect(importers).toEqual(['SettingsDataProvider.tsx']);
    // And the two cards outside the directory take the frame's poll rather than reading their own.
    for (const f of [path.join('screens', 'StallWatchSection.tsx'), path.join('fleet', 'CollectLaneSection.tsx')]) {
      expect(readFileSync(path.join(SRC, f), 'utf8'), f).not.toMatch(/\buse(StallWatch|CollectLane)View\(/);
    }
  });
});

describe('the move: nothing lost, nothing twice', () => {
  /** Every control today's page rendered, by its accessible name, with the read each needs answered. */
  const CONTROLS: readonly (readonly [RegExp | string, string])[] = [
    ['Check now', 'button'], ['Channel', 'group'], ['Auto-install', 'group'],
    ['Layout', 'group'], ['Theme', 'group'],
    ['Announce new releases', 'group'],
    ['Rotate now', 'button'],
  ];

  it('every control today\'s page renders is rendered by exactly one section page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView());
    vi.spyOn(api, 'stallWatch').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'collectLane').mockReturnValue(new Promise(() => {}));
    const counts = new Map<string, number>();
    for (const s of SETTINGS_SECTIONS) {
      renderSettings(s.id);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      for (const [name, role] of CONTROLS) {
        const found = screen.queryAllByRole(role as 'button', { name });
        counts.set(String(name), (counts.get(String(name)) ?? 0) + found.length);
      }
      cleanup();
    }
    for (const [name] of CONTROLS) expect(counts.get(String(name)), String(name)).toBe(1);
  });

  it('the Stall watch and Temp root collector cards are each on one page only', async () => {
    pendingReads();
    const pages: string[] = [];
    for (const s of SETTINGS_SECTIONS) {
      renderSettings(s.id);
      if (screen.queryAllByRole('heading', { name: /^(Stall watch|Temp root collector)$/ }).length > 0) pages.push(s.id);
      for (const h of screen.queryAllByRole('heading', { name: 'Stall watch' })) expect(h.tagName).toBe('H3');
      expect(screen.queryAllByRole('heading', { name: 'Stall watch' }).length).toBeLessThanOrEqual(1);
      cleanup();
    }
    expect(pages).toEqual(['automation']);
  });
});
