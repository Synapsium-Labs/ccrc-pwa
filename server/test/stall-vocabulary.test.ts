// The stall watch's vocabulary (design 2026-09-29 §4.2, wave 1, plan Task 4). This is the pure half, with no store
// in the room. The file pins:
// - the prefixes, spelled as the spec spells them;
// - which marker arms which recipient;
// - the observation detail's round trip, and the details it refuses;
// - the grouping of overlapping runs;
// - the push classifier's binding rule;
// - the kebab guard;
// - that stall.ts is the L1 module its docstring says it is.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT } from '../../shared/api.js';
import {
  STALL_ARMS, STALL_CHECK_PREFIX, STALL_HOLDS, STALL_MARKERS, STALL_READ_FAILURES, STALL_REPLY_PREFIX,
  STALL_REPLY_WAITING_PREFIX, STALL_REPORT_PREFIX, STALL_WAIT_PREFIX, STALL_WRITE_MISSES,
  isStallKebab, parseStallDetail, stallArmingOf, stallDelivery, stallDetail, stallMailClass, stallSubjects,
  type StallArming, type StallBind, type StallRunRow,
} from '../src/coord/stall.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = 1_790_000_000_000;

describe('the prefixes are the spec’s spelling', () => {
  it('spells each prefix as §4.2 does', () => {
    expect(STALL_CHECK_PREFIX).toBe('stall-check:');
    expect(STALL_REPLY_PREFIX).toBe('re stall-check:');
    expect(STALL_REPLY_WAITING_PREFIX).toBe('re stall-check: waiting');
    expect(STALL_REPORT_PREFIX).toBe('stall:');
    expect(STALL_WAIT_PREFIX).toBe('wait:');
  });

  it('a waiting reply is a reply, and no watch prefix is a prefix of another class', () => {
    expect(STALL_REPLY_WAITING_PREFIX.startsWith(STALL_REPLY_PREFIX)).toBe(true);
    expect(STALL_CHECK_PREFIX.startsWith(STALL_REPORT_PREFIX)).toBe(false);
    expect(STALL_REPLY_PREFIX.startsWith(STALL_CHECK_PREFIX)).toBe(false);
    expect(STALL_REPLY_PREFIX.startsWith(STALL_REPORT_PREFIX)).toBe(false);
  });
});

describe('REVIEW_DONE_SUBJECT', () => {
  it('is the subject the reviewer skill tells a reviewer to send, and is not the wave-done subject', () => {
    const skill = readFileSync(path.join(here, '..', '..', 'ccd', 'reviewer-skill', 'SKILL.md'), 'utf8');
    expect(REVIEW_DONE_SUBJECT).toBe('review-done');
    expect(skill).toContain(`"subject":"${REVIEW_DONE_SUBJECT}"`);
    expect(REVIEW_DONE_SUBJECT).not.toBe(WAVE_DONE_SUBJECT);
  });
});

describe('the arms, holds and markers are derived from their Records', () => {
  it('wave 1 has four arms', () => {
    expect(STALL_ARMS).toEqual(['quiet', 'limit-cap', 'dialog-cap', 'coord-ball']);
  });
  it('wave 1 has nine holds', () => {
    expect(STALL_HOLDS).toEqual([
      'run-unnamed', 'absent', 'unmeasured', 'lifecycle', 'ask', 'dialog', 'limit', 'busy', 'coordinator-unmeasurable',
    ]);
  });
  it('the lane reads three markers', () => {
    expect(STALL_MARKERS).toEqual(['stall-watch-disabled', 'stall-watch-live', 'stall-watch-escalate']);
  });
});

describe('stallArmingOf reads one registry listing', () => {
  it('arms nothing when no marker is listed', () => {
    expect(stallArmingOf(['demo-worker.uuid', 'mail-disabled', 'coordinator-paused']))
      .toEqual({ disabled: false, live: false, escalate: false });
  });
  it('reads each marker on its own', () => {
    expect(stallArmingOf(['stall-watch-disabled'])).toEqual({ disabled: true, live: false, escalate: false });
    expect(stallArmingOf(['stall-watch-live'])).toEqual({ disabled: false, live: true, escalate: false });
    expect(stallArmingOf(['stall-watch-escalate'])).toEqual({ disabled: false, live: false, escalate: true });
  });
  it('matches a whole file name, never a prefix or a suffix', () => {
    expect(stallArmingOf(['stall-watch-live.bak', 'stall-watch', 'x-stall-watch-escalate']))
      .toEqual({ disabled: false, live: false, escalate: false });
  });
});

