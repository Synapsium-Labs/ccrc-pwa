/**
 * STALL WATCH SETTINGS, the L1 suite (design 2026-10-05, §5, §6, §12, §14, §17). W1 Task 1 lands its first half: the
 * L0 ladder texts in `shared/api.ts` and the settings core in `server/src/coord/stallsettings.ts` (the ladder, the
 * bounds, the two validity predicates, the parse, the box arming and its unheld reading, the resolver, and the four
 * readers `stallLevelOf`, `stallStages`, `stallNextStep` and `stallFilesExceed`). Later tasks append their rows here.
 *
 * No marker name is spelled in this file. The four lane markers come from `STALL_MARKERS` in its Record order, which a
 * CONTROL row proves against `stallArmingOf`; the mail-gate markers and `mail-disabled` come from their definers'
 * exports. So this suite never becomes a second holder that a no-writer pin would have to reason about.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_NOTICE_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_STATES, isStallLevelChoice } from '../../shared/api.js';
import type { StallLevel, StallLevelChoice, StallStored, StallWriteEffect } from '../../shared/api.js';
import type { ReadFailure } from '../../shared/agent-protocol.js';
import {
  STALL_LADDER, STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS,
  armedStages, decideStallSettings, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch,
  stallBoxArmingOf, stallEffectKey, stallFilesExceed, stallLevelOf, stallNeedsConfirm, stallNextStep, stallNoticeCounts,
  stallPatchIsNoOp, stallSettingsAfter, stallSettingsChange, stallStages, stallUnheldBoxOf, stallWriteEffect,
} from '../src/coord/stallsettings.js';
import type { StallBoxArming, StallSettingsParsed, StallSettingsPatch, StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_ARMS, STALL_MARKERS, STALL_QUIET_MS, rungRecipient, stallArmHasRung, stallArmingOf, stallDetail } from '../src/coord/stall.js';
import type { StallArm } from '../src/coord/stall.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER, mailTurnModeOf } from '../src/turnidle.js';
import { MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The lane's four markers, in `STALL_MARKER_MAP`'s order: the kill file, live, escalate, the wave-2 step. */
const [KILL, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const STRICT = MAIL_GATE_STRICT_MARKER;
const BUSY = MAIL_GATE_BUSY_MARKER;
const SHADOW = MAIL_GATE_BUSY_SHADOW_MARKER;
const MAIL_OFF = MAIL_DISABLED_MARKER;
/** The seven arming files plus `mail-disabled`: the 2^8 combinations M4's property walks. */
const EIGHT = [KILL, LIVE, ESCALATE, W2LIVE, STRICT, BUSY, SHADOW, MAIL_OFF] as const;

/** One registry listing's box arming, `mail-disabled` read the way `sweepStalls` reads it. */
const box = (...names: string[]): StallBoxArming => stallBoxArmingOf(names, names.includes(MAIL_OFF));
/** Today's expression (`watch.ts` ≈:3788), written out independently of `stallBoxArmingOf`. */
const today = (names: readonly string[]) =>
  ({ ...stallArmingOf(names), mailDisabled: names.includes(MAIL_OFF), mailMode: mailTurnModeOf(names) });

const rowRead = (level: unknown, quietMs: unknown = null, updatedAt: unknown = 1_790_000_000_000): StallSettingsRead =>
  ({ kind: 'row', row: { level, quietMs, updatedAt } });
const chosen = (level: StallLevelChoice | string, quietMs: unknown = null): StallSettingsParsed =>
  parseStallSettings(rowRead(level, quietMs));
const FOLLOW = chosen('follow');
const ABSENT = parseStallSettings({ kind: 'absent' });
const UNREADABLE = parseStallSettings({ kind: 'unreadable', detail: 'no such table: stall_settings' });

const MIN = 60_000;
const H = 3_600_000;

describe('CONTROL: the fixtures name the markers they claim to', () => {
  it('STALL_MARKERS is in Record order: kill file, live, escalate, the wave-2 step', () => {
    expect(stallArmingOf([KILL])).toEqual({ disabled: true, live: false, escalate: false, w2Live: false });
    expect(stallArmingOf([LIVE])).toEqual({ disabled: false, live: true, escalate: false, w2Live: false });
    expect(stallArmingOf([ESCALATE])).toEqual({ disabled: false, live: false, escalate: true, w2Live: false });
    expect(stallArmingOf([W2LIVE])).toEqual({ disabled: false, live: false, escalate: false, w2Live: true });
    expect([STRICT, BUSY, SHADOW].map((n) => mailTurnModeOf([n]))).toEqual(['strict', 'busy', 'busy-shadow']);
    expect(new Set(EIGHT).size).toBe(8);
  });
});

// ── L0 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('L0: the ladder and stage texts are one total Record each, in ladder and §5.1 order', () => {
  it('STALL_LEVELS is derived from STALL_LEVEL_TEXT, in ladder order', () => {
    expect(STALL_LEVELS).toEqual(['off', 'log', 'check', 'alert', 'deliver', 'all']);
    expect(STALL_LEVELS).toEqual(Object.keys(STALL_LEVEL_TEXT));
    expect(STALL_LEVELS.map((l) => STALL_LEVEL_TEXT[l].label))
      .toEqual(['Off', 'Log only', 'Check silent workers', 'Alert coordinator and you', 'Deliver mail to busy sessions', 'Everything']);
  });
  it('STALL_STAGES is derived from STALL_STAGE_TEXT, in §5.1 order, and only the busy gate has no gate', () => {
    expect(STALL_STAGES).toEqual(['checks', 'alerts', 'busyDelivery', 'busyGate', 'wave2']);
    expect(STALL_STAGES).toEqual(Object.keys(STALL_STAGE_TEXT));
    expect(STALL_STAGES.filter((s) => STALL_STAGE_TEXT[s].gate === null)).toEqual(['busyGate']);
  });
  it('StallStored is a row or ReadFailure\'s two words, derived from STALL_STORED_STATES', () => {
    expect(STALL_STORED_STATES).toEqual(['row', 'absent', 'unreadable']);
    const failures: ReadFailure[] = STALL_STORED_STATES.filter((s): s is Exclude<StallStored, 'row'> => s !== 'row');
    expect(failures).toEqual(['absent', 'unreadable']);
  });
  it('no does text, stops text or gate carries a duration, a rung code or a wave number (§5)', () => {
    const texts = [
      ...STALL_LEVELS.map((l) => STALL_LEVEL_TEXT[l].does),
      ...STALL_STAGES.flatMap((s) => [STALL_STAGE_TEXT[s].stops, STALL_STAGE_TEXT[s].gate ?? '']),
    ];
    expect(texts.length).toBe(16);
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b\d+\s*(?:h|hours?|min|minutes?|s|seconds?|d|days?)\b|\br[1-3]\b|\bwave\s*\d/i);
    }
  });
});

