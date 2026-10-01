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
  RESTART_GRACE_MS, TURN_MARK_STATES, turnMarkGraceUntil, turnMarkStale,
  type StallArming, type StallBind, type StallRunRow,
} from '../src/coord/stall.js';
import {
  STALL_ORPHANED_PREFIX, STALL_FAILED_PREFIX, STOP_FAILURE_ERRORS, STALL_WAKE_KINDS, STALL_RESUMING_KINDS, STALL_PLUMBING_EVENTS,
  STALL_BOUND_MS, DELEGATE_WINDOW_MS, DELEGATE_CAP_MS, FROZEN_NO_EVENT_MS, DEAD_GRACE_MS, COORD_DEAF_MS, MAIL_STUCK_MS,
  ORPHAN_D_IDLE_MS, ORPHAN_E_IDLE_MS, FAILED_IDLE_MS, FAILED_REPEAT_MS, CHECK_UNDELIVERED_MS, BACKLOG_HORIZON_MS,
  ORPHAN_PUSH_MS, MARKER_UNREADABLE_MS,
  rungRecipient, stallFailedSubject, stallFrozenSince, stallNotifyDelivery, stallOrphanDSubject, stallOrphanESubject, stallPushRoute,
  stallDeadShaped, stallMarkUnreadable, stallReportKind, stallReportTitle, stopFailureClass,
  type HookRawFact, type StallArm, type StallRecipient, type TurnMarkRead,
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
  it('waves 1 and 2 have twelve arms, wave 1 first', () => {
    expect(STALL_ARMS).toEqual([
      'quiet', 'limit-cap', 'dialog-cap', 'coord-ball',
      'orphan-d', 'orphan-e', 'failed', 'frozen', 'dead', 'coord-deaf', 'mail-stuck', 'marker-unreadable',
    ]);
  });
  it('waves 1 and 2 have fifteen holds, wave 1 first', () => {
    expect(STALL_HOLDS).toEqual([
      'run-unnamed', 'absent', 'unmeasured', 'lifecycle', 'ask', 'dialog', 'limit', 'busy', 'coordinator-unmeasurable',
      'restart-grace', 'delegates', 'lifecycle-stopped', 'mail-disabled', 'failed-account', 'failed-unknown',
    ]);
  });
  it('the lane reads four markers', () => {
    expect(STALL_MARKERS).toEqual(['stall-watch-disabled', 'stall-watch-live', 'stall-watch-escalate', 'stall-watch-w2-live']);
  });
});

