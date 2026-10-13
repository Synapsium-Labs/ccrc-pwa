// `ccd-account-auth` — the helper the auth pane runs, and the one method it
// does not need a pane for. Three methods, one status file, and a credential
// that never crosses a stream.
//
// The filename starts with `ccd`, so `ccd-workspaces.test.ts`'s scan owns
// every bash spawn below: each carries ghContainedEnv + systemd + tmux, inside
// the twelve-line lookback that scan reads (`SCAN_LOOKBACK_LINES`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import {
  makeCcdHarness, ghContainedEnv, harnessBin, seedAccountsSh, CCD, type CcdHarness,
} from './ccdWsHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { markGenerated } from '../../shared/mark.mjs';
import { generateWrapperBody } from '../../shared/wrapper.mjs';

const CCD_ROOT = path.resolve(__dirname, '../../ccd');
const HELPER = path.join(CCD_ROOT, 'ccd-account-auth');
const REG = (home: string): string => path.join(home, '.cc-sessions');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-auth-'); });
afterEach(() => { h.cleanup(); });

/** Source the helper WITHOUT running its main, so a single function can be
 *  asserted. `CCRC_AUTH_NO_MAIN` is the helper's own test seam, and it is one
 *  line rather than a `BASH_SOURCE` guard because this file is exec'd by tmux
 *  and never sourced in production — a guard would be untested machinery.
 *
 *  Values reach the snippet through the ENVIRONMENT, never interpolated into
 *  it. Later tasks' OSC-8 fixtures carry raw ESC and BEL bytes, which
 *  `JSON.stringify` renders as six-character escape sequences — six literal
 *  characters to bash, not one control byte. An environment variable carries
 *  the byte itself. */
const fn = (snippet: string, env: NodeJS.ProcessEnv = {}): string =>
  execFileSync('bash', ['-c', `source "${HELPER}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home,
    env: ghContainedEnv(h.home,
      { ...process.env, HOME: h.home, CCRC_AUTH_NO_MAIN: '1', ...env },
      { systemd: true, tmux: true }),
  }).trim();

const status = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(REG(h.home), '.auth', `${id}.json`), 'utf8'));

describe('ccd-account-auth — the status file', () => {
  it('publishes {state,updatedAt} and nothing it was not given', () => {
    fn('AUTH_ID=claude-a; _auth_state starting');
    const s = status('claude-a');
    expect(Object.keys(s).sort()).toEqual(['state', 'updatedAt']);
    expect(s['state']).toBe('starting');
    // An ISO-8601 UTC STRING, not `date +%s%3N` — that spelling is GNU-only
    // and answers `<epoch>3N` on BSD, a string jq takes and every reader
    // misreads.
    expect(s['updatedAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('carries url, userCode and error only once they exist — absence is not an empty string', () => {
    fn('AUTH_ID=claude-a; AUTH_URL=https://claude.com/cai/oauth/authorize?code=true; _auth_state url');
    expect(status('claude-a')).toMatchObject({ state: 'url', url: 'https://claude.com/cai/oauth/authorize?code=true' });
    expect(status('claude-a')).not.toHaveProperty('userCode');
    expect(status('claude-a')).not.toHaveProperty('error');
  });

  it('is 0600 in a 0700 DOT-directory the registry globs cannot see', () => {
    fn('AUTH_ID=claude-a; _auth_state starting');
    const dir = path.join(REG(h.home), '.auth');
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, 'claude-a.json')).mode & 0o777).toBe(0o600);
    // The property `.lifecycle/` and `.reaped/` already rely on: `$REG/<id>.*`
    // never matches a leading dot, so `_reg_purge` cannot reach it. ASSERTED
    // ON THE DIRECTORY ENTRY, not on a `"$REG"/*.json` glob: a bash `*`
    // matches ONE path component, so such a glob answers '' just as happily
    // for `$REG/auth/claude-a.json` as for the dotted spelling, and the
    // mutation that drops the dot would stay green.
    const entries = fs.readdirSync(REG(h.home)).sort();
    expect(entries).toContain('.auth');
    expect(entries.filter((e) => !e.startsWith('.')),
      'every artifact this helper writes under $REG is dot-prefixed').toEqual([]);
  });

  it('_auth_die records the reason in the file as well as on stderr', () => {
    let stderr = '';
    try { fn('AUTH_ID=claude-a; _auth_die "launcher-absent"'); }
    catch (e) { stderr = String((e as { stderr?: string }).stderr ?? ''); }
    expect(stderr).toContain('launcher-absent');
    expect(status('claude-a')).toMatchObject({ state: 'failed', error: 'launcher-absent' });
  });
});

describe('ccd-account-auth — the argv contract', () => {
  const run = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [HELPER, ...args], opts).trim(), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
    }
  };

  it('needs exactly an id and a method', () => {
    expect(run().stderr).toContain('usage: ccd-account-auth <id> <login|setup-token|openai-login>');
    expect(run('claude-a').code).toBe(1);
  });

  it('refuses an id ID_RE does not admit, and one no roster entry claims', () => {
    expect(run('../etc', 'login').stderr).toContain('bad id');
    expect(run('claude-zzz', 'login').stderr).toContain('unknown-account: claude-zzz');
  });

  it('refuses a method it does not implement', () => {
    expect(run('claude-a', 'telepathy').stderr).toContain('bad method: telepathy');
  });
});

describe('ccd-account-auth — the platform shim it had to carry', () => {
  const ccd = fs.readFileSync(CCD, 'utf8');
  const helper = fs.readFileSync(HELPER, 'utf8');
  const body = (src: string, name: string): string => {
    const m = new RegExp(`${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}`).exec(src);
    expect(m, `${name} not found`).not.toBeNull();
    return m![1]!;
  };

  it('_auth_timeout carries _plat_timeout\'s body byte for byte — the copy cannot drift', () => {
    // `session-hook.sh`'s `_hook_epoch_ms` precedent, pinned the same way in
    // `macos-platform.test.ts`. This file is exec'd by tmux and sources
    // nothing, so a local copy is the only shape available; the pin is what
    // makes "deliberate copy" different from "a copy nobody is watching".
    // BYTE equality, which means every comment `_plat_timeout` carries — the
    // `|| exit 0` argument, and D-2272/D-2332's argument for the watcher's
    // discarded streams — is part of the copy.
    expect(body(helper, '_auth_timeout')).toBe(body(ccd, '_plat_timeout'));
  });

  it('and so does ccrc\'s copy — the THIRD one, which is pinned only by region (D-2764)', () => {
    // `macos-platform.test.ts:54` already holds this, but it holds it by
    // SLICING the platform block out of both files and comparing the slices —
    // so it protects this shim only for as long as the shim stays between the
    // block's sentinels. This assertion names the function instead, and
    // therefore survives someone moving it out. It is deliberately redundant:
    // D-2764's own census called this copy "pinned by nothing" because a grep
    // for `_plat_timeout` across `server/test` finds no name-based pin, and a
    // guard nobody can find is one somebody edits around.
    const ccrc = fs.readFileSync(path.join(CCD_ROOT, 'ccrc'), 'utf8');
    expect(body(ccrc, '_plat_timeout')).toBe(body(ccd, '_plat_timeout'));
  });

  it('spells no GNU-only command — it is in macos-platform\'s derived corpus from today', () => {
    // Restated here so the reason lands beside the code rather than only in a
    // corpus derivation two files away. Seven of the ten patterns
    // `macos-platform.test.ts` carries, the seven this file could plausibly
    // spell; that file's own derived `it` is the exhaustive one, and this is
    // the local reminder that it exists.
    for (const re of [/(?<![-_a-zA-Z])timeout\s+[-"'$0-9]/, /(?:\$\(|^|[|;&=`])\s*mktemp\b(?![^)\n]*XXXX)/,
      /(?<![-_a-zA-Z])stat\s+-[cf]/, /(?<![-_a-zA-Z])sha256sum\b/, /date\s+\+%s%3N/,
      /(?<![-_a-zA-Z])mv\s+-[a-zA-Z]*T/, /(?<![-_a-zA-Z])uuidgen\b/]) {
      const hit = helper.split('\n').filter((l) => !/^\s*#/.test(l)).find((l) => re.test(l));
      expect(hit, `ccd-account-auth spells a GNU-only command: ${hit}`).toBeUndefined();
    }
  });

  it('derives CCD_OS the way the rest of the tree does', () => {
    expect(fn('printf %s "$CCD_OS"')).toBe(process.platform === 'darwin' ? 'darwin' : 'linux');
  });
});

describe('the dot-prefixed registry inventory is a census, not a memory', () => {
  // `_reg_purge`'s R-3 boundary paragraph claims to BE the boundary: it names
  // every dot-prefixed artifact under `$REG` and splits them into the ones a
  // dot-leading project id can alias and the ones it cannot. Nothing measured
  // it, and it went stale one task before this one — `$REG/.account-placement.lock`
  // (`ccrc account`'s placement lock) landed with no amendment at all, so the
  // paragraph asserted EIGHT about a tree that held nine. This is the census
  // that makes the next one a red suite instead of a reader's luck.
  const REGION_FROM = '# R-3, wave review.';
  const REGION_TO = '# THAT SKIP IS THE LOOP';
  const CARDINAL = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN'];

  /** What a scan for `$REG/.<name>` literals CANNOT see, each with its reason
   *  — and each SELF-CHECKED below, so this cannot quietly become the memory
   *  it exists to replace: an entry must be absent from the literal scan (or
   *  it is stale) and present in ccd's source (or it names nothing). */
  const UNSCANNABLE: Record<string, string> = {
    prstate: "built inside `_pr_py`'s embedded PYTHON, not by bash — "
      + "os.path.join(reg, '.prstate-' + id_ + '.lock')",
  };

  /** And two the paragraph names in prose that NO literal scan can ever reach,
   *  because their name is an interpolated id rather than a literal:
   *  `_reg_set`'s own tmps and session-hook.sh's `.$id.$$.hookstate.tmp`. */
  const VARIABLE_NAMED = 2;

  /** Every `$REG/.<name>` / `$_SVC_REG/.<name>` literal any bash file under
   *  `ccd/` writes, with a trailing `-` (an id is interpolated after it)
   *  trimmed off. Comment lines are dropped so the paragraph cannot satisfy
   *  the scan by naming an artifact nothing creates. */
  const derived = (): Set<string> => {
    const out = new Set<string>();
    for (const name of fs.readdirSync(CCD_ROOT, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => fs.readFileSync(path.join(CCD_ROOT, n), 'utf8').startsWith('#!'))) {
      const code = fs.readFileSync(path.join(CCD_ROOT, name), 'utf8')
        .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      for (const m of code.matchAll(/\$(?:REG|_SVC_REG)\/\.([a-z][a-z0-9-]*)/g)) {
        out.add(m[1]!.replace(/-+$/, ''));
      }
    }
    return out;
  };

  it('names every dot-prefixed artifact the shipped bash actually writes', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf(REGION_FROM);
    const to = src.indexOf(REGION_TO, from);
    expect(from, 'the R-3 block moved — re-anchor this test').toBeGreaterThan(-1);
    expect(to, 'the boundary paragraph moved — re-anchor this test').toBeGreaterThan(from);
    const region = src.slice(from, to);
    const found = [...derived()].sort();
    // Anti-vacuity: a broken regex would make every assertion below pass over
    // an empty set, which is the exact "test that cannot fail" this repo keeps
    // finding.
    expect(found.length, 'the scan found no dot-prefixed registry artifact at all')
      .toBeGreaterThanOrEqual(7);
    for (const name of found) {
      expect(region, `$REG/.${name} is written by ccd's own bash and the R-3 boundary paragraph does not name it`)
        .toContain(`.${name}`);
    }
    // The declared blind spots, each checked in BOTH directions so the list
    // cannot go stale in either: an entry the scan can now see is a stale
    // exemption, and an entry ccd no longer spells names nothing.
    for (const [name, why] of Object.entries(UNSCANNABLE)) {
      expect(found, `$REG/.${name} is now reachable by the literal scan — drop its UNSCANNABLE entry (${why})`)
        .not.toContain(name);
      expect(src, `ccd no longer spells .${name}- — drop its UNSCANNABLE entry`).toContain(`.${name}-`);
      expect(region, `$REG/.${name} exists and the R-3 boundary paragraph does not name it`)
        .toContain(`.${name}`);
    }
    // The cardinal is DERIVED, not remembered: what the scan found, plus the
    // declared blind spots, plus the two whose name is an interpolated id.
    // That arithmetic is what keeps the written number tied to a measurement.
    const total = found.length + Object.keys(UNSCANNABLE).length + VARIABLE_NAMED;
    expect(region, `the boundary paragraph's cardinal disagrees with the ${total} artifacts measured (${found.length} scanned + ${Object.keys(UNSCANNABLE).length} unscannable + ${VARIABLE_NAMED} variable-named)`)
      .toContain(`${CARDINAL[total]} dot-prefixed`);
  });
});

/** The two control bytes the OSC-8 hyperlink form is built from, spelled here
 *  rather than embedded as literals: an invisible ESC in a source file is a
 *  byte a reviewer cannot see and a copy-paste can silently drop. */
const ESC = '\x1b';
const BEL = '\x07';
const OAUTH_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&state=fixture-state';

/** A token in the PARENT's environment, so `env -u CLAUDE_CODE_OAUTH_TOKEN`
 *  is load-bearing rather than decorative. Without this the `<unset>`
 *  assertion below passes on a helper that never removes anything — the
 *  variable was never set in the first place — which is a test pinning a
 *  shape instead of an effect. Not a secret: a fixture string chosen to be
 *  recognisable if it ever leaks into a transcript. */
const PARENT_TOKEN = 'sk-ant-oat01-fixture-must-not-reach-the-child';

/** A fake launcher standing in for the UPSTREAM launcher. It replays the
 *  measured bytes and then blocks on stdin exactly as the real one does.
 *  `harnessBin` is `<home>/.local/bin`, i.e. `WRAPPER_DIR` — the same
 *  directory `makeCcdHarness` plants its stub wrappers in, so this REPLACES
 *  the stub for the id it names. */
