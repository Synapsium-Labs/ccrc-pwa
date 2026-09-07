// The credential-liveness probe. Four outcomes and NOT three — the fourth,
// "token file missing or empty", exists because of a measured trap: an EMPTY
// bearer makes the usage endpoint answer 429, not an auth error (spec E4). A
// classifier reading "not 403" as dead would condemn every account on the fleet
// the moment a secrets file went missing.
//
// The endpoint is never reached here. `curl` is resolved off PATH, and the
// harness plants a fake one in `<home>/.local/bin` — the head of the contained
// PATH — that answers a chosen status and body and records its argv and stdin.
// That recording is what lets this file assert the SECRETS contract as well as
// the classifier: the token must never appear in argv.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

// Linux-only by product shape, exactly as `graph-sweep.test.ts` carves itself
// out: the probe's only runner is a systemd timer, `_inst_bins` does not place
// it on a Darwin box, and flock(1) is not BSD userland.
beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const PROBE = path.resolve(__dirname, '../../ccd/ccd-account-health');
const SHAPE = path.resolve(__dirname, '../../ccd/ccrc-wrapper-shape');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
  ],
};

/** A `curl` that answers one status and body for every call, appends its argv to
 *  `$HOME/curl-argv` and its stdin to `$HOME/curl-stdin`, and honours the probe's
 *  `-w` contract by printing the body then a newline then the status. */
function plantCurl(status: string, body = '', exitCode = 0): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/curl-argv"
cat >> "$HOME/curl-stdin"
[ "${exitCode}" -ne 0 ] && exit ${exitCode}
printf '%s\\n%s' ${JSON.stringify(body)} ${JSON.stringify(status)}
exit 0
`, { mode: 0o755 });
}

/** Per-account status/body, keyed off the URL query the probe is NOT allowed to
 *  vary — so instead the fake reads `$HOME/next-<n>` in call order. */
function plantCurlSequence(rows: Array<{ status: string; body?: string; exit?: number }>): void {
  const bin = j('.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  rows.forEach((r, i) => {
    fs.writeFileSync(j(`resp-${i}`), `${r.exit ?? 0}\n${r.status}\n${r.body ?? ''}`);
  });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/curl-argv"
cat >> "$HOME/curl-stdin"
n=$(wc -l < "$HOME/curl-argv"); n=$((n - 1))
f="$HOME/resp-$n"
[ -f "$f" ] || { printf '\\n000'; exit 7; }
{ IFS= read -r rc; IFS= read -r st; body=$(cat); } < "$f"
[ "$rc" -ne 0 ] && exit "$rc"
printf '%s\\n%s' "$body" "$st"
exit 0
`, { mode: 0o755 });
}

const token = (id: string, value = 'sk-ant-oat01-FIXTURE'): void => {
  fs.mkdirSync(j('.cc-secrets'), { recursive: true });
  fs.writeFileSync(j('.cc-secrets', `${id}-oauth.env`),
    `export CLAUDE_CODE_OAUTH_TOKEN=${value}\n`, { mode: 0o600 });
};

/** An env file whose exact bytes are the subject — non-empty on disk, but not
 *  necessarily setting the variable the probe wants. */
const rawToken = (id: string, content: string): void => {
  fs.mkdirSync(j('.cc-secrets'), { recursive: true });
  fs.writeFileSync(j('.cc-secrets', `${id}-oauth.env`), content, { mode: 0o600 });
};

/** The real path of a binary, off the harness's own PATH. */
const realBin = (name: string): string => {
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    const p = path.join(dir, name);
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(`${name} is not on the harness PATH — this fixture cannot be built`);
};

/** A bin directory holding ONLY `needed`, so everything else is genuinely absent.
 *  The way to test a preflight is to take the tool away, not to mock the check. */
const thinBin = (needed: string[]): string => {
  const dir = j('.thin-bin');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of needed) fs.symlinkSync(realBin(n), path.join(dir, n));
  return dir;
};

const marker = (id: string): string => j('.cc-sessions', `${id}-authdead`);
const markerBody = (id: string): string => fs.readFileSync(marker(id), 'utf8');

function run(env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [PROBE], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home,
           PATH: `${j('.local', 'bin')}:${process.env['PATH'] ?? ''}`,
           CCRC_HEALTH_URL: 'https://fixture.invalid/api/oauth/usage', ...env },
  });
}