describe('stallDelivery: the worker hears under live; a coordinator or the operator needs live AND escalate', () => {
  const A = (live: boolean, escalate: boolean): StallArming => ({ disabled: false, live, escalate });
  it.each([
    ['worker', A(false, false), 'shadow'], ['worker', A(false, true), 'shadow'],
    ['worker', A(true, false), 'send'], ['worker', A(true, true), 'send'],
    ['coordinator', A(false, false), 'shadow'], ['coordinator', A(true, false), 'shadow'],
    ['coordinator', A(false, true), 'shadow'], ['coordinator', A(true, true), 'send'],
    ['operator', A(false, false), 'shadow'], ['operator', A(true, false), 'shadow'],
    ['operator', A(false, true), 'shadow'], ['operator', A(true, true), 'send'],
  ] as const)('%s under %o → %s', (to, arming, want) => {
    expect(stallDelivery(to, arming)).toBe(want);
  });
});

describe('stallDetail and parseStallDetail', () => {
  it('writes the spec’s shape, live and shadow', () => {
    expect(stallDetail('live', 'quiet', 1, T0)).toBe(`stall:quiet:1:${T0}`);
    expect(stallDetail('shadow', 'limit-cap', 1, 5)).toBe('stall-shadow:limit-cap:1:5');
  });

  it('reads back every arm, rung and mode it writes', () => {
    for (const mode of ['live', 'shadow'] as const) {
      for (const arm of STALL_ARMS) {
        for (const rung of [1, 2, 3] as const) {
          expect(parseStallDetail(stallDetail(mode, arm, rung, T0))).toEqual({ mode, arm, rung, key: T0 });
        }
      }
    }
  });

  it('refuses to write a key it could not read back (a rung never counted done would be sent on every tick)', () => {
    for (const key of [Number.NaN, 1.5, -1, 2 ** 53, Number.POSITIVE_INFINITY]) {
      expect(() => stallDetail('live', 'quiet', 1, key), String(key)).toThrow(RangeError);
    }
  });

  it.each([
    null, '', 'arm:work:opus', 'route:x', 'stall', 'stall:quiet:1', `stall:quiet:1:${T0}:x`,
    `stalls:quiet:1:${T0}`, `STALL:quiet:1:${T0}`, `stall:orphan-d:1:${T0}`, `stall:__proto__:1:${T0}`,
    `stall:quiet:0:${T0}`, `stall:quiet:4:${T0}`, 'stall:quiet:1:01', 'stall:quiet:1:1.5', 'stall:quiet:1:-1',
    'stall:quiet:1:99999999999999999999', 'stall:quiet:1:', `stall-shadow:quiet:x:${T0}`,
  ])('ignores %j: not a stall detail', (detail) => {
    expect(parseStallDetail(detail)).toBeNull();
  });
});

const row = (id: number, sessionId: string, dispatchedAt: number | null): StallRunRow => ({
  id, kind: 'work', state: 'working', sessionId, claimedBy: 'demo-coordinator', dispatchedAt,
  program: 'demo-program', wave: 1, waveOf: 2, project: 'demo', workspace: sessionId.replace(/^demo-/, ''),
});

describe('stallSubjects groups by worker and judges the most recently dispatched run', () => {
  it('two overlapping runs on one session (runs 29 and 31): one subject, primary 31, both runs carried', () => {
    const r29 = row(29, 'demo-worker', T0);
    const r31 = row(31, 'demo-worker', T0 + 8 * 3_600_000);
    const r40 = row(40, 'demo-calm-mesa', T0);
    expect(stallSubjects([r29, r40, r31])).toEqual([
      { primary: r31, runs: [r29, r31] },
      { primary: r40, runs: [r40] },
    ]);
  });
  it('a never-dispatched run ranks below every dispatched one', () => {
    const late = row(50, 'demo-w', null);
    const early = row(49, 'demo-w', T0);
    expect(stallSubjects([late, early])[0]!.primary).toBe(early);
  });
  it('a dispatch-time tie goes to the greater id', () => {
    const a = row(60, 'demo-w', T0);
    const b = row(61, 'demo-w', T0);
    expect(stallSubjects([a, b])[0]!.primary).toBe(b);
    expect(stallSubjects([b, a])[0]!.primary).toBe(b);
  });
  it('is order-stable: any input order gives the same subjects, runs and primaries', () => {
    const rows = [row(3, 'demo-a', T0), row(1, 'demo-b', T0), row(2, 'demo-a', T0 + 1), row(4, 'demo-b', null)];
    expect(stallSubjects([...rows].reverse())).toEqual(stallSubjects(rows));
    expect(stallSubjects(rows).map((s) => s.primary.id)).toEqual([1, 2]);
  });
  it('an empty candidate read is no subjects', () => {
    expect(stallSubjects([])).toEqual([]);
  });
});

