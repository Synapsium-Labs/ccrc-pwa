// Design 2026-09-20 §6: the update control plane's vocabularies, declared once
// in `shared/api.ts`. Two things are pinned here and nowhere else:
//
//  1. Every `UpdateState` is classified ONCE — busy or settled — and `unknown`
//     is BUSY. `run-states.test.ts`'s three partition assertions, for the same
//     reason: the dangerous direction for a lease is a node wrongly read as
//     settled, which lets a second dispatch through.
//  2. Each array IS its union and each guard IS its array. `as const satisfies`
//     proves array ⊆ union at compile time; the `Missing<…>` lines at the foot
//     of this file prove union ⊆ array (typecheck-tests.test.ts compiles this
//     directory), and the runtime cases prove the guard answers exactly the
//     array — no trimming, no case folding, nothing that is not a string.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPDATE_CHANNELS, isUpdateChannel, UPDATE_STATES, isUpdateState,
  BUSY_UPDATE_STATES, SETTLED_UPDATE_STATES, UPDATE_PHASES, isUpdatePhase, IN_FLIGHT_UPDATE_PHASES,
  INSTALL_STATES, isInstallState, PROVENANCE_STATES, isProvenanceState, AUTO_MODES, isAutoMode,
  NOTIFY_MODES, isNotifyMode, REQUEST_KINDS, isRequestKind, STAMP_READS, isStampRead,
  NODE_ROLES, isNodeRole, NODE_OSES, isNodeOs, RELEASE_TAG, isReleaseTag, CAP_WORD, MAX_CAP_WORDS,
  validCapWords,
  type UpdateChannel, type UpdateState, type BusyUpdateState, type SettledUpdateState, type UpdatePhase,
  type InstallState, type ProvenanceState, type AutoMode, type NotifyMode, type RequestKind,
  type StampRead, type NodeRole, type NodeOs,
} from '../../shared/api.js';
import type { ReadFailure } from '../../shared/agent-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

describe('update-state classification (design 2026-09-20 §6)', () => {
  const lists: Record<string, readonly UpdateState[]> = { BUSY_UPDATE_STATES, SETTLED_UPDATE_STATES };

  it('places every UpdateState in exactly one list', () => {
    for (const s of UPDATE_STATES) {
      const homes = Object.entries(lists).filter(([, l]) => l.includes(s)).map(([n]) => n);
      expect(homes, `${s} is classified ${homes.length} times: ${homes.join(', ')}`).toHaveLength(1);
    }
  });

  it('classifies nothing that is not an UpdateState, and covers all of them', () => {
    const union = [...BUSY_UPDATE_STATES, ...SETTLED_UPDATE_STATES].sort();
    expect(union).toEqual([...UPDATE_STATES].sort());
  });

  it('counts `unknown` as BUSY — the safe direction for a lease', () => {
    expect(BUSY_UPDATE_STATES).toContain('unknown');
    expect(SETTLED_UPDATE_STATES).not.toContain('unknown');
  });

  it('the in-flight phases plus the four named rows are every UpdatePhase, each once (§8 phase table)', () => {
    const rows = [...IN_FLIGHT_UPDATE_PHASES, 'done', 'reverted', 'failed', 'unknown'];
    expect(new Set(rows).size, 'a phase sits in two rows of the table').toBe(rows.length);
    expect([...rows].sort()).toEqual([...UPDATE_PHASES].sort());
  });
});

