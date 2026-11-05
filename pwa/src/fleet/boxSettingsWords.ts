// The Box settings card's words and its one reader (box settings view, spec 2026-10-25 §2.4, §2.5; D-6917). Pure,
// no React, no fetch: L1.
//   * `boxSettingsOf` is the field's ONE reader on the console. `NodeWire.settings` is additive and optional, and it
//     is box-written text the server only partly vouches for, so the card reads it through this guard and nowhere else.
//     A missing field, a state word this build does not list and a wrong shape are three different answers, and none
//     of them throws: a bad node blanks only its own block.
//   * Every text table is a `Record` over the whole vocabulary it words (`shared/api.ts` owns each one), never a switch,
//     so a word the server learns is a compile error here until it has words.
//   * The age is the shared elapsed-time spelling (`@ccrc/ui`'s `elapsedWords`) and a byte count the fleet's one
//     size spelling (`lib/format.ts`'s `humanBytes`); neither is written a second time.
import type {
  BoxSettingFamily, BoxSettingName, BoxSettingRow, BoxSettingSource, BoxSettingsBackups, BoxSettingsDisk, BoxSettingsDoc,
  BoxSettingsFailure, BoxSettingsReader, BoxSettingsRead, NodeRole,
} from '../../../shared/api';
import {
  BOX_SETTING_FAMILIES, BOX_SETTING_SOURCES, BOX_SETTING_SPECS, BOX_SETTING_STATES, BOX_SETTINGS_FAILURES, BOX_SETTINGS_READERS,
  BOX_SETTINGS_STALE_S,
} from '../../../shared/api';
import { elapsedWords } from '@ccrc/ui';
import { humanBytes } from '../lib/format';
import { isCount, isNum, isOneOf, isRecord } from '../lib/wire';

/** What the field's reader answers: the read itself, or one of the two words for a field that is not a read. */
export type BoxSettingsField = BoxSettingsRead | 'not-reported' | 'unrecognised';

/** The words for every way a node's settings are not shown (spec §2.4's table), by the shared failure words plus the
 *  two the console adds: the field is missing (an older server) and the field is a form this build does not read. */
export const BOX_SETTINGS_READ_TEXT: Readonly<Record<BoxSettingsFailure | 'not-reported' | 'unrecognised', string>> = {
  'not-supported': "This box's build does not report its settings.",
  'caps-unmeasured': "This box's capabilities could not be read, so its settings were not read.",
  absent: 'Not measured on this box yet.',
  unmeasured: 'Not read since the server started.',
  unreadable: 'Could not be read (unreadable).',
  'too-large': 'Could not be read (too-large).',
  malformed: 'Could not be read (malformed).',
  'clock-ahead': "This box's clock is ahead; its settings are not shown.",
  'not-reported': 'This server does not report box settings.',
  unrecognised: "This box's settings came in a form this console does not read.",
};

/** Where a value came from, in the words an operator reads: `empty` is a line in `ccrc.env` that names the key and
 *  leaves it blank, which the act reads as the default. */
export const BOX_SETTING_SOURCE_TEXT: Readonly<Record<BoxSettingSource, string>> = {
  environment: 'from the environment',
  file: 'from ccrc.env',
  empty: 'ccrc.env names it with no value, so the default',
  default: 'the default',
};

/** Which environment the verb read. A shell's can differ from the timer's, which is why the card says which. */
export const BOX_SETTINGS_READER_TEXT: Readonly<Record<BoxSettingsReader, string>> = {
  timer: "read by the box's timer",
  shell: "read by a shell's own run of ccrc settings, whose environment can differ from the timer's",
};

/** What a setting reads where the role column of the L0 table says no act of that role reads it (D-7917): one wording for every
 *  such setting, derived from the table's roles, never from a key. */
export const BOX_SETTINGS_NOT_USED_TEXT = 'not used on this role';

/** The card's family names (D17). `other` is the trailing group for a key this console's table does not list. */
export const BOX_SETTING_FAMILY_TEXT: Readonly<Record<BoxSettingFamily | 'other', string>> = {
  updates: 'Backups and updates',
  'session-slice': 'Session slice',
  'test-runs': 'Test runs',
  graph: 'Graph',
  testbox: 'Test box',
  keepalive: 'Keepalive',
  'usage-sweep': 'Usage sweep',
  'carry-copies': 'Carry copies',
  other: 'Other settings',
};

