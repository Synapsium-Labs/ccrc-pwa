// path-identity W3 (PI4 D; R21, R22; P12): ONE working-directory probe, `_ws_cwd_users DIR [SAY]` (path-identity
// spec §4.6). It answers 0 when no process has its working directory at DIR or under it; 1 when one does
// (`_WS_CWD_USERS_PIDS`, at most five JSON records in `_WS_CWD_USERS_RECS`, one sentence in `_WS_CWD_USERS_WHY`); and
// 2 when it measured nothing (`_WS_CWD_USERS_WHY` says why), never "nobody" then. A process works inside DIR when the
// STRING of its cwd link equals DIR's PHYSICAL spelling (its parent resolved through `_ws_dir_physical`, its leaf not
// followed) or lies under it, OR, on Linux, when the directory that link names has DIR's st_dev and st_ino on its
// chain of `..`. Linux walks the process table through the seam `_ws_expire_proc_root` in ONE python3 call bounded by
// `WS_CWD_USERS_SCAN_S`, listed again to a fixed point, a leader whose own cwd vanished asked through `task/<tid>`, its
// own chain excluded; Darwin asks `_ws_expire_lsof` and compares strings only. ws-expire's `_ws_expire_cwd_users` is
// now its thin adapter (A10, S2).
// FIXTURE HOME ONLY (`makePrHarness`): every tree asked about is under the harness's HOME, and the probe only reads. A
// FAKE process table (`$HOME/fp/<pid>/{cwd,stat}`, ccd's own `$$` planted by `FAKE_PROC_SELF`) names what a live box
// cannot be made to produce on demand; each fake `cwd` is a symlink to a real directory, so the identity arm opens it
// and walks real `..`. Real processes are started by vitest (`holdProc`), never by ccd. The identity arm opens with
// `O_PATH`, which only Linux has, so its cases run on Linux.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';
import { expireAudit, makeArchived } from './wsExpireFixture.js';
import { DARWIN_LSOF_STUB, FAKE_PROC_SELF } from './worktreeIdentityFixture.js';

