import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CCD, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';

// DERIVED FROM `ccdWsHelpers`'s CCD, NOT SPELLED AGAIN. `single-definition.test.ts`
// allows exactly one file in the test corpus to name the path to the `ccd` script,
// and that file is `ccdWsHelpers.ts` — measured: spelling it here reddened that
// guard with a two-holder list.
const CCD_DIR = process.env.D2764_DIR ?? path.dirname(CCD);

// THE SYSTEM `timeout`, RESOLVED ONCE AND BY ABSOLUTE PATH. Two cases below plant a
// shim named `timeout` on PATH and have it DELEGATE to the real one; they cannot
// spell `timeout` to do that (the shim dir is first on PATH, so it would re-exec
// itself), and they must not spell `/usr/bin/timeout` either — that hard-code is
// what reddened `test-macos` from af2486b6 (PR #115) onward, because macOS ships no
// `timeout` at that path, so the shim exec'd nothing and the probe read rc 127 where
// the case asserts 124. GNU coreutils installs it as `gtimeout` on macOS, so try
// both. Resolved HERE, at module scope, because at this point PATH is still the
// runner's own — inside a case it is not.
const REAL_TIMEOUT: string | null = (() => {
  for (const candidate of ['timeout', 'gtimeout']) {
    const r = spawnSync('sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() !== '') return r.stdout.trim();
  }
  return null;
})();
// A platform with NO system `timeout` cannot exercise a DELEGATING shim at all — the
// subject of both cases is what `_plat_timeout` reads back from a real parser. Skip
// rather than weaken: a skip is visible in the report, a loosened assertion is not.
const itDelegating = REAL_TIMEOUT === null ? it.skip : it;

function body(file: string, name: string): string {
  const src = readFileSync(path.join(CCD_DIR, file), 'utf8');
  const m = new RegExp(`${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}`).exec(src);
  expect(m, `${name} not found in ${file}`).not.toBeNull();
  return `${name}() {\n${m![1]!}\n}\n`;
}
// The label is deliberately not the bare filename for the first row: two adjacent
// quoted `ccd` strings are the second arm of `single-definition.test.ts`'s
// NAMES_CCD scan, which exists so nobody re-spells the path to the script.
const COPIES: Array<[string, string, string]> = [
  ['the ccd script', 'ccd', '_plat_timeout'],
  ['ccrc', 'ccrc', '_plat_timeout'],
  ['helper', 'ccd-account-auth', '_auth_timeout'],
];
interface Run { home: string; rc: string; ms: number; out: string; err: string }
function drive(file: string, name: string, script: string, pathPrefix?: string, also: string[] = []): Run {
  const home = mkdtempSync(path.join(tmpdir(), 'ccd-d2764-'));
  // `also` names further functions of the SAME file to source beside the shim (the strict neighbours, below).
  writeFileSync(path.join(home, 'shim.sh'), [name, ...also].map((n) => body(file, n)).join(''));
  // THE POISONED `gh` SURVIVES THE PATH THESE CASES BUILD. Several of them hand
  // the shim a PATH holding nothing but a planted `timeout`, which is the whole
  // point — that is how the fallback arm and the hostile-binary arm are reached.
  // A bare `export PATH=<prefix>` would also displace the harness's `gh`, and
  // containment here is not a formality: the host token carries repo WRITE scope.
  // `harnessBin` holds `gh` and no deadline binary, so appending it cannot change
  // which `timeout` any of these cases resolves.
  // `{ systemd: true, tmux: true }` even though these cases source the shim
  // function alone and never run `ccd`. The opt-out that exists is reserved for
  // the negative control that PROVES the opt-in is real; borrowing it here to
  // save two poisons nobody touches would spend a narrow exemption on
  // convenience. Asking for containment this file does not need costs nothing
  // and keeps the scan's claim — "every ccd bash call site" — free of a special
  // case a later reader has to re-derive.
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  const prog = [
    'set -uo pipefail',
    pathPrefix ? `export PATH=${JSON.stringify(`${pathPrefix}:${harnessBin(home)}`)}` : '',
    `. ${JSON.stringify(path.join(home, 'shim.sh'))}`,
    script.replace(/@SHIM@/g, name).replace(/@HOME@/g, home),
  ].filter(Boolean).join('\n');
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', prog], { encoding: 'utf8', timeout: 40_000, env });
  return { home, rc: (r.stdout ?? '').trim(), ms: Date.now() - t0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe('D-2764', () => {
  for (const [label, file, name] of COPIES) {
    it(`${label}: a TERM-ignoring child does not outlive its deadline`, () => {
      const r = drive(file, name,
        `@SHIM@ 1 bash -c 'trap "" TERM; sleep 6; : > @HOME@/outlived' >/dev/null 2>&1\nprintf %s "$?"`);
      expect(r.rc, `stderr: ${r.err}`).toBe('124');
      expect(existsSync(path.join(r.home, 'outlived')),
        `the child ran to completion after the deadline (${r.ms}ms)`).toBe(false);
    });
  }
  it('an outer SIGKILL that beat the escalation keeps its 137', () => {
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 30 bash -c 'kill -9 $$' >/dev/null 2>&1\nprintf %s "$?"`);
    expect(r.rc, `stderr: ${r.err}`).toBe('137');
  });
  it('a SIGKILL that lands AFTER the deadline but BEFORE the grace keeps its 137', () => {
    // THE CONTROL FOR THE THRESHOLD ITSELF. A rule that claimed every signal
    // death past `secs` would relabel this one — and the real shape it stands
    // for is an outer SIGKILL on the deadline binary, which leaves the child
    // ORPHANED AND RUNNING while the shim reports a bound it never enforced.
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 2 bash -c 'trap "" TERM; sleep 3; kill -9 $$' >/dev/null 2>&1\nprintf %s "$?"`);
    expect(r.rc, `stderr: ${r.err}`).toBe('137');
  });
  it('a leading-zero deadline and grace are decimal, and write nothing to stderr', () => {
    // `$(( 08 ))` is a bash ERROR, and at the ten command-substitution call
    // sites its message would land in the very `$out` that `_session_probe`
    // requires to be EMPTY before it will call the substrate unmeasured.
    const r = drive('ccd', '_plat_timeout',
      `export CCD_TIMEOUT_KILL_AFTER=08\nout=$(@SHIM@ 08 bash -c 'trap "" TERM; sleep 30' 2>&1)\nprintf '%s|%s' "$?" "$out"`);
    expect(r.rc, `stderr: ${r.err}`).toBe('124|');
    expect(r.err).toBe('');
  });
  it('an ordinary answer, an ordinary failure and an exit 137 pass through', () => {
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 5 true >/dev/null 2>&1; a=$?\n@SHIM@ 5 bash -c 'exit 7' >/dev/null 2>&1; b=$?\n@SHIM@ 5 bash -c 'exit 137' >/dev/null 2>&1; c=$?\nprintf '%s %s %s' "$a" "$b" "$c"`);
    expect(r.rc).toBe('0 7 137');
  });
  it('a TERM-honouring child still reports 124 at the deadline, not at the grace', () => {
    const r = drive('ccd', '_plat_timeout', `@SHIM@ 1 sleep 30 >/dev/null 2>&1\nprintf %s "$?"`);
    expect(r.rc).toBe('124');
    expect(r.ms, 'the deadline waited out the grace on a child that honoured TERM').toBeLessThan(3000);
  });
  itDelegating('a hostile binary that refuses -k never sees it, and never leaks its rc', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'ccd-d2764-hostile-'));
    writeFileSync(path.join(bin, 'timeout'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$LOG"\ncase "$1" in -*) exit 1 ;; esac\nexec ${REAL_TIMEOUT} "$@"\n`);
    chmodSync(path.join(bin, 'timeout'), 0o755);
    const r = drive('ccd', '_plat_timeout',
      `export LOG=@HOME@/argv\n@SHIM@ 1 sleep 30 >/dev/null 2>&1\nprintf %s "$?"`, `${bin}:${process.env.PATH}`);
    expect(r.rc, `stderr: ${r.err}`).toBe('124');
    const argv = readFileSync(path.join(r.home, 'argv'), 'utf8').trim().split('\n');
    expect(argv[0]).toBe('-k 1 1 printf ccd-k-ok');
    expect(argv.slice(1).filter((l) => l.includes('-k')), `argv: ${JSON.stringify(argv)}`).toEqual([]);
  });
  itDelegating('a binary that SWALLOWS -k and exits 0 is not read as supporting it', () => {
    // WHY THE PROBE BELIEVES BYTES AND NOT AN EXIT CODE. A wrapper that
    // no-ops an unknown flag answers 0 having never run the command; an
    // rc-only probe reads that as support, passes `-k` to every real call and
    // turns every bounded call in the tree into an instant, silent SUCCESS.
    // Only a parser that consumed `-k`, consumed its argument and then exec'd
    // the command can print these bytes.
    const bin = mkdtempSync(path.join(tmpdir(), 'ccd-d2764-swallow-'));
    writeFileSync(path.join(bin, 'timeout'),
      `#!/usr/bin/env bash\ncase "$1" in -*) exit 0 ;; esac\nexec ${REAL_TIMEOUT} "$@"\n`);
    chmodSync(path.join(bin, 'timeout'), 0o755);
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 1 bash -c 'sleep 6; : > @HOME@/answered' >/dev/null 2>&1\nprintf %s "$?"`,
      `${bin}:${process.env.PATH}`);
    expect(r.rc, `stderr: ${r.err}`).toBe('124');
    expect(r.ms, 'the shim believed a binary that never ran the command').toBeGreaterThan(500);
  });
  it('busybox: a blown deadline is no longer reported as SUCCESS', () => {
    // Looked up on the filesystem rather than through `command -v` in a spawned
    // bash: a bash call site in a `ccd*` test file owes the whole containment
    // ceremony (`ccd-workspaces.test.ts`'s scan), and a probe that only wants to
    // know whether a binary exists should not be the thing that owes it.
    const bb = ['/usr/bin/busybox', '/bin/busybox', '/usr/local/bin/busybox'].find((p) => existsSync(p));
    if (!bb) return;
    const bin = mkdtempSync(path.join(tmpdir(), 'ccd-d2764-bb-'));
    symlinkSync(bb, path.join(bin, 'timeout'));
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 1 bash -c 'trap "" TERM; sleep 6; : > @HOME@/outlived' >/dev/null 2>&1\nprintf %s "$?"`,
      `${bin}:${process.env.PATH}`);
    expect(r.rc, `stderr: ${r.err}`).toBe('124');
    expect(existsSync(path.join(r.home, 'outlived'))).toBe(false);
  });
  for (const g of ['0', '1', 'none', '-1', '']) {
    it(`a grace of ${JSON.stringify(g)} cannot disarm the bound`, () => {
      const r = drive('ccd', '_plat_timeout',
        `export CCD_TIMEOUT_KILL_AFTER=${JSON.stringify(g)}\n@SHIM@ 1 bash -c 'trap "" TERM; sleep 9; : > @HOME@/outlived' >/dev/null 2>&1\nprintf %s "$?"`);
      expect(r.rc, `stderr: ${r.err}`).toBe('124');
      expect(existsSync(path.join(r.home, 'outlived'))).toBe(false);
      expect(r.ms, 'the bad grace disabled the escalation').toBeLessThan(9000);
    });
  }
  it('the child\'s stderr survives, and the shell\'s job line does not join it', () => {
    const r = drive('ccd', '_plat_timeout',
      `@SHIM@ 1 bash -c 'trap "" TERM; echo REAL-CHILD-STDERR >&2; sleep 9' >/dev/null 2>@HOME@/err\nprintf %s "$?"`);
    expect(r.rc).toBe('124');
    expect(readFileSync(path.join(r.home, 'err'), 'utf8')).toBe('REAL-CHILD-STDERR\n');
  });
  it('the pure-bash arm never escalates by pid — in all three copies', () => {
    for (const [label, file, name] of COPIES) {
      // COMMENTS BLANKED FIRST: the body ARGUES about the KILL it refuses to
      // issue, and on its first run this scan reported its own prose.
      const code = body(file, name).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      expect(code, `${label} escalates by pid in the fallback arm`)
        .not.toMatch(/kill\s+-(9|KILL)\b/);
    }
  });
});

