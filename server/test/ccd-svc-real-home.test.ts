// `_svc_real_home` — the login name it expands comes from the ENVIRONMENT.
//
// The platform layer's sandbox guard (`_svc_launchctl`) asks for this user's
// real home through tilde expansion, which reads the password database rather
// than `$HOME`. Tilde expansion of a NAME HELD IN A VARIABLE needs `eval`, and
// the name is `$USER`/`$LOGNAME`: anything that starts ccd with a crafted one
// would have had `eval` run its shell syntax. On Darwin both the audit's
// unit-state read and the reclaim's launchd disable reach that guard, so the
// payload would run inside a protected start — the privileged direct entry
// whose whole point is that nothing the caller's environment supplies runs.
//
// What is pinned, for BOTH copies (`ccd/ccd` and `ccd/ccrc` carry the platform
// block byte for byte — `macos-platform.test.ts` holds that):
//   • a hostile name never executes (a canary file stays absent) and answers NO
//     home, exit 1 — never a guessed one;
//   • a name that would expand to something other than a user's home (`~0`,
//     `~+`, `~-` name the directory stack) is refused the same way;
//   • an ordinary name, and the `id -un` fallback, still resolve the real home;
//   • the fail direction at the guard: an unresolved home counts as a sandbox, so
//     the SYSTEM launchctl is refused (exit 1) rather than run — even when $HOME
//     is empty, where comparing "" with "" would have been a guess.
//
// Every run sources the script in a fixture HOME (`makeCcdHarness`); no ccd or
// ccrc verb runs, and no launchctl is ever executed — the system-binary case is
// made by answering `command -v launchctl` from a shell function, and the one
// case that lets the call proceed does so only on Linux, where no
// `/usr/bin/launchctl` exists to run (exit 127 is the proof it proceeded).
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { CCD, makeCcdHarness, ghContainedEnv } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';

const CCRC = path.join(path.dirname(CCD), 'ccrc');
const h = makeCcdHarness('ccd-svc-real-home-');
afterAll(() => h.cleanup());

const SEP = '\x1f';

type Env = Record<string, string | undefined>;

/** Source `script` in the fixture HOME and run `snippet`. `env` entries set to
 *  `undefined` are REMOVED from the child's environment. */
