// Part D of the ccd-queue-platform-shim-and-doctor-coverage plan
// (docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md,
// D-2376 through D-2380): FOUR families of `ccd/ccd` guard that admit a FIFO
// or an unbounded character device through an `-e`/`-r` test and then open
// the path BY NAME — D1's `source`, D2's `cat` family (the hold family, five
// call sites, one shape), D3's bash `grep FILE`, and D4's FOUR Python
// `open()`s in `_pr_py`'s `state` mode (`put`'s tmp file, `get`, the
// compare-and-set lock, and the prhistory append), one `describe` block
// below per family. Each one hangs the reader FOREVER on the
// shapes this file plants. `_project_pool_state` (NAMED BY FUNCTION, NOT
// LINE — a line number here goes stale the moment anything above it grows)
// is the pattern every fix here copies: a type test (`-f`+`-r`, or
// `os.path.isfile`, its Python twin) checked BEFORE any attempt to open, so
// the shape alone decides — never a read.
//
// DOUBLE-BOUNDED, the same reason `ccd-project-pool.test.ts`'s `boundedState`
// is: vitest's own per-test timeout cannot fire while `execFileSync` blocks
// the event loop it needs, so the bound has to live on the CHILD PROCESS.
// `execFileSync`'s own `timeout` option SIGTERMs only the DIRECT child
// (`bash`) and throws `.code === 'ETIMEDOUT'` — it does NOT reach a
// grandchild blocked on a FIFO open inside a command-substitution subshell,
// which is exactly what most cases below plant, so that option alone leaks
// an immortal process per HANGING case (measured on this box: dozens of blocked
// `cat`/`grep`/`python3` children surviving hours past the run that spawned
// them, some inherited from a SIBLING suite and aged 7.5 days). `runBounded`
// below instead spawns through GNU `timeout -k 1 <secs> bash -c …`, which
// puts `bash` in its OWN process group and signals the whole GROUP on
// expiry — every descendant blocked on the same FIFO dies with it — and the
// hang case is `rc === 124`, not an `ETIMEDOUT` exception. `runBounded`
// turns that into a normal, readable test failure — "this hung" — never a
// real hang; the vitest-level `}, 10000)` on every case that plants a
// hanging shape is the second, independent bound.
//
// A case whose shape does not actually hang the PRE-FIX code is deliberately
// left OUT of the hang-shape tables below — such a case is green before the
// fix and pins nothing (this file's own brief). MEASURED, not assumed, for
// the three shapes this reasoning actually touches:
//  - D1's directory shape (account roster) IS in this file, in its own
//    `describe` block below, and WAS red pre-fix: the pre-fix ccd answers a
//    generic `source: … is a directory` plus the roster's own `account
//    roster unreadable` die, with no `not a regular file` in it — it is the
//    case whose MESSAGE this fix corrects, not one that pins nothing.
//  - The four echo-fallback D2 sites' directory shape is excluded because it
//    genuinely does NOT hang pre-fix (`cat`'s own EISDIR trips the existing
//    `|| echo` fallback promptly) — but it is NOT "already covered
//    elsewhere" either, uniformly: `cmd_forget`'s site is the uncovered one;
//    `ccd-hold.test.ts` and `ccd-ws-rename.test.ts` plant a directory at
//    `$REG/<id>.hold` for `cmd_ws_rm`, `cmd_ws_reap` and `cmd_ws_rename`. A
//    true gap for `cmd_forget` alone, left as one, because behaviour there is
//    unchanged by this fix either way (directory already satisfied `-e`
//    before it, same as after).
//  - D3's directory shape at `<cfg>/sessions/<pid>.json` is excluded for the
//    same non-hang reason, and it is likewise NOT covered elsewhere: neither
//    `ccd-hold.test.ts` nor `ccd-ws-rename.test.ts` — nor any other file in
//    this tree — touches that path with a directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, harnessBin, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';
import { readJournal, measOf } from './lifecycleHelpers.js';

type Bounded = { code: number; stdout: string; stderr: string };