// ── The strict neighbours (auto-advance Codex arm, plan W2 Task 11) ──────────────────────────────────────
// `_plat_timeout_capability` and `_plat_timeout_strict` sit beside `_plat_timeout` in the platform block, in
// `ccd/ccd` and `ccd/ccrc` alike, so they are measured on both copies. The hourly advance step runs automatic
// work (a lock, a writer, a canary, a hook) only where an escalating deadline exists, so it asks the OWNER of the
// deadline, through the ONE `-k` probe and the ONE first-selected-binary policy it already has: `strong` (the
// selected utility's `-k` is proved), `weak` (one is selected and its `-k` is not) or `none` (no `timeout` or
// `gtimeout`: the pure-bash arm would run). `_plat_timeout_strict` runs a program only on a strong one. They are
// NEIGHBOURS, not modes of `_plat_timeout`, because its body is byte-pinned against two more copies
// (`ccd-account-auth`, `ccgpt-runtime`) this change must leave alone; `_auth_timeout`, the table's third row, has
// neither and is not in this describe.
const PLATFORM_COPIES = COPIES.filter(([, , name]) => name === '_plat_timeout');
const NEIGHBOURS = ['_plat_timeout_capability', '_plat_timeout_strict'];

/** A directory holding ONLY the named programs, each a symlink to the system's own. A PATH made of it (and the
 *  harness's gh poison) has exactly those tools: `timeout`, `gtimeout` or `sleep` absent is a fact about it. */