function run(script: string, snippet: string, env: Env = {}): { status: number | null; stdout: string; stderr: string } {
  const base: NodeJS.ProcessEnv = { ...process.env, HOME: h.home };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete base[k]; else base[k] = v;
  }
  const r = spawnSync('bash', ['-c', `source "$1"; ${snippet}`, 'svc-real-home', script], {
    encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, base, { systemd: true, tmux: true }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** `_svc_real_home`'s answer and exit status, for a login name given as both
 *  USER and LOGNAME (`undefined` removes both, reaching the `id -un` arm). */
function realHome(script: string, name: string | undefined, extra: Env = {}): { out: string; rc: string } {
  const r = run(script, `_svc_real_home; printf '${SEP}%s' "$?"`, { ...extra, USER: name, LOGNAME: name });
  expect(r.status, `the snippet itself ran (stderr: ${r.stderr})`).toBe(0);
  const i = r.stdout.lastIndexOf(SEP);
  expect(i, `the snippet printed its exit status (stdout: ${JSON.stringify(r.stdout)})`).toBeGreaterThanOrEqual(0);
  return { out: r.stdout.slice(0, i), rc: r.stdout.slice(i + 1) };
}

/** `command -v launchctl` answers the SYSTEM path; everything else is the
 *  builtin. Then `_svc_launchctl print <x>` and its exit status. */
const SYSTEM_LAUNCHCTL =
  `command() { if [ "\${1-}" = -v ] && [ "\${2-}" = launchctl ]; then printf '/usr/bin/launchctl\\n'; return 0; fi; builtin command "$@"; }; `;

function canary(tag: string): string {
  const p = path.join(h.home, `canary-${tag}`);
  rmSync(p, { force: true });
  return p;
}

/** A command that marks its canary (`$SVCRH_CANARY`), reached by NAME through
 *  PATH — so most payloads below carry no space and no `/`, only the one shell
 *  metacharacter under test, and a check that merely refused spaces or slashes
 *  could not pass them. */
const CANARY_BIN = path.join(h.home, 'canary-bin');
mkdirSync(CANARY_BIN, { recursive: true });
writeFileSync(path.join(CANARY_BIN, 'svcrhmark'), '#!/bin/sh\n: > "$SVCRH_CANARY"\n', { mode: 0o755 });

/** The payload shapes, each given its canary's path: a command substitution
 *  (with a path, bare, and mid-name), backticks (leading and mid-name), a `;`
 *  list, a newline, a pipe and the two `&` forms. Each marks its canary if it
 *  runs, and the bare forms are what make every admitted metacharacter red. */
const HOSTILE: Array<(c: string) => string> = [
  (c) => `$(touch ${c})`,
  () => '$(svcrhmark)',
  () => '`svcrhmark`',
  () => 'x`svcrhmark`',
  () => 'x;svcrhmark',
  () => 'x$(svcrhmark)y',
  () => 'x\nsvcrhmark',
  () => 'x|svcrhmark',
  () => 'x&&svcrhmark',
  () => 'x&svcrhmark',
];

/** The env a payload run needs: its canary, and the marker on PATH. */
const armed = (c: string): Env => ({ SVCRH_CANARY: c, PATH: `${CANARY_BIN}:${process.env['PATH'] ?? ''}` });

const SCRIPTS: Array<[string, string]> = [['ccd/ccd', CCD], ['ccd/ccrc', CCRC]];

describe.each(SCRIPTS)('%s: _svc_real_home never executes the login name', (_label, script) => {
  it('the CONTROL: each payload below DOES execute under a bare `eval printf "~$u"`', () => {
    // Without this the canary assertions below could be green because the
    // payload was inert, not because the name was refused.
    for (const [i, form] of HOSTILE.entries()) {
      const c = canary(`ctl-${i}`);
      const payload = form(c);
      const r = run(script, `u="$USER"; eval printf '%s' "~$u" >/dev/null 2>&1; wait; :`, { ...armed(c), USER: payload, LOGNAME: payload });
      expect(r.status, `control snippet ran (stderr: ${r.stderr})`).toBe(0);
      expect(existsSync(c), `the bare eval ran the payload ${JSON.stringify(payload)}`).toBe(true);
      rmSync(c, { force: true });
    }
  });

  it('a USER carrying $(…), backticks, `;`, a newline, `|` or `&` never runs, and answers no home: exit 1', () => {
    for (const [i, form] of HOSTILE.entries()) {
      const c = canary(`hostile-${i}`);
      const name = form(c);
      const r = realHome(script, name, armed(c));
      expect(existsSync(c), `the login name ${JSON.stringify(name)} was executed`).toBe(false);
      expect(r, `the login name ${JSON.stringify(name)} must answer no home, exit 1`).toEqual({ out: '', rc: '1' });
    }
  });

  it('a name tilde expansion would read as the directory stack, not a user, is refused: ~0, ~+, ~-', () => {
    for (const name of ['0', '+', '-', '-x', '+1', '5user', '.hidden', 'a b', 'a/b', '~', 'a*']) {
      expect(realHome(script, name), `the login name ${JSON.stringify(name)}`).toEqual({ out: '', rc: '1' });
    }
  });

  it('an ordinary login name still resolves the real home, from the password database', () => {
    const me = userInfo();
    expect(realHome(script, me.username)).toEqual({ out: me.homedir, rc: '0' });
    // And it is not $HOME: the fixture HOME is a sandbox, which is the guard's question.
    expect(me.homedir).not.toBe(h.home);
  });

  it('with neither USER nor LOGNAME, `id -un` still resolves it', () => {
    const me = userInfo();
    expect(realHome(script, undefined)).toEqual({ out: me.homedir, rc: '0' });
  });

  it('the fail direction: the SYSTEM launchctl is refused when the home cannot be resolved — even with an empty $HOME', () => {
    for (const [i, form] of HOSTILE.entries()) {
      const c = canary(`guard-${i}`);
      const name = form(c);
      for (const home of ['"$HOME"', '""']) {
        const r = run(script, `${SYSTEM_LAUNCHCTL}HOME=${home}; _svc_launchctl print gui/0/x >/dev/null 2>&1; printf '%s' "$?"`,
          { ...armed(c), USER: name, LOGNAME: name });
        expect(r.status, `snippet ran (stderr: ${r.stderr})`).toBe(0);
        expect(r.stdout, `HOME=${home}, USER=${JSON.stringify(name)}: the system launchctl must be refused (1), never run`).toBe('1');
        expect(existsSync(c), `the login name ${JSON.stringify(name)} was executed`).toBe(false);
      }
    }
    // A well-formed name nobody has is no home either: tilde expansion leaves it
    // unexpanded, and that is not $HOME.
    const r = run(script, `${SYSTEM_LAUNCHCTL}_svc_launchctl print gui/0/x >/dev/null 2>&1; printf '%s' "$?"`,
      { USER: 'nosuchuser_q7z', LOGNAME: 'nosuchuser_q7z' });
    expect(r.stdout).toBe('1');
  });

  // PLATFORM-ONLY: a macOS box ships a real /usr/bin/launchctl, and this case
  // must never run one; on Linux the path does not exist, so 127 is the proof.
  itLinux('the CONTROL: with the real home resolved and equal to $HOME, the same call PROCEEDS (127: no launchctl here to run)', () => {
    // Tells the refusal above (1) from a call that never got as far as the
    // guard: here the guard passes and bash tries the system path, which a
    // Linux box does not have. The real home is pre-seeded into the cache so
    // this never needs the operator's live $HOME.
    const r = run(script, `${SYSTEM_LAUNCHCTL}_SVC_REAL_HOME="$HOME"; _svc_launchctl print gui/0/x >/dev/null 2>&1; printf '%s' "$?"`);
    expect(r.status, `snippet ran (stderr: ${r.stderr})`).toBe(0);
    expect(r.stdout).toBe('127');
  });
});
