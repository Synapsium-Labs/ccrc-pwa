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
  BOX_SETTINGS_CLOCK_AHEAD_S, BOX_SETTINGS_KEYS, BOX_SETTINGS_READERS, BOX_SETTINGS_STALE_S, BOX_SETTINGS_TEXT_MAX, BOX_SETTINGS_V1_REFUSED_WHY,
  BOX_SETTINGS_V1_UNFIT_WHY, BOX_SETTINGS_WHY_MAX, BOX_SETTING_ORIGIN_SHAPE, BOX_SETTING_SOURCES, BOX_SETTING_SPECS, BOX_SETTING_STATES,
  BOX_SETTING_REFUSAL_WORDS, BOX_SETTING_VALUE_SHAPE, BOX_SETTING_VALUE_WORDS, BOX_SETTINGS_SHOWN,
  type BoxSettingName, type BoxSettingKey, type BoxSettingRowV1, type BoxSettingRowV2, type BoxSettingSource, type BoxSettingState, type BoxSettingsBackups, type BoxSettingsDisk,
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

/** The two shapes are envelopes that admit no path, query, fragment, userinfo or whitespace, and restate no setting's own check
 *  (that stays in the writer's owner); an origin's `custom <host>` arm requires an http or https scheme, so a scheme-less word cannot show (operator item 41, D-7923). Compiled once, without `g`, so a test holds no state. */
const VALUE_RE = new RegExp(BOX_SETTING_VALUE_SHAPE);
const ORIGIN_RE = new RegExp(BOX_SETTING_ORIGIN_SHAPE);

/** Whether an `ok` value or origin is inside the envelope its class allows: under the writer's own cut (the value is printable ASCII, so
 *  length is bytes), and by class the value shape or that key's own fixed words, or the origin shape. Any other class has no value. */
function fitsClass(key: BoxSettingName, value: string): boolean {
  if (value.length > BOX_SETTINGS_TEXT_MAX) return false;
  switch (BOX_SETTING_SPECS[key].cls) {
    case 'value': return VALUE_RE.test(value) || (BOX_SETTING_VALUE_WORDS[key]?.includes(value) ?? false);
    case 'origin': return ORIGIN_RE.test(value);
    default: return false;
  }
}

/** The writer's own cut form: the first 237 bytes and `...`. */
const cutWhy = (why: string): string => (why.length > BOX_SETTINGS_WHY_MAX ? `${why.slice(0, BOX_SETTINGS_WHY_MAX - 3)}...` : why);

/** A version-1 row: checked as wave 1 checked it, then rewritten so that nothing the box wrote in three cases is forwarded (D-7911):
 *  a refused row loses its value and its `why`; an `ok` row outside the envelope becomes `unmeasured`; a long `why` is cut. */
function rowOfV1(o: unknown): BoxSettingRowV1 | null {
  if (!isObj(o) || !oneOf<BoxSettingKey>(BOX_SETTINGS_KEYS, o['key']) || !oneOf<BoxSettingState>(BOX_SETTING_STATES, o['state'])) return null;
  const key = o['key'];
  const state = o['state'];
  if (state === 'unmeasured') {
    return hasKeys(o, ['key', 'state', 'why']) && isStr(o['why']) ? { key, state, why: cutWhy(o['why']) } : null;
  }
  const from = o['from'];
  const value = o['value'];
  if (!isStr(value) || !oneOf<BoxSettingSource>(BOX_SETTING_SOURCES, from)) return null;
  if (state === 'ok') {
    if (!hasKeys(o, ['key', 'state', 'value', 'from'])) return null;
    return fitsClass(key, value) ? { key, state, value, from } : { key, state: 'unmeasured', why: BOX_SETTINGS_V1_UNFIT_WHY };
  }
  return hasKeys(o, ['key', 'state', 'value', 'from', 'why']) && isStr(o['why']) ? { key, state, from, why: BOX_SETTINGS_V1_REFUSED_WHY } : null;
}

/** A version-2 row, checked against its class (D-7913). Unlike version 1, version 2 is this build's own writer's, so a row outside the envelope is a
 *  forgery and is never rewritten. Every arm names the exact key set, so a `value` of any kind (an empty one too) on an is-set (the spec's `presence`, D12) or refused row is
 *  as `null` as any other: nothing here tests a value for truthiness. */
