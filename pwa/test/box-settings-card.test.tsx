// The Box settings card under Settings › Updates (box settings view, spec 2026-10-25 §2.4, §2.5; D-6917): a read-only
// card over `NodeWire.settings`, rendered from the section's ONE `/api/updates` poll. Neutral fixtures: nodes labelled
// fleet and server, settings the seven the verb lists.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  BoxSettingName, BoxSettingRow, BoxSettingRowV1, BoxSettingRowV2, BoxSettingsDoc, BoxSettingsDocV1, BoxSettingsDocV2, BoxSettingsRead, NodeRole, NodeWire,
} from '../../shared/api';
import {
  BOX_SETTINGS_FAILURES, BOX_SETTINGS_KEYS, BOX_SETTINGS_STALE_S, BOX_SETTING_FAMILIES, BOX_SETTING_REFUSAL_WORDS, BOX_SETTING_SOURCES,
  BOX_SETTING_SPECS, BOX_SETTING_STATES,
} from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { UPDATES_CARDS } from '../src/screens/settings/UpdatesSection';
import { BoxSettingsCard } from '../src/fleet/BoxSettingsCard';
import {
  BOX_SETTING_SOURCE_TEXT, BOX_SETTINGS_NOT_USED_TEXT, BOX_SETTINGS_READ_TEXT, boxSettingsOf,
} from '../src/fleet/boxSettingsWords';
import { renderSettings } from './settingsHost';
import { node, updatesView } from './settingsViewFixture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  navigate('/');
});

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;
const OTHER_ID = '2a1e0d0c-0b0a-4908-8706-050403020101';
const SERVER_ID = '1f0e0d0c-0b0a-4908-8706-050403020100';

const okRows = (): BoxSettingRowV1[] => [
  { key: 'CCRC_BACKUP_KEEP', state: 'ok', value: '5', from: 'default' },
  { key: 'CCRC_BACKUP_DATA_KEEP', state: 'ok', value: '2', from: 'file' },
  { key: 'CCRC_VERSIONS_KEEP', state: 'ok', value: '4', from: 'environment' },
  { key: 'CCRC_UPDATE_HEALTH_S', state: 'ok', value: '90', from: 'default' },
  { key: 'CCRC_UPDATE_DEADLINE_MS', state: 'ok', value: '600000', from: 'file' },
  { key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'default', from: 'default' },
  { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'ok', value: '120', from: 'empty' },
];
const v2Rows = (): BoxSettingRowV2[] => Object.entries(BOX_SETTING_SPECS).filter(([, t]) => t.cls !== 'omit').map(([k, t]) => {
  const key = k as BoxSettingName;
  if (t.cls === 'value') return { key, state: 'ok', value: '1', from: 'default' } as const;
  if (t.cls === 'origin') return { key, state: 'ok', value: 'default', from: 'default' } as const;
  return { key, state: 'ok', from: 'default' } as const;
});
const doc = (over: Partial<BoxSettingsDocV1> = {}, ageMin = 2): BoxSettingsDocV1 => ({
  v: 1, at: Math.floor((NOW - ageMin * MIN) / 1000), reader: 'timer', settings: okRows(),
  deadline: { plainMs: 600000, minMs: 60000, maxMs: 3600000 },
  backups: { state: 'ok', kept: 5, withData: 4, bytes: 12_100_000_000 },
  disk: { state: 'ok', availBytes: 19_300_000_000, sizeBytes: 161_100_000_000 },
  ...over,
});
const v2doc = (over: Partial<BoxSettingsDocV2> = {}): BoxSettingsDocV2 => ({ ...doc(), v: 2, settings: v2Rows(), ...over });
const withRow = (key: BoxSettingName, row: BoxSettingRowV2): BoxSettingRowV2[] => v2Rows().map((r) => (r.key === key ? row : r));
const ok = (d: BoxSettingsDoc = doc(), ageMin = 2, stale = false): BoxSettingsRead =>
  ({ state: 'ok', doc: d, ageS: ageMin * 60, stale });
const fleet = (settings?: unknown, label = 'fleet'): NodeWire =>
  ({ ...node({ label }), ...(settings === undefined ? {} : { settings: settings as BoxSettingsRead }) });
const server = (settings?: unknown): NodeWire =>
  ({ ...node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null }),
    ...(settings === undefined ? {} : { settings: settings as BoxSettingsRead }) });

const renderCard = (nodes: NodeWire[]) => render(<BoxSettingsCard nodes={nodes} />);
const block = (label: string): HTMLElement => screen.getByRole('group', { name: new RegExp(`^${label}\\b`) });

