// `deploy/notify.sh`'s address-resolution chain, THREE tiers: `CCRC_ADDR` env
// > `~/.ccrc/agent.env`'s `CCRC_SERVER_URL` > `~/.ccrc/ccrc.env`'s
// `CCRC_HOST`+`CCRC_PORT` > nothing at all.
//
// The old bottom tier — the reference fleet's own IP, hardcoded — is gone
// (D-199). It was added "kept one generation so a hook shipped ahead of the
// config file cannot go dark", and it outlived that generation: shipped
// publicly it is a compiled-in address pointing at one operator's box, so on
// anyone else's install it POSTs their fleet's activity to a stranger's
// machine.
//
// The agent.env tier is why removing it does not go quiet. D-73 holds — the
// FLEET host has no `~/.ccrc/ccrc.env` and is not missing one — so a chain
// that ends at ccrc.env resolves nothing on the very box that fires this hook,
// and "silence is the contract" would have quietly meant "silence, always".
// `CCRC_SERVER_URL` is already in agent.env, written by `ccrc install --role
// fleet` (ccd/ccrc:3051) and read by both coordination skills since #89, so
// the box needs no provisioning at all.
//
// PRECEDENCE, stated because nothing else records it: agent.env is read BEFORE
// ccrc.env. A combined single-box install carries both, and they name the same
// server today, so the order is not load-bearing — but the fleet-role key is
// the more specific answer to "where does this hook send", and a box that has
// been given one deliberately should not be overridden by the server-role
// file it happens to also carry.
//
// And on 2026-08-23 the hardcoded tier was ALREADY dead: once the server moved
// to a loopback bind behind its reverse proxy, `<the old literal>:7788`
// answered 000 from the fleet host and every swap notice had been silently
// dropped, because the curl ends `|| true`. That is why an address may now
// carry a scheme — a proxied box is reachable at its front door, not at
// host:port.
//
// The env file is read the same way `_box_env_value` reads it
// (ccd/ccrc:355-380) — grepped, never sourced, because it carries tokens — so
// this suite runs the real, checked-in `deploy/notify.sh` against a fixture
// HOME whose PATH holds nothing but a recording `curl` STUB (the network call
// itself must never fire from a test) and REAL `jq`/`grep`/`tail`/`cut`/`tr`
// binaries — every external tool the script's address-resolution chain and
// JSON body actually shell out to. Stubbing any of those away would hide a
// regression in the invocation itself; leaving them reachable (rather than
// system PATH generally) is what keeps the fixture from also reaching a real
// `curl`.
//
// Measured red-first against the ORIGINAL notify.sh (`curl … "${CCRC_ADDR:-
// 203.0.113.7:7788}"`, no ccrc.env tier at all): the two tests exercising
// the new middle tier ("reads CCRC_HOST/CCRC_PORT…" and "the LAST
// CCRC_HOST/CCRC_PORT assignment wins…") failed, landing on the baked IP
// instead — everything on the file was ignored. The other four passed
// unchanged, because they pin behavior the original script already had
// (legacy fallback, the CCRC_ADDR override, an incomplete env, an unreadable
// one). Re-verified red against that exact baseline via `git stash` after
// writing the fix, so the measurement is against the same test file the fix
// is graded by, not an earlier draft missing the grep/tail/cut/tr symlinks.
import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const notifyShPath = path.join(repoRoot, 'deploy', 'notify.sh');

// libuv resolves a bare executable against the CHILD's env, not this
// process's — so a fixture PATH holding only `stub-bin` would make a bare
// `spawnSync('bash', …)` ENOENT. Same trick `ccrc-doctor.test.ts` uses.
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const realPath = (name: string): string => {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (!p) throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
};

const stubBinDir = (home: string): string => {
  const d = path.join(home, 'stub-bin');
  mkdirSync(d, { recursive: true });
  return d;
};

/** A `curl` that logs every argv it saw (one line per invocation) and exits 0
 *  without ever touching the network. notify.sh's own trailing `|| true`
 *  would swallow a curl failure silently either way — the log, not the
 *  process's exit code, is the only channel this suite can observe. */
function stubCurl(home: string): void {
  writeFileSync(
    path.join(stubBinDir(home), 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/curl-calls"\nexit 0\n',
    { mode: 0o755 },
  );
}

const curlCalls = (home: string): string[] => {
  const p = path.join(home, 'curl-calls');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** `~/.ccrc/agent.env` — the FLEET box's config file, and the only one it has. */
function writeAgentEnv(home: string, text: string): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'agent.env'), text);
}