function plantLauncher(id: string, body: string): void {
  fs.writeFileSync(path.join(harnessBin(h.home), id), body, { mode: 0o755 });
}

/** The measured stream, built by the fixture's own `printf` rather than
 *  interpolated from JS: `printf` understands the octal escapes, and a
 *  JSON-stringified ESC would land in the script as six literal characters.
 *  `%s` twice on one line is the doubling — once as the escape's target, once
 *  as the visible text. The last line carries NO trailing newline, which is
 *  the whole reason `read -t` exists below. */
const REPLAY_STREAM =
  `URL=${JSON.stringify(OAUTH_URL)}\n`
  + "printf 'Opening browser to sign in.\\n'\n"
  + "printf 'If the browser did not open, visit: \\033]8;;%s\\007%s\\033]8;;\\007\\n' \"$URL\" \"$URL\"\n"
  + "printf 'Paste code here if prompted > '\n";

/** Records what the launcher was given, replays the stream, then blocks on
 *  stdin the way the real `auth login` does. Nothing feeds it here — Task 53
 *  is where a code arrives — so every run below ends at the deadline. */
const LOGIN_REPLAY =
  '#!/usr/bin/env bash\n'
  + 'printf %s "$CLAUDE_CONFIG_DIR" > "$HOME/seen-config-dir"\n'
  + 'printf %s "${CLAUDE_CODE_OAUTH_TOKEN-<unset>}" > "$HOME/seen-token-env"\n'
  + 'printf \'%s\\n\' "$*" > "$HOME/seen-argv"\n'
  + REPLAY_STREAM
  + 'IFS= read -r got\n'
  + 'printf %s "$got" > "$HOME/seen-code"\n'
  + 'mkdir -p "$CLAUDE_CONFIG_DIR" && printf \'{"fixture":true}\' > "$CLAUDE_CONFIG_DIR/.credentials.json"\n'
  + 'chmod 600 "$CLAUDE_CONFIG_DIR/.credentials.json"\n'
  + 'echo done\nexit 0\n';

describe('ccd-account-auth — the OSC-8 strip', () => {
  const strip = (line: string): string => fn('_auth_strip_osc8 "$LINE"', { LINE: line });
  const urlOf = (line: string): string => fn('_auth_url_of "$LINE"', { LINE: line });

  it('removes the hyperlink escape and leaves the visible text once', () => {
    const line = `If the browser did not open, visit: ${ESC}]8;;${OAUTH_URL}${BEL}${OAUTH_URL}${ESC}]8;;${BEL}`;
    expect(strip(line)).toBe(`If the browser did not open, visit: ${OAUTH_URL}`);
  });

  it('handles the ST terminator form too — ESC-backslash, not BEL', () => {
    const line = `visit: ${ESC}]8;;${OAUTH_URL}${ESC}\\${OAUTH_URL}${ESC}]8;;${ESC}\\`;
    expect(strip(line)).toBe(`visit: ${OAUTH_URL}`);
  });

  it('leaves an ordinary line alone', () => {
    expect(strip('Opening browser to sign in')).toBe('Opening browser to sign in');
  });

  it('takes the URL ONCE — and the raw line is exactly the trap', () => {
    expect(urlOf(`If the browser did not open, visit: ${OAUTH_URL}`)).toBe(OAUTH_URL);
    // The unstripped line, measured: the first `https://` run swallows the BEL
    // (which is `\a`, NOT a member of `[[:space:]]`) and the second copy with
    // it. This is the value a reader that regexed the RAW bytes would have
    // handed the operator to open.
    const raw = `visit: ${ESC}]8;;${OAUTH_URL}${BEL}${OAUTH_URL}${ESC}]8;;${BEL}`;
    const trapped = urlOf(raw);
    expect(trapped).not.toBe(OAUTH_URL);
    expect(trapped.length).toBeGreaterThan(OAUTH_URL.length);
  });
});

describe('ccd-account-auth — login over a plain pipe', () => {
  /** Runs the helper to its DEADLINE. Nothing writes the code FIFO in this
   *  task, so `login` always ends `expired` here; Task 53 adds the feeder and
   *  with it the `done` half. `CCRC_AUTH_TIMEOUT` is small on purpose — the
   *  expiry is the terminator, not a hang the vitest timeout has to catch. */
  const runLogin = (id: string): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home, timeout: 60_000,
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '6',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [HELPER, id, 'login'], opts), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('publishes the single clean URL, and the transcript carries no escape', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    const r = runLogin('claude-a');
    // The URL the operator is asked to open, exactly once and with no escape.
    expect(status('claude-a')['url']).toBe(OAUTH_URL);
    // The transcript the pane/drawer sees carries the stripped line.
    expect(r.stdout).toContain(`If the browser did not open, visit: ${OAUTH_URL}`);
    expect(r.stdout).not.toContain(']8;;');
  });

  it('reaches waiting-code on a prompt that carries no newline, then expires', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    const r = runLogin('claude-a');
    // `Paste code here if prompted > ` is the LAST thing the child writes and
    // it carries no newline. A plain `read` loop could never have seen it.
    expect(r.stdout).toContain('Paste code here if prompted');
    // Nobody typed a code, so the deadline is what ends this — and `expired`
    // is a different terminal state from `failed`, because retyping a code
    // into a process that is gone is the thing that distinction prevents.
    expect(r.code).toBe(1);
    expect(status('claude-a')['state']).toBe('expired');
    expect(r.stderr).toBe('');
  });

  it('runs the UPSTREAM launcher, in the lane\'s own config dir, with no inherited token', () => {
    // `CCRC_UPSTREAM` is `claude` in the fixture roster — the one
    // `exec.kind: 'upstream'` entry. The lane's OWN launcher is not used here
    // and cannot be: `claude-a` is a generated lane with a `secretsFile`, and
    // a generated wrapper re-sources that file INSIDE the child
    // (`shared/wrapper.mjs`), putting back the very token `env -u` removed.
    // Running the upstream launcher with the config dir set explicitly is the
    // same shape `setup-token` takes, and it is what makes the `<unset>`
    // below a fact about the shipped path — the parent really does carry a
    // token, so the removal is measured rather than assumed.
    plantLauncher('claude', LOGIN_REPLAY);
    const r = runLogin('claude-a');
    expect(fs.readFileSync(path.join(h.home, 'seen-config-dir'), 'utf8'))
      .toBe(path.join(h.home, '.claude-a'));
    expect(fs.readFileSync(path.join(h.home, 'seen-token-env'), 'utf8')).toBe('<unset>');
    expect(fs.readFileSync(path.join(h.home, 'seen-argv'), 'utf8').trim())
      .toBe('auth login --claudeai');
    // …and it reached no stream either.
    expect(r.stdout).not.toContain(PARENT_TOKEN);
    expect(JSON.stringify(status('claude-a'))).not.toContain(PARENT_TOKEN);
  });

  it('refuses a launcher that exits 0 having written no credential', () => {
    // THE SUCCESS PATH'S ONE GUARD, and the only case in this task that can
    // reach it: every other run here ends at the deadline, so `rc == 124`
    // short-circuits before the credential is ever looked for. A launcher that
    // says it worked and wrote nothing is the shape that would otherwise flip
    // the lane to `done` on a lane that cannot start — and the operator would
    // find out at the next `ccd start`, not here.
    plantLauncher('claude', '#!/usr/bin/env bash\necho done\nexit 0\n');
    const r = runLogin('claude-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('wrote no');
    expect(status('claude-a')).toMatchObject({ state: 'failed' });
    expect(String(status('claude-a')['error'])).toContain('.credentials.json');
  });

  it('keeps the FIRST url — a later link on the stream does not replace the sign-in', () => {
    // FIRST-WINS, not last-wins, and nothing in the measured stream tells the
    // two apart: it carries exactly one URL-bearing line, so a helper that
    // overwrote `AUTH_URL` on every match would look identical. A real
    // launcher has every reason to print a second link — a docs page, a
    // status page, a support link — and the operator would then be asked to
    // open whichever one happened to come last.
    plantLauncher('claude', LOGIN_REPLAY.replace(
      "printf 'Paste code here if prompted > '\n",
      "printf 'Trouble? See https://docs.example.invalid/sign-in\\n'\n"
      + "printf 'Paste code here if prompted > '\n"));
    const r = runLogin('claude-a');
    expect(r.stdout).toContain('https://docs.example.invalid/sign-in');
    expect(status('claude-a')['url']).toBe(OAUTH_URL);
  });

  it('never opens a tmux session — this method needs no pane at all', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    runLogin('claude-a');
    expect(h.tmuxCalls()).toEqual([]);
    expect(h.calls()).toEqual([]);
  });
});

describe('ccd-account-auth — the two states only a live run can show', () => {
  // `waiting-code` and `cancelled` are both TRANSIENT: the first is overwritten
  // by whatever ends the run, and the second is written by a signal handler.
  // Neither is observable from a run you wait for, so neither was measured by
  // anything above — a state machine with two unpinned states is two states
  // that can quietly stop working. This is the case that watches the file
  // WHILE the helper is still in it.
  const settle = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

  const stateNow = (id: string): string | null => {
    try { return String(status(id)['state']); } catch { return null; }
  };

  /** Poll the status file until it reads `want`, or give up. Returns the last
   *  state seen, so a failure says what it WAS rather than only that it was
   *  not what we wanted. */
  const waitForState = async (id: string, want: string, ms: number): Promise<string | null> => {
    const deadline = Date.now() + ms;
    let last: string | null = null;
    while (Date.now() < deadline) {
      last = stateNow(id);
      if (last === want) return last;
      await settle(100);
    }
    return last;
  };

  it('publishes waiting-code while it waits, and cancelled when the pane is killed', async () => {
    plantLauncher('claude', LOGIN_REPLAY);
    // ASYNC spawn, not execFileSync: a run you wait for is a run whose
    // intermediate states you cannot see. Contained exactly like every
    // synchronous spawn in this file — `ccd-workspaces.test.ts`'s census reads
    // this call site too, its alternation having been widened to match `spawn`
    // in the same commit.
    const child = spawn('bash', [HELPER, 'claude-a', 'login'], {
      cwd: h.home,
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '30',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN },
        { systemd: true, tmux: true }),
      stdio: 'ignore',
    });
    try {
      expect(await waitForState('claude-a', 'waiting-code', 20_000),
        'the newline-less prompt never moved the machine to waiting-code').toBe('waiting-code');
      // `ccd account-pane --cancel` kills the pane, which SIGHUPs what is in
      // it; the helper's own trap is what writes the terminal state, because
      // only this process knows. TERM is the same trap arm and is what a test
      // can send without a pane.
      child.kill('SIGTERM');
      expect(await waitForState('claude-a', 'cancelled', 20_000),
        'the signal trap did not publish cancelled').toBe('cancelled');
    } finally {
      child.kill('SIGKILL');
    }
  }, 60_000);
});

describe('ccd-account-auth — the code goes down the pipe, and ccrc holds nothing', () => {
  /** A bash FEEDER, not a node timer: it must block on `open(2)` of the FIFO
   *  exactly as a real writer does, and it must not be racing vitest's event
   *  loop while the helper holds the read end. It waits for the FIFO to exist,
   *  then for the status file to say `waiting-code`, then writes one line —
   *  which is precisely what a wave-2 route will do, and what `tmux send-keys`
   *  does for a pane lane. */
  const plantFeeder = (): string => {
    const feeder = path.join(h.home, 'feed.sh');
    fs.writeFileSync(feeder,
      '#!/usr/bin/env bash\nset -uo pipefail\n'
      + 'for _ in $(seq 1 300); do [ -p "$1" ] && break; sleep 0.1; done\n'
      + 'for _ in $(seq 1 300); do\n'
      + '  grep -q \'"state":"waiting-code"\' "$2" 2>/dev/null && break; sleep 0.1\n'
      + 'done\n'
      + 'printf \'%s\\n\' "$3" > "$1"\n', { mode: 0o755 });
    return feeder;
  };

  const loginWithCode = (id: string, code: string): { code: number; stdout: string; stderr: string } => {
    const feeder = plantFeeder();
    const runIn = path.join(REG(h.home), '.auth', `${id}.run`, 'in');
    const statusPath = path.join(REG(h.home), '.auth', `${id}.json`);
    const script = `"${feeder}" "${runIn}" "${statusPath}" ${JSON.stringify(code)} & `
      + `"${HELPER}" ${JSON.stringify(id)} login; rc=$?; wait; exit $rc`;
    const opts = {
      encoding: 'utf8' as const, cwd: h.home, timeout: 90_000,
      // 6, NOT 45. `vitest.config.ts` sets a 20 s linux testTimeout, so a
      // 45 s helper deadline would be killed by vitest before the helper's own
      // deadline fires — the run reports a TIMEOUT rather than the assertion
      // diff, and in the RED state (nothing reads fd 7) every case here runs
      // to the full deadline.
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '6',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', ['-c', script], opts), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('forwards the code the operator typed, and reaches done', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    const r = loginWithCode('claude-a', 'fixture-code-123');
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-code'), 'utf8')).toBe('fixture-code-123');
    expect(status('claude-a')).toMatchObject({ state: 'done' });
  });

  it('walks starting -> url -> waiting-code -> exchanging -> done, and says exchanging on stdout', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    const r = loginWithCode('claude-a', 'fixture-code-123');
    expect(r.stdout).toContain('[code written to stdin by ccrc — not shown]');
  });

  it('never prints the code itself, on any stream or in the status file', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    const canary = 'CANARY-CODE-9d3f1a';
    const r = loginWithCode('claude-a', canary);
    expect(r.stdout).not.toContain(canary);
    expect(r.stderr).not.toContain(canary);
    expect(JSON.stringify(status('claude-a'))).not.toContain(canary);
  });

  it('leaves the credential where Claude Code put it, and ccrc holds NOTHING', () => {
    plantLauncher('claude', LOGIN_REPLAY);
    loginWithCode('claude-a', 'fixture-code-123');
    const cred = path.join(h.home, '.claude-a', '.credentials.json');
    expect(fs.existsSync(cred)).toBe(true);
    expect(fs.statSync(cred).mode & 0o777).toBe(0o600);
    // The custody claim, measured: a login lane has no secrets file, so there
    // is no ccrc-held copy of anything. `ccrc account credential` answers
    // `not-managed` on such a lane for exactly this reason.
    expect(fs.existsSync(path.join(h.home, '.cc-secrets'))).toBe(false);
    // …and the run directory's FIFOs are gone: nothing is left holding a pipe
    // a later writer could block on forever.
    const runDir = path.join(REG(h.home), '.auth', 'claude-a.run');
    expect(fs.existsSync(path.join(runDir, 'in'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'in.child'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'out'))).toBe(false);
  });

  it('refuses done when the child exited 0 and wrote no credentials file', () => {
    plantLauncher('claude',
      '#!/usr/bin/env bash\n' + REPLAY_STREAM + 'IFS= read -r got\necho done\nexit 0\n');
    const r = loginWithCode('claude-a', 'fixture-code-123');
    expect(r.code).toBe(1);
    expect(status('claude-a')).toMatchObject({ state: 'failed' });
    expect(String(status('claude-a')['error'])).toContain('wrote no');
  });
});

