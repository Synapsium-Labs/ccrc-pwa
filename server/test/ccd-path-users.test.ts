// `_ws_path_users` — who uses a path (child reclamation wave 6, spec §5.6).
// The in-use probe the reclaim tail asks of a temp root before it removes it:
// a process of THIS uid whose TMPDIR names the path or a path under it, whose
// working directory is in it, or that holds a file in it open. Real processes,
// started by this suite with exactly that environment, cwd or fd, stand for a
// killed pane's stragglers; a FAKE process table (the seam
// `_ws_path_users_proc_root`) names the cases a live box cannot be made to
// produce on demand: another uid, an unreadable entry, a pid that vanished, a
// status that does not parse, a pid only a SECOND listing holds (a FIFO
// sequences that race), and a thread-group leader that exited before its threads.
// FIXTURE HOME ONLY: every path asked about is under the harness's HOME, and
// the probe reads — it never writes or deletes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { holdProc, type Held } from './pathUsersFixture.js';

let h: CcdHarness;
let held: Held[] = [];
beforeEach(() => { h = makeCcdHarness('ccrc-path-users-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); h.cleanup(); });

const ID = 'demo-quiet-basin';
const leafOf = (): string => path.join(h.home, '.cc-tmp', ID);
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };
const LINUX = process.platform === 'linux';
const ROOT_USER = process.getuid?.() === 0;

interface Answer { rc: string; pids: string; why: string }
/** `_ws_path_users`' own answer, read off the globals it sets. `pre` runs first; `env` reaches ccd's own process. */
const ask = (p: string, pre = '', env: NodeJS.ProcessEnv = {}): Answer => {
  const [rc = '', pids = '', why = ''] = h.sh(`${pre} _ws_path_users "${p}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PATH_USERS_PIDS" "$_WS_PATH_USERS_WHY"`, env).split('\x1f');
  return { rc, pids, why };
};

describe.skipIf(!LINUX)('real processes of this uid (Linux /proc)', () => {
  it('a process whose TMPDIR IS the leaf uses it — named by pid', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
    expect(a.why).toContain(`process ${s.pid} carries TMPDIR=${leafOf()}`);
  }, 60_000);

  it('a TMPDIR UNDER the leaf, and a trailing-slash spelling of the leaf, use it too — each pid once', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const a = hold({ cwd: h.home, tmpdir: path.join(leafOf(), 'sub') });
    const b = hold({ cwd: h.home, tmpdir: `${leafOf()}/` });
    const r = ask(leafOf());
    expect(r.rc, r.why).toBe('1');
    expect(r.pids.split(' ').sort()).toEqual([String(a.pid), String(b.pid)].sort());
  }, 60_000);

  it('a TMPDIR naming a leaf that does NOT exist still uses it — that process can re-create it', () => {
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(fs.existsSync(leafOf()), 'the CONTROL: no leaf stands').toBe(false);
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe(String(s.pid));
  }, 60_000);

  it('a process whose working directory is under the leaf uses it', () => {
    const deep = path.join(leafOf(), 'deep');
    fs.mkdirSync(deep, { recursive: true });
    const s = hold({ cwd: deep });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`process ${s.pid} has its working directory at ${fs.realpathSync(deep)}`);
  }, 60_000);

  it('a process holding a file under the leaf OPEN uses it — no TMPDIR, its cwd elsewhere', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const f = path.join(leafOf(), 'held');
    fs.writeFileSync(f, 'x');
    const s = hold({ cwd: h.home, holdOpen: f });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(`process ${s.pid} holds ${fs.realpathSync(f)} open`);
  }, 60_000);

  it('THE NEGATIVE CONTROL: a sibling `<leaf>2` in every arm is not under the leaf — nobody', () => {
    const sib = `${leafOf()}2`;
    fs.mkdirSync(leafOf(), { recursive: true });
    fs.mkdirSync(sib, { recursive: true });
    fs.writeFileSync(path.join(sib, 'held'), 'x');
    hold({ cwd: sib, tmpdir: sib, holdOpen: path.join(sib, 'held') });
    const a = ask(leafOf());
    expect(a.rc, a.why).toBe('0');
    expect(a.pids).toBe('');
  }, 60_000);

  it('the same process once killed: nobody', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(ask(leafOf()).rc, 'the CONTROL: alive, it uses the leaf').toBe('1');
    s.stop();
    expect(ask(leafOf()).rc).toBe('0');
  }, 60_000);

  it('a root reached through a LINK: the literal spelling and the physical one are both compared', () => {
    const vol = path.join(h.home, 'vol', 'cc-tmp');
    fs.mkdirSync(path.join(vol, ID), { recursive: true });
    fs.symlinkSync(vol, path.join(h.home, '.cc-tmp'));
    const phys = path.join(fs.realpathSync(vol), ID);
    const inCwd = hold({ cwd: phys });
    const viaPhys = hold({ cwd: h.home, tmpdir: phys });
    const a = ask(leafOf());   // asked by the literal spelling `_child_tmpdir` composes
    expect(a.rc, a.why).toBe('1');
    expect(a.pids.split(' ').sort()).toEqual([String(inCwd.pid), String(viaPhys.pid)].sort());
  }, 60_000);

  it('ccd’s own process and the scan’s own chain are not users, even when ccd itself carries TMPDIR=<leaf>', () => {
    fs.mkdirSync(leafOf(), { recursive: true });
    const a = ask(leafOf(), '', { TMPDIR: leafOf() });
    expect(a.rc, a.why).toBe('0');
    // THE CONTROL: the same environment on a process ccd did not start is a user.
    const s = hold({ cwd: h.home, tmpdir: leafOf() });
    expect(ask(leafOf(), '', { TMPDIR: leafOf() }).pids).toBe(String(s.pid));
  }, 60_000);
});

