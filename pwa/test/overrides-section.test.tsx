// D-8382 (#1442): Settings › Automation › Overrides in force and Settings › Security › Approvals. Both read
// `GET /api/fleet/overrides` (spied as `api.fleetOverrides`) and render alone. The rows are the switchboard's: every line
// a card shows is read here from `SWITCHES` itself, and a census below pins that the two cards' sources name no override
// and keep no list of their own. The cards at every width are `browser/overrides-in-force.browser.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVALS_TOPOLOGY_TEXT, OVERRIDES_TEXT, type ApprovalsTopologyWire, type OverridesView } from '../../shared/overrides';
import {
  AUTOCOMPACT_DISABLED_MARKER, GRAPH_GATE_OFF_FILE, MAIL_DISABLED_MARKER, SWITCHES, overrideSwitchNames, switchPath,
  type OverrideSwitchName,
} from '../../shared/switches';
import { OverridesSection } from '../src/fleet/OverridesSection';
import { ApprovalsTopologyCard } from '../src/screens/settings/ApprovalsTopologyCard';
import { asOverridesView, overrideLines } from '../src/fleet/overridesWords';
import { ApiError, api } from '../src/lib/api';
import { clearScreenCache } from '../src/lib/screenCache';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { COLLECT_SECTION_TEXT } from '../src/fleet/collectLaneWords';

afterEach(() => {
  cleanup();
  clearScreenCache();
  vi.restoreAllMocks();
});

const ONE_BOX: ApprovalsTopologyWire = { boxes: 'one', marker: 'absent', file: 'approvals-single-box' };
const viewOf = (set: readonly OverrideSwitchName[], unmeasurable: readonly OverrideSwitchName[] = [],
  approvals: ApprovalsTopologyWire = ONE_BOX): OverridesView => ({
  overrides: overrideSwitchNames.map((name) => ({
    name, state: set.includes(name) ? 'set' : unmeasurable.includes(name) ? 'unmeasurable' : 'clear',
  })),
  approvals,
});
const card = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.automation.overrides.title });

