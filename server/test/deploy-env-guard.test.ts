// ── deploy.sh's two config guards, exercised against the SHIPPED text ──────
//
// Both exist because of one incident (2026-08-22). `deploy/ccrc.env` is
// local and gitignored — one copy per workstation, shared with nobody — and a
// deploy from a checkout whose copy predated the box being armed shipped a
// file with no `CCRC_AUTH` line. scp does not merge: the key did not change
// value, it ceased to exist, and a publicly-reachable box came back up
// unauthenticated for 3m17s. Nothing noticed. The unit was active, the
// process was stable, and the sha gate at the end of the deploy passed —
// because the same bad file had also re-bound the server onto the very
// address that gate probes.
//
// deploy.sh cannot be sourced (it IS a deploy, top to bottom), so these tests
// EXTRACT the two functions out of the shipped file and run them against
// stubs. The extraction is the point: there is no second copy of the logic to
// drift, and deleting or renaming a function reds this file rather than
// quietly skipping it.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEPLOY_SH = join(REPO, 'deploy', 'deploy.sh');

/** The named function's own text, lifted out of deploy.sh. Brace-counted from
 *  the `name() {` line, so a function that grows a nested block still comes
 *  out whole — and a function that is GONE throws here rather than silently
 *  testing nothing. */
function extractFn(name: string): string {
  const src = readFileSync(DEPLOY_SH, 'utf8').split('\n');
  const start = src.findIndex((l) => l.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`deploy.sh no longer defines ${name}() — the guard it holds is gone`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    for (const ch of src[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) return src.slice(start, i + 1).join('\n');
  }
  throw new Error(`unbalanced braces reading ${name}() out of deploy.sh`);
}

interface Run { code: number; out: string }

/** Run a snippet with the extracted function(s) in scope. `ssh` is a stub the
 *  test writes, so "the box" is whatever the test says it is. */
function withFns(fns: string[], home: string, script: string, env: Record<string, string> = {}): Run {
  const body = [
    'set -uo pipefail',
    `BOX="fixture@box"`,
    `SSH=("${join(home, 'ssh')}")`,
    `SCP=("${join(home, 'scp')}")`,
    ...fns.map((f) => extractFn(f)),
    script,
  ].join('\n');
  const r = spawnSync('bash', ['-c', body], {
    encoding: 'utf8', cwd: home, env: { ...process.env, ...env, HOME: home, LC_ALL: 'C' },
  });
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** A stub `ssh` that answers whatever the test put in `box-env` — i.e. the
 *  file the remote `sed` would have read — and records that it was asked. */
function stubSsh(home: string, remoteFiles: Record<string, string>): void {
  mkdirSync(join(home, 'boxfs', '.ccrc'), { recursive: true });
  for (const [name, text] of Object.entries(remoteFiles)) {
    writeFileSync(join(home, 'boxfs', '.ccrc', name), text);
  }
  // The stub re-runs the remote command locally with HOME pointed at boxfs, so
  // the very `sed` deploy.sh sends is the `sed` that runs and `~` resolves the
  // way it would on the box — a change to that command is exercised, not
  // mocked away. Both call shapes are modelled: an argv command, and a script
  // fed on stdin (`bash -s`), which is how the health derivation avoids a nest
  // of escapes.
  const p = join(home, 'ssh');
  writeFileSync(p, [
    '#!/bin/bash',
    'shift',            // the box argument
    `export HOME=${join(home, 'boxfs')}`,
    'if [ "$1" = "bash" ] && [ "$2" = "-s" ]; then exec bash -s; fi',
    'exec bash -c "$*"',
  ].join('\n') + '\n');
  chmodSync(p, 0o755);
}

// D-168.
describe('deploy.sh: env_drop_guard — a deploy may change a value, never un-set one', () => {
  it('refuses when the local file would drop a key the box currently sets', () => {
    const home = mkTmp('deploy-drop-refuse-');
    stubSsh(home, { 'ccrc.env': 'CCRC_HOST=127.0.0.1\nCCRC_AUTH=on\nCCRC_PORT=7788\n' });
    writeFileSync(join(home, 'local.env'), 'CCRC_HOST=10.0.0.5\nCCRC_PORT=7788\n');
    const r = withFns(['env_drop_guard'], home,
      `env_drop_guard "${join(home, 'local.env')}" '~/.ccrc/ccrc.env'`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('CCRC_AUTH');
    expect(r.out).toContain('Nothing was shipped');
  });

  it('NEVER prints a value — these files are the tokens', () => {
    // A guard that explained itself by quoting the line would put secrets in
    // every CI log that ever ran a deploy.
    const home = mkTmp('deploy-drop-secret-');
    const secret = 'fixture-token-must-never-be-printed-4f1c';
    stubSsh(home, { 'ccrc.env': `CCRC_AGENT_TOKEN=${secret}\nCCRC_PORT=7788\n` });
    writeFileSync(join(home, 'local.env'), 'CCRC_PORT=7788\n');
    const r = withFns(['env_drop_guard'], home,
      `env_drop_guard "${join(home, 'local.env')}" '~/.ccrc/ccrc.env'`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('CCRC_AGENT_TOKEN');    // the NAME is the whole report
    expect(r.out).not.toContain(secret);
  });

  it('allows a CHANGED value — shipping config is what this file is for', () => {
    const home = mkTmp('deploy-drop-change-');
    stubSsh(home, { 'ccrc.env': 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n' });
    writeFileSync(join(home, 'local.env'), 'CCRC_HOST=0.0.0.0\nCCRC_PORT=9999\n');
    const r = withFns(['env_drop_guard'], home,
      `env_drop_guard "${join(home, 'local.env')}" '~/.ccrc/ccrc.env'; echo "rc=$?"`);
    expect(r.out).toContain('rc=0');
  });

  it('allows a first deploy — no file on the box is not a drop', () => {
    const home = mkTmp('deploy-drop-first-');
    stubSsh(home, {});
    writeFileSync(join(home, 'local.env'), 'CCRC_PORT=7788\n');
    const r = withFns(['env_drop_guard'], home,
      `env_drop_guard "${join(home, 'local.env')}" '~/.ccrc/ccrc.env'; echo "rc=$?"`);
    expect(r.out).toContain('rc=0');
  });

  it('reads through comments and indentation, not just bare lines', () => {
    const home = mkTmp('deploy-drop-comments-');
    stubSsh(home, { 'ccrc.env': '# a comment\n  CCRC_AUTH=on\n#CCRC_HOST=commented-out\n' });
    writeFileSync(join(home, 'local.env'), 'CCRC_PORT=7788\n');
    const r = withFns(['env_drop_guard'], home,
      `env_drop_guard "${join(home, 'local.env')}" '~/.ccrc/ccrc.env'`);
    expect(r.code).toBe(1);
    expect(r.out).toContain('CCRC_AUTH');
    // A commented-out key is not a key the box sets, so it is not a drop.
    expect(r.out).not.toContain('CCRC_HOST');
  });
});

describe('deploy.sh: derive_health_urls — the gate probes the box, not this workstation', () => {
  const derive = (home: string): Run => withFns(['derive_health_urls'], home,
    'derive_health_urls; echo "BOX_HEALTH_URL=$BOX_HEALTH_URL"; echo "HEALTH_URL=$HEALTH_URL"');

  it('an EXPOSED box is probed at its public origin — the door its users use', () => {
    // The old default probed tailnet-IP:7788, which an exposed box (bound to
    // loopback behind caddy) does not answer at all — and which the outage
    // deploy DID answer, because the same broken config had re-bound the
    // server onto it. The gate agreed with the breakage it shipped.
    const home = mkTmp('deploy-health-exposed-');
    stubSsh(home, {
      'ccrc.env': 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n',
      'exposure.env': 'CCRC_ORIGIN=https://fixture.duckdns.org\nCCRC_RP_ID=fixture.duckdns.org\n',
    });
    const r = derive(home);
    expect(r.out).toContain('HEALTH_URL=https://fixture.duckdns.org/health');
  });

  it('the IN-BOX probe stays local — it asks "is Fastify listening", not "does NAT hairpin"', () => {
    const home = mkTmp('deploy-health-inbox-');
    stubSsh(home, {
      'ccrc.env': 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n',
      'exposure.env': 'CCRC_ORIGIN=https://fixture.duckdns.org\n',
    });
    expect(derive(home).out).toContain('BOX_HEALTH_URL=http://127.0.0.1:7788/health');
  });

  it('an UNEXPOSED box keeps the shape this gate has always had', () => {
    const home = mkTmp('deploy-health-plain-');
    stubSsh(home, { 'ccrc.env': 'CCRC_HOST=203.0.113.7\nCCRC_PORT=7788\n' });
    const r = derive(home);
    expect(r.out).toContain('HEALTH_URL=http://box:7788/health');
    // …and in-box it asks the address the server really binds, not loopback.
    expect(r.out).toContain('BOX_HEALTH_URL=http://203.0.113.7:7788/health');
  });

  it('reads CCRC_HOST the way systemd does — exposure.env is read second and wins', () => {
    const home = mkTmp('deploy-health-precedence-');
    stubSsh(home, {
      'ccrc.env': 'CCRC_HOST=203.0.113.7\nCCRC_PORT=7788\n',
      'exposure.env': 'CCRC_HOST=127.0.0.1\nCCRC_ORIGIN=https://fixture.duckdns.org\n',
    });
    expect(derive(home).out).toContain('BOX_HEALTH_URL=http://127.0.0.1:7788/health');
  });

  it('a wildcard bind is probed on loopback — 0.0.0.0 is not an address to curl', () => {
    const home = mkTmp('deploy-health-wildcard-');
    stubSsh(home, { 'ccrc.env': 'CCRC_HOST=0.0.0.0\nCCRC_PORT=7788\n' });
    expect(derive(home).out).toContain('BOX_HEALTH_URL=http://127.0.0.1:7788/health');
  });

  it('a box with no ccrc.env at all still yields a usable URL, never http://:/health', () => {
    const home = mkTmp('deploy-health-noenv-');
    stubSsh(home, {});
    const r = derive(home);
    expect(r.out).toContain('BOX_HEALTH_URL=http://127.0.0.1:7788/health');
    expect(r.out).not.toContain('//:');
  });

  it('a trailing slash on the origin does not produce a doubled path', () => {
    const home = mkTmp('deploy-health-slash-');
    stubSsh(home, { 'exposure.env': 'CCRC_ORIGIN=https://fixture.duckdns.org/\n' });
    expect(derive(home).out).toContain('HEALTH_URL=https://fixture.duckdns.org/health');
  });
});


describe('deploy.sh: the guards are WIRED IN, not merely defined', () => {
  // Everything above extracts a function and proves it behaves. All of it
  // would keep passing if someone kept the function and deleted the CALL —
  // which is the whole of the protection. So the wiring is asserted too, on
  // the shipped text.
  const src = (): string => readFileSync(DEPLOY_SH, 'utf8');

  it('ship_env runs the drop guard BEFORE the scp, not after', () => {
    const body = extractFn('ship_env');
    const guardAt = body.indexOf('env_drop_guard');
    const scpAt = body.indexOf('SCP[@]');
    expect(guardAt, 'ship_env no longer calls env_drop_guard').toBeGreaterThan(-1);
    expect(scpAt).toBeGreaterThan(-1);
    expect(guardAt, 'the guard runs after the file was already copied')
      .toBeLessThan(scpAt);
  });

  it('the two health probes are used at their two different sites', () => {
    const text = src();
    // The in-box curl travels inside the ssh command…
    expect(text).toMatch(/&& curl -fsS '"\$BOX_HEALTH_URL/);
    // …and the sha assertion runs here, against the front door.
    expect(text).toContain('health_out="$(curl -fsS "$HEALTH_URL")"');
  });

  it('CCRC_HEALTH_URL still overrides the derived front door', () => {
    // A box fronted by something ccrc did not configure keeps its escape
    // hatch — the derivation must not have quietly taken it away.
    expect(src()).toContain('[ -z "${CCRC_HEALTH_URL:-}" ] || HEALTH_URL="$CCRC_HEALTH_URL"');
  });
});

// ── the two readers of one file must not disagree ─────────────────────────
// `derive_health_urls` reads ~/.ccrc/exposure.env, which makes deploy.sh a
// SECOND reader of a file `ccd/ccrc`'s `_box_env_value` already reads —
// single-definition.test.ts names it as a holder for exactly that reason. Two
// parsers over one file is the shape this codebase treats as a defect waiting
// to happen (`ship_secret`'s own note: equal bytes are not enough, the
// readers must extract equally). So they are fed the same awkward lines and
// required to agree.
describe('deploy.sh and ccrc read an env file the same way', () => {
  const CCRC = join(REPO, 'ccd', 'ccrc');

  /** ccrc's own reader, called directly out of the shipped file. */
  function viaCcrc(file: string, key: string): string {
    const src = readFileSync(CCRC, 'utf8').split('\n');
    const start = src.findIndex((l) => l.startsWith('_box_env_value() {'));
    let depth = 0, end = start;
    for (let i = start; i < src.length; i++) {
      for (const ch of src[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0) { end = i; break; }
    }
    const r = spawnSync('bash', ['-c',
      `${src.slice(start, end + 1).join('\n')}\n_box_env_value "$1" "$2"`, '_', file, key],
      { encoding: 'utf8' });
    return (r.stdout ?? '').replace(/\n$/, '');
  }

  /** deploy.sh's remote snippet, run locally over the same file. */
  function viaDeploy(home: string, key: string): string {
    const r = withFns(['derive_health_urls'], home,
      `derive_health_urls; echo "BOX_HEALTH_URL=$BOX_HEALTH_URL"; echo "HEALTH_URL=$HEALTH_URL"`);
    const m = key === 'CCRC_ORIGIN'
      ? r.out.match(/^HEALTH_URL=(.*)$/m)
      : r.out.match(/^BOX_HEALTH_URL=(.*)$/m);
    return m ? m[1] : '';
  }

  it.each([
    ['a plain line',            'CCRC_ORIGIN=https://a.example.com\n'],
    ['leading spaces',          '   CCRC_ORIGIN=https://a.example.com\n'],
    ['a leading tab',           '\tCCRC_ORIGIN=https://a.example.com\n'],
    ['a trailing CR',           'CCRC_ORIGIN=https://a.example.com\r\n'],
    ['double quotes',           'CCRC_ORIGIN="https://a.example.com"\n'],
    ['single quotes',           "CCRC_ORIGIN='https://a.example.com'\n"],
    ['a duplicate key — last wins',
      'CCRC_ORIGIN=https://old.example.com\nCCRC_ORIGIN=https://a.example.com\n'],
    ['a commented line above',  '#CCRC_ORIGIN=https://commented.example.com\nCCRC_ORIGIN=https://a.example.com\n'],
  ])('agree on %s', (_what, text) => {
    const home = mkTmp('deploy-reader-agree-');
    stubSsh(home, { 'exposure.env': text });
    const file = join(home, 'boxfs', '.ccrc', 'exposure.env');
    expect(viaCcrc(file, 'CCRC_ORIGIN')).toBe('https://a.example.com');
    expect(viaDeploy(home, 'CCRC_ORIGIN')).toBe('https://a.example.com/health');
  });

  it('agree that `export KEY=` is NOT a value — systemd does not accept it either', () => {
    const home = mkTmp('deploy-reader-export-');
    stubSsh(home, { 'exposure.env': 'export CCRC_ORIGIN=https://a.example.com\n' });
    const file = join(home, 'boxfs', '.ccrc', 'exposure.env');
    expect(viaCcrc(file, 'CCRC_ORIGIN')).toBe('');
    // …and deploy falls back to the box address rather than inventing an
    // origin — a false alarm at worst, never a wrong URL reported as right.
    expect(viaDeploy(home, 'CCRC_ORIGIN')).toBe('http://box:7788/health');
  });
});

// ── the roster a stranger's first deploy seeds, permanently (D-197) ─────────
//
// `deploy.sh` used to default `CCRC_ACCOUNTS_JSON` to
// `deploy/accounts.migration.json` — the REFERENCE FLEET's five accounts,
// carrying that operator's own labels. Seeding is first-install-only and
// never overwritten (stage-2a §5: `~/.ccrc/accounts.json` is user-owned
// config), so anyone else's very first deploy wrote five accounts they had
// never heard of onto their box PERMANENTLY, removable only by hand over ssh.
//
// The cure that shipped (PR #96) keeps a default but makes it NEUTRAL:
// `deploy/accounts.default.json`, a single upstream `claude`. That is the
// better answer — `bash deploy/deploy.sh` works on a fresh box without
// ceremony — but it moves the whole hazard into one file's CONTENTS. Nothing
// stopped that file being edited back into somebody's real fleet, at which
// point the original defect returns with no diff to deploy.sh to notice it.
// So the assertions below pin BOTH halves: which file may be the default, and
// what that file is allowed to contain.
describe('deploy.sh: the seeded roster is neutral, or there is none', () => {
  const src = (): string => readFileSync(DEPLOY_SH, 'utf8');

  /** The default side of `ACCOUNTS_JSON="${CCRC_ACCOUNTS_JSON:-…}"`, or null
   *  if deploy.sh no longer resolves the variable at all. */
  function seedDefault(): string | null {
    const m = /^ACCOUNTS_JSON="\$\{CCRC_ACCOUNTS_JSON:-([^}]*)\}"$/m.exec(src());
    return m ? m[1] : null;
  }

  it('resolves CCRC_ACCOUNTS_JSON to either nothing or the neutral roster', () => {
    const d = seedDefault();
    expect(d, 'deploy.sh no longer resolves CCRC_ACCOUNTS_JSON — this guard is testing nothing').not.toBeNull();
    expect(['', 'deploy/accounts.default.json']).toContain(d);
  });

  it('never falls back to a roster belonging to somebody', () => {
    // The specific regression, by name, wherever it might be spelled: any
    // expression that resolves the migration roster when nothing was named.
    expect(src()).not.toMatch(/CCRC_ACCOUNTS_JSON:-[^}]*migration/);
  });

  it('the default roster is one upstream account — not a fleet', () => {
    const d = seedDefault();
    if (d === '') return; // no default: nothing is seeded, nothing to constrain
    const roster = JSON.parse(readFileSync(join(REPO, d!), 'utf8')) as {
      accounts: { id: string; exec: { kind: string } }[];
    };
    // Seeding is permanent. A default that grows past one generic account is
    // one operator's fleet arriving on a stranger's box, which is the whole
    // defect — restated as data instead of as a shell default.
    expect(roster.accounts).toHaveLength(1);
    expect(roster.accounts[0].id).toBe('claude');
    expect(roster.accounts[0].exec.kind).toBe('upstream');
  });
});
