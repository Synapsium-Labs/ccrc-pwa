// `ccd keep-awake --session <id> --state on|off` — the two sleep markers' one writer in the tree (the Overlord W1 ccd arms,
// plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ccd-arms.md` Task 1; spec 2026-11-09 §3.2, C4). It writes
// `$REG/<id>.no-hibernate` and `$REG/<id>.no-roll` holding its stamp, removes only a marker holding exactly that stamp, and
// keeps any other marker as the operator's opt-out (questions 7 and 8). A server-composed verb, never a session's.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): `$REG` is `$HOME/.cc-sessions`, so nothing here can reach the live registry, and no
// case starts, stops or hibernates a session.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { approvalClass, rootsForChild, FORBIDDEN_CCD_VERBS } from '../src/coord/approvalguard.js';
import { CHILD_DENY_RULES } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-keep-awake-'); });
afterEach(() => {
  // A mode-000 marker or a read-only $REG would stop the harness's own cleanup.
  try { fs.chmodSync(REG(), 0o755); } catch { /* already gone */ }
  for (const m of MARKERS) { try { fs.chmodSync(marker(m), 0o644); } catch { /* absent, or a link */ } }
  h.cleanup();
});

const ID = 'demo-quiet-basin';
const STAMP = 'keep-awake v1';
const MARKERS = ['no-hibernate', 'no-roll'] as const;
const REG = (): string => path.join(h.home, '.cc-sessions');
const marker = (m: string, id = ID): string => path.join(REG(), `${id}.${m}`);
const seedRow = (id = ID): void => { fs.writeFileSync(path.join(REG(), `${id}.uuid`), '00000000-0000-4000-8000-000000000001\n'); };
const entryOf = (m: string): fs.Stats | null => { try { return fs.lstatSync(marker(m)); } catch { return null; } };
const kept = (m: string): string => `kept ${m}: not keep-awake's`;

