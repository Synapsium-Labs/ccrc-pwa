// DR-7 (D-6619, spec 2026-10-23 §2.6.1): ONE holder probe. `_ws_path_users` answers who uses a path:
// this uid's processes by cwd, open fd, `TMPDIR`, and (DR-7) file mappings. `_ws_path_users_many` answers a
// list of paths in ONE walk, each with its own verdict, and `ccd path-users [--json] <path>…` is its
// read-only entry. Every case here reads a FAKE process table (the seam `_ws_path_users_proc_root`) under a
// FIXTURE HOME: nothing runs against a live `$HOME`, and the probe and its entry write nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-path-users-many-'); });
afterEach(() => { h.cleanup(); });

const A = (): string => path.join(h.home, '.cc-tmp', 'project-a');
const B = (): string => path.join(h.home, '.cc-tmp', 'project-b');

/** `$HOME/fp/<pid>/{status,environ,cwd,fd/}`; ccd's own `$$` is planted first, because a listing without it is not trusted. */
const FAKE = [
  'CCD_OS=linux; rm -rf "$HOME/fp";',
  '_fpp() { mkdir -p "$HOME/fp/$1/fd";',
  ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
  ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
  '_fpp $$ 1 "$(id -u)";',
  '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
].join(' ');
const U = '"$(id -u)"';
const envOf = (pid: number, value: string): string =>
  `printf 'LANG=C\\0TMPDIR=%s\\0' "${value}" > "$HOME/fp/${pid}/environ";`;

interface Answer { rc: string; pids: string; why: string }
const ask = (p: string, pre: string): Answer => {
  const [rc = '', pids = '', why = ''] = h.sh(`${pre} _ws_path_users "${p}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS" "$_WS_PATH_USERS_WHY"`).split('\x1f');
  return { rc, pids, why };
};

describe('one path: today’s answers (characterization, green before DR-7)', () => {
  it('a cwd at the path, an fd under it, and a TMPDIR under it each use it; nobody else does', () => {
    const cwd = ask(A(), `${FAKE} _fpp 4242 1 ${U}; ln -sfn "${A()}" "$HOME/fp/4242/cwd";`);
    expect(cwd.rc, cwd.why).toBe('1');
    expect(cwd.pids).toBe('4242');
    const fd = ask(A(), `${FAKE} _fpp 4243 1 ${U}; ln -sfn "${A()}/x" "$HOME/fp/4243/fd/7";`);
    expect(fd.rc, fd.why).toBe('1');
    expect(fd.why).toContain(`process 4243 holds ${A()}/x open`);
    const tmp = ask(A(), `${FAKE} _fpp 4244 1 ${U}; ${envOf(4244, `${A()}/sub`)}`);
    expect(tmp.rc, tmp.why).toBe('1');
    expect(tmp.why).toContain(`process 4244 carries TMPDIR=${A()}/sub`);
    const none = ask(A(), `${FAKE} _fpp 4245 1 ${U}; ${envOf(4245, `${A()}2`)}`);
    expect(none.rc, none.why).toBe('0');
    expect(none.pids).toBe('');
  }, 60_000);

  it('a path that is not one plain absolute spelling is unmeasured, never nobody', () => {
    const a = ask('relative/x', FAKE);
    expect(a.rc).toBe('2');
    expect(a.why).toContain('is not one plain absolute path');
  }, 60_000);
});

const many = (paths: string[], pre: string): { rcs: string[]; pids: string[]; why: string[] } => {
  const q = paths.map((p) => `"${p}"`).join(' ');
  const out = h.sh(`${pre} _ws_path_users_many ${q}; for i in "\${!_WS_PATH_USERS_RCS[@]}"; do`
    + ` printf '%s\\x1f%s\\x1f%s\\x1e' "\${_WS_PATH_USERS_RCS[i]}" "\${_WS_PATH_USERS_PIDS_OF[i]}" "\${_WS_PATH_USERS_WHY_OF[i]}"; done`);
  const rows = out.split('\x1e').filter((r) => r !== '').map((r) => r.split('\x1f'));
  return { rcs: rows.map((r) => r[0] ?? ''), pids: rows.map((r) => r[1] ?? ''), why: rows.map((r) => r[2] ?? '') };
};