describe('a FAKE process table — the cases a live box cannot be made to produce', () => {
  /** `$HOME/fp/<pid>/{status,environ,cwd,fd/}`. `_fpp <pid> <ppid> <uid>` plants one process whose
   *  environment is empty, whose cwd is `/` and which holds nothing open; ccd's own `$$` is planted
   *  first, because a listing without it is not trusted. Forced Linux, so a macOS host reads it too. */
  const FAKE = [
    'CCD_OS=linux; rm -rf "$HOME/fp";',
    '_fpp() { mkdir -p "$HOME/fp/$1/fd";',
    ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
    ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
    '_fpp $$ 1 "$(id -u)";',
    '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
  ].join(' ');
  const envOf = (pid: number | string, value: string): string =>
    `printf 'LANG=C\\0TMPDIR=%s\\0' "${value}" > "$HOME/fp/${pid}/environ";`;

  it('a stranger of this uid whose environment names the leaf is a user', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
  }, 60_000);

  it('the same process under ANOTHER uid is not seen — the stated limit, never a refusal', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(( $(id -u) + 1 ))"; ${envOf(4242, leafOf())}`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it.skipIf(ROOT_USER)('an environment this uid may not read (a NON-DUMPABLE process) is not seen — the stated limit', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())} chmod 000 "$HOME/fp/4242/environ";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a cwd link at the leaf, and an fd link under it (a deleted file included), are users; a socket fd is not', () => {
    const cwd = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ln -sfn "${leafOf()}" "$HOME/fp/4242/cwd";`);
    expect(cwd.rc, cwd.why).toBe('1');
    const fd = ask(leafOf(), `${FAKE} _fpp 4243 1 "$(id -u)"; ln -sfn "${leafOf()}/x (deleted)" "$HOME/fp/4243/fd/7";`);
    expect(fd.rc, fd.why).toBe('1');
    expect(fd.pids).toBe('4243');
    const sock = ask(leafOf(), `${FAKE} _fpp 4244 1 "$(id -u)"; ln -sfn 'socket:[1]' "$HOME/fp/4244/fd/7";`);
    expect(sock.rc, sock.why).toBe('0');
  }, 60_000);

  it('a child of ccd is not a user; the same process under another parent is', () => {
    const child = ask(leafOf(), `${FAKE} _fpp 4242 $$ "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(child.rc, child.why).toBe('0');
    const other = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; ${envOf(4242, leafOf())}`);
    expect(other.rc, 'the CONTROL').toBe('1');
  }, 60_000);

  it('a pid that vanished between the listing and the read (no status left) is skipped — PROOF it is gone', () => {
    const a = ask(leafOf(), `${FAKE} mkdir -p "$HOME/fp/4242";`);
    expect(a.rc, a.why).toBe('0');
  }, 60_000);

  it('a pid that only a SECOND listing holds is read — the walk is a fixed point, never one snapshot', () => {
    // A FIFO at 4242's status SEQUENCES what a live box does by chance: the
    // probe's own read of 4242, after its first listing, is what plants 4243 —
    // the successor a process forked before it exited — and 4243 carries the leaf.
    const fifo = '"$HOME/fp/4242/status"';
    const status4242 = `printf 'Name:\\tx\\nPPid:\\t1\\nUid:\\t%s\\t%s\\t%s\\t%s\\n' "$u" "$u" "$u" "$u"`;
    try {
      const a = ask(leafOf(), `${FAKE} u=$(id -u); _fpp 4242 1 "$u"; rm -f ${fifo}; mkfifo ${fifo};`
        + ` { exec 3>${fifo}; _fpp 4243 1 "$u"; ${envOf(4243, leafOf())} ${status4242} >&3; exec 3>&-; } >/dev/null 2>&1 &`);
      expect(a.rc, a.why).toBe('1');
      expect(a.pids).toBe('4243');
    } finally {
      // A probe that never read 4242 (the red phase) leaves the writer blocked
      // opening the FIFO: an O_RDWR open is a reader, and releases it.
      h.sh(`if [ -p ${fifo} ]; then : <> ${fifo}; fi`);
    }
  }, 60_000);

  it('a RELISTING that fails is UNMEASURED — a walk that cannot list the table again never reads as "nobody"', () => {
    // The same FIFO sequencing: the probe's read of 4242's status is what moves
    // the whole table away, BEFORE that read returns. 4242 then reads as
    // vanished, and the relisting the fixed point needs cannot list the table.
    const fifo = '"$HOME/fp/4242/status"';
    const status4242 = `printf 'Name:\\tx\\nPPid:\\t1\\nUid:\\t%s\\t%s\\t%s\\t%s\\n' "$u" "$u" "$u" "$u"`;
    try {
      const a = ask(leafOf(), `${FAKE} u=$(id -u); _fpp 4242 1 "$u"; rm -f ${fifo}; mkfifo ${fifo};`
        + ` { exec 3>${fifo}; mv "$HOME/fp" "$HOME/fp-gone"; ${status4242} >&3; exec 3>&-; } >/dev/null 2>&1 &`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
      expect(fs.existsSync(path.join(h.home, 'fp-gone', '4242')), 'the CONTROL: the table moved during the walk').toBe(true);
    } finally {
      h.sh(`if [ -p ${fifo} ]; then : <> ${fifo}; fi`);
    }
  }, 60_000);

  /** 4242's own entries read as VANISHED (its cwd is gone), and its thread 4243 lives under `task/`. */
  const LEADER_GONE = `${FAKE} _fpp 4242 1 "$(id -u)"; rm -f "$HOME/fp/4242/cwd"; mkdir -p "$HOME/fp/4242/task/4243/fd";`
    + ' ln -sfn / "$HOME/fp/4242/task/4243/cwd";';

  it('a thread-group LEADER that exited before its threads is asked through task/<tid> — its live thread uses the leaf', () => {
    const a = ask(leafOf(), `${LEADER_GONE} printf 'TMPDIR=%s\\0' "${leafOf()}" > "$HOME/fp/4242/task/4243/environ";`);
    expect(a.rc, a.why).toBe('1');
    expect(a.pids).toBe('4242');
    // THE CONTROL: the same leader with no thread left IS gone — proof, so nobody.
    const gone = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; rm -f "$HOME/fp/4242/cwd";`);
    expect(gone.rc, gone.why).toBe('0');
  }, 60_000);

  it.skipIf(ROOT_USER)('a LIVE thread’s entry this uid may not read is UNMEASURED; a thread already in exit (PF_EXITING) is vanishing', () => {
    const locked = `${LEADER_GONE} : > "$HOME/fp/4242/task/4243/environ"; chmod 000 "$HOME/fp/4242/task/4243/environ";`;
    const stat = (flags: number): string => `printf '4243 (x) R 1 4242 4242 0 -1 ${flags} 0 0\\n' > "$HOME/fp/4242/task/4243/stat";`;
    const live = ask(leafOf(), `${locked} ${stat(0x400100)}`);
    expect(live.rc, live.why).toBe('2');
    expect(live.why).toContain('could not be measured');
    // THE CONTROL: the same entry on a thread in exit (measured on a busy box: State R,
    // PF_EXITING 0x4 set, its memory released, its environ EACCES) is vanishing, so nobody.
    const exiting = ask(leafOf(), `${locked} ${stat(0x40044c)}`);
    expect(exiting.rc, exiting.why).toBe('0');
  }, 60_000);

  /** LEADER_GONE, with its thread 4243's environ planted and locked: the thread is asked whether it is in exit. */
  const THREAD_LOCKED = `${LEADER_GONE} : > "$HOME/fp/4242/task/4243/environ"; chmod 000 "$HOME/fp/4242/task/4243/environ";`;

  it.skipIf(ROOT_USER)('a locked thread whose stat does not parse is UNMEASURED — never read as a thread in exit', () => {
    const a = ask(leafOf(), `${THREAD_LOCKED} printf 'garbage' > "$HOME/fp/4242/task/4243/stat";`);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
  }, 60_000);

  it.skipIf(ROOT_USER)('a locked thread whose stat this uid may not read is UNMEASURED — never read as a thread in exit', () => {
    const a = ask(leafOf(), `${THREAD_LOCKED} printf '4243 (x) R 1 4242 4242 0 -1 ${0x400100} 0 0\\n' > "$HOME/fp/4242/task/4243/stat";`
      + ' chmod 000 "$HOME/fp/4242/task/4243/stat";');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
  }, 60_000);

  it.skipIf(ROOT_USER)('a leader that exited whose task/ this uid may not list is UNMEASURED — its threads were never read', () => {
    const task = path.join(h.home, 'fp', '4242', 'task');
    try {
      const a = ask(leafOf(), `${LEADER_GONE} chmod 000 "$HOME/fp/4242/task";`);
      expect(a.rc, a.why).toBe('2');
      expect(a.why).toContain('could not be measured');
    } finally { if (fs.existsSync(task)) fs.chmodSync(task, 0o755); }
  }, 60_000);

  it('a status that does not parse is UNMEASURED — never "nobody"', () => {
    for (const bad of ['garbage', 'PPid:\\tx\\nUid:\\t1\\n', '']) {
      const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; printf '${bad}' > "$HOME/fp/4242/status";`);
      expect(a.rc, `status ${JSON.stringify(bad)}: ${a.why}`).toBe('2');
      expect(a.why).toContain('could not be measured');
    }
  }, 90_000);

  it('an entry that fails in a way no arm names (an environ that is a directory) is UNMEASURED — the catch-all', () => {
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)"; rm -f "$HOME/fp/4242/environ"; mkdir "$HOME/fp/4242/environ";`);
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('could not be measured');
  }, 60_000);

  it('every C0 control byte and DEL in a path a user uses reaches the answer as `?` — a tab and a newline included — and a space or a non-ASCII byte passes', () => {
    // The value carries \001 \033 \r \177 \037, then a TAB and a NEWLINE, then a FORGED probe row (`4243<TAB>cwd<TAB>/etc/...`),
    // then a space and the two bytes of one non-ASCII character. The bash reader splits the walk's output on tabs and
    // newlines, so a tab or a newline left in a path would be read as the walk's own row separator: the forged row would
    // reach the answer as a SECOND process, with a path outside the leaf. Only `?` for every C0 byte and DEL, a tab and
    // a newline too, keeps it ONE row; a space and a non-ASCII character are not controls and stay as they are.
    const a = ask(leafOf(), `${FAKE} _fpp 4242 1 "$(id -u)";`
      + ` printf 'TMPDIR=%s/a\\001b\\033c\\rd\\177e\\037f\\tg\\n4243\\tcwd\\t/etc/forged a\\303\\251b\\0' "${leafOf()}" > "$HOME/fp/4242/environ";`);
    expect(a.rc, a.why).toBe('1');
    expect(a.why, 'one row, one process: no forged second row, and the controls read `?`').toBe(
      `process 4242 carries TMPDIR=${leafOf()}/a?b?c?d?e?f?g?4243?cwd?/etc/forged a\u00e9b`);
    expect(a.why).not.toMatch(/[\x00-\x1f\x7f]/);
  }, 60_000);

  it('a table that cannot be listed, or one without ccd’s own pid, measured nothing', () => {
    const missing = ask(leafOf(), 'CCD_OS=linux; _ws_path_users_proc_root() { printf %s "$HOME/no-such-proc"; };');
    expect(missing.rc, missing.why).toBe('2');
    fs.mkdirSync(path.join(h.home, 'empty-proc'));
    const empty = ask(leafOf(), 'CCD_OS=linux; _ws_path_users_proc_root() { printf %s "$HOME/empty-proc"; };');
    expect(empty.rc, empty.why).toBe('2');
  }, 60_000);
});

