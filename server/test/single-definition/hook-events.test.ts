// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
//
// D-8613: the names of the hook events ccrc's session hook handles are ONE L0 vocabulary, `HookEvent` in
// `shared/hook-events.ts` (ARCH-26's deferred union, #533, unblocked by working-state Task 2, #575). Before it, five
// consumers spelled the names on their own: the stall watch's plumbing list, the fleet's background-carrier set, the
// finished fallback, the interrupt warning, the mail lane's ingestion edge and `sessionBucket`, each against a bare
// `string`, so a misspelt name compiled and matched nothing. The hookstate's `event` field stays an open `string`:
// Claude Code owns the set and grows it between builds, so a read never narrows it; a consumer names an event only
// as a `HookEvent`, through `hookEventIs` or a list typed by the union.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HOOK_EVENTS, hookEventIs, isHookEvent } from '../../../shared/hook-events.js';
import { DELEGATION_EVENT_KINDS } from '../../../shared/api.js';
import { STALL_PLUMBING_EVENTS } from '../../src/coord/stall.js';
import { ALL, ccrcRoot, rel } from './helpers.js';

const HOME = 'shared/hook-events.ts';
const read = (f: string): string => readFileSync(path.join(ccrcRoot, f), 'utf8');
/** A TypeScript line with its `//` tail and any doc-comment line dropped, so prose about an event never counts. */
const code = (t: string): string[] =>
  t.split('\n').filter((l) => !/^\s*(?:\*|\/\*\*?|\/\/)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, ''));

describe('hook events: one L0 vocabulary (D-8613)', () => {
  it('declares HookEvent, HOOK_EVENT_MAP and HOOK_EVENTS once, in shared/hook-events.ts', () => {
    for (const [name, decl] of [
      ['HookEvent', /^\s*export type HookEvent\b/m],
      ['HOOK_EVENT_MAP', /^\s*(?:export\s+)?const HOOK_EVENT_MAP\b/m],
      ['HOOK_EVENTS', /^\s*export const HOOK_EVENTS\b/m],
    ] as const) {
      expect(ALL.filter((f) => decl.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual([HOME]);
    }
  });

  it('DERIVES HOOK_EVENTS from its map, never a hand-written array beside the type', () => {
    expect(read(HOME)).toMatch(/export const HOOK_EVENTS: readonly HookEvent\[\] =\s*\n?\s*Object\.keys\(HOOK_EVENT_MAP\)/);
    expect(read(HOME)).not.toMatch(/HOOK_EVENTS[^=]*=\s*\[/);
  });

  it('is L0: the file imports nothing', () => {
    expect(code(read(HOME)).filter((l) => /^\s*import\b|\brequire\s*\(|\bimport\s*\(/.test(l))).toEqual([]);
  });

  it('round-trips every member, refuses a non-member, and hookEventIs matches one name exactly', () => {
    for (const e of HOOK_EVENTS) expect(isHookEvent(e), e).toBe(true);
    for (const x of ['', 'stop', 'Stop ', 'WorktreeCreate', 'toString', 'constructor', null, undefined, 7]) expect(isHookEvent(x), String(x)).toBe(false);
    expect(hookEventIs('Stop', 'Stop')).toBe(true);
    expect(hookEventIs('StopFailure', 'Stop')).toBe(false);
    expect(hookEventIs(null, 'Stop')).toBe(false);
    expect(hookEventIs(undefined, 'SessionStart')).toBe(false);
  });

  it('the delegation spool kinds and the stall watch plumbing events are hook events', () => {
    expect(DELEGATION_EVENT_KINDS.filter((k) => !isHookEvent(k))).toEqual([]);
    expect(STALL_PLUMBING_EVENTS.filter((k) => !isHookEvent(k))).toEqual([]);
  });

  // The two shapes a local copy took: a bare-literal compare against a hook event field, and a list of event names
  // typed as plain strings. Either compiles with a misspelt name; the union does not.
  const NAMES = HOOK_EVENTS.join('|');
  const BARE_COMPARE = /(?:\.event|\bhookEvent)\s*[!=]==?\s*'|'\s*[!=]==?\s*(?:\w+\.)*(?:event|hookEvent)\b/;
  const STRING_LIST = new RegExp(`(?:readonly string\\[\\]|ReadonlySet<string>|Set<string>|string\\[\\])[^\\n]*=[^\\n]*'(?:${NAMES})'`);

  it('CONTROL: the two scans see the shapes they refuse, and pass the typed ones', () => {
    expect(BARE_COMPARE.test("return hook.event === 'Stop';")).toBe(true);
    expect(BARE_COMPARE.test("if (hookEvent !== 'SessionStart') x();")).toBe(true);
    expect(BARE_COMPARE.test("return hookEventIs(hook.event, 'Stop');")).toBe(false);
    expect(STRING_LIST.test("const S: ReadonlySet<string> = new Set(['Stop', 'SubagentStart']);")).toBe(true);
    expect(STRING_LIST.test("export const P: readonly string[] = ['SessionStart', 'PreCompact'];")).toBe(true);
    expect(STRING_LIST.test("export const P: readonly HookEvent[] = ['SessionStart', 'PreCompact'];")).toBe(false);
  });

  it('no consumer compares a hook event to a bare literal, and none lists event names as plain strings', () => {
    const hits = ALL.filter((f) => rel(f) !== HOME).flatMap((f) =>
      code(readFileSync(f, 'utf8')).filter((l) => BARE_COMPARE.test(l) || STRING_LIST.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });
});