describe('Settings › Automation › Overrides in force (D-8382)', () => {
  it('each override that stands is a row of its switchboard row: its name, what it does, its absence, how to lift it', async () => {
    const set = [MAIL_DISABLED_MARKER, AUTOCOMPACT_DISABLED_MARKER, GRAPH_GATE_OFF_FILE] as const;
    vi.spyOn(api, 'fleetOverrides').mockResolvedValue(viewOf(set));
    render(<OverridesSection />);
    await waitFor(() => expect(card().querySelectorAll('[data-override]')).toHaveLength(3));
    const rows = [...card().querySelectorAll('[data-override]')];
    // The answer's order, which is SWITCHES' order.
    expect(rows.map((r) => r.getAttribute('data-override'))).toEqual(overrideSwitchNames.filter((n) => (set as readonly string[]).includes(n)));
    for (const r of rows) {
      const name = r.getAttribute('data-override') as OverrideSwitchName;
      const row = SWITCHES[name];
      const ps = [...r.querySelectorAll('p')].map((p) => p.textContent);
      expect(ps).toEqual([
        name,
        row.meaning,
        `Without it: ${row.default.replace(/^absent: /, '')}.`,
        `To lift it, remove ${switchPath(name)} at a terminal on the fleet box.`,
      ]);
    }
    expect(within(card()).getByText(`To lift it, remove ~/.ccrc/${GRAPH_GATE_OFF_FILE} at a terminal on the fleet box.`)).toBeInTheDocument();
    expect(within(card()).getByText(`To lift it, remove ~/.cc-sessions/${AUTOCOMPACT_DISABLED_MARKER} at a terminal on the fleet box.`)).toBeInTheDocument();
    // Read only: no control of any kind.
    for (const role of ['button', 'switch', 'checkbox', 'radio', 'textbox']) expect(within(card()).queryAllByRole(role), role).toHaveLength(0);
  });

  it('none standing and every one read: the one quiet line', async () => {
    vi.spyOn(api, 'fleetOverrides').mockResolvedValue(viewOf([]));
    render(<OverridesSection />);
    expect(await within(card()).findByText(OVERRIDES_TEXT.none)).toBeInTheDocument();
  });

  it('an override that could not be read is counted amber, never shown as lifted, and the quiet line is not said', async () => {
    vi.spyOn(api, 'fleetOverrides').mockResolvedValue(viewOf([], ['graph-gate-off', 'ccrc-card-off']));
    render(<OverridesSection />);
    expect(await within(card()).findByText(OVERRIDES_TEXT.unmeasured.replace('{n}', '2'))).toBeInTheDocument();
    expect(within(card()).queryByText(OVERRIDES_TEXT.none)).not.toBeInTheDocument();
  });

  it('an older server (404 not-found) reads as not available; a failed read says so', async () => {
    vi.spyOn(api, 'fleetOverrides').mockRejectedValue(new ApiError(404, { error: 'not-found' }));
    render(<OverridesSection />);
    expect(await within(card()).findByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    expect(within(card()).queryByText(OVERRIDES_TEXT.unread)).not.toBeInTheDocument();
    cleanup();
    clearScreenCache();
    vi.spyOn(api, 'fleetOverrides').mockRejectedValue(new ApiError(500, { error: 'boom' }));
    render(<OverridesSection />);
    expect(await within(card()).findByText(OVERRIDES_TEXT.unread)).toBeInTheDocument();
  });

  it('the guard keeps a known row, leaves out a name this build has no row for, and refuses a malformed answer', () => {
    const raw = { overrides: [{ name: 'mail-disabled', state: 'set' }, { name: 'from-a-newer-server', state: 'set' }], approvals: ONE_BOX };
    expect(asOverridesView(raw)).toEqual({ overrides: [{ name: 'mail-disabled', state: 'set' }], approvals: ONE_BOX });
    expect(asOverridesView({ overrides: [{ name: 'mail-disabled', state: 'on' }], approvals: ONE_BOX })).toBeNull();
    expect(asOverridesView({ overrides: [], approvals: { boxes: 'three', marker: 'absent', file: 'x' } })).toBeNull();
    expect(asOverridesView({ approvals: ONE_BOX })).toBeNull();
  });

  it('every override has its lines from its row alone', () => {
    for (const name of overrideSwitchNames) {
      const l = overrideLines(name);
      expect(l.does).toBe(SWITCHES[name].meaning);
      expect(l.remedy).toContain(switchPath(name));
    }
  });
});

describe('Settings › Security › Approvals (D-8382)', () => {
  const region = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.security.approvals.title });
  for (const [boxes, marker] of [['one', 'absent'], ['one', 'present'], ['two', 'absent'], ['two', 'present']] as const) {
    it(`${boxes} box(es), the opt-in ${marker}: its one line, with the file's name from the wire`, async () => {
      const approvals: ApprovalsTopologyWire = { boxes, marker, file: 'approvals-single-box' };
      vi.spyOn(api, 'fleetOverrides').mockResolvedValue(viewOf([], [], approvals));
      render(<ApprovalsTopologyCard />);
      const line = APPROVALS_TOPOLOGY_TEXT[boxes][marker].replace('{file}', 'approvals-single-box');
      expect(await within(region()).findByText(line)).toBeInTheDocument();
      expect(within(region()).queryAllByRole('button')).toHaveLength(0);
    });
  }
});

// THE CENSUS: the panel's rows come from SWITCHES. The two cards and their pure half spell no override's name (each name
// is a switchboard constant, and a card that spelled one would be a second list), and the pure half derives its rows from
// `overrideSwitchNames` and `SWITCHES`. A planted name is seen.
describe('census: Overrides in force keeps no list of its own (D-8382)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SOURCES = ['src/fleet/OverridesSection.tsx', 'src/fleet/overridesWords.ts', 'src/fleet/useOverridesView.ts',
    'src/screens/settings/ApprovalsTopologyCard.tsx'];
  const text = (f: string): string => readFileSync(path.join(here, '..', f), 'utf8');
  const named = (src: string): string[] => overrideSwitchNames.filter((n) => new RegExp(`['"\`/]${n}['"\`]`).test(src));

  it('CONTROL: a quoted override name is seen', () => {
    expect(named(`const x = '${GRAPH_GATE_OFF_FILE}';`)).toEqual([GRAPH_GATE_OFF_FILE]);
  });

  it('no source of the cards quotes an override name, and the pure half reads SWITCHES and overrideSwitchNames', () => {
    for (const f of SOURCES) expect(named(text(f)), f).toEqual([]);
    const words = text('src/fleet/overridesWords.ts');
    expect(words).toMatch(/import \{[^}]*\bSWITCHES\b[^}]*\boverrideSwitchNames\b[^}]*\} from '..\/..\/..\/shared\/switches'/);
  });
});