// THE DEADLINE BINARY ITSELF, RESOLVED ONCE, BY ABSOLUTE PATH — same remedy commit
// f27c8a86 (PR #130, "test-macos is red on a hard-coded /usr/bin/timeout") ships for the
// identical class. A bare `execFileSync('timeout', …)` resolves against the CHILD's PATH,
// and this repo's own `ci.yml` guarantees a bare `timeout` is ABSENT on `test-macos` (BSD
// userland, no gnubin on PATH) — an ENOENT there sets no `e.status`, so a naive `catch`
// used to fall through to the generic `{code: e.status ?? 1, …}` return, a SILENT,
// sometimes-GREEN non-measurement for every case in this file. `gtimeout` (installed by
// that job's own `brew install … coreutils` step) is resolved as the fallback, exactly as
// `_plat_timeout` itself tries `timeout` then `gtimeout`. Resolved HERE, at module scope,
// while PATH is still the runner's own.
//
// PRESENCE ON PATH IS NOT ENOUGH: a busybox-shaped `timeout` that refuses `-k` (`case "$1"
// in -k) exit 125;; esac`) resolves via `command -v`, then answers every hang case's own
// probe with `{code: 125, stdout: ''}` before the guard under test ever runs — which
// satisfies `expect(r.code).not.toBe(0)` and `expect(r.stdout.trim()).toBe('')` in every
// D3 hang/absent-path case, four cases GREEN while measuring nothing (this repo books
// exactly that busybox `timeout` shape as live: D-2840). So the candidate is PROBED, not
// merely resolved: `<bin> -k 1 0.1 sleep 5` is a known-124 command (a 5s sleep bounded to
// 0.1s must expire), and a candidate that does not answer 124 is treated as absent and the
// loop tries the next one — a probe failure folds into `NO_DEADLINE_BIN` exactly like an
// absent binary, never into a silently-degraded pass.
const DEADLINE_BIN: string | null = (() => {
  for (const candidate of ['timeout', 'gtimeout']) {
    const r = spawnSync('sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' });
    if (r.status !== 0 || r.stdout.trim() === '') continue;
    const bin = r.stdout.trim();
    const probe = spawnSync(bin, ['-k', '1', '0.1', 'sleep', '5'], { encoding: 'utf8' });
    if (probe.status === 124) return bin;
  }
  return null;
})();
// NO DEADLINE BINARY -> every `describe` below is WRAPPED in `.skipIf(NO_DEADLINE_BIN)`,
// never silently downgraded. A skip is visible in the report as a skip; the thing this
// finding forbids is a case that reads GREEN while it measured nothing.
const NO_DEADLINE_BIN = DEADLINE_BIN === null;

/** The one driver every case below goes through — `source "$CCD"` plus a
 *  snippet, under the CHILD PROCESS's own bound (never vitest's), the exact
 *  reason `boundedState` (`ccd-project-pool.test.ts`) builds its own
 *  `execFileSync` too. Takes `home` explicitly rather than closing over a
 *  module-level harness variable, because D4's describe block below runs its
 *  own `PrHarness` alongside the outer `CcdHarness`.
 *
 *  Spawns through GNU `timeout -k 1 <secs> bash -c …`, NOT via
 *  `execFileSync`'s own `timeout` option — that option SIGTERMs only the
 *  DIRECT child, never a grandchild blocked on a FIFO open inside a
 *  command-substitution subshell, which is exactly what every hang case
 *  below plants (measured: `bash -c 'x=$(cat fifo)'` under
 *  `execFileSync(..., {timeout})` leaves `cat` running forever after the
 *  parent throws `ETIMEDOUT`). GNU `timeout` puts `bash` in its OWN process
 *  group and signals the whole GROUP on expiry (measured: `timeout -k1 2
 *  bash -c 'x=$(cat fifo)'` — `timeout`, `bash` and the grandchild `cat` all
 *  share one pgid, and all three are gone after the 124), so every
 *  descendant blocked on the same FIFO dies with it. The hang case is
 *  `rc === 124`, not an `ETIMEDOUT` exception.
 *
 *  `rc 124` IS OVERLOADED AT THIS SEAM: it is also GNU `timeout`'s own expiry code, so
 *  a case whose SNIPPET itself shells through `ccd`'s `_plat_timeout` could not be told
 *  apart from this driver's own bound firing — and all six D4 cases DO shell through
 *  `_plat_timeout` (`cmd_pr_state` → `_gh_pr_list`), not zero: `GH_STUB` (`ccdPrHelpers.ts`)
 *  shadows `timeout` with a shell function that returns 125 on a flag and otherwise
 *  `exec`s the wrapped command unbounded, so no INNER 124 can be produced by those cases
 *  TODAY — but that is `GH_STUB`'s doing, not an absence of the call, and a D4 case that
 *  drops `GH_STUB` reopens the ambiguity this paragraph describes. Distinguishing the two
 *  124s in general would need a different code or a sentinel on this driver's own
 *  invocation; undone here, disclosed instead. */