function rowOfV2(o: unknown): BoxSettingRowV2 | null {
  if (!isObj(o) || typeof o['key'] !== 'string' || !Object.hasOwn(BOX_SETTING_SPECS, o['key']) || !oneOf<BoxSettingState>(BOX_SETTING_STATES, o['state'])) return null;
  const key = o['key'] as BoxSettingName;
  const cls = BOX_SETTING_SPECS[key].cls;
  if (cls === 'omit') return null;
  const state = o['state'];
  if (state === 'unmeasured') {
    return hasKeys(o, ['key', 'state', 'why']) && isStr(o['why']) && o['why'].length <= BOX_SETTINGS_WHY_MAX ? { key, state, why: o['why'] } : null;
  }
  const from = o['from'];
  if (!oneOf<BoxSettingSource>(BOX_SETTING_SOURCES, from)) return null;
  if (state === 'refused') {
    return hasKeys(o, ['key', 'state', 'from', 'why']) && oneOf(BOX_SETTING_REFUSAL_WORDS, o['why']) ? { key, state, from, why: o['why'] } : null;
  }
  if (cls === 'is-set') return hasKeys(o, ['key', 'state', 'from']) ? { key, state, from } : null;
  const value = o['value'];
  return hasKeys(o, ['key', 'state', 'value', 'from']) && isStr(value) && fitsClass(key, value) ? { key, state, value, from } : null;
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
 * The one validator, for both versions. Version 1: the seven keys once each; version 2: the 61 shown names once each, each row checked
 * against its class (D-7913). Any order in the file, the canonical order out; the `state`, `from` and `reader` words from their shared maps,
 * printable ASCII of at most 512 characters, non-negative safe integers, and no key the verb does not write. Version 1 rows are checked as
 * wave 1 wrote them and then rewritten (`rowOfV1`); a version-2 row outside its class is a forgery. Anything else is `null`: a document is
 * accepted whole or not at all.
 */
export function parseBoxSettings(text: string): BoxSettingsDoc | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  // Strict on purpose: a writer that adds a field must bump `v`, and an older server reads a newer additive field as `malformed`, never half-shown.
  if (!isObj(parsed) || !hasKeys(parsed, ['v', 'at', 'reader', 'settings', 'deadline', 'backups', 'disk'])) return null;
  const { v, at, reader, settings, deadline } = parsed;
  if ((v !== 1 && v !== 2) || !isCount(at) || !oneOf<BoxSettingsReader>(BOX_SETTINGS_READERS, reader)) return null;
  if (!Array.isArray(settings)) return null;
  // One pass per version, each into its own rows: the wire carries the box's own version and the server never converts one to the other.
  const rows1 = new Map<BoxSettingKey, BoxSettingRowV1>();
  const rows2 = new Map<BoxSettingName, BoxSettingRowV2>();
  if (settings.length !== (v === 1 ? BOX_SETTINGS_KEYS.length : BOX_SETTINGS_SHOWN.length)) return null;
  for (const s of settings) {
    if (v === 1) {
      const row = rowOfV1(s);
      if (row === null || rows1.has(row.key)) return null;
      rows1.set(row.key, row);
    } else {
      const row = rowOfV2(s);
      if (row === null || rows2.has(row.key)) return null;
      rows2.set(row.key, row);
    }
  }
  if (!isObj(deadline) || !hasKeys(deadline, ['plainMs', 'minMs', 'maxMs'])) return null;
  const { plainMs, minMs, maxMs } = deadline;
  if (!isCount(plainMs) || !isCount(minMs) || !isCount(maxMs)) return null;
  const backups = backupsOf(parsed['backups']);
  const disk = diskOf(parsed['disk']);
  if (backups === null || disk === null) return null;
  const dl = { plainMs, minMs, maxMs };
  return v === 1
    ? { v: 1, at, reader, settings: BOX_SETTINGS_KEYS.map((k) => rows1.get(k)!), deadline: dl, backups, disk }
    : { v: 2, at, reader, settings: BOX_SETTINGS_SHOWN.map((k) => rows2.get(k)!), deadline: dl, backups, disk };
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