describe('isStallLevelChoice: its own keys only, with the pinned body (M11b)', () => {
  it('accepts follow and the six levels, and nothing else', () => {
    for (const v of ['follow', ...STALL_LEVELS]) expect(isStallLevelChoice(v), v).toBe(true);
    for (const v of ['custom', 'unknown', 'Follow', 'OFF', '', ' log', 1, null, undefined, {}, ['log']]) {
      expect(isStallLevelChoice(v), String(v)).toBe(false);
    }
  });
  it('refuses the prototype names that an `in` or `MAP[v]` test would accept', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(isStallLevelChoice(v), v).toBe(false);
    }
  });
  it('has the pinned body (§6.1): a string, then follow or an includes over STALL_LEVELS', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
    const body = /export function isStallLevelChoice\(v: unknown\): v is StallLevelChoice \{\n([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body).toBe("  return typeof v === 'string' && (v === 'follow' || (STALL_LEVELS as readonly string[]).includes(v));");
  });
});

describe('isStallQuietMs: whole 30-minute steps from 30 min to 12 h, inclusive (§7)', () => {
  it('the bounds, step and window carry the spec values', () => {
    expect([STALL_QUIET_MIN_MS, STALL_QUIET_MAX_MS, STALL_QUIET_STEP_MS, STALL_NOTICE_WINDOW_MS])
      .toEqual([30 * MIN, 12 * H, 30 * MIN, 48 * H]);
    expect(STALL_QUIET_MS % STALL_QUIET_STEP_MS).toBe(0);
    expect(isStallQuietMs(STALL_QUIET_MS)).toBe(true);
  });
  it('accepts the bounds and every step between, and refuses everything else, never clamping', () => {
    for (let v = STALL_QUIET_MIN_MS; v <= STALL_QUIET_MAX_MS; v += STALL_QUIET_STEP_MS) expect(isStallQuietMs(v), String(v)).toBe(true);
    for (const v of [29 * MIN, 45 * MIN, 12 * H + 30 * MIN, 0, -30 * MIN, 30 * MIN + 1, 1_800_000.5, NaN, Infinity]) {
      expect(isStallQuietMs(v), String(v)).toBe(false);
    }
    for (const v of ['1800000', 1_800_000n, null, undefined, {}, [1_800_000]]) expect(isStallQuietMs(v), String(v)).toBe(false);
  });
});

// ── the parse ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('parseStallSettings: each field on its own; absent and unreadable kept apart', () => {
  it('a missing row and an unreadable read are their own words, and neither is follow or default', () => {
    expect(ABSENT).toEqual({ stored: 'absent', level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null });
    expect(UNREADABLE).toEqual({ stored: 'unreadable', level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null });
  });
  it('reads the seed as follow and the built-in, and a chosen row as chosen', () => {
    expect(parseStallSettings(rowRead('follow', null, 0)))
      .toEqual({ stored: 'row', level: { kind: 'follow' }, quiet: { kind: 'default' }, updatedAt: 0 });
    expect(parseStallSettings(rowRead('check', 3 * H, 5)))
      .toEqual({ stored: 'row', level: { kind: 'chosen', level: 'check' }, quiet: { kind: 'set', ms: 3 * H }, updatedAt: 5 });
  });
  it('M11: one predicate for write and read: the parse sets a quiet time exactly when isStallQuietMs accepts it', () => {
    const table: unknown[] = [30 * MIN, 45 * MIN, 12 * H, 12 * H + 30 * MIN, 29 * MIN, 1_800_000.5, '1800000', 0, -30 * MIN, NaN];
    for (const v of table) {
      const q = chosen('log', v).quiet;
      expect(q.kind === 'set', String(v)).toBe(isStallQuietMs(v));
      expect(q, String(v)).toEqual(isStallQuietMs(v) ? { kind: 'set', ms: v } : { kind: 'unreadable', value: v });
    }
    expect(chosen('log', 1_800_000.5).quiet.kind).toBe('unreadable');
    expect(chosen('log', '1800000').quiet.kind).toBe('unreadable');
  });
  it('M11b: a prototype name stored as the level reads unreadable, never a level', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(chosen(v).level, v).toEqual({ kind: 'unreadable', token: v });
    }
    expect(chosen('custom').level).toEqual({ kind: 'unreadable', token: 'custom' });
    expect(chosen(3 as unknown as string).level).toEqual({ kind: 'unreadable', token: 3 });
  });
  it('M11c (parse half): a bigint inside the safe range converts, an oversize one reads unreadable per field', () => {
    expect(chosen('check', 1_800_000n).quiet).toEqual({ kind: 'set', ms: 1_800_000 });
    const big = 9_223_372_036_854_775_807n;
    const p = chosen('check', big);
    expect(p.quiet).toEqual({ kind: 'unreadable', value: big });
    expect(p.level, 'one bad field costs only that field').toEqual({ kind: 'chosen', level: 'check' });
    expect(parseStallSettings(rowRead('check', null, 1_790_000_000_000n)).updatedAt).toBe(1_790_000_000_000);
    for (const v of ['abc', 1.5, big, null, NaN]) {
      expect(parseStallSettings(rowRead('check', null, v)).updatedAt, String(v)).toBeNull();
    }
  });
});

// ── the box arming ───────────────────────────────────────────────────────────────────────────────────────────────

describe('stallBoxArmingOf and stallUnheldBoxOf', () => {
  it('stallBoxArmingOf is today\'s expression over the same listing', () => {
    const names = [LIVE, SHADOW, 'demo-quiet-mesa.json'];
    expect(stallBoxArmingOf(names, false)).toEqual(today(names));
    expect(stallBoxArmingOf(names, true)).toEqual({ ...today(names), mailDisabled: true });
  });
  it('the unheld reading clears the kill file, the mail kill file and strict, and keeps the busy mode below strict', () => {
    expect(stallUnheldBoxOf([KILL, LIVE, STRICT, BUSY, MAIL_OFF]))
      .toEqual({ disabled: false, live: true, escalate: false, w2Live: false, mailDisabled: false, mailMode: 'busy' });
    expect(stallUnheldBoxOf([STRICT, SHADOW]).mailMode).toBe('busy-shadow');
    expect(stallUnheldBoxOf([STRICT]).mailMode).toBe('shell');
    expect(stallUnheldBoxOf([LIVE, ESCALATE])).toEqual(box(LIVE, ESCALATE));
  });
});

// ── the resolver ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Every subset of the eight files, as a listing. */
const SUBSETS: string[][] = Array.from({ length: 2 ** EIGHT.length }, (_, bits) => EIGHT.filter((_, i) => (bits >> i) & 1));

