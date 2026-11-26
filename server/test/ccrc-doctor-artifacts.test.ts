// `ccrc doctor`, part: the artifact names (X5 A4.2). `name` resolves every host of CCRC_DDNS_DOMAIN's comma list, and `artifacts`
// judges the three keys `ccrc expose artifacts` writes, the Caddyfile block for the two hosts and the listener behind it.
// Hosts here are reserved test names, or `duckdns.org` names whose label is generated per run.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { installDoctorHooks, BASH, CHECKS_SRC, EXPOSED_HOST, ccrcIn, doctorEnv, healthy, runDoctor, lineFor, skipLineFor, remedyFor, writeExposureEnv, stub, stubBin, curlCalls, performCaddyCeremony } from './ccrc-doctorFixture.js';
import { ARTIFACT_NOT_FOUND_BODY } from '../src/artifacts/routes.js';

removeTmpFixturesEachTest();
installDoctorHooks();

interface Names { a: string; b: string; port: number }
const label = (): string => 't' + randomBytes(6).toString('hex');
const names = (): Names => ({ a: `${label()}.duckdns.org`, b: `${label()}.duckdns.org`, port: 7791 });

/** The three keys as `ccrc expose artifacts` writes them, appended to the fixture's exposure file; `omit` drops keys. */
function plantKeys(home: string, n: Names, omit: string[] = []): void {
  const rows: [string, string][] = [
    ['CCRC_ARTIFACT_ORIGIN', `https://${n.a}`], ['CCRC_ARTIFACT_CONTENT_ORIGIN', `https://${n.b}`], ['CCRC_ARTIFACT_PORT', String(n.port)]];
  appendFileSync(join(home, '.ccrc', 'exposure.env'), rows.filter(([k]) => !omit.includes(k)).map(([k, v]) => `${k}=${v}\n`).join(''));
}

/** The artifact block after the console's, in the shape the expose arm writes, then the ceremony again (the copy is current). */
function plantBlock(home: string, n: Names, port = n.port): void {
  appendFileSync(join(home, '.ccrc', 'Caddyfile'), `\n${n.a}, ${n.b} {\n    reverse_proxy 127.0.0.1:${port}\n}\n`);
  performCaddyCeremony(home);
}

/** A `curl` that answers the probe URL from `fixture-art-{code,body,exit}` and every other URL as the fixture's own stub does
 *  (renamed `curl-base`); every argv is logged. Builtins only: this PATH holds no system directory. */
function stubProbe(home: string, port: number, answer: { code?: number; body?: string; exit?: number }): void {
  const base = join(stubBin(home), 'curl-base');
  if (!existsSync(base)) renameSync(join(stubBin(home), 'curl'), base);   // the first call only: later ones replace the probe stub
  stub(home, 'curl', [
    'printf \'%s\\n\' "$*" >> "$HOME/curl-calls"',
    'url=; for a in "$@"; do url="$a"; done',
    `if [ "$url" = "http://127.0.0.1:${port}/" ]; then`,
    '  if [ -f "$HOME/fixture-art-exit" ]; then read -r c < "$HOME/fixture-art-exit"; echo "curl: ($c) fixture" >&2; exit "$c"; fi',
    // A per-Host answer (`fixture-art-{code,body}-<host>`) wins over the shared one, as a listener fencing one name would.
    '  h=; for a in "$@"; do case "$a" in "Host: "*) h="${a#Host: }" ;; esac; done',
    '  cf="$HOME/fixture-art-code"; [ -f "$cf-$h" ] && cf="$cf-$h"; bf="$HOME/fixture-art-body"; [ -f "$bf-$h" ] && bf="$bf-$h"',
    '  code=200; [ -f "$cf" ] && read -r code < "$cf"',
    '  body=; [ -f "$bf" ] && read -r body < "$bf"',
    '  printf \'%s\\n%s\' "$body" "$code"; exit 0',
    'fi',
    `exec "$HOME/stub-bin/curl-base" "$@"`,
  ].join('\n'));
  writeFileSync(join(home, 'fixture-art-code'), String(answer.code ?? 404));
  writeFileSync(join(home, 'fixture-art-body'), answer.body ?? ARTIFACT_NOT_FOUND_BODY);
  if (answer.exit === undefined) rmSync(join(home, 'fixture-art-exit'), { force: true });
  else writeFileSync(join(home, 'fixture-art-exit'), String(answer.exit));
}