describe('Box settings card: a full snapshot (D-6917)', () => {
  it('shows the seven rows with their values and source words, the backups, the disk, the age and the reader', () => {
    renderCard([fleet(ok())]);
    const b = block('fleet');
    expect(within(b).getByText('reported by the box')).toBeInTheDocument();
    for (const k of BOX_SETTINGS_KEYS) expect(within(b).getByText(k)).toBeInTheDocument();
    expect(within(b).getAllByRole('term')).toHaveLength(7);
    const row = (k: string): HTMLElement => within(b).getByText(k).closest('div')!;
    expect(row('CCRC_BACKUP_KEEP')).toHaveTextContent('5');
    expect(row('CCRC_BACKUP_KEEP')).toHaveTextContent(BOX_SETTING_SOURCE_TEXT.default);
    expect(row('CCRC_BACKUP_DATA_KEEP')).toHaveTextContent(BOX_SETTING_SOURCE_TEXT.file);
    expect(row('CCRC_VERSIONS_KEEP')).toHaveTextContent(BOX_SETTING_SOURCE_TEXT.environment);
    expect(row('CCRC_MODELS_ADVANCE_BUDGET_S')).toHaveTextContent(BOX_SETTING_SOURCE_TEXT.empty);
    expect(within(b).getByText('5 backups, 4 with data, 12.1 GB')).toBeInTheDocument();
    expect(within(b).getByText('19.3 GB free of 161.1 GB')).toBeInTheDocument();
    expect(within(b).getByText("measured 2m ago, read by the box's timer")).toBeInTheDocument();
    // No setting reads as unused or refused here.
    expect(within(b).queryByText(BOX_SETTINGS_NOT_USED_TEXT)).toBeNull();
  });

  it("says a shell's read is a shell's", () => {
    renderCard([fleet(ok(doc({ reader: 'shell' })))]);
    expect(within(block('fleet')).getByText(/read by a shell's own run of ccrc settings/)).toBeInTheDocument();
  });

  it('one block per node, in the order given, each labelled with the node', () => {
    const { container } = renderCard([fleet(ok()), server(ok())]);
    expect([...container.querySelectorAll('.box-settings-node')].map((g) => within(g as HTMLElement).getByRole('heading', { level: 4 }).textContent))
      .toEqual(['fleet reported by the box', 'server reported by the box']);
  });

  it("notes that a setting is changed in the box's ccrc.env, and what the source column is for", () => {
    renderCard([fleet(ok())]);
    expect(screen.getByText(/changed in the box's ccrc\.env/)).toBeInTheDocument();
    expect(screen.getByText(/override the file only for backups and updates/)).toBeInTheDocument();
    expect(screen.getByText(/this view reads ccrc\.env alone for every other setting/)).toBeInTheDocument();
  });

  it('the how line says what this view reads, and says what an update installs from its shell and what a ccrc test run reads (review 1487 F2, review 1496 F3)', () => {
    renderCard([fleet(ok())]);
    const how = screen.getByText(/changed in the box's ccrc\.env/).textContent!;
    expect(how).toContain('this view reads ccrc.env alone for every other setting.');
    expect(how).toContain('An update installs the session-slice limits and the graph-unit settings from its shell\'s environment when that shell sets one, and this view does not show it. A ccrc test run reads the test-pressure bound from its own shell.');
    // The old sentence made a claim about the box, which the installer does not keep.
    expect(how).not.toContain('is read from ccrc.env alone');
  });
});

describe('Box settings card: refused, stale, server (D-6917)', () => {
  it('a refused setting shows its sentence in the danger tone; an unmeasured one says so, in the same tone', () => {
    const rows = okRows();
    // A wave-1 server may still send a refused row's value: a wire forgery here, which the card must not show.
    rows[0] = { key: 'CCRC_BACKUP_KEEP', state: 'refused', value: 'abc', from: 'environment', why: 'CCRC_BACKUP_KEEP must be a whole number' } as unknown as BoxSettingRowV1;
    rows[3] = { key: 'CCRC_UPDATE_HEALTH_S', state: 'unmeasured', why: 'ccrc.env could not be scanned' };
    renderCard([fleet(ok(doc({ settings: rows })))]);
    const refused = screen.getByText('CCRC_BACKUP_KEEP must be a whole number');
    expect(refused).toHaveClass('box-settings-danger');
    const unmeasured = screen.getByText('ccrc.env could not be scanned');
    expect(unmeasured).toHaveClass('box-settings-danger');
    // A refused value is never shown (D-7911): a wave-1 server may still send it, and the reader drops it before the card sees it.
    expect(refused.closest('div')).not.toHaveTextContent('abc');
    // A fine row carries no danger.
    expect(screen.getByText('CCRC_VERSIONS_KEEP').closest('div')!.querySelector('.box-settings-danger')).toBeNull();
  });

  it('an unmeasured backups line and disk line say why, in the danger tone', () => {
    renderCard([fleet(ok(doc({
      backups: { state: 'unmeasured', why: 'the backups root is not a directory' },
      disk: { state: 'unmeasured', why: 'df did not answer' },
    })))]);
    expect(screen.getByText('Backups not measured: the backups root is not a directory')).toHaveClass('box-settings-danger');
    expect(screen.getByText('Disk not measured: df did not answer')).toHaveClass('box-settings-danger');
  });

  it('a stale snapshot shows its age in the warning tone, the limit derived from BOX_SETTINGS_STALE_S', () => {
    renderCard([fleet(ok(doc({}, 42), 42, true))]);
    const line = screen.getByText(/^measured 42m ago/);
    expect(line).toHaveClass('settings-catalogue--amber');
    expect(line).toHaveTextContent(`older than ${BOX_SETTINGS_STALE_S / 60}m`);
    // A fresh one is not warned.
    cleanup();
    renderCard([fleet(ok())]);
    expect(screen.getByText(/^measured 2m ago/)).not.toHaveClass('settings-catalogue--amber');
  });

  it("the age is the server's: a device clock 20 minutes ahead moves neither the text nor the tone (D-6917, A12)", () => {
    // The server measured the age at ITS clock (`ageS` 120, not stale). The device clock is 20 minutes ahead of it: the card
    // never reads the device clock, so the line says 2m and carries no warning.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 20 * MIN);
    renderCard([fleet(ok(doc({}, 2), 2, false))]);
    const line = screen.getByText(/^measured 2m ago/);
    expect(line).toHaveTextContent("measured 2m ago, read by the box's timer");
    expect(line).not.toHaveClass('settings-catalogue--amber');
    expect(screen.queryByText(/22m/)).toBeNull();
  });

  it('the age text follows ageS whatever the document\'s own `at` says', () => {
    // `at` is box-written and its clock is the box's; `ageS` is the server\'s measure at the request.
    renderCard([fleet({ ...ok(doc({}, 40), 2, false) })]);
    expect(screen.getByText(/^measured 2m ago/)).toBeInTheDocument();
  });
});

describe('Box settings card: every way a node can have nothing to show (D-6917)', () => {
  it('each failure word shows its own words, and no two are alike', () => {
    const seen = new Set<string>();
    for (const state of BOX_SETTINGS_FAILURES) {
      cleanup();
      renderCard([fleet({ state })]);
      const text = BOX_SETTINGS_READ_TEXT[state];
      expect(within(block('fleet')).getByText(text), state).toBeInTheDocument();
      seen.add(text);
    }
    expect(seen.size).toBe(BOX_SETTINGS_FAILURES.length);
  });

  it("an older server (no field), an older node (no cap) and a newer server's unknown word are three different words", () => {
    const words = [undefined, { state: 'not-supported' }, { state: 'quarantined' }].map((settings) => {
      cleanup();
      renderCard([fleet(settings)]);
      return within(block('fleet')).getByText(/\.$/).textContent;
    });
    expect(new Set(words).size).toBe(3);
    expect(words).toEqual([
      BOX_SETTINGS_READ_TEXT['not-reported'], BOX_SETTINGS_READ_TEXT['not-supported'], BOX_SETTINGS_READ_TEXT.unrecognised,
    ]);
  });

  it('not-reported, not-supported and caps-unmeasured all differ', () => {
    const texts = [BOX_SETTINGS_READ_TEXT['not-reported'], BOX_SETTINGS_READ_TEXT['not-supported'], BOX_SETTINGS_READ_TEXT['caps-unmeasured']];
    expect(new Set(texts).size).toBe(3);
  });

  it('a node the server has not read since it started says so, and that is not the word for a read that failed (D-7874)', () => {
    renderCard([fleet({ state: 'unmeasured' })]);
    expect(within(block('fleet')).getByText('Not read since the server started.')).toBeInTheDocument();
    expect(BOX_SETTINGS_READ_TEXT.unmeasured).not.toBe(BOX_SETTINGS_READ_TEXT.unreadable);
    expect(boxSettingsOf({ settings: { state: 'unmeasured' } })).toEqual({ state: 'unmeasured' });
  });

  it('an object where a string belongs reads unrecognised, and the other nodes still render', () => {
    const bad = ok();
    const rows = okRows() as unknown[];
    rows[2] = { key: 'CCRC_VERSIONS_KEEP', state: 'ok', value: { nested: 'x' }, from: 'file' };
    renderCard([fleet({ ...bad, doc: { ...bad.state === 'ok' ? bad.doc : {}, settings: rows } }, 'broken'), server(ok())]);
    expect(within(block('broken')).getByText(BOX_SETTINGS_READ_TEXT.unrecognised)).toBeInTheDocument();
    expect(within(block('server')).getByText('5 backups, 4 with data, 12.1 GB')).toBeInTheDocument();
  });

  it('a state word from a newer server reads unrecognised, in a row or on the read', () => {
    expect(boxSettingsOf({ settings: { state: 'ok', ageS: 1, stale: false, doc: { ...doc(), settings: [{ key: 'CCRC_X', state: 'probing', value: '1', from: 'file' }] } } })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: { state: 'ok', ageS: 1, stale: false, doc: { ...doc(), reader: 'cron' } } })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: { state: 'ok', ageS: 1, stale: false, doc: { ...doc(), settings: [{ key: 'K', state: 'ok', value: '1', from: 'magic' }] } } })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: { state: 'future-state' } })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: null })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: [] })).toBe('unrecognised');
    expect(boxSettingsOf({ settings: { state: 'ok', ageS: '3', stale: false, doc: doc() } })).toBe('unrecognised');
    expect(boxSettingsOf({})).toBe('not-reported');
    expect(boxSettingsOf({ settings: { state: 'absent' } })).toEqual({ state: 'absent' });
    // The shared vocabularies are what the reader checks against: every listed word is accepted.
    for (const state of BOX_SETTING_STATES) {
      const row = state === 'unmeasured'
        ? { key: 'K', state, why: 'w' } : { key: 'K', state, value: '1', from: BOX_SETTING_SOURCES[0], why: 'w' };
      expect(boxSettingsOf({ settings: { state: 'ok', ageS: 1, stale: false, doc: { ...doc(), settings: [row] } } })).not.toBe('unrecognised');
    }
  });
});