describe('each vocabulary: the array is the union, the guard is the array', () => {
  // The spec's own lists, as LITERALS — a second statement of each vocabulary,
  // on purpose: this is the pin that reds when a member is added, dropped or
  // reordered without the spec (§6's code block) being consulted.
  const VOCABS: ReadonlyArray<{ name: string; members: readonly string[]; guard: (v: unknown) => boolean; spec: string[] }> = [
    { name: 'UpdateChannel', members: UPDATE_CHANNELS, guard: isUpdateChannel, spec: ['stable', 'dev'] },
    { name: 'UpdateState', members: UPDATE_STATES, guard: isUpdateState,
      spec: ['idle', 'pending', 'applying', 'reverted', 'failed', 'unknown'] },
    { name: 'UpdatePhase', members: UPDATE_PHASES, guard: isUpdatePhase,
      spec: ['queued', 'resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'restarting',
        'checking', 'restoring', 'done', 'reverted', 'failed', 'unknown'] },
    { name: 'InstallState', members: INSTALL_STATES, guard: isInstallState, spec: ['complete', 'incomplete', 'unknown'] },
    { name: 'ProvenanceState', members: PROVENANCE_STATES, guard: isProvenanceState,
      spec: ['verified', 'unverified', 'unknown'] },
    { name: 'AutoMode', members: AUTO_MODES, guard: isAutoMode, spec: ['off', 'stable', 'channel'] },
    { name: 'NotifyMode', members: NOTIFY_MODES, guard: isNotifyMode, spec: ['channel', 'stable', 'off'] },
    { name: 'RequestKind', members: REQUEST_KINDS, guard: isRequestKind, spec: ['update', 'rollback'] },
    { name: 'StampRead', members: STAMP_READS, guard: isStampRead, spec: ['ok', 'absent', 'unreadable', 'malformed'] },
    { name: 'NodeRole', members: NODE_ROLES, guard: isNodeRole, spec: ['server', 'fleet', 'both'] },
    { name: 'NodeOs', members: NODE_OSES, guard: isNodeOs, spec: ['linux', 'darwin', 'unknown'] },
  ];

  for (const { name, members, guard, spec } of VOCABS) {
    it(`${name}: the array is the spec's list, in order, with no duplicate`, () => {
      expect([...members]).toEqual(spec);
      expect(new Set(members).size).toBe(members.length);
    });

    it(`${name}: the guard admits every member and nothing else`, () => {
      for (const m of members) expect(guard(m), m).toBe(true);
      const probes: unknown[] = [
        '', null, undefined, 1, true, {}, [], 'toString', 'constructor',
        ...members.flatMap((m) => [m.toUpperCase(), ` ${m}`, `${m} `, `${m}\n`, [m], { [m]: true }]),
      ];
      for (const p of probes) {
        const inArray = typeof p === 'string' && members.includes(p);
        expect(guard(p), `${name} guard on ${JSON.stringify(p)}`).toBe(inArray);
      }
    });
  }
});