describe('stallArmingOf reads one registry listing', () => {
  it('arms nothing when no marker is listed', () => {
    expect(stallArmingOf(['demo-worker.uuid', 'mail-disabled', 'coordinator-paused']))
      .toEqual({ disabled: false, live: false, escalate: false, w2Live: false });
  });
  it('reads each marker on its own', () => {
    expect(stallArmingOf(['stall-watch-disabled'])).toEqual({ disabled: true, live: false, escalate: false, w2Live: false });
    expect(stallArmingOf(['stall-watch-live'])).toEqual({ disabled: false, live: true, escalate: false, w2Live: false });
    expect(stallArmingOf(['stall-watch-escalate'])).toEqual({ disabled: false, live: false, escalate: true, w2Live: false });
  });
  it('matches a whole file name, never a prefix or a suffix', () => {
    expect(stallArmingOf(['stall-watch-live.bak', 'stall-watch', 'x-stall-watch-escalate']))
      .toEqual({ disabled: false, live: false, escalate: false, w2Live: false });
  });
  it('reads the wave-2 marker on its own, and never sets mailDisabled (the lane does, from watch.ts\'s own marker)', () => {
    expect(stallArmingOf(['stall-watch-w2-live'])).toEqual({ disabled: false, live: false, escalate: false, w2Live: true });
    expect(stallArmingOf(['stall-watch-w2-live.bak', 'stall-watch-w2'])).toEqual({ disabled: false, live: false, escalate: false, w2Live: false });
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
    `stalls:quiet:1:${T0}`, `STALL:quiet:1:${T0}`, `stall:orphan-f:1:${T0}`, `stall:__proto__:1:${T0}`,
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
  it('refuses a typo, another vocabulary’s word, a word no wave spells and the empty string', () => {
    for (const w of ['limit-capp', 'stall-watch', 'review-done', 'wave-done-rejected', 'stall-clause', '']) {
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

// Worker stall watch, wave 2 (spec §5.1): the turn marker port's two judgements. `turnmark.ts` (L3) and the stall
// lane (L1) both judge by these, so each is a table here.
describe('the turn marker port: its state words, staleness and restart grace (worker stall watch wave 2, §5.1)', () => {
  it('names the three state words and the five-minute restart grace', () => {
    expect([...TURN_MARK_STATES]).toEqual(['working', 'done', 'failed']);
    expect(RESTART_GRACE_MS).toBe(5 * 60_000);
  });

  it('turnMarkStale: older than the process only when at AND restartAt (if any) are both before startedAt', () => {
    const S = T0;
    const rows: [string, { at: number; restartAt: number | null }, boolean][] = [
      ['at before, never restarted', { at: S - 1, restartAt: null }, true],
      ['at before, restarted before too', { at: S - 2, restartAt: S - 1 }, true],
      ['at before, restarted AT the process start (rescued)', { at: S - 1, restartAt: S }, false],
      ['at before, restarted after (rescued)', { at: S - 1, restartAt: S + 1 }, false],
      ['at the process start exactly (older means strictly before)', { at: S, restartAt: null }, false],
      ['at after, never restarted', { at: S + 1, restartAt: null }, false],
      ['at after, restarted before', { at: S + 1, restartAt: S - 1 }, false],
    ];
    for (const [name, m, stale] of rows) expect(turnMarkStale(m, S), name).toBe(stale);
  });

  it('turnMarkGraceUntil: restartAt + RESTART_GRACE_MS only when the restart found a turn newer than the last Stop', () => {
    const R = T0;
    const rows: [string, { restartAt: number | null; turnAt: number | null; stopAt: number | null }, number | null][] = [
      ['a turn after the last Stop: cut short', { restartAt: R, turnAt: R - 10, stopAt: R - 100 }, R + RESTART_GRACE_MS],
      ['a turn and never a Stop: cut short', { restartAt: R, turnAt: R - 10, stopAt: null }, R + RESTART_GRACE_MS],
      ['a Stop after the last turn: a clean restart', { restartAt: R, turnAt: R - 100, stopAt: R - 10 }, null],
      ['turn and Stop at the same instant: not newer, so clean', { restartAt: R, turnAt: R - 10, stopAt: R - 10 }, null],
      ['no turn ever, a Stop', { restartAt: R, turnAt: null, stopAt: R - 10 }, null],
      ['no turn and no Stop', { restartAt: R, turnAt: null, stopAt: null }, null],
      ['no restart', { restartAt: null, turnAt: R - 10, stopAt: R - 100 }, null],
    ];
    for (const [name, m, until] of rows) expect(turnMarkGraceUntil(m), name).toBe(until);
  });
});

// ── Wave 2's vocabulary (plan Task 10; design 2026-09-29 §5.1, §5.2, §10) ─────────────────────────────────────
const W2_H = 3_600_000;
const W2_MIN = 60_000;
const WAVE2_ARMS: readonly StallArm[] = ['orphan-d', 'orphan-e', 'failed', 'frozen', 'dead', 'coord-deaf', 'mail-stuck', 'marker-unreadable'];

describe('wave 2: stallNotifyDelivery (planning departure w2-arms-ship-dark)', () => {
  const FULL: StallArming = { disabled: false, live: true, escalate: true };
  it('STALL_ARM_WAVE is total: fully armed without w2Live, exactly the eight wave-2 arms stay shadow', () => {
    expect(STALL_ARMS.filter((arm) => stallNotifyDelivery(arm, 'operator', FULL) === 'shadow')).toEqual(WAVE2_ARMS);
    expect(STALL_ARMS.filter((arm) => stallNotifyDelivery(arm, 'operator', { ...FULL, w2Live: true }) === 'shadow')).toEqual([]);
  });
  it.each([
    ['quiet', 'worker', { disabled: false, live: true, escalate: false }, 'send'],
    ['quiet', 'worker', { disabled: false, live: false, escalate: false, w2Live: true }, 'shadow'],
    ['coord-ball', 'operator', { disabled: false, live: true, escalate: true, w2Live: false }, 'send'],
    ['orphan-e', 'worker', { disabled: false, live: true, escalate: false }, 'shadow'],
    ['orphan-e', 'worker', { disabled: false, live: true, escalate: false, w2Live: false }, 'shadow'],
    ['orphan-e', 'worker', { disabled: false, live: true, escalate: false, w2Live: true }, 'send'],
    ['orphan-e', 'worker', { disabled: false, live: false, escalate: true, w2Live: true }, 'shadow'],
    ['failed', 'coordinator', { disabled: false, live: true, escalate: false, w2Live: true }, 'shadow'],
    ['failed', 'coordinator', { disabled: false, live: true, escalate: true, w2Live: true }, 'send'],
    ['dead', 'coordinator', { disabled: false, live: true, escalate: true }, 'shadow'],
    ['mail-stuck', 'operator', { disabled: false, live: true, escalate: true, w2Live: true }, 'send'],
    ['marker-unreadable', 'operator', { disabled: false, live: false, escalate: true, w2Live: true }, 'shadow'],
  ] as const)('%s to the %s under %o → %s', (arm, to, arming, want) => {
    expect(stallNotifyDelivery(arm, to, arming)).toBe(want);
  });
  it('mailDisabled changes no delivery: the mail-disabled hold is the verdict filter (Task 11), never a delivery word', () => {
    expect(stallNotifyDelivery('quiet', 'worker', { disabled: false, live: true, escalate: true, w2Live: true, mailDisabled: true })).toBe('send');
  });
});

describe('wave 2: rungRecipient is one total per-arm table (planning departure rung-recipient-per-arm)', () => {
  const TABLE: Record<StallArm, readonly StallRecipient[]> = {
    quiet: ['worker', 'coordinator', 'operator'],
    'limit-cap': ['operator'], 'dialog-cap': ['operator'], 'coord-ball': ['operator'],
    'orphan-d': ['worker', 'operator'], 'orphan-e': ['worker'], failed: ['worker', 'coordinator'],
    frozen: ['coordinator'], dead: ['coordinator'],
    'coord-deaf': ['operator'], 'mail-stuck': ['operator'], 'marker-unreadable': ['operator'],
  };
  it.each(STALL_ARMS)('%s: each rung it has goes to its recipient, and a rung it lacks throws', (arm) => {
    for (const rung of [1, 2, 3] as const) {
      const want = TABLE[arm][rung - 1];
      if (want === undefined) expect(() => rungRecipient(arm, rung), `${arm} rung ${rung}`).toThrow(RangeError);
      else expect(rungRecipient(arm, rung), `${arm} rung ${rung}`).toBe(want);
    }
  });
});

describe('wave 2: STOP_FAILURE_ERRORS classifies the thirteen StopFailure tokens (§5.2)', () => {
  it('is the spec’s three groups, and nothing else', () => {
    expect(STOP_FAILURE_ERRORS).toEqual({
      server_error: 'retry', overloaded: 'retry', max_output_tokens: 'retry', unknown: 'retry',
      rate_limit: 'account', billing_error: 'account', authentication_failed: 'account', oauth_org_not_allowed: 'account',
      account_on_hold: 'account', verification_required: 'account', cloud_credential_error: 'account',
      invalid_request: 'request', model_not_found: 'request',
    });
  });
  // `?? {}`: `it.each` evaluates its table while the file is COLLECTED. Before Step 13 the import reads `undefined`, and
  // `Object.entries(undefined)` would throw at collection, so the whole file would run no row (measured by the trial run).
  // With it, the table is empty until Step 13 and the row above carries the red; after Step 13 it is never taken.
  it.each(Object.entries(STOP_FAILURE_ERRORS ?? {}))('stopFailureClass(%j) → %s', (err, cls) => {
    expect(stopFailureClass(err)).toBe(cls);
  });
  it.each(['', 'new_error', 'Server_Error', 'server_error ', 'toString', '__proto__', 'constructor'])(
    'stopFailureClass(%j) is null: a token this build cannot classify is never guessed', (err) => {
      expect(stopFailureClass(err)).toBeNull();
    });
  it('a null err is null', () => {
    expect(stopFailureClass(null)).toBeNull();
  });
});

describe('wave 2: the self-wake class', () => {
  const mail = (fromId: string, subject: string, runId: number | null = 67) => ({ fromId, runId, subject, mailId: 2600 });
  it('the spec spells both prefixes, and no watch prefix begins another', () => {
    expect(STALL_ORPHANED_PREFIX).toBe('orphaned:');
    expect(STALL_FAILED_PREFIX).toBe('failed:');
    for (const p of [STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPORT_PREFIX, STALL_WAIT_PREFIX]) {
      expect(STALL_ORPHANED_PREFIX.startsWith(p) || p.startsWith(STALL_ORPHANED_PREFIX), p).toBe(false);
      expect(STALL_FAILED_PREFIX.startsWith(p) || p.startsWith(STALL_FAILED_PREFIX), p).toBe(false);
    }
  });
  it('an orphaned: or failed: subject from the operator role is self-wake, on a run or run-less', () => {
    expect(stallMailClass(mail('operator', `${STALL_ORPHANED_PREFIX} 1 background task(s) (workflow) did not survive the 2026-09-28T16:20Z restart`))).toBe('self-wake');
    expect(stallMailClass(mail('operator', `${STALL_FAILED_PREFIX} your turn ended on an API error (server_error) at 2026-09-29T10:00Z`))).toBe('self-wake');
    expect(stallMailClass(mail('operator', `${STALL_FAILED_PREFIX} x`, null))).toBe('self-wake');
  });
  it('the same subjects from a session are ordinary mail', () => {
    expect(stallMailClass(mail('demo-worker', `${STALL_ORPHANED_PREFIX} x`))).toBeNull();
    expect(stallMailClass(mail('demo-coordinator', `${STALL_FAILED_PREFIX} x`))).toBeNull();
  });
  it('check and report are tested first: a report naming a failure stays a report', () => {
    expect(stallMailClass(mail('operator', `${STALL_REPORT_PREFIX} run 67 — failed: server_error twice at 2026-09-29T10:00Z`))).toBe('report');
    expect(stallMailClass(mail('operator', `${STALL_CHECK_PREFIX} run 67`))).toBe('check');
  });
});

describe('wave 2: the self-wake subjects carry the date (planning departure self-mail-subjects-carry-the-date)', () => {
  const RESTART = Date.parse('2026-09-28T16:20:29Z');
  const STOP = Date.parse('2026-09-28T21:52:51Z');
  it('orphan D: the count, the kinds joined, and the restart to the minute', () => {
    expect(stallOrphanDSubject({ lostBg: 1, lostKinds: ['workflow'], restartAt: RESTART }))
      .toBe('orphaned: 1 background task(s) (workflow) did not survive the 2026-09-28T16:20Z restart');
    expect(stallOrphanDSubject({ lostBg: 3, lostKinds: ['shell', 'subagent'], restartAt: RESTART }))
      .toBe('orphaned: 3 background task(s) (shell, subagent) did not survive the 2026-09-28T16:20Z restart');
    expect(stallOrphanDSubject({ lostBg: 2, lostKinds: [], restartAt: RESTART }))
      .toBe('orphaned: 2 background task(s) (kinds unrecorded) did not survive the 2026-09-28T16:20Z restart');
  });
  it('orphan E: the first wake-bearing kind in the marker’s order', () => {
    expect(stallOrphanESubject({ bgKinds: ['subagent'], stopAt: STOP }))
      .toBe('orphaned: your background subagent ended at 2026-09-28T21:52Z without waking you');
    expect(stallOrphanESubject({ bgKinds: ['monitor', 'shell', 'subagent'], stopAt: STOP }))
      .toBe('orphaned: your background shell ended at 2026-09-28T21:52Z without waking you');
    expect(stallOrphanESubject({ bgKinds: ['monitor'], stopAt: STOP }))
      .toBe('orphaned: your background task ended at 2026-09-28T21:52Z without waking you');
  });
  it('failed: the error token and the turn end to the minute', () => {
    expect(stallFailedSubject('server_error', Date.parse('2026-09-29T10:00:00Z')))
      .toBe('failed: your turn ended on an API error (server_error) at 2026-09-29T10:00Z');
  });
  it('two episodes a day apart at the same minute have different subjects (the run-less dedupe reads every mail row)', () => {
    const DAY = 24 * W2_H;
    expect(stallOrphanESubject({ bgKinds: ['subagent'], stopAt: STOP }))
      .not.toBe(stallOrphanESubject({ bgKinds: ['subagent'], stopAt: STOP + DAY - 20_000 }));
    expect(stallFailedSubject('server_error', STOP)).not.toBe(stallFailedSubject('server_error', STOP + DAY + 5_000));
    expect(stallOrphanDSubject({ lostBg: 1, lostKinds: ['workflow'], restartAt: RESTART }))
      .not.toBe(stallOrphanDSubject({ lostBg: 1, lostKinds: ['workflow'], restartAt: RESTART + DAY }));
  });
  it('a hostile or unmeasured field prints as (unprintable), never raw', () => {
    const d = stallOrphanDSubject({ lostBg: 1.5, lostKinds: ['work flow', 'shell'], restartAt: Number.NaN });
    expect(d).toBe('orphaned: (unprintable) background task(s) ((unprintable), shell) did not survive the (unprintable) restart');
    expect(d).not.toContain('work flow');
    expect(stallFailedSubject('x y', STOP)).toBe('failed: your turn ended on an API error ((unprintable)) at 2026-09-28T21:52Z');
    expect(stallOrphanESubject({ bgKinds: ['subagent'], stopAt: null }))
      .toBe('orphaned: your background subagent ended at (unprintable) without waking you');
  });
});

describe('wave 2: stallReportKind reads a report subject back; stallReportTitle titles it (Contract note 8)', () => {
  it.each([
    [`${STALL_REPORT_PREFIX} run 67 — worker silent 3h 39m, stall-check #2531 unanswered`, 'stall'],
    [`${STALL_REPORT_PREFIX} run 67 — frozen: no hook event for 1h 1m`, 'frozen'],
    [`${STALL_REPORT_PREFIX} run 67 — dead: orphan for 0h 12m`, 'dead'],
    [`${STALL_REPORT_PREFIX} run 67 — failed: server_error twice at 2026-09-29T10:00Z`, 'failed'],
    [`${STALL_REPORT_PREFIX} run (unprintable) — dead: registry row absent for 0h 12m`, 'dead'],
    [`${STALL_REPORT_PREFIX} run 67 — deadlock suspected`, 'stall'],
    [`${STALL_REPORT_PREFIX} run 67 frozen: no dash`, 'stall'],
    ['an ordinary subject — frozen: x', 'stall'],
  ] as const)('%j → %s', (subject, kind) => {
    expect(stallReportKind(subject)).toBe(kind);
  });
  it('titles each kind, printing the workspace only when it matches the id pattern', () => {
    expect(stallReportTitle('stall', 'demo-ws')).toBe('⚠ stall › demo-ws');
    expect(stallReportTitle('frozen', 'demo-ws')).toBe('⚠ frozen › demo-ws');
    expect(stallReportTitle('dead', 'demo-ws')).toBe('⚠ dead › demo-ws');
    expect(stallReportTitle('failed', 'demo-ws')).toBe('⚠ failed › demo-ws');
    expect(stallReportTitle('dead', 'bad ws')).toBe('⚠ dead › (unprintable)');
  });
});

describe('wave 2: the constants carry §10’s values', () => {
  it('each value, in milliseconds', () => {
    expect({
      STALL_BOUND_MS, DELEGATE_WINDOW_MS, DELEGATE_CAP_MS, FROZEN_NO_EVENT_MS, DEAD_GRACE_MS, COORD_DEAF_MS, MAIL_STUCK_MS,
      ORPHAN_D_IDLE_MS, ORPHAN_E_IDLE_MS, FAILED_IDLE_MS, FAILED_REPEAT_MS, CHECK_UNDELIVERED_MS, BACKLOG_HORIZON_MS,
      ORPHAN_PUSH_MS, MARKER_UNREADABLE_MS,
    }).toEqual({
      STALL_BOUND_MS: 3 * W2_H, DELEGATE_WINDOW_MS: 30 * W2_MIN, DELEGATE_CAP_MS: 4 * W2_H, FROZEN_NO_EVENT_MS: 60 * W2_MIN,
      DEAD_GRACE_MS: 10 * W2_MIN, COORD_DEAF_MS: W2_H, MAIL_STUCK_MS: 72 * W2_MIN /* 1.2 h */, ORPHAN_D_IDLE_MS: 15 * W2_MIN,
      ORPHAN_E_IDLE_MS: 10 * W2_MIN, FAILED_IDLE_MS: 10 * W2_MIN, FAILED_REPEAT_MS: 2 * W2_H, CHECK_UNDELIVERED_MS: 2 * W2_H,
      BACKLOG_HORIZON_MS: 24 * W2_H, ORPHAN_PUSH_MS: 30 * W2_MIN, MARKER_UNREADABLE_MS: W2_H,
    });
  });
});

describe('wave 2: the kind and event sets, and the frozen clock', () => {
  it('the kinds a background end can wake with, those that resume a session on their own, and the plumbing events', () => {
    expect(STALL_WAKE_KINDS).toEqual(['subagent', 'workflow', 'shell']);
    expect(STALL_RESUMING_KINDS).toEqual(['subagent', 'workflow']);
    expect(STALL_PLUMBING_EVENTS).toEqual(['SessionStart', 'PreCompact', 'PostCompact']);
  });
  const TURN = 1_790_000_000_000;
  const mark = (over: Partial<Extract<TurnMarkRead, { ok: true }>> = {}): TurnMarkRead => ({
    ok: true, sessionId: 'uuid-1', state: 'working', event: 'PostToolUse', at: TURN + 5 * W2_MIN, turnAt: TURN, stopAt: null,
    bg: -1, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null, ...over,
  });
  const hook = (over: Partial<Extract<HookRawFact, { ok: true }>> = {}): HookRawFact => ({
    ok: true, updatedAt: TURN + 20 * W2_MIN, event: 'PostToolUse', sessionId: 'uuid-1', identity: 'current', ...over,
  });
  it.each([
    ['a current hook on a tool event: the later of the turn start and the hook', mark(), hook(), TURN + 20 * W2_MIN],
    ['a current hook older than the turn start: the turn start', mark(), hook({ updatedAt: TURN - W2_MIN }), TURN],
    ['a null turnAt: the marker’s at', mark({ turnAt: null }), hook({ updatedAt: TURN }), TURN + 5 * W2_MIN],
    ['a SessionStart never refreshes the clock', mark(), hook({ event: 'SessionStart' }), TURN],
    ['PreCompact is plumbing', mark(), hook({ event: 'PreCompact' }), TURN],
    ['PostCompact is plumbing', mark(), hook({ event: 'PostCompact' }), TURN],
    ['a null event is not plumbing (the spec names three events)', mark(), hook({ event: null }), TURN + 20 * W2_MIN],
    ['a foreign hook: unmeasurable', mark(), hook({ identity: 'foreign' }), null],
    ['an unregistered hook: unmeasurable', mark(), hook({ identity: 'unregistered' }), null],
    ["a hook whose sessionId is '': not current (Contract note 9)", mark(), hook({ sessionId: '' }), null],
    ['a hook that does not read: unmeasurable', mark(), { ok: false, reason: 'malformed' } as HookRawFact, null],
    ['a marker that does not read: unmeasurable', { ok: false, reason: 'unmeasured' } as TurnMarkRead, hook(), null],
  ] as const)('%s', (_why, m, h, want) => {
    expect(stallFrozenSince(m, h)).toBe(want);
  });
});

describe('wave 2: every new kebab word is declared through isStallKebab', () => {
  it.each([
    'orphan-d', 'orphan-e', 'coord-deaf', 'mail-stuck', 'marker-unreadable', 'restart-grace', 'lifecycle-stopped',
    'mail-disabled', 'failed-account', 'failed-unknown', 'stall-watch-w2-live', 'self-wake', 'registry-unmeasurable',
  ])('isStallKebab(%j)', (w) => {
    expect(isStallKebab(w)).toBe(true);
  });
});

describe('wave 2: the marker-unreadable reasons and the dead-shaped lifecycles live in L1 once (the L1 ruling)', () => {
  it.each([
    ['unmeasured', true], ['malformed', true], ['absent', false], ['foreign', false], ['stale', false],
  ] as const)('stallMarkUnreadable: a marker that failed as %j → %s', (reason, want) => {
    expect(stallMarkUnreadable({ ok: false, reason })).toBe(want);
  });
  it('stallMarkUnreadable: a marker that reads is never unreadable', () => {
    expect(stallMarkUnreadable({
      ok: true, sessionId: 'uuid-1', state: 'working', event: 'PostToolUse', at: 1, turnAt: null, stopAt: null, bg: -1,
      bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null,
    })).toBe(false);
  });
  it.each([
    ['orphan', true], ['never-started', true],
    ['running', false], ['unsupervised', false], ['unclaimed', false], ['stopped', false], ['restarting', false],
    ['unmeasurable', false], [null, false], ['', false], ['Orphan', false],
  ] as const)('stallDeadShaped(%j) → %s: only an orphan or never-started pane is dead-shaped; a deliberate stop never is', (lifecycle, want) => {
    expect(stallDeadShaped(lifecycle)).toBe(want);
  });
});

describe('wave 2: stallPushRoute names every stall push\'s kind and collapse tag (spec §4.2 "Push shape", §11)', () => {
  // L1 owns both, so watch.ts spells no tag shape and no kind rule (the controller's A5 ruling): `applyStall` and
  // `applyStallSession` each ask this one function.
  it('the delayed orphan push (orphan D rung 2) is `mail`, tagged orphaned-<toId>-<restartAt>, run-bound or run-less alike', () => {
    expect(stallPushRoute({ arm: 'orphan-d', rung: 2, key: T0 }, 'demo-idle-basin', null))
      .toEqual({ kind: 'mail', tag: `orphaned-demo-idle-basin-${T0}` });
    expect(stallPushRoute({ arm: 'orphan-d', rung: 2, key: T0 }, 'demo-quiet-mesa', 31))
      .toEqual({ kind: 'mail', tag: `orphaned-demo-quiet-mesa-${T0}` });
  });

  it('every other rung is `run`, tagged stall-<runId>-<arm>-<rung>-<key> on a run, stall-<toId>-… off one', () => {
    let rows = 0;
    for (const arm of STALL_ARMS) {
      for (const rung of [1, 2, 3] as const) {
        if (arm === 'orphan-d' && rung === 2) continue;
        try { rungRecipient(arm, rung); } catch { continue; }   // a rung this arm does not have
        expect(stallPushRoute({ arm, rung, key: T0 }, 'demo-coordinator', 31), `${arm} r${rung}`)
          .toEqual({ kind: 'run', tag: `stall-31-${arm}-${rung}-${T0}` });
        expect(stallPushRoute({ arm, rung, key: T0 }, 'demo-coordinator', null), `${arm} r${rung}, run-less`)
          .toEqual({ kind: 'run', tag: `stall-demo-coordinator-${arm}-${rung}-${T0}` });
        rows += 1;
      }
    }
    expect(rows).toBeGreaterThanOrEqual(STALL_ARMS.length);   // the control: every arm's rung 1 was walked
  });
});