describe('M4: Follow, and a row that does not apply whole, is today\'s behaviour exactly', () => {
  const settings: ReadonlyArray<readonly [string, StallSettingsParsed]> = [
    ['follow', FOLLOW],
    ['the seed', parseStallSettings(rowRead('follow', null, 0))],
    ['an absent row', ABSENT],
    ['an unreadable read', UNREADABLE],
    ['a chosen level beside an unreadable quiet time', chosen('all', 45 * MIN)],
    ['an unreadable level beside a chosen quiet time', chosen('constructor', 3 * H)],
  ];
  it('walks all 256 combinations of the seven arming files and mail-disabled', () => {
    expect(SUBSETS.length).toBe(256);
    expect(new Set(SUBSETS.map((s) => s.join('|'))).size).toBe(256);
  });
  for (const [what, s] of settings) {
    it(`${what}: the resolved arming IS the box object, equal to today's expression, with the built-in quiet time`, () => {
      for (const names of SUBSETS) {
        const b = box(...names);
        const r = resolveStallWatch(b, s);
        expect(r.arming, names.join(',')).toBe(b);
        expect(r.arming, names.join(',')).toStrictEqual(today(names));
        expect(r.quietMs).toBe(STALL_QUIET_MS);
        expect(r.quietSource).toBe('default');
        expect(r.chosen).toBeNull();
        expect(r.levelSource).toBe('files');
        expect(r.effective).toBe(r.files);
      }
    });
  }
});

describe('M1: the lane\'s kill file restores the box wholesale', () => {
  it('a chosen deliver over the kill file keeps the box\'s mail mode, never busy, and reads held', () => {
    for (const mode of [[], [SHADOW], [STRICT]]) {
      const b = box(KILL, LIVE, ...mode);
      const r = resolveStallWatch(b, chosen('deliver'));
      expect(r.arming).toBe(b);
      expect(r.arming.mailMode).toBe(mailTurnModeOf(mode));
      expect(r.arming.disabled).toBe(true);
      expect(r.levelSource).toBe('held');
      expect(r.held.watchOff).toBe(true);
      expect(r.effective).toBe('off');
    }
  });
});

describe('M1b: off is never read while busy delivery is on', () => {
  it('a chosen off, or the kill file, over a box busy file reads custom', () => {
    const r = resolveStallWatch(box(BUSY), chosen('off'));
    expect(r.arming).toEqual({ ...box(BUSY), disabled: true });
    expect(r.effective).toBe('custom');
    expect(r.levelSource).toBe('chosen');
    expect(stallLevelOf(box(KILL, BUSY))).toBe('custom');
    expect(stallLevelOf(box(KILL, SHADOW))).toBe('off');
    expect(stallLevelOf(box(KILL))).toBe('off');
  });
});

describe('M2: mail-disabled passes through a chosen level (L1 half)', () => {
  it('every running level carries the box\'s mailDisabled, and mailOff is held', () => {
    for (const level of STALL_LEVELS.filter((l) => l !== 'off')) {
      const r = resolveStallWatch(box(MAIL_OFF), chosen(level));
      expect(r.arming.mailDisabled, level).toBe(true);
      expect(r.held.mailOff, level).toBe(true);
      expect(r.levelSource, `${level}: mail off changes what a level does nowhere the confirm reads`).toBe('chosen');
    }
    expect(resolveStallWatch(box(), chosen('check')).arming.mailDisabled).toBe(false);
  });
});

describe('M3 and M3b: strict keeps the mail gate, and holds the wave-2 step', () => {
  it('a chosen deliver or all under strict keeps strict, and reads alert, held', () => {
    for (const level of ['deliver', 'all'] as const) {
      const r = resolveStallWatch(box(STRICT), chosen(level));
      expect(r.arming.mailMode, level).toBe('strict');
      expect(r.effective, level).toBe('alert');
      expect(r.levelSource, level).toBe('held');
      expect(r.held.gateStrict, level).toBe(true);
    }
  });
  it('M3b: a chosen all under strict has w2Live false and wave2HeldByStrict; deliver does not', () => {
    const all = resolveStallWatch(box(STRICT), chosen('all'));
    expect(all.arming.w2Live).toBe(false);
    expect(all.held.wave2HeldByStrict).toBe(true);
    const deliver = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect(deliver.held.wave2HeldByStrict).toBe(false);
    expect(resolveStallWatch(box(), chosen('all')).arming.w2Live).toBe(true);
    expect(resolveStallWatch(box(), chosen('all')).held.wave2HeldByStrict).toBe(false);
  });
});

describe('the chosen arm decides every other flag and the mail mode (§6.3 item 4)', () => {
  it('each running level resolves to its own ladder row over a box with no files', () => {
    for (const level of STALL_LEVELS) {
      const row = STALL_LADDER[level];
      const r = resolveStallWatch(box(), chosen(level));
      expect(r.chosen, level).toBe(level);
      expect(r.effective, level).toBe(level);
      expect(r.levelSource, level).toBe('chosen');
      if (row.disabled) { expect(r.arming).toEqual({ ...box(), disabled: true }); continue; }
      expect(r.arming, level).toEqual({ disabled: false, live: row.live, escalate: row.escalate, w2Live: row.w2Live, mailDisabled: false, mailMode: row.mailMode });
    }
  });
  it('a chosen check turns off a busy mode the files set, and overrides every lane file but the kill file', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, W2LIVE, BUSY), chosen('check'));
    expect(r.arming).toEqual({ disabled: false, live: true, escalate: false, w2Live: false, mailDisabled: false, mailMode: 'busy-shadow' });
    expect(r.files).toBe('all');
    expect(r.effective).toBe('check');
  });
  it('a chosen quiet time applies with its row, and the ladder table is §5\'s', () => {
    const r = resolveStallWatch(box(), chosen('follow', 3 * H));
    expect([r.quietMs, r.quietSource]).toEqual([3 * H, 'chosen']);
    expect(STALL_LADDER).toEqual({
      off: { disabled: true },
      log: { disabled: false, live: false, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
      check: { disabled: false, live: true, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
      alert: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy-shadow' },
      deliver: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy' },
      all: { disabled: false, live: true, escalate: true, w2Live: true, mailMode: 'busy' },
    });
  });
});

describe('M23: the held flags, and held only when a flag changed what the choice does', () => {
  it('each flag alone', () => {
    expect(resolveStallWatch(box(KILL), FOLLOW).held).toEqual({ watchOff: true, mailOff: false, gateStrict: false, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(MAIL_OFF), FOLLOW).held).toEqual({ watchOff: false, mailOff: true, gateStrict: false, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(STRICT), FOLLOW).held).toEqual({ watchOff: false, mailOff: false, gateStrict: true, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(), FOLLOW).held).toEqual({ watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false });
  });
  it('a chosen deliver under strict reads alert, held; a chosen check under strict reads check, held', () => {
    const d = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect([d.effective, d.levelSource]).toEqual(['alert', 'held']);
    const c = resolveStallWatch(box(STRICT), chosen('check'));
    expect([c.effective, c.levelSource]).toEqual(['check', 'held']);
  });
  it('a chosen off under the kill file, with and without a box busy file, stays chosen', () => {
    const plain = resolveStallWatch(box(KILL), chosen('off'));
    expect([plain.effective, plain.levelSource]).toEqual(['off', 'chosen']);
    const busy = resolveStallWatch(box(KILL, BUSY), chosen('off'));
    expect([busy.effective, busy.levelSource]).toEqual(['custom', 'chosen']);
    const strict = resolveStallWatch(box(STRICT), chosen('off'));
    expect([strict.effective, strict.levelSource], 'off leaves the mail gate as the files set it, strict included').toEqual(['off', 'chosen']);
  });
  it('a flag that merely stands beside the choice sets nothing', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, MAIL_OFF), chosen('alert'));
    expect([r.effective, r.levelSource, r.held.mailOff]).toEqual(['alert', 'chosen', true]);
  });
});