beforeEach(() => {
  home = mkTmp('ccrc-account-health-');
  fs.mkdirSync(j('.cc-sessions'), { recursive: true });
  fs.mkdirSync(j('.ccrc'), { recursive: true });
  fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify(ROSTER, null, 2));
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the four-outcome classifier', () => {
  it('401 is DEAD: writes "<epoch> auth-401"', () => {
    token('claude'); token('claude-a');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(markerBody('claude')).toMatch(/^\d+ auth-401$/);
  });

  it('403 naming oauth_scope_insufficient is LIVE: clears a standing marker', () => {
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('403', '{"type":"error","error":{"type":"oauth_scope_insufficient"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('429 is UNMEASURED: writes nothing', () => {
    token('claude'); token('claude-a');
    plantCurl('429', '{"type":"error","error":{"type":"rate_limit_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('429 is UNMEASURED: CLEARS NOTHING EITHER — a standing marker survives', () => {
    // The half that is easy to get wrong and expensive to get wrong: a probe
    // that cleared on every non-401 would erase a true verdict every time the
    // fleet was merely busy.
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('429');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(markerBody('claude')).toBe('1757203200 auth-401');
  });

  it('a network failure is UNMEASURED in both directions', () => {
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('000', '', 7);
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
  });

  it('a 403 that does NOT name oauth_scope_insufficient is UNMEASURED, not live', () => {
    // A 403 is proof of authentication only when it is the scope refusal E1
    // measured. Any other 403 is an observation this probe does not understand,
    // and an unrecognised observation may not clear a standing verdict.
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    plantCurl('403', '{"type":"error","error":{"type":"permission_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
  });

  it('a missing token file REFUSES: no request, no marker, and it says so', () => {
    token('claude-a');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(false);
    expect(r.stderr).toMatch(/claude: refused — no readable token/);
    // exactly ONE request went out: claude-a's. The refusal is BEFORE the wire.
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('an EMPTY token file REFUSES — this is E4, the reason the fourth row exists', () => {
    token('claude', '');
    token('claude-a');
    plantCurl('429', '{"type":"error","error":{"type":"rate_limit_error"}}');
    const r = run();
    expect(fs.existsSync(marker('claude'))).toBe(false);
    expect(r.stderr).toMatch(/claude: refused — no readable token/);
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('classifies each account independently', () => {
    token('claude'); token('claude-a');
    plantCurlSequence([
      { status: '401', body: '{"error":{"type":"authentication_error"}}' },
      { status: '403', body: '{"error":{"type":"oauth_scope_insufficient"}}' },
    ]);
    fs.writeFileSync(marker('claude-a'), '1757203200 auth-401');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });
});

describe('eligibility is roster-derived', () => {
  it('probes only telemetry:anthropic accounts — gpt is never asked', () => {
    token('claude'); token('claude-a'); token('gpt');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('names no account: swapping the roster swaps the subject', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [
      { id: 'other-one', label: 'x', configDirSuffix: '.x', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] }));
    token('other-one');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    expect(run().status).toBe(0);
    expect(fs.existsSync(marker('other-one'))).toBe(true);
  });

  it('refuses the whole pass when the roster cannot be read', () => {
    fs.rmSync(j('.ccrc', 'accounts.json'));
    plantCurl('403');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no roster at \$HOME\/\.ccrc\/accounts\.json/);
  });

  it('an id carrying whitespace is ONE illegal id, never two legal ones', () => {
    // The other half of the unquoted-expansion defect. `for id in $IDS` splits on
    // IFS as well as globbing, so `good-one evil` arrives as two ids that BOTH
    // pass the grammar gate — and the probe writes markers for two accounts that
    // do not exist. The gate cannot help: it runs after the splitting.
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [
      { id: 'good-one evil', telemetry: 'anthropic' },
    ] }));
    token('good-one'); token('evil');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.stderr).toMatch(/not a legal account id/);
    expect(fs.readdirSync(j('.cc-sessions'))).toEqual([]);
    expect(fs.existsSync(j('curl-argv'))).toBe(false);
  });

  it('refuses an id that is not a legal account id rather than naming a file after it', () => {
    fs.writeFileSync(j('.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [
      { id: '../escape', telemetry: 'anthropic' },
    ] }));
    plantCurl('401');
    const r = run();
    expect(r.stderr).toMatch(/not a legal account id/);
    expect(fs.readdirSync(j('.cc-sessions'))).toEqual([]);
  });
});

