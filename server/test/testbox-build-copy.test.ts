// Build capture runner spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.2: the copy port's production
// adapter (`server/src/testboxBuildCopy.ts`). It runs one admin lane sub and maps what it came to onto the port's words, one
// case per row of its header's table. The arm here is a FAKE: nothing reaches a fleet host or a box.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testboxBuildCopy } from '../src/testboxBuildCopy.js';
import type { TestboxAdminOutcome } from '../src/testboxAdmin.js';
import type { TestboxAdminFields, TestboxAdminSub } from '../../shared/testbox-admin.js';
import { TESTBOX_ADMIN_CODES, buildTestboxAdminArgv } from '../../shared/testbox-admin.js';

const BUILD = '2.1.330';

function arm(outcome: TestboxAdminOutcome | Error) {
  const calls: [TestboxAdminSub, TestboxAdminFields][] = [];
  return {
    calls,
    run: async (sub: TestboxAdminSub, fields: TestboxAdminFields): Promise<TestboxAdminOutcome> => {
      calls.push([sub, fields]);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}
const exited = (stdout: string, code = 0): TestboxAdminOutcome => ({ kind: 'exited', code, stdout });
const refusedWith = (code: string): TestboxAdminOutcome => exited(`${JSON.stringify({ ok: false, code })}\n`);
const copy = (outcome: TestboxAdminOutcome | Error) => testboxBuildCopy(() => arm(outcome)).copy({ build: BUILD });

describe('testboxBuildCopy: one sub, mapped onto the copy port (spec §2.2)', () => {
  it('runs exactly build-copy with the build as its version, once, and its words build', async () => {
    const a = arm(exited(`{"ok":true,"build":"${BUILD}","sha256":"${'a'.repeat(64)}"}\n`));
    expect(await testboxBuildCopy(() => a).copy({ build: BUILD })).toBe('copied');
    expect(a.calls).toEqual([['build-copy', { version: BUILD }]]);
    const built = buildTestboxAdminArgv('build-copy', { version: BUILD });
    expect(built).toEqual({ ok: true, argv: ['testbox-admin', 'build-copy', `--version=${BUILD}`] });
  });

  it('an otherwise valid success line with a non-zero exit is not a copy', async () => {
    expect(await copy(exited(JSON.stringify({ ok: true, build: BUILD, sha256: 'a'.repeat(64) }), 1))).toBe('copy-failed');
  });

  it.each([
    { ok: true },
    { ok: true, build: '2.1.331', sha256: 'a'.repeat(64) },
    { ok: true, build: BUILD, sha256: 'not-a-digest' },
  ])('refuses a success line without the requested build and a SHA-256 digest: %j', async (line) => {
    expect(await copy(exited(JSON.stringify(line)))).toBe('copy-failed');
  });

  it.each(['build-not-on-fleet', 'build-not-regular', 'build-too-large'])('refused %s: copy-refused', async (c) => {
    expect(await copy(refusedWith(c))).toBe('copy-refused');
  });

  it.each(['not-connected', 'no-access-key'])('refused %s: no-admin-lane', async (c) => {
    expect(await copy(refusedWith(c))).toBe('no-admin-lane');
  });

  it('every other code the verb can answer is copy-failed', async () => {
    const mapped = new Set(['build-not-on-fleet', 'build-not-regular', 'build-too-large', 'not-connected', 'no-access-key']);
    for (const c of TESTBOX_ADMIN_CODES.filter((x) => !mapped.has(x))) expect(await copy(refusedWith(c)), c).toBe('copy-failed');
  });

  it('an arm with no such op, or no arm at all: no-admin-lane', async () => {
    expect(await copy({ kind: 'unsupported' })).toBe('no-admin-lane');
    expect(await testboxBuildCopy(() => undefined).copy({ build: BUILD })).toBe('no-admin-lane');
  });

  it.each([
    ['a builder refusal', { kind: 'refused', why: 'bad-field' } as TestboxAdminOutcome],
    ['a frame that never left', { kind: 'not-started' } as TestboxAdminOutcome],
    ['a deadline', { kind: 'timeout' } as TestboxAdminOutcome],
    ['an answer too large', { kind: 'too-large' } as TestboxAdminOutcome],
    ['a lost answer', { kind: 'lost' } as TestboxAdminOutcome],
    ['an exit with no JSON line', exited('ccrc testbox-admin: build-copy is not built in this release\n', 2)],
    ['a JSON line off the grammar', exited('{"ok":"yes"}\n')],
    ['an arm that throws', new Error('boom')],
  ])('%s: copy-failed', async (_n, outcome) => {
    expect(await copy(outcome)).toBe('copy-failed');
  });
});

// The fold keeps the lane's one not-sent word, and the verb's own code survives in one server log line (review 3623 F7).
describe('testboxBuildCopy: every typed refusal writes one log line with the verb\'s own code', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['build-store-refused', 'copy-failed'], ['build-hash-mismatch', 'copy-failed'], ['build-too-large', 'copy-refused'], ['not-connected', 'no-admin-lane'],
  ])('refused %s: answers %s and logs the code once', async (code, word) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await copy(refusedWith(code))).toBe(word);
    expect(warn.mock.calls).toEqual([[`ccrc-server: build copy of ${BUILD} refused by the test box admin lane: ${code} (recorded as ${word})`]]);
  });

  it('a code off the word grammar is logged as unreadable, never as its text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await copy(refusedWith('Not A Word; rm'))).toBe('copy-failed');
    expect(warn.mock.calls).toEqual([[`ccrc-server: build copy of ${BUILD} refused by the test box admin lane: unreadable (recorded as copy-failed)`]]);
  });

  it('a copy that succeeds logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await copy(exited(`{"ok":true,"build":"${BUILD}","sha256":"${'a'.repeat(64)}"}\n`))).toBe('copied');
    expect(warn).not.toHaveBeenCalled();
  });
});