describe('M25: a row applies whole, or not at all (§6.2, §19 Q11)', () => {
  it('an unreadable level beside a set quiet time: the files and the built-in quiet time', () => {
    const r = resolveStallWatch(box(LIVE, SHADOW), chosen('toString', 30 * MIN));
    expect(r.quietMs).toBe(STALL_QUIET_MS);
    expect(r.quietSource).toBe('default');
    expect(r.levelSource).toBe('files');
    expect(r.effective).toBe('check');
  });
  it('a chosen level beside an unreadable quiet time: the files, not the level', () => {
    const b = box(LIVE, SHADOW);
    const r = resolveStallWatch(b, chosen('all', 45 * MIN));
    expect(r.arming).toBe(b);
    expect(r.chosen).toBeNull();
    expect(r.levelSource).toBe('files');
    expect(r.effective).toBe('check');
    expect(r.quietMs).toBe(STALL_QUIET_MS);
  });
});

// ── the readers ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('M5: stallLevelOf reads custom for a combination no step names, and never off for a running arming', () => {
  it('escalate without live, and w2-live without escalate, read custom', () => {
    expect(stallLevelOf(box(ESCALATE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, ESCALATE, W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, BUSY)), 'busy delivery without escalation is no step').toBe('custom');
  });
  it('a running arming with no flags reads log, never off; the busy gate never splits a level (Q1)', () => {
    expect(stallLevelOf(box())).toBe('log');
    expect(stallLevelOf(box(SHADOW))).toBe('log');
    expect(stallLevelOf(box(STRICT))).toBe('log');
    expect(stallLevelOf(box(LIVE, SHADOW)), 'today\'s fleet').toBe('check');
    expect(stallLevelOf(box(LIVE, ESCALATE))).toBe('alert');
    expect(stallLevelOf(box(LIVE, ESCALATE, BUSY))).toBe('deliver');
    expect(stallLevelOf(box(LIVE, ESCALATE, W2LIVE, BUSY))).toBe('all');
  });
  it('an arming with no mailMode reads as shell', () => {
    expect(stallLevelOf({ disabled: false, live: true, escalate: false })).toBe('check');
    expect(stallLevelOf({ disabled: true, live: false, escalate: false })).toBe('off');
  });
});

describe('M22: stallStages derives the six booleans from a resolved arming', () => {
  it('the busy gate is on under busy and busy-shadow, and busy delivery under busy alone', () => {
    expect(stallStages(box(LIVE, SHADOW))).toEqual({ runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false });
    expect(stallStages(box(LIVE, ESCALATE, W2LIVE, BUSY))).toEqual({ runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true });
    expect(stallStages(box())).toEqual({ runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false });
  });
  it('with mail switched off both mail-gate stages read false; under strict both read false', () => {
    expect(stallStages(box(BUSY, MAIL_OFF))).toMatchObject({ busyDelivery: false, busyGate: false });
    expect(stallStages(box(SHADOW, MAIL_OFF))).toMatchObject({ busyGate: false });
    expect(stallStages(box(STRICT, BUSY))).toMatchObject({ busyDelivery: false, busyGate: false });
  });
  it('the lane stages need the lane running; armedStages reads mail switched off as on', () => {
    expect(stallStages(box(KILL, LIVE, ESCALATE, W2LIVE, BUSY))).toEqual({ runs: false, checks: false, alerts: false, busyDelivery: true, busyGate: true, wave2: false });
    expect(stallStages(box(ESCALATE))).toMatchObject({ checks: false, alerts: false });
    expect(armedStages(box(BUSY, MAIL_OFF))).toMatchObject({ busyDelivery: true, busyGate: true });
  });
});

describe('M30: stallNextStep answers none, top or the next step with the gated stages it waits on', () => {
  it('files with no gate file reading log: a step to check, waiting on checks alone', () => {
    const r = resolveStallWatch(box(), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'check', waitsOn: ['checks'] });
  });
  it('alert steps to deliver, waiting on busy delivery and never on the busy gate', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'deliver', waitsOn: ['busyDelivery'] });
    const off = resolveStallWatch(box(), chosen('off'));
    expect(stallNextStep(off.arming, off.chosen), 'log turns on only the busy gate, which nothing waits on')
      .toEqual({ kind: 'step', level: 'log', waitsOn: [] });
  });
  it('a chosen deliver under strict: none; custom: none; all: top', () => {
    const held = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect(stallNextStep(held.arming, held.chosen)).toEqual({ kind: 'none' });
    const custom = resolveStallWatch(box(ESCALATE), FOLLOW);
    expect(stallNextStep(custom.arming, custom.chosen)).toEqual({ kind: 'none' });
    const all = resolveStallWatch(box(), chosen('all'));
    expect(stallNextStep(all.arming, all.chosen)).toEqual({ kind: 'top' });
  });
  it('a chosen check under strict keeps its reading, so its Next step stands', () => {
    const r = resolveStallWatch(box(STRICT), chosen('check'));
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'alert', waitsOn: ['alerts'] });
  });
  it('mail switched off reads as on: a files-read deliver under mail-disabled still steps to all', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, BUSY, MAIL_OFF), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'all', waitsOn: ['wave2'] });
  });
});

describe('M28 (L1 half): files-exceed compares the sending stages only', () => {
  it('today\'s fleet with a chosen deliver does not exceed; files at alert with a chosen check do', () => {
    const fleet = box(LIVE, SHADOW);
    expect(stallFilesExceed(fleet, resolveStallWatch(fleet, chosen('deliver')))).toBe(false);
    expect(stallFilesExceed(fleet, resolveStallWatch(fleet, chosen('all')))).toBe(false);
    const alert = box(LIVE, ESCALATE);
    expect(stallFilesExceed(alert, resolveStallWatch(alert, chosen('check')))).toBe(true);
    expect(stallFilesExceed(alert, resolveStallWatch(alert, chosen('off')))).toBe(true);
  });
  it('false whenever the files decide', () => {
    for (const names of SUBSETS) {
      const b = box(...names);
      expect(stallFilesExceed(b, resolveStallWatch(b, FOLLOW)), names.join(',')).toBe(false);
    }
  });
  it('reads mail switched off as on: busy files under mail-disabled exceed a chosen alert', () => {
    const b = box(LIVE, ESCALATE, BUSY, MAIL_OFF);
    expect(stallFilesExceed(b, resolveStallWatch(b, chosen('alert')))).toBe(true);
  });
  it('the busy gate is never compared, even in a resolution where only it differs', () => {
    const b = box(LIVE, SHADOW);
    const r = resolveStallWatch(b, chosen('check'));
    expect(stallFilesExceed(b, { ...r, arming: { ...r.arming, mailMode: 'shell' } })).toBe(false);
  });
});