/** What an is-set-class row (the spec's `presence`, D12) says in place of a value, which is never sent or shown (D12): only whether one is set. */
export const BOX_SETTING_PRESENCE_TEXT: Readonly<Record<BoxSettingSource, string>> = {
  file: 'set in ccrc.env',
  empty: 'set to empty, from ccrc.env; the default applies',
  default: 'not set',
  environment: 'set in the environment',
};

export const BOX_SETTINGS_TEXT = {
  /** The card's block label beside each node's own: the values are the box's, never the server's. */
  reportedBy: 'reported by the box',
  notMeasured: 'not measured',
  /** What a refused row shows where its value was: a refused value is never kept or shown (D-7911). */
  refused: 'refused',
  /** Under the card (spec §2.5): where a setting is changed, and what the source column is for. */
  how: "A setting is changed in the box's ccrc.env, never here. The environment can override the file only for backups and updates, and the source says when it does; this view reads ccrc.env alone for every other setting. A shell that sets one of the two session-slice limits, a graph-unit setting or the test-pressure bound when it runs an update gets that value used instead of the file's, and this view does not show it.",
  /** The mark on a setting the installer renders: a changed value waits for the next update (the table's `applies`). */
  nextUpdate: 'takes effect at the next update',
} as const;

/** A document string is rendered as text, so it must be one. */
const isStr = (v: unknown): v is string => typeof v === 'string';

function readRow(v: unknown): BoxSettingRow | null {
  if (!isRecord(v) || !isStr(v.key) || !isOneOf(BOX_SETTING_STATES, v.state)) return null;
  // The key is box-written: it is shown as the text it is, and a key this table does not list is grouped as `other`.
  const key = v.key as BoxSettingName;
  if (v.state === 'unmeasured') return isStr(v.why) ? { key, state: 'unmeasured', why: v.why } : null;
  if (!isOneOf(BOX_SETTING_SOURCES, v.from)) return null;
  // A refused row's value is never read, even when a wave-1 server still sends one (D-7911).
  if (v.state === 'refused') return isStr(v.why) ? { key, state: 'refused', from: v.from, why: v.why } as BoxSettingRow : null;
  if (v.value !== undefined) return isStr(v.value) ? { key, state: 'ok', value: v.value, from: v.from } : null;
  // No `value`: only an is-set-class key (or a key this table does not know, which shows no value) may be an ok row without one.
  const spec: { cls: string } | undefined = (BOX_SETTING_SPECS as Readonly<Record<string, { cls: string } | undefined>>)[key];
  return spec !== undefined && (spec.cls === 'value' || spec.cls === 'origin') ? null : { key, state: 'ok', from: v.from };
}

function readBackups(v: unknown): BoxSettingsBackups | null {
  if (!isRecord(v)) return null;
  if (v.state === 'unmeasured') return isStr(v.why) ? { state: 'unmeasured', why: v.why } : null;
  if (v.state !== 'ok' || !isCount(v.kept) || !isCount(v.withData) || !isCount(v.bytes)) return null;
  return { state: 'ok', kept: v.kept, withData: v.withData, bytes: v.bytes };
}

function readDisk(v: unknown): BoxSettingsDisk | null {
  if (!isRecord(v)) return null;
  if (v.state === 'unmeasured') return isStr(v.why) ? { state: 'unmeasured', why: v.why } : null;
  if (v.state !== 'ok' || !isCount(v.availBytes) || !isCount(v.sizeBytes)) return null;
  return { state: 'ok', availBytes: v.availBytes, sizeBytes: v.sizeBytes };
}

function readDoc(v: unknown): BoxSettingsDoc | null {
  if (!isRecord(v) || (v.v !== 1 && v.v !== 2) || !isNum(v.at) || !isOneOf(BOX_SETTINGS_READERS, v.reader)) return null;
  if (!Array.isArray(v.settings) || !isRecord(v.deadline)) return null;
  const { plainMs, minMs, maxMs } = v.deadline;
  if (!isNum(plainMs) || !isNum(minMs) || !isNum(maxMs)) return null;
  const settings: BoxSettingRow[] = [];
  for (const r of v.settings) {
    const row = readRow(r);
    if (row === null) return null;
    settings.push(row);
  }
  const backups = readBackups(v.backups);
  const disk = readDisk(v.disk);
  if (backups === null || disk === null) return null;
  return { v: v.v, at: v.at, reader: v.reader, settings, deadline: { plainMs, minMs, maxMs }, backups, disk } as BoxSettingsDoc;
}

