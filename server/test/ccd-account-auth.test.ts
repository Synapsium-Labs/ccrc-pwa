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
import { makeCcdHarness, ghContainedEnv, harnessBin, CCD, type CcdHarness } from './ccdWsHelpers.js';

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
    const found = execFileSync('grep', ['-rl', CANARY_TOKEN, h.home], { encoding: 'utf8' })
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

  it('spells the BSD script argument order — UNVERIFIED against a real Mac, shipped as a branch', () => {
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
  // `ccd-account-auth` does not read `~/.ccrc/accounts.json` and the projection
  // it DOES read carries no `secretsFile` — `generateAccountsSh` emits ids,
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
