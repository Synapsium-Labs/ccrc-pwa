// `_ws_path_users`' walker and a process that exits between listing its fd
// table and reading one entry of it (child reclamation wave 6, spec §5.6).
// Such a readlink answers ESRCH — Python's `ProcessLookupError` — and that is
// PROOF the process vanished, exactly as ENOENT is: the walk skips that entry
// and answers from the processes that remain. It must never escape to the
// walker's catch-all and turn the whole walk into "unmeasured", which keeps a
// temp root nobody uses (measured under fd churn: 43 of 122 walks).
// A live box makes that exit on demand only by chance, so the walker's own
// `os.readlink` is made to raise it: a `sitecustomize.py` on PYTHONPATH (the
// walker is `python3 -c`, which imports it) wraps `os.readlink` and raises
// `ProcessLookupError` for ONE process's `/fd/` entries, passing every other
// call through. Each case first proves the injection reached the walker (its
// own mark), so a python that ignored PYTHONPATH reds rather than passes. The
// process table is a FAKE one (the seam `_ws_path_users_proc_root`), so the
// pids are the case's own and ESRCH is a raise, never a real readlink —
// a fake table's readlink is a real file system's, which cannot answer ESRCH.
// FIXTURE HOME ONLY: every path asked about is under the harness's HOME, and
// the probe reads — it never writes or deletes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-path-users-esrch-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';
const leafOf = (): string => path.join(h.home, '.cc-tmp', ID);

/** `$HOME/fp/<pid>/{status,environ,cwd,fd/}` (`ccd-path-users.test.ts`'s table): `_fpp <pid> <ppid> <uid>`
 *  plants one process whose environment is empty, whose cwd is `/` and which holds nothing open; ccd's own
 *  `$$` is planted first, because a listing without it is not trusted. Forced Linux. */
const FAKE = [
  'CCD_OS=linux; rm -rf "$HOME/fp";',
  '_fpp() { mkdir -p "$HOME/fp/$1/fd";',
  ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
  ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
  '_fpp $$ 1 "$(id -u)";',
  '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
].join(' ');

/** The injection: `os.readlink` raises ESRCH for every path under `CCD_TEST_ESRCH_AT`, and writes each such
 *  path to `CCD_TEST_ESRCH_MARK` first; every other call is the real one. */
const SITECUSTOMIZE = [
  'import os',
  '_at = os.environ.get("CCD_TEST_ESRCH_AT", "")',
  '_mark = os.environ.get("CCD_TEST_ESRCH_MARK", "")',
  '_real = os.readlink',
  'def _readlink(p, *a, **k):',
  '    s = os.fsdecode(p) if isinstance(p, (str, bytes, os.PathLike)) else ""',
  '    if _at and s.startswith(_at):',
  '        if _mark:',
  '            with open(_mark, "a") as fh:',
  '                fh.write(s + "\\n")',
  '        raise ProcessLookupError(3, "No such process", s)',
  '    return _real(p, *a, **k)',
  'os.readlink = _readlink',
  '',
].join('\n');

interface Answer { rc: string; pids: string; why: string }
/** `_ws_path_users`' answer with process 4242's fd readlinks raising ESRCH, read off the globals it sets. */
const askEsrch = (pre: string): Answer => {
  const dir = path.join(h.home, 'pyinject');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sitecustomize.py'), SITECUSTOMIZE);
  const env = {
    PYTHONPATH: dir,
    CCD_TEST_ESRCH_AT: `${path.join(h.home, 'fp', '4242', 'fd')}/`,
    CCD_TEST_ESRCH_MARK: path.join(h.home, 'esrch-mark'),
  };
  const [rc = '', pids = '', why = ''] = h.sh(`${FAKE} ${pre} _ws_path_users "${leafOf()}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS" "$_WS_PATH_USERS_WHY"`, env).split('\x1f');
  return { rc, pids, why };
};
/** Every path the injection raised ESRCH for. */
const raised = (): string[] => {
  const m = path.join(h.home, 'esrch-mark');
  return fs.existsSync(m) ? fs.readFileSync(m, 'utf8').split('\n').filter(Boolean) : [];
};
/** 4242 holds `<leaf>/x` open at fd 7 — so a walk the injection did NOT reach reads 4242 as a user. */
const FD_AT_LEAF = (): string => `_fpp 4242 1 "$(id -u)"; ln -sfn "${leafOf()}/x" "$HOME/fp/4242/fd/7";`;

describe('a process that vanishes between its fd listing and one fd’s readlink (ESRCH) is skipped, never unmeasured (spec §5.6)', () => {
  it('ESRCH at the only process’s fd, and nobody else uses the path: nobody (rc 0), never unmeasured (rc 2)', () => {
    const a = askEsrch(FD_AT_LEAF());
    expect(raised(), 'the CONTROL: the injection reached the walker, at 4242’s fd').toEqual([`${h.home}/fp/4242/fd/7`]);
    expect(a.rc, a.why).toBe('0');
    expect(a.pids).toBe('');
  }, 60_000);

  it('ESRCH at one process’s fd, and ANOTHER process uses the path: that one is found (rc 1), the walk answers from what remains', () => {
    const a = askEsrch(`${FD_AT_LEAF()} _fpp 4243 1 "$(id -u)"; ln -sfn "${leafOf()}" "$HOME/fp/4243/cwd";`);
    expect(raised(), 'the CONTROL: the injection reached the walker, at 4242’s fd').toEqual([`${h.home}/fp/4242/fd/7`]);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4243');
    expect(a.why).toContain(`process 4243 has its working directory at ${leafOf()}`);
  }, 60_000);

  it('CONTROL: the same table with no injection reads 4242’s fd, and 4242 uses the path', () => {
    const [rc = '', pids = ''] = h.sh(`${FAKE} ${FD_AT_LEAF()} _ws_path_users "${leafOf()}"; rc=$?;`
      + ` printf '%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS"`).split('\x1f');
    expect(rc).toBe('1');
    expect(pids).toBe('4242');
  }, 60_000);
});