describe('stallMailClass', () => {
  const WORKER = 'demo-worker';
  const bind: StallBind = { runSessionId: WORKER, runId: 67, firstCheckId: 2531 };
  const mail = (fromId: string, subject: string, mailId = 2540, runId: number | null = 67) =>
    ({ fromId, runId, subject, mailId });

  it('a stall check from the operator is check; the same subject from anyone else is ordinary mail', () => {
    expect(stallMailClass(mail('operator', `${STALL_CHECK_PREFIX} run 67 — quiet 2h 0m, owed: reply to #2510`))).toBe('check');
    expect(stallMailClass(mail(WORKER, `${STALL_CHECK_PREFIX} run 67`))).toBeNull();
    expect(stallMailClass(mail('coordinator', `${STALL_CHECK_PREFIX} run 67`))).toBeNull();
  });
  it('a stall report from the operator is report; from anyone else it is ordinary mail', () => {
    expect(stallMailClass(mail('operator', `${STALL_REPORT_PREFIX} run 67`))).toBe('report');
    expect(stallMailClass(mail('demo-coordinator', `${STALL_REPORT_PREFIX} run 67`))).toBeNull();
  });
  it('a bound reply is reply, the waiting reply included', () => {
    expect(stallMailClass(mail(WORKER, `${STALL_REPLY_PREFIX} working on task 4`), bind)).toBe('reply');
    expect(stallMailClass(mail(WORKER, `${STALL_REPLY_WAITING_PREFIX} for the F9 ruling`), bind)).toBe('reply');
  });
  it('an unbound reply is pushed as ordinary mail (the prefix alone keeps nothing off the phone)', () => {
    const reply = `${STALL_REPLY_PREFIX} working`;
    expect(stallMailClass(mail(WORKER, reply)), 'no bind').toBeNull();
    expect(stallMailClass(mail('demo-other', reply), bind), 'another session').toBeNull();
    expect(stallMailClass(mail(WORKER, reply, 2540, 68), bind), 'another run').toBeNull();
    expect(stallMailClass(mail(WORKER, reply, 2540, null), { ...bind, runId: null }), 'a run-less mail').toBeNull();
    expect(stallMailClass(mail(WORKER, reply), { ...bind, runSessionId: null }), 'a run with no worker').toBeNull();
    expect(stallMailClass(mail(WORKER, reply), { ...bind, firstCheckId: null }), 'no check on the run').toBeNull();
    expect(stallMailClass(mail(WORKER, reply, 2531), bind), 'the check itself').toBeNull();
    expect(stallMailClass(mail(WORKER, reply, 2500), bind), 'queued before the first check').toBeNull();
  });
  it('everything else is not the watch’s', () => {
    expect(stallMailClass(mail('demo-coordinator', `${STALL_WAIT_PREFIX} the F9 ruling`), bind)).toBeNull();
    expect(stallMailClass(mail(WORKER, 'wave-done'), bind)).toBeNull();
    expect(stallMailClass(mail('operator', 'ask: 12'), bind)).toBeNull();
  });
});

describe('isStallKebab: every kebab word the watch spells, derived, never a hand list', () => {
  it('admits every arm, hold, marker, read failure and write miss, and the shadow detail head', () => {
    for (const w of [...STALL_ARMS, ...STALL_HOLDS, ...STALL_MARKERS, ...STALL_READ_FAILURES, ...STALL_WRITE_MISSES, 'stall-shadow']) {
      expect(isStallKebab(w), w).toBe(true);
    }
  });
  it('refuses a typo, another vocabulary’s word, a wave-2 word and the empty string', () => {
    for (const w of ['limit-capp', 'stall-watch', 'review-done', 'wave-done-rejected', 'orphan-d', '']) {
      expect(isStallKebab(w), w).toBe(false);
    }
  });
});