describe('Box settings card: one poll, no controls (D-6917)', () => {
  it('the card issues no /api/updates request of its own', () => {
    const updates = vi.spyOn(api, 'updates');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderCard([fleet(ok()), server({ state: 'absent' })]);
    expect(updates).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders no button and no input', () => {
    const { container } = renderCard([fleet(ok()), server({ state: 'malformed' }), fleet(undefined, 'older')]);
    expect(container.querySelectorAll('button, input, select, textarea, a[href]')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('Box settings card: under Settings › Updates (D-6917)', () => {
  it('is the fourth card, from the one list and one poll, with the card words of the table', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ nodes: [fleet(ok())] }));
    renderSettings('updates');
    await screen.findByRole('heading', { level: 3, name: 'Box settings' });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Fleet version', 'Nodes', 'Box settings', 'Update policy']);
    expect(titles).toEqual(UPDATES_CARDS.map((id) => SETTINGS_CARDS.updates[id].title));
    expect(SETTINGS_CARDS.updates.boxSettings.purpose).toMatch(/reported by the box/);
    const card = screen.getByRole('region', { name: 'Box settings' });
    expect(within(card).getByText('5 backups, 4 with data, 12.1 GB')).toBeInTheDocument();
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('a node with a bad field blanks only its own block; the rest of the page still renders', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ nodes: [fleet({ state: 'ok', doc: 'x' }, 'broken'), server(ok())] }));
    renderSettings('updates');
    const card = await screen.findByRole('region', { name: 'Box settings' });
    expect(within(card).getByText(BOX_SETTINGS_READ_TEXT.unrecognised)).toBeInTheDocument();
    expect(within(card).getByText('5 backups, 4 with data, 12.1 GB')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Channel' })).toBeInTheDocument();
  });

  it('a fleet with no node has no Box settings card, as it has no Nodes card', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ nodes: [] }));
    renderSettings('updates');
    await screen.findByRole('heading', { level: 3, name: 'Update policy' });
    expect(screen.queryByRole('heading', { level: 3, name: 'Box settings' })).toBeNull();
  });
});

