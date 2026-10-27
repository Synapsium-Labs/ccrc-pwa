// `ccrc doctor`, part: exposure (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, utimesSync, appendFileSync, statSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { SCRATCH_SLUGS, PERSISTENT_SLUGS } from './scratchSlugs.js';
import { describeLinux, itLinux, itDarwin, IS_DARWIN } from './platformFixtures.js';
import { fixClock, fixedNow } from './fixedClock.js';
import { writeShippedTimer } from './shippedTimers.js';
import { DOCS_INDEX_READY, DOCS_INDEX_UNREADABLE, DOCS_HELPER_UNAVAILABLE_MISSING_LINE, docsIndexStubScript } from './docsIndexFixtures.js';
import { installDoctorHooks, here, REPO, CCRC_SRC, CHECKS_SRC, BASH, Result, installCcrc, stub, stubBin, unstub, linkReal, stubNodeModelsExit, stubNodeModelsWeirdStatus, RosterEntry, writeRoster, entry, writeWrapper, shq, HEALTHY_SHA, curlCalls, writeCcrcEnv, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, EXPOSED_HOST, writeExposureEnv, containedPath, doctorEnv, plantScope, sysCaddyfile, DOCTOR_DEADLINE_BIN, runDoctorBounded, runDoctor, registrationHooks, plantHookRegistration, plantSpoolDir, healthy, healthyCodexBox, broken, tableNames, lineFor, anyVerdictFor, HEALTHY_SKIPS, expectUndecided, skipLineFor, remedyFor, noRunnerBugLine, plantSession } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

/** A lane whose config dir carries a settings.json env block — the shape an
 *  api-key lane is provisioned with, API key field deliberately empty. */
function writeSettingsEnv(home: string, suffix: string, env: Record<string, string>): void {
  const d = join(home, suffix);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ env }, null, 2));
}

// ── models: is each lane's model catalogue actually being refreshed? ──────
// Two DIFFERENT files per lane (census/C-contract.md §0, the premise
// correction): `<id>.classes.json` is the REGISTRY — operator-owned, and it
// never carries `fetchedAt`/`stale`/`lastError`. Those three live ONLY in
// `<id>.json`, the CATALOGUE, written by `ccd/ccrc-models-probe`. A fixture
// that put them in the registry file would be testing a shape the real probe
// never produces.

/** `~/.ccrc/models/<id>.classes.json` — presence is the whole question the
 *  check asks of this file, so its shape barely matters; written as an
 *  UNSEEDED-shaped registry (every class null, no `effort` block) but NOT
 *  byte-for-byte either of `server/test/fixtures/modelCases.ts`'s named
 *  fixtures — measured: this writes `probe: 'codex'` and
 *  `discovery: 'catalogue'`, where that file's `UNSEEDED` has
 *  `probe: 'openrouter'` and `discovery: []` (R5, fix round 2: naming a
 *  fixture this function does not actually match is the same defect R2
 *  found against `SEEDED`, just against a different fixture — so this
 *  docstring now describes what the function writes instead of citing one). */
function writeModelRegistry(home: string, id: string): void {
  mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), JSON.stringify({
    probe: 'codex',
    classes: { haiku: null, sonnet: null, opus: null, fable: null },
    subagent: 'sonnet',
    discovery: 'catalogue',
  }));
}

/** `~/.ccrc/models/<id>.json` — the CATALOGUE, the only file `fetchedAt`,
 *  `stale` and `lastError` live in. `fetchedAt` defaults to now, in UNIX
 *  SECONDS (`ccd/ccrc-models-probe`'s `_normalise`, `int(time.time())`) — never the
 *  millisecond stamps the server side uses elsewhere. */
function writeModelCatalogue(home: string, id: string, o: {
  fetchedAt?: number; stale?: boolean; lastError?: string;
} = {}): void {
  mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  const body: Record<string, unknown> = {
    probe: 'codex',
    fetchedAt: o.fetchedAt ?? Math.floor(Date.now() / 1000),
    stale: o.stale ?? false,
    models: [],
  };
  if (o.lastError !== undefined) body['lastError'] = o.lastError;
  writeFileSync(join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(body));
}

const nowS = (): number => Math.floor(Date.now() / 1000);

// ── memory ───────────────────────────────────────────────────────────────
//
// Task 4 of 2026-09-09-project-scoped-memory. `_check_memory` is the detector:
// the spec's whole premise is that a fork is currently SILENT, so this check's
// entire job is to make one loud. THREE conditions — "forked" (a pair has
// already diverged; the remedy is `ccrc memory --apply`), "unreachable" (a
// home the session hook can never wire up, so it *will* fork on first use;
// the remedy is roster/settings.json) and, since fix round 2, "unmeasured"
// (settings.json exists but could not be READ, a WARN distinct from both
// hard FAILs) — get different bodies and different remedies on purpose (task
// brief, "Why three conditions and not two"; R22/R23 add the third).
//
// R33 (controller ruling, whole-branch review): "forked" is a WARN, not a
// FAIL. `cmd_install` ends with `cmd_doctor`, whose non-zero exit on any FAIL
// hard-dies `ccrc update` before its supervisor sweep ever runs, and `forked`
// FAILs by construction on every multi-home box until the operator runs the
// one irreversible `ccrc memory --apply` — so an unrelated verb was coercing
// that migration. "unreachable" stays a FAIL: it names a misconfiguration,
// not an expected pre-migration state. The tests below were all written
// against the pre-R33 FAIL and are updated in place, not reworded around it —
// see `_check_memory`'s own comments in ccd/ccrc-doctor-checks for the fuller
// reasoning.
//
// `healthy()` plants no `.claude*` directory at all, so these tests build
// agent homes by hand under each fixture's own `home`.
//
// EVERY FIXTURE HOME BELOW THAT PARTICIPATES IN A FORKED/CONVERGED ASSERTION
// ALSO GETS A `settings.json` NAMING session-hook.sh (`HOOKED_SETTINGS`) —
// fix round 2, R22: since a home with `projects/` and no settings.json at
// all is now (correctly) ITS OWN unreachable finding, a fixture that means
// to test only forked/converged would otherwise also trip unreachable on the
// same home and muddy what a failing assertion is pinning.
// It carries the WHOLE shipped registration (`registrationHooks()`, the installer's own event set), not one event:
// `delegation-hooks` measures every rostered home too, and a fixture that means to test forked/converged memory must
// not also trip it.
const HOOKED_SETTINGS = JSON.stringify({ hooks: registrationHooks() });

// ── docs (spec 2026-10-01 §7.2; mutation rows M7.4 and M7.6) ──────────────
//
// `_check_docs` runs `$HOME/.local/bin/ccd docs-index --all` — the file the
// agent execs — and classifies its one line. Every case below replaces that
// file and reads one verdict. The canned answers come from
// `docsIndexFixtures.ts`, the module `ccd-docs-index.test.ts` holds the REAL
// verb to, so a PASS here is a PASS on the bytes the real ccd prints. M7.4's
// last clause (the timeout default equals the server's runner budget) is
// Docs W2's `docs-budget.test.ts`, not this file's.

/** `$HOME/.local/bin/ccd`: where `healthy()` plants the canned stub. */
function docsCcd(home: string): string {
  return join(home, '.local', 'bin', 'ccd');
}

/** Replaces the fixture's ccd. `writeFileSync`'s `mode` applies only when it
 *  CREATES the file, and `healthy()` already did, so the mode is set again. */
function plantDocsCcd(home: string, script: string, mode = 0o755): void {
  writeFileSync(docsCcd(home), script, { mode });
  chmodSync(docsCcd(home), mode);
}

/** The `docs` verdict line and the line after it (its remedy, when it has
 *  one). Two empty strings when doctor printed no `docs` line at all. */
function docsVerdict(out: string): { line: string; next: string } {
  const lines = out.split('\n');
  const i = lines.findIndex((l) => /^(PASS|WARN|FAIL|SKIP) docs: /.test(l));
  return i < 0 ? { line: '', next: '' } : { line: lines[i] ?? '', next: lines[i + 1] ?? '' };
}

/** What the check counts, computed from the canned answer rather than
 *  re-typed: every row, the `ready` rows, the `repo-unreadable` rows. */
function docsCounts(o: typeof DOCS_INDEX_READY): { n: number; k: number; u: number } {
  return {
    n: o.projects.length,
    k: o.projects.filter((p) => p.state === 'ready').length,
    u: o.projects.filter((p) => p.state === 'repo-unreadable').length,
  };
}

describe('ccrc doctor: name', () => {
  it('SKIPs without exposure — there is no public name to resolve', () => {
    const home = healthy('ccrc-doctor-name-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'name'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) name: /m);
  });

  it('SKIPs for a BYO domain — that DNS is the operator\'s, and no ccrc timer maintains it', () => {
    const home = healthy('ccrc-doctor-name-byo-');
    writeExposureEnv(home, { duckdns: false, origin: 'https://box.example.com', rpid: 'box.example.com' });
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'name');
    expect(l, r.stdout).toBeTruthy();
    expect(l).toContain('BYO');
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) name: /m);
  });

  it('SKIPs on mode ip in its own words — a bare address HAS no name, and "BYO domain" would be a lie', () => {
    // Stage 5, S10: without its own arm this box lands in the BYO skip above,
    // whose sentence asserts a domain this box deliberately does not have.
    const home = healthy('ccrc-doctor-name-ip-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'name');
    expect(l, r.stdout).toBeTruthy();
    expect(l).toContain('mode ip');
    expect(l).not.toContain('BYO');
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) name: /m);
  });

  it('PASSes when the name resolves to an address this box carries', () => {
    const home = healthy('ccrc-doctor-name-ok-');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'name');
    expect(l, r.stdout).toMatch(/^PASS name: /);
    expect(l).toContain('203.0.113.7');
  });

  it('WARNs — not FAILs — when the name resolves elsewhere while this box has its own public address (propagation)', () => {
    const home = healthy('ccrc-doctor-name-elsewhere-');
    writeFileSync(join(home, 'fixture-getent'), `198.51.100.9     ${EXPOSED_HOST}\n`);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN name: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('198.51.100.9');   // where it points
    expect(lines[i]).toContain('203.0.113.7');    // where this box is
    // THE PIN (spec D6): propagation lag is normal, so this must not harden
    // into a FAIL that pages an operator over DNS being DNS.
    expect(r.stdout).not.toMatch(/^FAIL name: /m);
    expect(r.code).toBe(0);
  });

  it('PASSes on resolution alone when this box\'s public address is not discoverable — NAT is not a mismatch', () => {
    const home = healthy('ccrc-doctor-name-nat-');
    writeFileSync(join(home, 'fixture-getent'), `198.51.100.9     ${EXPOSED_HOST}\n`);
    writeFileSync(join(home, 'fixture-host-ips'), '10.0.0.5 192.168.1.7\n');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'name'), r.stdout).toMatch(/^PASS name: /);
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) name: /m);
  });

  // Branch review, 2026-08-21: 100.64/10 is CGNAT (RFC 6598) — and
  // tailscale's own address range, i.e. THIS project's fleet topology.
  // Counting it as a global address sent every NAT'd tailscale box down the
  // mismatch-WARN arm ("propagation lag… this box's own public address is
  // 100.x") on every doctor run, forever — a false sentence about an address
  // that is not public.
  it('a CGNAT 100.64/10 address (tailscale) is NOT a public address — the NAT arm PASSes', () => {
    const home = healthy('ccrc-doctor-name-cgnat-');
    writeFileSync(join(home, 'fixture-getent'), `198.51.100.9     ${EXPOSED_HOST}\n`);
    writeFileSync(join(home, 'fixture-host-ips'), '100.100.1.1 10.0.0.5\n');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'name'), r.stdout).toMatch(/^PASS name: /);
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) name: /m);
  });

  it('FAILs naming the updater — in this box\'s vocabulary — when the name does not resolve', () => {
    const home = healthy('ccrc-doctor-name-unresolved-');
    rmSync(join(home, 'fixture-getent'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL name: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    // On macOS the .timer/.service pair collapses into one launchd job
    // (`_exp_ddns_units`), so the remedy names that job, not two systemd
    // units the box does not have.
    if (process.platform === 'darwin') {
      expect(lines[i + 1]).toMatch(/launchctl print gui\/\d+\/app\.ccrc\.ccrc-ddns/);
    } else {
      expect(lines[i + 1]).toContain('ccrc-ddns.timer');
    }
    expect(r.code).toBe(1);
  });
});


// ── caddyfile: the copy caddy actually reads (D-166) ──────────────────────
// `ccrc expose` writes ~/.ccrc/Caddyfile; caddy reads /etc/caddy/Caddyfile;
// the only thing joining them is an operator running one command. Both ways
// that goes wrong were measured on the live box, and both are silent — caddy
// stays `active`, the certificate stays valid, and the box serves the wrong
// config or none.
//
// Every assertion here reaches the system path through `sysCaddyfile(home)`,
// never a literal: the check and the fixture share ccrc's one constant, so a
// test cannot pass by measuring a path the shipped code does not use.

describe('ccrc doctor: caddyfile', () => {
  const failLine = (out: string): string | undefined =>
    out.split('\n').find((l) => l.startsWith('FAIL caddyfile: '));

  it('SKIPs a box with no exposure — no proxy is owed, so no copy is either', () => {
    const home = healthy('ccrc-doctor-caddyfile-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'caddyfile'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) caddyfile: /m);
  });

  it('PASSES when the ceremony was performed and the copy is current', () => {
    const home = healthy('ccrc-doctor-caddyfile-pass-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS caddyfile: /m);
  });

  it('FAILs when the copy was never made — caddy is serving something else, or nothing', () => {
    const home = healthy('ccrc-doctor-caddyfile-nocopy-');
    rmSync(sysCaddyfile(home), { force: true });
    const r = runDoctor(home);
    expect(failLine(r.stdout), r.stdout).toContain('is not there');
    expect(remedyFor(r.stdout, 'caddyfile')).toContain('install -m 0644');
    expect(r.code).toBe(1);
  });

  it('FAILs on a SYMLINK — the form ccrc itself printed until D-165, which never worked', () => {
    // The whole point: this is not a hypothetical misuse. The verb told
    // operators to do exactly this, and caddy — running as its own user,
    // unable to traverse a 0700 ~/.ccrc — could not read what the link
    // pointed at. A box in this state looks configured and is not.
    const home = healthy('ccrc-doctor-caddyfile-symlink-');
    rmSync(sysCaddyfile(home), { force: true });
    symlinkSync(join(home, '.ccrc', 'Caddyfile'), sysCaddyfile(home));
    const r = runDoctor(home);
    expect(failLine(r.stdout), r.stdout).toContain('SYMLINK');
    expect(remedyFor(r.stdout, 'caddyfile')).toContain('install -m 0644');
    expect(r.code).toBe(1);
  });

  it('FAILs on a DANGLING symlink too — and does not misreport it as never-copied', () => {
    // `-e` is false for a dangling link, so the absence arm would claim the
    // copy was never made and send the operator to re-run a copy that is not
    // the problem. `-L` is why that does not happen.
    const home = healthy('ccrc-doctor-caddyfile-dangling-');
    rmSync(sysCaddyfile(home), { force: true });
    symlinkSync(join(home, '.ccrc', 'nothing-here'), sysCaddyfile(home));
    const r = runDoctor(home);
    expect(failLine(r.stdout), r.stdout).toContain('SYMLINK');
    expect(failLine(r.stdout)).not.toContain('is not there');
  });

  it('FAILs when expose has run since the last copy — caddy still serves the previous origin', () => {
    const home = healthy('ccrc-doctor-caddyfile-stale-');
    // What `ccrc expose` does: rewrite the generated file. The copy is not
    // touched, so it is now older — the exact state a re-exposed box sits in
    // until someone re-runs step 2.
    const src = join(home, '.ccrc', 'Caddyfile');
    writeFileSync(src, 'otherbox.duckdns.org {\n    reverse_proxy 127.0.0.1:7788\n}\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(src, later, later);
    const r = runDoctor(home);
    expect(failLine(r.stdout), r.stdout).toContain('NEWER');
    expect(remedyFor(r.stdout, 'caddyfile')).toContain('reload caddy');
    expect(r.code).toBe(1);
  });

  it('does NOT fail when the copy is newer than its source — that is what a copy looks like', () => {
    const home = healthy('ccrc-doctor-caddyfile-fresh-');
    const later = new Date(Date.now() + 5000);
    utimesSync(sysCaddyfile(home), later, later);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS caddyfile: /m);
  });

  it('FAILs when exposure exists but ccrc generated no Caddyfile — half a run', () => {
    const home = healthy('ccrc-doctor-caddyfile-nosrc-');
    rmSync(join(home, '.ccrc', 'Caddyfile'), { force: true });
    const r = runDoctor(home);
    expect(failLine(r.stdout), r.stdout).toContain('is not there');
    expect(remedyFor(r.stdout, 'caddyfile')).toMatch(/ccrc expose/);
  });
});


// ── the bind that took the public name down (D-167) ───────────────────────
describe('ccrc doctor: exposure measures the server bind', () => {
  it('FAILs when an exposed box binds a non-loopback ADDRESS — every request becomes a 502', () => {
    // Measured 2026-08-22: a deploy shipped a workstation's stale tailnet IP,
    // caddy's 127.0.0.1 upstream refused, and the box served 502 for 3m17s
    // while the unit sat `active` and every other check passed.
    const home = healthy('ccrc-doctor-bind-502-');
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=203.0.113.7\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    const line = r.stdout.split('\n').find((l) => l.startsWith('FAIL exposure: '));
    expect(line, r.stdout).toContain('502');
    expect(line).toContain('CCRC_HOST=203.0.113.7');
    expect(remedyFor(r.stdout, 'exposure')).toContain('CCRC_HOST=127.0.0.1');
    expect(r.code).toBe(1);
  });

  it.each([['127.0.0.1'], ['0.0.0.0'], ['::1'], ['localhost']])(
    'accepts %s — loopback and the wildcards all answer caddy', (host) => {
      const home = healthy(`ccrc-doctor-bind-ok-${host.replace(/[^a-z0-9]/gi, '')}-`);
      writeCcrcEnv(home, `CCRC_FLEET=local\nCCRC_HOST=${host}\nCCRC_PORT=7788\n`);
      const r = runDoctor(home);
      expect(r.stdout, `${host} was reported as unreachable by caddy`)
        .not.toMatch(/^FAIL exposure: .*502/m);
    });

  it('reads the bind the way SYSTEMD does — exposure.env is the second EnvironmentFile and wins', () => {
    // A box bitten once reaches for the override. If this check read only
    // ccrc.env it would FAIL a box that is, in fact, correctly bound —
    // and send its operator to fix a value nothing uses.
    const home = healthy('ccrc-doctor-bind-precedence-');
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=203.0.113.7\nCCRC_PORT=7788\n');
    appendFileSync(join(home, '.ccrc', 'exposure.env'), 'CCRC_HOST=127.0.0.1\n');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/^FAIL exposure: .*502/m);
  });

  it('says nothing about a HOSTNAME bind — it would have to resolve it to know', () => {
    const home = healthy('ccrc-doctor-bind-hostname-');
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/^FAIL exposure: .*502/m);
  });
});