describe('stall.ts is the pure L1 module its docstring says it is', () => {
  const SRC = readFileSync(path.join(here, '..', 'src', 'coord', 'stall.ts'), 'utf8');
  /** Comments blanked, positions kept: `coord-caps-policy.test.ts`'s helper. Without it, the docstring (which names
   *  the things it promises not to use) would red every assertion below. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  // The module-boundary scans, kept as named text-level pins so the CONTROL below can plant every shape as text.
  // Either quote, the same one on both ends: a double-quoted specifier is valid TS and would otherwise pass a scan
  // written for single quotes unseen (the fix `single-definition.test.ts` already made for its update ring).
  const NODE_BUILTIN = /\bfrom\s*['"]node:/;
  const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]/m;
  const RE_EXPORT = /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\b/m;
  /** The specifier of every import that is not `import type`. The clause between `import` and `from` holds no quote,
   *  so a match cannot run on into a LATER import's specifier: `[^'"]*?`, never the lazy `[\s\S]*?` that did. */
  const valueImportSpecifiers = (c: string): string[] =>
    [...c.matchAll(/^\s*import\s+(type\s+)?[^'"]*?\bfrom\s*(['"])([^'"]+)\2/gm)]
      .filter((m) => m[1] === undefined).map((m) => m[3]!);

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function stallSubjects');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });
  it('CONTROL: the boundary scans see either quote, every re-export shape and a second import behind a first', () => {
    expect(NODE_BUILTIN.test(`import { readFileSync } from "node:fs";`), 'double-quoted builtin').toBe(true);
    expect(NODE_BUILTIN.test(`import { readFileSync } from 'node:fs';`), 'single-quoted builtin').toBe(true);
    expect(NODE_BUILTIN.test(`import { x } from '../../../shared/api.js';`), 'L0 is no builtin').toBe(false);
    expect(SIDE_EFFECT_IMPORT.test(`import "./claims.js";`), 'double-quoted side effect').toBe(true);
    expect(SIDE_EFFECT_IMPORT.test(`import './claims.js';`), 'single-quoted side effect').toBe(true);
    expect(SIDE_EFFECT_IMPORT.test(`import { x } from './claims.js';`), 'a named import has a clause').toBe(false);
    for (const shape of [
      `export * from './claims.js';`, `export * as claims from './claims.js';`, `export * as claims from "./claims.js";`,
      `export { claimExpiry } from './claims.js';`, `export {\n  a,\n  b,\n} from "./claims.js";`,
      `export type { A } from './claims.js';`, `export type * from './claims.js';`,
    ]) expect(RE_EXPORT.test(shape), shape).toBe(true);
    for (const shape of [`export const x = 1;`, `export type { A };`, `export { a, b };`, `export function f() {}`]) {
      expect(RE_EXPORT.test(shape), shape).toBe(false);
    }
    expect(valueImportSpecifiers(`import { claimExpiry } from "./claims.js";`), 'double-quoted value import')
      .toEqual(['./claims.js']);
    expect(valueImportSpecifiers(`import { claimExpiry } from './claims.js';`), 'single-quoted value import')
      .toEqual(['./claims.js']);
    expect(valueImportSpecifiers(`import * as ns from "./claims.js";`), 'a namespace import').toEqual(['./claims.js']);
    expect(valueImportSpecifiers(`import { claimExpiry } from "./claims.js";\nimport { x } from '../../../shared/api.js';`),
      'a double-quoted import before an L0 one must not hide behind it').toEqual(['./claims.js', '../../../shared/api.js']);
    expect(valueImportSpecifiers(`import type { A } from './claims.js';`), 'a type import is no value import').toEqual([]);
    expect(valueImportSpecifiers(`import type { A } from "./claims.js";\nimport { x } from "../../../shared/api.js";`))
      .toEqual(['../../../shared/api.js']);
  });
  it('has no clock', () => {
    expect(code(), 'stall.ts reads the clock: the verdict is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|performance\s*\.\s*now|(?<!\bnew\s+)\bDate\s*\(/);
  });
  it('builds a Date only to format a measured epoch: every `new Date` is `new Date(<name>).toISOString()`', () => {
    const c = code();
    const every = [...c.matchAll(/\bnew\s+Date\b/g)].length;
    const formatting = [...c.matchAll(/\bnew\s+Date\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\.\s*toISOString\s*\(\s*\)/g)].length;
    expect(formatting, 'stall.ts builds a Date that is not a formatted measured epoch').toBe(every);
  });
  it('has no fs and no other node builtin', () => {
    expect(code(), 'stall.ts imports a node builtin').not.toMatch(NODE_BUILTIN);
    expect(code(), 'stall.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });
  it('has no fastify, no reply, no store, no handle', () => {
    expect(code(), 'stall.ts answers HTTP').not.toMatch(/\breply\s*\.|\bFastify|\bapp\s*\./);
    expect(code(), 'stall.ts reaches the store').not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\.|\bdb\s*\.|\.prepare\s*\(/);
  });
  it('imports values only from shared/api.ts (L0); anything else is a type import', () => {
    const c = code();
    expect(c, 'a side-effect import').not.toMatch(SIDE_EFFECT_IMPORT);
    expect(c, 'a dynamic import').not.toMatch(/\bimport\s*\(/);
    expect(c, 'a re-export').not.toMatch(RE_EXPORT);
    for (const spec of valueImportSpecifiers(c)) {
      expect(spec, `stall.ts takes a value import from ${spec}`).toBe('../../../shared/api.js');
    }
  });
});