/** A healthy box whose exposure file carries the artifact keys and whose Caddyfile carries their block. */
function artifactBox(prefix: string, n: Names, answer: { code?: number; body?: string; exit?: number } = {}): string {
  const home = healthy(prefix);
  plantKeys(home, n);
  plantBlock(home, n);
  stubProbe(home, n.port, answer);
  return home;
}

/** A case that runs the whole doctor more than once outlasts vitest's 20 s on a loaded box. */
const SLOW = 120_000;
const artifactLine =(out: string): string => lineFor(out, 'artifacts') ?? '';

describe('ccrc doctor: artifacts', () => {
  it('doctor: name resolves every host in the list', () => {
    const n = names();
    const home = healthy('ccrc-doctor-art-name-');
    writeExposureEnv(home, { domain: `${EXPOSED_HOST},${n.a},${n.b}` });
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'name');
    expect(l, r.stdout).toMatch(/^PASS name: /);
    expect(l).toContain(`(and ${n.a}, ${n.b} resolve)`);
    // …and one host that does not resolve is named, with today's remedy.
    stub(home, 'getent', [
      'printf \'%s\\n\' "$*" >> "$HOME/getent-calls"',
      'while IFS= read -r bad; do [ "$bad" = "$2" ] && exit 2; done < "$HOME/fixture-getent-down"',
      'while IFS= read -r l; do printf \'%s\\n\' "$l"; done < "$HOME/fixture-getent"',
    ].join('\n'));
    writeFileSync(join(home, 'fixture-getent-down'), `${n.a}\n`);
    const r2 = runDoctor(home);
    const f = lineFor(r2.stdout, 'name');
    expect(f, r2.stdout).toMatch(/^FAIL name: /);
    expect(f).toContain(`${n.a} does not resolve`);
    expect(f).not.toContain(n.b);
    expect(remedyFor(r2.stdout, 'name')).toContain('ccrc-ddns');
  }, SLOW);

  it('doctor: no artifact keys is a skip', () => {
    const home = healthy('ccrc-doctor-art-unset-');
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'artifacts');
    expect(l, r.stdout).toContain('no artifact names set');
    expect(l).toContain('ccrc expose artifacts');
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) artifacts: /m);
  });

  it('doctor: partial keys FAIL', () => {
    for (const key of ['CCRC_ARTIFACT_ORIGIN', 'CCRC_ARTIFACT_CONTENT_ORIGIN', 'CCRC_ARTIFACT_PORT']) {
      const n = names();
      const home = healthy('ccrc-doctor-art-partial-');
      plantKeys(home, n, [key]);
      plantBlock(home, n);
      stubProbe(home, n.port, {});
      const r = runDoctor(home);
      const l = artifactLine(r.stdout);
      expect(l, `${key}\n${r.stdout}`).toMatch(/^FAIL artifacts: /);
      expect(l).toContain(`missing ${key};`);
      expect(remedyFor(r.stdout, 'artifacts')).toContain('ccrc expose artifacts');
    }
  }, SLOW);

  it('doctor: a site-rule breach FAILs', () => {
    const home = healthy('ccrc-doctor-art-site-');
    writeExposureEnv(home, { duckdns: false, origin: 'https://ccrc.example.test', rpid: 'ccrc.example.test' });
    appendFileSync(join(home, '.ccrc', 'exposure.env'),
      'CCRC_ARTIFACT_ORIGIN=https://art.example.test\nCCRC_ARTIFACT_CONTENT_ORIGIN=https://usr.example.test\nCCRC_ARTIFACT_PORT=7791\n');
    const r = runDoctor(home);
    const l = artifactLine(r.stdout);
    expect(l, r.stdout).toMatch(/^FAIL artifacts: /);
    expect(l).toContain('shares the site example.test with the console');
    expect(remedyFor(r.stdout, 'artifacts')).toContain('ccrc expose artifacts');
  });

  it('doctor: the Caddyfile without the artifact block FAILs', () => {
    const n = names();
    const home = healthy('ccrc-doctor-art-noblock-');
    plantKeys(home, n);
    stubProbe(home, n.port, {});
    const r = runDoctor(home);
    const l = artifactLine(r.stdout);
    expect(l, r.stdout).toMatch(/^FAIL artifacts: /);
    expect(l).toContain(`has no site block for ${n.a} and ${n.b} proxying to 127.0.0.1:${n.port}`);
    expect(remedyFor(r.stdout, 'artifacts')).toBe('  remedy: ccrc expose artifacts');
    // A block that proxies to another port is no block for this one.
    plantBlock(home, n, n.port + 1);
    const r2 = runDoctor(home);
    expect(artifactLine(r2.stdout), r2.stdout).toMatch(/^FAIL artifacts: .*has no site block/);
  }, SLOW);

  it('doctor: the loopback probe', () => {
    const n = names();
    const home = artifactBox('ccrc-doctor-art-probe-', n);
    const r = runDoctor(home);
    const l = artifactLine(r.stdout);
    expect(l, r.stdout).toMatch(/^PASS artifacts: /);
    expect(l).toContain(`${n.a} and ${n.b} are set, the Caddyfile routes both to 127.0.0.1:${n.port}`);
    // Both names are asked, each as Host, on loopback, with the operator's curlrc and any proxy kept out.
    const calls = curlCalls(home).filter((c) => c.includes(`http://127.0.0.1:${n.port}/`));
    expect(calls.map((c) => (c.includes(`Host: ${n.a}`) ? 'a' : c.includes(`Host: ${n.b}`) ? 'b' : '?')), calls.join('\n'))
      .toEqual(['a', 'b']);
    for (const c of calls) expect(c.startsWith('-q '), c).toBe(true);
    for (const c of calls) expect(c).toContain('--noproxy *');
    // A 421, a 200 and a 404 with another body are each a FAIL naming what came back.
    for (const [code, body] of [[421, 'Misdirected request.'], [200, '<html>a console page</html>'], [404, '<p>not the artifact page</p>']] as const) {
      stubProbe(home, n.port, { code, body });
      const r2 = runDoctor(home);
      const f = artifactLine(r2.stdout);
      expect(f, r2.stdout).toMatch(/^FAIL artifacts: /);
      expect(f).toContain(`answered ${code} for ${n.a} (${body})`);
      expect(remedyFor(r2.stdout, 'artifacts')).toContain(`check what listens on 127.0.0.1:${n.port}`);
    }
    // A listener started before the content name changed fences it with 421 while the artifact name still answers.
    stubProbe(home, n.port, {});
    writeFileSync(join(home, `fixture-art-code-${n.b}`), '421');
    writeFileSync(join(home, `fixture-art-body-${n.b}`), 'Misdirected request.');
    const r3 = runDoctor(home);
    expect(artifactLine(r3.stdout), r3.stdout).toContain(`FAIL artifacts: the listener on 127.0.0.1:${n.port} answered 421 for ${n.b}`);
  }, SLOW);

  it('doctor: reads the Caddyfile the expose arm writes', () => {
    // The block as `_exp_caddyfile` itself writes it, global log block and stored bind included, not a hand-typed copy.
    const n = names();
    const home = healthy('ccrc-doctor-art-writer-');
    plantKeys(home, n);
    const w = spawnSync(BASH, ['-c', 'source "$1"; _exp_caddyfile "$2" "$3" duckdns', '_', ccrcIn(home), EXPOSED_HOST, '203.0.113.9'],
      { env: { ...doctorEnv(home), PATH: process.env.PATH ?? '' }, encoding: 'utf8' });
    expect(w.status, w.stderr).toBe(0);
    const cf = readFileSync(join(home, '.ccrc', 'Caddyfile'), 'utf8');
    expect(cf.startsWith('{\n\tlog default {'), cf).toBe(true);
    expect(cf).toContain(`${n.a}, ${n.b} {\n    bind 203.0.113.9\n    reverse_proxy 127.0.0.1:${n.port}\n}`);
    performCaddyCeremony(home);
    stubProbe(home, n.port, {});
    const r = runDoctor(home);
    expect(artifactLine(r.stdout), r.stdout).toMatch(/^PASS artifacts: /);
  }, SLOW);

  it('doctor: a listener that is down', () => {
    const n = names();
    const home = artifactBox('ccrc-doctor-art-down-', n, { exit: 7 });
    const r = runDoctor(home);
    expect(artifactLine(r.stdout), r.stdout).toBe(
      `FAIL artifacts: nothing listens on 127.0.0.1:${n.port}; the server could not take that port at its last start, `
      + 'or has not restarted since ccrc expose artifacts; free the port, then restart the server');
    expect(remedyFor(r.stdout, 'artifacts')).toContain(`free 127.0.0.1:${n.port}, then restart the server: `);
    // Any other curl exit is a FAIL too, naming the exit.
    stubProbe(home, n.port, { exit: 28 });
    const r2 = runDoctor(home);
    expect(artifactLine(r2.stdout), r2.stdout).toContain(`did not answer for ${n.a} (curl exited 28)`);
  }, SLOW);

  it('doctor: the ip arm skips', () => {
    const home = healthy('ccrc-doctor-art-ip-');
    writeExposureEnv(home, { ip: '203.0.113.9' });
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'artifacts');
    expect(l, r.stdout).toContain('mode ip');
    expect(l).toContain('the artifact tier is off by design');
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) artifacts: /m);
  });

  it('doctor: artifact keys beside an address FAIL', () => {
    // A hand-made state no command writes (the ip arm drops the keys): the tier cannot serve, said by name.
    const n = names();
    const home = healthy('ccrc-doctor-art-ip-keys-');
    writeExposureEnv(home, { ip: '203.0.113.9' });
    plantKeys(home, n);
    const r = runDoctor(home);
    expect(artifactLine(r.stdout), r.stdout).toBe(
      'FAIL artifacts: artifact keys stand on a box exposed by address, where the artifact tier cannot serve (an address has no second site)');
    expect(remedyFor(r.stdout, 'artifacts')).toBe('  remedy: ccrc expose ip — a re-run drops them');
  }, SLOW);

  it('doctor: artifact keys beside an incomplete sign-in FAIL', () => {
    // Each of the three sign-in keys missing in turn, with the artifact keys standing: no command writes this.
    for (const omit of ['CCRC_AUTH', 'CCRC_RP_ID', 'CCRC_ORIGIN']) {
      const n = names();
      const home = healthy('ccrc-doctor-art-signin-');
      writeExposureEnv(home, { omit: [omit] });
      plantKeys(home, n);
      plantBlock(home, n);
      stubProbe(home, n.port, {});
      const r = runDoctor(home);
      const l = artifactLine(r.stdout);
      expect(l, `${omit}\n${r.stdout}`).toMatch(/^FAIL artifacts: artifact keys stand while .* does not carry the console's sign-in/);
      expect(l).toContain('so the artifact tier cannot serve');
      expect(remedyFor(r.stdout, 'artifacts')).toContain('ccrc expose duckdns or ccrc expose byo');
    }
  }, SLOW);

  it('doctor: the fixed sentence is the listener\'s', () => {
    const m = /^_DR_ARTIFACT_FIXED='([^'\n]+)'$/m.exec(readFileSync(CHECKS_SRC, 'utf8'));
    expect(m, 'ccd/ccrc-doctor-checks holds _DR_ARTIFACT_FIXED').not.toBeNull();
    expect(ARTIFACT_NOT_FOUND_BODY).toContain(m![1]!);
  });
});
