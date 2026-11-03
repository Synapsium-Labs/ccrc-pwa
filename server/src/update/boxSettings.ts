// D-6916 (box settings view; spec docs/superpowers/specs/2026-10-25-box-settings-view-design.md §2.2, §2.4, §2.6). L1: pure, clock-free
// and fs-free; it imports L0 alone. What the console makes of a node's `~/.ccrc/box-settings.json`, which `ccrc settings --write`
// replaces whole every five minutes: the ONE validator (`parseBoxSettings`) and the ONE judge of its age (`boxSettingsView`). The lane
// that reads the file is `boxSettingsLane.ts`, which only asks and stores: the caps gate (`boxSettingsGate`) and what a file read comes to
// (`boxSettingsReadOf`) are decided HERE, as the token lane's gate is `token/policy.ts`'s (A11, D-6916).
//
// THE FILE IS A DISPLAY, NEVER AN AUTHORITY (spec §2.6): it is same-user-writable by every session on the box, like every node file. So
// a document that is not exactly the shape the verb writes reads as `null`, whole, and is never shown in part; and no act, and no code
// here, branches on a setting's `why`. `at` is NOT judged by the parse (it has no clock): the view judges it at serve time, so a lane
// that stops running shows as stale instead of freezing a fresh verdict.
import {
  BOX_SETTINGS_CLOCK_AHEAD_S, BOX_SETTINGS_KEYS, BOX_SETTINGS_READERS, BOX_SETTINGS_STALE_S, BOX_SETTING_SOURCES, BOX_SETTING_STATES,
  type BoxSettingKey, type BoxSettingRow, type BoxSettingSource, type BoxSettingState, type BoxSettingsBackups, type BoxSettingsDisk,
  type BoxSettingsDoc, type BoxSettingsFailure, type BoxSettingsRead, type BoxSettingsReader, type NodeOs,
} from '../../../shared/api.js';
import type { ReadFailure } from '../../../shared/agent-protocol.js';

/** The cap word a node's tree advertises when it writes the file (`CCRC_CAP_WORDS_LINUX`, `ccd/ccrc`). */
export const SETTINGS_CAP = 'settings';

/** What the lane holds for one node: the last read. `read` is the parsed document or the word for why there is none; the view adds
 *  the age, from the document's own `at`. */
export interface BoxSettingsHeld {
  readonly read: { readonly state: 'ok'; readonly doc: BoxSettingsDoc } | { readonly state: BoxSettingsFailure };
}

/** The part of a node row the gate reads (`NodeRow`'s `os` and `caps`, described structurally so this file imports L0 alone). */
export interface BoxSettingsGateNode { readonly os: NodeOs; readonly caps: readonly string[] }

/** The caps gate: a node whose caps were not measured (`os` unknown) and one whose measured caps lack the word are told apart, and
 *  neither is read. `null`: ask the node for the file. */
export function boxSettingsGate(node: BoxSettingsGateNode): Extract<BoxSettingsFailure, 'caps-unmeasured' | 'not-supported'> | null {
  if (node.os === 'unknown') return 'caps-unmeasured';
  return node.caps.includes(SETTINGS_CAP) ? null : 'not-supported';
}

/** What one node-file read comes to (`inventory.ts`'s `NodeFileRead`, described structurally for the same reason). */
export type BoxSettingsFileRead = { readonly ok: true; readonly content: string } | { readonly ok: false; readonly reason: ReadFailure | 'too-large' };

/** A failed read is its own reason; content `parseBoxSettings` rejects is `malformed`; a document is `ok`. */
export function boxSettingsReadOf(read: BoxSettingsFileRead): BoxSettingsHeld['read'] {
  if (!read.ok) return { state: read.reason };
  const doc = parseBoxSettings(read.content);
  return doc === null ? { state: 'malformed' } : { state: 'ok', doc };
}

