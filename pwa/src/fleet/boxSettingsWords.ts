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
  BoxSettingKey, BoxSettingRow, BoxSettingSource, BoxSettingsBackups, BoxSettingsDisk, BoxSettingsDoc, BoxSettingsFailure,
  BoxSettingsReader, BoxSettingsRead, NodeRole,
} from '../../../shared/api';
import {
  BOX_SETTING_SOURCES, BOX_SETTING_STATES, BOX_SETTINGS_FAILURES, BOX_SETTINGS_READERS, BOX_SETTINGS_STALE_S,
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

/** The models budget has no reader on a server box: no models timer runs there (spec §2.5). */
export const BOX_SETTINGS_SERVER_BUDGET_TEXT = 'not used on a server box';
const MODELS_BUDGET_KEY: BoxSettingKey = 'CCRC_MODELS_ADVANCE_BUDGET_S';

export const BOX_SETTINGS_TEXT = {
  /** The card's block label beside each node's own: the values are the box's, never the server's. */
  reportedBy: 'reported by the box',
  notMeasured: 'not measured',
  /** Under the card (spec §2.5): where a setting is changed, and what the source column is for. */
  how: "A setting is changed in the box's ccrc.env, never here. The source says when the environment overrides the file.",
} as const;

/** A document string is rendered as text, so it must be one. */
const isStr = (v: unknown): v is string => typeof v === 'string';

function readRow(v: unknown): BoxSettingRow | null {
  if (!isRecord(v) || !isStr(v.key) || !isOneOf(BOX_SETTING_STATES, v.state)) return null;
  // The key is box-written: it is shown as the text it is, never trusted to be one of the seven.
  const key = v.key as BoxSettingKey;
  if (v.state === 'unmeasured') return isStr(v.why) ? { key, state: 'unmeasured', why: v.why } : null;
  if (!isStr(v.value) || !isOneOf(BOX_SETTING_SOURCES, v.from)) return null;
  if (v.state === 'ok') return { key, state: 'ok', value: v.value, from: v.from };
  return isStr(v.why) ? { key, state: 'refused', value: v.value, from: v.from, why: v.why } : null;
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
  if (!isRecord(v) || v.v !== 1 || !isNum(v.at) || !isOneOf(BOX_SETTINGS_READERS, v.reader)) return null;
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
  return { v: 1, at: v.at, reader: v.reader, settings, deadline: { plainMs, minMs, maxMs }, backups, disk };
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

/** How one setting reads: its value and where it came from, or why it could not be measured. A server-role node's models
 *  budget is the one exception: no act reads it there, whatever the row says. */
export interface BoxSettingLine {
  key: string;
  /** What is shown for the value. */
  value: string;
  /** The source word, or null where there is none to say (unmeasured, or not used on this box). */
  from: string | null;
  /** The sentence for a refused or unmeasured row, shown in the danger tone; null for a row that is fine. */
  why: string | null;
}

export function settingLine(row: BoxSettingRow, role: NodeRole | null): BoxSettingLine {
  if (role === 'server' && row.key === MODELS_BUDGET_KEY) {
    return { key: row.key, value: BOX_SETTINGS_SERVER_BUDGET_TEXT, from: null, why: null };
  }
  if (row.state === 'unmeasured') return { key: row.key, value: BOX_SETTINGS_TEXT.notMeasured, from: null, why: row.why };
  return { key: row.key, value: row.value, from: BOX_SETTING_SOURCE_TEXT[row.from], why: row.state === 'refused' ? row.why : null };
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