function toolDir(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccd-tm11-tools-'));
  for (const n of names) {
    // `type -P`, never `command -v`: a builtin (`printf`, `true`) answers its bare name there, and a link to a
    // bare name is a dangling one. The programs a probe or a case execs must be files.
    const r = spawnSync('bash', ['-c', `type -P ${n}`], { encoding: 'utf8' });
    const p = r.stdout.trim();
    if (r.status === 0 && p !== '') symlinkSync(p, path.join(dir, n));
  }
  return dir;
}
const BASE_TOOLS = ['bash', 'printf', 'touch', 'true'];

describe('_plat_timeout_capability and _plat_timeout_strict (plan W2 Task 11)', () => {
  it('are spelled identically in the ccd script and in ccrc: the platform block is one definition', () => {
    for (const fn of NEIGHBOURS) expect(body('ccd', fn), `${fn} differs between ccd and ccrc`).toBe(body('ccrc', fn));
  });

  for (const [label, file, name] of PLATFORM_COPIES) {
    describe(label, () => {
      const run = (script: string, prefix?: string, grace = '2'): Run =>
        drive(file, name, `export CCD_TIMEOUT_KILL_AFTER=${grace}\n${script}`, prefix, NEIGHBOURS);

      itDelegating('answers strong for the system timeout, prints it, and leaves it in the calling shell', () => {
        const r = run(`out=$(_plat_timeout_capability); printf '%s|' "$out"\n_plat_timeout_capability >/dev/null\nprintf '%s' "\${CCD_TIMEOUT_CAPABILITY:-unset}"`);
        expect(r.rc, `stderr: ${r.err}`).toBe('strong|strong');
      });

      itDelegating('answers strong for a gtimeout alone', () => {
        const dir = toolDir(BASE_TOOLS);
        // A wrapper, not a link: a multi-call coreutils answers only to its own applet name.
        writeFileSync(path.join(dir, 'gtimeout'), `#!/bin/sh\nexec ${REAL_TIMEOUT} "$@"\n`);
        chmodSync(path.join(dir, 'gtimeout'), 0o755);
        const r = run(`_plat_timeout_capability >/dev/null; printf '%s' "$CCD_TIMEOUT_CAPABILITY"`, dir);
        expect(r.rc, `stderr: ${r.err}`).toBe('strong');
      });

      itDelegating('answers weak for a selected timeout that cannot prove -k, even with a strong gtimeout behind it', () => {
        const dir = toolDir(BASE_TOOLS);
        writeFileSync(path.join(dir, 'timeout'),
          `#!/usr/bin/env bash\ncase "$1" in -*) exit 1 ;; esac\nexec ${REAL_TIMEOUT} "$@"\n`);
        chmodSync(path.join(dir, 'timeout'), 0o755);
        writeFileSync(path.join(dir, 'gtimeout'), `#!/bin/sh\nexec ${REAL_TIMEOUT} "$@"\n`);
        chmodSync(path.join(dir, 'gtimeout'), 0o755);
        const r = run(`_plat_timeout_capability >/dev/null; printf '%s|' "$CCD_TIMEOUT_CAPABILITY"\n_plat_timeout_strict 5 bash -c ': > @HOME@/ran' >/dev/null 2>&1; printf '%s' "$?"`,
          `${dir}:${process.env.PATH}`);
        expect(r.rc, `stderr: ${r.err}`).toBe('weak|125');
        expect(existsSync(path.join(r.home, 'ran')), 'a weak utility ran the automatic target').toBe(false);
      });

      for (const [sleepWord, sleepBody] of [['a working sleep', null], ['no sleep at all', 'absent'], ['a sleep that refuses', '#!/bin/sh\nexit 1\n']] as const) {
        it(`answers none with no timeout utility, ${sleepWord}, and the strict call runs nothing`, () => {
          const dir = toolDir(sleepBody === null ? [...BASE_TOOLS, 'sleep'] : BASE_TOOLS);
          if (sleepBody !== null && sleepBody !== 'absent') {
            writeFileSync(path.join(dir, 'sleep'), sleepBody);
            chmodSync(path.join(dir, 'sleep'), 0o755);
          }
          const r = run(`out=$(_plat_timeout_capability); printf '%s|' "$out"\n_plat_timeout_capability >/dev/null\n`
            + `_plat_timeout_strict 5 bash -c ': > @HOME@/ran' >/dev/null 2>&1; printf '%s' "$?"`, dir);
          expect(r.rc, `stderr: ${r.err}`).toBe('none|125');
          expect(existsSync(path.join(r.home, 'ran')), 'the pure-bash fallback ran the automatic target').toBe(false);
        });
      }

      it('refuses with no proof at all: a shell that never asked for the capability runs nothing', () => {
        const r = run(`_plat_timeout_strict 5 bash -c ': > @HOME@/ran' >/dev/null 2>&1; printf '%s' "$?"`);
        expect(r.rc, `stderr: ${r.err}`).toBe('125');
        expect(existsSync(path.join(r.home, 'ran'))).toBe(false);
      });

      itDelegating('runs the program on a strong substrate, passes its status through, and ends a TERM-ignoring child at the deadline', () => {
        const r = run(`_plat_timeout_capability >/dev/null\n_plat_timeout_strict 5 bash -c 'exit 7' >/dev/null 2>&1; a=$?\n_plat_timeout_strict 5 true >/dev/null 2>&1; b=$?\n`
          + `_plat_timeout_strict 1 bash -c 'trap "" TERM; sleep 9; : > @HOME@/outlived' >/dev/null 2>&1; c=$?\nprintf '%s %s %s' "$a" "$b" "$c"`);
        expect(r.rc, `stderr: ${r.err}`).toBe('7 0 124');
        expect(existsSync(path.join(r.home, 'outlived')), `the child outlived its deadline (${r.ms}ms)`).toBe(false);
        expect(r.ms, 'the escalation did not land inside secs + grace').toBeLessThan(8000);
      });

      itDelegating('refuses a deadline it cannot read as whole seconds, and runs nothing', () => {
        const r = run(`_plat_timeout_capability >/dev/null\nfor d in abc '' '-1' 1x 5s 1m; do _plat_timeout_strict "$d" bash -c ': > @HOME@/ran' >/dev/null 2>&1; printf '%s ' "$?"; done`);
        // `5s` and `1m` are deadlines GNU timeout accepts, and the owner passes no `-k` for them (its grace is paid
        // only for a deadline it reads as whole seconds): a strict call may not run them.
        expect(r.rc, `stderr: ${r.err}`).toBe('125 125 125 125 125 125');
        expect(existsSync(path.join(r.home, 'ran'))).toBe(false);
      });

      itDelegating('refuses, rather than falling back, once the PATH is not the one the capability was proved for', () => {
        // THE PROOF BELONGS TO THE SELECTION IT WAS MADE FOR. A PATH that has since resolved `timeout` to another
        // file selects another utility, and strict execution refuses it; the capability question, asked again,
        // proves the new one.
        const a = toolDir(BASE_TOOLS);
        const b = toolDir(BASE_TOOLS);
        const sys = REAL_TIMEOUT ?? '/nonexistent';
        symlinkSync(sys, path.join(a, 'timeout'));
        symlinkSync(sys, path.join(b, 'timeout'));
        const r = run(`_plat_timeout_capability >/dev/null\nexport PATH=${JSON.stringify(`${b}:${a}`)}\n`
          + `_plat_timeout_strict 5 bash -c ': > @HOME@/ran-stale' >/dev/null 2>&1; printf '%s|' "$?"\n`
          + `_plat_timeout_capability >/dev/null; printf '%s|' "$CCD_TIMEOUT_CAPABILITY"\n`
          + `_plat_timeout_strict 5 bash -c ': > @HOME@/ran-fresh' >/dev/null 2>&1; printf '%s' "$?"`, a);
        expect(r.rc, `stderr: ${r.err}`).toBe('125|strong|0');
        expect(existsSync(path.join(r.home, 'ran-stale')), 'a stale capability ran the target').toBe(false);
        expect(existsSync(path.join(r.home, 'ran-fresh'))).toBe(true);
      });

      itDelegating('asking again after a PATH change re-proves through the owner: a weak utility behind a strong one is weak', () => {
        // The owner caches its `-k` proof for the life of the shell. The capability question must not inherit
        // that cache across a change of selection: the second answer is about the second utility.
        const strong = toolDir(BASE_TOOLS);
        symlinkSync(REAL_TIMEOUT!, path.join(strong, 'timeout'));
        const weak = toolDir(BASE_TOOLS);
        writeFileSync(path.join(weak, 'timeout'),
          `#!/usr/bin/env bash\ncase "$1" in -*) exit 1 ;; esac\nexec ${REAL_TIMEOUT} "$@"\n`);
        chmodSync(path.join(weak, 'timeout'), 0o755);
        const r = run(`_plat_timeout_capability >/dev/null; printf '%s|' "$CCD_TIMEOUT_CAPABILITY"\n`
          + `export PATH=${JSON.stringify(`${weak}:${process.env.PATH}`)}\n_plat_timeout_capability >/dev/null; printf '%s' "$CCD_TIMEOUT_CAPABILITY"`, strong);
        expect(r.rc, `stderr: ${r.err}`).toBe('strong|weak');
      });
    });
  }
});
