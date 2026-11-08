// D-8121: browser MCP servers off by default — the console's half. The words module's readers (`browserMcpView`,
// `browserBoxOf`, `browserFleetCount`), the Settings › Automation › Browser tools card, the session's Browser tools sheet
// (its write is `api.route(id, 'browser', …)`, a 501 said in words) and the New session sheet's Browser field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BoxSettingName, BoxSettingRowV2, BoxSettingsDocV2, BoxSettingsRead, FleetSession, NodeWire } from '../../shared/api';
import { BOX_SETTING_SPECS, BROWSER_MCP_SERVERS_DEFAULT } from '../../shared/api';
import { ApiError, api } from '../src/lib/api';
import { useFleetStore } from '../src/stores/fleet';
import { BrowserToolsSection } from '../src/fleet/BrowserToolsSection';
import { BrowserSheet } from '../src/session/BrowserSheet';
import {
  BROWSER_SHEET_TEXT, BROWSER_TEXT, browserBoxOf, browserCountLine, browserFleetCount, browserLine, browserMcpView,
} from '../src/fleet/browserMcpWords';
import { PANE_SCOPE_STOP_ANCHOR } from '../src/fleet/paneScopeStopWords';
import { sessionMenu } from '../src/session/sessionMenu';
import { fleetSession } from './fleetFixture';
import { node } from './settingsViewFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useFleetStore.setState({ sessions: [] }));
});

const route = (fields: Record<string, string>, unreadable: string[] = []): FleetSession['route'] =>
  ({ fields, degraded: null, inert: [], unreadable } as unknown as FleetSession['route']);
const live = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({ presence: 'alive', ...over });

/** A fleet node whose box settings document names the two browser settings as given. */
const fleetNode = (rows: Partial<Record<'CCRC_BROWSER_MCP_DEFAULT' | 'CCRC_BROWSER_MCP_SERVERS', BoxSettingRowV2>> = {}): NodeWire => {
  const settings: BoxSettingRowV2[] = (Object.entries(BOX_SETTING_SPECS) as [BoxSettingName, { cls: string }][])
    .filter(([, t]) => t.cls !== 'omit')
    .map(([key, t]) => rows[key as keyof typeof rows]
      ?? (t.cls === 'is-set' ? { key, state: 'ok', from: 'default' } as const : { key, state: 'ok', value: key === 'CCRC_BROWSER_MCP_DEFAULT' ? 'off' : '1', from: 'default' } as const));
  const doc: BoxSettingsDocV2 = {
    v: 2, at: 1, reader: 'timer', settings, deadline: { plainMs: 1, minMs: 1, maxMs: 1 },
    backups: { state: 'ok', kept: 0, withData: 0, bytes: 0 }, disk: { state: 'ok', availBytes: 1, sizeBytes: 2 },
  };
  return { ...node(), settings: { state: 'ok', doc, ageS: 60, stale: false } as BoxSettingsRead };
};

describe('browserMcpView: what a session asked and what its run applied (D-8121)', () => {
  it('reads the route field, the record, and a change waiting for the next start', () => {
    expect(browserMcpView(live({ route: route({ browser: 'on' }), browserMcp: 'off' }))).toEqual({ asked: 'on', askedUnreadable: false, applied: 'off', queued: true });
    expect(browserMcpView(live({ route: route({ browser: 'off' }), browserMcp: 'off' }))).toMatchObject({ queued: false });
    expect(browserMcpView(live({ route: null, browserMcp: null }))).toEqual({ asked: null, askedUnreadable: false, applied: 'none', queued: false });
    expect(browserMcpView(live({ route: null }))).toMatchObject({ applied: 'unknown' });   // an older server: no key
    expect(browserMcpView(live({ route: route({ browser: 'maybe' }), browserMcp: 'on' }))).toMatchObject({ asked: null, queued: false });
    expect(browserMcpView(live({ route: route({}, ['browser']), browserMcp: 'on' }))).toMatchObject({ askedUnreadable: true, queued: false });
  });

  it('says it in one line', () => {
    expect(browserLine(browserMcpView(live({ route: route({ browser: 'on' }), browserMcp: 'off' }))))
      .toBe('Browser tools are off in this run. Asked: on, at its next restart.');
    expect(browserLine(browserMcpView(live({ route: null, browserMcp: 'off' })))).toBe('Browser tools are off in this run. It follows the box default.');
  });
});