interface Ran { code: number; stdout: string; stderr: string }
/** The verb in source mode, stdout and stderr kept apart: a refusal that still printed `awake` is the defect that matters. */
const ka = (args: string, pre = '', env: NodeJS.ProcessEnv = {}): Ran => {
  try { return { code: 0, stdout: h.sh(`${pre} cmd_keep_awake ${args}`, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};
const on = (pre = '', env: NodeJS.ProcessEnv = {}): Ran => ka(`--session ${ID} --state on`, pre, env);
const off = (pre = '', env: NodeJS.ProcessEnv = {}): Ran => ka(`--session ${ID} --state off`, pre, env);

describe('ccd keep-awake on and off', () => {
  it('on writes both markers holding the stamp\'s exact bytes, and a second on changes nothing', () => {
    seedRow();
    expect(on()).toEqual({ code: 0, stdout: `awake ${ID}`, stderr: '' });
    for (const m of MARKERS) expect(fs.readFileSync(marker(m), 'latin1'), m).toBe(STAMP);
    const before = MARKERS.map((m) => { const s = fs.lstatSync(marker(m)); return [s.ino, s.mtimeMs]; });
    expect(on()).toEqual({ code: 0, stdout: `awake ${ID}`, stderr: '' });
    expect(MARKERS.map((m) => { const s = fs.lstatSync(marker(m)); return [s.ino, s.mtimeMs]; })).toEqual(before);
  });

  it('off removes both', () => {
    seedRow();
    on();
    expect(off()).toEqual({ code: 0, stdout: `released ${ID}`, stderr: '' });
    for (const m of MARKERS) expect(entryOf(m), m).toBeNull();
  });

  it('off on a row with no markers, and on a purged row, is exit 0', () => {
    seedRow();
    expect(off()).toEqual({ code: 0, stdout: `released ${ID}`, stderr: '' });
    fs.rmSync(path.join(REG(), `${ID}.uuid`));
    expect(off()).toEqual({ code: 0, stdout: `released ${ID}`, stderr: '' });
  });

  it('on a missing row is exit 1 and writes nothing', () => {
    const r = on();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`no such session: ${ID}`);
    expect(r.stdout).toBe('');
    for (const m of MARKERS) expect(entryOf(m), m).toBeNull();
  });
});

describe('ccd keep-awake keeps a marker it did not write', () => {
  it.each([['an empty (hand-touched)', ''], ['a foreign-bytes', 'opted out by hand\n'],
    ['the stamp with a newline', `${STAMP}\n`], ['the stamp with a NUL', `${STAMP}\0`], ['a longer', `${STAMP}${'x'.repeat(80)}`]])(
    '%s .no-roll survives on and off, each printing the kept line on stdout', (_what, bytes) => {
      seedRow();
      fs.writeFileSync(marker('no-roll'), bytes);
      const a = on();
      expect([a.code, a.stdout.split('\n')]).toEqual([0, [kept('no-roll'), `awake ${ID}`]]);
      expect(fs.readFileSync(marker('no-hibernate'), 'latin1'), 'its own marker is still written').toBe(STAMP);
      const b = off();
      expect([b.code, b.stdout.split('\n')]).toEqual([0, [kept('no-roll'), `released ${ID}`]]);
      expect(fs.readFileSync(marker('no-roll'), 'latin1')).toBe(bytes);
      expect(entryOf('no-hibernate'), 'its own marker is removed').toBeNull();
    });

  it('a hand marker created inside the window between the check and the create survives on', () => {
    // The window, opened: the real `_keep_awake_ours` answers absent, and then a hand marker appears before the create.
    seedRow();
    const window = `eval "$(declare -f _keep_awake_ours | sed '1s/^_keep_awake_ours/_ka_real/')";`
      + ` _keep_awake_ours() { _ka_real "$@"; local r=$?; [[ "$2" == no-roll ]] && printf 'mine' > "$REG/$1.no-roll"; return $r; };`;
    const r = on(window);
    expect([r.code, r.stdout.split('\n')]).toEqual([0, [kept('no-roll'), `awake ${ID}`]]);
    expect(fs.readFileSync(marker('no-roll'), 'latin1'), 'the create never replaced it').toBe('mine');
  });

  it.each(['a dangling link', 'a link to the stamp', 'a directory', 'a FIFO', 'mode 000'])(
    'a .no-roll that is %s survives off, and off exits 1', (what) => {
      seedRow();
      const f = marker('no-roll');
      if (what === 'a dangling link') fs.symlinkSync(path.join(h.home, 'nowhere'), f);
      if (what === 'a link to the stamp') { fs.writeFileSync(path.join(h.home, 'stamp'), STAMP); fs.symlinkSync(path.join(h.home, 'stamp'), f); }
      if (what === 'a directory') fs.mkdirSync(f);
      if (what === 'a FIFO') spawnSync('mkfifo', [f]);
      if (what === 'mode 000') { fs.writeFileSync(f, STAMP); fs.chmodSync(f, 0o000); }
      const t0 = Date.now();
      const r = off();
      expect(Date.now() - t0, 'the FIFO is never opened').toBeLessThan(15_000);
      expect([r.code, r.stdout.split('\n')]).toEqual([1, [kept('no-roll'), `released ${ID}`]]);
      expect(entryOf('no-roll'), 'kept').not.toBeNull();
    }, 30_000);

  it('a marker swapped for a FIFO between the regular-file test and the open is unreadable within the bound', () => {
    // The race the time bound closes: `head` itself swaps the file for a FIFO before it opens it.
    seedRow();
    fs.writeFileSync(marker('no-roll'), STAMP);
    const fake = path.join(h.home, 'fakebin');
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'head'), `#!/bin/sh\nfor a; do f=$a; done\nrm -f -- "$f" && mkfifo -- "$f"\nexec /usr/bin/env -i PATH=/usr/bin:/bin head "$@"\n`, { mode: 0o755 });
    const t0 = Date.now();
    const r = off(`PATH="${fake}:$PATH";`);
    expect(Date.now() - t0, 'bounded by _plat_timeout 2 and its grace').toBeLessThan(15_000);
    expect([r.code, r.stdout.split('\n')]).toEqual([1, [kept('no-roll'), `released ${ID}`]]);
  }, 30_000);

  it('the same bytes give the same verdict under LC_ALL=C and en_US.UTF-8', () => {
    for (const LC_ALL of ['C', 'en_US.UTF-8', 'C.UTF-8']) {
      seedRow();
      on('', { LC_ALL });
      fs.writeFileSync(marker('no-roll'), 'keep‑awake v1');   // a non-ASCII hyphen: other bytes
      const r = off('', { LC_ALL });
      expect([r.code, r.stdout.split('\n')], LC_ALL).toEqual([0, [kept('no-roll'), `released ${ID}`]]);
      expect(entryOf('no-hibernate'), `${LC_ALL}: the stamp is ours`).toBeNull();
      fs.rmSync(marker('no-roll'));
    }
  });
});