describe('ccd-account-auth — the walk is an order, not a set', () => {
  // The case above is named "walks starting -> url -> waiting-code ->
  // exchanging -> done" and asserts only that one substitution line appears.
  // It never measures the ORDER, and order is the whole content of the
  // `waiting-code` gate on `_auth_forward_code`: a code that arrives before
  // the child has asked for it must WAIT, not be pushed into a stdin nobody
  // is reading. With a feeder that writes the moment the channel exists,
  // removing that gate publishes `exchanging` before `waiting-code` ever
  // happens — and nothing here could see it.
  const settle = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

  /** Enough dead air at the start for the pump to take at least one tick with
   *  nothing pending (so an ungated forward has somewhere to fire), and enough
   *  after the code is read that `exchanging` is observable to a poller. */
  const SLOW_REPLAY =
    '#!/usr/bin/env bash\n'
    + 'sleep 0.6\n'
    + 'printf %s "$CLAUDE_CONFIG_DIR" > "$HOME/seen-config-dir"\n'
    + REPLAY_STREAM
    + 'IFS= read -r got\n'
    + 'printf %s "$got" > "$HOME/seen-code"\n'
    + 'sleep 1.5\n'
    + 'mkdir -p "$CLAUDE_CONFIG_DIR" && printf \'{"fixture":true}\' > "$CLAUDE_CONFIG_DIR/.credentials.json"\n'
    + 'chmod 600 "$CLAUDE_CONFIG_DIR/.credentials.json"\n'
    + 'echo done\nexit 0\n';

  it('holds an early code until the child asks — waiting-code is published before exchanging', async () => {
    plantLauncher('claude', SLOW_REPLAY);
    const runDir = path.join(REG(h.home), '.auth', 'claude-a.run');
    // A feeder that writes AS SOON AS THE CHANNEL EXISTS, unlike the one
    // above: this is the operator who already had the code, or a wave-2 route
    // replaying one. It is the only fixture that can tell the gate apart from
    // its absence.
    const feeder = path.join(h.home, 'feed-early.sh');
    fs.writeFileSync(feeder,
      '#!/usr/bin/env bash\nset -uo pipefail\n'
      + 'for _ in $(seq 1 600); do [ -p "$1" ] && break; sleep 0.05; done\n'
      + 'printf \'%s\\n\' "$2" > "$1"\n', { mode: 0o755 });

    const child = spawn('bash', ['-c',
      `"${feeder}" "${path.join(runDir, 'in')}" early-code-777 & "${HELPER}" claude-a login; wait`], {
      cwd: h.home,
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '25',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN },
        { systemd: true, tmux: true }),
      stdio: 'ignore',
    });
    const seen: string[] = [];
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        let now: string | null = null;
        try { now = String(status('claude-a')['state']); } catch { now = null; }
        if (now && now !== seen[seen.length - 1]) seen.push(now);
        if (now === 'done' || now === 'failed' || now === 'expired') break;
        await settle(25);
      }
    } finally {
      child.kill('SIGKILL');
    }
    expect(seen, 'the run never reached a terminal state').toContain('done');
    expect(seen, 'waiting-code was never published').toContain('waiting-code');
    expect(seen, 'exchanging was never published').toContain('exchanging');
    expect(seen.indexOf('waiting-code'),
      `the code was forwarded before the child asked for it — observed ${JSON.stringify(seen)}`)
      .toBeLessThan(seen.indexOf('exchanging'));
    // …and it does not go BACK. `indexOf` alone cannot see that: the machine
    // returning to `waiting-code` after `exchanging` leaves the first index
    // exactly where it was. This fixture's child asks once, so any later
    // `waiting-code` is the classifier re-reading text it already read — a
    // watcher would be told to collect a second code that was never asked
    // for, and a wave-2 route would act on it.
    expect(seen.lastIndexOf('waiting-code'),
      `the machine walked BACK to waiting-code after exchanging — observed ${JSON.stringify(seen)}`)
      .toBeLessThan(seen.indexOf('exchanging'));
    // …and the child really did get it, so the wait was a wait and not a drop.
    expect(fs.readFileSync(path.join(h.home, 'seen-code'), 'utf8')).toBe('early-code-777');
  }, 60_000);
});

/** The token's own shape, as `claude setup-token` prints it. A CANARY, not a
 *  real credential: the whole point of the assertions below is that this
 *  string is findable in exactly one place. */
const CANARY_TOKEN = 'sk-ant-oat01-CANARYCANARYCANARY0123456789';