describe('browserBoxOf and the count (D-8121)', () => {
  it('reads the fleet node\'s default and whether the list is its own', () => {
    expect(browserBoxOf([fleetNode()])).toEqual({ default: 'off', servers: 'default' });
    expect(browserBoxOf([fleetNode({
      CCRC_BROWSER_MCP_DEFAULT: { key: 'CCRC_BROWSER_MCP_DEFAULT', state: 'ok', value: 'on', from: 'file' },
      CCRC_BROWSER_MCP_SERVERS: { key: 'CCRC_BROWSER_MCP_SERVERS', state: 'ok', from: 'file' },
    })])).toEqual({ default: 'on', servers: 'custom' });
    expect(browserBoxOf([node()])).toEqual({ default: null, servers: null });   // a node that reports no settings
    expect(browserBoxOf([{ ...fleetNode(), role: 'server' }])).toEqual({ default: null, servers: null });
  });

  it('counts the running sessions that run the servers, the ones that predate the record and the ones waiting', () => {
    const c = browserFleetCount([
      live({ id: 'a', browserMcp: 'on' }), live({ id: 'b', browserMcp: 'off' }), live({ id: 'c', browserMcp: null }),
      live({ id: 'd', browserMcp: 'off', route: route({ browser: 'on' }) }),
      fleetSession({ id: 'e', presence: 'asleep', browserMcp: 'on' }),
    ]);
    expect(c).toEqual({ running: 4, using: 2, queued: 1, unrecorded: 1 });
    expect(browserCountLine(c)).toBe('2 of 4 running sessions use a browser. 1 started before ccrc managed browser tools. 1 will change at its next start.');
  });
});

describe('Settings › Automation › Browser tools (D-8121)', () => {
  it('shows the box default, the default server list and the count; Go to Stop leftovers brings that card into view', () => {
    act(() => useFleetStore.setState({ sessions: [live({ id: 'a', browserMcp: 'on' }), live({ id: 'b', browserMcp: 'off' })] }));
    const target = document.createElement('section');
    target.id = PANE_SCOPE_STOP_ANCHOR;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    render(<BrowserToolsSection nodes={[fleetNode()]} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Browser tools' })).toBeInTheDocument();
    expect(screen.getByText(BROWSER_TEXT.defaultOff)).toBeInTheDocument();
    for (const n of BROWSER_MCP_SERVERS_DEFAULT.split(',')) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 running sessions uses a browser.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: BROWSER_TEXT.stopLeftovers }));
    expect(scroll).toHaveBeenCalledTimes(1);
    target.remove();
  });

  it('a box that has not reported the setting says so; a custom list is named, not listed', () => {
    const bare = fleetNode({
      CCRC_BROWSER_MCP_DEFAULT: { key: 'CCRC_BROWSER_MCP_DEFAULT', state: 'unmeasured', why: 'x' },
      CCRC_BROWSER_MCP_SERVERS: { key: 'CCRC_BROWSER_MCP_SERVERS', state: 'ok', from: 'file' },
    });
    render(<BrowserToolsSection nodes={[bare]} />);
    expect(screen.getByText(BROWSER_TEXT.defaultUnknown)).toBeInTheDocument();
    expect(screen.getByText(BROWSER_TEXT.serversCustom)).toBeInTheDocument();
    expect(screen.queryByText('plugin:playwright:playwright')).toBeNull();
  });

  it('before the updates poll answers, the default is a skeleton', () => {
    const { container } = render(<BrowserToolsSection nodes={null} />);
    expect(container.querySelector('[data-browser-default]')?.querySelector('.skeleton, [aria-busy], [class*="skel"]')).not.toBeNull();
  });
});

describe('the session\'s Browser tools sheet (D-8121)', () => {
  it('the ⋯ menu offers it once the row is there', () => {
    expect(sessionMenu(live()).find((e) => e.id === 'session-browser')).toEqual({ id: 'session-browser', label: 'Browser tools', enabled: true });
    expect(sessionMenu(null).find((e) => e.id === 'session-browser')?.enabled).toBe(false);
  });

  it('marks what the session asked, says what its run has, and a tap writes the field', async () => {
    const write = vi.spyOn(api, 'route').mockResolvedValue({ ok: true } as never);
    const onClose = vi.fn();
    render(<BrowserSheet id="demo-a" session={live({ route: route({ browser: 'off' }), browserMcp: 'on' })} open onClose={onClose} />);
    expect(screen.getByText('Browser tools are on in this run. Asked: off, at its next restart.')).toBeInTheDocument();
    fireEvent.click(screen.getByText(BROWSER_SHEET_TEXT.label.on));
    await waitFor(() => expect(write).toHaveBeenCalledWith('demo-a', 'browser', 'on'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a box whose ccd does not take the field (501) leaves the sheet open', async () => {
    vi.spyOn(api, 'route').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    const onClose = vi.fn();
    render(<BrowserSheet id="demo-a" session={live()} open onClose={onClose} />);
    fireEvent.click(screen.getByText(BROWSER_SHEET_TEXT.label.off));
    await waitFor(() => expect(api.route).toHaveBeenCalledWith('demo-a', 'browser', 'off'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