describe('ccd keep-awake refuses before it writes', () => {
  it.each([['--state on --session x'], ['--session'], [`--session ${ID} --state maybe`], ['--session -x --state on'],
    ["--session 'a b' --state on"], [`--session ${ID} --state on extra`], [`--session ${ID}`], ['']])(
    'argv %j is refused with nothing written', (args) => {
      seedRow();
      seedRow('-x');
      const r = ka(args);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout).toBe('');
      expect(fs.readdirSync(REG()).filter((f) => /no-(hibernate|roll)$/.test(f))).toEqual([]);
    });

  it('an unwritable $REG makes on exit 1 naming the marker, with no awake line', () => {
    seedRow();
    fs.chmodSync(REG(), 0o555);
    const r = on();
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${ID}.no-hibernate`);
    expect(r.stdout).not.toContain('awake');
  });

  it('a bare bash ccd/ccd keep-awake (not under -p) is refused entry-unprivileged, exit 125, nothing written', () => {
    seedRow();
    const r = spawnSyncGroup('bash', [CCD, 'keep-awake', '--session', ID, '--state', 'on'], {
      cwd: h.home, encoding: 'utf8', timeout: 60_000,
      env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r.status, r.stderr).toBe(125);
    expect(r.stderr).toContain('ccd: refused (entry-unprivileged): keep-awake');
    for (const m of MARKERS) expect(entryOf(m), m).toBeNull();
  });
});

describe('ccd caps advertises the verb and its token', () => {
  it('lists keep-awake and keep-awake-v1', () => {
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps).toContain('keep-awake');
    expect(caps).toContain('keep-awake-v1');
  });
});

// Plan Task 3: `keep-awake` is a server-composed verb, forbidden to every session (CLAUDE.md SAFETY). Each layer is pinned by
// name here, so dropping the word from any one list reds a case: the approval classifier, the hook's two jq arms (a plain
// `ccd` head, and an expanded `$VAR` head), and the child deny file. A top-level session runs with permissions bypassed, so
// for it this is a convention, as it is for `ws-lease-mark` and `delegation-adopt`.
describe('keep-awake is forbidden to every session', () => {
  const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
  const forbiddenJq = (): string => {
    const m = fs.readFileSync(HOOK, 'utf8').match(/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m);
    if (m === null) throw new Error('APPROVAL_FORBIDDEN_JQ is not one single-quoted assignment in the hook');
    return m[1] as string;
  };
  const hookSays = (command: string): string => {
    const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--arg', 'mode', 'deny', forbiddenJq()], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it('the approval classifier marks it forbidden, and its list names it', () => {
    expect(FORBIDDEN_CCD_VERBS).toContain('keep-awake');
    const roots = rootsForChild({ id: 'project-a-quiet-basin', workdir: '/rig/home/ws/a', child: { kind: 'child', runId: 7 } }, '/rig/home');
    if (roots === null) throw new Error('the fixture child row has no roots');
    expect(approvalClass('Bash', { command: 'ccd keep-awake --session x --state on' }, { ...roots, cwd: '/rig/home/ws/a' })).toBe('forbidden');
    expect(approvalClass('Bash', { command: 'echo keep-awake' }, { ...roots, cwd: '/rig/home/ws/a' }), 'CONTROL').not.toBe('forbidden');
  });

  it('the hook denies it on both arms, a plain ccd head and an expanded one', () => {
    expect(hookSays('ccd keep-awake --session x --state on')).toContain('ccd keep-awake');
    expect(hookSays('"$CCD" keep-awake --session x --state off')).toContain('ccd keep-awake');
    expect(hookSays('echo keep-awake'), 'CONTROL: a mention is not a run').toBe('');
  });

  it('the child deny file names it', () => {
    expect(CHILD_DENY_RULES).toContain('Bash(ccd keep-awake:*)');
  });
});