describe('the release tag (decision 2): one shape, the same as the bash twin', () => {
  // The shared fixture list: the shapes a same-user writer, a hand-typed
  // `--to` or a mis-cut release could present.
  const FIXTURES = [
    'v0.0.9', 'v0.0.10', 'v1.2.3', 'v10.20.30', 'v0.0.010', 'v0.0.0',
    '0.0.9', 'v0.0.9 ', ' v0.0.9', 'v0.0.9\n', 'v0.0', 'v0.0.9.1', 'V0.0.9', 'v0..9', 'v.0.0.9',
    'v0.0.9-rc1', 'v0.0.9+meta', 'vv0.0.9', 'v-1.0.0', 'v1e3.0.0', 'v0x1.0.0', 'v١.0.0', '',
  ];

  it('refuses the five shapes the plan names', () => {
    for (const bad of ['0.0.9', 'v0.0.9 ', 'v0.0.9\n', 'v0.0', 'V0.0.9']) {
      expect(isReleaseTag(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isReleaseTag('v0.0.9')).toBe(true);
    for (const v of [null, undefined, 9, ['v0.0.9'], { tag: 'v0.0.9' }]) expect(isReleaseTag(v)).toBe(false);
  });

  it('has no flags — a `g` would make every second `.test` of the same string answer false', () => {
    expect(RELEASE_TAG.flags).toBe('');
    expect([isReleaseTag('v0.0.9'), isReleaseTag('v0.0.9'), isReleaseTag('v0.0.9')]).toEqual([true, true, true]);
  });

  it('is byte-for-byte deploy/release-main.sh\'s SHAPE, and agrees with it on every fixture under bash', () => {
    const src = readFileSync(path.join(REPO, 'deploy', 'release-main.sh'), 'utf8');
    const m = /^SHAPE='([^']+)'$/m.exec(src);
    expect(m, 'deploy/release-main.sh no longer assigns SHAPE on one line').not.toBeNull();
    const shape = m![1]!;
    expect(RELEASE_TAG.source).toBe(shape);
    // LC_ALL=C: bash's `=~` follows the locale, and `[0-9]` is only ASCII
    // digits in C — the JS class is ASCII-only unconditionally.
    for (const f of FIXTURES) {
      const r = spawnSync('bash', ['-c', '[[ $1 =~ $2 ]]', '--', f, shape],
        { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
      expect(r.status === 0, `bash SHAPE on ${JSON.stringify(f)}`).toBe(isReleaseTag(f));
    }
  });
});

describe('caps and ops words (§8, decision 13)', () => {
  it('CAP_WORD is pool-epoch\'s NAME grammar: 1–32 chars, lowercase first', () => {
    for (const ok of ['verify', 'node-id', 'floor', 'update-gate', 'a', 'a'.repeat(32), 'x9-']) {
      expect(CAP_WORD.test(ok), ok).toBe(true);
    }
    for (const bad of ['', 'a'.repeat(33), 'Verify', '9lives', '-x', 'node_id', 'verify\n', 'verify ', 'os linux']) {
      expect(CAP_WORD.test(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(CAP_WORD.flags).toBe('');
  });

  it('validCapWords: [] is a valid empty list, and null is a REFUSAL — two answers, never one', () => {
    expect(validCapWords([])).toEqual([]);
    expect(validCapWords(['verify', 'node-id', 'floor'])).toEqual(['verify', 'node-id', 'floor']);
    const full = Array.from({ length: MAX_CAP_WORDS }, (_, i) => `w${i}`);
    expect(validCapWords(full)).toEqual(full);
    expect(validCapWords([...full, 'w32']), '33 words').toBeNull();
    expect(validCapWords(['verify', 'Bad', 'floor']), 'one bad word drops the whole list').toBeNull();
    expect(validCapWords(['verify', 7]), 'a non-string').toBeNull();
    expect(validCapWords(['verify', null]), 'a null element').toBeNull();
    expect(validCapWords('verify' as unknown as unknown[]), 'not an array').toBeNull();
    expect(MAX_CAP_WORDS).toBe(32);
  });

  it('returns a copy, never the caller\'s array', () => {
    const input = ['verify'];
    const out = validCapWords(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

// ── The compile-time half: every union is covered by its array ──────────────
// `as const satisfies readonly X[]` refuses an array member the union lacks;
// these lines refuse a union member the array lacks. Each is `never` exactly
// when the array names every member — otherwise TS2322 in the tests project,
// which `typecheck-tests.test.ts` ("server/test/ is clean") compiles.
type Missing<T, A extends readonly unknown[]> = Exclude<T, A[number]>;
const _channels: never = null as unknown as Missing<UpdateChannel, typeof UPDATE_CHANNELS>;
const _states: never = null as unknown as Missing<UpdateState, typeof UPDATE_STATES>;
const _classified: never = null as unknown as Exclude<UpdateState, BusyUpdateState | SettledUpdateState>;
const _overlap: never = null as unknown as Extract<BusyUpdateState, SettledUpdateState>;
const _phases: never = null as unknown as Missing<UpdatePhase, typeof UPDATE_PHASES>;
const _installs: never = null as unknown as Missing<InstallState, typeof INSTALL_STATES>;
const _provenance: never = null as unknown as Missing<ProvenanceState, typeof PROVENANCE_STATES>;
const _autos: never = null as unknown as Missing<AutoMode, typeof AUTO_MODES>;
const _notifies: never = null as unknown as Missing<NotifyMode, typeof NOTIFY_MODES>;
const _kinds: never = null as unknown as Missing<RequestKind, typeof REQUEST_KINDS>;
const _roles: never = null as unknown as Missing<NodeRole, typeof NODE_ROLES>;
const _oses: never = null as unknown as Missing<NodeOs, typeof NODE_OSES>;
// StampRead's failure half IS ReadFailure, in both directions: a word added to
// either side alone is a type error here (`shared/api.ts`'s StampRead docstring).
const _stampFailuresCovered: never = null as unknown as Exclude<ReadFailure, StampRead>;
const _stampFailuresOnly: never = null as unknown as Exclude<Exclude<StampRead, 'ok' | 'malformed'>, ReadFailure>;
void [_channels, _states, _classified, _overlap, _phases, _installs, _provenance, _autos, _notifies, _kinds,
  _roles, _oses, _stampFailuresCovered, _stampFailuresOnly];