let h: PrHarness;
let held: Held[] = [];
beforeEach(() => { h = makePrHarness('ccrc-cwd-users-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });

const LINUX = process.platform === 'linux';
const ROOT_USER = process.getuid?.() === 0;
const src = fs.readFileSync(CCD, 'utf8');
/** `WS_CWD_USERS_SCAN_S` as ccd defines it, or a marker no answer holds while it is undefined. */
const SCAN_S = /^WS_CWD_USERS_SCAN_S=(\d+)\b/m.exec(src)?.[1] ?? '<undefined>';
const real = (p: string): string => fs.realpathSync(p);
const hold = (cwd: string): Held => { const p = holdProc({ cwd }); held.push(p); return p; };
const exists = (name: string): boolean => fs.existsSync(path.join(h.home, name));

/** The tree every case asks about, unless it says otherwise: `<HOME>/worktrees/demo/quiet`, a `sub` directory in it. */
const tree = (): string => {
  const d = path.join(h.home, 'worktrees', 'demo', 'quiet');
  fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
  return d;
};

interface Answer { rc: string; pids: string; why: string; recs: string[] }
/** `_ws_cwd_users`' own answer, read off its globals; `pre` runs first. Each global is read with a default, so before
 *  the probe exists a case reds on its rc (`127`), never on an unbound variable. */
const ask = (dir: string, pre = '', say = ''): Answer => {
  const out = h.sh(`${pre} _ws_cwd_users "${dir}"${say === '' ? '' : ` "${say}"`};`
    + ' rc=$?; printf \'%s\\x1f%s\\x1f%s\\x1f\' "$rc" "${_WS_CWD_USERS_PIDS-}" "${_WS_CWD_USERS_WHY-}";'
    + ' printf \'%s\\n\' ${_WS_CWD_USERS_RECS[@]+"${_WS_CWD_USERS_RECS[@]}"}');
  const [rc = '', pids = '', why = '', rest = ''] = out.split('\x1f');
  return { rc, pids, why, recs: rest.split('\n').filter(Boolean) };
};

/** A fake process table through the seam `_ws_expire_proc_root`, forced Linux so a macOS host reads it too: ccd's own
 *  `$$` first (`FAKE_PROC_SELF`), then `fakep <pid> <cwd> <ppid>` plants one process whose `cwd` is a symlink and whose
 *  `stat` names its parent, the expiry suites' shape. (`fakep`, not the expiry suites' `_fp`: a test-local helper whose
 *  name starts with `_` reads as a stub of a shipped function to `ccd-harness-integrity.test.ts`.) */
const FAKE = `CCD_OS=linux; rm -rf "$HOME/fp"; ${FAKE_PROC_SELF}`
  + ' fakep() { mkdir -p "$HOME/fp/$1"; ln -sfn "$2" "$HOME/fp/$1/cwd"; printf "%s (a b) S %s 1 1 0\\n" "$1" "$3" > "$HOME/fp/$1/stat"; };';

describe.skipIf(!LINUX)('the identity arm (path-identity spec §4.6): a cwd placed inside the tree by device and inode', () => {
  it('A1: a cwd spelled through an ALIAS of the tree is in use by device and inode, though its string names no part of the tree', () => {
    const d = tree();
    fs.symlinkSync(d, path.join(h.home, 'alias'));
    const via = path.join(h.home, 'alias', 'sub');
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1;`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${via}, inside ${d} by device and inode`);
    expect(a.recs.map((r) => JSON.parse(r) as unknown)).toEqual([{ pid: 4242, comm: '', cwd: via }]);
  }, 60_000);

  it('A1b: CONTROL — the same alias of a SIBLING (`<tree>2`) places nothing: nobody', () => {
    const d = tree();
    fs.mkdirSync(path.join(`${d}2`, 'sub'), { recursive: true });
    fs.symlinkSync(`${d}2`, path.join(h.home, 'alias'));
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1;`);
    expect(a.rc, a.why).toBe('0');
    expect(a.pids).toBe('');
  }, 60_000);

  it.skipIf(ROOT_USER)('A3: a cwd whose `..` cannot be walked (its own directory grants no search) is UNMEASURED — never "not inside"', () => {
    const d = tree();
    const nox = path.join(h.home, 'nox', 'in');
    fs.mkdirSync(nox, { recursive: true });
    fs.chmodSync(nox, 0o600);
    try {
      const a = ask(d, `${FAKE} fakep 4242 "$HOME/nox/in" 1;`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toBe(`the processes of this box could not be measured (${h.home}/fp, exit 3), so whether one works inside ${d} was never asked`);
      expect(a.pids).toBe('');
    } finally { fs.chmodSync(nox, 0o755); }
  }, 60_000);

  it('A11a: a cwd link that READ but names nothing, its stat file standing — not proven gone: UNMEASURED (R21)', () => {
    const d = tree();
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/nowhere/x" 1;`);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
  }, 60_000);

  it('A11b: the same with its stat file gone too — the process vanished: skipped, nobody', () => {
    const d = tree();
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/nowhere/x" 1; rm -f "$HOME/fp/4242/stat";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('A10: the expiry ladder sees A1’s alias as `in-use`, with its record — the old string-only probe read it as expirable', () => {
    const a = makeArchived(h);
    fs.mkdirSync(path.join(a.wt, 'sub'));
    fs.symlinkSync(a.wt, path.join(h.home, 'alias'));
    const via = path.join(h.home, 'alias', 'sub');
    const nobody = JSON.parse(expireAudit(h, { pre: FAKE }).stdout) as Record<string, unknown>;
    expect(nobody['verdict'], `the CONTROL: nobody in the fake table — ${String(nobody['detail'])}`).toBe('expirable');
    const r = expireAudit(h, { pre: `${FAKE} fakep 4242 "$HOME/alias/sub" 1;` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('in-use');
    expect(doc['token']).toBeUndefined();
    expect(doc['inUse']).toEqual([{ pid: 4242, comm: '', cwd: via }]);
    expect(String(doc['detail'])).toContain(`process 4242 has its working directory at ${via}, inside ${a.wt} by device and inode — `);
  }, 90_000);
});

describe('the string arm, against the tree’s PHYSICAL spelling (P12)', () => {
  /** `$HOME/wtreal/demo/quiet` is the real tree and `$HOME/worktrees -> $HOME/wtreal`: the tree is asked by
   *  `$HOME/worktrees/demo/quiet`, the spelling ccd stores, while a cwd link and lsof print the physical one. */
  const linkedRoot = (): { asked: string; phys: string } => {
    fs.mkdirSync(path.join(h.home, 'wtreal', 'demo', 'quiet', 'sub'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'wtreal'), path.join(h.home, 'worktrees'));
    return { asked: path.join(h.home, 'worktrees', 'demo', 'quiet'), phys: path.join(real(path.join(h.home, 'wtreal')), 'demo', 'quiet') };
  };

  it('A2: a dangling cwd under the tree (a removed directory, as /proc prints one) is in use, by its string', () => {
    const d = tree();
    const a = ask(d, `${FAKE} fakep 4242 "${real(d)}/gone (deleted)" 1;`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/gone (deleted)`);
  }, 60_000);

  it('A2b-linux: a tree spelled through a LINKED worktrees root — a dangling cwd under its physical spelling is in use, by its string', () => {
    const t = linkedRoot();
    const a = ask(t.asked, `${FAKE} fakep 4242 "${t.phys}/gone (deleted)" 1;`);
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toBe(`process 4242 has its working directory at ${t.phys}/gone (deleted)`);
  }, 60_000);

  it('A2b-darwin: forced Darwin, the same linked root — lsof lists a live process at the physical spelling: in use, by its string', () => {
    const t = linkedRoot();
    const s = hold(path.join(t.phys, 'sub'));
    const list = `_ws_expire_lsof() { printf 'p%s\\nfcwd\\nn%s\\np%s\\nfcwd\\nn%s\\n' "$$" "$HOME" "${s.pid}" "${t.phys}/sub"; };`;
    const a = ask(t.asked, `CCD_OS=darwin; ${list}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
    expect(a.why).toContain(`process ${s.pid} `);
    expect(a.why).toContain(`has its working directory at ${t.phys}/sub`);
  }, 60_000);

  it.skipIf(!LINUX)('A13: a LIVE process whose working directory was removed under the tree is in use, by its string (the kernel’s ` (deleted)`)', () => {
    const d = tree();
    const gone = path.join(d, 'sub', 'scratch');
    fs.mkdirSync(gone);
    const s = hold(gone);
    fs.rmdirSync(gone);
    const a = ask(d);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
    expect(a.why).toContain(`has its working directory at ${real(d)}/sub/scratch (deleted)`);
    expect(a.why, 'found by its string, not by the identity walk').not.toContain('by device and inode');
  }, 60_000);
});

describe('the walk: _ws_path_users’ discipline, adopted (R21)', () => {
  it('A4: a walk that outruns its bound is UNMEASURED, and says so', () => {
    const d = tree();
    const a = ask(d, 'CCD_OS=linux; _plat_timeout() { return 124; };');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the walk of /proc did not finish within ${SCAN_S}s, so whether a process works inside ${d} was never asked`);
  }, 60_000);

  it.skipIf(!LINUX)('A5: ccd itself, the subshell that captures the walk, `timeout` and python3 are not users — even with ccd’s own cwd in the tree', () => {
    const d = tree();
    const a = ask(d, `cd "${d}" &&`);
    expect(a.rc, a.why).toBe('0');
    const s = hold(path.join(d, 'sub'));
    const b = ask(d, `cd "${d}" &&`);
    expect(b.rc, `the CONTROL: a process ccd did not start, in the same tree, is a user — ${b.why}`).toBe('1');
    expect(b.pids).toBe(String(s.pid));
  }, 60_000);

  /** 4242's `stat`, the file the probe reads of each candidate, as a FIFO: the probe's own read sequences the race. */
  const STAT_FIFO = '"$HOME/fp/4242/stat"';

  it('A6a: a pid only a SECOND listing holds is read — the walk is a fixed point, never one snapshot', () => {
    // 4242 works in the tree but is a child of ccd, so it is skipped; the probe's read of its stat is what plants 4243
    // (the successor a process forked before it exited), and 4243 works in the tree under another parent.
    const d = tree();
    try {
      const a = ask(d, `${FAKE} fakep 4242 "${real(d)}/sub" 1; rm -f ${STAT_FIFO}; mkfifo ${STAT_FIFO};`
        + ` { exec 3>${STAT_FIFO}; fakep 4243 "${real(d)}/sub" 1; printf '4242 (x) S %s 1 1 0\\n' "$$" >&3; exec 3>&-; } >/dev/null 2>&1 &`);
      expect(a.rc, a.why).toBe('1');
      expect(a.pids).toBe('4243');
    } finally {
      // A probe that never read 4242's stat (the red phase) leaves the writer blocked opening the FIFO: an O_RDWR open
      // is a reader, and releases it.
      h.sh(`if [ -p ${STAT_FIFO} ]; then : <> ${STAT_FIFO}; fi`);
    }
  }, 60_000);

  it('A6b: a listing again that fails is UNMEASURED — a walk that cannot list the table again never reads as "nobody"', () => {
    const d = tree();
    try {
      const a = ask(d, `${FAKE} fakep 4242 "${real(d)}/sub" 1; rm -f ${STAT_FIFO}; mkfifo ${STAT_FIFO};`
        + ` { exec 3>${STAT_FIFO}; mv "$HOME/fp" "$HOME/fp-gone"; printf '4242 (x) S %s 1 1 0\\n' "$$" >&3; exec 3>&-; } >/dev/null 2>&1 &`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
      expect(exists(path.join('fp-gone', '4242')), 'the CONTROL: the table moved during the walk').toBe(true);
    } finally {
      h.sh('for f in "$HOME/fp/4242/stat" "$HOME/fp-gone/4242/stat"; do if [ -p "$f" ]; then : <> "$f"; fi; done');
    }
  }, 60_000);

  /** 4242's own cwd link reads as VANISHED, and its thread 4243 lives under `task/` with its cwd in the tree. */
  const leaderGone = (d: string): string => `${FAKE} fakep 4242 / 1; rm -f "$HOME/fp/4242/cwd"; mkdir -p "$HOME/fp/4242/task/4243";`
    + ` ln -sfn "${real(d)}/sub" "$HOME/fp/4242/task/4243/cwd";`;

  it('A7a: a thread-group LEADER that exited before its threads is asked through task/<tid> — its live thread works in the tree', () => {
    const d = tree();
    const a = ask(d, leaderGone(d));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
  }, 60_000);

  it('A7b: CONTROL — the same leader with no thread left IS gone: nobody', () => {
    const d = tree();
    const a = ask(d, `${FAKE} fakep 4242 / 1; rm -f "$HOME/fp/4242/cwd";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it.skipIf(ROOT_USER)('A7c: a thread entry this uid may not read, the thread not in exit, is UNMEASURED', () => {
    const d = tree();
    const t = path.join(h.home, 'fp', '4242', 'task', '4243');
    try {
      const a = ask(d, `${leaderGone(d)} chmod 000 "$HOME/fp/4242/task/4243";`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
    } finally { if (fs.existsSync(t)) fs.chmodSync(t, 0o755); }
  }, 60_000);

  it.skipIf(ROOT_USER)('A12: a cwd link this uid may not read (EACCES) is the ruled exception — not seen, the stated limit, never a refusal', () => {
    const d = tree();
    const p = path.join(h.home, 'fp', '4242');
    try {
      const a = ask(d, `${FAKE} fakep 4242 "${real(d)}/sub" 1; chmod 000 "$HOME/fp/4242";`);
      expect(a.rc, a.why).toBe('0');
    } finally { if (fs.existsSync(p)) fs.chmodSync(p, 0o755); }
  }, 60_000);

  it('A14: six users — five records, the sentence counts the sixth, and every pid is named once', () => {
    const d = tree();
    const pids = ['4241', '4242', '4243', '4244', '4245', '4246'];
    const a = ask(d, `${FAKE} ${pids.map((p) => `fakep ${p} "${real(d)}/sub" 1;`).join(' ')}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids.split(' ').sort()).toEqual(pids);
    expect(a.recs).toHaveLength(5);
    expect(a.why).toMatch(/, and 1 more$/);
  }, 60_000);

  it('A15: a walk that exits 0 but whose answer is not whole (a python3 that prints one record and the closing line, nothing else) is UNMEASURED', () => {
    const d = tree();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'python3'), '#!/bin/sh\nprintf \'{"pid": 4242, "comm": "", "cwd": "/x"}\\n.\\n\'\n', { mode: 0o755 });
    const a = ask(d, 'CCD_OS=linux; PATH="$HOME/shim:$PATH";');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the walk's answer was not read whole, so whether a process works inside ${d} was never asked`);
    expect(a.pids).toBe('');
    expect(a.recs).toEqual([]);
  }, 60_000);

  it('A15b: a walk that exits 0 and prints nothing (a python3 that never ran the scan) is UNMEASURED: an answer with no closing line is never "nobody"', () => {
    const d = tree();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'python3'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const a = ask(d, 'CCD_OS=linux; PATH="$HOME/shim:$PATH";');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the walk's answer did not end with its closing line, so whether a process works inside ${d} was never asked`);
    expect(a.pids).toBe('');
    expect(a.recs).toEqual([]);
  }, 60_000);

  it('A16: python3 runs isolated (`-I`): a json.py in the caller’s working directory is never imported', () => {
    const d = tree();
    fs.mkdirSync(path.join(h.home, 'evil'));
    fs.writeFileSync(path.join(h.home, 'evil', 'json.py'), 'import os\nopen(os.path.join(os.environ["HOME"], "evil-ran"), "w").close()\n');
    const a = ask(d, `${FAKE} cd "$HOME/evil";`);
    expect(a.rc, a.why).toBe('0');
    expect(exists('evil-ran'), 'the caller’s json.py never ran').toBe(false);
  }, 60_000);
});

describe('A8: answers that measured nothing are UNMEASURED — never "nobody"', () => {
  it('A8a: a table without ccd’s own pid, and a table that cannot be listed', () => {
    const d = tree();
    const noMe = ask(d, `CCD_OS=linux; rm -rf "$HOME/fp"; mkdir -p "$HOME/fp/4242"; ln -sfn "${real(d)}/sub" "$HOME/fp/4242/cwd";`
      + ' _ws_expire_proc_root() { printf %s "$HOME/fp"; };');
    expect(noMe.rc, noMe.why).toBe('2');
    expect(noMe.why).toBe(`the processes of this box could not be measured (${h.home}/fp, exit 3), so whether one works inside ${d} was never asked`);
    const missing = ask(d, 'CCD_OS=linux; _ws_expire_proc_root() { printf %s "$HOME/no-such-proc"; };');
    expect(missing.rc, missing.why).toBe('2');
    expect(missing.why).toContain(`could not be measured (${h.home}/no-such-proc, exit 3)`);
  }, 60_000);

  it('A8b: a dir that is not one plain absolute path', () => {
    const d = tree();
    for (const p of ['relative/x', `${d}/`, `${h.home}//worktrees/demo/quiet`, `${h.home}/worktrees/./demo/quiet`, `${h.home}/worktrees/demo/../demo/quiet`]) {
      const a = ask(p, 'CCD_OS=linux;');
      expect(a.rc, `${p}: ${a.why}`).toBe('2');
      expect(a.why).toBe(`${p} is not one plain absolute path, so whether a process works inside it was never asked`);
    }
  }, 90_000);

  it('A8c: a parent whose physical path holds a newline cannot be resolved: unmeasured, naming the newline', () => {
    const vol = path.join(h.home, 'vol\n');
    fs.mkdirSync(path.join(vol, 'quiet'), { recursive: true });
    fs.symlinkSync(vol, path.join(h.home, 'root'));
    const dir = path.join(h.home, 'root', 'quiet');
    const a = ask(dir, 'CCD_OS=linux;');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain(`the directory ${path.join(h.home, 'root')} that holds ${dir} cannot be resolved (`);
    expect(a.why).toContain('newline');
  }, 60_000);

  it.skipIf(ROOT_USER)('A8d: a parent that cannot be searched is unmeasured — the absence guard answers before any resolve', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(path.join(locked, 'x'), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      const target = path.join(locked, 'x', 'quiet');
      const a = ask(target, 'CCD_OS=linux;');
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain(`${locked} cannot be searched`);
      expect(a.why).toContain(` — whether a process works inside ${target} was never asked`);
    } finally { fs.chmodSync(locked, 0o755); }
  }, 60_000);

  it('A8e: a tree PROVEN absent is nobody, and nothing is read — no table root asked, no walk run', () => {
    tree();
    const a = ask(path.join(h.home, 'worktrees', 'demo', 'gone'), 'CCD_OS=linux;'
      + ' _ws_expire_proc_root() { : > "$HOME/proc-root-asked"; printf %s /proc; };'
      + ' _plat_timeout() { : > "$HOME/walk-run"; return 124; };');
    expect(a.rc, a.why).toBe('0');
    expect(exists('proc-root-asked'), 'no table root was asked').toBe(false);
    expect(exists('walk-run'), 'no walk was run').toBe(false);
  }, 60_000);
});

describe('A9: Darwin asks lsof and compares strings only — no /proc is read, and the identity arm never runs', () => {
  const POISON = '_ws_expire_proc_root() { : > "$HOME/proc-root-asked"; printf %s /proc; };';

  it('A9a: the stub listing names ccd alone: nobody, and the table root was never asked', () => {
    const d = tree();
    const a = ask(d, `CCD_OS=darwin; ${DARWIN_LSOF_STUB} ${POISON}`);
    expect(a.rc, a.why).toBe('0');
    expect(exists('proc-root-asked'), 'Darwin reads no /proc').toBe(false);
  }, 60_000);

  it('A9b: a live process listed under an ALIAS of the tree is not placed by identity there: nobody; at its physical spelling it is in use', () => {
    const d = tree();
    fs.symlinkSync(d, path.join(h.home, 'alias'));
    const s = hold(path.join(d, 'sub'));
    const listing = (at: string): string =>
      `_ws_expire_lsof() { printf 'p%s\\nfcwd\\nn%s\\np%s\\nfcwd\\nn%s\\n' "$$" "$HOME" "${s.pid}" "${at}"; };`;
    const alias = ask(d, `CCD_OS=darwin; ${listing(path.join(h.home, 'alias', 'sub'))} ${POISON}`);
    expect(alias.rc, alias.why).toBe('0');
    expect(exists('proc-root-asked'), 'Darwin reads no /proc').toBe(false);
    const phys = ask(d, `CCD_OS=darwin; ${listing(`${real(d)}/sub`)} ${POISON}`);
    expect(phys.rc, `the CONTROL: ${phys.why}`).toBe('1');
    expect(phys.pids).toBe(String(s.pid));
  }, 60_000);
});

describe('the source: one probe, its seams by name, one bounded Linux walk; the adapter walks nothing itself', () => {
  /** `name`'s body from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const code = (name: string): string => bodyOf(name).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('S1: _ws_cwd_users — one bounded python3 call on Linux, one direct one on Darwin, its seams and its resolve by name, no link-count skip', () => {
    const c = code('_ws_cwd_users');
    expect(c.length, 'the probe could not be sliced').toBeGreaterThan(2000);
    expect(c.split('_plat_timeout "$WS_CWD_USERS_SCAN_S" env LC_ALL=C.UTF-8 python3 -I -c "$py" proc ').length - 1, 'one bounded Linux walk').toBe(1);
    expect(c.split('out=$(LC_ALL=C.UTF-8 python3 -I -c "$py" lsof ').length - 1, 'one Darwin parse').toBe(1);
    for (const n of ['_ws_expire_proc_root', '_ws_expire_lsof', '_ws_dir_physical "$parent"', '_ws_reclaim_absent "$dir"', '_ws_reclaim_plain_path "$dir"']) {
      expect(c, n).toContain(n);
    }
    expect(c).not.toMatch(/st_nlink|WS_PATH_USERS_SCAN_S/);
  });

  it('S2: _ws_expire_cwd_users is the adapter — its preamble and parent resolve kept, the shared probe asked once, no walk of its own', () => {
    const c = code('_ws_expire_cwd_users');
    expect(c.length, 'the adapter could not be sliced').toBeGreaterThan(400);
    expect(c.split('_ws_cwd_users "$wt" "$workdir"').length - 1).toBe(1);
    expect(c).toContain('_ws_dir_physical "$parent"');
    expect(c).toContain('_reap_refuse in-use');
    expect(c).not.toMatch(/python3|_ws_expire_proc_root|_ws_expire_lsof/);
  });

  it('S3: WS_CWD_USERS_SCAN_S is defined once, at 10, and the probe stands in the RECLAIM region directly after _ws_path_users', () => {
    expect(src.match(/^WS_CWD_USERS_SCAN_S=\d+\b/gm)).toEqual(['WS_CWD_USERS_SCAN_S=10']);
    const users = src.indexOf('\n_ws_path_users() {');
    const probe = src.indexOf('\n_ws_cwd_users() {');
    const removal = src.indexOf('\n# ── the ONE removal of a per-session leaf');
    const end = src.indexOf('RECLAIM-END');
    expect(users).toBeGreaterThan(-1);
    expect(probe, 'after _ws_path_users').toBeGreaterThan(users);
    expect(removal, 'and before the ONE removal block').toBeGreaterThan(probe);
    expect(end, 'inside the RECLAIM region').toBeGreaterThan(removal);
  });
});

describe.skipIf(!LINUX)('a cwd link that vanished: confirmed by a second read, its pid asked through its threads in passes, its link read again after each, accepted only after a settled listing', () => {
  /** A RACE, TIMED TO THE PROBE'S OWN CALLS (test-local: no seam in ccd, and never the real /proc). A fake table cannot
   *  change between two reads the probe makes microseconds apart, and no blocking read lies between a cwd link's read,
   *  its open and its second read (the only reads a FIFO could hold are a stat file's, after a hit). So `python3` on
   *  PATH is a shim, as A15's is: it runs the real python3 on the probe's own text, after a prelude that wraps
   *  `os.readlink`, `os.open`, `os.listdir` and `os.stat`. The wrapper counts each call by its path and, just before
   *  the call a case names, changes the fake table as the kernel would have changed it at that instant; then it makes
   *  the real call, so every answer the probe reads is the file system's. The one exception is an errno no fixture
   *  file system can answer (ESRCH, EPERM): a step may RETURN that error, and the wrapper raises it IN PLACE of the
   *  call, a fabricated errno, logged in `timed-fired` as `<call> raised <errno> in place of the call` (R78 (3)).
   *  `timed-fired` logs each change made, and `timed-error` a change that failed. */
  const PRELUDE = [
    'import errno as _t_errno, os as _t_os, shutil as _t_sh',
    '_t_home = _t_os.environ["HOME"]',
    '_t_F = _t_home + "/fp"',
    '_t_seen = {}',
    'def _t_fired(what):',
    '    with open(_t_home + "/timed-fired", "a") as fh:',
    '        fh.write(what + "\\n")',
    'def _t_wrap(name):',
    '    real = getattr(_t_os, name)',
    '    def call(path, *a, **k):',
    '        key = (name, str(path))',
    '        n = _t_seen[key] = _t_seen.get(key, 0) + 1',
    '        try:',
    '            e = _t_step(name, key[1], n)',
    '        except Exception as x:',
    '            e = None',
    '            with open(_t_home + "/timed-error", "a") as fh:',
    '                fh.write("%s %s %d: %r\\n" % (name, key[1], n, x))',
    '        if isinstance(e, OSError):',
    '            _t_fired("%s raised %s in place of the call" % (name, _t_errno.errorcode[e.errno]))',
    '            raise e',
    '        return real(path, *a, **k)',
    '    setattr(_t_os, name, call)',
    'for _t_n in ("readlink", "open", "listdir", "stat"):',
    '    _t_wrap(_t_n)',
  ].join('\n');
  /** Writes the shim and the case's step (the body of `_t_step(op, path, n)`, `n` the call's count for that path; an
   *  OSError it returns is raised in place of the call), and answers the snippet that puts the shim first on PATH. Any
   *  other python3 call runs the real one untouched. */
  const timed = (step: readonly string[]): string => {
    fs.mkdirSync(path.join(h.home, 'shim'), { recursive: true });
    fs.writeFileSync(path.join(h.home, 'shim', 'python3'), '#!/bin/sh\n'
      + 'if [ "$1" = -I ] && [ "$2" = -c ] && [ "$4" = proc ]; then p=$3; shift 3; exec "$R77_PY" -I -c "$(cat "$HOME/timed.py")\n$p" "$@"; fi\n'
      + 'exec "$R77_PY" "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(h.home, 'timed.py'), `${PRELUDE}\ndef _t_step(op, path, n):\n${step.map((l) => `    ${l}`).join('\n')}\n    return\n`);
    return ' R77_PY=$(command -v python3); export R77_PY; PATH="$HOME/shim:$PATH";';
  };
  const logOf = (name: string): string[] => (exists(name) ? fs.readFileSync(path.join(h.home, name), 'utf8').split('\n').filter(Boolean) : []);
  const fired = (): string[] => logOf('timed-fired');
  /** A python string literal for a path (JSON's escapes are python's). */
  const lit = (p: string): string => JSON.stringify(p);
  /** 4242 a leader whose own cwd link reads as vanished (a zombie's does), its own tid listed under `task/` with no
   *  cwd; `thread(tid, cwd)` plants one of its threads. */
  const lead = `${FAKE} fakep 4242 / 1; rm -f "$HOME/fp/4242/cwd"; mkdir -p "$HOME/fp/4242/task/4242";`
    + ' printf "4242 (a b) Z 1 1 1 0\\n" > "$HOME/fp/4242/task/4242/stat";';
  const thread = (tid: string, cwd: string): string => ` mkdir -p "$HOME/fp/4242/task/${tid}"; ln -sfn "${cwd}" "$HOME/fp/4242/task/${tid}/cwd";`
    + ` printf "%s (a b) S 1 1 1 0\\n" ${tid} > "$HOME/fp/4242/task/${tid}/stat";`;
  /** The tree, and `$HOME/alias`, a link to it: `$HOME/alias/sub` is inside it by device and inode only. */
  const aliased = (): string => {
    const d = tree();
    fs.symlinkSync(d, path.join(h.home, 'alias'));
    return d;
  };

  it('V1: a process that released its cwd between the probe’s read and its open, its stat file standing (a zombie’s does), is confirmed gone by a second read of the link: nobody, never unmeasured', () => {
    const d = aliased();
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1; mkdir -p "$HOME/fp/4242/task/4242";` + timed([
      'if op == "open" and path == _t_F + "/4242/cwd" and n == 1:',
      '    _t_os.unlink(path)',
      '    _t_fired("4242 released its cwd")',
    ]));
    expect(a.rc, a.why).toBe('0');
    expect(fired(), 'the CONTROL: the link vanished at the open (unvanished, it is in use by device and inode)').toEqual(['4242 released its cwd']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('V2: the same process, confirmed by its second read, is asked through its threads: a live thread in the tree is in use', () => {
    const d = aliased();
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1; mkdir -p "$HOME/fp/4242/task/4242";${thread('4243', `${real(d)}/sub`)}` + timed([
      'if op == "open" and path == _t_F + "/4242/cwd" and n == 1:',
      '    _t_os.unlink(path)',
      '    _t_fired("4242 released its cwd")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
    expect(fired()).toEqual(['4242 released its cwd']);
  }, 60_000);

  it('V3: a thread created after the first listing of `task/` (its creator, in the tree, exited before it was asked) is found by listing `task/` again: in use', () => {
    const d = tree();
    const a = ask(d, `${lead}${thread('4243', `${real(d)}/sub`)}` + timed([
      'if op == "readlink" and path == _t_F + "/4242/task/4243/cwd" and n == 1:',
      '    _t_os.mkdir(_t_F + "/4242/task/4244")',
      `    _t_os.symlink(${lit(`${real(d)}/sub`)}, _t_F + "/4242/task/4244/cwd")`,
      '    _t_os.unlink(path)',
      '    _t_fired("4243 cloned 4244 and exited")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
    expect(fired()).toEqual(['4243 cloned 4244 and exited']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('V4: the pid changes hands after pass 1 asked its thread (that thread, asked outside the tree, moved in by another mount and ran execve, so the leader’s pid names it): the read of the leader’s link after pass 1 finds it, by device and inode', () => {
    const d = aliased();
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const a = ask(d, `${lead}${thread('4243', '$HOME/elsewhere')}` + timed([
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
      '    _t_sh.rmtree(_t_F + "/4242/task/4243")',
      '    _t_os.symlink(_t_home + "/alias/sub", path)',
      '    _t_os.symlink(_t_home + "/alias/sub", _t_F + "/4242/task/4242/cwd")',
      '    _t_fired("4243 took pid 4242")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${h.home}/alias/sub, inside ${d} by device and inode`);
    expect(fired()).toEqual(['4243 took pid 4242']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('V5: a leader’s link that reads at the last read and then vanishes again at its open is UNMEASURED — no second confirmation there', () => {
    const d = aliased();
    const a = ask(d, lead + timed([
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
      '    _t_os.symlink(_t_home + "/alias/sub", path)',
      '    _t_fired("4242 reads again")',
      'if op == "open" and path == _t_F + "/4242/cwd" and n == 1:',
      '    _t_os.unlink(path)',
      '    _t_fired("4242 vanished again")',
    ]));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the processes of this box could not be measured (${h.home}/fp, exit 3), so whether one works inside ${d} was never asked`);
    expect(fired()).toEqual(['4242 reads again', '4242 vanished again']);
  }, 60_000);

  it('V6: a thread link that still reads after its open answered ENOENT, its stat file standing, is UNMEASURED — a link that reads is never a confirmation', () => {
    const d = tree();
    const a = ask(d, `${lead}${thread('4243', '$HOME/nowhere/x')}`);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
  }, 60_000);

  it.skipIf(ROOT_USER)('V7: a thread link whose second read answers EACCES is UNMEASURED — ENOENT alone confirms, and the ruled EACCES exception is never reused there', () => {
    const d = tree();
    const t = path.join(h.home, 'fp', '4242', 'task', '4243');
    try {
      const a = ask(d, `${lead}${thread('4243', '$HOME/nowhere/x')}` + timed([
        'if op == "readlink" and path == _t_F + "/4242/task/4243/cwd" and n == 2:',
        '    _t_os.chmod(_t_F + "/4242/task/4243", 0)',
        '    _t_fired("task/4243 cannot be searched")',
      ]));
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
      expect(fired()).toEqual(['task/4243 cannot be searched']);
    } finally { if (fs.existsSync(t)) fs.chmodSync(t, 0o755); }
  }, 60_000);

  it('V8: a ZOMBIE leader whose live thread works in the tree by device and inode is in use — each thread is judged by both arms', () => {
    const d = aliased();
    const a = ask(d, `${lead} printf "4242 (a b) Z 1 1 1 0\\n" > "$HOME/fp/4242/stat";${thread('4243', '$HOME/alias/sub')}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${h.home}/alias/sub, inside ${d} by device and inode`);
  }, 60_000);

  it('V9: the leader’s own tid is asked: a pid that changed hands before `task/` was listed names the thread that ran execve there', () => {
    const d = tree();
    const a = ask(d, `${lead} ln -sfn "${real(d)}/sub" "$HOME/fp/4242/task/4242/cwd";`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
  }, 60_000);

  it('V10: a thread confirmed gone by its second read does not end the walk: the next listing’s thread is still asked', () => {
    const d = aliased();
    const a = ask(d, `${lead}${thread('4243', '$HOME/alias/sub')}` + timed([
      'if op == "open" and path == _t_F + "/4242/task/4243/cwd" and n == 1:',
      '    _t_os.mkdir(_t_F + "/4242/task/4244")',
      `    _t_os.symlink(${lit(`${real(d)}/sub`)}, _t_F + "/4242/task/4244/cwd")`,
      '    _t_os.unlink(path)',
      '    _t_fired("4243 cloned 4244 and released its cwd")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
    expect(fired()).toEqual(['4243 cloned 4244 and released its cwd']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it.skipIf(ROOT_USER)('V11: a `task/` that cannot be listed is UNMEASURED — never "no threads"', () => {
    const d = tree();
    const t = path.join(h.home, 'fp', '4242', 'task');
    try {
      const a = ask(d, `${lead} chmod 000 "$HOME/fp/4242/task";`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
    } finally { if (fs.existsSync(t)) fs.chmodSync(t, 0o755); }
  }, 60_000);

  it('V12: a `task/` that never settles (each listing names a tid the walk has not asked) is UNMEASURED, at the walk’s own bound', () => {
    const d = tree();
    const a = ask(d, `WS_CWD_USERS_SCAN_S=1; ${lead}` + timed([
      'if op == "listdir" and path == _t_F + "/4242/task":',
      '    if n > 1:',
      '        _t_os.rmdir(path + "/%d" % (9000 + n - 1))',
      '    _t_os.mkdir(path + "/%d" % (9000 + n))',
    ]));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the walk of ${h.home}/fp did not finish within 1s, so whether a process works inside ${d} was never asked`);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  // R78: the link of <pid> is read AGAIN after EVERY pass of the thread walk, and a read that answers vanished, reaped
  // or outside the tree accepts only on a pass whose listing named no tid not asked before, or whose `task/` vanished.
  // In the fake table 4242's leader tid is `task/4242`, and the pid's link is `fp/4242/cwd`. For a leader whose link
  // vanished at its first read (`lead`), that read (entries()) is call 1 for the path, the read after pass 1 is call 2,
  // and the read after pass 2 is call 3.

  /** A tid that `os.listdir` lists AFTER the leader's own 4242 on the file system the fake table lives on, as /proc's
   *  `task/` lists its leader first. The probe asks a pass's tids in its listing's order, and a fixture directory lists
   *  in its file system's order (ext4's is a hash order), so a trace that needs the leader asked first takes this tid. */
  const afterLeader = (): string => {
    const at = path.join(h.home, 'order');
    const names = Array.from({ length: 16 }, (_, i) => String(4243 + i));
    fs.mkdirSync(path.join(at, '4242'), { recursive: true });
    for (const n of names) fs.mkdirSync(path.join(at, n));
    const order = h.sh(`python3 -I -c 'import os, sys; print(" ".join(os.listdir(sys.argv[1])))' "${at}"`).trim().split(' ');
    const t = order.slice(order.indexOf('4242') + 1).find((n) => names.includes(n));
    expect(t, `the CONTROL: no tid lists after the leader’s on this file system (${order.join(' ')})`).toBeDefined();
    return t ?? '';
  };

  it('W1: the reviewer’s DOUBLE EXCHANGE — the leader asked, its thread runs execve and takes the pid and is asked by its old tid (gone); after that listing the pid’s holder starts a thread in the tree and is zapped by that thread’s execve: the read after the pass sends the walk to list `task/` again, which finds it: in use', () => {
    const d = aliased();
    const t = afterLeader();
    const a = ask(d, `${lead}${thread(t, '$HOME/alias/sub')}` + timed([
      `if op == "readlink" and path == _t_F + "/4242/task/${t}/cwd" and n == 1:`,
      `    _t_sh.rmtree(_t_F + "/4242/task/${t}")`,
      '    _t_os.symlink(_t_home + "/alias/sub", _t_F + "/4242/cwd")',
      '    _t_os.symlink(_t_home + "/alias/sub", _t_F + "/4242/task/4242/cwd")',
      `    _t_fired("${t} ran execve and took pid 4242")`,
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
      '    _t_os.mkdir(_t_F + "/4242/task/4300")',
      '    _t_os.symlink(_t_home + "/alias/sub", _t_F + "/4242/task/4300/cwd")',
      '    _t_os.unlink(path)',
      '    _t_os.unlink(_t_F + "/4242/task/4242/cwd")',
      '    _t_fired("the holder of pid 4242 started 4300 and was zapped by its execve")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${h.home}/alias/sub, inside ${d} by device and inode`);
    expect(fired(), 'the CONTROL: both exchanges were placed').toEqual([`${t} ran execve and took pid 4242`,
      'the holder of pid 4242 started 4300 and was zapped by its execve']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('W2: the pid handed on between a pass’s read and the next listing, to a thread that listing no longer names (its old tid went with the released leader): the read AFTER that settled listing finds it — a regression pin, mutation-pinned (green before R78 too)', () => {
    const d = tree();
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const a = ask(d, `${lead}${thread('4243', '$HOME/elsewhere')}` + timed([
      'if op == "listdir" and path == _t_F + "/4242/task" and n == 2:',
      '    _t_sh.rmtree(path + "/4243")',
      `    _t_os.symlink(${lit(`${real(d)}/sub`)}, _t_F + "/4242/cwd")`,
      `    _t_os.symlink(${lit(`${real(d)}/sub`)}, path + "/4242/cwd")`,
      '    _t_fired("a thread started by 4243 ran execve: it took pid 4242, and 4243 was zapped")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
    expect(fired()).toEqual(['a thread started by 4243 ran execve: it took pid 4242, and 4243 was zapped']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('W3: the NAMED RESIDUAL cwd-probe-pid-handoff-between-reads (one execve and one leader exit, schedule S3) — a thread in the tree starts Q and exits; Q runs execve and takes the pid between a read and the listing after it; then Q starts U in the tree and exits as the group leader before the next read: the walk accepts, nobody. Pinned as the limit the header names, NOT a guard', () => {
    const d = tree();
    const sub = `${real(d)}/sub`;
    const a = ask(d, `${lead}${thread('4243', sub)}` + timed([
      'if op == "readlink" and path == _t_F + "/4242/task/4243/cwd" and n == 1:',
      '    _t_sh.rmtree(_t_F + "/4242/task/4243")',
      '    _t_os.mkdir(_t_F + "/4242/task/4244")',
      `    _t_os.symlink(${lit(sub)}, _t_F + "/4242/task/4244/cwd")`,
      '    _t_fired("4243 started 4244 and exited")',
      'if op == "listdir" and path == _t_F + "/4242/task" and n == 2:',
      '    _t_sh.rmtree(path + "/4244")',
      `    _t_os.symlink(${lit(sub)}, _t_F + "/4242/cwd")`,
      `    _t_os.symlink(${lit(sub)}, path + "/4242/cwd")`,
      '    _t_fired("4244 ran execve and took pid 4242")',
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 3:',
      '    _t_os.mkdir(_t_F + "/4242/task/4245")',
      `    _t_os.symlink(${lit(sub)}, _t_F + "/4242/task/4245/cwd")`,
      '    _t_os.unlink(path)',
      '    _t_os.unlink(_t_F + "/4242/task/4242/cwd")',
      '    _t_fired("the holder of pid 4242 started 4245 and exited as the group leader")',
    ]));
    expect(a.rc, `the residual, as named: ${a.why}`).toBe('0');
    expect(fired()).toEqual(['4243 started 4244 and exited', '4244 ran execve and took pid 4242',
      'the holder of pid 4242 started 4245 and exited as the group leader']);
    expect(fs.readlinkSync(path.join(h.home, 'fp', '4242', 'task', '4245', 'cwd')), 'the CONTROL: 4245 works in the tree as the walk accepts').toBe(sub);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('W4: a read that finds the pid OUTSIDE the tree waits for a settled listing too — the thread ran execve and took the pid, and its new image started a thread with its own fs in the tree after the listing: another pass finds it, in use', () => {
    const d = tree();
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const a = ask(d, `${lead}${thread('4243', '$HOME/elsewhere')}` + timed([
      'if op == "readlink" and path == _t_F + "/4242/task/4243/cwd" and n == 1:',
      '    _t_sh.rmtree(_t_F + "/4242/task/4243")',
      '    _t_os.symlink(_t_home + "/elsewhere", _t_F + "/4242/cwd")',
      '    _t_os.symlink(_t_home + "/elsewhere", _t_F + "/4242/task/4242/cwd")',
      '    _t_os.mkdir(_t_F + "/4242/task/4244")',
      `    _t_os.symlink(${lit(`${real(d)}/sub`)}, _t_F + "/4242/task/4244/cwd")`,
      '    _t_fired("4243 ran execve and took pid 4242; its new image started 4244 in the tree")',
    ]));
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toBe(`process 4242 has its working directory at ${real(d)}/sub`);
    expect(fired()).toEqual(['4243 ran execve and took pid 4242; its new image started 4244 in the tree']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('W9: EPERM at the read after a pass (the hidepid or LSM answer; FABRICATED, as no fixture file system answers EPERM), the stat file gone, is UNMEASURED — only EACCES itself is ever read as a reaped pid', () => {
    const d = tree();
    const a = ask(d, lead + timed([
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
      '    _t_os.unlink(_t_F + "/4242/stat")',
      '    _t_fired("the stat file of 4242 is gone")',
      '    return OSError(_t_errno.EPERM, "fabricated EPERM", path)',
    ]));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(`the processes of this box could not be measured (${h.home}/fp, exit 3), so whether one works inside ${d} was never asked`);
    expect(fired()).toEqual(['the stat file of 4242 is gone', 'readlink raised EPERM in place of the call']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  it('W11: a top-level link whose open answered ENOENT, its stat file standing, and whose second read answers ESRCH (FABRICATED, as no fixture file system answers ESRCH) is UNMEASURED — ENOENT alone confirms there', () => {
    const d = aliased();
    const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1; mkdir -p "$HOME/fp/4242/task/4242";` + timed([
      'if op == "open" and path == _t_F + "/4242/cwd" and n == 1:',
      '    _t_os.unlink(path)',
      '    _t_fired("4242 released its cwd")',
      'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
      '    return OSError(_t_errno.ESRCH, "fabricated ESRCH", path)',
    ]));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
    expect(fired()).toEqual(['4242 released its cwd', 'readlink raised ESRCH in place of the call']);
    expect(logOf('timed-error')).toEqual([]);
  }, 60_000);

  describe.skipIf(ROOT_USER)('R78’s EACCES rows, made by chmod: NON-ROOT ONLY — root reads straight through a mode, so as root they SKIP, never pass vacuously', () => {
    /** 4242's directory, whose mode makes its links answer EACCES: restored after each case. */
    const pidDir = (): string => path.join(h.home, 'fp', '4242');
    const unlock = (): void => { if (fs.existsSync(pidDir())) fs.chmodSync(pidDir(), 0o755); };

    it('W5: EACCES at the read after a pass (how a pid reaped mid-call answers), the stat file asked AFTER it gone, reads as vanished — and the walk still accepts only after a settled listing', () => {
      const d = tree();
      try {
        const a = ask(d, lead + timed([
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
          '    _t_os.chmod(_t_F + "/4242", 0)',
          '    _t_fired("4242 reaped mid-call: its link answers EACCES")',
          'if op == "stat" and path == _t_F + "/4242/stat" and n == 1:',
          '    _t_os.chmod(_t_F + "/4242", 0o755)',
          '    _t_sh.rmtree(_t_F + "/4242")',
          '    _t_fired("its stat file is gone")',
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 3:',
          '    _t_fired("read again after a settled listing")',
        ]));
        expect(a.rc, a.why).toBe('0');
        expect(fired(), 'the CONTROL: the reaped read, its stat, then a read after the settled listing')
          .toEqual(['4242 reaped mid-call: its link answers EACCES', 'its stat file is gone', 'read again after a settled listing']);
        expect(logOf('timed-error')).toEqual([]);
      } finally { unlock(); }
    }, 60_000);

    it('W5b: the same EACCES, its stat file then answering ESRCH (FABRICATED; gone() reads ENOENT and ESRCH alike), reads as vanished', () => {
      const d = tree();
      try {
        const a = ask(d, lead + timed([
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
          '    _t_os.chmod(_t_F + "/4242", 0)',
          '    _t_fired("4242 reaped mid-call: its link answers EACCES")',
          'if op == "stat" and path == _t_F + "/4242/stat" and n == 1:',
          '    _t_os.chmod(_t_F + "/4242", 0o755)',
          '    _t_sh.rmtree(_t_F + "/4242")',
          '    return OSError(_t_errno.ESRCH, "fabricated ESRCH", path)',
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 3:',
          '    _t_fired("read again after a settled listing")',
        ]));
        expect(a.rc, a.why).toBe('0');
        expect(fired()).toEqual(['4242 reaped mid-call: its link answers EACCES', 'stat raised ESRCH in place of the call',
          'read again after a settled listing']);
        expect(logOf('timed-error')).toEqual([]);
      } finally { unlock(); }
    }, 60_000);

    it('W7: EACCES at the read after a settled listing while the stat file still READS (a live group that turned non-dumpable answers so) is UNMEASURED', () => {
      const d = tree();
      try {
        const a = ask(d, lead + timed([
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 3:',
          '    _t_os.chmod(_t_F + "/4242", 0)',
          '    _t_fired("the link of 4242 answers EACCES")',
          'if op == "stat" and path == _t_F + "/4242/stat" and n == 1:',
          '    _t_os.chmod(_t_F + "/4242", 0o755)',
          '    _t_fired("its stat file still reads")',
        ]));
        expect(a.rc, a.why).toBe('2');
        expect(a.why).toBe(`the processes of this box could not be measured (${h.home}/fp, exit 3), so whether one works inside ${d} was never asked`);
        expect(fired()).toEqual(['the link of 4242 answers EACCES', 'its stat file still reads']);
        expect(logOf('timed-error')).toEqual([]);
      } finally { unlock(); }
    }, 60_000);

    it('W8: EACCES at that read, the stat file then answering ANOTHER errno (ELOOP here) is UNMEASURED', () => {
      const d = tree();
      try {
        const a = ask(d, lead + timed([
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 3:',
          '    _t_os.chmod(_t_F + "/4242", 0)',
          '    _t_fired("the link of 4242 answers EACCES")',
          'if op == "stat" and path == _t_F + "/4242/stat" and n == 1:',
          '    _t_os.chmod(_t_F + "/4242", 0o755)',
          '    _t_os.unlink(path)',
          '    _t_os.symlink("stat", path)',
          '    _t_fired("its stat file answers ELOOP")',
        ]));
        expect(a.rc, a.why).toBe('2');
        expect(a.why).toContain('could not be measured');
        expect(fired()).toEqual(['the link of 4242 answers EACCES', 'its stat file answers ELOOP']);
        expect(logOf('timed-error')).toEqual([]);
      } finally { unlock(); }
    }, 60_000);

    it('W10: a top-level link whose open answered ENOENT, its stat file standing, and whose SECOND read answers EACCES is UNMEASURED even when the stat file then answers ENOENT — the reaped-pid reading belongs to the read after a pass alone', () => {
      const d = aliased();
      try {
        const a = ask(d, `${FAKE} fakep 4242 "$HOME/alias/sub" 1; mkdir -p "$HOME/fp/4242/task/4242";` + timed([
          'if op == "open" and path == _t_F + "/4242/cwd" and n == 1:',
          '    _t_os.unlink(path)',
          '    _t_fired("4242 released its cwd")',
          'if op == "readlink" and path == _t_F + "/4242/cwd" and n == 2:',
          '    _t_os.chmod(_t_F + "/4242", 0)',
          '    _t_fired("its link answers EACCES")',
          'if op == "stat" and path == _t_F + "/4242/stat" and n == 2:',
          '    _t_os.chmod(_t_F + "/4242", 0o755)',
          '    _t_sh.rmtree(_t_F + "/4242")',
          '    _t_fired("its stat file is gone")',
        ]));
        expect(a.rc, a.why).toBe('2');
        expect(a.why).toContain('could not be measured');
        expect(fired()).toEqual(['4242 released its cwd', 'its link answers EACCES']);
        expect(logOf('timed-error')).toEqual([]);
      } finally { unlock(); }
    }, 60_000);
  });
});