function runBounded(home: string, snippet: string, ms = 5000): Bounded {
  // Defense in depth: every call site is reached only from a `describe.skipIf(NO_DEADLINE_BIN)`
  // block, but a hard THROW here — never a silent `{code: 1}` — is what this guard is FOR.
  if (DEADLINE_BIN === null) {
    throw new Error('runBounded: no `timeout` or `gtimeout` on PATH — cannot bound this call safely');
  }
  const secs = String(ms / 1000);
  try {
    const out = execFileSync(
      DEADLINE_BIN, ['-k', '1', secs, 'bash', '-c', `source "${CCD}"; ${snippet}`],
      { encoding: 'utf8', cwd: home,
        env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) },
    );
    return { code: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException
      & { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    if (e.status === 124) {
      throw new Error(
        `runBounded(${JSON.stringify(snippet)}) did not return within ${ms}ms `
        + '— either the guard regressed or this box is loaded; re-run in isolation before concluding');
    }
    return { code: e.status ?? 1, stdout: String(e.stdout ?? '').trim(), stderr: String(e.stderr ?? '') };
  }
}

type BadShape = 'fifo' | 'symlink-fifo' | 'symlink-devzero' | 'directory';

/** Plants one of the four shapes at an arbitrary path. FIFO / symlink-to-FIFO
 *  / symlink-to-an-infinite-character-device are the three that HANG a
 *  read-by-name; directory is included only at D1's site (the account
 *  roster), where its answer differs before/after the fix even though it
 *  never hung (`source` on a directory fails fast with EISDIR — the pre-fix
 *  MESSAGE is wrong, not the promptness). `cmd_ws_release` deliberately has
 *  NO directory case — see the comment above its `describe.each` below. */
function plantBad(p: string, shape: BadShape): void {
  fs.rmSync(p, { force: true, recursive: true });
  switch (shape) {
    case 'fifo': execFileSync('mkfifo', [p]); break;
    case 'symlink-fifo': {
      const real = `${p}.real-fifo`;
      execFileSync('mkfifo', [real]);
      fs.symlinkSync(real, p);
      break;
    }
    case 'symlink-devzero': fs.symlinkSync('/dev/zero', p); break;
    case 'directory': fs.mkdirSync(p, { recursive: true }); break;
  }
}

const HANG_SHAPES: Array<[string, BadShape]> = [
  ['a FIFO', 'fifo'],
  ['a symlink to a FIFO', 'symlink-fifo'],
  ['a symlink to an infinite character device (/dev/zero)', 'symlink-devzero'],
];

describe.skipIf(NO_DEADLINE_BIN)('D1 — the account roster `source`, module top level (D-2377)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-bounded-d1-'); });
  afterEach(() => { h.cleanup(); });

  const ACCOUNTS_SH = (): string => path.join(h.home, '.ccrc', 'accounts.sh');
  const boundedRun = (snippet: string, ms = 5000): Bounded => runBounded(h.home, snippet, ms);

  for (const [label, shape] of HANG_SHAPES) {
    it(`dies with "not a regular file", PROMPTLY — never hangs, for ${label} account roster`, () => {
      // THE WORST SITE IN THE FILE: this `source` runs at MODULE TOP LEVEL, so
      // it is not one verb's exposure — it is every `ccd` process on the box.
      plantBad(ACCOUNTS_SH(), shape);
      const r = boundedRun('true');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('not a regular file');
      // The two existing die sentences (absent / unreadable) must survive
      // untouched — this is a THIRD arm, not a replacement.
      expect(r.stderr).not.toContain('no account roster at');
      expect(r.stderr).not.toContain('exists but is not readable by');
    }, 10000);
  }

  // Directory does not hang even pre-fix (`source` on a directory fails fast
  // with EISDIR) — kept anyway because the MESSAGE changes: pre-fix, a
  // directory falls through `-e`+`-r` (both true for a directory) into
  // `source`'s own generic "unreadable" die, which is the wrong diagnosis.
  it('dies with "not a regular file", PROMPTLY, for a directory at the roster path', () => {
    plantBad(ACCOUNTS_SH(), 'directory');
    const r = boundedRun('true');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a regular file');
  }, 10000);

  it('still dies with the ABSENT sentence for a genuinely missing roster (unchanged)', () => {
    fs.rmSync(ACCOUNTS_SH(), { force: true });
    const r = boundedRun('true');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no account roster at');
  }, 10000);

  // root defeats chmod — the house pattern (`ccd-project-pool.test.ts`'s own
  // `it.skipIf(process.getuid?.() === 0)`), because a mode-000 file IS `-r`
  // under root and the assertion below would need to invert rather than skip.
  it.skipIf(process.getuid?.() === 0)(
    'still dies with the UNREADABLE sentence for a mode-000 regular file (unchanged)', () => {
      fs.writeFileSync(ACCOUNTS_SH(), 'CCRC_HOME_ABLE=()\n');
      fs.chmodSync(ACCOUNTS_SH(), 0o000);
      try {
        const r = boundedRun('true');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('exists but is not readable by');
      } finally {
        fs.chmodSync(ACCOUNTS_SH(), 0o644);
      }
    }, 10000);
});