describe('ccd-account-auth — setup-token, and the token that reaches one file', () => {
  const runPane = (id: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home, timeout: 60_000,
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '15',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN, ...env },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [HELPER, id, 'setup-token'], opts), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  const TOKEN_REPLAY =
    '#!/usr/bin/env bash\n'
    + 'printf %s "$CLAUDE_CONFIG_DIR" > "$HOME/seen-config-dir"\n'
    + 'echo "Create a long-lived token for Claude Code."\n'
    + `echo "export CLAUDE_CODE_OAUTH_TOKEN=${CANARY_TOKEN}"\n`
    + 'echo "This token expires in 1 year."\nexit 0\n';

  it('captures the token to a 0600 file and shows the substitution instead', () => {
    // `CCRC_UPSTREAM` is `claude` in the fixture roster, and setup-token runs
    // THAT launcher — a generated wrapper would export the lane's own config
    // dir back over the scratch one.
    plantLauncher('claude', TOKEN_REPLAY);
    const r = runPane('claude-a');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[token captured to ~/.cc-secrets/claude-a-oauth.env]');
    const secret = path.join(h.home, '.cc-secrets', 'claude-a-oauth.env');
    expect(fs.statSync(path.join(h.home, '.cc-secrets')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(secret).mode & 0o777).toBe(0o600);
    // Byte-exact, which is also what measures the CR strip: the child runs
    // under a pty here, so every line it writes arrives CR-terminated.
    expect(fs.readFileSync(secret, 'utf8')).toBe(`export CLAUDE_CODE_OAUTH_TOKEN=${CANARY_TOKEN}\n`);
    expect(status('claude-a')).toMatchObject({ state: 'done' });
    // AND THE TRANSCRIPT CARRIES NO CARRIAGE RETURN. This is where
    // `_auth_line`'s CR strip actually earns its place, and it is not where
    // the plan says it is: the file above is CR-free with or without the
    // strip, because `_auth_capture_token` trims the token at the first
    // `[[:space:]]` and CR is one. What the strip is really for is every
    // OTHER line — the child runs under a pty here, whose line discipline
    // turns NL into CR-NL, so each forwarded line would otherwise reach tmux
    // scrollback, the terminal drawer, `Dialog.raw` and the push payload with
    // a stray CR inside it.
    expect(r.stdout, 'a pty line reached the transcript with its CR still on it')
      .not.toContain('\r');
    expect(r.stdout).toContain('This token expires in 1 year.');
  });

  it('the canary appears in that ONE file and in no stream, no status file, no scratch dir', () => {
    plantLauncher('claude', TOKEN_REPLAY);
    const r = runPane('claude-a');
    expect(r.stdout).not.toContain(CANARY_TOKEN);
    expect(r.stderr).not.toContain(CANARY_TOKEN);
    expect(JSON.stringify(status('claude-a'))).not.toContain(CANARY_TOKEN);
    // Every file under HOME except the one that is supposed to hold it — and
    // except the FIXTURE LAUNCHER, which of course contains the canary because
    // printing it is its entire job. It is the stand-in for `claude
    // setup-token` itself, not an artifact the helper wrote; filtering it is
    // what keeps this assertion about the helper.
    // `find -type f`, NOT `grep -r`, and that is now measured rather than
    // cautious (D-2739). BSD grep -r BLOCKS on a FIFO with a live writer —
    // measured on macos-latest — and the helper puts three FIFOs under
    // `$HOME/.cc-sessions/.auth/<id>.run/`. That is what cancelled the
    // 2026-09-12 macOS job at 25 minutes with a `grep` alive in its orphan
    // cleanup. GNU grep skips devices under -r, which is why this never
    // reproduced here. A timeout alone would only turn a silent wedge into a
    // loud one; `-type f` means the walk cannot reach a device at all, which
    // is the property this assertion actually wants. The timeout stays as a
    // backstop. Catch: `-exec ... +` exits non-zero when nothing matched.
    const found = ((): string => {
      try {
        return execFileSync('find', [h.home, '-type', 'f', '-exec', 'grep', '-l', CANARY_TOKEN, '{}', '+'],
          { encoding: 'utf8', timeout: 30_000 });
      } catch (e) { return (e as { stdout?: string }).stdout ?? ''; }
    })()
      .split('\n').filter(Boolean)
      .filter((p) => p !== path.join(harnessBin(h.home), 'claude'))
      .sort();
    expect(found).toEqual([path.join(h.home, '.cc-secrets', 'claude-a-oauth.env')]);
  });

  it('mints in a THROWAWAY config dir, never the lane\'s own', () => {
    plantLauncher('claude', TOKEN_REPLAY);
    runPane('claude-a');
    expect(fs.readFileSync(path.join(h.home, 'seen-config-dir'), 'utf8'))
      .toBe(path.join(h.home, '.ccrc', 'auth-scratch', 'claude-a'));
    // The scratch dir carries no settings.json, so no ccrc hook can fire from
    // this pane — and the lane's own dir is untouched.
    expect(fs.existsSync(path.join(h.home, '.ccrc', 'auth-scratch', 'claude-a', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, '.claude-a'))).toBe(false);
  });

  it('captures a bare token line too — the shape, not only the export spelling', () => {
    plantLauncher('claude',
      `#!/usr/bin/env bash\necho "Your token: ${CANARY_TOKEN}"\nexit 0\n`);
    const r = runPane('claude-a');
    expect(r.stdout).not.toContain(CANARY_TOKEN);
    expect(fs.readFileSync(path.join(h.home, '.cc-secrets', 'claude-a-oauth.env'), 'utf8'))
      .toContain(CANARY_TOKEN);
  });

  it('refuses done when the mint exits 0 having printed no token', () => {
    // `AUTH_SECRET_WRITTEN` is the guard: an exit-0 run that showed nothing
    // would otherwise stamp `done` over a lane that has no credential, and
    // the operator would find out at the next `ccd start`.
    plantLauncher('claude', '#!/usr/bin/env bash\necho "nothing to see"\nexit 0\n');
    const r = runPane('claude-a');
    expect(r.code).toBe(1);
    expect(String(status('claude-a')['error'])).toContain('printed no token');
    expect(fs.existsSync(path.join(h.home, '.cc-secrets'))).toBe(false);
  });

  // ── the two argument orders, measured on BOTH platforms ──────────────────
  // `CCD_OS` is set INSIDE the snippet, after `fn` has sourced the helper:
  // the helper derives it from `$OSTYPE` at source time, so an env var of that
  // name is overwritten before any function exists to read it. Setting it
  // after the source is the only assignment that survives — and it is what
  // lets a Linux box measure the BSD arm at all, instead of skipping it
  // forever on the only box that runs CI.
  //
  // ONE TOKEN PER LINE, because `mapfile -t argv < <(…)` is the consumer: a
  // single space-joined string would have to be re-split by a shell that
  // would then re-split the command with it.
  it('spells the util-linux script argument order', () => {
    expect(fn('CCD_OS=linux; _auth_script_argv /bin/echo hi'))
      .toBe(['script', '-qfc', '/bin/echo hi', '/dev/null'].join('\n'));
  });

  it('spells the BSD script argument order — the ORDER is right; EXECUTING it fails on a real Mac (D-2614)', () => {
    // Decision 9: the BSD arm is written as a branch rather than asserted from
    // a box that cannot run the binary. THIS test pins the argv this tree
    // builds, which is a different claim from "BSD script accepts it" — and it
    // is the claim this repo can actually make. If the real binary disagrees
    // on a Mac, setup-token answers `pane-unsupported-here` there and login
    // and paste are unaffected.
    expect(fn('CCD_OS=darwin; _auth_script_argv /bin/echo hi'))
      .toBe(['script', '-q', '/dev/null', '/bin/echo', 'hi'].join('\n'));
  });

  it('quotes the util-linux -c string, so a HOME with a space cannot re-split it', () => {
    // `%q`, not `%s`. The util-linux arm hands ONE STRING to a shell, so
    // `/Users/Jane Doe/.local/bin/claude` — an ordinary macOS home — would be
    // re-split into two arguments and the mint would run the wrong program.
    // bash's own `%q` spelling — a backslash-escaped space, not added quotes.
    // Asserted as the exact string rather than "contains a backslash", so a
    // change of quoter is a visible decision.
    expect(fn("CCD_OS=linux; _auth_script_argv '/Users/Jane Doe/bin/claude' setup-token"))
      .toBe(['script', '-qfc', '/Users/Jane\\ Doe/bin/claude setup-token', '/dev/null'].join('\n'));
  });

  it('answers pane-unsupported-here rather than hanging when script(1) is absent', () => {
    // Through the KNOB, not through an emptied PATH: emptying PATH also
    // removes mkdir, date, jq, mv and chmod, so `_auth_publish` fails, no
    // status file is written, and the assertion below would read ENOENT
    // instead of the refusal.
    plantLauncher('claude', TOKEN_REPLAY);
    const r = runPane('claude-a', { CCRC_AUTH_SCRIPT: 'ccrc-no-such-pty-vehicle' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('pane-unsupported-here');
    expect(status('claude-a')).toMatchObject({
      state: 'failed', error: expect.stringContaining('pane-unsupported-here'),
    });
    // It refuses BEFORE opening the pipes, so nothing is left holding a FIFO.
    expect(fs.existsSync(path.join(REG(h.home), '.auth', 'claude-a.run'))).toBe(false);
  });
});

describe('the secrets-file name is agreed across three writers, or it is agreed in none', () => {
  // `ccd-account-auth` reads `~/.ccrc/accounts.json` for ONE fact — a lane's
  // `exec.kind`, which picks openai-login's program (Plan 2b-2 Task 8) — and
  // never its `secretsFile`; the projection it reads for everything else
  // carries none either — `generateAccountsSh` emits ids,
  // home-ability, CCRC_MEASURED, the upstream id, config dirs, labels and hues
  // and nothing else. So the mint's destination is CONSTRUCTED here, and it is
  // only safe to construct because two other writers derive the same name: the
  // roster entry `ccrc account add` writes, and the path `account-op.mjs`
  // computes for it. Nothing measured that the three agree; a rename in one
  // would put a live token in a file the lane's roster entry does not name,
  // and the lane would start unauthenticated with its credential on disk.
  const read = (rel: string): string =>
    fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
  const code = (rel: string): string =>
    read(rel).split('\n').filter((l) => !/^\s*[#/]/.test(l)).join('\n');

  it('the mint, the tag and the template all spell the same oauth lane', () => {
    // 1. the mint's destination, in this helper
    expect(code('ccd/ccd-account-auth'),
      'the helper no longer writes <id>-oauth.env — the other two writers must move with it')
      .toContain('"$SECRETS_DIR/$AUTH_ID-oauth.env"');
    // 2. the tag `ccrc account` chooses for an OAuth lane
    expect(code('ccd/ccrc'),
      'ccrc no longer tags a CLAUDE_CODE_OAUTH_TOKEN lane `oauth` — the mint would land elsewhere')
      .toContain('ACCT_SECRET_TAG=oauth');
    // 3. the template that turns id + tag into the roster's own secretsFile
    expect(code('deploy/account-op.mjs'),
      'account-op no longer builds .cc-secrets/<id>-<tag>.env — the mint and the roster would disagree')
      .toContain('`.cc-secrets/${id}-${secretTag}.env`');
  });
});

describe('ccd-account-auth — openai-login runs somebody else\'s program', () => {
  const runOai = (id: string): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home, timeout: 60_000,
      env: ghContainedEnv(h.home,
        { ...process.env, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '15',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [HELPER, id, 'openai-login'], opts), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  /** TWO code lines, from the first version of this fixture rather than added
   *  later by a mutation step. A device-code flow reprints its code on every
   *  "still waiting…" line, so a reader that took the LAST match would show
   *  the operator whatever the launcher happened to say most recently — and a
   *  one-code fixture cannot tell the two readers apart. `orchard-api` is the
   *  blessed fixture hostname; a real device-authorization host in tracked
   *  text is what `topology-clean.test.ts` exists to refuse. */
  const OAI_REPLAY =
    '#!/usr/bin/env bash\n'
    + 'printf \'%s\\n\' "$*" > "$HOME/seen-argv"\n'
    + 'echo "To sign in, open https://orchard-api/device and enter the code."\n'
    + 'echo "Your code: WXYZ-4321"\n'
    + 'echo "Waiting for approval. Your code: MNOP-0000"\n'
    + 'mkdir -p "$HOME/.launcher" && printf secret > "$HOME/.launcher/creds"\n'
    + 'echo "Signed in."\nexit 0\n';

  it('runs `<launcher> login` — the launcher\'s own program, not Claude Code', () => {
    // `gpt` is the roster's one external account and it has NO stub wrapper
    // out of the harness — `makeCcdHarness` plants stubs only for the
    // home-able ids, and `gpt` is not one — so this test plants the launcher
    // it is about to run.
    plantLauncher('gpt', OAI_REPLAY);
    const r = runOai('gpt');
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-argv'), 'utf8').trim()).toBe('login');
    expect(status('gpt')).toMatchObject({ state: 'done' });
  });

  it('publishes the FIRST device code, which the spec says is not a secret and is shown', () => {
    plantLauncher('gpt', OAI_REPLAY);
    const r = runOai('gpt');
    // The first, not the last: the fixture reprints a DIFFERENT code on its
    // "waiting" line, which is what a launcher that truncates or re-renders
    // does, and the operator must not be shown a code that supersedes the one
    // they are already typing.
    expect(status('gpt')['userCode']).toBe('WXYZ-4321');
    expect(status('gpt')['url']).toBe('https://orchard-api/device');
    expect(r.stdout).toContain('Your code: WXYZ-4321');
  });

  it('holds nothing: the credential is the launcher\'s file and ccrc writes no secrets', () => {
    plantLauncher('gpt', OAI_REPLAY);
    runOai('gpt');
    expect(fs.existsSync(path.join(h.home, '.launcher', 'creds'))).toBe(true);
    expect(fs.existsSync(path.join(h.home, '.cc-secrets'))).toBe(false);
    // …and no config dir was minted for it either. An external lane's config
    // dir is not ccrc's to create.
    expect(fs.existsSync(path.join(h.home, '.ccrc', 'auth-scratch', 'gpt'))).toBe(false);
  });

  it('still filters a token line, even from a launcher nobody here wrote', () => {
    plantLauncher('gpt',
      `#!/usr/bin/env bash\necho "export CLAUDE_CODE_OAUTH_TOKEN=${CANARY_TOKEN}"\nexit 0\n`);
    const r = runOai('gpt');
    expect(r.stdout).not.toContain(CANARY_TOKEN);
    expect(r.stdout).toContain('[token captured to ~/.cc-secrets/gpt-oauth.env]');
  });

  it('refuses when the launcher is not there — the declare step has not run', () => {
    const r = runOai('gpt');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('launcher-absent');
    expect(status('gpt')).toMatchObject({ state: 'failed' });
  });

  it('keys on exec.kind, never on telemetry: an EXTERNAL lane with codex telemetry still runs `<launcher> login`', () => {
    // A fixture lane, `ext-a`, in the live Codex lanes' shape: exec.kind
    // external, telemetry codex. CCRC_CODEX_BACKEND is telemetry-keyed, so it
    // DOES name this lane (the control below), and routing on it would send
    // another repository's lane down ccrc's verb.
    const EXT_A = {
      id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
      exec: { kind: 'external' }, homeAble: false, hue: 'amber', telemetry: 'codex',
    };
    const roster = { version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, EXT_A] };
    seedAccountsSh(h.home, roster);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
    expect(fs.readFileSync(path.join(h.home, '.ccrc', 'accounts.sh'), 'utf8'))
      .toMatch(/^CCRC_CODEX_BACKEND=\(ext-a\)$/m);
    plantLauncher('ext-a', OAI_REPLAY);
    plantLauncher('ccrc', '#!/bin/sh\nprintf \'%s\\n\' "$*" > "$HOME/seen-ccrc-argv"\nexit 0\n');
    const r = runOai('ext-a');
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-argv'), 'utf8').trim()).toBe('login');
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv')), 'an external lane ran ccrc codex login').toBe(false);
  });

  // The "a roster JSON it cannot read is not a codex verdict" case that used
  // to live here (added in Task 8's own commit) is MERGED into F5b below
  // (review round 2, finding N6): both planted the same `router` lane over
  // the same unparseable roster and asserted the same thing, the external
  // arm running unchanged, so keeping both was two copies of one fact.
});

describe('ccd-account-auth — openai-login for a CODEX lane runs ccrc\'s own verb', () => {
  /** DEFAULT_TEST_ROSTER plus one codex lane, written to BOTH files a box
   *  carries: `accounts.sh` (what `_auth_rostered` reads) and `accounts.json`
   *  (where the kind is read from — the projection carries none). The ports are
   *  parse-only vocabulary: nothing here opens a socket. */
  const CODEX_ROW = {
    id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a', homeAble: false,
    hue: 'amber', telemetry: 'codex',
    exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011,
      authDir: '.local/share/ccrc/codex/codex-a' },
  };
  const WITH_CODEX = { version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, CODEX_ROW] };
  const seedBoth = (roster: unknown): void => {
    seedAccountsSh(h.home, roster);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  };
  /** The lane's own generated launcher, as a recorder: it must NEVER run. */
  const LANE_LAUNCHER = '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$HOME/seen-argv"\nexit 0\n';
  /** `~/.local/bin/ccrc`, standing in for `ccrc codex login` (whose own cases
   *  live in ccrc-codex.test.ts): records its argv and whether it has a tty,
   *  prints the runtime's device-flow shape, exits `rc`. */
  const FAKE_CCRC = (rc: number): string =>
    '#!/usr/bin/env bash\n'
    + 'printf \'%s\\n\' "$*" > "$HOME/seen-ccrc-argv"\n'
    + '[ -t 1 ] && echo tty > "$HOME/seen-ccrc-tty"\n'
    + 'echo "Sign in with ChatGPT using device code:"\n'
    + 'echo "1) Visit https://orchard-api/device"\n'
    + 'echo "2) Enter code: WXYZ-4321"\n'
    + (rc === 0 ? 'echo "ccrc codex: codex-a: logged in"\n' : 'echo "ccrc codex: login-failed: fixture" >&2\n')
    + `exit ${rc}\n`;

  const runLane = (id: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
    // THE LANE LIBRARY'S TWO KNOBS ARE DELETED (ruling R23: every harness
    // whose verb can reach the lane library). This verb's codex arm execs
    // `~/.local/bin/ccrc codex login`, which reaches `_codex_row`. `login`
    // itself reads neither knob, and every ccrc here is a fake, so the deletion
    // is the ruling's line kept, not a measured need. It sits above `opts` so
    // the spawn's containment window (ccd-workspaces.test.ts) is unchanged.
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base['CCRC_CODEX_PROBE_S'];
    delete base['CCRC_CODEX_READY_S'];
    const opts = {
      encoding: 'utf8' as const, cwd: h.home, timeout: 60_000,
      env: ghContainedEnv(h.home,
        { ...base, HOME: h.home, CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '15',
          CLAUDE_CODE_OAUTH_TOKEN: PARENT_TOKEN, ...env },
        { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [HELPER, id, 'openai-login'], opts), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('B1: runs `ccrc codex login <id>` under a pty — never the lane\'s launcher, which would hand `login` to Claude Code', () => {
    seedBoth(WITH_CODEX);
    plantLauncher('codex-a', LANE_LAUNCHER);
    plantLauncher('ccrc', FAKE_CCRC(0));
    const r = runLane('codex-a');
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-ccrc-argv'), 'utf8').trim()).toBe('codex login codex-a');
    // The device flow wants a terminal, and the spec keeps the pty (§9.3).
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-tty')), 'ccrc codex login ran without a pty').toBe(true);
    expect(fs.existsSync(path.join(h.home, 'seen-argv')), 'the lane\'s own launcher ran').toBe(false);
    expect(status('codex-a')).toMatchObject({
      state: 'done', url: 'https://orchard-api/device', userCode: 'WXYZ-4321',
    });
    expect(r.stdout).toContain('2) Enter code: WXYZ-4321');
    // The verb's status file is read once, then removed, so it does not
    // outlive the run.
    expect(fs.existsSync(path.join(REG(h.home), '.auth', 'codex-a.run', 'verb.rc')),
      'the verb\'s status file outlived its run').toBe(false);
  });

  it('B2: a non-zero exit from the verb is failed, and names the verb rather than a launcher', () => {
    // ON LINUX THIS MEASURES THE STATUS FILE, NOT `wait`: util-linux
    // `script` without `-e` exits 0 whatever its child did
    // (script-shim-platform.test.ts's util-linux control), so an arm that
    // trusted the vehicle's rc would stamp this run `done`.
    seedBoth(WITH_CODEX);
    plantLauncher('ccrc', FAKE_CCRC(1));
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(status('codex-a')).toMatchObject({
      state: 'failed', error: expect.stringContaining('ccrc codex login codex-a exited 1'),
    });
    expect(r.stderr).not.toContain("the launcher's login exited");
  });

  it('B3: ccrc-absent refuses before any pipe, and never falls back to the lane\'s launcher', () => {
    seedBoth(WITH_CODEX);
    plantLauncher('codex-a', LANE_LAUNCHER);
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccrc-absent');
    expect(status('codex-a')).toMatchObject({ state: 'failed', error: expect.stringContaining('ccrc-absent') });
    expect(fs.existsSync(path.join(REG(h.home), '.auth', 'codex-a.run'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, 'seen-argv'))).toBe(false);
  });

  it('B4: keeps pane-unsupported-here — a box with no script(1) cannot run a device flow either', () => {
    seedBoth(WITH_CODEX);
    plantLauncher('ccrc', FAKE_CCRC(0));
    const r = runLane('codex-a', { CCRC_AUTH_SCRIPT: 'ccrc-no-such-pty-vehicle' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('pane-unsupported-here');
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv'))).toBe(false);
    expect(fs.existsSync(path.join(REG(h.home), '.auth', 'codex-a.run'))).toBe(false);
  });

  it('B5: a pty vehicle that ran nothing is not a login, and an earlier run\'s status is never read as this one\'s', () => {
    // THE UTIL-LINUX BLIND SPOT, made deterministic. `script` without `-e`
    // exits 0 whatever its child did. `true` is a vehicle that exits 0 and
    // runs NOTHING, which is that blind spot with the verb taken away. A
    // `verb.rc` holding 0 sits in the run directory beforehand, as a run that
    // a cancel cut short leaves one (`_auth_cancelled` exits past the arm). A
    // helper that read the file without clearing it first would stamp `done`.
    seedBoth(WITH_CODEX);
    plantLauncher('ccrc', FAKE_CCRC(0));
    const runDir = path.join(REG(h.home), '.auth', 'codex-a.run');
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(runDir, 'verb.rc'), '0\n');
    const r = runLane('codex-a', { CCRC_AUTH_SCRIPT: 'true' });
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv')),
      'the vehicle ran the verb — this case would measure nothing').toBe(false);
    expect(r.code).toBe(1);
    expect(status('codex-a')).toMatchObject({
      state: 'failed', error: expect.stringContaining('ccrc codex login codex-a reported no exit status'),
    });
    expect(fs.existsSync(path.join(runDir, 'verb.rc')), 'the stale status outlived the run').toBe(false);
  });

  /** The REAL generated wrapper (shared/wrapper.mjs's own shape, not a
   *  recorder stub) execing the REAL ccrc-codex execing the REAL ccrc, so a
   *  case that plants this measures the shipped chain's actual exit code,
   *  not a simulated one. `claude`'s stub upstream binary is planted
   *  automatically by `makeCcdHarness` (it is home-able in
   *  DEFAULT_TEST_ROSTER), which is what lets `ccrc-codex` get past its own
   *  `no-upstream` gate before it ever reaches the roster. */
  const plantRealCodexWrapper = (): void => {
    plantLauncher('codex-a', markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: CODEX_ROW.configDirSuffix, execKind: 'codex' }, 'claude')));
    fs.symlinkSync(path.join(CCD_ROOT, 'ccrc-codex'), path.join(harnessBin(h.home), 'ccrc-codex'));
    fs.symlinkSync(path.join(CCD_ROOT, 'ccrc'), path.join(harnessBin(h.home), 'ccrc'));
  };

  /** The tree's non-live external row (external, telemetry none), the shape
   *  `models-op.test.ts` and the "openai-login runs somebody else's
   *  program" describe above both use. Its wrapper is a human-written file,
   *  never a `ccrc-codex` one, so the wrapper gate must never touch it. */
  const ROUTER = {
    id: 'router', label: 'router', configDirSuffix: '.claude-router',
    exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none',
  };

  // FINDING F5 — MEASURED, not assumed (round 1), then WIDENED (round 2,
  // finding N3). The two round-1 reviewers disagreed on what a codex lane's
  // `openai-login` publishes when `~/.ccrc/accounts.json` EXISTS but cannot
  // be parsed. `accounts.sh` (the projection) stays VALID in every case
  // below — only `accounts.json`, read only for the kind lookup, is broken
  // — so the wrapper's own reverse map still resolves the lane correctly
  // and reaches its real chain: the generated wrapper execs `ccrc-codex`,
  // which sources the (valid) projection, maps the config dir to `codex-a`,
  // and runs `ccrc codex start codex-a`. That refuses (the roster it reads
  // directly is the same broken file) and exits 1, so `ccrc-codex` exits 1
  // too, in place.
  //
  // MEASURED (this fixture, before the round-1 fix): the EXTERNAL arm's pty
  // vehicle IS util-linux `script` without `-e` (hazard 16's own blind
  // spot, the one `_auth_openai_login_codex` exists to avoid and the one
  // `_auth_openai_login` — this OLD arm, unchanged by Task 8 — still
  // carries by design for a genuinely external lane). `script` without
  // `-e` exits 0 whatever its child did
  // (`script-shim-platform.test.ts`'s own control), so `wait "$child"` read
  // 0 regardless of `ccrc-codex`'s real exit, and the published status was
  // `{"state":"done", ...}` — a FALSE success, not the honest failure one
  // round-1 reviewer assumed, because rc never left `script` as anything
  // but 0.
  //
  // ROUND 1's fix answered a third word, `undecidable`, when the file
  // exists but cannot be read or parsed, and refused a `ccrc-codex` wrapper
  // by name on THAT word alone. ROUND 2's re-review (findings N1, N3)
  // measured that the false `done` survived for every codex-shaped wrapper
  // whose roster answer was the ordinary EMPTY string instead: an absent
  // roster, a dangling-symlink roster, a valid roster missing the row,
  // `{}`, and — because the old jq call accepted a truncated file as "no
  // match" rather than "cannot parse" — a zero-byte, whitespace-only or
  // `null` roster too. ROUND 2's fix (see `_auth_exec_kind` and
  // `_auth_openai_login`'s own comments) widens the wrapper gate to every
  // answer other than `codex`, and sharpens `_auth_exec_kind`'s own filter
  // (a jq SLURP, checking for exactly one JSON object) so those roster
  // shapes read `undecidable` rather than empty. The two now-distinct
  // refusals are `roster-unreadable` (the file exists but could not be
  // read as one JSON object — permissions, malformed JSON, or jq off PATH)
  // and `roster-not-codex` (the file parses fine but does not declare this
  // id an exec.kind "codex" account).
  it('F5a: a CODEX-shaped wrapper over an UNPARSEABLE roster is refused by name, roster-unreadable, before the false-done blind spot can fire', () => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), '{ not json\n');
    plantRealCodexWrapper();
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('roster-unreadable');
    const s = status('codex-a');
    expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
    expect(String(s['error'])).toContain('roster-unreadable');
    // NEVER a false done, and NEVER a spawn: the refusal fires before any
    // pipe opens, exactly as `ccrc-absent`/`pane-unsupported-here` do.
    expect(fs.existsSync(path.join(REG(h.home), '.auth', 'codex-a.run'))).toBe(false);
  });

  // MERGED (round 2, finding N6) with the round-1 case that used to live in
  // the "openai-login runs somebody else's program" describe above: both
  // planted `router` over the same unparseable roster and asserted the same
  // external-arm-unchanged fact, so keeping both was two copies of it.
  it('F5b: a genuinely EXTERNAL lane with the same unparseable roster is unaffected — the external arm still runs', () => {
    // `router`'s wrapper is a human-written file, never a `ccrc-codex` one,
    // so the wrapper gate — on EITHER a codex-negative empty answer or
    // `undecidable` — must never touch it.
    seedBoth({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, ROUTER] });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), '{ not json\n');
    plantLauncher('router', '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$HOME/seen-argv"\nexit 0\n');
    const r = runLane('router');
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-argv'), 'utf8').trim()).toBe('login');
    expect(status('router')).toMatchObject({ state: 'done' });
  });

  // FINDING N3 — the wrapper gate now applies to the EMPTY answer too, not
  // only `undecidable`. Each of these roster states is syntactically fine
  // (or simply absent) — `_auth_exec_kind` correctly answers empty, or the
  // named OTHER kind — but a `ccrc-codex` wrapper still cannot safely take
  // the external arm on ANY of them, because the same false-done blind spot
  // fires exactly as it does on `undecidable`. FINDING R2-3 (round 3): the
  // refusal WORD now depends on which of these states it is, because each
  // names a different real cause with a different real remedy —
  // `roster-absent` (no file at all: `ccrc install` seeds one, but not this
  // id's row), or `roster-not-codex` (a readable roster that simply does
  // not make this id a codex lane right now, whether because its row is
  // gone or because it names some other kind). Neither is
  // `roster-unreadable`, which means the file could not be parsed at all.
  it.each([
    ['an ABSENT roster', 'roster-absent', (home: string): void => {
      fs.rmSync(path.join(home, '.ccrc', 'accounts.json'), { force: true });
    }],
    // FINAL REVIEW (X2): a dangling link is its OWN word now. It used to share
    // `roster-absent`'s "does not exist, run ccrc install" text, and that
    // install REPLACES the link (measured); the remedy case below pins it.
    ['a DANGLING-SYMLINK roster', 'roster-dangling', (home: string): void => {
      fs.rmSync(path.join(home, '.ccrc', 'accounts.json'), { force: true });
      fs.symlinkSync(path.join(home, '.ccrc', 'nowhere.json'), path.join(home, '.ccrc', 'accounts.json'));
    }],
    ['a VALID roster missing the row', 'roster-not-codex', (home: string): void => {
      fs.writeFileSync(path.join(home, '.ccrc', 'accounts.json'),
        `${JSON.stringify({ version: 1, accounts: DEFAULT_TEST_ROSTER.accounts }, null, 2)}\n`);
    }],
    ['`{}`', 'roster-not-codex', (home: string): void => { fs.writeFileSync(path.join(home, '.ccrc', 'accounts.json'), '{}\n'); }],
  ])('F5c: %s + a CODEX-shaped wrapper is refused %s, not left to the false-done blind spot',
    (_what, expectWord, corrupt) => {
      seedBoth(WITH_CODEX);
      corrupt(h.home);
      plantRealCodexWrapper();
      const r = runLane('codex-a');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(expectWord);
      expect(r.stderr).not.toContain('roster-unreadable');
      const s = status('codex-a');
      expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
      expect(String(s['error'])).toContain(expectWord);
      expect(fs.existsSync(path.join(REG(h.home), '.auth', 'codex-a.run'))).toBe(false);
    });

  // FINDING R2-4/S (round 3), the `generated` half of probe P16: the roster
  // NAMES this id, but as `generated`, while its on-disk launcher is still
  // the stale `ccrc-codex` one — a case the reviewer's mutation S (skip the
  // gate entirely when the roster declares a non-codex kind) stayed green
  // on before this row existed. The remedy wording is asserted specifically
  // (not just the shared `roster-not-codex` word both this and the
  // `external` case below share), because `ccrc wrappers` genuinely treats
  // `generated` and every other named kind differently — MEASURED directly
  // (see the round-3 report section): for `generated`, `ccrc wrappers`
  // rewrote a stale-but-unmodified ccrc-marked wrapper on its own, no flags
  // needed.
  it('F5c: a roster naming codex-a exec.kind "generated", with a stale ccrc-codex wrapper, is refused roster-not-codex, "rewrites" wording', () => {
    const GENERATED_ROW = {
      id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a', homeAble: true,
      hue: 'amber', telemetry: 'anthropic', exec: { kind: 'generated' },
    };
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'),
      `${JSON.stringify({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, GENERATED_ROW] }, null, 2)}\n`);
    plantRealCodexWrapper();
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('roster-not-codex');
    expect(r.stderr).toContain('"generated"');
    expect(r.stderr).toContain('rewrites');
    expect(r.stderr).not.toContain('replace');
    expect(r.stderr).not.toContain('by hand');
    const s = status('codex-a');
    expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
    expect(String(s['error'])).toContain('roster-not-codex');
  });

  // FINDING R2-4/S (round 3), the `external` half of probe P17: the roster
  // names `router` exec.kind "external" — a DECIDED, correct answer — but
  // its on-disk launcher is still a stale `ccrc-codex` one, from before the
  // lane was switched to external. `router`'s wrapper is not one
  // `plantRealCodexWrapper` can write (that helper is `codex-a`-specific),
  // so this plants the identical shape by hand. The remedy wording is
  // asserted specifically for the same reason as the `generated` case
  // above: MEASURED directly, `ccrc wrappers` — even with `--force` — never
  // writes an `external` (or any non-`generated`) lane's launcher at all,
  // so the remedy must say "by hand", never "rewrites".
  it('F5c: a roster naming router exec.kind "external", with a stale ccrc-codex wrapper, is refused roster-not-codex, "by hand" wording', () => {
    seedBoth({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, ROUTER] });
    plantLauncher('router', markGenerated(generateWrapperBody(
      { id: 'router', configDirSuffix: ROUTER.configDirSuffix, execKind: 'codex' }, 'claude')));
    fs.symlinkSync(path.join(CCD_ROOT, 'ccrc-codex'), path.join(harnessBin(h.home), 'ccrc-codex'));
    fs.symlinkSync(path.join(CCD_ROOT, 'ccrc'), path.join(harnessBin(h.home), 'ccrc'));
    const r = runLane('router');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('roster-not-codex');
    expect(r.stderr).toContain('"external"');
    expect(r.stderr).toContain('by hand');
    expect(r.stderr).not.toContain('rewrites');
    const s = status('router');
    expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
    expect(String(s['error'])).toContain('roster-not-codex');
  });

  // FINDING N1 — the SLURP filter: a file that has no complete JSON value in
  // it at all (zero bytes, whitespace only, or a bare `null`/`[]`, none of
  // them an object) must answer `undecidable`, not empty — the plain `-r`
  // filter round 1 shipped accepted these as "no match" (jq exits 0 with no
  // output for `null | .accounts[]?`), so a codex wrapper over a truncated
  // roster — the likeliest real way a file becomes unparseable — still
  // published a false `done` after round 1's own fix.
  it.each([
    ['a ZERO-BYTE roster', ''],
    ['a WHITESPACE-ONLY roster', '   \n\t \n'],
    ['a bare `null` roster', 'null\n'],
    ['a bare `[]` roster', '[]\n'],
    // FINDING R2-4/N1a (round 3): the slurp filter's `length == 1` check,
    // not `length >= 1` — two JSON objects concatenated in one file (no
    // array, no separator, just back to back — a shape a bad merge or a
    // doubled write can leave behind) must still answer `undecidable`. The
    // reviewer's own mutation `length == 1` → `length >= 1` stayed green
    // 78/78 before this row existed, because nothing exercised a
    // MULTI-document file — `length == 1` would take only `.[0]` (the
    // first object) and silently ignore the second.
    ['TWO JSON objects in one file', '{"a":1}\n{"b":2}\n'],
  ])('F5d: %s reads undecidable, not empty — refused roster-unreadable', (_what, content) => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), content);
    plantRealCodexWrapper();
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('roster-unreadable');
    const s = status('codex-a');
    expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
    expect(String(s['error'])).toContain('roster-unreadable');
  });

  // FINDING N2 — the "cannot be READ" half of `undecidable` (as opposed to
  // "reads fine but does not parse", F5a's case) had no case at all: M4
  // (the re-reviewer's own mutation, folding an unreadable roster to empty)
  // stayed green under round 1's suite.
  it.skipIf(process.getuid?.() === 0)('F5e: accounts.json at mode 000 is unreadable, not empty — refused roster-unreadable', () => {
    seedBoth(WITH_CODEX);
    const roster = path.join(h.home, '.ccrc', 'accounts.json');
    fs.chmodSync(roster, 0o000);
    plantRealCodexWrapper();
    try {
      const r = runLane('codex-a');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('roster-unreadable');
      const s = status('codex-a');
      expect(s['state']).toBe('failed');
      expect(String(s['error'])).toContain('roster-unreadable');
    } finally {
      fs.chmodSync(roster, 0o644);
    }
  });

  // FINDING N5 — grep's exit status is now BRANCHED (0 match / 1 no-match /
  // ≥2 cannot-read), not folded by a bare `2>/dev/null`, which used to make
  // a wrapper this function could not even read look identical to one that
  // genuinely is not a `ccrc-codex` wrapper (the old adapter narrowed a
  // distinction it received). Before this fix the case below fell through
  // to the external arm, which then could not read the same file either,
  // and `script`'s blind spot published a false `done` regardless.
  it.skipIf(process.getuid?.() === 0)('F5f: a wrapper this function cannot even read is refused by name, launcher-unreadable — never silently treated as external', () => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), '{ not json\n');
    plantRealCodexWrapper();
    const wrapper = path.join(harnessBin(h.home), 'codex-a');
    fs.chmodSync(wrapper, 0o111);
    try {
      const r = runLane('codex-a');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('launcher-unreadable');
      expect(r.stderr).not.toContain('roster-unreadable');
      expect(r.stderr).not.toContain('roster-not-codex');
      const s = status('codex-a');
      expect(s['state']).toBe('failed');
      expect(String(s['error'])).toContain('launcher-unreadable');
    } finally {
      fs.chmodSync(wrapper, 0o755);
    }
  });

  // FINDING R2-1 (round 3), probes P18/P18b: a CORRECTLY-rostered `external`
  // lane (a DECIDED answer, never empty or `undecidable`) whose launcher
  // this function cannot read must be BYTE-IDENTICAL to base — an
  // unreadable launcher takes the external arm exactly as it always did,
  // launcher-unreadable is for empty/undecidable only. MEASURED (this
  // fixture) what "the external arm as before" actually is, since this
  // task does not touch that arm and is not fixing it: a mode-0111 BINARY
  // (P18) can be exec'd without read permission (the kernel's own rule —
  // read is not required to execute, only to interpret a shebang), so it
  // runs for real and the pane reaches `done` honestly. A mode-0111 SCRIPT
  // (P18b) cannot: the shebang line has to be READ to find the interpreter,
  // so the exec fails ("Permission denied", printed on the pty's own
  // stdout) — but `script` without `-e` still exits 0 (hazard 16's
  // pre-existing blind spot on THIS arm, `_auth_openai_login`'s OLD code,
  // untouched here), so the published state is STILL `done` — a false one,
  // but the SAME false one base already published, not a new failure mode
  // this fix introduces. Both cases assert only that none of the WRAPPER
  // GATE's three refusal words fire; the external arm's own pre-existing
  // blind spot (P19's directory case is the same shape) is out of this
  // ruling's scope.
  // `skipIf(uid === 0)` like F5e, F5f and P3b: root reads a mode-0111
  // file, so under root the gate reads this launcher and the case measures
  // nothing (final review, C1).
  it.skipIf(process.getuid?.() === 0).each([
    // `/usr/bin/true` first: macOS has no `/bin/true` (ENOENT on the macOS
    // runner), and a usr-merged Linux answers both; `/bin/true` stays the
    // fallback for a Linux whose /bin is not merged.
    ['a BINARY launcher (P18)', (wrapper: string): void => {
      fs.copyFileSync(['/usr/bin/true', '/bin/true'].find((p) => fs.existsSync(p)) ?? '/usr/bin/true', wrapper);
    }],
    ['a SCRIPT launcher (P18b)', (wrapper: string): void => {
      fs.writeFileSync(wrapper, '#!/usr/bin/env bash\necho hi\nexit 0\n');
    }],
  ])('%s at mode 0111, under a CORRECT external roster row, is untouched by the wrapper gate', (_what, plant) => {
    seedBoth({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, ROUTER] });
    const wrapper = path.join(harnessBin(h.home), 'router');
    plant(wrapper);
    fs.chmodSync(wrapper, 0o111);
    try {
      const r = runLane('router');
      expect(r.stderr).not.toContain('roster-not-codex');
      expect(r.stderr).not.toContain('roster-unreadable');
      expect(r.stderr).not.toContain('launcher-unreadable');
    } finally {
      fs.chmodSync(wrapper, 0o755);
    }
  });

  // ROUND 2 RE-REVIEW PROBE P3b: an EXTERNAL lane is unaffected by the
  // roster's own permissions, exactly as it is by the roster's own content
  // (F5b) — the gate's verdict comes from `router`'s WRAPPER, and grep never
  // touches the roster file at all.
  it.skipIf(process.getuid?.() === 0)('P3b: an EXTERNAL lane is unaffected by a mode-000 roster too', () => {
    seedBoth({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, ROUTER] });
    const roster = path.join(h.home, '.ccrc', 'accounts.json');
    fs.chmodSync(roster, 0o000);
    plantLauncher('router', '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" > "$HOME/seen-argv"\nexit 0\n');
    try {
      const r = runLane('router');
      expect(r.code, r.stderr).toBe(0);
      expect(fs.readFileSync(path.join(h.home, 'seen-argv'), 'utf8').trim()).toBe('login');
      expect(status('router')).toMatchObject({ state: 'done' });
    } finally {
      fs.chmodSync(roster, 0o644);
    }
  });

  // ROUND 2 RE-REVIEW PROBE P8: a wrapper that is a SYMLINK to a real
  // `ccrc-codex` wrapper is still recognised — `-f` and `grep` both follow a
  // symlink to its target transparently, so the gate needs no special case
  // for one.
  it('P8: a wrapper that is a SYMLINK to a real ccrc-codex wrapper is still recognised', () => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), '{ not json\n');
    const real = path.join(h.home, 'real-codex-a-wrapper');
    fs.writeFileSync(real, markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: CODEX_ROW.configDirSuffix, execKind: 'codex' }, 'claude')), { mode: 0o755 });
    const wrapper = path.join(harnessBin(h.home), 'codex-a');
    fs.rmSync(wrapper, { force: true });
    fs.symlinkSync(real, wrapper);
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('roster-unreadable');
  });

  // FINDING N5 (the `-f` half): a wrapper path that is NOT a regular file
  // must never reach the gate's `grep` at all. Uses the REAL
  // `_auth_openai_login` end to end (`runLane`, not a hand-copied snippet —
  // a copy would not catch a regression in the shipped `-f` check), with a
  // DIRECTORY at the wrapper path rather than a FIFO: `-f` is false for a
  // directory exactly as it is for a FIFO, but a directory fails `exec`
  // (`EISDIR`) at once instead of blocking on an open with no writer, so
  // this case runs fast and needs no bespoke timeout. What the PRE-EXISTING
  // external arm then does with an unexecutable wrapper (this box measures
  // `script`'s own blind spot again, on a `126` it never sees either) is
  // that arm's own business, untouched by this fix; what this case pins is
  // only that the WRAPPER GATE itself never mistakes a directory for a
  // `ccrc-codex` wrapper and never fails trying to read one as a file.
  it('F5g: a wrapper that is a DIRECTORY, not a regular file, is left to the external arm — the gate never reads it', () => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(path.join(h.home, '.ccrc', 'accounts.json'), '{ not json\n');
    const wrapper = path.join(harnessBin(h.home), 'codex-a');
    fs.rmSync(wrapper, { force: true });
    fs.mkdirSync(wrapper, { mode: 0o755 });
    const r = runLane('codex-a');
    expect(r.stderr).not.toContain('roster-unreadable');
    expect(r.stderr).not.toContain('roster-not-codex');
    expect(r.stderr).not.toContain('launcher-unreadable');
  });

  // ── FINAL REVIEW (F2): every word names its own state, and every remedy is
  // the one that was run in that state ────────────────────────────────────
  // Each case below refuses, performs the remedy the refusal names, and
  // RETRIES: a remedy is pinned by what the retry reaches, not by its text
  // alone. The commands a remedy names that this suite cannot run (`ccrc
  // install`, `ccrc wrappers`) were run in the same states through their own
  // harnesses; the fix wave's report holds those transcripts.
  //
  // The wrapper here is the generated `ccrc-codex` body with NOTHING behind
  // it: no `ccrc-codex`, and `ccrc` is `FAKE_CCRC`. A refusal must fire
  // before anything runs, and a retry that reaches the codex arm runs only
  // the fake. Never `plantRealCodexWrapper` in these cases: its `ccrc` is a
  // symlink into the repository, and a later `plantLauncher('ccrc', …)`
  // would write THROUGH it.
  const plantCodexWrapperOnly = (): void => {
    plantLauncher('codex-a', markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: CODEX_ROW.configDirSuffix, execKind: 'codex' }, 'claude')));
    plantLauncher('ccrc', FAKE_CCRC(0));
  };
  const rosterPath = (): string => path.join(h.home, '.ccrc', 'accounts.json');
  const withCodexJson = `${JSON.stringify(WITH_CODEX, null, 2)}\n`;
  /** A roster whose codex-a row carries `exec` as given (`undefined` drops
   *  the key). accounts.sh keeps WITH_CODEX's projection, so `_auth_rostered`
   *  still admits the id and the gate is what answers. */
  const rosterWithExec = (exec: unknown): string => {
    const { exec: _drop, ...rest } = CODEX_ROW;
    void _drop;
    const row = exec === undefined ? rest : { ...rest, exec };
    return `${JSON.stringify({ version: 1, accounts: [...DEFAULT_TEST_ROSTER.accounts, row] }, null, 2)}\n`;
  };
  /** The retry reached the codex arm and ran `ccrc codex login codex-a`. */
  const expectCodexArm = (r: { code: number; stderr: string }): void => {
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'seen-ccrc-argv'), 'utf8').trim()).toBe('codex login codex-a');
    expect(status('codex-a')).toMatchObject({ state: 'done' });
  };
  const refusedWith = (r: { code: number; stderr: string }, word: string): string => {
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${word}:`);
    const s = status('codex-a');
    expect(s['state'], `published status: ${JSON.stringify(s)}`).toBe('failed');
    expect(String(s['error']).startsWith(`${word}:`), String(s['error'])).toBe(true);
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv')), 'a refusal ran ccrc').toBe(false);
    return String(s['error']);
  };

  // X3: `_auth_exec_kind`'s own words, one per state, asserted directly. The
  // old function answered '' for the first four rows after `undecidable`'s,
  // and its caller could split only "no file" back out of them.
  it.each([
    ['no file', 'absent', (): void => { fs.rmSync(rosterPath(), { force: true }); }],
    ['a link to nothing', 'dangling', (): void => {
      fs.rmSync(rosterPath(), { force: true });
      fs.symlinkSync(path.join(h.home, 'nowhere.json'), rosterPath());
    }],
    ['a link to a real roster (read through)', 'kind:codex', (): void => {
      fs.renameSync(rosterPath(), path.join(h.home, 'real.json'));
      fs.symlinkSync(path.join(h.home, 'real.json'), rosterPath());
    }],
    ['not JSON', 'undecidable', (): void => { fs.writeFileSync(rosterPath(), '{ not json\n'); }],
    ['no row for the id', 'no-row', (): void => {
      fs.writeFileSync(rosterPath(), `${JSON.stringify({ version: 1, accounts: DEFAULT_TEST_ROSTER.accounts })}\n`);
    }],
    ['`{}`', 'no-row', (): void => { fs.writeFileSync(rosterPath(), '{}\n'); }],
    ['a row with exec {}', 'no-kind', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec({})); }],
    ['a row with exec.kind 7', 'no-kind', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec({ kind: 7 })); }],
    ['a row with exec "codex" (a string, not an object)', 'no-kind', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec('codex')); }],
    ['a row with no exec at all', 'no-kind', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec(undefined)); }],
    ['a codex row', 'kind:codex', (): void => { /* seedBoth's own */ }],
    ['an invalid kind', 'kind:bogus', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec({ kind: 'bogus' })); }],
    // THE TAG'S REASON: a kind SPELLED like a state word is still a kind.
    ['a kind spelled "absent"', 'kind:absent', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec({ kind: 'absent' })); }],
    // The FIRST string kind among the id's rows, as before the split: a
    // roster naming the id twice answers what it answered at BASE.
    ['the id twice, the first row kindless', 'kind:external', (): void => {
      const { exec: _e, ...rest } = CODEX_ROW; void _e;
      fs.writeFileSync(rosterPath(), `${JSON.stringify({ version: 1, accounts: [
        ...DEFAULT_TEST_ROSTER.accounts, { ...rest, exec: {} }, { ...rest, exec: { kind: 'external' } }] })}\n`);
    }],
  ])('X3: _auth_exec_kind answers ONE word per state — %s → %s', (_what, word, shape) => {
    seedBoth(WITH_CODEX);
    shape();
    expect(fn('AUTH_ID=codex-a; _auth_exec_kind')).toBe(word);
  });

  // X1: roster-absent's remedy. "Put it back" is run here; the `ccrc
  // install` sequence was run through the install harness (the first install
  // seeds a one-account default and regenerates accounts.sh from it, which
  // drops codex-a and every other account; `ccrc wrappers` leaves accounts.sh
  // as it was, so the login answers unknown-account; a second install after
  // the lane is declared again reaches the codex arm).
  it('X1: roster-absent names put-it-back first and ends with a SECOND `ccrc install`, never `ccrc wrappers` — and putting it back reaches the codex arm', () => {
    seedBoth(WITH_CODEX);
    fs.rmSync(rosterPath(), { force: true });
    plantCodexWrapperOnly();
    const err = refusedWith(runLane('codex-a'), 'roster-absent');
    expect(err).toContain('If you have a copy, put it back and retry');
    expect(err).toContain('drops every other account');
    expect(err).toContain('Re-declare codex-a');
    expect(err).toContain('re-declare every other account you noted');
    expect(err).toContain("then run 'ccrc install' again");
    expect(err).toContain("'ccrc wrappers' does not regenerate accounts.sh");
    expect(err).not.toMatch(/and run 'ccrc wrappers'\.$/);
    fs.writeFileSync(rosterPath(), withCodexJson);
    expectCodexArm(runLane('codex-a'));
  });

  // X2: a dangling link names its target, anchors a relative target at the
  // accounts.json directory, and warns that `ccrc install` replaces the link
  // (measured through the install harness:
  // after it, accounts.json is a regular file holding the one default
  // account, and the link's target is still missing).
  it('X2: an absolute dangling-symlink roster names its target and warns off install — restoring it reaches the codex arm', () => {
    seedBoth(WITH_CODEX);
    const target = path.join(h.home, 'roster-store', 'accounts.json');
    fs.rmSync(rosterPath(), { force: true });
    fs.symlinkSync(target, rosterPath());
    plantCodexWrapperOnly();
    const err = refusedWith(runLane('codex-a'), 'roster-dangling');
    expect(err).toContain(`is a symlink to ${target}, which does not resolve`);
    expect(err).toContain(`Put the roster back at ${target}`);
    expect(err).toContain("Do not run 'ccrc install' first");
    expect(err).toContain('replaces the link itself');
    expect(err).not.toContain('does not exist');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, withCodexJson);
    expectCodexArm(runLane('codex-a'));
    // …and the other half of the remedy: re-pointing the link.
    fs.rmSync(path.join(h.home, 'seen-ccrc-argv'));
    fs.rmSync(rosterPath());
    fs.symlinkSync(path.join(h.home, 'nowhere-else.json'), rosterPath());
    refusedWith(runLane('codex-a'), 'roster-dangling');
    fs.rmSync(rosterPath());
    fs.symlinkSync(target, rosterPath());
    expectCodexArm(runLane('codex-a'));
  });

  it('X2: a relative dangling target is resolved from accounts.json directory, not the process cwd', () => {
    seedBoth(WITH_CODEX);
    fs.rmSync(rosterPath(), { force: true });
    fs.symlinkSync('../roster-store/accounts.json', rosterPath());
    plantCodexWrapperOnly();
    const resolved = path.join(h.home, 'roster-store', 'accounts.json');
    const err = refusedWith(runLane('codex-a'), 'roster-dangling');
    expect(err).toContain('symlink target ../roster-store/accounts.json');
    const spelled = `${path.dirname(rosterPath())}/../roster-store/accounts.json`;
    expect(err).toContain(`resolves relative to ${path.dirname(rosterPath())} as ${spelled}`);
    expect(err).toContain(`Put the roster back at ${spelled}`);
    expect(err).not.toContain(`${process.cwd()}/../roster-store/accounts.json`);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, withCodexJson);
    expectCodexArm(runLane('codex-a'));
  });

  it.each([
    ['fails', '#!/bin/sh\nexit 1\n'],
    ['returns an empty target', '#!/bin/sh\nexit 0\n'],
  ])('X2: readlink that %s is reported as unmeasured, never as a blank target', (_what, readlink) => {
    seedBoth(WITH_CODEX);
    fs.rmSync(rosterPath(), { force: true });
    fs.symlinkSync('../roster-store/accounts.json', rosterPath());
    plantCodexWrapperOnly();
    plantLauncher('readlink', readlink);
    const err = refusedWith(runLane('codex-a'), 'roster-dangling-target-unmeasured');
    expect(err).toContain('readlink did not return one non-empty target');
    expect(err).toContain('Inspect or replace the link by hand');
    expect(err).not.toContain('symlink to ,');
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv'))).toBe(false);
  });

  // The no-row remedy, the same class as X1: `ccrc install` reports the same
  // orphan `ccrc wrappers` does, but it also regenerates accounts.sh without
  // the id (measured), so the text no longer offers install as a way to see
  // the orphan, and says a row restored after one needs a second.
  it('no-row: roster-not-codex offers `ccrc wrappers`, not install, to see the orphan — and restoring the row reaches the codex arm', () => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(rosterPath(), `${JSON.stringify({ version: 1, accounts: DEFAULT_TEST_ROSTER.accounts }, null, 2)}\n`);
    plantCodexWrapperOnly();
    const err = refusedWith(runLane('codex-a'), 'roster-not-codex');
    expect(err).toContain('no longer lists codex-a');
    expect(err).toContain("Run 'ccrc wrappers' to see it reported as an orphan");
    expect(err).not.toContain("(or 'ccrc install')");
    expect(err).toContain("before any 'ccrc install'");
    fs.writeFileSync(rosterPath(), withCodexJson);
    expectCodexArm(runLane('codex-a'));
  });

  // X3 + X4: a row with no usable kind, and a kind the validator does not
  // know, are one word with one remedy — fix exec.kind — because `ccrc
  // wrappers` and `ccrc install` both refuse the WHOLE roster over either
  // (measured: "missing or invalid exec.kind", nothing written, rc 1). The
  // old texts were "no longer lists it" (false: it does) and the external
  // arm's "replace by hand" (a rewrite is not what is wrong).
  it.each([
    ['exec {}', {}, 'with no usable exec.kind'],
    ['exec.kind 7', { kind: 7 }, 'with no usable exec.kind'],
    ['exec "codex" (a string)', 'codex', 'with no usable exec.kind'],
    ['no exec at all', undefined, 'with no usable exec.kind'],
    ['exec.kind "bogus"', { kind: 'bogus' }, 'declares codex-a exec.kind "bogus", which is not a kind ccrc knows'],
    ['exec.kind "absent" (spelled like a state word)', { kind: 'absent' }, 'declares codex-a exec.kind "absent", which is not a kind ccrc knows'],
  ])('X3/X4: a codex-a row with %s is roster-kind-invalid, "fix exec.kind" — and fixing it reaches the codex arm', (_what, exec, says) => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(rosterPath(), rosterWithExec(exec));
    plantCodexWrapperOnly();
    const err = refusedWith(runLane('codex-a'), 'roster-kind-invalid');
    expect(err).toContain(says);
    expect(err).toContain("'ccrc wrappers' and 'ccrc install' both refuse the whole roster");
    expect(err).toContain('Set exec.kind for codex-a');
    expect(err).not.toContain('no longer lists');
    expect(err).not.toContain('by hand');
    expect(err).not.toContain('never writes');
    fs.writeFileSync(rosterPath(), withCodexJson);
    expectCodexArm(runLane('codex-a'));
  });

  // X4's other edge: EVERY kind the roster validator accepts has its own arm
  // in the gate, derived from the validator rather than typed here, so a kind
  // added to EXEC_KINDS and not to the helper reds HERE instead of reaching a
  // phone as "not a kind ccrc knows".
  const VALIDATOR_KINDS = ((): string[] => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../shared/roster-json.mjs'), 'utf8');
    const m = /const EXEC_KINDS = new Set\(\[([^\]]*)\]\)/.exec(src);
    return m ? m[1]!.split(',').map((t) => t.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
  })();
  it('X4: the validator\'s EXEC_KINDS is read, and names codex among at least four kinds', () => {
    expect(VALIDATOR_KINDS).toContain('codex');
    expect(VALIDATOR_KINDS.length).toBeGreaterThanOrEqual(4);
  });
  it.each(VALIDATOR_KINDS)('X4: exec.kind "%s", which the validator accepts, is never roster-kind-invalid', (kind) => {
    seedBoth(WITH_CODEX);
    fs.writeFileSync(rosterPath(), kind === 'codex' ? withCodexJson : rosterWithExec({ kind }));
    plantCodexWrapperOnly();
    const r = runLane('codex-a');
    if (kind === 'codex') { expectCodexArm(r); return; }
    const err = refusedWith(r, 'roster-not-codex');
    expect(err).toContain(`exec.kind "${kind}"`);
  });

  // C1: the gate's rc ≥ 2 refusals fire for EVERY undecided word — the old
  // `''` half of this list had no case, and deleting it stayed green 83/83
  // (measured, final review). Each row's retry after the remedy ("make it
  // readable") reaches that state's OWN word, never launcher-unreadable.
  it.skipIf(process.getuid?.() === 0).each([
    ['absent', 'roster-absent', (): void => { fs.rmSync(rosterPath(), { force: true }); }],
    ['dangling', 'roster-dangling', (): void => {
      fs.rmSync(rosterPath(), { force: true });
      fs.symlinkSync(path.join(h.home, 'nowhere.json'), rosterPath());
    }],
    ['no-row', 'roster-not-codex', (): void => { fs.writeFileSync(rosterPath(), '{}\n'); }],
    ['no-kind', 'roster-kind-invalid', (): void => { fs.writeFileSync(rosterPath(), rosterWithExec({})); }],
    ['undecidable', 'roster-unreadable', (): void => { fs.writeFileSync(rosterPath(), '{ not json\n'); }],
  ])('C1: a mode-0111 ccrc-codex wrapper under a(n) %s roster is launcher-unreadable, and made readable it is %s', (_word, after, shape) => {
    seedBoth(WITH_CODEX);
    shape();
    plantCodexWrapperOnly();
    const wrapper = path.join(harnessBin(h.home), 'codex-a');
    fs.chmodSync(wrapper, 0o111);
    try {
      const err = refusedWith(runLane('codex-a'), 'launcher-unreadable');
      expect(err).toContain('Make it readable, or move it aside');
    } finally {
      fs.chmodSync(wrapper, 0o755);
    }
    const retry = runLane('codex-a');
    expect(retry.stderr).toContain(`${after}:`);
    expect(retry.stderr).not.toContain('launcher-unreadable');
  });

  it.skipIf(process.getuid?.() === 0)('C1: "move it aside" — the retry is the external arm\'s own launcher-absent, and nothing ran', () => {
    seedBoth(WITH_CODEX);
    fs.rmSync(rosterPath(), { force: true });
    plantCodexWrapperOnly();
    const wrapper = path.join(harnessBin(h.home), 'codex-a');
    fs.chmodSync(wrapper, 0o111);
    refusedWith(runLane('codex-a'), 'launcher-unreadable');
    fs.renameSync(wrapper, `${wrapper}.aside`);
    fs.chmodSync(`${wrapper}.aside`, 0o755);
    const r = runLane('codex-a');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('launcher-absent:');
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv'))).toBe(false);
  });

  // D3: grep's rc is split by WHY. With grep off PATH (127) or not executable
  // (126), bash could not run it at all, which is a missing dependency and
  // not an unreadable wrapper; a grep that DIED (a signal, 128+n) is neither.
  // The PATH below is REAL absence — a directory of links to the few tools
  // the path to the refusal needs, with no grep among them — not a stub that
  // exits 127.
  const toolsDir = (grep: 'none' | 'not-executable'): string => {
    const d = path.join(h.home, `tools-${grep}`);
    fs.mkdirSync(d, { recursive: true });
    // Resolved in-process from this runner's PATH, not by spawning a shell.
    const dirs = (process.env['PATH'] ?? '').split(':').filter(Boolean);
    for (const t of ['bash', 'jq', 'date', 'mkdir', 'chmod', 'mv', 'rm']) {
      const real = dirs.map((x) => path.join(x, t)).find((p) => fs.existsSync(p));
      if (real === undefined) throw new Error(`this box has no ${t} on PATH — the fixture needs it`);
      fs.symlinkSync(real, path.join(d, t));
    }
    if (grep === 'not-executable') fs.writeFileSync(path.join(d, 'grep'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    return d;
  };
  it.each([
    ['grep absent from PATH', 'dependency-missing', 'exit 127', (): NodeJS.ProcessEnv => ({ PATH: toolsDir('none') })],
    ['grep not executable', 'dependency-missing', 'exit 126', (): NodeJS.ProcessEnv => ({ PATH: toolsDir('not-executable') })],
    ['grep killed by a signal', 'launcher-unmeasured', 'grep exited 137', (): NodeJS.ProcessEnv => {
      // Shadows the real grep from the head of PATH (harnessBin).
      plantLauncher('grep', '#!/bin/sh\nkill -KILL $$\n');
      return {};
    }],
  ])('D3: %s is %s, never launcher-unreadable — and the retry with a working grep is the gate\'s own verdict', (_what, word, says, env) => {
    seedBoth(WITH_CODEX);
    fs.rmSync(rosterPath(), { force: true });
    plantCodexWrapperOnly();
    const err = refusedWith(runLane('codex-a', env()), word);
    expect(err).toContain(says);
    expect(err).not.toContain('could not be read');
    fs.rmSync(path.join(harnessBin(h.home), 'grep'), { force: true });
    const retry = runLane('codex-a');
    expect(retry.stderr).toContain('roster-absent:');
  });

  // X4: the phone gets no review jargon. Every `_auth_die` text is published
  // to the status file the phone renders, so none may cite a finding, a
  // review round, a mutation or a deviation number.
  it('X4: no refusal text this helper publishes carries review jargon', () => {
    const dies = fs.readFileSync(HELPER, 'utf8').split('\n')
      .filter((l) => !/^\s*#/.test(l) && l.includes('_auth_die "'));
    expect(dies.length).toBeGreaterThanOrEqual(20);
    const jargon = dies.filter((l) => /\bfinding\b|\bR\d+-\d+\b|\bD-\d+\b|\bround \d|\bmeasured\b/i.test(l));
    expect(jargon).toEqual([]);
  });

  // THE TWO-READ WINDOW (final review): the roster is read by
  // `_auth_exec_kind` and again by `ccrc-codex`'s `ccrc codex start`. On the
  // old path a roster REPAIRED between the two let the second read start the
  // lane with "login" as Claude Code's prompt (measured with the gate
  // disabled: the upstream received `login`). The injection below repairs
  // the roster the instant after the first read. The gate answers from that
  // first read's word and the wrapper's bytes, so `ccrc codex start` is never
  // reached. `ccrc-codex` here is the REAL launcher and `ccrc` a recorder, so
  // a gate that let it through would show as `codex start codex-a` below.
  it('the two-read window: a roster repaired between the first read and ccrc-codex\'s own is never read a second time from this arm', () => {
    seedBoth(WITH_CODEX);
    const repaired = path.join(h.home, 'repaired.json');
    fs.writeFileSync(repaired, withCodexJson);
    fs.writeFileSync(rosterPath(), '{ not json\n');
    plantCodexWrapperOnly();
    fs.symlinkSync(path.join(CCD_ROOT, 'ccrc-codex'), path.join(harnessBin(h.home), 'ccrc-codex'));
    const inject = 'eval "$(declare -f _auth_exec_kind | sed "1s/_auth_exec_kind/_f2_first_read/")"; '
      + '_auth_exec_kind() { local a; a="$(_f2_first_read)"; cp "$REPAIRED" "$HOME/.ccrc/accounts.json"; printf %s "$a"; }';
    let code = 0; let stderr = '';
    try {
      execFileSync('bash', ['-c', `source "${HELPER}"; unset CCRC_AUTH_NO_MAIN; ${inject}; _auth_main codex-a openai-login`], {
        encoding: 'utf8', cwd: h.home, timeout: 60_000,
        env: ghContainedEnv(h.home,
          { ...process.env, HOME: h.home, CCRC_AUTH_NO_MAIN: '1', CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '15', REPAIRED: repaired },
          { systemd: true, tmux: true }),
      });
    } catch (e) { const err = e as { status?: number; stderr?: string }; code = err.status ?? 1; stderr = String(err.stderr ?? ''); }
    expect(fs.readFileSync(rosterPath(), 'utf8'), 'the injection never ran — this case would measure nothing').toBe(withCodexJson);
    expect(code).toBe(1);
    expect(stderr).toContain('roster-unreadable:');
    expect(fs.existsSync(path.join(h.home, 'seen-ccrc-argv')), 'ccrc-codex reached the second read').toBe(false);
    expect(status('codex-a')).toMatchObject({ state: 'failed' });
  });
});

describe('ccd-account-auth — advertised, shipped, taken back off, and agent-first', () => {
  // Files read by path rather than through a helper: `ccd/ccrc`, `deploy.sh`
  // and `gen-wrappers.mjs` have no single-sourced constant in this package the
  // way `CCD` does, and minting one here would be a second spelling
  // `single-definition.test.ts` exists to refuse.
  const REPO = path.resolve(__dirname, '../..');
  const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), 'utf8');

  it('ccd advertises account-v1 as a CAPABILITY, not as a verb', () => {
    // The token every wave-2 route gates on. `capSupported(state,'account-v1')`
    // answers FALSE on no evidence, so a box that has not taken this deploy
    // gets `501 unsupported` rather than a route that half works.
    expect(h.sh('cmd_caps').split('\n')).toContain('account-v1');
    // …and it is NOT dispatchable: `ccd account-v1` is not a command. Through
    // the shared `CCD` constant, not a second spelling of that path —
    // `single-definition.test.ts` holds it to one file and is right to.
    expect(fs.readFileSync(CCD, 'utf8')).not.toMatch(/^ {2}account-v1\)/m);
  });

  it('the capability is named in the list that partitions caps output', () => {
    // `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS is HAND-MAINTAINED and is
    // what tells a capability token apart from a verb. Said here too, because
    // the file that adds the token and the file that classifies it are two
    // packages apart in a reader's head even though they are not on disk.
    //
    // MEMBERSHIP, NOT THE WHOLE ARRAY (D-2595). This quoted the entire literal
    // until the
    // account-pools merge added `pools-v1` to it — a false red over a list
    // doing its job. What this test is FOR is that `account-v1` is classified
    // at all; the exactness of the rest is `ccd-archive.test.ts`'s own business
    // and it holds the set equal to the advertised one in both directions.
    const arr = /const KNOWN_CAPABILITY_TOKENS = \[([^\]]*)\]/
      .exec(read('server', 'test', 'ccd-archive.test.ts'));
    expect(arr, 'ccd-archive.test.ts has no KNOWN_CAPABILITY_TOKENS array').not.toBeNull();
    expect(arr![1]!.split(',').map((t) => t.trim().replace(/^'|'$/g, '')))
      .toContain('account-v1');
  });

  it('_inst_bins places the helper on BOTH platform arms', () => {
    // Unlike ccd-cap-scopes (cgroups) and ccd-graph-sweep (a systemd timer),
    // this one is not Darwin-excluded: decision 9 makes macOS a supported box,
    // and only the two PANE methods are gated — inside the helper, at runtime.
    const ccrc = read('ccd', 'ccrc');
    const m = /_inst_bins\(\) \{([\s\S]*?)\n\}/.exec(ccrc);
    expect(m, 'ccd/ccrc has no _inst_bins').toBeTruthy();
    const body = m![1]!;
    const line = '_inst_atomic "$tree/ccd/ccd-account-auth" "$bin/ccd-account-auth" 755';
    expect(body).toContain(line);
    // Outside the `if [ "$CCD_OS" != darwin ]` block — measured by POSITION,
    // not by reading the comment beside it.
    const darwinGuard = body.indexOf('if [ "$CCD_OS" != darwin ]; then');
    expect(darwinGuard, 'the darwin carve-out must still be findable').toBeGreaterThan(-1);
    const closeAt = body.indexOf('\n  fi\n', darwinGuard);
    expect(closeAt).toBeGreaterThan(darwinGuard);
    const at = body.indexOf(line);
    expect(at < darwinGuard || at > closeAt,
      'the helper must not be inside the darwin carve-out').toBe(true);
  });

  it('the uninstall takes it back off PATH, and does not mistake it for a wrapper', () => {
    // TWO TEXT PINS, and they are text on purpose: the behaviour of both lines
    // is measured in `ccrc-uninstall.test.ts` against a real fixture box, and
    // this is the copy a reader of THIS feature finds. The orphan rule is
    // `_uninst_tree_bins`' own comment: an uninstall that leaves the binary
    // strands it on PATH for ever — and this helper has no units, so nothing
    // else removes anything on its behalf.
    //
    // The `case` is the weaker claim and is stated as such. Today an unmarked
    // `ccd-account-auth` is kept silently by the wrapper arm whether or not
    // the case names it. The entry is what keeps that true once anything
    // stamps the file; `ccrc-uninstall.test.ts`'s stamped fixture is where it
    // goes red.
    //
    // MEMBERSHIP IN THAT `case`, NOT THE WHOLE ARM AS A LITERAL (D-2595). This
    // assertion
    // used to quote the entire line, and the account-pools merge broke it by
    // adding two siblings to the same arm — a false red over a change that did
    // exactly what this test wants. The claim was never "these five names in
    // this order"; it is "`ccd-account-auth` is one of the names this arm
    // skips", which is what the split below measures, still anchored to that
    // one line rather than to the name appearing anywhere in a 12k-line file.
    const ccrc = read('ccd', 'ccrc');
    const arm = ccrc.match(/^\s*case "\$name" in ([^)]*)\) continue ;; esac$/m);
    expect(arm, 'the executables `case` in _uninst_wrappers must be findable').not.toBeNull();
    expect(arm![1].split('|')).toContain('ccd-account-auth');
    expect(ccrc).toContain('"$HOME/.local/bin/ccd-account-auth"');
  });

  it('the agent deploy ships it, BEFORE the agent restart', () => {
    // AGENT-FIRST end to end. The agent caches `ccd caps` at boot — the
    // 113-second lesson deploy.sh records — so an agent restarted against
    // yesterday's ccd pins yesterday's capability set until someone restarts
    // it again.
    const deploySh = read('deploy', 'deploy.sh');
    expect(deploySh).toContain('install_atomic ccd/ccd-account-auth .local/bin/ccd-account-auth 755');
    const agentStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    expect(agentStart, 'deploy.sh has no agent branch').toBeGreaterThan(-1);
    const agentBranch = deploySh.slice(agentStart, deploySh.indexOf('\nelse', agentStart));
    const shipAt = agentBranch.indexOf('install_atomic ccd/ccd-account-auth');
    const restartAt = agentBranch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');
    expect(shipAt, 'the helper is not shipped on the agent lane').toBeGreaterThan(-1);
    expect(restartAt, 'the agent restart is not in the agent branch').toBeGreaterThan(-1);
    expect(shipAt, 'the helper must land before the agent restart that caches ccd caps')
      .toBeLessThan(restartAt);
  });
});