describe('Box settings card: what the library calls a fold (characterization)', () => {
  it('C1: a details is a group and its summary is not a button', () => {
    render(<details><summary>s</summary><p>p</p></details>);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });

  it('C2: text inside a closed details is found by text, and the details is closed', () => {
    const { container } = render(<details><summary>s</summary><p>p</p></details>);
    expect(screen.getByText('p')).toBeInTheDocument();
    expect(container.querySelector('details')!.open).toBe(false);
  });

  it('C2b: role queries over closed content (measured: jsdom 30.1.3 with @testing-library/dom 10.4.1)', () => {
    render(<details><summary>s</summary><dl><dt>t</dt></dl></details>);
    // Measured 1: role queries see the content of a closed details, so a count over rows inside a fold needs no `hidden`.
    expect(screen.queryAllByRole('term')).toHaveLength(1);
  });
});

const familyOfKey = (k: string): string => BOX_SETTING_SPECS[k as BoxSettingName].family;
const familyKeys = (f: string): BoxSettingName[] =>
  (Object.keys(BOX_SETTING_SPECS) as BoxSettingName[]).filter((k) => familyOfKey(k) === f && BOX_SETTING_SPECS[k].cls !== 'omit');
const FAMILY_WORDS: Readonly<Record<string, string>> = {
  updates: 'Backups and updates', 'session-slice': 'Session slice', 'test-runs': 'Test runs', graph: 'Graph', testbox: 'Test box',
  keepalive: 'Keepalive', 'usage-sweep': 'Usage sweep', 'carry-copies': 'Carry copies', 'browser-tools': 'Browser tools',
  'memory-gate': 'Memory gate', 'limit-rescue': 'Limit rescue', coordination: 'Coordination',
};
const plural = (n: number): string => (n === 1 ? '1 setting' : `${n} settings`);
const summaries = (el: HTMLElement): string[] => [...el.querySelectorAll('.box-settings-family > summary')].map((x) => x.textContent ?? '');
const familyEl = (el: HTMLElement, f: string): HTMLDetailsElement => el.querySelector(`.box-settings-family[data-family="${f}"]`) as HTMLDetailsElement;
const rowOf = (el: HTMLElement, k: string): HTMLElement => within(el).getByText(k).closest('.box-settings-row') as HTMLElement;
const REFUSED_WHY = BOX_SETTING_REFUSAL_WORDS[0];