/** `~/.ccrc/ccrc.env` — written as TEXT, same as `ccrc-doctor.test.ts`'s
 *  fixture, because half of what the reader has to get right is which lines
 *  it ignores (comments, blanks, unrelated keys, indentation). */
function writeCcrcEnv(home: string, text: string): void {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), text);
}

/** Every external tool the address-resolution chain and the JSON body shell
 *  out to, besides `curl` itself (stubbed) — real binaries, symlinked in once
 *  per fixture so a regression in how the script actually invokes any of them
 *  (a flag typo, a pipeline reordering) still fails this suite. */
const REAL_TOOLS = ['jq', 'grep', 'tail', 'cut', 'tr'];

/** Runs the real, checked-in `deploy/notify.sh` against a fixture HOME whose
 *  PATH is `stub-bin` ONLY — no system directory reachable at all — holding
 *  the curl stub and symlinks to `REAL_TOOLS`. `CCRC_ADDR` and
 *  `CCRC_MAIL_TOKEN_FILE` are deleted BY NAME from a copy of this process's
 *  own env before `extraEnv` is applied, so neither can leak in from
 *  whatever happens to be set on the box running the suite; a test that wants
 *  to exercise the `CCRC_ADDR` override passes it back via `extraEnv`. */
function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
  const bin = stubBinDir(home);
  for (const name of REAL_TOOLS) {
    if (!existsSync(path.join(bin, name))) symlinkSync(realPath(name), path.join(bin, name));
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CCRC_ADDR;
  delete env.CCRC_MAIL_TOKEN_FILE;
  Object.assign(env, extraEnv, { HOME: home, PATH: bin });
  return spawnSync(BASH, [notifyShPath, 'test message'], { env, encoding: 'utf8' });
}