// ── THE PANE-BOUND SPAWN HAS TO END ───────────────────────────────────────
// D-2673 gave the darwin arm a shape that could not terminate, and D-2679
// booked the wrong reason for it. Both are measured here rather than argued.
//
// The arm is selected by `CCD_OS`, which the helper derives once at source
// time — so a Linux box can drive the DARWIN arm by assigning it after
// sourcing. That is the whole reason these cases can be red on this box
// instead of waiting on a macOS leg that gets cancelled before it reports.
// What is NOT claimed here is anything about BSD `script(1)`; that lives in
// `script-shim-platform.test.ts` and only macOS can answer it.
describe('ccd-account-auth — the pane-bound spawn has to END (D-2734..D-2737)', () => {
  /** Drive one spawn+pump+wait cycle with the arm forced, and report what
   *  happened through a FILE.
   *
   *  THE RESULT GOES THROUGH A FILE, NOT A PIPE, and that is the point of this
   *  helper rather than a detail of it (D-2739). A pane-bound run can leave a
   *  copier holding whatever fds it inherited; hand it a pipe that the parent
   *  reads to EOF and the reader waits on a process nobody is going to reap.
   *  `timeout` bounds the run, and every stream the driver owns goes to a file.
   */
  const drive = (os: 'linux' | 'darwin', opts: {
    mint: string; code?: string; secs?: string; grace?: string; noDeadline?: boolean;
  }): Record<string, string> => {
    const out = path.join(h.home, `drive-${os}.txt`);
    const script = `
      source "${HELPER}"
      CCD_OS=${os}; AUTH_ID=claude-a
      ${opts.noDeadline ? '_auth_timeout() { shift; "$@"; }' : ''}
      _auth_open_pipes || exit 9
      _auth_spawn_pty_child bash -c "$MINT"
      child=$AUTH_CHILD; exec 8<"$AUTH_RUN/out"
      [ -n "\${CODE:-}" ] && printf '%s\\n' "$CODE" >&9
      _auth_pump; wait "$child"; rc=$?
      # The default on AUTH_EXPIRED below is load-bearing: the helper runs
      # under set -u, so a tree without D-2736 global would die HERE rather
      # than in the behaviour under test - a red proving the variable is
      # absent and nothing about whether the run terminates.
      # EVERY COUNT THROUGH $(( )), because BSD wc -l PADS: macOS answers
      # "       0" where GNU answers "0", and a string compare then fails on a
      # value that is correct. Measured on macos-latest - the same GNU-vs-BSD
      # class as D-2613's stat -c, caught by CI rather than by reading.
      before=$(( $(pgrep -P $$ -x cat | wc -l) ))
      _auth_close_pipes; sleep 1
      printf 'rc=%s\\nexpired=%s\\ncopier_before=%s\\ncopier_after=%s\\nfifos=%s\\nstate=%s\\n' \\
        "$rc" "\${AUTH_EXPIRED:-0}" "$before" "$(( $(pgrep -P $$ -x cat | wc -l) ))" \\
        "$(( $(ls -1 "$AUTH_RUN" 2>/dev/null | wc -l) ))" "$AUTH_STATE" > "${out}"
    `;
    const env = ghContainedEnv(h.home, {
      ...process.env, HOME: h.home, CCRC_AUTH_NO_MAIN: '1', CCRC_AUTH_TICK: '0.2',
      CCRC_AUTH_TIMEOUT: opts.secs ?? '600', CCRC_AUTH_PUMP_GRACE: opts.grace ?? '10',
      MINT: opts.mint, CODE: opts.code ?? '',
    }, { systemd: true, tmux: true });
    // 20s is well under vitest's own patience and well over every case here;
    // a case that reaches it has HUNG, which is the defect being pinned.
    try { execFileSync('bash', ['-c', script], { env, cwd: h.home, timeout: 20_000, stdio: 'ignore' }); }
    catch { /* a hang throws ETIMEDOUT; the file below is then absent or stale */ }
    if (!fs.existsSync(out)) return { hung: 'yes' };
    return Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n')
      .map((l) => l.split('=') as [string, string]));
  };

  // THE ONE THAT WOULD HAVE CAUGHT D-2673. Same helper, same mint, only the
  // arm differs — and before the fix the darwin row never returned at all.
  for (const os of ['linux', 'darwin'] as const) {
    it(`${os}: the run ENDS, and reports the mint's own status`, () => {
      const r = drive(os, { mint: 'echo line-one; exit 3' });
      expect(r['hung'], `the ${os} arm never returned — spawn/pump/wait did not terminate`)
        .toBeUndefined();
      expect(r['rc'], `the ${os} arm lost the mint's exit status`).toBe('3');
    });

    it(`${os}: the operator's code still reaches the mint`, () => {
      const r = drive(os, { mint: 'read -r c; [ "$c" = SECRET-42 ] && exit 0 || exit 9', code: 'SECRET-42' });
      expect(r['hung']).toBeUndefined();
      expect(r['rc'], 'the code written to fd 9 did not arrive on the mint\'s stdin').toBe('0');
    });

    // THE BACKSTOP, asked of a deadline that does not fire — which is D-2661's
    // measured behaviour on macOS, reproduced here by removing the deadline
    // outright rather than by waiting for it to misbehave.
    it(`${os}: a mint whose deadline never fires still ends, as EXPIRED not failed`, () => {
      const r = drive(os, { mint: 'echo alive; sleep 300', secs: '1', grace: '1', noDeadline: true });
      expect(r['hung'], 'nothing bounded the pump, so the run never ended').toBeUndefined();
      expect(r['expired'], 'the run ended but did not record itself as expired, so the '
        + 'caller would stamp `failed: the mint exited 143` over a promised terminal state').toBe('1');
    });

    // The copier is its own writer unless the substitution drops fd 9, and a
    // copier that cannot reach EOF outlives the run that made it.
    it(`${os}: the copier does not outlive _auth_close_pipes`, () => {
      const r = drive(os, { mint: 'echo alive; sleep 300', secs: '1', grace: '1', noDeadline: true });
      expect(r['copier_after'], 'a copier survived the run; it holds fd 9 on the FIFO it reads')
        .toBe('0');
      expect(r['fifos'], 'FIFOs were left under $HOME').toBe('0');
    });
  }
});