/** The field's one reader. `'not-reported'`: no field (an older server, or one with no watcher). `'unrecognised'`: a
 *  non-object, a `state` this build does not list, or an `ok` whose document has a string where a number belongs (or the
 *  reverse). The shape is checked with `lib/wire.ts`'s guards only. */
export function boxSettingsOf(node: { settings?: unknown }): BoxSettingsField {
  const s = node.settings;
  if (s === undefined) return 'not-reported';
  if (!isRecord(s)) return 'unrecognised';
  if (isOneOf(BOX_SETTINGS_FAILURES, s.state)) return { state: s.state };
  if (s.state !== 'ok' || !isNum(s.ageS) || typeof s.stale !== 'boolean') return 'unrecognised';
  const doc = readDoc(s.doc);
  return doc === null ? 'unrecognised' : { state: 'ok', doc, ageS: s.ageS, stale: s.stale };
}

/** How one setting reads: its value and where it came from, or why it could not be measured. A setting whose role column lacks the
 *  node's role is not used there, whatever its row says (D-7917). */
export interface BoxSettingLine {
  key: string;
  /** What is shown for the value. */
  value: string;
  /** The source word, or null where there is none to say (unmeasured, is-set, or not used on this role). */
  from: string | null;
  /** The sentence for a refused or unmeasured row, shown in the danger tone; null for a row that is fine. */
  why: string | null;
  /** The note on a setting that takes effect at the next update, from the table's `applies`; null otherwise. */
  mark: string | null;
}

const specOf = (key: string): { cls: string; roles: readonly NodeRole[]; applies: string; family: BoxSettingFamily } | undefined =>
  (BOX_SETTING_SPECS as Readonly<Record<string, { cls: string; roles: readonly NodeRole[]; applies: string; family: BoxSettingFamily } | undefined>>)[key];

export function settingLine(row: BoxSettingRow, role: NodeRole | null): BoxSettingLine {
  const spec = specOf(row.key);
  if (role !== null && spec !== undefined && !spec.roles.includes(role)) {
    // The value slot stays "not used" and never shows a value, but a refused or unmeasured row still says why, as a used row does: a
    // refused why is a closed-set word and an unmeasured why is bounded text, so nothing leaks (the family line counts such a row).
    return { key: row.key, value: BOX_SETTINGS_NOT_USED_TEXT, from: null, why: row.state === 'ok' ? null : row.why, mark: null };
  }
  const mark = spec !== undefined && spec.applies === 'update' ? BOX_SETTINGS_TEXT.nextUpdate : null;
  if (row.state === 'unmeasured') return { key: row.key, value: BOX_SETTINGS_TEXT.notMeasured, from: null, why: row.why, mark };
  if (row.state === 'refused') {
    return { key: row.key, value: BOX_SETTINGS_TEXT.refused, from: BOX_SETTING_SOURCE_TEXT[row.from], why: row.why, mark };
  }
  // An unknown key shows only its source word, never a value (D-7915): this console cannot tell whether it is safe to show.
  if (spec === undefined) return { key: row.key, value: BOX_SETTING_SOURCE_TEXT[row.from], from: null, why: null, mark: null };
  // An is-set-class row says only whether a value is set; a `value` a forged or newer server adds to one is never shown.
  if (spec.cls === 'is-set' || !('value' in row)) return { key: row.key, value: BOX_SETTING_PRESENCE_TEXT[row.from], from: null, why: null, mark };
  return { key: row.key, value: row.value, from: BOX_SETTING_SOURCE_TEXT[row.from], why: null, mark };
}

/** One family of a node's rows, with the counts its fold line states (D17). */
export interface FamilyGroup {
  family: BoxSettingFamily | 'other';
  rows: BoxSettingRow[];
  refused: number;
  unmeasured: number;
  inFile: number;
  inEnv: number;
  /** False where the node's role reads no setting of the family (D21): the card then shows one line and no rows. */
  used: boolean;
}

/** The node's rows grouped by their table family, in `BOX_SETTING_FAMILIES` order, then `other` only when a key outside the table is
 *  present. This wave's server never sends such a key (it refuses any key outside the 61); the group exists so a newer server's added
 *  setting never blanks an older console's node (D-7915). A family with no row is left out, for either version. A family is `used` unless the role is `server` and no key of it lists
 *  `server` in its role column; a role of null counts as used. */