describe('deploy/notify.sh address resolution', () => {
  it('reads CCRC_HOST/CCRC_PORT from ~/.ccrc/ccrc.env when CCRC_ADDR is unset', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain('http://127.0.0.1:7788/api/notify');
  });

  it('SENDS NOTHING when neither CCRC_ADDR nor ccrc.env resolves an address (D-199)', () => {
    // This used to fall back to the reference fleet's own IP, "kept one
    // generation so a hook shipped ahead of the config file cannot go dark".
    // It outlived that generation and became a compiled-in address pointing at
    // one operator's box — so on anyone else's install it was a POST of their
    // fleet's activity to a stranger's machine. Notify is best-effort by
    // contract: no address means no send.
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    const r = runNotify(home);
    expect(curlCalls(home), 'a guessed address is worse than silence').toEqual([]);
    // Silence and failure are different answers. ccd fires this hook as
    // `>/dev/null 2>&1`, so a nonzero status is the ONLY way the caller could
    // tell them apart — and `|| exit 1` here would make every unconfigured box
    // look like a broken one.
    expect(r.status, r.stderr).toBe(0);
  });

  it('a scheme-carrying CCRC_ADDR is used verbatim — the proxied-box case (D-199)', () => {
    // A box behind a reverse proxy binds the server to LOOPBACK, which is the
    // point of the proxy; `host:port` from another machine then reaches
    // nothing. Measured on the reference fleet 2026-08-23: after the server
    // moved to a loopback bind, this hook's address answered 000 from the
    // fleet host and every swap notice had been silently dropped, because the
    // curl ends `|| true`.
    const home = mkTmp('ccrc-notify-addr-scheme-');
    stubCurl(home);
    runNotify(home, { CCRC_ADDR: 'https://mybox.example.com' });
    expect(curlCalls(home).join('\n')).toContain('https://mybox.example.com/api/notify');
  });

  it('a trailing slash on a scheme-carrying address does not double the path', () => {
    const home = mkTmp('ccrc-notify-addr-slash-');
    stubCurl(home);
    runNotify(home, { CCRC_ADDR: 'https://mybox.example.com/' });
    expect(curlCalls(home).join('\n')).toContain('https://mybox.example.com/api/notify');
    expect(curlCalls(home).join('\n')).not.toContain('//api/notify');
  });

  it("reads CCRC_SERVER_URL from agent.env — the fleet box's own answer, already provisioned", () => {
    // THE HOOK RUNS ON THE FLEET BOX, which by design has no ccrc.env at all
    // (_check_config's D-86 note: its absence there is correct, not a gap). So
    // the HOST+PORT tier can never fire there — and it could not express a
    // proxied server anyway, since `host:port` cannot name a front door. The
    // fleet box already learned the server's address once, in agent.env, for
    // the coordination skills (#89). Reusing it means nothing new to provision.
    const home = mkTmp('ccrc-notify-agentenv-');
    stubCurl(home);
    writeAgentEnv(home, 'CCRC_SERVER_URL=https://mybox.example.com\n');
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain('https://mybox.example.com/api/notify');
  });

  it.each([
    ['wss://', 'wss://mybox.example.com', 'https://mybox.example.com/api/notify'],
    ['ws://', 'ws://203.0.113.7:7788', 'http://203.0.113.7:7788/api/notify'],
  ])('maps %s to http(s), the way the skills do', (_l, url, want) => {
    // CCRC_SERVER_URL is documented as accepting ws://, wss://, http:// and
    // https://. A hook that POSTed to a ws:// URL would fail silently.
    const home = mkTmp('ccrc-notify-wsmap-');
    stubCurl(home);
    writeAgentEnv(home, `CCRC_SERVER_URL=${url}\n`);
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain(want);
  });

  it('CCRC_ADDR in the ENV still beats agent.env', () => {
    const home = mkTmp('ccrc-notify-addr-prec-');
    stubCurl(home);
    writeAgentEnv(home, 'CCRC_SERVER_URL=https://from-file.example.com\n');
    runNotify(home, { CCRC_ADDR: 'https://from-env.example.com' });
    expect(curlCalls(home).join('\n')).toContain('https://from-env.example.com/api/notify');
  });

  it('a bare host:port keeps the plain-http shape it always had', () => {
    const home = mkTmp('ccrc-notify-addr-bare-');
    stubCurl(home);
    runNotify(home, { CCRC_ADDR: '203.0.113.7:7788' });
    expect(curlCalls(home).join('\n')).toContain('http://203.0.113.7:7788/api/notify');
  });

  it('CCRC_ADDR wins over ccrc.env when both are present', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    runNotify(home, { CCRC_ADDR: 'other.invalid:9999' });
    const calls = curlCalls(home).join('\n');
    expect(calls).toContain('http://other.invalid:9999/api/notify');
    expect(calls).not.toContain('127.0.0.1:7788');
  });

  it("the LAST CCRC_HOST/CCRC_PORT assignment wins — matches _box_env_value's " +
     'tail -n1 rule (ccd/ccrc:355-380)', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=stale.invalid\nCCRC_PORT=1111\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    runNotify(home);
    const calls = curlCalls(home).join('\n');
    expect(calls).toContain('http://127.0.0.1:7788/api/notify');
    expect(calls).not.toContain('stale.invalid');
  });

  it('an incomplete ccrc.env (host with no port) does not half-apply — and sends nothing', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\n');
    const r = runNotify(home);
    expect(curlCalls(home)).toEqual([]);
    expect(r.status, r.stderr).toBe(0);
  });

  it('an unreadable ccrc.env is treated as absent, not fatal — notify.sh must never throw', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    // No ccrc.env at all is the "unreadable" case `[ -r … ]` also covers —
    // pinned separately from the "neither present" test above so a future
    // change to the readability guard (e.g. swapping `-r` for `-f`) has its
    // own failing case rather than sharing one assertion with a different
    // intent.
    rmSync(path.join(home, '.ccrc'), { recursive: true, force: true });
    const r = runNotify(home);
    expect(curlCalls(home)).toEqual([]);
    expect(r.status, r.stderr).toBe(0);
  });

  it('an agent.env with no CCRC_SERVER_URL falls THROUGH to ccrc.env, not to silence', () => {
    // The pre-`ccrc install --role fleet` shape: the file exists but predates
    // the key. An empty value read out of a present file must not look like a
    // resolved address, and must not short-circuit the tier below it.
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeAgentEnv(home, '# provisioned before CCRC_SERVER_URL existed\nCCRC_AGENT_PORT=7789\n');
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    const r = runNotify(home);
    expect(curlCalls(home).join('\n'),
      'a keyless agent.env swallowed the ccrc.env tier below it')
      .toContain('http://127.0.0.1:7788/api/notify');
    expect(r.status, r.stderr).toBe(0);
  });

  it('an agent.env with an EMPTY CCRC_SERVER_URL is silence, not a malformed URL', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeAgentEnv(home, 'CCRC_SERVER_URL=\n');
    const r = runNotify(home);
    expect(curlCalls(home), 'an empty value must not become http:// with no host').toEqual([]);
    expect(r.status, r.stderr).toBe(0);
  });
});