describe('ccrc doctor: provenance (design §11 — a fresh install ends green; D-139 stands over WARN)', () => {
  const record = (home: string, text: string): void => {
    writeFileSync(join(home, '.ccrc', 'installed'), text);
  };

  it('PASSes a verified install — a one-line completed-install record', () => {
    // healthy() plants exactly this: the record `ccrc update` leaves after
    // verify-provenance.mjs accepted the bundle (D-3117: line 2 absent).
    const home = healthy('ccrc-doctor-prov-ok-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS provenance: the completed-install record carries no unsigned mark$/m);
    noRunnerBugLine(r.stdout, 'provenance');
    expect(r.code).toBe(0);
  });

  it('PASSes — never WARNs or FAILs — when line 2 reads unsigned: coordinator ruling 2026-09-23 over operator ruling D-139 ("a fresh install ends green")', () => {
    const home = healthy('ccrc-doctor-prov-unsigned-');
    record(home, `${HEALTHY_SHA}\nunsigned\n`);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS provenance: unsigned — this install was not verified by ccrc update \(a checkout install, install\.sh's trust-on-first-use, or --allow-unsigned\); the next ccrc update that installs a release \(a newer one, or --force on this one\) verifies it and clears the mark$/m);
    // A PASS prints no remedy line — `remedyFor` only matches a WARN/FAIL
    // verdict line, so "no match" is its own honest signal of "none".
    expect(remedyFor(r.stdout, 'provenance')).toBe('');
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) provenance: /m);
    noRunnerBugLine(r.stdout, 'provenance');
    // D-139: a fresh install — unsigned by construction — ends green.
    expect(r.code).toBe(0);
  });

  it('a last line with no newline is still read — `unsigned` without its LF is the same mark, still a PASS', () => {
    const home = healthy('ccrc-doctor-prov-nolf-');
    record(home, `${HEALTHY_SHA}\nunsigned`);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS provenance: unsigned — this install was not verified by ccrc update/m);
  });

  it('SKIPs a box with no completed-install record — no remedy, counted as a skip', () => {
    const home = healthy('ccrc-doctor-prov-none-');
    rmSync(join(home, '.ccrc', 'installed'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP provenance: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toBe(`SKIP provenance: no completed-install record (${join(home, '.ccrc', 'installed')}) — nothing to say about how this install was made`);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) provenance: /m);
    noRunnerBugLine(r.stdout, 'provenance');
    expect(r.stdout).toMatch(new RegExp(`^summary: \\d+ checks \\(${1 + HEALTHY_SKIPS} skipped\\)`, 'm'));
  });

  it('a record that is not a readable regular file WARNs as unmeasured — never a PASS, never a SKIP', () => {
    // A DIRECTORY at the path: root-proof, unlike a chmod 000 file, and the
    // shape D-3025's `-f`-before-`-r` rule exists for.
    const home = healthy('ccrc-doctor-prov-dir-');
    rmSync(join(home, '.ccrc', 'installed'), { force: true });
    mkdirSync(join(home, '.ccrc', 'installed'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(new RegExp(`^WARN provenance: ${join(home, '.ccrc', 'installed').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} cannot be read, so how this install was made was not measured$`, 'm'));
    noRunnerBugLine(r.stdout, 'provenance');
    expect(r.code).toBe(0);
  });

  it('the check has no FAIL arm at all — every branch, reached or not, answers PASS, WARN or SKIP', () => {
    // The mechanism behind "never FAILs", over the arms no fixture reaches
    // (the constants guard): a `_dr_fail` added to ANY branch reds here.
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const fn = /^_check_provenance\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc-doctor-checks has no _check_provenance').not.toBeNull();
    expect(fn![0]).not.toMatch(/_dr_fail|return 1\b/);
  });
});


describe('ccrc doctor: update-exposure (design §12 — armed and reachable, each read the way the server unit reads it)', () => {
  /** A box `ccrc expose` never touched: no exposure file, no Caddyfile (and no
   *  system copy of one), a loopback ccrc.env, no ddns unit. The four
   *  exposure-quartet checks SKIP here by their own rule; every case below
   *  adds back exactly the one input it is about. */
  function unexposed(prefix: string, env = 'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n'): string {
    const home = healthy(prefix);
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, '.ccrc', 'Caddyfile'), { force: true });
    rmSync(sysCaddyfile(home), { force: true });
    writeCcrcEnv(home, env);
    return home;
  }
  const line = (out: string): string =>
    out.split('\n').find((l) => /^(PASS|WARN|FAIL|SKIP) update-exposure: /.test(l)) ?? '';

  // ── the four quadrants of spec §12's Pins ──────────────────────────────
  it('quadrant 1: armed via exposure.env + reachable → PASS, naming the file the flag was read from', () => {
    // healthy() IS this box: `ccrc expose duckdns` ran, so exposure.env carries
    // CCRC_AUTH=on (as `_exp_env_write` really writes it — the parity case
    // below), and ccrc.env carries no CCRC_AUTH at all.
    const home = healthy('ccrc-doctor-upx-armed-exposure-');
    const r = runDoctor(home);
    expect(line(r.stdout)).toBe(`PASS update-exposure: CCRC_AUTH=on (read from ${join(home, '.ccrc', 'exposure.env')}) — the update routes sit behind the session gate`);
    noRunnerBugLine(r.stdout, 'update-exposure');
    // …and exposure WINS over ccrc.env, both ways (the second EnvironmentFile):
    // ccrc.env saying off is overruled by exposure.env saying on…
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\nCCRC_AUTH=off\n');
    expect(line(runDoctor(home).stdout)).toMatch(/^PASS update-exposure: CCRC_AUTH=on \(read from .*exposure\.env\)/);
    // …and ccrc.env saying on is overruled by exposure.env saying off.
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    writeExposureEnv(home, { omit: ['CCRC_AUTH'] });
    appendFileSync(join(home, '.ccrc', 'exposure.env'), 'CCRC_AUTH=off\n');
    const off = runDoctor(home);
    expect(line(off.stdout)).toMatch(/^FAIL update-exposure: this box is reachable /);
    noRunnerBugLine(off.stdout, 'update-exposure');
  });

  // Fix round 1 item 7 / review 155 C13 — the reviewer's own probe,
  // reproduced verbatim: ccrc.env says CCRC_AUTH=on, exposure.env has a BARE
  // `CCRC_AUTH=` line (present, empty — never what `ccrc expose` itself
  // writes, only a hand edit), and the bind is reachable. Before the fix
  // `_box_env_value` collapsed "the exposure file names the key, empty" into
  // the same "" as "the exposure file never mentions it", so `[ -n "$v" ]`
  // left ccrc.env's `on` standing and this PASSED while the server's own
  // EnvironmentFile stacking runs with the gate OFF.
  it('a PRESENT but EMPTY CCRC_AUTH= in exposure.env wins over ccrc.env=on, exactly as the second EnvironmentFile does — FAIL, not the false PASS C13 found', () => {
    const home = unexposed('ccrc-doctor-upx-bare-auth-',
      'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    writeExposureEnv(home, { omit: ['CCRC_AUTH'] });
    appendFileSync(join(home, '.ccrc', 'exposure.env'), 'CCRC_AUTH=\n');
    const r = runDoctor(home);
    expect(line(r.stdout), r.stdout).toMatch(/^FAIL update-exposure: this box is reachable \(/);
    noRunnerBugLine(r.stdout, 'update-exposure');
    expect(r.code).toBe(1);
  });

  // Batch E review fix round 1, M1 (item 7 was only half-pinned): the OTHER
  // half of "absent and empty are two conditions" — exposure.env PRESENT,
  // but naming NO CCRC_AUTH line AT ALL, must still fall through to
  // ccrc.env's own value, exactly as an ABSENT exposure.env does. Mutating
  // `_box_env_value`'s trailing `[ "$found" -eq 1 ]` to `true` folds this
  // case into "present and empty" (a FAIL) without this pin catching it.
  it('exposure.env present but naming NO CCRC_AUTH line at all falls through to ccrc.env — PASS, the absent half of C13\'s "two conditions"', () => {
    const home = unexposed('ccrc-doctor-upx-exp-no-auth-line-',
      'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    writeExposureEnv(home, { omit: ['CCRC_AUTH'] });   // present, no CCRC_AUTH line
    const r = runDoctor(home);
    // This box's OWN verdict, not the run's overall rc — writeExposureEnv
    // alone (with no matching Caddyfile ceremony) trips `caddyfile`'s own
    // check, unrelated to what this pin is about.
    expect(line(r.stdout), r.stdout).toMatch(/^PASS update-exposure: CCRC_AUTH=on \(read from .*ccrc\.env\)/);
    noRunnerBugLine(r.stdout, 'update-exposure');
  });

  it('quadrant 2: ccrc.env armed + loopback → PASS', () => {
    const home = unexposed('ccrc-doctor-upx-armed-env-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    const r = runDoctor(home);
    expect(line(r.stdout)).toBe(`PASS update-exposure: CCRC_AUTH=on (read from ${join(home, '.ccrc', 'ccrc.env')}) — the update routes sit behind the session gate`);
    noRunnerBugLine(r.stdout, 'update-exposure');
  });

  it('quadrant 3: unarmed + CCRC_HOST=0.0.0.0 → FAIL naming the bind and "the update routes"', () => {
    const home = unexposed('ccrc-doctor-upx-wildcard-',
      'CCRC_FLEET=local\nCCRC_HOST=0.0.0.0\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    const l = line(r.stdout);
    expect(l, r.stdout).toMatch(/^FAIL update-exposure: this box is reachable \(/);
    expect(l).toContain(`CCRC_HOST=0.0.0.0 in ${join(home, '.ccrc', 'ccrc.env')}`);
    // Fix round 1 item 25 / review 155 Q7: `/api/updates/apply` does not exist
    // until wave 5 — this box's own ccrc must not send an operator to worry
    // about a route it cannot even reach.
    expect(l).toContain('the update routes');
    expect(l).not.toContain('/api/updates/apply');
    expect(remedyFor(r.stdout, 'update-exposure')).toMatch(/^ {2}remedy: arm the gate: ccrc expose /);
    noRunnerBugLine(r.stdout, 'update-exposure');
    expect(r.code).toBe(1);
  });

  it('quadrant 4: unarmed + loopback + a Caddyfile present ("expose ran, exposure.env deleted") → FAIL naming the route', () => {
    // The mutation this quadrant exists for: a check that judged CCRC_HOST
    // alone would PASS this box — loopback bind, and the public name still
    // proxied straight to it by caddy.
    const home = unexposed('ccrc-doctor-upx-caddyfile-');
    writeFileSync(join(home, '.ccrc', 'Caddyfile'), 'fixture.duckdns.org {\n    reverse_proxy 127.0.0.1:7788\n}\n');
    const r = runDoctor(home);
    const l = line(r.stdout);
    expect(l, r.stdout).toMatch(/^FAIL update-exposure: this box is reachable \(/);
    expect(l).toContain(`${join(home, '.ccrc', 'Caddyfile')} exists`);
    expect(l).not.toContain('CCRC_HOST=');
    expect(l).toContain('the update routes');
    expect(l).not.toContain('/api/updates/apply');
    noRunnerBugLine(r.stdout, 'update-exposure');
    expect(r.code).toBe(1);
  });

  // ── the other inputs, and the one this box never reads ─────────────────
  it('the ddns unit counts as an exposure artifact — the .service or the .timer, on its own', () => {
    // On macOS both iterations plant the SAME file — `unitFileOf` strips
    // either suffix, as `_exp_ddns_units`' Darwin arm writes one job for the
    // pair — while the check reaches it through the `.service` name alone
    // (`_svc_label` strips only `.service`, so `_dr_unit_file` would map the
    // `.timer` name to a plist nothing writes). There the `.timer` iteration
    // is the `.service` one again, and the exactly-once pin is what it adds:
    // a check that looked the one job up under both names would list it twice.
    for (const unit of ['ccrc-ddns.service', 'ccrc-ddns.timer']) {
      const home = unexposed(`ccrc-doctor-upx-ddns-${unit.split('.')[1]}-`);
      writeUnitFile(home, unit);
      const r = runDoctor(home);
      const l = line(r.stdout);
      expect(l, `${unit}\n${r.stdout}`).toMatch(/^FAIL update-exposure: this box is reachable \(/);
      const needle = `${unitFileOf(unit)} is installed in ${unitDirOf(home)}`;
      expect(l).toContain(needle);
      expect(l.split(needle).length - 1, `${unit}: the unit file named more than once\n${l}`).toBe(1);
      if (process.platform === 'darwin') {
        expect(unitFileOf(unit)).toBe('app.ccrc.ccrc-ddns.plist');
        expect(l.split('app.ccrc.ccrc-ddns.plist is installed in ').length - 1).toBe(1);
      }
      noRunnerBugLine(r.stdout, 'update-exposure');
    }
  });

  it('an exposure.env with no CCRC_AUTH is reachable AND unarmed — the file alone is the evidence', () => {
    const home = unexposed('ccrc-doctor-upx-exp-unarmed-');
    writeExposureEnv(home, { omit: ['CCRC_AUTH'] });
    const r = runDoctor(home);
    expect(line(r.stdout)).toContain(`${join(home, '.ccrc', 'exposure.env')} exists`);
    expect(line(r.stdout)).toMatch(/^FAIL update-exposure: /);
  });

  it('a hostname bind is reachable — judging it loopback would need a resolver', () => {
    const home = unexposed('ccrc-doctor-upx-hostname-',
      'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    expect(line(runDoctor(home).stdout)).toContain('CCRC_HOST=ccrc-fixture.invalid in ');
  });

  it.each([['127.0.0.1'], ['127.0.0.2'], ['localhost'], ['::1'], ['']])(
    'loopback (%s) with no artifact and the gate off → PASS, loopback only', (host) => {
      const home = unexposed(`ccrc-doctor-upx-loop-${host.replace(/[^a-z0-9]/gi, '') || 'default'}-`,
        `CCRC_FLEET=local\n${host ? `CCRC_HOST=${host}\n` : ''}CCRC_PORT=7788\n`);
      const r = runDoctor(home);
      expect(line(r.stdout)).toBe(`PASS update-exposure: loopback only — no exposure artifact and CCRC_HOST=${host || '127.0.0.1 (the default)'}`);
      noRunnerBugLine(r.stdout, 'update-exposure');
    });

  it("an exported CCRC_AUTH in doctor's own shell decides nothing — the server reads its EnvironmentFiles", () => {
    const home = unexposed('ccrc-doctor-upx-shellflag-',
      'CCRC_FLEET=local\nCCRC_HOST=0.0.0.0\nCCRC_PORT=7788\n');
    const r = runDoctor(home, ['doctor'], { CCRC_AUTH: 'on' });
    expect(line(r.stdout)).toMatch(/^FAIL update-exposure: /);
  });

  it('an exposure.env that is there and cannot be read WARNs as unmeasured', () => {
    const home = unexposed('ccrc-doctor-upx-exp-dir-');
    mkdirSync(join(home, '.ccrc', 'exposure.env'));
    const r = runDoctor(home);
    expect(line(r.stdout)).toMatch(/^WARN update-exposure: .*exposure\.env is there and cannot be read, so whether CCRC_AUTH is on — and so whether the update routes are gated — was not measured$/);
    expect(line(r.stdout)).not.toContain('/api/updates/apply');
    noRunnerBugLine(r.stdout, 'update-exposure');
  });

  it('SKIPs a fleet-role box on either piece of evidence — the recorded role, or the two unit files', () => {
    const byRole = healthy('ccrc-doctor-upx-fleet-role-');
    writeCcrcEnv(byRole, 'CCRC_ROLE=fleet\nCCRC_HOST=0.0.0.0\n');
    let r = runDoctor(byRole);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP update-exposure: '));
    expect(lines[i], r.stdout).toBe(`SKIP update-exposure: this box runs no ccrc server (${join(byRole, '.ccrc', 'ccrc.env')} records CCRC_ROLE=fleet), so no update route is served here`);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    noRunnerBugLine(r.stdout, 'update-exposure');
    const byUnits = healthy('ccrc-doctor-upx-fleet-units-');
    removeUnitFile(byUnits, 'ccrc.service');
    writeUnitFile(byUnits, 'ccrc-agent.service');
    writeFileSync(join(byUnits, 'fixture-unit-ccrc-agent.service'), 'active\n');
    r = runDoctor(byUnits);
    expect(line(r.stdout)).toMatch(/^SKIP update-exposure: this box runs no ccrc server \(.* has ccrc-agent\.service and no ccrc\.service\)/);
    noRunnerBugLine(r.stdout, 'update-exposure');
  });

  it("the fixture's exposure.env carries CCRC_AUTH=on on every arm, because the real writer does (`_exp_env_write`)", () => {
    // Before W4 this file's `writeExposureEnv` wrote CCRC_AUTH=on on the ip arm
    // only, while `_exp_env_write` writes it on every arm — a drift nothing
    // read until this check. So the writer is RUN (extracted, in a fixture
    // HOME), and the fixture must agree with what it wrote.
    const src = readFileSync(CCRC_SRC, 'utf8');
    const fn = /^_exp_env_write\(\) \{[\s\S]*?\n\}/m.exec(src);
    const prog = /^PROG=.*$/m.exec(src);
    const die = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    // Review fix round 1, N1: `_ccrc_die` now calls `_upd_redact` — this
    // harness does not trigger a die on its green path, but a regression
    // that DID would hit "_upd_redact: command not found" rather than the
    // real refusal, so it is picked up here too.
    const redact = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(fn && prog && die && redact, 'ccd/ccrc lost _exp_env_write, PROG, _ccrc_die or _upd_redact').toBeTruthy();
    for (const [arm, opts] of [
      ['duckdns', {}], ['byo', { duckdns: false }], ['ip', { ip: '203.0.113.9' }],
    ] as const) {
      const home = mkTmp(`ccrc-doctor-expwriter-${arm}-`);
      const real = join(home, '.ccrc', 'exposure.env');
      const w = spawnSync(BASH, ['-c', [
        'set -uo pipefail', prog![0], redact![0], die![0],
        `CCRC_EXPOSURE_FILE=${shq(real)}`, `BOX_AUTH_FILE=${shq(join(home, '.ccrc', 'auth.scrypt'))}`,
        fn![0],
        `_exp_env_write ${arm} https://box.example.com ${arm === 'ip' ? "''" : 'box.example.com'} ${arm === 'ip' ? '203.0.113.9' : 'box.example.com'} fixture-token ''`,
      ].join('\n')], { env: ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }), encoding: 'utf8' });
      expect(w.status, `${arm}: ${w.stderr}`).toBe(0);
      const writerArms = readFileSync(real, 'utf8').split('\n').includes('CCRC_AUTH=on');
      const fx = mkTmp(`ccrc-doctor-expfixture-${arm}-`);
      writeExposureEnv(fx, opts);
      const fixtureArms = readFileSync(join(fx, '.ccrc', 'exposure.env'), 'utf8').split('\n').includes('CCRC_AUTH=on');
      expect(writerArms, `${arm}: the real writer stopped arming`).toBe(true);
      expect(fixtureArms, `${arm}: writeExposureEnv drifted from _exp_env_write`).toBe(writerArms);
    }
  });

  // Fix round 1 item 4 / review 196 F5: `_check_update-exposure` now calls
  // `_box_unit_env` (armed/reachable), but its not-loaded guard tested only
  // `_box_env_value`. The guard now names `_box_unit_env` too. This sources
  // BOTH files intact and removes only the FUNCTION (never `unset
  // CCRC_EXPOSURE_FILE`, which the guard tests first and would mask the
  // mutation), with `BUE_VAL=on` preset AFTER sourcing ccrc as a shell
  // assignment (an env entry is reset at ccrc's own file scope (`BUE_VAL=""`'s line)) — a
  // guard missing this term reads that stale value as ARMED instead of
  // failing shut.
  it('the not-loaded guard also requires _box_unit_env — dropping only that function still FAILs, not a stale ARMED PASS', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-update-exposure-bue');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; unset -f _box_unit_env; BUE_VAL=on; _check_update-exposure`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL update-exposure: ccrc's own config and exposure constants are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  // ── wave 9 R10e (D-3823): an undecidable flag or bind is NOT MEASURED, never a verdict ────
  // Each case below shares the auth describe's reader (`_box_unit_env`), so the shape that makes `_check_auth` say
  // "not measured" makes this check say it too — worded for what THIS check decides (whether the update routes are
  // gated, and whether the box is reachable). The describe's existing cases above run UNEDITED.
  describe('wave 9 R10e — an undecidable CCRC_AUTH or CCRC_HOST is not measured', () => {
    const envPath = (home: string): string => join(home, '.ccrc', 'ccrc.env');
    const expPath = (home: string): string => join(home, '.ccrc', 'exposure.env');
    const lineOf = (p: string, text: string): number => readFileSync(p, 'utf8').split('\n').indexOf(text) + 1;

    it('X1: a reachable box whose exposure file carries `CCRC_AUTH = on` WARNs, not measured, naming the file, with a non-empty cause (main: FAIL "CCRC_AUTH is not on")', () => {
      const home = unexposed('ccrc-doctor-upx-x1-',
        'CCRC_FLEET=local\nCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
      writeExposureEnv(home, { omit: ['CCRC_AUTH'] });
      appendFileSync(expPath(home), 'CCRC_AUTH = on\n');
      const r = runDoctor(home);
      const l = line(r.stdout);
      expect(l, r.stdout).toMatch(/^WARN update-exposure: /);
      expectUndecided(l, expPath(home));
      // The cause is captured at the CCRC_AUTH read; the later CCRC_HOST read resets the out-params (M16).
      expect(l).not.toMatch(/^WARN update-exposure: ,/);
      expect(l).toContain('so whether CCRC_AUTH is on — and so whether the update routes are gated — was not measured');
      noRunnerBugLine(r.stdout, 'update-exposure');
    });

    itLinux('X2: an exposure file that DECIDES `CCRC_AUTH=on` is gated whatever its bind says — `CCRC_HOST = 0.0.0.0` does not WARN a gated box', () => {
      const home = unexposed('ccrc-doctor-upx-x2-');
      writeExposureEnv(home);
      appendFileSync(expPath(home), 'CCRC_HOST = 0.0.0.0\n');
      const r = runDoctor(home);
      expect(line(r.stdout), r.stdout).toBe(`PASS update-exposure: CCRC_AUTH=on (read from ${expPath(home)}) — the update routes sit behind the session gate`);
      noRunnerBugLine(r.stdout, 'update-exposure');
    });

    // PLATFORM-ONLY: bash's `. file` fails the whole-file rule on a spaced assignment, where the Linux
    // reader lets the exposure file decide (X2). The platforms differ by reader. Its Linux twin is X2.
    itDarwin('X2d: the same files on macOS — the spaced line fails the whole-file rule, so not measured, naming the exposure file and that line\'s number', () => {
      const home = unexposed('ccrc-doctor-upx-x2d-');
      writeExposureEnv(home);
      appendFileSync(expPath(home), 'CCRC_HOST = 0.0.0.0\n');
      const l = line(runDoctor(home).stdout);
      expect(l).toMatch(/^WARN update-exposure: /);
      expectUndecided(l, expPath(home));
      expect(l).toContain(`${expPath(home)} line ${lineOf(expPath(home), 'CCRC_HOST = 0.0.0.0')} `);
    });

    itLinux('X3: no exposure artifact, `CCRC_AUTH` absent and `CCRC_HOST = 0.0.0.0` in ccrc.env — whether the box is REACHABLE is not measured (main: the loopback PASS, a false PASS)', () => {
      const home = unexposed('ccrc-doctor-upx-x3-',
        'CCRC_FLEET=local\nCCRC_HOST = 0.0.0.0\nCCRC_PORT=7788\n');
      const r = runDoctor(home);
      const l = line(r.stdout);
      expect(l, r.stdout).toMatch(/^WARN update-exposure: /);
      expect(l).toContain('so whether this box is reachable — and so whether its ungated update routes answer anyone — was not measured');
      expect(l).toContain(envPath(home));
      expect(l).toContain('CCRC_HOST');
      expect(l).not.toContain('cannot be read');
      noRunnerBugLine(r.stdout, 'update-exposure');
    });

    // PLATFORM-ONLY: both reads are rc 3 under bash's whole-file rule, so arm 2 speaks about CCRC_AUTH;
    // the Linux reader (X3) reports on the spaced CCRC_HOST line. The platforms differ by reader. Its Linux twin is X3.
    itDarwin('X3d: the same box on macOS — both reads are rc 3 (the whole-file rule), so arm 2 speaks: whether CCRC_AUTH is on is not measured, naming ccrc.env line 2', () => {
      const home = unexposed('ccrc-doctor-upx-x3d-',
        'CCRC_FLEET=local\nCCRC_HOST = 0.0.0.0\nCCRC_PORT=7788\n');
      const l = line(runDoctor(home).stdout);
      expect(l).toMatch(/^WARN update-exposure: /);
      expectUndecided(l, envPath(home));
      expect(l).toContain(`${envPath(home)} line 2 `);
      expect(l).toContain('so whether CCRC_AUTH is on');
    });

    itLinux('X4: the loopback control for arm 2\'s reach term — a box PROVABLY loopback-only is a PASS whatever an undecidable CCRC_AUTH says (green at main, which reads the spaced line as absent)', () => {
      const home = unexposed('ccrc-doctor-upx-x4-',
        'CCRC_FLEET=local\nCCRC_AUTH = on\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
      const r = runDoctor(home);
      expect(line(r.stdout), r.stdout).toBe('PASS update-exposure: loopback only — no exposure artifact and CCRC_HOST=127.0.0.1');
      noRunnerBugLine(r.stdout, 'update-exposure');
    });

    // PLATFORM-ONLY: the whole-file rule makes CCRC_HOST rc 3 under bash's `. file`, so this WARNs; the Linux
    // reader (X4) reads the spaced line as absent and PASSes. The platforms differ by reader. Its Linux twin is X4.
    itDarwin('X4d: the same box on macOS — the whole-file rule makes CCRC_HOST rc 3 too, so arm 2 WARNs, naming ccrc.env line 2', () => {
      const home = unexposed('ccrc-doctor-upx-x4d-',
        'CCRC_FLEET=local\nCCRC_AUTH = on\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
      const l = line(runDoctor(home).stdout);
      expect(l).toMatch(/^WARN update-exposure: /);
      expectUndecided(l, envPath(home));
      expect(l).toContain(`${envPath(home)} line 2 `);
    });
  });
});



// ── scopes ────────────────────────────────────────────────────────────────
//
// `_check_scopes` answers ONE question — is a pane scope's memory cap
// currently strangling the session inside it — and the whole difficulty is
// that being over `MemoryHigh` is not the answer. Measured on the fleet host
// 2026-08-27/28: a scope sat 18h51m at 9.07 GiB against an 8 GiB high with
// the claude process itself unschedulable, while `ccd ls` said `running`; and
// the NEXT MORNING the same suite crossed the same line, was reclaimed, and
// finished in minutes. The first is the fault; the second is the throttle
// working. Only process state separates them, which is why every case here is
// about `wchan` rather than about the ratio.
describeLinux('ccrc doctor: scopes', () => {
  it('PASSES a scope over its MemoryHigh whose processes are all schedulable', () => {
    // THIS MORNING'S HEALTHY SPIKE, as a fixture. An over-the-line detector
    // would WARN here and cry wolf on every busy test run.
    const home = healthy('ccrc-doctor-scopes-spike-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    plantScope(home, { procs: [5101, 5102], current: 9 * 1024 ** 3, high: 8 * 1024 ** 3 });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS scopes: .*none throttled/m);
    expect(r.stdout).not.toMatch(/^WARN scopes:/m);
  });

  it('WARNS when a process is parked on the reclaim wchan in BOTH samples, naming the scope and the memory', () => {
    const home = healthy('ccrc-doctor-scopes-stuck-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    linkReal(home, 'sleep');
    plantScope(home, {
      procs: [5201, 5202], stuck: [5201],
      current: 9741930496, high: 8 * 1024 ** 3,
    });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN scopes: tmux-spawn-fixture\.scope has 1 process\(es\) parked in memory reclaim at 9\.07 GiB of 8\.00 GiB$/m);
    // The remedy must send the reader at the WORKLOAD, and must not offer the
    // one change that would re-create the 24G incident the cap exists for.
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN scopes:'));
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*do NOT raise the cap/);
  });

  it('PASSES when the parked process has left the reclaim path by the second sample', () => {
    // The blip. `sleep` is stubbed to perform the transition DURING the settle,
    // which is also what proves the settle happens at all: with the second
    // sample deleted from the check, the mutation never runs and this reds.
    const home = healthy('ccrc-doctor-scopes-blip-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    plantScope(home, { procs: [5301], stuck: [5301], current: 9 * 1024 ** 3 });
    stub(home, 'sleep', `printf 'do_epoll_wait' > "$HOME/fixture-proc/5301/wchan"\nexit 0`);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS scopes: .*none throttled/m);
  });

  it('finds a scope wherever systemd says it lives, not where a built path would put it', () => {
    // D-307, on purpose. `ccd-cap-scopes` capped NOTHING for 13 days because it
    // string-built `user@1000.service/<scope>`; the panes were two slices
    // deeper. This fixture's ControlGroup is a path no such guess would reach,
    // so a check that stopped asking `-p ControlGroup` would find no scope and
    // SKIP — which is why the assertion is on the PASS, not on an absence.
    const home = healthy('ccrc-doctor-scopes-layout-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    plantScope(home, { unit: 'tmux-spawn-deep.scope', procs: [5401] });
    expect(readFileSync(join(home, 'fixture-cgroup-of-tmux-spawn-deep.scope'), 'utf8'))
      .toContain('/app-claude.slice/');
    expect(runDoctor(home).stdout).toMatch(/^PASS scopes: 1 pane scope\(s\), none throttled/m);
  });

  it('says nothing at all about a scope that vanished between the listing and the read', () => {
    // A scope can die mid-check; that is a race, not a fault. The listing names
    // it, the ControlGroup resolves, and the directory is simply not there.
    const home = healthy('ccrc-doctor-scopes-race-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    plantScope(home, { procs: [5501] });
    rmSync(join(home, 'fixture-cgroup'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/^(WARN|FAIL) scopes:/m);
    expect(r.stderr).toBe('');
  });

  it('SKIPS a box with no pane scopes rather than claiming health it did not measure', () => {
    const home = healthy('ccrc-doctor-scopes-none-');
    rmSync(join(home, 'fixture-scopes'), { force: true });
    expect(runDoctor(home).stdout).toMatch(/^SKIP scopes: no tmux pane scopes/m);
  });
});


describe('ccrc doctor: routing (routing spec 2026-09-14 §5.2, §8)', () => {
  const ROUTING_ROSTER = { version: 1, accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
  ] };
  const routingBox = (prefix: string): string => {
    const home = healthy(prefix);
    seedAccountsSh(home, ROUTING_ROSTER);
    return home;
  };
  // THE SYSTEMD CENSUS IS LINUX-ONLY BY CONSTRUCTION, and so are the six
  // cases below that drive it through `runDoctor`. `ccrc` recomputes CCD_OS
  // from `$OSTYPE`/`uname` at source time (ccd/ccrc:109 onward), so on a Mac
  // `_check_routing` takes its darwin arm — "unmeasured: this is a launchd
  // box" — before `_have_systemctl` or the fixture `systemctl` is asked
  // anything. MEASURED on CI's `test-macos` leg 2026-09-17 (run 35210902959,
  // PR #116): four of the six red on a census-wording `toContain` that arm
  // never produces, the fifth (fail-zero) red on the FAIL the launchd WARN
  // displaces, and the sixth (the exit-1 stub) green for the wrong reason,
  // its `unmeasured` coming from the launchd arm rather than the systemctl
  // answer it stubs. Skipped on darwin rather than direct-sourced with
  // CCD_OS=linux (which would run the loop on a Mac at the cost of the
  // end-to-end `ccrc doctor` path the six exist to measure): the darwin arm
  // is pinned on EVERY platform by the "on a launchd box" case further down,
  // which sources the checks file directly, the end-to-end launchd line by
  // the `itDarwin` case beside it, and the Linux legs run these six unchanged.
  const NO_SYSTEMD_CENSUS = IS_DARWIN;

  it('routing: PASSES when no Anthropic lane\'s settings.json names a routing env key', () => {
    const home = routingBox('ccrc-doctor-routing-pass-');
    writeSettingsEnv(home, '.claude', { ANTHROPIC_MODEL: '' });
    writeSettingsEnv(home, '.gpt-cfg', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });   // a non-Anthropic lane is not this check's subject
    const line = lineFor(runDoctor(home).stdout, 'routing');
    expect(line).toMatch(/^PASS routing: 1 Anthropic lane\(s\)/);
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: WARNS — never FAILS — a stopped, unrecorded session does not inflate the live-session count (S1-R13; ruling S5-R12, fix round 2)', () => {
    // CURRENT RATIONALE (ruling S5-R12, fix round 2 — replaces the S1-R13
    // comment this test carried before the FAIL arm existed): the FAIL below
    // fires ONLY over a measured, non-empty, FULLY-RECORDED live set (live
    // >= 1 AND missing == 0). Any live session still lacking a routing
    // record, OR no live session running at all, stays a WARN — the key
    // predates the routing record (the fleet's own 2026-09-07
    // subagent-routing ruling put it in settings.json on purpose), and
    // `cmd_install` ends with `cmd_doctor`, whose rc `cmd_update` turns into
    // `_ccrc_die` BEFORE `_upd_sweep`, half-landing every update on that box
    // — so a FAIL here must be EARNED by a real, fully-recorded population,
    // never fired the moment a session happens to be live and unrecorded,
    // and never fired on an empty or not-yet-measured one either.
    // This fixture plants one live, UNRECORDED session (which keeps this a
    // WARN) alongside one STOPPED, unrecorded session, and asserts the
    // stopped one moves neither the count nor the named ids — the mutation
    // Task 5's step 5 checks for (counting stopped sessions towards
    // `missing` would say "2", not "1", and would name `sess-stopped`).
    const home = routingBox('ccrc-doctor-routing-subagent-warn-stopped-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-unrecorded', { live: true, recorded: false });
    plantSession(home, 'sess-stopped', { live: false, recorded: false });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: 1 Anthropic lane\(s\) pin CLAUDE_CODE_SUBAGENT_MODEL in settings\.json: /);
    expect(line).toContain('claude');
    expect(line, 'the consequence, not just the key')
      .toContain("the routing record's subagent field is overridden there until the key is removed");
    expect(line, 'the census count that keeps this a WARN — stopped sessions must not inflate it')
      .toContain('1 live session(s) carry no routing record (a `.class` field, `default` included) yet');
    expect(line).toContain('sess-unrecorded');
    expect(line, 'a stopped session is not a live one, and must not be named here')
      .not.toContain('sess-stopped');
    expect(out).toContain('remedy: remove the key from those lanes');
    expect(out, 'the subagent key alone must never read as a FAIL').not.toMatch(/^FAIL routing: /m);
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: WARNS naming exactly 1 live session when one of two LIVE ids carries no routing record (brief fixture (a), fix round 2, finding #4)', () => {
    // The brief's literal fixture (a): two LIVE ids, one WITHOUT `.class`.
    // Distinct from the test above — both ids here are actually running, so
    // this pins the `.class` filter on its own, independent of the
    // measured-not-live filter the stopped-session test above pins.
    const home = routingBox('ccrc-doctor-routing-subagent-warn-mixed-live-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-recorded', { live: true, recorded: true });
    plantSession(home, 'sess-unrecorded', { live: true, recorded: false });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: 1 Anthropic lane\(s\) pin CLAUDE_CODE_SUBAGENT_MODEL in settings\.json: /);
    expect(line, 'the .class filter — only the unrecorded LIVE id counts')
      .toContain('1 live session(s) carry no routing record (a `.class` field, `default` included) yet');
    expect(line).toContain('sess-unrecorded');
    expect(line, 'the recorded live id must not be named as missing')
      .not.toContain('sess-recorded');
    expect(out, 'a mixed live population is not yet a measured FAIL').not.toMatch(/^FAIL routing: /m);
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: WARNS with its own zero-live wording when the census measures no live session at all (ruling S5-R12(2), fix round 2)', () => {
    // A registry that is present, readable, and has zero live ids is a
    // MEASURED zero — distinct from "unmeasured" (finding #2's old code
    // FAILed here, which would abort `ccrc update` on a rebooted or dev box
    // that never ran a session the key could have collided with). Two
    // shapes both measure this: no `.uuid` files at all, and every planted
    // id measuring stopped. Both are pinned here.
    const emptyHome = routingBox('ccrc-doctor-routing-subagent-warn-zerolive-empty-');
    writeSettingsEnv(emptyHome, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    mkdirSync(join(emptyHome, '.cc-sessions'), { recursive: true });
    const emptyOut = runDoctor(emptyHome).stdout;
    const emptyLine = lineFor(emptyOut, 'routing');
    expect(emptyLine, emptyOut).toMatch(/^WARN routing: 1 Anthropic lane\(s\) pin CLAUDE_CODE_SUBAGENT_MODEL in settings\.json: /);
    expect(emptyLine, 'the zero-live wording, in these words')
      .toContain('no live session to measure the key against');
    expect(emptyLine).toContain("it will override the first spawn's record until removed");
    expect(emptyOut, 'a measured zero-live census is a WARN, never the FAIL reserved for a fully-recorded population')
      .not.toMatch(/^FAIL routing: /m);

    const stoppedHome = routingBox('ccrc-doctor-routing-subagent-warn-zerolive-stopped-');
    writeSettingsEnv(stoppedHome, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(stoppedHome, 'sess-stopped', { live: false, recorded: false });
    const stoppedOut = runDoctor(stoppedHome).stdout;
    const stoppedLine = lineFor(stoppedOut, 'routing');
    expect(stoppedLine, stoppedOut).toMatch(/^WARN routing: /);
    expect(stoppedLine, 'the zero-live wording holds when the only planted id is measured stopped')
      .toContain('no live session to measure the key against');
    expect(stoppedOut, 'never the FAIL reserved for a fully-recorded population')
      .not.toMatch(/^FAIL routing: /m);
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: appends "and N more" once the unrecorded live-id list is truncated past five (fix round 2, finding #6)', () => {
    const home = routingBox('ccrc-doctor-routing-subagent-warn-truncated-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    for (let i = 1; i <= 6; i++) {
      plantSession(home, `sess-${i}`, { live: true, recorded: false });
    }
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: 1 Anthropic lane\(s\) pin CLAUDE_CODE_SUBAGENT_MODEL in settings\.json: /);
    expect(line, 'six missing counted, only five ids named, the sixth marked as truncated')
      .toContain('6 live session(s) carry no routing record (a `.class` field, `default` included) yet: sess-1 sess-2 sess-3 sess-4 sess-5 and 1 more');
    for (let i = 1; i <= 5; i++) expect(line).toContain(`sess-${i}`);
    expect(line, 'the truncated tail is never silently dropped').toContain('and 1 more');
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: the subagent-key FAILs once the live-session census measures zero unrecorded sessions', () => {
    const home = routingBox('ccrc-doctor-routing-subagent-fail-zero-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-a', { live: true, recorded: true });
    plantSession(home, 'sess-b', { live: true, recorded: true });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^FAIL routing: /);
    expect(line).toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    expect(line).toContain('claude');
    expect(line, 'the measured-zero cause, not the missing-record one')
      .toContain('every live session carries a routing record (a `.class` field, `default` included)');
    expect(out).toContain('remedy: remove');
    expect(out, 'a measured zero is a FAIL, not also a WARN about the same lane')
      .not.toMatch(/^WARN routing: /m);
  });
  it.skipIf(NO_SYSTEMD_CENSUS)('routing: the subagent-key WARN says the live-session census is unmeasured rather than fabricate a zero', () => {
    // `systemctl --user is-active` answering something other than 0 (active)
    // or 3 (inactive/failed — a real, measured "not live") for a reason of
    // its own — modelled here by a stub that exits 1 for every unit — must
    // never be read as "no live sessions", which would flip a WARN straight
    // to the FAIL Task 5 reserves for an actually measured zero.
    const home = routingBox('ccrc-doctor-routing-subagent-unmeasured-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-a', { live: false, recorded: false });
    stub(home, 'systemctl', 'exit 1');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: /);
    expect(line, 'the reason, in these words').toContain('unmeasured');
    expect(out, 'never FAIL on a fabricated zero').not.toMatch(/^FAIL routing: /m);
  });
  it.skipIf(process.getuid?.() === 0)(
    'routing: the subagent-key WARN says unmeasured when the registry exists but cannot be searched — never fabricates a zero (fix round 1, finding #1)', () => {
      // THE SAME D-1848 SHAPE `_check_pools` already guards on its own read of
      // this registry, one level up: `[ -d "$reg" ]` on a mode-000 directory
      // still answers TRUE (stat needs search on the PARENT, not on the dir
      // itself), so `for sf in "$reg"/*.uuid` would silently match nothing and
      // a present-but-unlistable registry would read as a measured zero — the
      // exact fabricated zero this arm exists not to FAIL on. Skipped as root:
      // root searches any directory, so the fixture cannot be built.
      const home = routingBox('ccrc-doctor-routing-subagent-reg-unsearchable-');
      writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
      plantSession(home, 'sess-a', { live: true, recorded: false });
      const reg = join(home, '.cc-sessions');
      chmodSync(reg, 0o000);
      try {
        const out = runDoctor(home).stdout;
        const line = lineFor(out, 'routing');
        expect(line, out).toMatch(/^WARN routing: /);
        expect(line, 'the reason, in these words').toContain('unmeasured');
        expect(line, 'the UNSEARCHABLE arm\'s own reason — on darwin the launchd arm also says `unmeasured`, so the substring alone would pass with this arm deleted')
          .toContain('is not a searchable, readable directory');
        expect(out, 'never FAIL on a fabricated zero').not.toMatch(/^FAIL routing: /m);
      } finally {
        chmodSync(reg, 0o755);
      }
    });
  it('routing: PASSES regardless of the live-session census when no lane pins the subagent key, and never even calls systemctl (fix round 2, finding #3)', () => {
    // The census is cheap by construction: it is evaluated only when `sub` is
    // non-empty. With no lane pinning the key, neither WARN nor FAIL can
    // reach the output whether the census ran or not — so a stub that would
    // merely WARN/FAIL if reached proves nothing about cheapness. Proven
    // instead with a RECORDING stub (the `curlCalls` shape) and an assertion
    // that `systemctl --user is-active claude-session@…` was never invoked.
    const home = routingBox('ccrc-doctor-routing-subagent-census-irrelevant-');
    writeSettingsEnv(home, '.claude', { ANTHROPIC_MODEL: '' });
    plantSession(home, 'sess-a', { live: true, recorded: false });
    // The whole run is recorded, so `delegation-hooks` must have no question for the manager either: the lane's
    // registration stands (writeSettingsEnv replaced the file) and so does the session's owner directory, and a
    // standing directory is never asked about (`delegation-hooks`' own "service manager is not asked" case).
    plantHookRegistration(home, '.claude', { extra: { env: { ANTHROPIC_MODEL: '' } } });
    plantSpoolDir(home, 'sess-a');
    stub(home, 'systemctl', 'echo "$*" >> "$HOME/systemctl-calls"; exit 1');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^PASS routing: /);
    const callsPath = join(home, 'systemctl-calls');
    const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n').filter(Boolean) : [];
    expect(calls.some((l) => l.includes('--user is-active claude-session@')), calls.join('\n')).toBe(false);
  });
  it('routing: on a launchd box the census is unmeasured and never invokes systemctl (fix round 2, finding #5)', () => {
    // `_have_systemctl` on darwin tests for launchctl, not systemctl
    // (the ccd darwin guard) — so without an explicit darwin check first, this arm
    // would run an actual `systemctl` on a Mac (exit 127, misattributed as
    // "answered neither active nor inactive"). CCD_OS=darwin must short
    // this out before `_have_systemctl` or `systemctl` is asked anything.
    //
    // `ccrc` itself recomputes CCD_OS from `$OSTYPE`/`uname` UNCONDITIONALLY
    // at source time (ccd/ccrc:109 onward — "COMPUTED ONCE... never
    // re-probed"), so an inherited env var is clobbered before `_check_routing`
    // ever runs and `runDoctor(home, [...], { CCD_OS: 'darwin' })` cannot
    // reach this branch. Sourced directly instead, the same way
    // `_check_fleet`'s isolated test above does — this file computes its own
    // `CCRC_HERE` and needs nothing else from `ccrc` for this arm, since the
    // darwin branch returns before `_have_systemctl` is ever asked anything.
    const home = routingBox('ccrc-doctor-routing-subagent-darwin-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-a', { live: true, recorded: false });
    stub(home, 'systemctl', 'echo "$*" >> "$HOME/systemctl-calls"; exit 127');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_routing`],
      { encoding: 'utf8', env: { HOME: home, PATH: containedPath(home), LC_ALL: 'C', CCD_OS: 'darwin' } });
    const out = r.stdout ?? '';
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: /);
    expect(line, 'the reason names the launchd box, not a fabricated systemctl answer')
      .toContain('launchd box');
    expect(line).toContain('CCD_OS=darwin');
    expect(out, 'never FAIL on a fabricated zero').not.toMatch(/^FAIL routing: /m);
    const callsPath = join(home, 'systemctl-calls');
    const calls = existsSync(callsPath) ? readFileSync(callsPath, 'utf8').split('\n').filter(Boolean) : [];
    expect(calls, 'systemctl must never be invoked on a launchd box').toEqual([]);
  });
  itDarwin('routing: on a real launchd box, `ccrc doctor` itself says the census is unmeasured — the end-to-end line the six skipped cases used to show by failing', () => {
    // The case above injects CCD_OS=darwin into a direct source of the checks
    // file; this one lets `ccrc` compute it from the Mac it runs on and reads
    // the doctor's own routing line, so the composition (ccd/ccrc:109 onward
    // → `_check_routing`'s darwin arm) is pinned where it happens, not only
    // in pieces (`macos-platform.test.ts` pins the block; the case above pins
    // the arm). Before D-2988 this outcome was visible only as five red
    // assertions on the macOS leg.
    const home = routingBox('ccrc-doctor-routing-subagent-darwin-e2e-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    plantSession(home, 'sess-a', { live: true, recorded: false });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: 1 Anthropic lane\(s\) pin CLAUDE_CODE_SUBAGENT_MODEL in settings\.json: /);
    expect(line, 'the reason names the launchd box, in the doctor\'s own words').toContain('launchd box (CCD_OS=darwin)');
    expect(line, 'never a census count this box cannot measure').not.toContain('live session(s) carry no routing record');
    expect(out, 'never FAIL on a fabricated zero').not.toMatch(/^FAIL routing: /m);
  });
  it('routing: FAILS on CLAUDE_CODE_EFFORT_LEVEL — the arm that stays a FAIL, naming the lane', () => {
    const home = routingBox('ccrc-doctor-routing-effort-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_EFFORT_LEVEL: 'high' });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^FAIL routing: /);
    expect(line).toContain('CLAUDE_CODE_EFFORT_LEVEL');
    expect(line).toContain('claude');
    expect(out).toContain('remedy: remove the key');
  });
  it('routing: a lane carrying BOTH keys is a FAIL — the effort arm wins, and it is named once', () => {
    const home = routingBox('ccrc-doctor-routing-bothkeys-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_EFFORT_LEVEL: 'high' });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'routing'), out).toMatch(/^FAIL routing: /);
    expect(out, 'one lane, one line — not also a WARN about the same lane').not.toMatch(/^WARN routing: /m);
  });
  it('routing: a box with no projection PASSES vacuously and says so — never a SKIP, which the healthy fixture\'s counts forbid', () => {
    const home = healthy('ccrc-doctor-routing-noroster-');
    expect(lineFor(runDoctor(home).stdout, 'routing')).toMatch(/^PASS routing: 0 Anthropic lane\(s\).*no roster projection/);
  });
  it('routing: a roster with only non-Anthropic lanes PASSES vacuously naming the reason', () => {
    const home = healthy('ccrc-doctor-routing-gptonly-');
    // parseRoster requires exactly one `exec.kind: 'upstream'` account, so the
    // single lane here is upstream — that is a launcher-identity question,
    // orthogonal to `telemetry`, which is what `_check_routing` actually reads.
    seedAccountsSh(home, { version: 1, accounts: [
      { ...ROUTING_ROSTER.accounts[1], exec: { kind: 'upstream' } },
    ] });
    expect(lineFor(runDoctor(home).stdout, 'routing'))
      .toMatch(/^PASS routing: 0 Anthropic lane\(s\).*declares no Anthropic-backend/);
  });
  it.skipIf(process.getuid?.() === 0)(
    'routing: WARNS, never silently PASSES, when a lane\'s settings.json exists but cannot be read', () => {
      const home = routingBox('ccrc-doctor-routing-unreadable-settings-');
      writeSettingsEnv(home, '.claude', { ANTHROPIC_MODEL: '' });
      const p = join(home, '.claude', 'settings.json');
      chmodSync(p, 0o000);
      try {
        expect(lineFor(runDoctor(home).stdout, 'routing')).toMatch(/^WARN routing: could not read/);
      } finally {
        chmodSync(p, 0o600);
      }
    });
  it('routing: WARNS (never a silent vacuous PASS) when accounts.sh fails to source', () => {
    const home = healthy('ccrc-doctor-routing-corrupt-sh-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'this is not bash (\n');
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'routing')).toMatch(/^WARN routing: could not read/);
    expect(out).toContain('remedy: re-run ccrc install');
  });
  it('routing: WARNS when the projection predates CCRC_ANTHROPIC_BACKEND', () => {
    const home = healthy('ccrc-doctor-routing-stale-projection-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'accounts.sh'), 'CCRC_ACCOUNTS=(claude)\n');
    expect(lineFor(runDoctor(home).stdout, 'routing')).toMatch(/^WARN routing: could not read/);
  });
  it('routing: WARNS when the projection predates CCRC_SUBAGENT_CLASSES — the array ccd validates `subagent` against', () => {
    // The vacuous-green shape S1-R9 removed, ONE ARRAY OVER: `ccrc install`
    // writes both arrays from one generator, but they shipped in different
    // releases, so a box installed between them has the backend array and not
    // this one — and ccd cannot validate a `subagent` field there at all.
    const home = routingBox('ccrc-doctor-routing-stale-subagent-');
    const sh = join(home, '.ccrc', 'accounts.sh');
    writeFileSync(sh, readFileSync(sh, 'utf8').split('\n')
      .filter((l) => !l.startsWith('CCRC_SUBAGENT_CLASSES=')).join('\n'));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^WARN routing: could not read/);
    expect(line).toContain('CCRC_SUBAGENT_CLASSES');
    expect(out).toContain('remedy: re-run ccrc install');
  });
});


describe('ccrc doctor: models', () => {
  it('is in the table and has a function — both directions', () => {
    expect(tableNames()).toContain('models');
  });

  it('SKIPS — not a confident PASS naming no lane — when no account has a model registry', () => {
    const home = healthy('ccrc-doctor-models-none-');
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toMatch(/^SKIP models: /);
    expect(any).not.toMatch(/^PASS models: /);
  });

  it('PASSES, naming the lane and its catalogue age, when fresh', () => {
    const home = healthy('ccrc-doctor-models-pass-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 41 * 60 });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'models');
    expect(line, out).toMatch(/^PASS models: /);
    expect(line).toContain('1 lane');
    expect(line).toContain('gpt');
    expect(line).toMatch(/41 min old/);
  });

  it('WARNS when a registered lane has never been probed — no catalogue at all', () => {
    const home = healthy('ccrc-doctor-models-neverprobed-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    // Deliberately no writeModelCatalogue call: a registry with no <id>.json.
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).toContain('gpt');
    expect(lines[i]).toMatch(/never probed/);
    expect(lines[i]).toContain('ccrc models refresh gpt');
    expect(lines.some((l) => l.startsWith('FAIL models: '))).toBe(false);
  });

  it('WARNS — the silent-timer arm — when stale:false but fetchedAt is older than 3 hours', () => {
    // C4's first arm: nobody rewrote the file — the timer is not reaching
    // this lane, and an active `ccrc-models.timer` looks identical to a
    // stopped one to the `services` check's unit-active test above.
    const home = healthy('ccrc-doctor-models-silent-timer-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { stale: false, fetchedAt: nowS() - (3 * 3600 + 60) });
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).toContain('gpt');
    expect(lines[i]).toMatch(/not marked stale/);
    expect(lines[i]).toContain('ccrc-models.timer');
    expect(lines.some((l) => l.startsWith('FAIL models: '))).toBe(false);
  });

  it('stays a PASS inside the 3 hour window — the control for the silent-timer arm', () => {
    const home = healthy('ccrc-doctor-models-fresh-window-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { stale: false, fetchedAt: nowS() - (3 * 3600 - 60) });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'models'), out).toMatch(/^PASS models: /);
  });

  // W8 Task C8b's characterization pin (D-7054; ARCH-69 (#804)): the silent-timer bound is three of ccrc-models.timer's
  // 60-minute periods, 10800 s, held 60 s inside and 60 s past, byte for byte, on a fixed clock. It runs unchanged at
  // every commit of the series.
  const catalogueAged = (prefix: string, ageS: number): string => {
    const home = healthy(prefix);
    const now = fixedNow();
    fixClock(home, stubBin(home), now);
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { stale: false, fetchedAt: now - ageS });
    return home;
  };
  it('a catalogue 3 h - 60 s old: the PASS, byte for byte (C8b)', () => {
    const out = runDoctor(catalogueAged('ccrc-doctor-models-c8b-inside-', 3 * 3600 - 60)).stdout;
    expect(lineFor(out, 'models'), out).toBe('PASS models: 1 lane, gpt catalogue 179 min old');
  });
  it('a catalogue 3 h + 60 s old: the silent-timer WARN and its remedy, byte for byte (C8b)', () => {
    const out = runDoctor(catalogueAged('ccrc-doctor-models-c8b-past-', 3 * 3600 + 60)).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(lines.slice(i, i + 2), out).toEqual([
      'WARN models: gpt\'s catalogue is 181 min old and not marked stale — the ccrc-models timer is not reaching this lane (an active timer that has quietly stopped writing is invisible to the \'services\' check above, which measures whether the unit is active, not whether it is producing anything — that check catches a STOPPED timer, not this one); run: systemctl --user status ccrc-models.timer, then: ccrc models refresh gpt',
      '  remedy: systemctl --user status ccrc-models.timer ; ccrc models refresh <id> for one named lane',
    ]);
  });
  // C8b step 4 (OA-C8c (a), D-7062): an unreadable ccrc-models.timer leaves each OK catalogue's staleness unmeasured:
  // one WARN naming the unit, never a PASS or a comparison against a literal; ccrc's reader not loaded FAILs naming the bug.
  const modelsLines = (out: string, home: string): string[] =>
    out.split(home).join('<home>').split('\n').filter((l, i, all) => /^(PASS|WARN|FAIL) models: /.test(l)
      || (/^ {2}remedy: /.test(l) && /^(WARN|FAIL) models: /.test(all[i - 1] ?? '')));
  it.each([[3 * 3600 - 60, 179], [3 * 3600 + 60, 181]])('an unreadable ccrc-models.timer makes models WARN unmeasured over a catalogue %i s old (C8b)', (age, min) => {
    const home = catalogueAged(`ccrc-doctor-models-c8b-unread-${age}-`, age);
    writeShippedTimer(join(home, 'ccrc'), 'ccrc-models.timer', null);
    const r = runDoctor(home);
    expect(modelsLines(r.stdout, home), r.stdout).toEqual([
      `WARN models: ccrc-models.timer's cadence could not be read from the shipped unit file (<home>/ccrc/deploy/systemd/ccrc-models.timer), so the staleness of gpt's catalogue (${min} min old) is unmeasured`,
      '  remedy: the shipped tree at <home>/ccrc is incomplete or damaged — both deploy lanes place the whole tree there, so the next ccrc update (or deploy) restores it; then re-run ccrc doctor',
    ]);
    expect(r.stderr).not.toMatch(/integer expression expected|syntax error/);
  });
  it('ccrc\'s timer reader not loaded: models FAILs naming the bug (C8b)', () => {
    const home = catalogueAged('ccrc-doctor-models-c8b-unloaded-', 3 * 3600 + 60);
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; BOX_TREE_DIR=; _check_models`],
      { env: doctorEnv(home), encoding: 'utf8' });
    expect(modelsLines(r.stdout ?? '', home), r.stdout + (r.stderr ?? '')).toEqual([
      'FAIL models: ccrc\'s own timer reader is not loaded, so the staleness of gpt\'s catalogue (181 min old) was never measured',
      '  remedy: this is a bug in ccrc, not a fact about your box — _check_models reads ccrc-models.timer\'s cadence through _timer_period_s and BOX_TREE_DIR, both declared once in ccrc itself, and this check table was sourced by something that is not ccrc',
    ]);
    expect(r.status).toBe(1);
  });

  it('WARNS — the stale-provider arm — regardless of age, quoting lastError and the age', () => {
    // C4's second arm: the timer ran, the provider refused it. Warned
    // regardless of age — the fixture's fetchedAt is minutes old, not hours.
    const home = healthy('ccrc-doctor-models-stale-provider-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { stale: true, fetchedAt: nowS() - 5 * 60, lastError: 'HTTP 401' });
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).toContain('gpt');
    expect(lines[i]).toContain('HTTP 401');
    expect(lines[i]).toMatch(/5 min old/);
    expect(lines.some((l) => l.startsWith('FAIL models: '))).toBe(false);
  });

  it('reports the stale arm only, not the silent-timer one, when both conditions hold — stale decides', () => {
    const home = healthy('ccrc-doctor-models-stale-and-old-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { stale: true, fetchedAt: nowS() - 6 * 3600, lastError: 'HTTP 500' });
    const out = runDoctor(home).stdout;
    const warns = out.split('\n').filter((l) => l.startsWith('WARN models: '));
    expect(warns.length, out).toBe(1);
    expect(warns[0]).toContain('HTTP 500');
    expect(warns[0]).not.toMatch(/not marked stale/);
  });

  it('ignores an orphan registry — an id no roster row names', () => {
    const home = healthy('ccrc-doctor-models-orphan-');
    writeModelRegistry(home, 'ghost');
    writeModelCatalogue(home, 'ghost', { stale: true, lastError: 'must never surface' });
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toMatch(/^SKIP models: /);
    expect(out).not.toContain('ghost');
    expect(out).not.toContain('must never surface');
  });

  it('ignores an orphan registry even alongside a real lane\'s PASS', () => {
    const home = healthy('ccrc-doctor-models-orphan-alongside-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 60 });
    writeModelRegistry(home, 'ghost');
    writeModelCatalogue(home, 'ghost', { stale: true, lastError: 'must never surface' });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'models') ?? '';
    expect(line, out).toMatch(/^PASS models: /);
    expect(line).toContain('gpt');
    expect(line).not.toContain('ghost');
    expect(out).not.toContain('must never surface');
  });

  // ── R2 fix round 2, R1: the seven cases round 1 changed behaviour on
  // without adding a single `it(` for. Each was measured RED against
  // `git show 22033c6d:ccd/ccrc-doctor-checks` (kept outside the repo) before
  // this round's own edits — see partC-report.md for the paired before/after
  // runs. ──────────────────────────────────────────────────────────────────

  it('R1-1: a non-object catalogue on one lane never swallows a second lane\'s WARN (C2\'s own scenario)', () => {
    const home = healthy('ccrc-doctor-models-nonobject-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }, { id: 'grok', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'), 'null');
    writeModelRegistry(home, 'grok');
    writeModelCatalogue(home, 'grok', { stale: true, lastError: 'HTTP 401 unauthorized', fetchedAt: nowS() - 9 * 60 });
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toBeDefined();
    expect(any).not.toMatch(/^PASS models: 0 lanes,/);
    expect(out).toMatch(/grok/);
    expect(out).toMatch(/HTTP 401/);
  });

  // F2 (review run 69) — D-2380's class in this check's own new code. The
  // catalogue read opened BY NAME with no type test, so a FIFO blocked inside
  // `readFileSync`, the `catch` never ran, and `cmd_doctor` — which wraps no
  // deadline — hung whole. Bounded here so a regression is a readable failure.
  it.skipIf(DOCTOR_DEADLINE_BIN === null)(
    'F2: a FIFO at <id>.json is a BROKEN PATH, answered PROMPTLY — never a hang', () => {
      const home = healthy('ccrc-doctor-models-fifo-');
      writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
      writeModelRegistry(home, 'gpt');
      execFileSync('mkfifo', [join(home, '.ccrc', 'models', 'gpt.json')]);
      const out = runDoctorBounded(home).stdout;
      const lines = out.split('\n');
      const i = lines.findIndex((l) => l.startsWith('WARN models: '));
      expect(i, out).toBeGreaterThan(-1);
      // Same distinction R1-3 draws for EISDIR: a shape the probe cannot read
      // is a broken path, never "never probed".
      expect(lines[i]).not.toMatch(/never probed/);
      expect(lines[i]).toMatch(/broken path/);
    }, 20000);

  it.skipIf(DOCTOR_DEADLINE_BIN === null)(
    'F2: a symlink to a FIFO at <id>.json is a BROKEN PATH too — the type test follows the link, as bash `-f` does', () => {
      const home = healthy('ccrc-doctor-models-symfifo-');
      writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
      writeModelRegistry(home, 'gpt');
      const real = join(home, '.ccrc', 'models', 'gpt.real-fifo');
      execFileSync('mkfifo', [real]);
      symlinkSync(real, join(home, '.ccrc', 'models', 'gpt.json'));
      const out = runDoctorBounded(home).stdout;
      const lines = out.split('\n');
      const i = lines.findIndex((l) => l.startsWith('WARN models: '));
      expect(i, out).toBeGreaterThan(-1);
      expect(lines[i]).toMatch(/broken path/);
    }, 20000);

  it('F2: a DANGLING symlink at <id>.json is a broken path, NOT "never probed"', () => {
    // The distinction `lstat`-before-`stat` exists to keep: `statSync` alone
    // answers ENOENT for a dangling link exactly as it does for an absent
    // file, which would report a broken probe as a lane nobody has probed —
    // the very collapse C3's own comment refuses.
    const home = healthy('ccrc-doctor-models-dangling-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    symlinkSync(join(home, '.ccrc', 'models', 'gone.json'), join(home, '.ccrc', 'models', 'gpt.json'));
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).not.toMatch(/never probed/);
    expect(lines[i]).toMatch(/broken path/);
  });

  // F3 (review run 69) — the `lastError` sanitiser guards a PROVIDER-CONTROLLED
  // string against carrying the row/field terminators of the very protocol it
  // travels on, and every other fixture in this file plants clean text, which
  // is why the hole was invisible. Mutated (drop the `.replace`), the doctor
  // INVENTS A LANE that has no roster row and prints an operator-facing remedy
  // naming it.
  it('F3: a provider-controlled lastError carrying row/field terminators cannot invent a lane', () => {
    const home = healthy('ccrc-doctor-models-lasterror-inject-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', {
      stale: true, fetchedAt: nowS() - 60,
      lastError: 'HTTP 401\nphantom-lane\x1fOK\x1f\x1f0\x1f',
    });
    const out = runDoctor(home).stdout;
    // NOT a substring pin on `phantom-lane`: the token appears in BOTH the
    // shipped and the mutated output, because the sanitiser FLATTENS the
    // terminators rather than dropping the text, and the operator is still
    // shown the provider's message verbatim-but-flattened. Measured shipped:
    // `WARN models: gpt's catalogue is stale (1 min old): HTTP 401
    // phantom-lane OK  0  — …` — one lane, one row. What the mutation adds is
    // a SECOND ROW parsed out of the injected newline, i.e. a LANE, with its
    // own verdict and its own remedy. So bind the lane, not the substring.
    const modelWarns = out.split('\n').filter((l) => l.startsWith('WARN models: '));
    expect(modelWarns.length, out).toBe(1);
    expect(modelWarns[0]).toContain('gpt');
    expect(modelWarns[0]).toContain('HTTP 401');
    expect(out, 'no verdict may be attributed to a lane with no roster row')
      .not.toMatch(/phantom-lane's catalogue/);
    expect(out, 'no remedy may name a lane this box does not have')
      .not.toMatch(/ccrc models refresh phantom-lane/);
  });

  // F3 — the 0x1F DELIMITER, which was shipped as this wave's own remedy
  // against D-71 and which the reviewer measured GREEN when reverted to a TAB
  // in BOTH halves. This is the fixture its own comment describes and no test
  // planted: an OK row whose `fetchedAt` is ABSENT, so the reader emits an
  // EMPTY field between two delimiters.
  it('F3: an OK row with an ABSENT fetchedAt keeps its columns — the 0x1F delimiter, pinned', () => {
    const home = healthy('ccrc-doctor-models-emptyfield-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    // `writeModelCatalogue` DEFAULTS `fetchedAt` to now, so the key is written
    // out by hand here — absent, not zero.
    writeFileSync(join(home, '.ccrc', 'models', 'gpt.json'),
      JSON.stringify({ probe: 'codex', stale: true, lastError: 'boom', models: [] }));
    const out = runDoctor(home).stdout;
    const warns = out.split('\n').filter((l) => l.startsWith('WARN models: '));
    expect(warns.length, out).toBe(1);
    // Under a TAB protocol `read` collapses the run of separators (a tab is
    // IFS whitespace whatever IFS is set to), so this row comes back as
    // fa="1" stale="boom" — every later column shifted LEFT, and the verdict
    // becomes a confident age computed out of the STALE FLAG.
    expect(warns[0]).toMatch(/not a usable whole-second timestamp/);
    expect(warns[0], 'a shifted column would compute an age from the stale flag').not.toMatch(/min old/);
  });

  // F3 — `Number.isInteger`. Recorded as an EQUIVALENT mutant rather than
  // pinned, with the control that proves it: the refusal below survives
  // dropping the node-side check, because the BASH side re-validates the
  // string it receives (`[[ "$fa" =~ ^-?[0-9]+$ ]]`) and that is what actually
  // refuses a float. `String(1789000000.5)` is `"1789000000.5"`, which that
  // regex rejects; the node check is belt to the bash braces, exactly as its
  // own comment claims. This case pins the mechanism that DOES decide.
  it('F3: a FLOAT fetchedAt is refused — by the bash re-validation, which is the real gate', () => {
    const home = healthy('ccrc-doctor-models-float-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 60.5 });
    const out = runDoctor(home).stdout;
    const warns = out.split('\n').filter((l) => l.startsWith('WARN models: '));
    expect(warns.length, out).toBe(1);
    expect(warns[0]).toMatch(/not a usable whole-second timestamp/);
  });

  // R1 (review run 69), RULED closed by the coordinator against its own panel.
  it('R1: the catalogue reader exiting ZERO with no rows is not a PASS either', () => {
    const home = healthy('ccrc-doctor-models-readersilent-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 60 });
    stubNodeModelsExit(home, 0);
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toBeDefined();
    expect(any).not.toMatch(/^PASS models: /);
    expect(any, 'the forbidden string this rung exists to prevent').not.toMatch(/^PASS models: 0 lanes,/);
  });

  it('R1-2: the batched catalogue reader exiting non-zero is not a PASS', () => {
    const home = healthy('ccrc-doctor-models-readerdown-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 60 });
    stubNodeModelsExit(home, 7);
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toBeDefined();
    expect(any).not.toMatch(/^PASS models: /);
  });

  it('R1-3: a directory at <id>.json (EISDIR) gets a sentence distinct from never-probed', () => {
    const home = healthy('ccrc-doctor-models-eisdir-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    mkdirSync(join(home, '.ccrc', 'models', 'gpt.json'));
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).not.toMatch(/never probed/);
    expect(lines[i]).toMatch(/broken path/);
  });

  it.skipIf(process.getuid?.() === 0)(
    'R1-4: an unreadable <id>.json (EACCES) gets its own sentence too', () => {
    const home = healthy('ccrc-doctor-models-eacces-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() - 60 });
    chmodSync(join(home, '.ccrc', 'models', 'gpt.json'), 0o000);
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).not.toMatch(/never probed/);
    expect(lines[i]).toMatch(/broken path/);
  });

  it('R1-5: a non-integer fetchedAt (float, numeric string, or 1e21) completes the run with its own verdict, never a bash arithmetic crash', () => {
    const home = healthy('ccrc-doctor-models-noninteger-');
    writeRoster(home, [
      { id: 'aaa', exec: { kind: 'external' } },
      { id: 'bbb', exec: { kind: 'external' } },
      { id: 'ccc', exec: { kind: 'external' } },
    ]);
    for (const id of ['aaa', 'bbb', 'ccc']) writeModelRegistry(home, id);
    writeFileSync(join(home, '.ccrc', 'models', 'aaa.json'),
      JSON.stringify({ probe: 'codex', fetchedAt: 1789000000.5, stale: false, models: [] }));
    writeFileSync(join(home, '.ccrc', 'models', 'bbb.json'),
      JSON.stringify({ probe: 'codex', fetchedAt: '1789000000', stale: false, models: [] }));
    writeFileSync(join(home, '.ccrc', 'models', 'ccc.json'),
      JSON.stringify({ probe: 'codex', fetchedAt: 1e21, stale: false, models: [] }));
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN models: '));
    expect(i, out).toBeGreaterThan(-1);
    // N1 fix: scope to the models verdict line itself, not the whole doctor
    // stdout — the fixture's own roster makes the unrelated `wrappers` check
    // print every id too (`FAIL wrappers: aaa has no executable at …`), so
    // matching against `out` was tautological against the fixture and would
    // still pass even if `_check_models` warned about no lane at all.
    const verdict = lines[i];
    expect(verdict).toMatch(/aaa/);
    expect(verdict).toMatch(/bbb/);
    expect(verdict).toMatch(/ccc/);
    expect(out).not.toMatch(/^PASS models: 0 lanes,/m);
  });

  it('R1-6: a future fetchedAt gets the unmeasurable-age verdict, never a PASS', () => {
    const home = healthy('ccrc-doctor-models-future-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelCatalogue(home, 'gpt', { fetchedAt: nowS() + 99999999 });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'models');
    expect(line, out).not.toMatch(/^PASS models: /);
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toMatch(/^WARN models: /);
    expect(out).toMatch(/future/);
  });

  it('R1-7 / R3(b): a status the case does not recognize gets its own verdict, never a silent PASS 0 lanes over a non-empty population', () => {
    const home = healthy('ccrc-doctor-models-unknownstatus-');
    writeRoster(home, [{ id: 'gpt', exec: { kind: 'external' } }, { id: 'grok', exec: { kind: 'external' } }]);
    writeModelRegistry(home, 'gpt');
    writeModelRegistry(home, 'grok');
    stubNodeModelsWeirdStatus(home);
    const out = runDoctor(home).stdout;
    const any = anyVerdictFor(out, 'models');
    expect(any, out).toBeDefined();
    // N2 fix: pin the VERDICT CLASS, not just that a non-"0 lanes" line
    // exists — the default arm's whole point is that an unrecognized status
    // must be treated as unmeasurable, i.e. it must WARN. A default arm that
    // filed the row under `ok` instead (still reporting a nonzero lane
    // count, just as a false PASS) used to slip past the old assertion.
    expect(any).toMatch(/^WARN models: /);
  });
});


describe('ccrc doctor: accounts', () => {
  const COMPATIBLE: RosterEntry = {
    id: 'orchard-api', configDirSuffix: '.claude-orchard-api',
    exec: {
      kind: 'generated', provider: 'compatible',
      baseUrl: 'https://orchard-api/api/v1',
      secretsFile: '.cc-secrets/orchard-api-compatible.env',
    },
  };

  const plantSecret = (home: string, rel: string): void => {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, rel), 'export X=y\n', { mode: 0o600 });
  };

  it('is in the table and has a function — both directions', () => {
    expect(tableNames()).toContain('accounts');
  });

  it('PASSES on a healthy box, naming the axes it measured — not the bare word ok', () => {
    // `healthy()`'s contract is that every check passes, and the summary case
    // asserts "0 warned" on exactly this fixture.
    const home = healthy('ccrc-doctor-accounts-ok-');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'accounts');
    expect(line, out).toMatch(/^PASS accounts: /);
    expect(line).toContain('1 account');
    expect(line).toContain('0 declared credential file');
    expect(line, 'the bare word ok is not a measurement').not.toMatch(/: ok$/);
  });

  it('WARNS on a declared credential file that is not there, naming the PATH and no byte of it', () => {
    const home = healthy('ccrc-doctor-accounts-cred-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      { id: 'alt-max', configDirSuffix: '.claude-alt-max',
        exec: { kind: 'generated', provider: 'anthropic',
          secretsFile: '.cc-secrets/alt-max-oauth.env' } },
    ]);
    writeWrapper(home, 'alt-max', { cfgDir: '.claude-alt-max' });
    const out = runDoctor(home).stdout;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN accounts: '));
    expect(i, out).toBeGreaterThan(-1);
    expect(lines[i]).toContain('credential-declared-absent');
    expect(lines[i]).toContain('.cc-secrets/alt-max-oauth.env');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('says nothing about a credential file that IS there, and never opens it', () => {
    const home = healthy('ccrc-doctor-accounts-cred-ok-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      { id: 'alt-max', configDirSuffix: '.claude-alt-max',
        exec: { kind: 'generated', provider: 'anthropic',
          secretsFile: '.cc-secrets/alt-max-oauth.env' } },
    ]);
    writeWrapper(home, 'alt-max', { cfgDir: '.claude-alt-max' });
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    // A canary INSIDE the 0600 file: nothing doctor prints may contain it.
    // This is CLAUDE.md's "existence checks by ls only" as a mechanism.
    writeFileSync(join(home, '.cc-secrets', 'alt-max-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-CANARY-0000\n', { mode: 0o600 });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
    expect(r.stdout + r.stderr, 'doctor opened a 0600 credential file').not.toContain('sk-ant-CANARY-0000');
  });

  it('WARNS when a lane\'s settings.json env block names a different endpoint', () => {
    const home = healthy('ccrc-doctor-accounts-drift-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      COMPATIBLE,
    ]);
    writeWrapper(home, 'orchard-api', { cfgDir: '.claude-orchard-api' });
    plantSecret(home, '.cc-secrets/orchard-api-compatible.env');
    writeSettingsEnv(home, '.claude-orchard-api',
      { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8642', ANTHROPIC_API_KEY: '' });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'accounts');
    expect(line, out).toMatch(/^WARN accounts: /);
    expect(line).toContain('settings-env-drift');
    expect(line).toContain('orchard-api');
    // The endpoint is ROSTER DATA and is shown. The key's value never is, and
    // there is none here — the block this design writes leaves it empty.
    expect(line).toContain('127.0.0.1:8642');
  });

  it('says nothing when the env block agrees with the roster', () => {
    const home = healthy('ccrc-doctor-accounts-agree-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      COMPATIBLE,
    ]);
    writeWrapper(home, 'orchard-api', { cfgDir: '.claude-orchard-api' });
    plantSecret(home, '.cc-secrets/orchard-api-compatible.env');
    writeSettingsEnv(home, '.claude-orchard-api',
      { ANTHROPIC_BASE_URL: 'https://orchard-api/api/v1', ANTHROPIC_API_KEY: '' });
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'accounts'), out).toMatch(/^PASS accounts: /);
  });

  it('does not report launcher-absent — the wrappers check owns that fact', () => {
    // ONE FACT, ONE VERDICT LINE. `_check_wrappers`' external arm already
    // reports a missing launcher, and this file's own `_check_tmux_skew` is the
    // standing ruling against a second verdict for one finding.
    const home = healthy('ccrc-doctor-accounts-nolauncher-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      { id: 'gpt', configDirSuffix: '.claude-gpt', exec: { kind: 'external' } },
    ]);
    const out = runDoctor(home).stdout;
    expect(lineFor(out, 'wrappers'), out).toMatch(/^FAIL wrappers: /);
    expect(lineFor(out, 'accounts'), out).toMatch(/^PASS accounts: /);
    expect(out, 'one finding got two verdict lines').not.toContain('launcher-absent');
  });

  it('WARNS — never SKIPS — on a box with no roster at all', () => {
    // THE POINTER LIVES ON THE REMEDY LINE. `_dr_warn` prints its third
    // argument on the line AFTER the verdict, and `lineFor` matches the verdict
    // line alone — so asserting the pointer on the verdict would be red against
    // a check that is behaving correctly.
    const home = broken('ccrc-doctor-accounts-noroster-');
    const out = runDoctor(home).stdout;
    expect(out, 'a box with no accounts surface is where a SKIP helps least')
      .not.toMatch(/^SKIP accounts:/m);
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN accounts: '));
    expect(i, out).toBeGreaterThan(-1);
    // The verdict names the file it could not read and what went unmeasured…
    expect(lines[i]).toContain('.ccrc/accounts.json');
    expect(lines[i]).toContain('credential');
    // …and the remedy, one line down, names the check that DOES judge a roster.
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[i + 1]).toContain('wrappers');
  });

  it('measures a roster this check is not the judge of — validation is the wrappers check\'s job', () => {
    // `writeRoster` writes id/configDirSuffix/exec and nothing else: no label,
    // no homeAble, no telemetry. `rosterFromJson` REFUSES that shape, and
    // `healthy()` builds its roster with it — so a check that validated through
    // the parser would WARN on every fixture in this file, including the one
    // the summary case asserts zero warnings on. `_check_wrappers` reads the
    // same file with its own lax reader for exactly this reason.
    const home = healthy('ccrc-doctor-accounts-lax-');
    writeRoster(home, [
      { id: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' } },
      { id: 'alt-max', configDirSuffix: '.claude-alt-max',
        exec: { kind: 'generated', provider: 'anthropic',
          secretsFile: '.cc-secrets/alt-max-oauth.env' } },
    ]);
    writeWrapper(home, 'alt-max', { cfgDir: '.claude-alt-max' });
    plantSecret(home, '.cc-secrets/alt-max-oauth.env');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'accounts');
    expect(line, out).toMatch(/^PASS accounts: /);
    expect(line).toContain('2 account');
    expect(line).toContain('1 declared credential file');
  });

  // ── a codex lane (Plan 3a Task 3, R-C7) ─────────────────────────────────
  // `_check_accounts` ALONE, out of the fixture box's own tree: every case
  // below has a codex row in its roster, and a whole `ccrc doctor` would run
  // every other check against that row — including the codex check a later
  // task of this plan adds, which connects to a lane's ports. This check
  // opens no socket, so its cases run it on its own; 45010/45011/45020 are
  // the pure-parse port vocabulary of `codexAccountsBox`, below. Never Task
  // 4's `healthyCodexBox`, which becomes an async lane on FREE ports.
  // Sourced from the fixture's own `ccd/`, so `CCRC_HERE` is the fixture
  // tree and `account-op.mjs` is the copy `installCcrc` planted.
  const accountsOnly = (home: string): Result => {
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _check_accounts`],
      { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const CODEX_DIR = '.claude-codex-a';
  /** A healthy box plus one codex lane on the pure-parse pair and its
   *  launcher: the base tree's `healthyCodexBox` shape, kept here so Task 4's
   *  rewrite of that fixture (async, free ports) cannot move these cases. */
  const codexAccountsBox = (prefix: string): string => {
    const home = healthy(prefix);
    writeRoster(home, [{
      id: 'codex-a', configDirSuffix: CODEX_DIR,
      exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' },
      telemetry: 'codex',
    }]);
    writeWrapper(home, 'codex-a', { cfgDir: CODEX_DIR, target: 'ccrc-codex' });
    return home;
  };

  it('a codex lane whose env block has no ANTHROPIC_BASE_URL passes, and is counted — its launcher exports the endpoint', () => {
    const home = codexAccountsBox('ccrc-doctor-accounts-codex-absent-');
    writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_MODEL: 'gpt-x' });
    const r = accountsOnly(home);
    const line = lineFor(r.stdout, 'accounts');
    expect(line, r.stdout).toMatch(/^PASS accounts: /);
    expect(line).toContain('1 provider env block');
    expect(r.code).toBe(0);
  });

  it('a codex lane whose settings.json has no env block at all passes too', () => {
    const home = codexAccountsBox('ccrc-doctor-accounts-codex-noblock-');
    mkdirSync(join(home, CODEX_DIR), { recursive: true });
    writeFileSync(join(home, CODEX_DIR, 'settings.json'), '{}\n');
    const r = accountsOnly(home);
    expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
    expect(r.code).toBe(0);
  });

  it('a codex lane whose env names its own loopback shim passes', () => {
    const home = codexAccountsBox('ccrc-doctor-accounts-codex-equal-');
    writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45010' });
    const r = accountsOnly(home);
    const line = lineFor(r.stdout, 'accounts');
    expect(line, r.stdout).toMatch(/^PASS accounts: /);
    expect(line).toContain('1 provider env block');
  });

  it('a codex lane whose env names any other endpoint WARNS settings-env-drift, naming both and the hand remedy', () => {
    const home = codexAccountsBox('ccrc-doctor-accounts-codex-drift-');
    writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
    const r = accountsOnly(home);
    expect(r.code).toBe(2);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN accounts: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('settings-env-drift: codex-a');
    expect(lines[i]).toContain('http://127.0.0.1:45020');
    expect(lines[i]).toContain('loopback shim http://127.0.0.1:45010');
    expect(lines[i]).toContain('delete it from the env block by hand');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('a codex row with no usable proxyPort is not this check\'s to judge: no finding, and no endpoint invented', () => {
    const home = healthy('ccrc-doctor-accounts-codex-noport-');
    writeRoster(home, [{
      id: 'codex-a', configDirSuffix: CODEX_DIR,
      exec: { kind: 'codex', provider: 'openai', litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' },
      telemetry: 'codex',
    }]);
    writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
    const r = accountsOnly(home);
    expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
    expect(r.stdout).not.toContain('undefined');
  });

  it('an external row in the live Codex lanes\' shape is judged exactly as before: the arm keys on exec.kind, never provider or telemetry', () => {
    // `ext-a` is a fixture id in the shape the live lanes had before the
    // cutover (external, provider openai, telemetry codex; retired by Plan 4;
    // the title keeps the words spec §20.10 quotes) — plus a hand-edited
    // proxyPort the parser would refuse on this kind, so an arm keyed on
    // anything but `exec.kind` WOULD build a loopback URL here and this case
    // would see it.
    const home = healthy('ccrc-doctor-accounts-codex-external-');
    writeRoster(home, [{
      id: 'ext-a', configDirSuffix: '.claude-ext-a',
      exec: { kind: 'external', provider: 'openai', proxyPort: 45010 }, telemetry: 'codex',
    }]);
    writeSettingsEnv(home, '.claude-ext-a', { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
    const r = accountsOnly(home);
    expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
    expect(lineFor(r.stdout, 'accounts')).toContain('0 provider env block');
  });

  it('spells the vocabulary that shared/providers.ts defines, and no other code', () => {
    // The three codes are ONE definition — `ACCOUNT_FINDINGS` in
    // `shared/providers.ts` — and `deploy/account-op.mjs` is a bare-node module
    // that cannot import the TypeScript one. The copy is kept honest by
    // comparison rather than by promise, and this is the only scan that can see
    // `deploy/` at all: `single-definition.test.ts` filters `/\.tsx?$/`. The
    // scrape is over the CODES rather than over either identifier, so it stays
    // true whatever the two constants are named.
    const ts = readFileSync(join(REPO, 'shared', 'providers.ts'), 'utf8');
    const mjs = readFileSync(join(REPO, 'deploy', 'account-op.mjs'), 'utf8');
    const codes = (src: string): string[] =>
      [...src.matchAll(/'(credential-declared-absent|settings-env-drift|launcher-absent)'/g)]
        .map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i).sort();
    expect(codes(ts)).toEqual(['credential-declared-absent', 'launcher-absent',
      'settings-env-drift']);
    expect(codes(mjs), 'the helper emits a code the wrappers check already owns')
      .toEqual(['credential-declared-absent', 'settings-env-drift']);
  });
});


describe('ccrc doctor: memory (spec 2026-09-08 §4, task 4)', () => {
  it('PASSes on a box where every pair is converged — including the vacuous case of no agent homes at all', () => {
    const home = healthy('ccrc-doctor-mem-ok-');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS memory: /m);
  });

  // Not vacuous this time: a real symlink to a real, existing store. This is
  // the check's `-ef` comparison (see the function's own header comment) doing
  // its actual job rather than never firing — a mutation that broke `-ef`
  // into always-false would turn this PASS into a false FAIL.
  it('PASSes a genuinely converged pair, not just the vacuous no-homes case', () => {
    const home = healthy('ccrc-doctor-mem-converged-');
    const d = join(home, '.claude', 'projects', '-p-demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const store = join(home, '.ccrc', 'memory', '-p-demo');
    mkdirSync(store, { recursive: true });
    symlinkSync(store, join(d, 'memory'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS memory: /m);
  });

  // R20 (fix round 2, Important 1): a RELATIVE link that genuinely resolves
  // to the canonical store used to read as `forked` under a raw `readlink`
  // text comparison against the absolute store path — the memory really is
  // shared into the one store, only the link's own spelling differs. `-ef`
  // (device+inode, followed through the symlink) answers the real question
  // regardless of how the target is spelled.
  it('PASSes when a RELATIVE symlink correctly resolves to the canonical store (R20)', () => {
    const home = healthy('ccrc-doctor-mem-relative-');
    const d = join(home, '.claude', 'projects', '-p-demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const store = join(home, '.ccrc', 'memory', '-p-demo');
    mkdirSync(store, { recursive: true });
    symlinkSync(path.relative(d, store), join(d, 'memory'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^PASS memory: /m);
  });

  // R20 (fix round 2, Important 1 — the WORSE of the two measured bugs): a
  // link resolving to something that EXISTS but is a plain FILE, not a
  // directory, passed `-ef` alone while being just as unusable a memory
  // store as a dangling link — and it does not even LOOK dangling. `[ -d
  // "$store" ]` is what this test pins as a SEPARATE, independently mutable
  // conjunct from `-ef`.
  it('WARNs (forked) when the store exists but is a regular FILE, not a directory (R20, R33)', () => {
    const home = healthy('ccrc-doctor-mem-store-is-file-');
    const d = join(home, '.claude', 'projects', '-p-demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const store = join(home, '.ccrc', 'memory', '-p-demo');
    mkdirSync(join(home, '.ccrc', 'memory'), { recursive: true });
    writeFileSync(store, '');   // the "store" is a FILE, not a directory
    symlinkSync(store, join(d, 'memory'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked across agent homes: .*\.claude:-p-demo/m);
  });

  it('WARNs and names the home and project when a pair is forked (plain directory, not a symlink) (R33)', () => {
    const home = healthy('ccrc-doctor-mem-fork-');
    const d = join(home, '.claude', 'projects', '-p-demo', 'memory');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'a.md'), 'x');
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked across agent homes: .*\.claude:-p-demo/m);
    const i = r.stdout.split('\n').findIndex((l) => l.startsWith('WARN memory:'));
    expect(r.stdout.split('\n')[i + 1]).toMatch(/^ {2}remedy: .*ccrc memory --apply/);
    // R33: a forked-only box is a WARN, not a FAIL — `ccrc update` (which ends
    // in `cmd_doctor`) must not hard-die over the expected pre-migration
    // state of a multi-home box.
    expect(r.stdout).not.toMatch(/^FAIL memory:/m);
    expect(r.code).toBe(0);
  });

  // R4: the brief's fork fixture seeds a plain DIRECTORY, which a mutation
  // that "treats any symlink as converged, ignoring the target" (M3) would
  // still fail correctly on, because a directory is not a symlink at all.
  // This fixture is the one M3 actually has to answer to: a symlink that
  // IS a symlink, but points at the wrong place.
  it('WARNs and names the pair when the symlink exists but points at the wrong target (R4, R33)', () => {
    const home = healthy('ccrc-doctor-mem-wrong-target-');
    const d = join(home, '.claude', 'projects', '-p-demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const elsewhere = join(home, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(d, 'memory'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked across agent homes: .*\.claude:-p-demo/m);
  });

  // R12 (review round 2, extended here from Task 2's `_mem_state`): a link
  // whose TEXT already names the canonical store, but whose store directory
  // does not exist, is NOT converged — `ccrc memory --apply` still has work
  // to do on it, and a doctor that PASSed here would be the exact silence
  // this task exists to remove, one layer down. This also exercises R10: a
  // dangling symlink like this one is invisible to a bare `[ -e "$link" ]`.
  it('WARNs, not PASSes, when the link already points at the correct store but the store does not exist (R12, R33)', () => {
    const home = healthy('ccrc-doctor-mem-dangling-');
    const d = join(home, '.claude', 'projects', '-p-demo');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const store = join(home, '.ccrc', 'memory', '-p-demo');
    symlinkSync(store, join(d, 'memory'));   // store deliberately never created
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked across agent homes: .*\.claude:-p-demo/m);
  });

  // R33 (controller ruling, whole-branch review Important — "none of
  // `_check_memory`'s three verdict→rc assignments has a red test"): each of
  // the three `rc=`/`[ "$rc" -eq 1 ] || rc=2` lines gets its own dedicated
  // fixture here, isolated so exactly one of the three findings fires, and
  // pins BOTH the printed verdict word AND `cmd_doctor`'s own worst-class
  // cross-check (`ccd/ccrc:2048`-`:2063`) — deleting any one of the three
  // lines leaves the WARN/FAIL text unchanged (that text is printed by
  // `_dr_warn`/`_dr_fail` unconditionally) but desyncs the check's return code
  // from what it printed, which `cmd_doctor` catches as a bug and reports as
  // an EXTRA `FAIL memory: the check exited …` line — invisible to a test
  // that only regexes for the original verdict line, which is exactly why
  // R21/R23's existing assertions above did not catch it.
  it('a forked-only box: WARN, no synthetic bug line, exit 0 (pins the forked rc=2 assignment)', () => {
    const home = healthy('ccrc-doctor-mem-rc-forked-');
    const d = join(home, '.claude', 'projects', '-p-demo', 'memory');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'a.md'), 'x');
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked/m);
    expect(r.stdout).not.toMatch(/^FAIL memory:/m);
    expect(r.stdout).not.toMatch(/the check exited/);
    expect(r.code).toBe(0);
  });

  it('an unreachable-only box: exactly one FAIL memory line, no synthetic bug line, exit 1 (pins the unreachable rc=1 assignment)', () => {
    const home = healthy('ccrc-doctor-mem-rc-unreach-');
    const h = join(home, '.claude-alt1');
    mkdirSync(join(h, 'projects'), { recursive: true });
    writeFileSync(join(h, 'settings.json'), '{}');
    const r = runDoctor(home);
    const failLines = r.stdout.split('\n').filter((l) => l.startsWith('FAIL memory:'));
    expect(failLines).toEqual(['FAIL memory: agent homes the session hook cannot reach, so they will fork on first use: .claude-alt1']);
    expect(r.stdout).not.toMatch(/the check exited/);
    expect(r.code).toBe(1);
  });

  it('an unmeasured-only box: WARN, no synthetic bug line, exit 0 (pins the unmeasured rc=2 assignment)', () => {
    const home = healthy('ccrc-doctor-mem-rc-unmeasured-');
    const h = join(home, '.claude-acme');
    mkdirSync(join(h, 'projects'), { recursive: true });
    const settings = join(h, 'settings.json');
    writeFileSync(settings, HOOKED_SETTINGS);
    chmodSync(settings, 0o000);
    try {
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^WARN memory: could not tell whether the session hook reaches/m);
      expect(r.stdout).not.toMatch(/^FAIL memory:/m);
      expect(r.stdout).not.toMatch(/the check exited/);
      expect(r.code).toBe(0);
    } finally {
      chmodSync(settings, 0o644);   // afterEach's rmSync must still be able to clean up
    }
  });

  it('FAILs differently for a home the session hook can never reach, and does not confuse it with a fork', () => {
    const home = healthy('ccrc-doctor-mem-unreach-');
    const h = join(home, '.claude-alt1');
    mkdirSync(join(h, 'projects'), { recursive: true });
    writeFileSync(join(h, 'settings.json'), '{}');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL memory: agent homes the session hook cannot reach.*\.claude-alt1/m);
    const i = r.stdout.split('\n').findIndex((l) => l.startsWith('FAIL memory:'));
    expect(r.stdout.split('\n')[i + 1]).toMatch(/^ {2}remedy: .*install-session-hooks\.sh/);
    // Pin that this is NOT the forked remedy — the two bodies must stay
    // distinguishable, which is the entire point of "three conditions never
    // two" (R13: a bare `/FAIL memory/` match would not catch a collapse).
    expect(r.stdout).not.toContain('ccrc memory --apply');
  });

  // R22 (fix round 2, Important 3): `install-session-hooks.sh (its hook write)` writes
  // `cur='{}'` and inserts the hook for ANY rostered home lacking a
  // settings.json at all — so absence itself proves the installer has never
  // touched this home, the MAXIMAL case of "will fork on first use". Measured
  // before this fix: `.claude-alt2/projects/` with no settings.json at all
  // read as `PASS memory: … every agent home converged`.
  it('reports a home unreachable when it has projects/ but no settings.json at all (R22)', () => {
    const home = healthy('ccrc-doctor-mem-no-settings-');
    const h = join(home, '.claude-alt2');
    mkdirSync(join(h, 'projects'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL memory: agent homes the session hook cannot reach.*\.claude-alt2/m);
  });

  // R23 Minor (fix round 2): "I could not read it" and "it is definitely not
  // wired" are different facts an operator fixes differently (a permissions
  // fix vs. a roster/settings.json edit) — D-1350's rule ("an adapter may not
  // narrow a distinction it received") applied to this check's own settings
  // .json read. An unreadable file must WARN as unmeasured, never silently
  // promote to the FAIL a confirmed-absent hook gets.
  //
  // THE STDERR ASSERTION IS THE OTHER HALF OF R23, and it is the half no
  // stdout assertion in this file can see. The pre-fix code attempted the
  // open and hung a `2>/dev/null` off the `done <` line to quieten it, which
  // does NOT work: redirections are set up left to right, so the trailing
  // `2>` is not yet in force when the `<` that precedes it fails, and bash's
  // own `Permission denied` diagnostic reaches the REAL stderr. Measured
  // standalone (fix round 1): `while … done < <mode-000 file> 2>/dev/null`
  // still prints `bash: line 1: …: Permission denied`. `[ -r … ]` refusing to
  // attempt the open at all is what makes the WARN path clean, so this test
  // pins the silence as well as the classification — without this line,
  // deleting `-r` reds only on the WARN and the leak rides along unmeasured.
  it('WARNs, not FAILs, when settings.json exists but cannot be read (R23)', () => {
    const home = healthy('ccrc-doctor-mem-unreadable-');
    const h = join(home, '.claude-acme');
    mkdirSync(join(h, 'projects'), { recursive: true });
    const settings = join(h, 'settings.json');
    writeFileSync(settings, HOOKED_SETTINGS);
    chmodSync(settings, 0o000);
    try {
      const r = runDoctor(home);
      expect(r.stderr).not.toMatch(/Permission denied/);
      expect(r.stdout).toMatch(/^WARN memory: could not tell whether the session hook reaches.*\.claude-acme/m);
      expect(r.stdout).not.toMatch(/^FAIL memory: agent homes the session hook cannot reach.*\.claude-acme/m);
    } finally {
      chmodSync(settings, 0o644);   // afterEach's rmSync must still be able to clean up
    }
  });

  // Guard test (Global Constraints: every guard ships with a red-when-deleted
  // test). A scratch slug is a cwd the harness mints for every directory a
  // session starts in; converging (or reporting) them would fill the census
  // with noise about directories nobody will ever read. Each fixture LOOKS
  // forked (a plain, non-symlink `memory` directory) and must never reach the
  // verdict.
  //
  // FOUR PREFIXES PLUS ONE INFIX, ONE RULE (D-2375, A4): `/tmp` on Linux, and
  // on Darwin `/private/tmp` plus a per-user `/var/folders/<x>/<y>/T`, plus a
  // marked child's own `$HOME/.cc-tmp/<id>`. `_check_memory` reads a
  // directory NAME, so all five are measurable on a Linux runner — unlike the
  // hook's own copy, which derives its slug from a live cwd and can only be
  // measured where it runs. That asymmetry is why the Linux-only spelling
  // survived to `test-macos`.
  for (const slug of SCRATCH_SLUGS) {
    it(`skips the scratch project slug ${slug} even when it looks forked`, () => {
      const home = healthy('ccrc-doctor-mem-tmp-skip-');
      const d = join(home, '.claude', 'projects', slug, 'memory');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'a.md'), 'x');
      writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^PASS memory: /m);
    });
  }

  // THE NEGATIVE CONTROL for that list. `/var/tmp` is POSIX *persistent*
  // scratch, not the OS scratch root, and it is where `session-hook.test.ts`
  // roots every project fixture it owns — so a widening that swept it up would
  // hide a real fork from the operator, which is the one thing this check
  // exists to report. Without this row, widening the list has no upper bound
  // any suite can see.
  for (const slug of PERSISTENT_SLUGS) {
    it(`still WARNs about a forked ${slug} — persistent scratch is not the scratch root`, () => {
      const home = healthy('ccrc-doctor-mem-vartmp-');
      const d = join(home, '.claude', 'projects', slug, 'memory');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'a.md'), 'x');
      writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(
        new RegExp(`^WARN memory: memory is forked across agent homes: .*\\.claude:${slug}`, 'm'));
    });
  }

  // `.claude-docs-preview` is NO LONGER special-cased (Minor, whole-branch
  // review round 3 — reached independently for this file's own reason, see
  // `_check_memory`'s comments in ccd/ccrc-doctor-checks): hard-coding a
  // single operator's box-local tool name into shipped, public-release-bound
  // source is the residue class CLAUDE.md bans, and on every measured box the
  // exclusion excluded nothing the generic `[ -d "${h}projects" ]` guard did
  // not already exclude. So a `.claude-docs-preview`-named directory is now
  // examined like any other `.claude*` home — this test used to pin a PASS
  // here (the old guard test) and now pins the opposite: a `projects/` dir
  // under that name is real evidence, and doctor reports it like it would for
  // any other home.
  it('no longer special-cases .claude-docs-preview — a forked pair there is reported like any other home', () => {
    const home = healthy('ccrc-doctor-mem-docserver-skip-');
    const d = join(home, '.claude-docs-preview', 'projects', '-p-demo', 'memory');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'a.md'), 'x');
    writeFileSync(join(home, '.claude-docs-preview', 'settings.json'), HOOKED_SETTINGS);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN memory: memory is forked across agent homes: .*\.claude-docs-preview:-p-demo/m);
  });

  // R21 (fix round 2, Important 2): round 1's "emit exactly one verdict line"
  // instruction was wrong twice over — `cmd_doctor` counts verdict LINES, not
  // a fixed arity per check, and this file's own header already rules that
  // two distinct hard findings are two distinct operator actions and get two
  // lines, each with its own remedy. A fork on one home and an unreachable
  // finding on an unrelated home are independent facts; dropping either one
  // to keep to "one line" is exactly the silence this task exists to end.
  //
  // SINCE R33 THIS IS A WARN LINE AND A FAIL LINE, not two FAILs: forked is
  // demoted, unreachable is not, and the worst-class cross-check
  // (`ccd/ccrc:2048`-`:2063`) still has to pick FAIL as the check's return
  // code — this test pins that too (`r.code`), which the pre-R33 version of
  // this test never needed to.
  it('prints a WARN line and a FAIL line, each with its own remedy, when a box is both forked and unreachable (R33)', () => {
    const home = healthy('ccrc-doctor-mem-both-');
    const forkedDir = join(home, '.claude', 'projects', '-p-demo', 'memory');
    mkdirSync(forkedDir, { recursive: true });
    writeFileSync(join(forkedDir, 'a.md'), 'x');
    writeFileSync(join(home, '.claude', 'settings.json'), HOOKED_SETTINGS);
    const h = join(home, '.claude-alt1');
    mkdirSync(join(h, 'projects'), { recursive: true });
    writeFileSync(join(h, 'settings.json'), '{}');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const verdictLines = lines.filter((l) => /^(PASS|WARN|FAIL|SKIP) memory: /.test(l));
    expect(verdictLines.length).toBe(2);
    const forkedIdx = lines.findIndex((l) => l.startsWith('WARN memory: memory is forked across agent homes:'));
    const unreachIdx = lines.findIndex((l) => l.startsWith('FAIL memory: agent homes the session hook cannot reach'));
    expect(forkedIdx).toBeGreaterThanOrEqual(0);
    expect(unreachIdx).toBeGreaterThanOrEqual(0);
    expect(lines[forkedIdx]).toContain('.claude:-p-demo');
    expect(lines[unreachIdx]).toContain('.claude-alt1');
    expect(lines[forkedIdx + 1]).toMatch(/^ {2}remedy: .*ccrc memory --apply/);
    expect(lines[unreachIdx + 1]).toMatch(/^ {2}remedy: .*install-session-hooks\.sh/);
    expect(r.stdout).not.toMatch(/the check exited/);
    expect(r.code).toBe(1);
  });
});