describe('the secrets contract', () => {
  it('the token never reaches argv', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a', 'sk-ant-oat01-SENTINEL');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-argv'), 'utf8')).not.toContain('SENTINEL');
  });

  it('the token DOES reach curl, on stdin — otherwise the pass measures nothing', () => {
    // The other half. Without it the assertion above is satisfied by a probe
    // that forgot to authenticate at all.
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    run();
    expect(fs.readFileSync(j('curl-stdin'), 'utf8')).toContain('SENTINEL');
  });

  it('the token never reaches stdout or stderr', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a', 'sk-ant-oat01-SENTINEL');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    const r = run();
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('an ambient CLAUDE_CODE_OAUTH_TOKEN is never mistaken for the account\'s own', () => {
    // The subshell that sources the env file INHERITS this process's
    // environment, and `CLAUDE_CODE_OAUTH_TOKEN` is precisely what every wrapper
    // session shell exports — so this is the likeliest path, not a contrived
    // one. A file that exists and is non-empty but sets nothing must REFUSE; if
    // `:-` is allowed to fall back to the environ, one account's credential
    // answers under another account's id and the marker is written to the wrong
    // name. `-z` cannot catch that, because the fallback filled the value.
    rawToken('claude', '# a comment, and a typo below\nexport ANTHROPIC_API_KEY=sk-ant-nope\n');
    token('claude-a');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    const r = run({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-AMBIENT' });
    expect(r.stderr).toMatch(/claude: refused — no readable token/);
    expect(fs.existsSync(marker('claude'))).toBe(false);
    // Only claude-a's request went out: the ambient value never reached the wire.
    expect(fs.readFileSync(j('curl-argv'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readFileSync(j('curl-stdin'), 'utf8')).not.toContain('AMBIENT');
  });

  it('SHELLOPTS=xtrace cannot write the bearer to the journal', () => {
    // Bash imports SHELLOPTS from the environment, so one stray export — or an
    // operator running `bash -x` — turns every expansion into a stderr line.
    // Under the systemd timer stderr IS the persistent journal, so an unguarded
    // probe writes an OAuth token to disk permanently. `set +x` on line 2 is the
    // guarantee, and it has to be in force before the first expansion.
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a', 'sk-ant-oat01-SENTINEL');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    const r = run({ SHELLOPTS: 'xtrace' });
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('the token never reaches the marker', () => {
    token('claude', 'sk-ant-oat01-SENTINEL'); token('claude-a');
    plantCurl('401', '{"type":"error","error":{"type":"authentication_error"}}');
    run();
    expect(markerBody('claude')).not.toContain('SENTINEL');
  });
});

describe('pass discipline', () => {
  it('a pause file stops the pass before any request', () => {
    token('claude'); token('claude-a');
    plantCurl('401');
    fs.writeFileSync(j('.ccrc', 'account-health-paused'), '');
    expect(run().status).toBe(0);
    expect(fs.existsSync(j('curl-argv'))).toBe(false);
  });

  it('a lock it cannot OPEN is loud — not the quiet exit that means "someone else holds it"', () => {
    // Two conditions that must not collapse. A held lock is the healthy overlap
    // and exits 0 in silence; a lock that cannot be opened at all is a broken box
    // and must say so. Collapsed, the probe no-ops forever on every timer tick,
    // reporting nothing — in the file whose own text says absence must be loud.
    token('claude'); token('claude-a');
    plantCurl('401');
    fs.mkdirSync(j('.ccrc', 'account-health.lock'));   // EISDIR on `exec 9>`
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/account-health: cannot open the lock/);
    expect(fs.existsSync(j('curl-argv'))).toBe(false);
  });

  it('the id loop reads from a private fd, so its body cannot eat the roster', () => {
    // Structural, because the property is DEFENSIVE: a here-string on `done`
    // becomes the stdin of every command in the body, so the first inner command
    // that reads stdin swallows the remaining ids and the pass probes one account
    // in silence. Measured while reverting the curl pipeline to a `-H` form: the
    // fake curl's `cat` ate the list and 1 request went out instead of 2. Nothing
    // in the body reads stdin today, which is exactly why this cannot be asserted
    // behaviourally — and exactly why it would regress unnoticed.
    const src = fs.readFileSync(PROBE, 'utf8');
    const read = /while IFS= read -r id <&(\d)/.exec(src);
    const feed = /done (\d)<<< "\$IDS"/.exec(src);
    expect(read, 'the loop must read from an explicit fd, not stdin').not.toBeNull();
    expect(feed, 'the here-string must be attached to that same explicit fd').not.toBeNull();
    expect(read![1]).toBe(feed![1]);
    expect(read![1]).not.toBe('0');   // 0 IS stdin — the bug this pins
  });

  it('a box with no flock refuses LOUDLY — it never takes the quiet contention exit', () => {
    // The preflight's whole reason for existing, and it is O1's collapse one door
    // up: `flock -n 9` on a box without flock fails exactly as a HELD lock does,
    // so the quiet "someone else is running" exit retires the pass — every timer
    // tick, forever, reporting nothing. `bash` and `jq` are symlinked in so the
    // ONLY thing missing is flock; curl is the planted fake in `.local/bin`.
    token('claude'); token('claude-a');
    plantCurl('403', '{"error":{"type":"oauth_scope_insufficient"}}');
    const r = run({ PATH: `${j('.local', 'bin')}:${thinBin(['bash', 'jq'])}` });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/flock is not on PATH — nothing was measured/);
    expect(fs.existsSync(j('curl-argv'))).toBe(false);
    expect(fs.existsSync(marker('claude'))).toBe(false);
  });

  it('an http:// URL is refused by curl itself — the bearer never goes out in cleartext', () => {
    // The ONE case that needs the REAL curl, because the guard being pinned is
    // curl's own protocol gate. It stays hermetic precisely BECAUSE the guard
    // works: `--proto '=https'` makes curl refuse with exit 1 ("Protocol \"http\"
    // not supported or disabled in libcurl") BEFORE it resolves anything, so
    // nothing leaves the box. The flagless control reaches exit 6 (NXDOMAIN on the
    // reserved `.invalid` TLD) — which is what makes exit 1 a discriminating
    // observable rather than a coincidence.
    //
    // A refused request is UNMEASURED, so the standing marker must survive it and
    // no new one may appear: the scheme guard must not become a fifth verdict.
    token('claude'); token('claude-a');
    fs.writeFileSync(marker('claude'), '1757203200 auth-401');
    const r = run({ CCRC_HEALTH_URL: 'http://fixture.invalid/api/oauth/usage',
                    CCRC_HEALTH_TIMEOUT: '5' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/claude: unmeasured — curl exited 1/);
    expect(fs.existsSync(marker('claude'))).toBe(true);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('writes a marker atomically — never a partial file another reader can see', () => {
    // `_authdead`'s digits gate already refuses a half-written marker, so this
    // asserts the writer's half of that pair: the file arrives by rename, so
    // the only two states a reader can observe are absent and complete.
    token('claude'); token('claude-a');
    plantCurl('401', '{"error":{"type":"authentication_error"}}');
    run();
    expect(fs.readdirSync(j('.cc-sessions')).filter((n) => n.includes('.tmp'))).toEqual([]);
    expect(markerBody('claude')).toMatch(/^\d+ auth-401$/);
  });
});

describe('the account-id grammar is not a third independent copy', () => {
  // `shared/roster.ts`'s ID_RE is module-private and `ccd/ccrc-wrapper-shape`'s
  // WRAPPER_ID_RE is the bash spelling of it. This probe needs a third, because
  // it is installed alone into $HOME/.local/bin with no library beside it to
  // source (the same reason `session-hook.sh` carries its own epoch copy). The
  // tree's answer to a value two files cannot share is to MEASURE the agreement
  // — `pool-name-parity.test.ts`'s shape — rather than to trust a comment.
  const literal = (file: string, name: string): string => {
    const m = new RegExp(`^${name}='([^']+)'$`, 'm').exec(fs.readFileSync(file, 'utf8'));
    expect(m, `${file} declares no bare ${name}= literal — this pin went blind`).not.toBeNull();
    return m![1]!;
  };

  it('the probe spells the same account-id grammar as ccrc-wrapper-shape', () => {
    expect(literal(PROBE, 'AH_ID_RE')).toBe(literal(SHAPE, 'WRAPPER_ID_RE'));
  });
});
