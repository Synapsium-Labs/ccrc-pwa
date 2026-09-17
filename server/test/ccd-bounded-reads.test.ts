// Part D of the ccd-queue-platform-shim-and-doctor-coverage plan
// (docs/superpowers/plans/2026-09-09-ccd-queue-platform-shim-and-doctor-coverage.md,
// D-2376 through D-2380): five families of `ccd/ccd` guard that admit a FIFO
// or an unbounded character device through an `-e`/`-r` test and then open
// the path BY NAME — `source`, `cat`, a bash `grep FILE`, and three Python
// `open()`s. Each one hangs the reader FOREVER on the shapes this file
// plants. `_project_pool_state` (ccd:1470) is the pattern every fix here
// copies: a type test (`-f`+`-r`, or `os.path.isfile`, its Python twin)
// checked BEFORE any attempt to open, so the shape alone decides — never a
// read.
//
// DOUBLE-BOUNDED, the same reason `ccd-project-pool.test.ts`'s `boundedState`
// is: vitest's own per-test timeout cannot fire while `execFileSync` blocks
// the event loop it needs, so the bound has to live on the CHILD PROCESS —
// `execFileSync`'s own `timeout` option, which SIGTERMs the child and throws
// an error with `.code === 'ETIMEDOUT'` (`.killed` is NOT set on that error).
// `runBounded` below turns a regression into a normal, readable test failure
// — "this hung" — never a real hang; the vitest-level `}, 10000)` on every
// case that plants a hanging shape is the second, independent bound.
//
// A case whose shape does not actually hang the PRE-FIX code (a directory at
// a `cat`-guarded path, for instance, already fails fast with `cat`'s own
// EISDIR) is deliberately left OUT of the hang-shape tables below — such a
// case is green before the fix and pins nothing (this file's own brief). The
// four echo-fallback D2 sites' directory shape and D3/D1's directory shape
// are exactly that, and are already covered as regression pins in
// `ccd-hold.test.ts`/`ccd-ws-rename.test.ts`; this file is not a second copy
// of them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';
import { readJournal, measOf } from './lifecycleHelpers.js';

type Bounded = { code: number; stdout: string; stderr: string };

/** The one driver every case below goes through — `source "$CCD"` plus a
 *  snippet, under the CHILD PROCESS's own timeout (never vitest's), the exact
 *  shape `boundedState` (ccd-project-pool.test.ts:41-66) uses. Takes `home`
 *  explicitly rather than closing over a module-level harness variable,
 *  because D4's describe block below runs its own `PrHarness` alongside the
 *  outer `CcdHarness`. */
function runBounded(home: string, snippet: string, ms = 5000): Bounded {
  try {
    const out = execFileSync(
      'bash', ['-c', `source "${CCD}"; ${snippet}`],
      { encoding: 'utf8', cwd: home, timeout: ms,
        env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) },
    );
    return { code: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    const e = err as NodeJS.ErrnoException
      & { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    if (e.code === 'ETIMEDOUT') {
      throw new Error(
        `runBounded(${JSON.stringify(snippet)}) did not return within ${ms}ms `
        + '— this is a hang regressing, not a flake');
    }
    return { code: e.status ?? 1, stdout: String(e.stdout ?? '').trim(), stderr: String(e.stderr ?? '') };
  }
}

type BadShape = 'fifo' | 'symlink-fifo' | 'symlink-devzero' | 'directory';

/** Plants one of the four shapes at an arbitrary path. FIFO / symlink-to-FIFO
 *  / symlink-to-an-infinite-character-device are the three that HANG a
 *  read-by-name; directory is included only at the one site (`cmd_ws_release`)
 *  where its answer actually differs before/after the fix. */
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

describe('D1 — the account roster `source`, module top level (D-2377)', () => {
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
  });

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
    });
});

describe('D2 — the hold family, five sites, one shape (D-2378)', () => {
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
      expect(r.stdout).toContain('"refused":"held"');
      expect(r.stdout).toContain('<unreadable — treat as held>');
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
  // `rm -f -- "$REG/$id.hold"` (ccd:6560-ish) has no `-r`, so it fails on a
  // directory with "Is a directory" and the verb dies "STILL held" — an
  // out-of-scope, PRE-EXISTING defect in the unlink, not the read this task
  // was asked to bound. Reported in this file's own report as a finding, not
  // fixed here (would touch a line the brief did not name, and the brief's
  // own `meas.held` question is about the READ, not the unlink).
  describe.each(HANG_SHAPES)(
    'cmd_ws_release, for %s at the hold path', (_label, shape) => {
      it('releases PROMPTLY — never hangs — and meas.held is neither empty nor "<unreadable — treat as held>"', () => {
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
        expect(held, 'a lifecycle record must not disagree with what happened by staying empty').not.toBe('');
        expect(held).not.toBe('<unreadable — treat as held>');
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
  });
});

describe('D3 — `_ws_status`, the one unguarded reader of four (D-2379)', () => {
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
  });

  it('still answers non-zero for an ABSENT sessions JSON (unchanged — the pre-existing rung this adds beside)', () => {
    const id = 'demo';
    seedWrapper(id);
    fs.rmSync(sessionJsonPath(), { force: true });
    const r = boundedRun(`${STUB} _ws_status ${id}`);
    expect(r.code).not.toBe(0);
  });
});

describe('D4 — `_pr_py`\'s Python opens in `state` mode — THREE, not two (D-2380)', () => {
  let hp: PrHarness;
  beforeEach(() => { hp = makePrHarness('ccrc-ccd-bounded-d4-'); });
  afterEach(() => { hp.cleanup(); });

  const boundedPrRun = (snippet: string, ms = 5000): Bounded => runBounded(hp.home, snippet, ms);

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
  }, 10000);

  it('the compare-and-set lock: a FIFO at $REG/.prstate-<id>.lock proceeds UNLOCKED, PROMPTLY', () => {
    // `open(path, 'a')` blocks until a READER appears — `except OSError`
    // cannot fire for a block, only for an error, so the disclosed "proceed
    // unlocked" arm (ccd:4329-4332-ish, D-139) does not cover a hang. Same
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
  }, 10000);

  it('the prhistory append: a FIFO at $REG/<id>.prhistory faults PROMPTLY rather than hanging the whole sweep', () => {
    // THE THIRD OPEN, the one D-2380's own count (as it reads in the plan)
    // omits — corrected here in place, no new deviation number (controller
    // ruling): `get()`, the lock, and this append are three sites in the same
    // mode, not two. Reached only on the old_num != number transition — a
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
  }, 10000);

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
  });
});