describe('file mappings', () => {
  it('a process that only maps a file under the path holds it', () => {
    const a = ask(A(), `${FAKE} _fpp 4242 1 ${U}; mkdir -p "$HOME/fp/4242/map_files"; ln -sfn "${A()}/lib.so" "$HOME/fp/4242/map_files/7f00-7f10";`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    expect(a.why).toContain(`process 4242 maps ${A()}/lib.so`);
  }, 60_000);

  it('a mapping of a deleted file under the path still holds it', () => {
    const a = ask(A(), `${FAKE} _fpp 4242 1 ${U}; mkdir -p "$HOME/fp/4242/map_files"; ln -sfn "${A()}/lib.so (deleted)" "$HOME/fp/4242/map_files/7f00-7f10";`);
    expect(a.rc, a.why).toBe('1');
  }, 60_000);

  it('a mapping of a sibling `<path>2` is not under the path', () => {
    const a = ask(A(), `${FAKE} _fpp 4242 1 ${U}; mkdir -p "$HOME/fp/4242/map_files"; ln -sfn "${A()}2/lib.so" "$HOME/fp/4242/map_files/7f00-7f10";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('`maps` is read when `map_files` cannot be listed', () => {
    const maps = `printf '7f00-7f10 r-xp 00000000 08:01 12   ${A()}/a b.so\\n7f20-7f30 rw-p 00000000 00:00 0\\n' > "$HOME/fp/4242/maps";`;
    const a = ask(A(), `${FAKE} _fpp 4242 1 ${U}; ${maps}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`process 4242 maps ${A()}/a b.so`);
    const other = ask(A(), `${FAKE} _fpp 4242 1 ${U}; printf '7f00-7f10 r-xp 0 08:01 12   ${A()}2/x.so\\n[stack]\\n' > "$HOME/fp/4242/maps";`);
    expect(other.rc, other.why).toBe('0');
  }, 60_000);

  it('a process with neither `map_files` nor `maps` (a fixture’s bare entry) maps nothing', () => {
    const a = ask(A(), `${FAKE} _fpp 4242 1 ${U};`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);
});

describe('many paths, one walk', () => {
  it('three paths, one walk: each verdict is its own', () => {
    const r = many([A(), B(), path.join(h.home, '.cc-tmp', 'project-c')], `${FAKE}`
      + ` _fpp 4242 1 ${U}; ln -sfn "${A()}" "$HOME/fp/4242/cwd";`
      + ` _fpp 4243 1 ${U}; ${envOf(4243, `${B()}/x`)} ln -sfn "${A()}/y" "$HOME/fp/4243/fd/3";`);
    expect(r.rcs).toEqual(['1', '1', '0']);
    expect(r.pids[0]!.split(' ').sort()).toEqual(['4242', '4243']);
    expect(r.pids[1]).toBe('4243');
    expect(r.pids[2]).toBe('');
    expect(r.why[1]).toContain('carries TMPDIR');
    expect(r.why[1]).not.toContain('4242');
  }, 60_000);

  it('the table is listed once for three paths (counted by the seam)', () => {
    const count = '"$HOME/fp-count"';
    const r = h.sh(`${FAKE} _fpp 4242 1 ${U}; : > ${count};`
      + ` _ws_path_users_proc_root() { echo x >> ${count}; printf %s "$HOME/fp"; };`
      + ` _ws_path_users_many "${A()}" "${B()}" "${path.join(h.home, 'zz')}"; wc -l < ${count}`);
    expect(Number(r.trim())).toBe(1);
  }, 60_000);

  it('a path that cannot be asked is unmeasured for itself only', () => {
    const r = many([A(), 'relative/x'], `${FAKE} _fpp 4242 1 ${U}; ln -sfn "${A()}" "$HOME/fp/4242/cwd";`);
    expect(r.rcs).toEqual(['1', '2']);
    expect(r.why[1]).toContain('is not one plain absolute path');
  }, 60_000);

  it('the walk past its bound answers unmeasured for every path', () => {
    const r = many([A(), B()], `${FAKE} _fpp 4242 1 ${U}; WS_PATH_USERS_SCAN_S=1; _plat_timeout() { shift; return 124; };`);
    expect(r.rcs).toEqual(['2', '2']);
    expect(r.why[0]).toContain('did not finish within');
    expect(r.why[1]).toContain('did not finish within');
  }, 60_000);

  it('a table without ccd’s own pid is unmeasured for every path, never nobody', () => {
    const r = many([A(), B()], `${FAKE} rm -rf "$HOME/fp/$$";`);
    expect(r.rcs).toEqual(['2', '2']);
  }, 60_000);
});

describe('ccd path-users', () => {
  const runEntry = (args: string, pre: string): { out: string; rc: string } => {
    const o = h.sh(`${pre} cmd_path_users ${args}; echo "rc=$?"`);
    const m = /rc=(\d+)\s*$/.exec(o);
    return { out: o.replace(/rc=\d+\s*$/, ''), rc: m?.[1] ?? '' };
  };

  it('--json prints one row per path with pids and why', () => {
    const r = runEntry(`--json "${A()}" "${B()}"`, `${FAKE} _fpp 4242 1 ${U}; ln -sfn "${A()}" "$HOME/fp/4242/cwd";`);
    expect(r.rc).toBe('0');
    const rows = r.out.trim().split('\n').map((l) => JSON.parse(l) as { path: string; verdict: string; pids: number[]; why: string });
    expect(rows.map((x) => x.path)).toEqual([A(), B()]);
    expect(rows.map((x) => x.verdict)).toEqual(['held', 'nobody']);
    expect(rows[0]!.pids).toEqual([4242]);
    expect(rows[0]!.why).toContain('process 4242 has its working directory');
    expect(rows[1]!.pids).toEqual([]);
  }, 60_000);

  it('the plain form prints the verdict, the path, the pids and the why on one tab-separated line each', () => {
    const r = runEntry(`"${A()}"`, `${FAKE} _fpp 4242 1 ${U}; ln -sfn "${A()}" "$HOME/fp/4242/cwd";`);
    const [verdict, p, pids] = r.out.trim().split('\t');
    expect([verdict, p, pids]).toEqual(['held', A(), '4242']);
  }, 60_000);

  it('with no path it is a usage error', () => {
    const r = h.sh(`${FAKE} ( cmd_path_users ) 2>&1; echo "rc=$?"`);
    expect(r).toContain('usage: ccd path-users');
    expect(r).not.toContain('rc=0');
  }, 60_000);

  it('the entry writes nothing under $REG', () => {
    const before = h.sh('find "$REG" -mindepth 1 2>/dev/null | sort | sha256sum');
    runEntry(`--json "${A()}"`, `${FAKE} _fpp 4242 1 ${U};`);
    const after = h.sh('find "$REG" -mindepth 1 2>/dev/null | sort | sha256sum');
    expect(after).toBe(before);
    expect(fs.existsSync(h.home)).toBe(true);
  }, 60_000);

  it('the dispatcher and `ccd caps` carry the entry', () => {
    const caps = h.sh('cmd_caps');
    expect(caps).toContain('path-users-v1');
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toMatch(/^ {2}path-users\) +shift; cmd_path_users "\$@" ;;$/m);
  }, 60_000);
});