describe.skipIf(NO_DEADLINE_BIN)('D2 — the hold family, five sites, one shape (D-2378)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-bounded-d2-'); });
  afterEach(() => { h.cleanup(); });

  const REG = (): string => path.join(h.home, '.cc-sessions');
  const HOLD = (id: string): string => path.join(REG(), `${id}.hold`);
  const boundedRun = (snippet: string, ms = 5000): Bounded => runBounded(h.home, snippet, ms);

  function regSet(id: string, field: string, value: string): void {
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), `${id}.${field}`), value);
  }

  describe.each(HANG_SHAPES)('for %s at the hold path', (_label, shape) => {
    it('cmd_ws_rm answers "held: <unreadable — treat as held>", PROMPTLY — never hangs', () => {
      const id = 'demo-quiet-basin';
      regSet(id, 'uuid', 'u'); regSet(id, 'workspace', 'quiet-basin');
      regSet(id, 'project', 'demo'); regSet(id, 'workdir', `/w/${id}`);
      plantBad(HOLD(id), shape);
      const r = boundedRun(`cmd_ws_rm ${id}`);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('held');
      expect(r.stderr).toContain('<unreadable — treat as held>');
    }, 10000);

    it('cmd_ws_rename answers {"refused":"held",…} with the unreadable marker, PROMPTLY', () => {
      const id = 'demo-quiet-mesa';
      regSet(id, 'uuid', 'u');
      plantBad(HOLD(id), shape);
      const r = boundedRun(`cmd_ws_rename --session ${id} --branch feat/real-name`);
      expect(r.code).toBe(0);
      // Parsed, not a raw-substring check: `_json_str` deliberately
      // emits `ensure_ascii` JSON, so the em-dash is `—` on the wire —
      // JSON.parse is what un-escapes it back to the real character.
      const o = JSON.parse(r.stdout) as { refused: string; detail: string };
      expect(o.refused).toBe('held');
      expect(o.detail).toContain('<unreadable — treat as held>');
    }, 10000);

    it('cmd_ws_reap answers {"refused":"held",…} with the unreadable marker, PROMPTLY', () => {
      const id = 'demo-quiet-cove';
      plantBad(HOLD(id), shape);
      const r = boundedRun(`cmd_ws_reap --expect ${'a'.repeat(64)} --session ${id}`);
      expect(r.code).toBe(0);
      const o = JSON.parse(r.stdout) as { refused: string; detail: string };
      expect(o.refused).toBe('held');
      expect(o.detail).toContain('<unreadable — treat as held>');
    }, 10000);

    it('cmd_forget answers "held: <unreadable — treat as held>", PROMPTLY', () => {
      const id = 'claude-corp-demo';
      regSet(id, 'uuid', 'u');
      plantBad(HOLD(id), shape);
      const r = boundedRun(`cmd_forget ${id}`);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('held');
      expect(r.stderr).toContain('<unreadable — treat as held>');
    }, 10000);
  });

  // `cmd_ws_release` — THE TRAP: it is the verb that DELETES the hold, so its
  // polarity is reversed from the other four, it has NO `|| echo` fallback
  // today, and its `rm -f` unlink sits two lines BELOW its read.
  //
  // DIRECTORY IS DELIBERATELY NOT IN THIS TABLE, unlike the other four sites'
  // shape choices — a directory hold does not hang here (measured), but it
  // does not survive the verb EITHER, for a reason outside this fix's scope:
  // `cmd_ws_release`'s own `rm -f -- "$REG/$id.hold"` unlink has no `-r`, so it fails on a
  // directory with "Is a directory" and the verb dies "STILL held" — an
  // out-of-scope, PRE-EXISTING defect in the unlink, not the read this task
  // was asked to bound. Reported in this file's own report as a finding, not
  // fixed here (would touch a line the brief did not name, and the brief's
  // own `meas.held` question is about the READ, not the unlink).
  describe.each(HANG_SHAPES)(
    'cmd_ws_release, for %s at the hold path', (_label, shape) => {
      it('releases PROMPTLY — never hangs — and meas.held carries its own distinct release-time marker', () => {
        const id = 'demo-quiet-vale';
        regSet(id, 'uuid', 'u');
        plantBad(HOLD(id), shape);
        const r = boundedRun(`cmd_ws_release --session ${id}`);
        expect(r.code).toBe(0);
        expect(r.stdout).toContain(`released ${id}`);
        expect(fs.existsSync(HOLD(id)), 'the hold must still be cleared').toBe(false);

        const releaseEvents = readJournal(h.home).filter((e) => e['act'] === 'release');
        expect(releaseEvents.length).toBeGreaterThan(0);
        const held = measOf(releaseEvents[releaseEvents.length - 1]!)['held'];
        // ONE POSITIVE literal, not two negatives: an empty `meas.held` is
        // not merely undesirable, it is UNREPRESENTABLE on this wire at all
        // (`_lc_json`'s own encoder drops any key whose value is `""` before
        // it ever reaches the line, so an empty value here would not write
        // a disagreeing record, it would write NO `held` key whatsoever —
        // `measOf(...)['held']` would then be `undefined`, and
        // `expect(undefined).not.toBe('')` / `.not.toBe('<unreadable —
        // treat as held>')` BOTH pass). A negative pair pins nothing the
        // marker actually decided; only the exact string does.
        expect(held).toBe('<unreadable — hold present but could not be read at release>');
      }, 10000);
    },
  );

  it('cmd_ws_release still records the reason VERBATIM for a genuinely readable hold (unchanged)', () => {
    const id = 'demo-quiet-plain';
    regSet(id, 'uuid', 'u');
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(HOLD(id), 'program:x wave:1/4');
    const r = boundedRun(`cmd_ws_release --session ${id}`);
    expect(r.code).toBe(0);
    const releaseEvents = readJournal(h.home).filter((e) => e['act'] === 'release');
    expect(measOf(releaseEvents[releaseEvents.length - 1]!)['held']).toBe('program:x wave:1/4');
  }, 10000);
});