export function familyGroups(rows: readonly BoxSettingRow[], role: NodeRole | null): FamilyGroup[] {
  const families: Array<BoxSettingFamily | 'other'> = [...BOX_SETTING_FAMILIES];
  const familyOf = (r: BoxSettingRow): BoxSettingFamily | 'other' => specOf(r.key)?.family ?? 'other';
  if (rows.some((r) => familyOf(r) === 'other')) families.push('other');
  return families.flatMap((family) => {
    const mine = rows.filter((r) => familyOf(r) === family);
    // A family with no row is one the box made no claim about (a version-1 document carries the updates rows only).
    if (mine.length === 0) return [];
    const used = role !== 'server' || family === 'other' || Object.values(BOX_SETTING_SPECS).some((t) => t.family === family && t.roles.includes('server'));
    return [{
      family, rows: mine, used,
      refused: mine.filter((r) => r.state === 'refused').length,
      unmeasured: mine.filter((r) => r.state === 'unmeasured').length,
      inFile: mine.filter((r) => r.state === 'ok' && r.from === 'file').length,
      inEnv: mine.filter((r) => r.state === 'ok' && r.from === 'environment').length,
    }];
  });
}

const settingsCount = (n: number, tail: string): string => `${n} ${n === 1 ? 'setting' : 'settings'}${tail}`;

/** A family's fold line (review F14): its name, its size, then what to look at: attention counts first, and for a used family with
 *  none, the set counts. An unused family says so and keeps its attention counts (D-7916). */
export function familyLine(g: FamilyGroup): string {
  const attention = [
    ...(g.refused > 0 ? [`${g.refused} refused`] : []),
    ...(g.unmeasured > 0 ? [`${g.unmeasured} ${BOX_SETTINGS_TEXT.notMeasured}`] : []),
  ];
  const set = [
    ...(g.inFile > 0 ? [`${g.inFile} ${BOX_SETTING_PRESENCE_TEXT.file}`] : []),
    ...(g.inEnv > 0 ? [`${g.inEnv} ${BOX_SETTING_PRESENCE_TEXT.environment}`] : []),
  ];
  const size = settingsCount(g.rows.length, g.family === 'other' ? ' this console does not know' : '');
  const parts = g.family === 'other' ? [size, ...attention] : g.used
    ? [size, ...(attention.length > 0 ? attention : set.length > 0 ? set : ['none set'])]
    : [size, BOX_SETTINGS_NOT_USED_TEXT, ...attention];
  return `${BOX_SETTING_FAMILY_TEXT[g.family]}: ${parts.join(', ')}`;
}

/** "5 backups, 4 with data, 12.1 GB", or why the box could not count them. The second return is the danger tone. */
export function backupsLine(b: BoxSettingsBackups): { text: string; danger: boolean } {
  if (b.state === 'unmeasured') return { text: `Backups not measured: ${b.why}`, danger: true };
  const n = b.kept === 1 ? '1 backup' : `${b.kept} backups`;
  return { text: `${n}, ${b.withData} with data, ${humanBytes(b.bytes)}`, danger: false };
}

/** "19.3 GB free of 161.1 GB" (the fleet's one size spelling), or why the box could not measure its disk. */
export function diskLine(d: BoxSettingsDisk): { text: string; danger: boolean } {
  if (d.state === 'unmeasured') return { text: `Disk not measured: ${d.why}`, danger: true };
  return { text: `${humanBytes(d.availBytes)} free of ${humanBytes(d.sizeBytes)}`, danger: false };
}

/** The measurement's age and which environment it read: `measured 2m ago, read by the box's timer`. The age is the SERVER's
 *  (`ageS`, worked out with the request's clock, spec §2.4), never `now - doc.at` on this device: one line then reads from one
 *  clock, the one `stale` was judged by. A stale one names the limit it passed, from `BOX_SETTINGS_STALE_S`, never a literal.
 *  `warn` is the warning tone. */
export function ageLine(read: Extract<BoxSettingsRead, { state: 'ok' }>): { text: string; warn: boolean } {
  const age = `measured ${elapsedWords(read.ageS * 1000)} ago`;
  const reader = BOX_SETTINGS_READER_TEXT[read.doc.reader];
  if (!read.stale) return { text: `${age}, ${reader}`, warn: false };
  return {
    text: `${age} (older than ${elapsedWords(BOX_SETTINGS_STALE_S * 1000)}), ${reader}`,
    warn: true,
  };
}
