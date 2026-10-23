// DR-7 (D-6619, spec 2026-10-23 §2.6.1): ONE holder probe. `_ws_path_users` answers who uses a path:
// this uid's processes by cwd, open fd, `TMPDIR`, and (DR-7) file mappings. `_ws_path_users_many` answers a
// list of paths in ONE walk, each with its own verdict, and `ccd path-users [--json] <path>…` is its
// read-only entry. Every case here reads a FAKE process table (the seam `_ws_path_users_proc_root`) under a
// FIXTURE HOME: nothing runs against a live `$HOME`, and the probe and its entry write nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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