/** Each string reaching a row is printable ASCII, at most this long (the verb clips at 480). */
const STRING_MAX = 512;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Exactly these keys, no more and none missing. */
const hasKeys = (o: Obj, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
};
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= STRING_MAX && PRINTABLE_ASCII.test(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

function rowOf(o: unknown): BoxSettingRow | null {
  if (!isObj(o) || !oneOf<BoxSettingKey>(BOX_SETTINGS_KEYS, o['key']) || !oneOf<BoxSettingState>(BOX_SETTING_STATES, o['state'])) return null;
  const key = o['key'];
  const state = o['state'];
  if (state === 'unmeasured') {
    return hasKeys(o, ['key', 'state', 'why']) && isStr(o['why']) ? { key, state, why: o['why'] } : null;
  }
  const from = o['from'];
  const value = o['value'];
  if (!isStr(value) || !oneOf<BoxSettingSource>(BOX_SETTING_SOURCES, from)) return null;
  if (state === 'ok') return hasKeys(o, ['key', 'state', 'value', 'from']) ? { key, state, value, from } : null;
  return hasKeys(o, ['key', 'state', 'value', 'from', 'why']) && isStr(o['why']) ? { key, state, value, from, why: o['why'] } : null;
}

function backupsOf(o: unknown): BoxSettingsBackups | null {
  if (!isObj(o)) return null;
  if (hasKeys(o, ['state', 'why'])) return o['state'] === 'unmeasured' && isStr(o['why']) ? { state: 'unmeasured', why: o['why'] } : null;
  if (!hasKeys(o, ['state', 'kept', 'withData', 'bytes']) || o['state'] !== 'ok') return null;
  const { kept, withData, bytes } = o;
  return isCount(kept) && isCount(withData) && isCount(bytes) ? { state: 'ok', kept, withData, bytes } : null;
}

function diskOf(o: unknown): BoxSettingsDisk | null {
  if (!isObj(o)) return null;
  if (hasKeys(o, ['state', 'why'])) return o['state'] === 'unmeasured' && isStr(o['why']) ? { state: 'unmeasured', why: o['why'] } : null;
  if (!hasKeys(o, ['state', 'availBytes', 'sizeBytes']) || o['state'] !== 'ok') return null;
  const { availBytes, sizeBytes } = o;
  return isCount(availBytes) && isCount(sizeBytes) ? { state: 'ok', availBytes, sizeBytes } : null;
}

/**
 * The one validator. Version 1, the seven keys once each (any order in the file, the canonical order out), the `state`, `from` and
 * `reader` words from their shared maps, printable ASCII of at most 512 characters, non-negative safe integers, and no key the verb does
 * not write. Anything else is `null`: a document is accepted whole or not at all.
 */
export function parseBoxSettings(text: string): BoxSettingsDoc | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  // Strict on purpose: a writer that adds a field must bump `v`, and an older server reads a newer additive field as `malformed`, never half-shown.
  if (!isObj(parsed) || !hasKeys(parsed, ['v', 'at', 'reader', 'settings', 'deadline', 'backups', 'disk'])) return null;
  const { v, at, reader, settings, deadline } = parsed;
  if (v !== 1 || !isCount(at) || !oneOf<BoxSettingsReader>(BOX_SETTINGS_READERS, reader)) return null;
  if (!Array.isArray(settings) || settings.length !== BOX_SETTINGS_KEYS.length) return null;
  const byKey = new Map<BoxSettingKey, BoxSettingRow>();
  for (const s of settings) {
    const row = rowOf(s);
    if (row === null || byKey.has(row.key)) return null;
    byKey.set(row.key, row);
  }
  if (!isObj(deadline) || !hasKeys(deadline, ['plainMs', 'minMs', 'maxMs'])) return null;
  const { plainMs, minMs, maxMs } = deadline;
  if (!isCount(plainMs) || !isCount(minMs) || !isCount(maxMs)) return null;
  const backups = backupsOf(parsed['backups']);
  const disk = diskOf(parsed['disk']);
  if (backups === null || disk === null) return null;
  return {
    v: 1, at, reader, settings: BOX_SETTINGS_KEYS.map((k) => byKey.get(k)!),
    deadline: { plainMs, minMs, maxMs }, backups, disk,
  };
}

/**
 * What `NodeWire.settings` says for one node, at the request's clock (`nowS`, unix seconds).
 *  - Never read since this server started (`held` undefined): `unmeasured` (D-7874, superseding D-7863's `unreadable`: nothing was
 *    tried, so no read failed, and `unreadable` stays only for a read that was tried and failed).
 *  - A held failure is its own word.
 *  - A held document whose `at` is more than `BOX_SETTINGS_CLOCK_AHEAD_S` ahead of the clock is `clock-ahead`, never shown.
 *  - Otherwise `ok`, with `ageS` (never negative: a clock a few seconds behind is age 0) and `stale` once it passes
 *    `BOX_SETTINGS_STALE_S`.
 */
export function boxSettingsView(held: BoxSettingsHeld | undefined, nowS: number): BoxSettingsRead {
  if (held === undefined) return { state: 'unmeasured' };
  if (held.read.state !== 'ok') return { state: held.read.state };
  const { doc } = held.read;
  if (doc.at > nowS + BOX_SETTINGS_CLOCK_AHEAD_S) return { state: 'clock-ahead' };
  const ageS = Math.max(0, nowS - doc.at);
  return { state: 'ok', doc, ageS, stale: ageS > BOX_SETTINGS_STALE_S };
}