// ── the write path: decide, the projection, the effect and its key, the feed change ──────────────────────────────

describe('decideStallSettings: refuses, never clamps (§10 step 2; the decide halves of M10, M11b and M14)', () => {
  const refused = (body: unknown): string => {
    const d = decideStallSettings(body);
    if (d.ok) throw new Error(`accepted ${JSON.stringify(body)}`);
    return d.detail;
  };
  it('a body that is not an object is refused', () => {
    for (const b of [null, undefined, 'log', 3, [], ['level']]) expect(refused(b), String(b)).toBe('body must be an object');
  });
  it('M14: an unknown key is refused and named in the detail, even beside a valid field (departure unknown-keys-refused)', () => {
    expect(refused({ level: 'check', quietTime: 3 * H })).toBe('unknown key quietTime: a write names only level, quietMs and confirm');
    expect(refused({ foo: 1 })).toContain('foo');
    expect(refused(JSON.parse('{"__proto__": 1, "level": "log"}'))).toContain('__proto__');
  });
  it('M14: a body naming neither level nor quietMs is refused, a confirm alone included', () => {
    expect(refused({})).toBe('at least one of level or quietMs must be given');
    expect(refused({ confirm: '0badc0de' })).toBe('at least one of level or quietMs must be given');
  });
  it('M11b: a level that is not a StallLevelChoice is refused, the prototype names included', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'custom', 'Follow', '', 3, null]) {
      expect(refused({ level: v }), String(v)).toBe('level must be follow or one of off, log, check, alert, deliver, all');
    }
  });
  it('M10: a quiet time off the range or off the step is refused, naming the field, the range and the step', () => {
    for (const v of [29 * MIN, 45 * MIN, 12 * H + 30 * MIN, 0, 1_800_000.5, '1800000', null, 'built-in', 1_800_000n]) {
      expect(refused({ quietMs: v }), String(v))
        .toBe("quietMs must be 'default' or a whole number of milliseconds from 1800000 to 43200000 in steps of 1800000");
    }
  });
  it('M10: the bounds and every step between are accepted exactly as sent; default is the built-in', () => {
    for (let v = STALL_QUIET_MIN_MS; v <= STALL_QUIET_MAX_MS; v += STALL_QUIET_STEP_MS) {
      expect(decideStallSettings({ quietMs: v }), String(v)).toEqual({ ok: true, patch: { quiet: { kind: 'set', ms: v } }, confirm: null });
    }
    expect(decideStallSettings({ quietMs: 'default' })).toEqual({ ok: true, patch: { quiet: { kind: 'default' } }, confirm: null });
  });
  it('a confirm must be a string; it passes through, and reads null when the body carries none', () => {
    expect(refused({ level: 'log', confirm: 1 })).toBe('confirm must be a string');
    expect(refused({ level: 'log', confirm: null })).toBe('confirm must be a string');
    expect(decideStallSettings({ level: 'all', quietMs: 'default', confirm: '0badc0de' }))
      .toEqual({ ok: true, patch: { level: 'all', quiet: { kind: 'default' } }, confirm: '0badc0de' });
    for (const level of ['follow', ...STALL_LEVELS]) {
      expect(decideStallSettings({ level }), level).toEqual({ ok: true, patch: { level }, confirm: null });
    }
  });
});

const AT = 1_790_000_100_000;

describe('stallSettingsAfter: the read the store\'s write will leave (§8; the L1 half of M12d)', () => {
  it('an absent row takes the insert arm: the seed, overridden by the named fields, stamped at the write', () => {
    expect(stallSettingsAfter({ kind: 'absent' }, { quiet: { kind: 'set', ms: 3 * H } }, AT)).toEqual(rowRead('follow', 3 * H, AT));
    expect(stallSettingsAfter({ kind: 'absent' }, { level: 'check' }, AT)).toEqual(rowRead('check', null, AT));
    expect(stallSettingsAfter({ kind: 'absent' }, { level: 'follow', quiet: { kind: 'default' } }, AT)).toEqual(rowRead('follow', null, AT));
  });
  it('a row takes the update arm: the named fields over the stored ones, the other kept as stored, unreadable included', () => {
    expect(stallSettingsAfter(rowRead('constructor', 1_800_000n, 5), { quiet: { kind: 'default' } }, AT)).toEqual(rowRead('constructor', null, AT));
    expect(stallSettingsAfter(rowRead('all', 45 * MIN, 5), { level: 'log' }, AT)).toEqual(rowRead('log', 45 * MIN, AT));
    expect(stallSettingsAfter(rowRead('all', 45 * MIN, 5), { level: 'off', quiet: { kind: 'set', ms: 12 * H } }, AT)).toEqual(rowRead('off', 12 * H, AT));
  });
  it('a no-op leaves the read as it is, updatedAt included; a stored bigint quiet time compares as a number', () => {
    const before = rowRead('check', 3_600_000n, 5);
    expect(stallSettingsAfter(before, { level: 'check', quiet: { kind: 'set', ms: H } }, AT)).toBe(before);
    const seed = rowRead('follow', null, 0);
    expect(stallSettingsAfter(seed, { level: 'follow', quiet: { kind: 'default' } }, AT)).toBe(seed);
    expect(stallSettingsAfter(seed, { quiet: { kind: 'default' } }, AT)).toBe(seed);
  });
  it('an unreadable read is returned unchanged: nothing is written over it', () => {
    const u: StallSettingsRead = { kind: 'unreadable', detail: 'no such table: stall_settings' };
    expect(stallSettingsAfter(u, { level: 'all' }, AT)).toBe(u);
  });
  it('stallPatchIsNoOp compares the named fields only, after the bigint conversion, with NULL for default', () => {
    const row = { level: 'check', quietMs: 3_600_000n, updatedAt: 5 };
    expect(stallPatchIsNoOp(row, { level: 'check' })).toBe(true);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'set', ms: H } })).toBe(true);
    expect(stallPatchIsNoOp(row, { level: 'check', quiet: { kind: 'set', ms: H } })).toBe(true);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'default' } })).toBe(false);
    expect(stallPatchIsNoOp(row, { level: 'follow' })).toBe(false);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'set', ms: 2 * H } })).toBe(false);
    expect(stallPatchIsNoOp({ level: 'follow', quietMs: null, updatedAt: 0 }, { quiet: { kind: 'default' } })).toBe(true);
    expect(stallPatchIsNoOp({ level: 'toString', quietMs: 'x', updatedAt: 0 }, { level: 'log' })).toBe(false);
  });
});

/** The effect of writing `patch` over `before` on the box `names` lists, composed as the route composes it (§10 step 4). */
const effectOf = (names: string[], before: StallSettingsRead, patch: StallSettingsPatch) =>
  stallWriteEffect(box(...names), stallUnheldBoxOf(names), before, stallSettingsAfter(before, patch, AT));
