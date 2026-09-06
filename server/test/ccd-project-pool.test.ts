// `$REG/pools/<project>` — the project pool tag, its reader and (Task 3) its
// writer verb.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote a real tag
// would retag an actual project on the fleet.
//
// THE READER RUNS INSIDE `cmd_supervise`'s 5-second loop, so it may never
// `die`: a supervisor that exits on an unreadable tag stops supervising. That
// is pinned by interposing `die() { echo DIED; exit 99; }` AFTER sourcing ccd
// and asserting the word came back instead (the `ccd-die-containment.test.ts`
// technique).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-project-pool-'); });
afterEach(() => { h.cleanup(); });

const REG = (): string => path.join(h.home, '.cc-sessions');
const POOLS = (): string => path.join(REG(), 'pools');

/** Plants a tag file with EXACT bytes — no helper newline, because the byte
 *  assertions below are about exactly that. */
function plantTag(project: string, bytes: string): string {
  fs.mkdirSync(POOLS(), { recursive: true });
  const p = path.join(POOLS(), project);
  fs.writeFileSync(p, bytes);
  return p;
}

/** ccd's own answer, captured with stderr FOLDED IN, so "the reader printed a
 *  word" and "the reader printed a word and complained on stderr" are
 *  distinguishable. `h.sh` returns stdout only. */
const state = (project: string): string =>
  h.sh(`{ _project_pool_state ${JSON.stringify(project)}; } 2>&1`);

describe('_project_pool_state — four words, always rc 0', () => {
  it('answers `untagged` when the pools directory does not exist at all', () => {
    expect(fs.existsSync(POOLS())).toBe(false);
    expect(state('demo')).toBe('untagged');
  });

  it('answers `untagged` for a project with no file, when other projects have one', () => {
    plantTag('quiet-basin', 'pool-a');
    expect(state('demo')).toBe('untagged');
  });

  it('answers `named <n>` for a well-formed tag, with and without a trailing newline', () => {
    // A shell `echo pool-a > pools/demo` is a LEGAL writer (ruling 2), so the
    // reader strips trailing whitespace. Both bytes must read the same.
    plantTag('demo', 'pool-a');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n');
    expect(state('demo')).toBe('named pool-a');
    plantTag('demo', 'pool-a\n\n  \t\n');
    expect(state('demo')).toBe('named pool-a');
  });

  it('answers `malformed` for two tokens, for uppercase, and for empty', () => {
    // Each is a DIFFERENT bad shape and they share one word because they share
    // one remedy: rewrite the file as a single lowercase token.
    for (const bytes of ['pool a', 'Pool-a', '', 'pool_a', '-pool-a']) {
      plantTag('demo', bytes);
      expect(state('demo'), JSON.stringify(bytes)).toBe('malformed');
    }
  });

  it('answers `unreadable` for a directory at the tag path — any uid, root included', () => {
    fs.mkdirSync(path.join(POOLS(), 'demo'), { recursive: true });
    expect(state('demo')).toBe('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)(
    'answers `unreadable` for a mode-000 file, and NEVER `untagged`', () => {
      // THE DEFECT THIS IS ABOUT: folding unreadable into untagged silently
      // LIFTS the constraint — the project becomes unconstrained because a
      // permission bit was wrong, and nothing anywhere says so.
      const p = plantTag('demo', 'pool-a');
      fs.chmodSync(p, 0o000);
      try {
        expect(state('demo')).toBe('unreadable');
      } finally {
        fs.chmodSync(p, 0o600);
      }
    });

  it('answers `untagged` for an EMPTY project argument, never resolving to the directory', () => {
    // A pre-2026 registry row with no `.project` field hands this function the
    // empty string. Without the `-n "$1"` guard the path is `$POOLS_DIR/`,
    // `cat` on a directory fails, and every such session reads `unreadable` —
    // fail-shut on a row whose project is merely unknown (spec §10).
    fs.mkdirSync(POOLS(), { recursive: true });
    expect(h.sh('{ _project_pool_state ""; } 2>&1')).toBe('untagged');
    expect(h.sh('{ _project_pool_state; } 2>&1')).toBe('untagged');
  });

  it('never dies, on every one of the four inputs, and always exits 0', () => {
    fs.mkdirSync(path.join(POOLS(), 'acct-a-demo'), { recursive: true });   // unreadable
    plantTag('demo', 'pool-a');                                            // named
    plantTag('quiet-basin', 'Pool a');                                     // malformed
    const out = h.sh(
      'die() { echo DIED; exit 99; }; '
      + 'for p in demo quiet-basin acct-a-demo nothing-here ""; do '
      + '  { _project_pool_state "$p"; } 2>&1; echo "rc=$?"; '
      + 'done');
    expect(out).not.toContain('DIED');
    expect(out.split('\n').filter((l) => l.startsWith('rc='))).toEqual(
      ['rc=0', 'rc=0', 'rc=0', 'rc=0', 'rc=0']);
    expect(out.split('\n').filter((l) => !l.startsWith('rc='))).toEqual(
      ['named pool-a', 'malformed', 'unreadable', 'untagged', 'untagged']);
  });
});
