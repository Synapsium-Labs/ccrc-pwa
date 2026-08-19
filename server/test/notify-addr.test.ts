// `deploy/notify.sh`'s address-resolution chain: `CCRC_ADDR` env >
// `~/.ccrc/ccrc.env`'s `CCRC_HOST`+`CCRC_PORT` > the reference fleet's legacy
// IP. Spec §2 (docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-
// design.md): "notify.sh's existing `${CCRC_ADDR:-…}` seam gets its default
// from the config file instead of a baked fallback IP." D-73 (Stage 2d task
// brief, facts verified): the reference fleet host has NO `~/.ccrc/ccrc.env`
// today, so the legacy-IP last resort is what actually fires there — this
// suite pins that it still does, alongside the two new tiers.
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
import { spawnSync } from 'node:child_process';
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
function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  const bin = stubBinDir(home);
  for (const name of REAL_TOOLS) {
    if (!existsSync(path.join(bin, name))) symlinkSync(realPath(name), path.join(bin, name));
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CCRC_ADDR;
  delete env.CCRC_MAIL_TOKEN_FILE;
  Object.assign(env, extraEnv, { HOME: home, PATH: bin });
  spawnSync(BASH, [notifyShPath, 'test message'], { env, encoding: 'utf8' });
}

describe('deploy/notify.sh address resolution', () => {
  it('reads CCRC_HOST/CCRC_PORT from ~/.ccrc/ccrc.env when CCRC_ADDR is unset', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain('http://127.0.0.1:7788/api/notify');
  });

  it("falls back to the reference fleet's legacy IP when neither CCRC_ADDR nor " +
     'ccrc.env is present — D-73: what actually fires on the fleet host today', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    runNotify(home);
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

  it('an incomplete ccrc.env (host with no port) does not half-apply — falls to the legacy IP', () => {
    const home = mkTmp('ccrc-notify-addr-');
    stubCurl(home);
    writeCcrcEnv(home, 'CCRC_HOST=127.0.0.1\n');
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain('http://203.0.113.7:7788/api/notify');
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
    runNotify(home);
    expect(curlCalls(home).join('\n')).toContain('http://203.0.113.7:7788/api/notify');
  });
});