const STAGES_OFF = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };

describe('M26: stallWriteEffect and stallNeedsConfirm, the server deciding the confirm (§10)', () => {
  it('a stage turning on: Follow on today\'s fleet to Everything, the whole effect', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'all' });
    expect(e).toEqual({
      measured: true, turnsOn: ['alerts', 'busyDelivery', 'wave2'], turnsOff: [], leavesWave2: false, heldByBox: false,
      quietLowered: false, filesExceed: false,
      before: { ...STAGES_OFF, checks: true, busyGate: true },
      after: { runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true },
      quietMs: { before: STALL_QUIET_MS, after: STALL_QUIET_MS }, mailOff: false,
    });
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('the busy gate turning on counts: Follow over a box with no files to Check', () => {
    const e = effectOf([], rowRead('follow'), { level: 'check' });
    expect(e.turnsOn).toEqual(['checks', 'busyGate']);
    expect(stallNeedsConfirm(e)).toBe(true);
    expect(stallNeedsConfirm(effectOf([], rowRead('follow'), { level: 'log' }))).toBe(true);
  });
  it('leaving the further checks: Everything to Alert stops busy delivery and the further checks', () => {
    const e = effectOf([], rowRead('all'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff, e.leavesWave2, e.heldByBox]).toEqual([[], ['busyDelivery', 'wave2'], true, false]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('a quiet time brought below the current one needs one; a raise does not, even below the built-in (departure quiet-raise-asks-nothing)', () => {
    const lower = effectOf([], rowRead('check', 4 * H), { quiet: { kind: 'set', ms: 3 * H } });
    expect([lower.quietLowered, lower.quietMs]).toEqual([true, { before: 4 * H, after: 3 * H }]);
    expect(stallNeedsConfirm(lower)).toBe(true);
    const underBuiltIn = effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'set', ms: H } });
    expect([underBuiltIn.quietLowered, stallNeedsConfirm(underBuiltIn)], 'a raise that stays below the built-in').toEqual([false, false]);
    expect(effectOf([], rowRead('check'), { quiet: { kind: 'set', ms: H } }).quietLowered).toBe(true);
    const raise = effectOf([], rowRead('check', 3 * H), { quiet: { kind: 'set', ms: 4 * H } });
    expect([raise.quietLowered, stallNeedsConfirm(raise)]).toEqual([false, false]);
    expect(effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'set', ms: 30 * MIN } }).quietLowered, 'the same value').toBe(false);
    expect(effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'default' } }).quietLowered, 'back to the built-in').toBe(false);
  });
  it('an absent row with the files at Check and a write of all: measured against the files', () => {
    const e = effectOf([LIVE, SHADOW], { kind: 'absent' }, { level: 'all' });
    expect(e.turnsOn).toEqual(['alerts', 'busyDelivery', 'wave2']);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('a stored all with an unreadable quiet time and a quiet write of 3 h: the stored level comes into force', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('all', 45 * MIN), { quiet: { kind: 'set', ms: 3 * H } });
    expect([e.turnsOn, e.quietLowered]).toEqual([['alerts', 'busyDelivery', 'wave2'], false]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('an unreadable level with a stored 30 min and a write of Follow: the stored quiet time comes into force', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('constructor', 30 * MIN), { level: 'follow' });
    expect([e.turnsOn, e.quietLowered, e.quietMs]).toEqual([[], true, { before: STALL_QUIET_MS, after: 30 * MIN }]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('mail-disabled is ignored for the diff: Alert to Deliver turns busy delivery on, and mailOff is reported', () => {
    const e = effectOf([MAIL_OFF], rowRead('alert'), { level: 'deliver' });
    expect([e.turnsOn, e.heldByBox, e.mailOff]).toEqual([['busyDelivery'], false, true]);
    expect(e.after.busyDelivery, 'the resolved reading with mail off read as on').toBe(true);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('the kill file with Check chosen and a write of all: confirmed through the unheld reading, heldByBox', () => {
    const e = effectOf([KILL, LIVE, SHADOW], rowRead('check'), { level: 'all' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox]).toEqual([['alerts', 'busyDelivery', 'wave2'], [], true]);
    expect(e.before).toEqual(e.after);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('strict with Alert chosen and a write of deliver: busy delivery turns on through the unheld reading, heldByBox', () => {
    const e = effectOf([STRICT], rowRead('alert'), { level: 'deliver' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox]).toEqual([['busyDelivery'], [], true]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('leaving the further checks under the kill file is held too: leavesWave2 from the unheld reading alone', () => {
    const e = effectOf([KILL], rowRead('all'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff, e.leavesWave2, e.heldByBox]).toEqual([[], [], true, true]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('neither needs one: a pure lowering, and Deliver to Alert over a box busy-shadow file', () => {
    const lower = effectOf([], rowRead('alert'), { level: 'check' });
    expect([lower.turnsOn, lower.turnsOff, lower.leavesWave2, lower.quietLowered]).toEqual([[], ['alerts'], false, false]);
    expect(stallNeedsConfirm(lower)).toBe(false);
    const deliver = effectOf([SHADOW], rowRead('deliver'), { level: 'alert' });
    expect([deliver.turnsOn, deliver.turnsOff]).toEqual([[], ['busyDelivery']]);
    expect(stallNeedsConfirm(deliver)).toBe(false);
  });
  it('Off over a box busy file hands busy delivery back: it turns on in the resolved reading with the watch off (§15)', () => {
    const e = effectOf([LIVE, BUSY], rowRead('check'), { level: 'off' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox, e.after.runs]).toEqual([['busyDelivery'], ['checks'], false, false]);
  });
  it('a level below Deliver over busy files armed by hand stops busy delivery; turnsOff is in §5.1 order (§20)', () => {
    const e = effectOf([LIVE, BUSY], rowRead('follow'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff]).toEqual([['alerts'], ['busyDelivery']]);
    const down = effectOf([LIVE, ESCALATE, BUSY], rowRead('follow'), { level: 'log' });
    expect(down.turnsOff).toEqual(['checks', 'alerts', 'busyDelivery']);
  });
  it('M28 (the effect\'s after state): filesExceed is read over the resolution the write leaves', () => {
    expect(effectOf([LIVE, ESCALATE], rowRead('follow'), { level: 'check' }).filesExceed).toBe(true);
    expect(effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'deliver' }).filesExceed).toBe(false);
    expect(effectOf([LIVE, ESCALATE], rowRead('check'), { level: 'follow' }).filesExceed).toBe(false);
  });
  it('the unmeasured effect always needs the confirm', () => {
    expect(stallNeedsConfirm({ measured: false })).toBe(true);
  });
});

describe('the L1 half of M27: stallEffectKey ties the confirm to the effect and the row', () => {
  /** A reference FNV-1a, 32-bit, over UTF-16 code units, written apart from the shipped one; its CONTROL row pins
   *  the published test vectors. */
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  const effect = () => effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'all' });
  it('CONTROL: the reference hash answers the published FNV-1a vectors', () => {
    expect([fnv(''), fnv('a'), fnv('foobar')]).toEqual(['811c9dc5', 'e40c292c', 'bf9cf968']);
  });
  it('is eight hex characters of FNV-1a over the effect\'s JSON and the before-row\'s updatedAt', () => {
    const e = effect();
    expect(stallEffectKey(e, 5)).toMatch(/^[0-9a-f]{8}$/);
    expect(stallEffectKey(e, 5)).toBe(fnv(`${JSON.stringify(e)}@5`));
    expect(stallEffectKey({ measured: false }, null)).toBe(fnv('{"measured":false}@none'));
  });
  it('a write between the 409 and the re-POST changes the key even when the effect reads the same', () => {
    const e = effect();
    expect(stallEffectKey(e, 5)).not.toBe(stallEffectKey(e, 6));
    expect(stallEffectKey(e, null)).not.toBe(stallEffectKey(e, 0));
    expect(stallEffectKey(e, 5)).toBe(stallEffectKey(effect(), 5));
  });
  it('a different effect gives a different key over the same row', () => {
    const e = effect();
    const other: StallWriteEffect = effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'deliver' });
    expect(stallEffectKey(other, 5)).not.toBe(stallEffectKey(e, 5));
  });
});

describe('stallSettingsChange: the feed body, level and quiet time only, from L0 labels (§10 step 6)', () => {
  const after = (level: unknown, quietMs: unknown = null) => rowRead(level, quietMs, AT);
  it('names both fields when both change', () => {
    expect(stallSettingsChange(rowRead('follow'), after('check', 3 * H)))
      .toBe("level: Follow the fleet box's files → Check silent workers; quiet time: 2 h (built-in) → 3 h");
    expect(STALL_FOLLOW_LABEL).toBe("Follow the fleet box's files");
  });
  it('names only what changed, and formats half hours', () => {
    expect(stallSettingsChange(rowRead('check', 3 * H), after('check', 150 * MIN))).toBe('quiet time: 3 h → 2 h 30 min');
    expect(stallSettingsChange(rowRead('check', 3 * H), after('check', 30 * MIN))).toBe('quiet time: 3 h → 30 min');
    expect(stallSettingsChange(rowRead('check', 3 * H), after('all', 3 * H))).toBe('level: Check silent workers → Everything');
  });
  it('a no-op is null: updatedAt alone never counts, and a bigint meets its number', () => {
    expect(stallSettingsChange(rowRead('check', 3 * H, 5), after('check', 3 * H))).toBeNull();
    expect(stallSettingsChange(rowRead('check', 10_800_000n, 5n), after('check', 3 * H))).toBeNull();
    expect(stallSettingsChange(rowRead('follow', null, 0), rowRead('follow', null, 0))).toBeNull();
  });
  it('M15b: a non-row before is named, never undefined: a lost row restored by a quiet-only write', () => {
    expect(stallSettingsChange({ kind: 'absent' }, stallSettingsAfter({ kind: 'absent' }, { quiet: { kind: 'set', ms: 3 * H } }, AT)))
      .toBe("level: no stored choice → Follow the fleet box's files; quiet time: no stored choice → 3 h");
  });
  it('an unreadable stored field is named as unreadable', () => {
    expect(stallSettingsChange(rowRead('constructor', 3 * H), after('all', 3 * H))).toBe('level: unreadable stored level → Everything');
    expect(stallSettingsChange(rowRead('all', 45 * MIN), after('all', null))).toBe('quiet time: unreadable stored quiet time → 2 h (built-in)');
    expect(stallSettingsChange({ kind: 'unreadable', detail: 'x' }, after('off')))
      .toBe('level: unreadable stored level → Off; quiet time: unreadable stored quiet time → 2 h (built-in)');
  });
  it('never prints undefined, null or NaN over every level, quiet time and before kind', () => {
    const befores: StallSettingsRead[] = [{ kind: 'absent' }, { kind: 'unreadable', detail: 'x' }, rowRead('toString', 1.5)];
    for (const b of befores) {
      for (const level of ['follow', ...STALL_LEVELS]) {
        for (const q of [null, 30 * MIN, 12 * H]) {
          const body = stallSettingsChange(b, after(level, q));
          expect(body, `${b.kind} ${level} ${String(q)}`).not.toBeNull();
          expect(body!).not.toMatch(/undefined|null|NaN|\[object/);
        }
      }
    }
  });
});

describe('M17 and M17b: stallNoticeCounts tallies by role, live and shadow apart, skipping what it cannot name', () => {
  /** The spec's role table (§11), written out by hand, apart from the shipped derivation. */
  const ROLE: Record<StallArm, readonly (keyof typeof STALL_NOTICE_TEXT)[]> = {
    quiet: ['checks', 'reports', 'pushes'],
    'limit-cap': ['pushes'], 'dialog-cap': ['pushes'], 'coord-ball': ['pushes'],
    'coord-deaf': ['pushes'], 'mail-stuck': ['pushes'], 'marker-unreadable': ['pushes'],
    'orphan-d': ['wakes', 'pushes'],
    'orphan-e': ['wakes'],
    failed: ['wakes', 'reports'],
    frozen: ['reports'], dead: ['reports'],
  };
  const row = (mode: 'live' | 'shadow', arm: StallArm, rung: 1 | 2 | 3, key = 7) => ({ at: AT, detail: stallDetail(mode, arm, rung, key) });
  const zero = Object.keys(STALL_NOTICE_TEXT).map((r) => ({ row: r, sent: 0, shadow: 0 }));
  it('no rows: the four rows in L0 key order, zeros included', () => {
    expect(stallNoticeCounts([])).toEqual(zero);
    expect(zero.map((z) => z.row)).toEqual(['checks', 'wakes', 'reports', 'pushes']);
  });
  it('the spec examples: quiet rung 1 is checks, orphan E rung 1 wakes, frozen rung 1 reports, dialog cap pushes', () => {
    const counts = stallNoticeCounts([row('live', 'quiet', 1), row('shadow', 'quiet', 1), row('shadow', 'quiet', 1, 8),
      row('live', 'orphan-e', 1), row('shadow', 'frozen', 1), row('live', 'dialog-cap', 1)]);
    expect(counts).toEqual([
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 1, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 1 }, { row: 'pushes', sent: 1, shadow: 0 },
    ]);
  });
  it('every rung of every arm lands in its role\'s row, in its mode\'s column', () => {
    expect(Object.keys(ROLE).sort()).toEqual([...STALL_ARMS].sort());
    for (const arm of STALL_ARMS) {
      ROLE[arm].forEach((role, i) => {
        const rung = (i + 1) as 1 | 2 | 3;
        for (const mode of ['live', 'shadow'] as const) {
          const got = stallNoticeCounts([row(mode, arm, rung)]);
          const want = zero.map((z) => z.row === role ? { ...z, [mode === 'live' ? 'sent' : 'shadow']: 1 } : z);
          expect(got, `${mode} ${arm} ${rung}`).toEqual(want);
        }
      });
    }
  });
  it('a row that is not a stall detail of this build is skipped: transitions, routing, malformed, null', () => {
    const three = stallDetail('live', 'quiet', 1, 5).split(':').slice(0, 3).join(':');
    const rows = [{ at: AT, detail: 'dispatched->working' }, { at: AT, detail: null }, { at: AT, detail: three },
      { at: AT, detail: `${three}:x` }, { at: AT, detail: stallDetail('live', 'quiet', 1, 5).replace('quiet', 'quieter') }];
    expect(stallNoticeCounts(rows)).toEqual(zero);
  });
  it('M17b: a rung the arm lacks is skipped, never thrown on', () => {
    const planted = [row('live', 'dialog-cap', 2), row('shadow', 'orphan-e', 3), row('live', 'frozen', 2)];
    expect(() => stallNoticeCounts(planted)).not.toThrow();
    expect(stallNoticeCounts([...planted, row('live', 'dialog-cap', 1)])).toEqual(zero.map((z) => z.row === 'pushes' ? { ...z, sent: 1 } : z));
  });
  it('stallArmHasRung is total, and answers exactly where rungRecipient does not throw', () => {
    for (const arm of STALL_ARMS) {
      for (const rung of [1, 2, 3] as const) {
        let throws = false;
        try { rungRecipient(arm, rung); } catch { throws = true; }
        expect(stallArmHasRung(arm, rung), `${arm} ${rung}`).toBe(!throws);
        expect(stallArmHasRung(arm, rung), `${arm} ${rung}`).toBe(ROLE[arm][rung - 1] !== undefined);
      }
    }
    expect([stallArmHasRung('dialog-cap', 2), stallArmHasRung('quiet', 3), stallArmHasRung('orphan-d', 2)]).toEqual([false, true, true]);
  });
});

// ── source scans ─────────────────────────────────────────────────────────────────────────────────────────────────

const L1_FILE = path.join(ccrcRoot, 'server', 'src', 'coord', 'stallsettings.ts');

describe('M19 control: the new files sit inside single-definition.test.ts\'s four walked roots', () => {
  // `ROOTS` there is module-local, so this row re-walks the same four roots the same way, `__`-prefixed transients
  // skipped as that walk skips them, and asserts every file this programme adds is found.
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    if (e.startsWith('__')) return [];
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
  it('finds shared/api.ts and server/src/coord/stallsettings.ts', () => {
    const all = ROOTS.flatMap(walk).map((f) => path.relative(ccrcRoot, f).split(path.sep).join('/'));
    expect(all.length).toBeGreaterThan(100);
    for (const f of ['shared/api.ts', 'server/src/coord/stallsettings.ts']) expect(all, f).toContain(f);
  });
});

describe('M19b: stallsettings.ts is the pure L1 module its docstring says it is', () => {
  const SRC = readFileSync(L1_FILE, 'utf8');
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  // `stall-vocabulary.test.ts`'s shapes, copied with its CONTROL: either quote, a second import behind a first.
  const NODE_BUILTIN = /\bfrom\s*['"]node:/;
  const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]/m;
  const RE_EXPORT = /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\b/m;
  const valueImportSpecifiers = (c: string): string[] =>
    [...c.matchAll(/^\s*import\s+(type\s+)?[^'"]*?\bfrom\s*(['"])([^'"]+)\2/gm)]
      .filter((m) => m[1] === undefined).map((m) => m[3]!);
  const ALLOWED = ['../../../shared/api.js', './stall.js', '../turnidle.js'];

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function resolveStallWatch');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });
  it('CONTROL: the scans see either quote, a db.js value import and a second import behind a first', () => {
    expect(NODE_BUILTIN.test(`import { readFileSync } from "node:fs";`)).toBe(true);
    expect(NODE_BUILTIN.test(`import { x } from '../../../shared/api.js';`)).toBe(false);
    expect(SIDE_EFFECT_IMPORT.test(`import "./db.js";`)).toBe(true);
    expect(RE_EXPORT.test(`export * from './db.js';`)).toBe(true);
    expect(valueImportSpecifiers(`import { openCoordDb } from "./db.js";\nimport { x } from './stall.js';`)).toEqual(['./db.js', './stall.js']);
    expect(valueImportSpecifiers(`import type { CoordDb } from './db.js';`)).toEqual([]);
  });
  it('has no clock', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|performance\s*\.\s*now|\bnew\s+Date\b|(?<!\bnew\s+)\bDate\s*\(/);
  });
  it('has no fs, no node builtin, no require and no dynamic import', () => {
    expect(code()).not.toMatch(NODE_BUILTIN);
    expect(code()).not.toMatch(/\bfs\s*\.|\brequire\s*\(|\bimport\s*\(/);
  });
  it('has no fastify, no reply and no store handle', () => {
    expect(code()).not.toMatch(/\breply\s*\.|\bFastify|\bapp\s*\./);
    expect(code()).not.toMatch(/\bcoord\s*\.|\bstore\s*\.|\bdb\s*\.|\.prepare\s*\(/);
  });
  it('takes value imports only from L0, stall.ts and turnidle.ts; anything else is a type import', () => {
    const c = code();
    expect(c).not.toMatch(SIDE_EFFECT_IMPORT);
    expect(c).not.toMatch(RE_EXPORT);
    const specs = valueImportSpecifiers(c);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(ALLOWED, `stallsettings.ts takes a value import from ${spec}`).toContain(spec);
  });
});

describe('the kebab words stallsettings.ts spells are declared through isStallSettingsKebab (§10, M18)', () => {
  it('declares its three words, and only those', () => {
    for (const w of ['busy-shadow', 'confirm-required', 'flag-off']) expect(isStallSettingsKebab(w), w).toBe(true);
    for (const w of ['busy', 'stall-shadow', 'not-configured', 'flag-on']) expect(isStallSettingsKebab(w), w).toBe(false);
  });
  it('every quoted kebab word on a code line of stallsettings.ts is one of them', () => {
    const lines = readFileSync(L1_FILE, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    const words = [...lines.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map((m) => m[1]!);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(isStallSettingsKebab(w), w).toBe(true);
  });
});

// Type-level: the ladder and the texts are one key set (a level added to one Record and not the other is a compile
// error, §5). This line fails `tsc -p test/tsconfig.tests.json` if the two key sets ever differ.
const _ladderKeys: Record<StallLevel, true> = Object.fromEntries(Object.keys(STALL_LADDER).map((k) => [k, true])) as Record<keyof typeof STALL_LADDER, true>;
void _ladderKeys;
// Type-level: `StallStored`'s failure words are exactly `ReadFailure`, in both directions (the `STAMP_READS` idiom).
// A third read-failure word added in `shared/agent-protocol.ts`, or a word dropped here, fails the typecheck.
type _Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _storedIsReadFailure: _Same<Exclude<StallStored, 'row'>, ReadFailure> = true;
void _storedIsReadFailure;