describe('ccrc doctor: docs', () => {
  it('is in the table, right after codex', () => {
    const names = tableNames();
    expect(names).toContain('docs');
    expect(names.indexOf('docs')).toBe(names.indexOf('codex') + 1);
  });

  it('PASSES on the healthy box, reporting counts only', () => {
    const { n, k, u } = docsCounts(DOCS_INDEX_READY);
    // The fixture's premise, checked rather than assumed: more rows than
    // served ones (so "K served" cannot be "N rows" mislabelled), at least one
    // served, none unreadable.
    expect(n).toBeGreaterThan(k);
    expect(k).toBeGreaterThan(0);
    expect(u).toBe(0);
    const r = runDoctor(healthy('ccrc-doctor-docs-pass-'));
    expect(docsVerdict(r.stdout).line, r.stdout)
      .toBe(`PASS docs: ${n} projects under ccd's projects root, ${k} served by Docs`);
  });

  it.each([
    ['ready', DOCS_INDEX_READY, 'PASS'],
    ['unreadable', DOCS_INDEX_UNREADABLE, 'WARN'],
  ] as const)('never prints a project name (%s answer)', (label, fixture, verdict) => {
    // SENTINEL names, planted into the canned answer: the CONTROL proves they
    // really are in what ccd prints, so their absence from doctor's stdout is
    // the check's doing, not an accident of the fixture.
    const named = {
      ...fixture,
      projects: fixture.projects.map((p, i) => ({ ...p, project: `docs-sentinel-${label}-${i}` })),
    };
    const script = docsIndexStubScript(JSON.stringify(named));
    expect(named.projects.length).toBeGreaterThan(0);
    for (const p of named.projects) expect(script).toContain(`"project":"${p.project}"`);
    const home = healthy(`ccrc-doctor-docs-names-${label}-`);
    plantDocsCcd(home, script);
    const r = runDoctor(home);
    expect(docsVerdict(r.stdout).line, r.stdout).toMatch(new RegExp(`^${verdict} docs: `));
    expect(r.stdout).not.toContain('docs-sentinel');
  });

  it('WARNS on a repo-unreadable row, with the one-liner that lists them', () => {
    const { n, k, u } = docsCounts(DOCS_INDEX_UNREADABLE);
    expect(u).toBeGreaterThan(0);   // the fixture's premise
    const home = healthy('ccrc-doctor-docs-unreadable-');
    plantDocsCcd(home, docsIndexStubScript(JSON.stringify(DOCS_INDEX_UNREADABLE)));
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout)
      .toBe(`WARN docs: ${n} projects under ccd's projects root, ${k} served by Docs, ${u} unreadable`);
    expect(v.next)
      .toBe(`  remedy: ccd docs-index --all | jq -r '.projects[] | select(.state=="repo-unreadable") | .project'`);
    expect(r.stdout).not.toMatch(/^FAIL docs: /m);
  });

  it('WARNS, never FAILS, when the index walk left projects unchecked (unwalked), counting them', () => {
    // docs-index's answer carries `unwalked` (only when above 0): the projects
    // its walk did not reach before its helper deadline. Rows are intact, so
    // the box answers Docs; the count line says how many were not checked.
    const { n, k } = docsCounts(DOCS_INDEX_READY);
    const unwalked = 3;
    const home = healthy('ccrc-doctor-docs-unwalked-');
    plantDocsCcd(home, docsIndexStubScript(JSON.stringify({ ...DOCS_INDEX_READY, unwalked })));
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout)
      .toBe(`WARN docs: ${n} projects under ccd's projects root, ${k} served by Docs, ${unwalked} not checked (time budget)`);
    expect(v.next).toMatch(/^ {2}remedy: \S/);
    expect(r.stdout).not.toMatch(/^FAIL docs: /m);
  });

  it.each([
    ['python-missing', DOCS_HELPER_UNAVAILABLE_MISSING_LINE],
    ['python-too-old', DOCS_HELPER_UNAVAILABLE_MISSING_LINE.replace('"python-missing"', '"python-too-old"')],
  ] as const)('FAILS naming python3 3.8 when ccd answers helper-unavailable (%s)', (detail, line) => {
    expect(line).toContain(`"detail":"${detail}"`);   // CONTROL: the replace above really happened
    const home = healthy(`ccrc-doctor-docs-${detail}-`);
    plantDocsCcd(home, docsIndexStubScript(line));
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout)
      .toMatch(/^FAIL docs: ccd answers docs-index with helper-unavailable: .* — its Docs helper needs python3 3\.8 or newer$/);
    expect(v.line).toContain(`(${detail})`);
    expect(v.next).toMatch(/^ {2}remedy: install python3 3\.8 or newer /);
    expect(r.code).toBe(1);
  });

  it('FAILS naming the word on any other ok:false answer, and quotes none of its detail', () => {
    const home = healthy('ccrc-doctor-docs-helper-failed-');
    plantDocsCcd(home, docsIndexStubScript(JSON.stringify({
      v: 1, verb: 'docs-index', ok: false, elapsedMs: 3, failure: 'helper-failed',
      detail: 'RuntimeError: docs-detail-sentinel',
    })));
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout)
      .toBe("FAIL docs: ccd answers docs-index with helper-failed — Docs cannot list this box's projects");
    expect(v.line).not.toContain('python3');   // not the helper-unavailable arm
    expect(v.next).toMatch(/^ {2}remedy: \S/);
    expect(r.stdout).not.toContain('docs-detail-sentinel');
  });

  it('PASSES when ccd also writes to stderr: the two streams are never merged', () => {
    const home = healthy('ccrc-doctor-docs-stderr-');
    plantDocsCcd(home,
      `#!/bin/sh\necho 'docs-stderr-sentinel' >&2\nprintf '%s\\n' '${JSON.stringify(DOCS_INDEX_READY)}'\n`);
    const r = runDoctor(home);
    expect(docsVerdict(r.stdout).line, r.stdout).toMatch(/^PASS docs: /);
    expect(r.stdout).not.toContain('docs-stderr-sentinel');
  });

  it('FAILS naming jq, not the answer, when jq is not on PATH', () => {
    const home = healthy('ccrc-doctor-docs-no-jq-');
    unstub(home, 'jq');
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout).toBe("FAIL docs: jq is not on PATH, so ccd's docs-index answer cannot be read");
    expect(v.next).toBe("  remedy: install jq first — see the 'jq' check above");
  });

  it('quotes a hostile stderr line literally: the capture executes nothing it reads', () => {
    // `$(...)`, backquotes, a double quote and a trailing backslash: every
    // shape an unquoted re-read would run or mangle. The payload creates its
    // marker with `: >`, a shell builtin, because this PATH has no `touch`: a
    // payload that could not run anyway would prove nothing by not running.
    const home = healthy('ccrc-doctor-docs-hostile-');
    const pwned = join(home, 'docs-pwned');
    expect(existsSync(pwned)).toBe(false);
    const hostile = 'boom $(: > "$HOME/docs-pwned") `: > "$HOME/docs-pwned"` "q" \\';
    plantDocsCcd(home, `#!/bin/sh\nprintf '%s\\n' '${hostile}' >&2\nexit 2\n`);
    const v = docsVerdict(runDoctor(home).stdout);
    expect(v.line).toBe(`FAIL docs: ccd could not run docs-index (rc 2: ${hostile}); it predates Docs or died`);
    expect(existsSync(pwned)).toBe(false);
  });

  it("FAILS 'predates' on an old ccd's usage refusal, quoting at most 200 bytes of its stderr", () => {
    // An old ccd's unknown-verb arm: exactly rc 1 with `usage: ccd {...}` on
    // stderr. Longer than 200 bytes, so the bound has something to cut.
    const usage = `usage: ccd {${Array.from({ length: 40 }, (_, i) => `verb-${i}`).join('|')}|version}`;
    expect(usage.length).toBeGreaterThan(200);
    const home = healthy('ccrc-doctor-docs-old-ccd-');
    plantDocsCcd(home, `#!/bin/sh\nprintf '%s\\n' '${usage}' >&2\nexit 1\n`);
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    const m = /^FAIL docs: ccd could not run docs-index \(rc 1: (.*)\); it predates Docs or died$/.exec(v.line);
    expect(m, r.stdout).toBeTruthy();
    expect(m?.[1]).toBe(usage.slice(0, 200));
    expect(v.next).toBe('  remedy: ccrc update');
  });

  it('FAILS "did not answer" when ccd outlives CCRC_DOCTOR_DOCS_TIMEOUT', () => {
    // Bounded by the check's OWN deadline, the tmux_skew wedge case's idiom:
    // the stub sleeps 5 s and the knob says 1.
    const home = healthy('ccrc-doctor-docs-slow-');
    linkReal(home, 'sleep');
    plantDocsCcd(home, '#!/bin/sh\nexec sleep 5\n');
    const r = runDoctor(home, ['doctor'], { CCRC_DOCTOR_DOCS_TIMEOUT: '1' });
    const v = docsVerdict(r.stdout);
    expect(v.line, r.stdout).toBe('FAIL docs: ccd docs-index did not answer within 1 s');
    expect(v.next).toMatch(/^ {2}remedy: \S/);
  });

  it.each([
    ['not JSON', '#!/bin/sh\necho not json\n'],
    ['nothing at all', '#!/bin/sh\nexit 0\n'],
    ['two answers', `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(DOCS_INDEX_READY)}' '${JSON.stringify(DOCS_INDEX_READY)}'\n`],
    ['wire v 2', docsIndexStubScript(JSON.stringify({ ...DOCS_INDEX_READY, v: 2 }))],
    ['another verb', docsIndexStubScript(JSON.stringify({ ...DOCS_INDEX_READY, verb: 'docs-tree' }))],
    ['ok:true with no projects list', docsIndexStubScript('{"v":1,"verb":"docs-index","ok":true,"elapsedMs":0}')],
    ['ok neither true nor false', docsIndexStubScript('{"v":1,"verb":"docs-index","ok":"yes","elapsedMs":0}')],
    ['a failure that is not a word',
      docsIndexStubScript('{"v":1,"verb":"docs-index","ok":false,"elapsedMs":0,"failure":"Not A Word"}')],
  ] as const)('FAILS on an answer that is not one docs-v1 object: %s', (label, script) => {
    const home = healthy('ccrc-doctor-docs-shape-');
    plantDocsCcd(home, script);
    const r = runDoctor(home);
    const v = docsVerdict(r.stdout);
    expect(v.line, `${label}\n${r.stdout}`)
      .toMatch(/^FAIL docs: ccd's docs-index answer is not one docs-v1 JSON object /);
    expect(v.next).toMatch(/^ {2}remedy: \S/);
    expect(r.stdout).not.toContain('Not A Word');
  });

  it("FAILS with remedy 'ccrc update' when there is no ccd at $HOME/.local/bin/ccd", () => {
    const home = healthy('ccrc-doctor-docs-no-ccd-');
    rmSync(docsCcd(home), { force: true });
    const v = docsVerdict(runDoctor(home).stdout);
    expect(v.line).toMatch(/^FAIL docs: no ccd at \$HOME\/\.local\/bin\/ccd, /);
    expect(v.next).toBe('  remedy: ccrc update');
  });

  it("FAILS with remedy 'ccrc update' when $HOME/.local/bin/ccd is not executable", () => {
    const home = healthy('ccrc-doctor-docs-noexec-ccd-');
    chmodSync(docsCcd(home), 0o644);
    const v = docsVerdict(runDoctor(home).stdout);
    expect(v.line).toMatch(/^FAIL docs: \$HOME\/\.local\/bin\/ccd is not an executable file, /);
    expect(v.next).toBe('  remedy: ccrc update');
  });

  it('SKIPS on a server-role box, with no remedy line, and never runs ccd', () => {
    // A RECORDING stub: `: >` is a shell builtin, so it needs nothing on PATH.
    const home = healthy('ccrc-doctor-docs-server-');
    const ran = join(home, 'docs-ccd-ran');
    plantDocsCcd(home,
      `#!/bin/sh\n: > "$HOME/docs-ccd-ran"\nprintf '%s\\n' '${JSON.stringify(DOCS_INDEX_READY)}'\n`);
    writeCcrcEnv(home,
      ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    let r = runDoctor(home);
    let v = docsVerdict(r.stdout);
    expect(v.line, r.stdout).toBe("SKIP docs: no ccd answers Docs here; the fleet box's doctor measures it");
    expect(v.next).not.toMatch(/^ {2}remedy:/);
    expect(existsSync(ran)).toBe(false);
    // CONTROL: the same box with no role recorded runs the same stub and
    // PASSES, so the SKIP was the role's doing and the marker can be written.
    writeCcrcEnv(home, ['CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    r = runDoctor(home);
    v = docsVerdict(r.stdout);
    expect(v.line, r.stdout).toMatch(/^PASS docs: /);
    expect(existsSync(ran)).toBe(true);
  });

  it("names the Docs helper in python3's reason, which the docs check does not replace", () => {
    // `_check_python3` stays a presence check (spec §7.2); only its reason
    // changes. The docs check still PASSES here, because the canned ccd needs
    // no python — the floor is measured through the verb, never twice.
    const home = healthy('ccrc-doctor-docs-python3-reason-');
    unstub(home, 'python3');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /^FAIL python3: not on PATH — ~\/\.local\/bin\/ccd is a standard-library python3 launcher in front of the bash body \(D-3696\), the graph engine's venv is built with it, and ccd's Docs helper needs python3 3\.8 or newer$/m);
    expect(docsVerdict(r.stdout).line).toMatch(/^PASS docs: /);
  });
});


describe('ccrc-doctor-checks cites deploy.sh by anchor, never by line (Plan 3a Task 4, 2b-2 carry-forward 11)', () => {
  // The seven citations this file carried by line number all pointed at
  // unrelated code when measured (six in the `deploy.sh:<N>` shape, one as
  // `deploy.sh` (:N, :M)). A quoted anchor cannot drift with the line it sits
  // on, and this pins that each one still exists in deploy.sh — so a
  // deploy.sh edit that removes one reds HERE, naming the citation to re-aim.
  const checks = readFileSync(CHECKS_SRC, 'utf8');
  const deploy = readFileSync(join(REPO, 'deploy', 'deploy.sh'), 'utf8');
  const ANCHORS = [
    'agent shared deploy ccd "$BOX":ccrc/',
    'server shared deploy ccd "$BOX":ccrc/',
    'mkdir -p ~/ccrc-backups/$TS',
    "AGENT_BUILD_CMD='_unit_atomic() {",
    '_unit_atomic ~/ccrc/deploy/systemd/ccd-pool-sync.timer',
    '_unit_atomic ~/ccrc/deploy/ccrc.service',
    '_unit_atomic ~/ccrc/deploy/ccrc-agent.service',
    '_unit_atomic ~/ccrc/deploy/systemd/ccd-cap-scopes.timer',
  ];

  it('no line cites deploy.sh by line number', () => {
    expect(checks.split('\n').filter((l) => /deploy\.sh[`']*(?::|\s*\(:)\d/.test(l))).toEqual([]);
  });

  it.each(ANCHORS)('the anchor %s is quoted here and still exists in deploy.sh', (a) => {
    expect(checks, 'ccrc-doctor-checks no longer quotes this anchor').toContain(a);
    expect(deploy, 'deploy.sh no longer carries this anchor: re-aim the citation in ccrc-doctor-checks').toContain(a);
  });
});