describe('Box settings card: what the library calls a fold (characterization, two nodes)', () => {
  it('C3: two fleet-role nodes with every family folded hold 2 + 2 x 12 groups (D-8121 added Browser tools, D-8122 Memory gate, D-8123 Limit rescue, D-8125 Coordination)', () => {
    renderCard([fleet(ok(v2doc())), { ...fleet(ok(v2doc()), 'second'), nodeId: OTHER_ID }]);
    expect(screen.getAllByRole('group')).toHaveLength(2 + 2 * 11);
  });
});

describe('Box settings card: families (D17)', () => {
  it('F1: families from the L0 table, in BOX_SETTING_FAMILIES order, all closed, 70 rows', () => {
    const { container } = renderCard([fleet(ok(v2doc()))]);
    const expected = [
      'Backups and updates: 7 settings, none set', 'Session slice: 2 settings, none set', 'Test runs: 8 settings, none set',
      'Graph: 23 settings, none set', 'Keepalive: 3 settings, none set', 'Usage sweep: 1 setting, none set',
      'Test box: 16 settings, none set', 'Carry copies: 1 setting, none set', 'Browser tools: 2 settings, none set',
      'Memory gate: 4 settings, none set', 'Limit rescue: 2 settings, none set', 'Coordination: 1 setting, none set',
    ];
    const derived = BOX_SETTING_FAMILIES.map((f) => `${FAMILY_WORDS[f]}: ${plural(familyKeys(f).length)}, none set`);
    expect(derived).toEqual(expected);
    expect(summaries(block('fleet'))).toEqual(expected);
    for (const d of container.querySelectorAll<HTMLDetailsElement>('details')) expect(d.open).toBe(false);
    expect(container.querySelectorAll('.box-settings-row')).toHaveLength(v2Rows().length);
    expect(v2Rows()).toHaveLength(70);
  });

  it('F2: a row sits in its table family', () => {
    const { container } = renderCard([fleet(ok(v2doc()))]);
    for (const row of container.querySelectorAll('.box-settings-row')) {
      const k = row.querySelector('dt')!.textContent!;
      expect(row.closest('.box-settings-family')!.getAttribute('data-family'), k).toBe(BOX_SETTING_SPECS[k as BoxSettingName].family);
    }
    const inFamily = (k: string, f: string): void => expect(rowOf(block('fleet'), k).closest('.box-settings-family')!.getAttribute('data-family')).toBe(f);
    for (const k of ['CCRC_TEST_HEAVY_SLOTS', 'CCRC_TEST_WIDE_FILES', 'CCRC_TEST_PRESSURE_MAX']) inFamily(k, 'test-runs');
    inFamily('CCRC_MODELS_ADVANCE_BUDGET_S', 'updates');
    inFamily('CCRC_CARRY_COPY_WARN_BYTES', 'carry-copies');
  });

  it('F3: the fold line counts file and environment apart', () => {
    const rows = v2Rows().map((r): BoxSettingRowV2 => {
      if (r.state !== 'ok') return r;
      if (r.key === 'CCRC_BACKUP_KEEP' || r.key === 'CCRC_VERSIONS_KEEP') return { ...r, from: 'file' };
      if (r.key === 'CCRC_UPDATE_HEALTH_S') return { ...r, from: 'environment' };
      if (r.key === 'CCRC_BACKUP_DATA_KEEP') return { ...r, from: 'empty' };
      if (r.key === 'CCRC_GRAPH_BUDGET' || r.key === 'CCRC_GRAPH_STORE') return { ...r, from: 'file' };
      return r;
    });
    const { container } = renderCard([fleet(ok(v2doc({ settings: rows })))]);
    const lines = summaries(block('fleet'));
    expect(lines[0]).toBe('Backups and updates: 7 settings, 2 set in ccrc.env, 1 set in the environment');
    expect(lines[3]).toBe('Graph: 23 settings, 2 set in ccrc.env');
    expect(familyEl(container, 'graph').open).toBe(false);
  });

  it('F4: a refused row opens its family and shows no value', () => {
    const row: BoxSettingRowV2 = { key: 'CCRC_GRAPH_BUDGET', state: 'refused', from: 'file', why: REFUSED_WHY };
    const { container } = renderCard([fleet(ok(v2doc({ settings: withRow('CCRC_GRAPH_BUDGET', row) })))]);
    expect(familyEl(container, 'graph').open).toBe(true);
    expect(summaries(block('fleet'))[3]).toBe('Graph: 23 settings, 1 refused');
    expect(screen.getByText(REFUSED_WHY)).toHaveClass('box-settings-danger');
    const value = rowOf(block('fleet'), 'CCRC_GRAPH_BUDGET').querySelector('dd.box-settings-value')!;
    expect(value).toHaveTextContent('refused');
    expect(value).toHaveTextContent('from ccrc.env');
    for (const f of BOX_SETTING_FAMILIES) if (f !== 'graph') expect(familyEl(container, f).open, f).toBe(false);
  });

  it('F5: an unmeasured row opens its family', () => {
    const why = 'the value could not be checked';
    const row: BoxSettingRowV2 = { key: 'CCRC_TESTBOX_POLL', state: 'unmeasured', why };
    const { container } = renderCard([fleet(ok(v2doc({ settings: withRow('CCRC_TESTBOX_POLL', row) })))]);
    expect(familyEl(container, 'testbox').open).toBe(true);
    expect(summaries(block('fleet'))[6]).toBe('Test box: 16 settings, 1 not measured');
    expect(screen.getByText(why)).toHaveClass('box-settings-danger');
  });

  it('F6: a refused row never shows a value, from either version', () => {
    const rows = okRows();
    rows[0] = { key: 'CCRC_BACKUP_KEEP', state: 'refused', value: 'abc', from: 'environment', why: 'w' } as unknown as BoxSettingRowV1;
    const read = { state: 'ok', ageS: 1, stale: false, doc: doc({ settings: rows }) };
    expect(boxSettingsOf({ settings: read })).not.toBe('unrecognised');
    renderCard([fleet(read)]);
    // A refused value is never shown (D-7911), whichever version carried it.
    expect(block('fleet').textContent).not.toContain('abc');
    const bare = okRows();
    bare[0] = { key: 'CCRC_BACKUP_KEEP', state: 'refused', from: 'environment', why: 'w' };
    expect(boxSettingsOf({ settings: { ...read, doc: doc({ settings: bare }) } })).not.toBe('unrecognised');
    // Version 2: the server never forwards a refused row's value, so one on the wire is a forgery the reader drops.
    const forged = { key: 'CCRC_GRAPH_BUDGET', state: 'refused', from: 'file', why: REFUSED_WHY, value: 'zz-wire' } as unknown as BoxSettingRow;
    const v2read = { state: 'ok', ageS: 1, stale: false, doc: v2doc({ settings: withRow('CCRC_GRAPH_BUDGET', forged as BoxSettingRowV2) }) };
    expect(boxSettingsOf({ settings: v2read })).not.toBe('unrecognised');
    cleanup();
    renderCard([fleet(v2read)]);
    expect(rowOf(block('fleet'), 'CCRC_GRAPH_BUDGET').querySelector('dd.box-settings-value')!.textContent).toContain('refused');
    expect(block('fleet').textContent).not.toContain('zz-wire');
  });

  it('F7: the is-set words (the spec\'s presence, D12), and a value on an is-set row on the wire is never shown', () => {
    const words: Array<[BoxSettingRowV2['key'], 'file' | 'empty' | 'default' | 'environment', string]> = [
      ['CCRC_GRAPH_STORE', 'file', 'set in ccrc.env'],
      ['CCRC_GRAPH_STORE', 'empty', 'set to empty, from ccrc.env; the default applies'],
      ['CCRC_GRAPH_STORE', 'default', 'not set'],
      ['CCRC_GRAPH_STORE', 'environment', 'set in the environment'],
    ];
    for (const [key, from, text] of words) {
      cleanup();
      renderCard([fleet(ok(v2doc({ settings: withRow(key, { key, state: 'ok', from }) })))]);
      expect(rowOf(block('fleet'), key).querySelector('dd.box-settings-value')!.textContent, from).toBe(text);
    }
    cleanup();
    const forged = { key: 'CCRC_GRAPH_STORE', state: 'ok', value: '/x/secret-path', from: 'file' } as unknown as BoxSettingRowV2;
    const { container } = renderCard([fleet(ok(v2doc({ settings: withRow('CCRC_GRAPH_STORE', forged) })))]);
    expect(container.textContent).not.toContain('secret-path');
  });

  it('F8: the next-update mark comes from the table', () => {
    const { container } = renderCard([fleet(ok(v2doc()))]);
    const mark = 'takes effect at the next update';
    for (const k of ['CCRC_GRAPH_BUDGET', 'CCRC_GRAPH_REFRESH_SECS', 'CCRC_SESSION_SLICE_MEMORY_MAX']) expect(rowOf(block('fleet'), k), k).toHaveTextContent(mark);
    expect(rowOf(block('fleet'), 'CCRC_GRAPH_FETCH_SECS')).not.toHaveTextContent(mark);
    const marked = [...container.querySelectorAll('.box-settings-row')].filter((r) => r.textContent!.includes(mark)).length;
    expect(marked).toBe(Object.values(BOX_SETTING_SPECS).filter((t) => t.applies === 'update').length);
    expect(marked).toBe(6);
  });
});