describe('answers that never look', () => {
  it('Darwin answers unmeasured — no process environment is read there', () => {
    const a = ask(leafOf(), 'CCD_OS=darwin;');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('Darwin');
  }, 60_000);

  it('a path that is not one plain absolute spelling is unmeasured', () => {
    for (const p of ['relative/x', `${leafOf()}/`, `${h.home}//.cc-tmp/${ID}`, `${h.home}/.cc-tmp/../.cc-tmp/${ID}`]) {
      const a = ask(p, 'CCD_OS=linux;');
      expect(a.rc, `${p}: ${a.why}`).toBe('2');
    }
  }, 60_000);

  it('a walk that outruns its bound is unmeasured', () => {
    const a = ask(leafOf(), 'CCD_OS=linux; _plat_timeout() { return 124; };');
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toContain('did not finish within');
  }, 60_000);

  it.skipIf(ROOT_USER)('a parent that cannot be searched is unmeasured', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(path.join(locked, 'x'), { recursive: true });
    fs.chmodSync(locked, 0o000);
    try {
      const target = path.join(locked, 'x', ID);
      const a = ask(target, 'CCD_OS=linux;');
      expect(a.rc, a.why).toBe('2');
      // The ABSENCE guard answers, not the `cd` that would also fail after it.
      expect(a.why).toContain(`${locked} cannot be searched`);
      expect(a.why).toContain(` — who uses ${target} was never asked`);
    } finally { fs.chmodSync(locked, 0o755); }
  }, 60_000);
});
