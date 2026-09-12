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
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

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
