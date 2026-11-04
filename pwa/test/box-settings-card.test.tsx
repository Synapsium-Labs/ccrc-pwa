// The Box settings card under Settings › Updates (box settings view, spec 2026-10-25 §2.4, §2.5; D-6917): a read-only
// card over `NodeWire.settings`, rendered from the section's ONE `/api/updates` poll. Neutral fixtures: nodes labelled
// fleet and server, settings the seven the verb lists.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { BoxSettingRow, BoxSettingsDoc, BoxSettingsRead, NodeWire } from '../../shared/api';
import {
  BOX_SETTINGS_FAILURES, BOX_SETTINGS_KEYS, BOX_SETTINGS_STALE_S, BOX_SETTING_SOURCES, BOX_SETTING_STATES,
} from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { UPDATES_CARDS } from '../src/screens/settings/UpdatesSection';
import { BoxSettingsCard } from '../src/fleet/BoxSettingsCard';
import {
  BOX_SETTING_SOURCE_TEXT, BOX_SETTINGS_READ_TEXT, BOX_SETTINGS_SERVER_BUDGET_TEXT, boxSettingsOf,
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
const SERVER_ID = '1f0e0d0c-0b0a-4908-8706-050403020100';

const okRows = (): BoxSettingRow[] => [
  { key: 'CCRC_BACKUP_KEEP', state: 'ok', value: '5', from: 'default' },
  { key: 'CCRC_BACKUP_DATA_KEEP', state: 'ok', value: '2', from: 'file' },
  { key: 'CCRC_VERSIONS_KEEP', state: 'ok', value: '4', from: 'environment' },
  { key: 'CCRC_UPDATE_HEALTH_S', state: 'ok', value: '90', from: 'default' },
  { key: 'CCRC_UPDATE_DEADLINE_MS', state: 'ok', value: '600000', from: 'file' },
  { key: 'CCRC_RELEASE_BASE_URL', state: 'ok', value: 'default', from: 'default' },
  { key: 'CCRC_MODELS_ADVANCE_BUDGET_S', state: 'ok', value: '120', from: 'empty' },
];
const doc = (over: Partial<BoxSettingsDoc> = {}, ageMin = 2): BoxSettingsDoc => ({
  v: 1, at: Math.floor((NOW - ageMin * MIN) / 1000), reader: 'timer', settings: okRows(),
  deadline: { plainMs: 600000, minMs: 60000, maxMs: 3600000 },
  backups: { state: 'ok', kept: 5, withData: 4, bytes: 12_100_000_000 },
  disk: { state: 'ok', availBytes: 19_300_000_000, sizeBytes: 161_100_000_000 },
  ...over,
});
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
    expect(within(b).queryByText(BOX_SETTINGS_SERVER_BUDGET_TEXT)).toBeNull();
  });

  it("says a shell's read is a shell's", () => {
    renderCard([fleet(ok(doc({ reader: 'shell' })))]);
    expect(within(block('fleet')).getByText(/read by a shell's own run of ccrc settings/)).toBeInTheDocument();
  });

  it('one block per node, in the order given, each labelled with the node', () => {
    renderCard([fleet(ok()), server(ok())]);
    expect(screen.getAllByRole('group').map((g) => within(g).getByRole('heading', { level: 4 }).textContent))
      .toEqual(['fleet reported by the box', 'server reported by the box']);
  });

  it("notes that a setting is changed in the box's ccrc.env, and what the source column is for", () => {
    renderCard([fleet(ok())]);
    expect(screen.getByText(/changed in the box's ccrc\.env/)).toBeInTheDocument();
    expect(screen.getByText(/overrides the file/)).toBeInTheDocument();
  });
});

describe('Box settings card: refused, stale, server (D-6917)', () => {
  it('a refused setting shows its sentence in the danger tone; an unmeasured one says so, in the same tone', () => {
    const rows = okRows();
    // A wave-1 server may still send a refused row's value: a wire forgery here, which the card must not show.
    rows[0] = { key: 'CCRC_BACKUP_KEEP', state: 'refused', value: 'abc', from: 'environment', why: 'CCRC_BACKUP_KEEP must be a whole number' } as unknown as BoxSettingRow;
    rows[3] = { key: 'CCRC_UPDATE_HEALTH_S', state: 'unmeasured', why: 'ccrc.env could not be scanned' };
    renderCard([fleet(ok(doc({ settings: rows })))]);
    const refused = screen.getByText('CCRC_BACKUP_KEEP must be a whole number');
    expect(refused).toHaveClass('box-settings-danger');
    const unmeasured = screen.getByText('ccrc.env could not be scanned');
    expect(unmeasured).toHaveClass('box-settings-danger');
    // The raw knob is never shown beside the sentence (D-7912): a wave-1 server may still send it, and the card drops it.
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

  it('a server-role node reads the models budget as not used, whatever its row says', () => {
    renderCard([server(ok())]);
    const row = within(block('server')).getByText('CCRC_MODELS_ADVANCE_BUDGET_S').closest('div')!;
    expect(row).toHaveTextContent(BOX_SETTINGS_SERVER_BUDGET_TEXT);
    expect(row).not.toHaveTextContent('120');
    // Another setting on the same box is unchanged.
    expect(within(block('server')).getByText('CCRC_BACKUP_KEEP').closest('div')).toHaveTextContent('5');
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