describe.skipIf(NO_DEADLINE_BIN)('D3 — `_ws_status`, the one unguarded reader of four (D-2379)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-bounded-d3-'); });
  afterEach(() => { h.cleanup(); });

  const boundedRun = (snippet: string, ms = 5000): Bounded => runBounded(h.home, snippet, ms);

  /** `_alive` true with a fixed pane pid, and `wrapper` bound to `claude` —
   *  the exact shape `ccd-archive.test.ts`'s own `LIVE`/`withStatus` fixture
   *  uses to make `_ws_status` fall through past `_session_verdict`'s
   *  `gone`/`unknown` early-outs and actually reach the sessions-JSON read. */
  const STUB = `_session_verdict() { echo live; };
    tmux() { case "$1" in list-panes) echo 4242 ;; *) : ;; esac; };`;

  function seedWrapper(id: string): void {
    const reg = path.join(h.home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), 'claude');
  }

  function sessionJsonPath(): string {
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    return path.join(cfg, '4242.json');
  }

  for (const [label, shape] of HANG_SHAPES) {
    it(`answers non-zero ("cannot be read"), PROMPTLY — never hangs, for ${label} sessions JSON`, () => {
      const id = 'demo';
      seedWrapper(id);
      plantBad(sessionJsonPath(), shape);
      const r = boundedRun(`${STUB} _ws_status ${id}`);
      expect(r.code).not.toBe(0);
      expect(r.stdout.trim()).toBe('');
    }, 10000);
  }

  it('still answers idle/busy for a real sessions JSON (unchanged)', () => {
    const id = 'demo';
    seedWrapper(id);
    fs.writeFileSync(sessionJsonPath(), JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
    expect(boundedRun(`${STUB} _ws_status ${id}`).stdout).toBe('idle');
    fs.writeFileSync(sessionJsonPath(), JSON.stringify({ status: 'busy', statusUpdatedAt: 1 }));
    expect(boundedRun(`${STUB} _ws_status ${id}`).stdout).toBe('busy');
  }, 10000);

  it('still answers non-zero for an ABSENT sessions JSON (unchanged — the pre-existing rung this adds beside)', () => {
    const id = 'demo';
    seedWrapper(id);
    fs.rmSync(sessionJsonPath(), { force: true });
    const r = boundedRun(`${STUB} _ws_status ${id}`);
    expect(r.code).not.toBe(0);
  }, 10000);
});