describe('Box settings card: a server-role node (D21)', () => {
  const unusedFamilies = BOX_SETTING_FAMILIES.filter((f) => !Object.values(BOX_SETTING_SPECS).some((t) => t.family === f && t.roles.includes('server')));

  it('S1: one line per fleet-only family, and the models budget reads not used', () => {
    const settings = withRow('CCRC_MODELS_ADVANCE_BUDGET_S', { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'ok', value: '120', from: 'file' });
    const { container } = renderCard([server(ok(v2doc({ settings })))]);
    const b = block('server');
    const lines = [...b.querySelectorAll('p.box-settings-line')].map((p) => p.textContent);
    expect(unusedFamilies).toHaveLength(9);
    for (const f of unusedFamilies) {
      expect(lines, f).toContain(`${FAMILY_WORDS[f]}: ${plural(familyKeys(f).length)}, ${BOX_SETTINGS_NOT_USED_TEXT}`);
      expect(familyEl(container, f), f).toBeNull();
      for (const k of familyKeys(f)) expect(within(b).queryByText(k), k).toBeNull();
    }
    expect(lines).toContain('Session slice: 2 settings, not used on this role');
    expect(lines).toContain('Carry copies: 1 setting, not used on this role');
    expect(familyEl(container, 'updates')).not.toBeNull();
    const budget = rowOf(b, 'CCRC_MODELS_ADVANCE_BUDGET_S');
    expect(budget.querySelector('dd.box-settings-value')!.textContent).toBe(BOX_SETTINGS_NOT_USED_TEXT);
    expect(budget).not.toHaveTextContent('120');
    expect(rowOf(b, 'CCRC_BACKUP_KEEP').querySelector('dd.box-settings-value span')!.textContent).toBe('1');
  });

  it('S2: the role column decides; a key never does, and the words file names no setting', () => {
    for (const role of ['fleet', 'both', null] as Array<NodeRole | null>) {
      cleanup();
      const { container } = renderCard([{ ...fleet(ok(v2doc())), role }]);
      expect(container.querySelectorAll('.box-settings-family'), String(role)).toHaveLength(11);
      // D-8122: CCRC_WAKE_HEADROOM_MIN_GIB is the one shown key a fleet node does not read (the server's wake gate does),
      // so on a fleet-only node its row, and only its row, says so; the role column decides that, never the key.
      const notUsed = [...container.querySelectorAll('.box-settings-row')]
        .filter((r) => r.querySelector('dd.box-settings-value')?.textContent === BOX_SETTINGS_NOT_USED_TEXT)
        .map((r) => (Object.keys(BOX_SETTING_SPECS) as BoxSettingName[]).find((k) => r.textContent?.includes(k)));
      const want = role === 'fleet'
        ? (Object.keys(BOX_SETTING_SPECS) as BoxSettingName[]).filter((k) => BOX_SETTING_SPECS[k].cls !== 'omit' && !BOX_SETTING_SPECS[k].roles.includes('fleet'))
        : [];
      expect(notUsed, String(role)).toEqual(want);
    }
    cleanup();
    renderCard([server(ok(v2doc()))]);
    for (const k of Object.keys(BOX_SETTING_SPECS) as BoxSettingName[]) {
      const t = BOX_SETTING_SPECS[k];
      if (t.cls === 'omit' || t.roles.includes('server')) continue;
      if (unusedFamilies.includes(t.family)) continue;
      expect(rowOf(block('server'), k).querySelector('dd.box-settings-value')!.textContent, k).toBe(BOX_SETTINGS_NOT_USED_TEXT);
    }
    const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'boxSettingsWords.ts'), 'utf8');
    expect(source).not.toMatch(/CCRC_[A-Z]/);
  });

  it('S4: a not-used row inside a used family keeps its why when refused or unmeasured, and never shows a value', () => {
    const key = 'CCRC_MODELS_ADVANCE_BUDGET_S';
    const refused: BoxSettingRowV2 = { key, state: 'refused', from: 'file', why: REFUSED_WHY };
    const first = renderCard([server(ok(v2doc({ settings: withRow(key, refused) })))]);
    expect(familyEl(first.container, 'updates').open).toBe(true);
    expect(summaries(block('server'))[0]).toBe('Backups and updates: 7 settings, 1 refused');
    const row = rowOf(block('server'), key);
    expect(row.querySelector('dd.box-settings-value')!.textContent).toBe(BOX_SETTINGS_NOT_USED_TEXT);
    expect(within(row).getByText(REFUSED_WHY)).toHaveClass('box-settings-danger');
    cleanup();
    const why = 'the value could not be checked';
    const second = renderCard([server(ok(v2doc({ settings: withRow(key, { key, state: 'unmeasured', why }) })))]);
    expect(familyEl(second.container, 'updates').open).toBe(true);
    expect(summaries(block('server'))[0]).toBe('Backups and updates: 7 settings, 1 not measured');
    const unmeasured = rowOf(block('server'), key);
    expect(unmeasured.querySelector('dd.box-settings-value')!.textContent).toBe(BOX_SETTINGS_NOT_USED_TEXT);
    expect(within(unmeasured).getByText(why)).toHaveClass('box-settings-danger');
    cleanup();
    const okRow: BoxSettingRowV2 = { key, state: 'ok', value: '120', from: 'file' };
    renderCard([server(ok(v2doc({ settings: withRow(key, okRow) })))]);
    const fine = rowOf(block('server'), key);
    expect(fine.querySelector('.box-settings-why')).toBeNull();
    expect(fine.textContent).not.toContain('120');
  });

  it("S3: an unused family's line counts attention (D-7916)", () => {
    const settings = v2Rows().map((r): BoxSettingRowV2 => {
      if (r.key === 'CCRC_GRAPH_BUDGET') return { key: r.key, state: 'refused', from: 'file', why: REFUSED_WHY };
      if (r.key === 'CCRC_TESTBOX_POLL') return { key: r.key, state: 'unmeasured', why: 'w' };
      return r;
    });
    const { container } = renderCard([server(ok(v2doc({ settings })))]);
    const lines = [...block('server').querySelectorAll('p.box-settings-line')].map((p) => p.textContent);
    expect(lines).toContain('Graph: 23 settings, not used on this role, 1 refused');
    expect(lines).toContain('Test box: 16 settings, not used on this role, 1 not measured');
    expect(familyEl(container, 'graph')).toBeNull();
    expect(familyEl(container, 'testbox')).toBeNull();
  });
});

