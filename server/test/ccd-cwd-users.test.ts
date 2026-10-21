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