describe.skipIf(NO_DEADLINE_BIN)('D4 — `_pr_py`\'s Python opens in `state` mode — FOUR, not two (D-2380)', () => {
  let hp: PrHarness;
  beforeEach(() => { hp = makePrHarness('ccrc-ccd-bounded-d4-'); });
  afterEach(() => { hp.cleanup(); });

  // 15000, not the family default 5000 (final-round item 5): measured
  // 788ms in isolation for the case that failed at the 5000ms bound running
  // alongside the other 21 `ccd-[a-f,h]*` files — 6.4x headroom on a box
  // CLAUDE.md already calls load-sensitive was not enough. The `it(...)`
  // trailing timeout below is raised to 20000 to match — it must stay above
  // this bound or vitest's own per-test timeout fires first and hides the
  // driver's readable "did not return within Nms" message.
  const boundedPrRun = (snippet: string, ms = 15000): Bounded => runBounded(hp.home, snippet, ms);

  /** `demo-quiet-basin`, zero-commit — the identical fixture
   *  `ccd-prhistory.test.ts`'s own `workspace()` builds, for the identical
   *  reason: `is_ours` accepts a `headRefOid` equal to the branch's own tip,
   *  so no extra commit is needed to bind gh's row to this workspace. */
  const workspace = (): { id: string; tip: string } => {
    const main = hp.makeGhRepo('demo');
    hp.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    return { id: 'demo-quiet-basin', tip: hp.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') };
  };

  const REG = (): string => path.join(hp.home, '.cc-sessions');

  it('get(): a FIFO at $REG/<id>.prcheckedat is treated as absent, PROMPTLY — never hangs the sweep', () => {
    // `get()` backs THREE reads in this mode (prcheckedat, prnumber, prphase)
    // — one guard fixes all three, so pinning it on the first-called field is
    // sufficient. `except FileNotFoundError` alone cannot catch this: `open()`
    // itself blocks, so the handler is never reached (D-2380's own finding).
    const { id, tip } = workspace();
    const p = path.join(REG(), `${id}.prcheckedat`);
    execFileSync('mkfifo', [p]);
    hp.ghRows([mergedRow({ number: 591, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).toBe(0);
    // Self-healing: the FIFO is gone, replaced by `put`'s atomic tmp+replace —
    // proof the sweep proceeded rather than merely swallowing an error.
    expect(fs.statSync(p).isFIFO()).toBe(false);
  }, 20000);

  it('the compare-and-set lock: a FIFO at $REG/.prstate-<id>.lock proceeds UNLOCKED, PROMPTLY', () => {
    // `open(path, 'a')` blocks until a READER appears — `except OSError`
    // cannot fire for a block, only for an error, so the disclosed "proceed
    // unlocked" arm around `_pr_py`'s own lock-open `try` (D-139, NAMED BY
    // FUNCTION, NOT LINE) does not cover a hang. Same
    // guarantee this file's own comment states must survive: "this guard may
    // only remove races, never add a refusal that stops a phase from ever
    // updating" — so the write must still land, just unlocked.
    const { id, tip } = workspace();
    const lockPath = path.join(REG(), `.prstate-${id}.lock`);
    execFileSync('mkfifo', [lockPath]);
    hp.ghRows([mergedRow({ number: 591, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(REG(), `${id}.prnumber`), 'utf8')).toBe('591');
  }, 20000);

  it('the prhistory append: a FIFO at $REG/<id>.prhistory faults PROMPTLY rather than hanging the whole sweep', () => {
    // THE FOURTH OPEN, not the third — `get()`, `put()`'s own tmp file, the
    // lock and this append are four sites in the same mode, not two (the
    // plan's original count) and not three (this same wave's first
    // correction, which still missed `put()`'s tmp). Corrected in place
    // again, no new deviation number (controller ruling: a stale COUNT
    // under an already-allocated number is that number going stale, not a
    // new subject). Reached only on the old_num != number transition — a
    // pre-seeded `.prnumber` stands in for a first sweep, so one call is
    // enough to reach it. A HANG here would wedge `cmd_pr_state`'s per-id
    // loop for every OTHER session too; a FAULT (non-zero, prompt) is a
    // strict improvement even though it costs this one row's update, because
    // it is bounded and visible where a hang is neither.
    const { id, tip } = workspace();
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), `${id}.prnumber`), '591');
    const histPath = path.join(REG(), `${id}.prhistory`);
    execFileSync('mkfifo', [histPath]);
    hp.ghRows([mergedRow({ number: 601, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).not.toBe(0);
    // A non-zero exit for ANY unrelated reason would satisfy a bare
    // `not.toBe(0)` — bind the SENTENCE, mirroring how D1's cases bind
    // their `die` sentence, so a regression that faults for some OTHER
    // reason cannot pass this case by accident.
    expect(r.stderr).toContain('refusing to append to a non-regular-file prhistory');
  }, 20000);

  it("put(): a FIFO already at the pid-named tmp path (pid reuse) faults PROMPTLY rather than hanging the whole sweep", () => {
    // `put`'s tmp name embeds `os.getpid()`, unknowable to this test ahead of
    // the real interpreter starting — so a `python3` SHIM stands in first on
    // PATH (inside `harnessBin`, already the head of every PATH this harness
    // builds) that `exec`s straight into the real interpreter: `exec` never
    // forks, so the shim's own `$$` IS the pid the real interpreter goes on
    // to report from `os.getpid()`, and the shim plants the FIFO at that
    // exact path before handing off. This is what pid reuse looks like on a
    // live fleet host: a stale name left behind by a DIFFERENT, earlier
    // holder of the same pid.
    const { id, tip } = workspace();
    fs.mkdirSync(REG(), { recursive: true });
    const shim = path.join(harnessBin(hp.home), 'python3');
    fs.writeFileSync(shim,
      '#!/bin/bash\n'
      + `mkfifo "${path.join(REG(), `.${id}.prcheckedat.$$.tmp`)}" 2>/dev/null || true\n`
      + 'exec /usr/bin/python3 "$@"\n', { mode: 0o755 });
    hp.ghRows([mergedRow({ number: 591, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('refusing to write a non-regular-file pr-state tmp');
  }, 20000);

  it('put(): a stale REGULAR file already at the pid-named tmp path is still overwritten normally (unchanged)', () => {
    // The other half of the same guard's contract: `os.path.isfile` cannot
    // be the sole test for a `'w'`-mode CREATE, because a stale REGULAR tmp
    // (left by, say, a prior crash between `open` and `os.replace`) must
    // still be truncated and reused, not refused. Same shim technique as
    // the FIFO case above, planting a regular file instead.
    const { id, tip } = workspace();
    fs.mkdirSync(REG(), { recursive: true });
    const shim = path.join(harnessBin(hp.home), 'python3');
    fs.writeFileSync(shim,
      '#!/bin/bash\n'
      + `printf 'stale' > "${path.join(REG(), `.${id}.prcheckedat.$$.tmp`)}"\n`
      + 'exec /usr/bin/python3 "$@"\n', { mode: 0o755 });
    hp.ghRows([mergedRow({ number: 591, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(REG(), `${id}.prcheckedat`), 'utf8')).not.toBe('stale');
  }, 20000);

  it('still appends prhistory normally when the path is a regular file (unchanged)', () => {
    const { id, tip } = workspace();
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), `${id}.prnumber`), '591');
    hp.ghRows([mergedRow({ number: 601, headRefOid: tip })]);
    const r = boundedPrRun(`${GH_STUB} cmd_pr_state --session ${id}`);
    expect(r.code).toBe(0);
    const rows = fs.readFileSync(path.join(REG(), `${id}.prhistory`), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { pr: number });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pr).toBe(591);
  }, 20000);
});

describe.skipIf(NO_DEADLINE_BIN)('D5 — `cmd_project_pool`\'s registry-row existence glob, unguarded (D-2925)', () => {
  // `cmd_project_pool`'s `--pool` arm proves a registry-only project exists
  // with `grep -qxF -- "$project" "$REG"/*.project 2>/dev/null` — a GLOB, not
  // a single named path, so `grep` opens EVERY matched `.project` row BY
  // NAME, in glob (sort) order, before it can report a match or a miss. A
  // FIFO or a symlink-to-an-infinite-character-device among those rows
  // blocks `grep`'s `open(2)` (or its `read(2)`) forever — the exact class
  // `_project_pool_state` (`_project_pool_state`'s own header, above) already
  // closes for the SINGLE-file read; this glob is the second, unguarded
  // reader of the same directory. A bad row sorting BEFORE the real one is
  // the shape that actually blocks: `grep` never reaches the row that would
  // have answered.
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-ccd-bounded-d5-'); });
  afterEach(() => { h.cleanup(); });

  const boundedRun = (snippet: string, ms = 5000): Bounded => runBounded(h.home, snippet, ms);
  const REG = (): string => path.join(h.home, '.cc-sessions');

  for (const [label, shape] of HANG_SHAPES) {
    it(`still tags a registry-row project, PROMPTLY — never hangs, past ${label} sorting BEFORE the real row`, () => {
      fs.mkdirSync(REG(), { recursive: true });
      // Alphabetically FIRST, so the unguarded glob's `grep` opens this row
      // before it ever reaches the real one below.
      plantBad(path.join(REG(), 'aaa-blocker.project'), shape);
      fs.writeFileSync(path.join(REG(), 'zzz-real.project'), 'quiet-basin');
      const r = boundedRun('cmd_project_pool --project quiet-basin --pool pool-a');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('tagged quiet-basin pool-a');
    }, 10000);
  }

  it('still refuses "no such project" when every .project row is an ordinary file (unchanged)', () => {
    fs.mkdirSync(REG(), { recursive: true });
    fs.writeFileSync(path.join(REG(), 'zzz-real.project'), 'quiet-basin');
    const r = boundedRun('cmd_project_pool --project never-existed --pool pool-a');
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain('tagged');
  }, 10000);
});