describe('Box settings card: version 2 on the console (5.3, 5.4)', () => {
  it('R1: the reader takes v1 and v2 and nothing else', () => {
    const read = (d: unknown) => boxSettingsOf({ settings: { state: 'ok', ageS: 1, stale: false, doc: d } });
    expect(read(v2doc())).not.toBe('unrecognised');
    expect(read({ ...v2doc(), v: 3 })).toBe('unrecognised');
    const noValue = v2Rows().map((r) => (r.key === 'CCRC_BACKUP_KEEP' ? { key: r.key, state: 'ok', from: 'default' } : r));
    expect(read({ ...v2doc(), settings: noValue })).toBe('unrecognised');
    const obj = v2Rows().map((r) => (r.key === 'CCRC_BACKUP_KEEP' ? { key: r.key, state: 'ok', value: { x: 1 }, from: 'default' } : r));
    expect(read({ ...v2doc(), settings: obj })).toBe('unrecognised');
  });

  it('R2: an unknown key lands in a trailing open Other settings group, with its source word and never a value (D-7915)', () => {
    const extra = { key: 'CCRC_ZZ_NEW', state: 'ok', value: '7', from: 'file' } as unknown as BoxSettingRowV2;
    const { container } = renderCard([fleet(ok(v2doc({ settings: [...v2Rows(), extra] })))]);
    const groups = [...container.querySelectorAll<HTMLDetailsElement>('.box-settings-family')];
    const last = groups[groups.length - 1]!;
    expect(last.getAttribute('data-family')).toBe('other');
    expect(last.open).toBe(true);
    expect(last.querySelector('summary')!.textContent).toBe('Other settings: 1 setting this console does not know');
    const row = rowOf(block('fleet'), 'CCRC_ZZ_NEW');
    expect(row).toHaveTextContent(BOX_SETTING_SOURCE_TEXT.file);
    expect(row.textContent).not.toContain('7');
    expect(summaries(block('fleet'))).toHaveLength(12);
  });

  it('A1: the card holds no act, with summaries present', () => {
    const { container } = renderCard([fleet(ok(v2doc())), server(ok(v2doc())), server({ state: 'malformed' })]);
    expect(container.querySelectorAll('summary').length).toBeGreaterThanOrEqual(9);
    expect(container.querySelectorAll('button, input, select, textarea, a[href]')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const allowed = new Set(['DIV', 'H4', 'SPAN', 'P', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY']);
    for (const el of container.querySelectorAll('*')) expect(allowed.has(el.tagName), el.tagName).toBe(true);
    for (const sm of container.querySelectorAll('summary')) {
      expect(sm.parentElement!.tagName).toBe('DETAILS');
      expect(sm.parentElement!.firstElementChild).toBe(sm);
      for (const c of sm.children) expect(c.tagName).toBe('SPAN');
    }
  });
});

describe('Box settings card: a family the box reported no row for (final review)', () => {
  it('E1: a version-1 fleet node renders only the updates fold, and claims nothing of a family it never reported', () => {
    const { container } = renderCard([fleet(ok(doc()))]);
    const folds = container.querySelectorAll('.box-settings-family');
    expect(folds).toHaveLength(1);
    expect(folds[0]!.getAttribute('data-family')).toBe('updates');
    expect(summaries(container)).toEqual(['Backups and updates: 7 settings, 2 set in ccrc.env, 1 set in the environment']);
    expect(container.textContent).not.toContain('0 settings');
  });

  it('E2: a version-1 server-role node renders no line for a fleet-only family', () => {
    const { container } = renderCard([server(ok(doc()))]);
    const b = block('server');
    const lines = [...b.querySelectorAll('p.box-settings-line')].map((p) => p.textContent ?? '');
    expect(lines.filter((t) => t.includes('not used on this role'))).toEqual([]);
    expect(container.textContent).not.toContain('0 settings');
  });
});
