// `ccrc doctor`, part: fleet (D-6767). The doctor suite was one 17,000-line file that held a worker for 661 s; its describe blocks moved
// here unchanged, and the fixtures they share are in `ccrc-doctorFixture.ts`. This part is the fleet, build, status, output-contract,
// exposure, caddy and cert checks; `ccrc-doctor-fleet-box.test.ts` and `ccrc-doctor-fleet-wrappers.test.ts` hold the rest of what was
// this one file, which ran about 386 s on a CI runner and past the trace job's 1560 s budget under `strace -f`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { installDoctorHooks, here, REPO, CCRC_SRC, CHECKS_SRC, LIB_SRC, BASH, writeChecks, stub, unstubManager, unstub, linkReal, entry, shq, ghStub, Health, FIXTURE_ADDR, stubHealth, stubHealthUnreachable, HEALTHY_SHA, stubBuildHealth, healthBodyFor, curlCalls, writeCcrcEnv, stubSystemctl, CANARY_TOKEN, EXPOSED_HOST, writeExposureEnv, endDateFixture, writeSessions, sysCaddyfile, runDoctor, healthy, broken, tableNames, lineFor, HEALTHY_SKIPS, skipLineFor } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── the two boxes' matched set ────────────────────────────────────────────
// Task 7. The check asks the SERVER — the only party that can compare the two
// boxes — and reports its answer. It decides nothing about the comparison
// itself: `rosterAgreement`/`buildAgreement` (server/src/fleetstate.ts) own
// that, and both are deliberately THREE-valued, so the whole job here is to
// keep the three apart. `'unknown'` is not disagreement (an older agent, an
// unstamped box), and "there is no server to ask" is not agreement.

describe('ccrc doctor: fleet', () => {
  it('passes when the server says both boxes agree, and names what it measured', () => {
    const home = healthy('ccrc-doctor-fleet-agreed-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet');
    expect(line).toMatch(/^PASS fleet: the two boxes agree/);
    // Never the bare word "ok": the address it asked, and both answers.
    expect(line).toContain(FIXTURE_ADDR);
    expect(r.code).toBe(0);
  });

  it('really asks the server — the stub logs the one URL it was given', () => {
    // Proof the check is not vacuous AND proof of containment in one
    // assertion, the same shape the gh poison gives gh_auth: the only `curl`
    // this suite can reach is the fixture's own, and it saw exactly one URL.
    const home = healthy('ccrc-doctor-fleet-asked-');
    runDoctor(home);
    // The `build` check (Stage 4, Task 9) asks its own ONE question of the
    // same stub — GET /health — so the log is filtered to this check's URL
    // rather than asserted to be the whole log. Still exactly once.
    const calls = curlCalls(home).filter((c) => c.includes('/api/fleet/health'));
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('fails on a skewed build, and the remedy names the ORDER', () => {
    const home = healthy('ccrc-doctor-fleet-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes are running different builds/);
    // FLEET BOX FIRST is the whole content of the remedy, and the INSTRUMENT
    // is now `ccrc update` (Stage 4, Task 9 — spec §8): the server reads what
    // the fleet host's hook writes and the agent caches `ccd caps` at boot,
    // so the other order runs a server reading fields nobody writes yet.
    // deploy.sh is the developer lane, not the box's own remedy.
    expect(r.stdout).toMatch(/remedy: run 'ccrc rollout' from the deploying machine.*or 'ccrc update' on the lagging box.*fleet box first/i);
    expect(r.stdout).not.toMatch(/deploy\.sh/);
  });

  it('fails on a divergent roster, in its own words and with its own remedy', () => {
    // Not the build's sentence and not the build's remedy: reconciling two
    // rosters is a different action from deploying a lagging box, and
    // `rosterAgreement`'s own docstring states the order (redeploy both first,
    // reconcile the JSON second).
    const home = healthy('ccrc-doctor-fleet-divergent-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'agreed', roster: 'divergent' });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL fleet: the two boxes would run different ~\/\.ccrc\/accounts\.sh/);
    expect(r.stdout).not.toMatch(/running different builds/);
  });

  it('keeps the two disagreements on SEPARATE lines when both are true at once', () => {
    // The merge a tidy-minded reader reaches for — one "the boxes disagree"
    // line — hands one of the two findings the other's remedy. They are two
    // repairs, so they are two lines.
    const home = healthy('ccrc-doctor-fleet-both-bad-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'divergent' });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const b = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes are running different builds'));
    const s = lines.findIndex((l) => l.startsWith('FAIL fleet: the two boxes would run different ~/.ccrc/accounts.sh'));
    expect(b, r.stdout).toBeGreaterThan(-1);
    expect(s, r.stdout).toBeGreaterThan(-1);
    expect(b).not.toBe(s);
    expect(lines[b + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[s + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[b + 1]).not.toBe(lines[s + 1]);
    expect(r.code).toBe(1);
  });

  it('only warns on unknown — an older agent is not a broken fleet', () => {
    const home = healthy('ccrc-doctor-fleet-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'agreed' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN fleet: /m);
    expect(r.stdout).not.toMatch(/FAIL fleet: /);
    // The unknown remedy names `ccrc update` too (Stage 4, Task 9 — the second
    // of the two strings spec §8 retargets off `bash deploy/deploy.sh …`).
    expect(r.stdout).toMatch(/remedy: .*ccrc update/);
    expect(r.stdout).not.toMatch(/deploy\.sh/);
    expect(r.code).toBe(0);
  });

  it('warns once, naming both, when NEITHER answer is known', () => {
    const home = healthy('ccrc-doctor-fleet-both-unknown-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build');
    expect(line).toContain('roster');
    expect(r.code).toBe(0);
  });

  it('reads an ABSENT build/roster as unknown, exactly as the wire contract says', () => {
    // shared/api.ts: both fields are optional and "absent reads as 'unknown'".
    // One reader per field — an older server that omits them must not arrive as
    // a fourth state here. The SENTENCE is asserted, not just the class: "no
    // stamp has reached the server" and "the server said something I do not
    // recognise" are the same WARN and two entirely different diagnoses, and
    // this is the live shape today (the deployed server predates the field).
    const home = healthy('ccrc-doctor-fleet-absent-fields-');
    stubHealth(home, { mode: 'remote', connected: true });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('build: unknown');
    expect(line).toContain('roster: unknown');
    expect(line).not.toMatch(/does not recognise/);
    expect(r.code).toBe(0);
  });

  it('says so, rather than reporting a fleet, when ccrc\'s own readers are not loaded', () => {
    // The check calls `_box_server_addr`/`_box_health`, which live in `ccrc`
    // itself — this file is only ever sourced BY ccrc. Sourced by anything
    // else, the check must say that in a verdict line rather than assume, the
    // same way `_check_wrappers` reports a missing ccrc-wrapper-shape.
    // CONTAINED LIKE `roleFor` BELOW, and not because it needs to be today:
    // the guard under test returns before the check reads anything, so this
    // passed the real HOME and the real PATH straight into a `_check_fleet`
    // that never used them. The moment the check grows one step AHEAD of that
    // guard, this test reads the live `~/.ccrc/ccrc.env` and curls the
    // production server from a unit test. A HOME that cannot exist removes the
    // only file that could name a server, and a PATH of the same non-existent
    // directory removes `curl` — this file resolves no binary at source time
    // (its own header's "no PATH lookups" rule), so nothing legitimate needs
    // either.
    const nowhere = join(REPO, 'no-such-home-for-check-fleet');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_fleet`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL fleet: ccrc's own fleet readers are not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  it('warns rather than fails when the server is unreachable — that is a different problem', () => {
    const home = healthy('ccrc-doctor-fleet-unreachable-');
    stubHealthUnreachable(home);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not answer/);
    expect(line).toContain('7');                 // curl's own exit code, named
    expect(line).not.toMatch(/skewed|divergent/);
    expect(r.code).toBe(0);
  });

  it('warns on an HTTP error, and says which one', () => {
    // A 500 is not a disagreement and not an unreachable box: the server is
    // there and answering, and something inside it is broken.
    const home = healthy('ccrc-doctor-fleet-500-');
    stubHealth(home, '', 500);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('500');
    expect(line).not.toMatch(/did not answer/);  // that is the unreachable sentence
    expect(r.code).toBe(0);
  });

  it('SKIPS — never "read the server\'s log" — when the session gate refuses it (D-150)', () => {
    // `/api/fleet/health` is GATED on purpose: it publishes roster digests,
    // build stamps and divergence, and exempting it to spare a diagnostic would
    // widen the tailnet surface for convenience. So on an armed box this call
    // answers 401, which is BOTH PARTIES BEHAVING CORRECTLY — and it used to
    // land in the generic HTTP-error arm, whose remedy is "read the server's own
    // log", sending an operator to a journal where nothing is wrong. On exactly
    // the box the runbook tells them to run doctor on right after arming.
    const home = healthy('ccrc-doctor-fleet-gated-');
    stubHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home);
    const line = r.stdout.split('\n').find((l) => l.startsWith('SKIP fleet: ')) ?? '';
    expect(line, r.stdout).not.toBe('');
    expect(line).toMatch(/session gate is ARMED/);
    // The two sentences the old wording got wrong, pinned as absences — and the
    // SKIP contract's own half: no remedy line under it, because the only
    // honest "remedy" would be "turn the gate off", which is not advice.
    expect(line).not.toMatch(/HTTP 401/);
    expect(r.stdout).not.toMatch(/journalctl/);
    expect(lineFor(r.stdout, 'fleet'), 'a SKIP is not a PASS/WARN/FAIL').toBeUndefined();
    // THE COST IS STATED RATHER THAN GLOSSED: silence here is not evidence that
    // the two boxes agree, and the line has to say so or it becomes the reason
    // a skew goes unnoticed.
    expect(line).toMatch(/NOT being measured/);
    expect(line).toContain('ccrc version');
    expect(r.code).toBe(0);
  });

  it('a 401 that is NOT this server\'s refusal stays the generic HTTP error', () => {
    // A reverse proxy or a captive portal in front of the address answers 401
    // too, and telling that operator "your session gate refused it" would be the
    // same class of wrong answer D-150 exists to stop. The discriminator is this
    // server's own refusal envelope, not the status code.
    const home = healthy('ccrc-doctor-fleet-proxy401-');
    stubHealth(home, '<html>Proxy Authentication Required</html>', 401);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toContain('401');
    expect(line).not.toMatch(/session gate/);
    expect(r.code).toBe(0);
  });

  it('classifies the refusal WITHOUT quoting a byte of it', () => {
    // `_box_health`'s standing rule — nothing from the body is ever printed —
    // now applies to a body this code READS rather than merely classifies, so
    // it is measured rather than assumed.
    const home = healthy('ccrc-doctor-fleet-gated-quiet-');
    stubHealth(home,
      '{"ok":false,"error":"unauthenticated","verdict":"no-session","canary":"PLANTED-BODY-7f2a"}', 401);
    const r = runDoctor(home);
    expect(r.stdout).not.toContain('PLANTED-BODY-7f2a');
    expect(r.stderr).not.toContain('PLANTED-BODY-7f2a');
  });

  it('warns when the answer is not the health JSON at all', () => {
    // The measured shape of a reverse proxy or a captive portal answering 200
    // with an HTML page.
    const home = healthy('ccrc-doctor-fleet-notjson-');
    stubHealth(home, '<html>hello</html>');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/not the health JSON/);
    expect(r.code).toBe(0);
  });

  it('never echoes the body back — an unrecognised answer is CLASSIFIED, not quoted', () => {
    // doctor's output is what an operator pastes into a ticket, and the body
    // comes off a network. A canary in the answer must not reach the terminal.
    const home = healthy('ccrc-doctor-fleet-canary-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'ccrc-canary-6f21b', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-6f21b');
    expect(r.stderr).not.toContain('ccrc-canary-6f21b');
  });

  it('does not read a value that merely STRINGIFIES to a token as that token', () => {
    // `["agreed"]` renders as exactly "agreed". The classifier compares VALUES
    // against the vocabulary rather than their renderings, so this is an answer
    // the check does not recognise — and emphatically not an agreement.
    // Measured: without that strictness the whole body is passed through as a
    // string and this box reports PASS on an answer nobody wrote.
    const home = healthy('ccrc-doctor-fleet-stringy-');
    stubHealth(home, { mode: 'remote', connected: true, build: ['agreed'], roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/does not recognise/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
  });

  it('warns, rather than passing, when the server says the fleet host is not connected', () => {
    // `agreed` computed over a dead link describes the last contact, not now.
    // Passing on it would report a fact nobody currently measures.
    const home = healthy('ccrc-doctor-fleet-down-');
    stubHealth(home, { mode: 'remote', connected: false, downSince: 1_755_000_000_000, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/is not currently connected/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    expect(r.code).toBe(0);
  });

  // AN ANSWER THIS CHECK DID NOT UNDERSTAND MUST NOT BECOME A CLAIM THAT THE
  // OPPOSITE IS TRUE. `connected` is required on the wire (shared/api.ts (the connected field)),
  // so each of these is a malformed answer — and each used to PASS with the
  // words "in remote mode, connected", which is the strongest claim this check
  // can make, made about the one field the answer did not state. The
  // classifier has always emitted `?` here; the verdict was narrowing it.
  it.each([
    ['absent', { mode: 'remote', build: 'agreed', roster: 'agreed' }],
    ['a non-boolean word', { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' }],
    ['null', { mode: 'remote', connected: null, build: 'agreed', roster: 'agreed' }],
    ['the STRING "false"', { mode: 'remote', connected: 'false', build: 'agreed', roster: 'agreed' }],
  ] as const)('warns when `connected` is %s — it must never pass as "connected"', (_what, body) => {
    const home = healthy(`ccrc-doctor-fleet-conn-${_what.replace(/\W+/g, '-')}-`);
    stubHealth(home, body as Health);
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: /);
    expect(line).toMatch(/did not say whether it is in contact/);
    expect(r.stdout).not.toMatch(/PASS fleet: /);
    // …and specifically not the OTHER link sentence: "the fleet host is down"
    // and "this answer did not say" are two different things to go and look at.
    expect(line).not.toMatch(/is not currently connected/);
    expect(r.code).toBe(0);
  });

  it('warns when the server does not say which mode it is in', () => {
    const home = healthy('ccrc-doctor-fleet-nomode-');
    stubHealth(home, { connected: true, build: 'agreed', roster: 'agreed' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: .*mode/);
    expect(r.code).toBe(0);
  });

  it('SKIPS in local mode — one box cannot disagree with itself', () => {
    // Not a PASS. Nothing was compared, and a run that reported agreement it
    // never measured is the overloaded-null defect this codebase bans. The
    // check prints its SKIP line and no verdict; the summary counts it as
    // skipped, so the number of verdicts really is the number of measurements.
    const home = healthy('ccrc-doctor-fleet-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*local mode/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) fleet: /m);
    expect(r.stdout).toMatch(
      new RegExp(`^summary: \\d+ checks \\(${1 + HEALTHY_SKIPS} skipped\\)`, 'm'));
    expect(r.code).toBe(0);
  });

  it('SKIPS when this box has no server address at all, and says how to give it one', () => {
    // The measured state of the FLEET host: it has ~/.ccrc/agent.env and no
    // ccrc.env, so it does not know where the server is. That is not a fault
    // and not an agreement — it is a check that could not run.
    const home = healthy('ccrc-doctor-fleet-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: this box has no server address/m);
    expect(r.stdout).toMatch(/CCRC_ADDR/);
    expect(curlCalls(home)).toEqual([]);          // nothing was asked
    expect(r.code).toBe(0);
  });

  it('SKIPS a half-configured address rather than inventing the missing half', () => {
    // The port's default lives in server/src/config.ts. Copying it here would
    // be one value declared twice in two languages — and guessing it wrong
    // would produce a confident answer about a box nobody asked.
    const home = healthy('ccrc-doctor-fleet-halfaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=ccrc-fixture.invalid\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*CCRC_PORT/m);
    expect(curlCalls(home)).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('SKIPS an address that is not an address, and never echoes it back', () => {
    const home = healthy('ccrc-doctor-fleet-badaddr-');
    writeCcrcEnv(home, 'CCRC_HOST=not a host\nCCRC_PORT=99999999\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: /m);
    expect(r.stdout).not.toContain('99999999');
    expect(curlCalls(home)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a ccrc.env it cannot READ is its own answer, not "none configured"', () => {
      // A mode fix and "this box was never given a server address" are two
      // different things to do about it — and without the guard the read fails,
      // bash's own error lands on stderr, and every key comes back empty, which
      // is indistinguishable from a file that declares nothing.
      const home = healthy('ccrc-doctor-fleet-envunreadable-');
      chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^SKIP fleet: .*cannot be read/m);
      expect(r.stdout).not.toMatch(/no server address/);
      expect(r.stderr).toBe('');
    });

  it('a ccrc.env that is not a regular file is its own answer too', () => {
    const home = healthy('ccrc-doctor-fleet-envdir-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    mkdirSync(join(home, '.ccrc', 'ccrc.env'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP fleet: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no server address/);
  });

  it('takes CCRC_ADDR ahead of the config file — notify.sh\'s own seam', () => {
    const home = healthy('ccrc-doctor-fleet-envaddr-');
    const r = runDoctor(home, ['doctor'], { CCRC_ADDR: 'other.invalid:9999' });
    expect(curlCalls(home).join('\n')).toContain('http://other.invalid:9999/api/fleet/health');
    expect(curlCalls(home).join('\n')).not.toContain(FIXTURE_ADDR);
    expect(lineFor(r.stdout, 'fleet')).toContain('other.invalid:9999');
  });

  it('reads ONLY the two keys it needs out of ccrc.env — the file also holds tokens', () => {
    // `~/.ccrc/ccrc.env` carries CCRC_VAPID_PRIVATE, CCRC_AGENT_TOKEN and a
    // Hetzner token. The reader takes two keys by name and must never print,
    // export or log another line of it.
    const home = healthy('ccrc-doctor-fleet-envsecrets-');
    writeCcrcEnv(home, [
      '# comment',
      'CCRC_AGENT_TOKEN=ccrc-canary-token-9a13c',
      'CCRC_HOST=ccrc-fixture.invalid',
      'CCRC_VAPID_PRIVATE=ccrc-canary-vapid-4b7e2',
      'CCRC_PORT=7788',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(r.stdout).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stdout).not.toContain('ccrc-canary-vapid-4b7e2');
    expect(r.stderr).not.toContain('ccrc-canary-token-9a13c');
    expect(r.stderr).not.toContain('ccrc-canary-vapid-4b7e2');
    // …and nothing from that file may leak into the child's environment either.
    expect(curlCalls(home).join('\n')).not.toContain('ccrc-canary');
  });

  it('reads an INDENTED key, which is what its own config file\'s parser accepts', () => {
    // systemd's `EnvironmentFile=` skips leading whitespace, and ccrc.env's
    // only real consumer is systemd. A reader stricter than the parser it
    // claims to copy answers "no address" for a file that configures the box
    // perfectly well — a safe failure, but the wrong answer.
    const home = healthy('ccrc-doctor-fleet-indented-');
    writeCcrcEnv(home, '  CCRC_HOST=ccrc-fixture.invalid\n\tCCRC_PORT=7788\n');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^PASS fleet: /);
    expect(curlCalls(home).join('\n')).toContain(`http://${FIXTURE_ADDR}/api/fleet/health`);
  });

  it('and does NOT read a key systemd would REFUSE — the parity runs in one direction only', () => {
    // The other side of the test above, and the reason the reader trims a
    // named three-character set rather than `[[:space:]]`. POSIX's space class
    // also contains vertical tab and form feed; systemd's whitespace is space,
    // tab, CR (and the newline that ends the line). So `\vCCRC_HOST=…` is a
    // line systemd does NOT turn into an environment variable — and a reader
    // that skips the \v anyway would answer with an address the box is not
    // actually configured with, then probe it and report on a fleet nobody
    // asked about.
    //
    // That direction is the one that matters: the reader is a deliberate
    // SUBSET of systemd's parser, and its own comment justifies the subset by
    // the failure being one-directional (a form it misses yields no address,
    // which SKIPS with a detail). A form it reads that systemd does not
    // breaks exactly that argument.
    const home = healthy('ccrc-doctor-fleet-vtab-');
    writeCcrcEnv(home, '\vCCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const r = runDoctor(home);
    // `lineFor` finds a VERDICT line; this check answers with a SKIP, which is
    // deliberately not one (see the runner's fourth-outcome contract).
    expect(r.stdout).toMatch(/^SKIP fleet: .*declares CCRC_PORT but no CCRC_HOST/m);
    expect(r.stdout, 'an address systemd never set was reported as one').not.toContain('ccrc-fixture.invalid');
    expect(curlCalls(home), 'an address systemd never set was probed anyway').toEqual([]);
  });

  it('bounds the request, and the bound is overridable the way verify-service.sh\'s are', () => {
    // A route that hangs must not hang doctor. The knob exists so a test need
    // not wait out a production timeout — `deploy/verify-service.sh`'s
    // `CCRC_VERIFY_*` model, and `CCRC_DOCTOR_GH_TIMEOUT`'s own precedent.
    const home = healthy('ccrc-doctor-fleet-timeout-');
    runDoctor(home, ['doctor'], { CCRC_HEALTH_TIMEOUT: '3' });
    expect(curlCalls(home).join('\n')).toMatch(/--max-time 3\b/);
  });

  it('warns when curl is not on PATH — the check could not run, and says so', () => {
    const home = healthy('ccrc-doctor-fleet-nocurl-');
    unstub(home, 'curl');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'fleet') ?? '';
    expect(line).toMatch(/^WARN fleet: curl is not on PATH/);
    expect(r.code).toBe(0);
  });

  it('says node is missing in its own words rather than blaming the server', () => {
    // A check must not fail for a reason that belongs to another check.
    const home = healthy('ccrc-doctor-fleet-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'fleet')).toMatch(/^WARN fleet: node is not on PATH/);
  });

  it('the three-state vocabulary is the one shared/api.ts declares', () => {
    // The bash check cannot import the TypeScript union, so it carries the
    // tokens as literals — and this is the mechanism that stops the copy
    // drifting, the same text-scan discipline single-definition.test.ts uses.
    const api = readFileSync(join(REPO, 'shared', 'api.ts'), 'utf8');
    const build = /export type BuildAgreement = ([^;]+);/.exec(api)?.[1] ?? '';
    const roster = /roster\?: ([^;]+);/.exec(api)?.[1] ?? '';
    const tokens = (s: string): string[] => (s.match(/'([a-z]+)'/g) ?? []).map((t) => t.slice(1, -1));
    const wanted = [...new Set([...tokens(build), ...tokens(roster)])];
    expect(wanted.sort()).toEqual(['agreed', 'divergent', 'skewed', 'unknown']);
    const checks = readFileSync(CCRC_SRC, 'utf8');
    for (const t of wanted) expect(checks, `ccrc does not know the token "${t}"`).toContain(`"${t}"`);
  });
});


// ── the running build against the stamp (Stage 4, Task 9 — spec §8) ───────
// `~/.ccrc/build.json` says what is INSTALLED; the server process reports what
// it BOOTED with on GET /health. Between an install/update and a restart the
// two legitimately differ, and until this check existed nothing on the box
// said so — the hole `ccrc install`'s own transcript recorded. The check asks
// this box's OWN server (the address `_box_server_addr` reads) and compares
// shas; it never prints a byte the network sent.

describe('ccrc doctor: build', () => {
  it('passes when the running server reports the stamped sha, naming the short sha', () => {
    const home = healthy('ccrc-doctor-build-agreed-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'build');
    expect(line, r.stdout).toMatch(/^PASS build: /);
    // The measurement, never the bare word "ok": the short sha it compared.
    expect(line).toContain(HEALTHY_SHA.slice(0, 12));
    expect(r.code).toBe(0);
  });

  it('fails on a mismatch — the process is stale — and the remedy is the restart', () => {
    const home = healthy('ccrc-doctor-build-stale-');
    stubBuildHealth(home, healthBodyFor('ccrc-canary-running-9d4f'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL build: /m);
    // The remedy has to be a command THIS box has. `systemctl --user restart`
    // on macOS is a second dead end printed at the exact moment somebody is
    // already debugging — hence `_dr_restart_hint`, and hence two spellings
    // here.
    expect(r.stdout).toMatch(process.platform === 'darwin'
      ? /remedy: .*launchctl kickstart -k gui\/\d+\/app\.ccrc\.ccrc/
      : /remedy: .*systemctl --user restart ccrc\.service/);
    // The stamp's sha is local and named; the sha off the NETWORK is not
    // echoed — `_box_health`'s standing nothing-from-the-body rule.
    expect(r.stdout).toContain(HEALTHY_SHA.slice(0, 12));
    expect(r.stdout).not.toContain('ccrc-canary-running-9d4f');
    expect(r.code).toBe(1);
  });

  it('SKIPS when this box has no server address — a fleet box has no server to ask', () => {
    const home = healthy('ccrc-doctor-build-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: this box has no server address/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(r.code).toBe(0);
  });

  it('SKIPS when nothing answers — a stopped server is the services check\'s finding, not a mismatch', () => {
    const home = healthy('ccrc-doctor-build-unreachable-');
    stubHealthUnreachable(home);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: no server answered/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(r.code).toBe(0);
  });

  it('SKIPS a gated 401 saying the GATE answered, not the build (D-150)', () => {
    // The discriminator is this server's own refusal envelope, `_box_health`'s
    // D-150 rule — a bare 401 (a proxy) must not read as the session gate.
    const home = healthy('ccrc-doctor-build-gated-');
    stubBuildHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP build: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/gate answered/i);
    expect(lines[i]).toMatch(/not the build/i);
    // The SKIP contract: no verdict line, and NO remedy under it.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.code).toBe(0);
  });

  it('SKIPS an unstamped box — nothing to compare the running server against', () => {
    const home = healthy('ccrc-doctor-build-unstamped-');
    rmSync(join(home, '.ccrc', 'build.json'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP build: this box has no build stamp/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) build: /m);
    // Nothing was asked: the one curl this fixture logs is the fleet check's.
    expect(curlCalls(home).filter((c) => !c.includes('/api/fleet/health'))).toEqual([]);
    expect(r.code).toBe(0);
  });

  it('a running server that answers something else entirely is a WARN, not a verdict about the build', () => {
    // A reverse proxy or captive portal answering 200 HTML — classified,
    // never quoted (the same rule as the fleet check's canary test).
    const home = healthy('ccrc-doctor-build-notjson-');
    stubBuildHealth(home, '<html>ccrc-canary-body-3c1e</html>');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'build')).toMatch(/^WARN build: /);
    expect(r.stdout).not.toContain('ccrc-canary-body-3c1e');
    expect(r.code).toBe(0);
  });
});


// ── ccrc status ───────────────────────────────────────────────────────────
// Read-only, one fact per line, exit 0. It answers the question doctor cannot:
// not "is this box fit to work" but "what IS this box, and does it agree with
// the other one". Everything it prints is measured here and nothing is judged —
// a skewed fleet is doctor's FAIL, and status's plain line of fact.

describe('ccrc status', () => {
  /** `healthy()` plus what status (and only status) reads: a real `jq` for the
   *  build stamp, a systemctl to ask about the two units, and a registry. */
  function statusBox(prefix: string): string {
    const home = healthy(prefix);
    unstub(home, 'jq');                 // healthy()'s jq is a presence stub
    linkReal(home, 'jq');               // …and the stamp reader needs a real one
    stubSystemctl(home);
    // BOTH unit states are stated here, and neither is inherited: `healthy()`
    // plants an ACTIVE ccrc.service for the `services` check, and status's own
    // fixture is a FLEET HOST (the agent running, the server not). Leaving
    // ccrc.service to the inherited value would silently turn every assertion
    // below into one about a different box.
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), 'inactive\n');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    writeSessions(home, 3);
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false }));
    return home;
  }

  it('prints this box\'s build stamp and the fleet answer, one fact per line', () => {
    const home = statusBox('ccrc-status-ok-');
    const r = runDoctor(home, ['status']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/build: +abc123 \(main\)/);
    expect(r.stdout).toMatch(/fleet: +agreed/);
    expect(r.stderr).toBe('');
  });

  it('prints a version line iff the stamp carries one (Stage 4, Task 1)', () => {
    // The release tag is an additive fifth stamp field: absent on every
    // dev-deployed box (statusBox's stamp above omits it — no line), present
    // after a release install/update — its own fact line, in status's
    // one-fact-per-line register.
    const home = statusBox('ccrc-status-version-');
    expect(runDoctor(home, ['status']).stdout).not.toMatch(/^version:/m);
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'abc123', ref: 'main', builtAt: '2026-08-15T00:00:00Z', dirty: false, version: 'v1.2.3' }));
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/^version: +v1\.2\.3$/m);
    expect(out).toMatch(/build: +abc123 \(main\)/);
  });

  it('prints the two services\' state and a session count', () => {
    const home = statusBox('ccrc-status-services-');
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/services: +.*ccrc\.service inactive/);
    expect(out).toMatch(/ccrc-agent\.service active/);
    expect(out).toMatch(/sessions: +3\b/);
  });

  // ── the role, and the word "inferred" that has to travel with it ────────
  // Nothing on a box records its own role (D-73). The two unit states are the
  // only evidence there is, so status reports the inference and SAYS it is one
  // — a flat `role: fleet host` would be this tool asserting a fact no box ever
  // declared, on evidence that is one `systemctl stop` away from changing.
  it.each([
    ['fleet host', { ccrc: 'inactive', agent: 'active' }],
    ['server', { ccrc: 'active', agent: 'inactive' }],
    ['server AND fleet host', { ccrc: 'active', agent: 'active' }],
    ['neither', { ccrc: 'inactive', agent: 'inactive' }],
  ] as const)('infers "%s" from the units, and says that it inferred it', (role, units) => {
    const home = statusBox(`ccrc-status-role-${role.replace(/\W+/g, '-')}-`);
    for (const [u, state] of [['ccrc.service', units.ccrc], ['ccrc-agent.service', units.agent]] as const) {
      writeFileSync(join(home, `fixture-unit-${u}`), `${state}\n`);
    }
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toContain(role);
    expect(line).toMatch(/inferred|not declared/);
  });

  it('says the role is unknown, not "neither", when the units could not be asked at all', () => {
    // "I could not tell" and "no unit is running" are two different answers,
    // and inferring the second from no evidence is the thing this line exists
    // not to do.
    const home = statusBox('ccrc-status-role-nosystemctl-');
    unstubManager(home);
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line).toMatch(/unknown/);
    expect(line).not.toMatch(/neither/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  it('says unknown, not "neither", when only ONE unit could be asked — end to end', () => {
    // The defect the sourced table below isolates, reached the way an operator
    // reaches it: an EMPTY answer from `systemctl is-active` for one unit
    // (which the fixture systemctl produces from an empty fixture file, and a
    // real one produces on a bus it cannot reach) and a plain `inactive` for
    // the other. Partial evidence used to fall straight through to "no ccrc
    // unit is active here".
    const home = statusBox('ccrc-status-role-halfasked-');
    writeFileSync(join(home, 'fixture-unit-ccrc.service'), '\n');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'inactive\n');
    const out = runDoctor(home, ['status']).stdout;
    const line = out.split('\n').find((l) => l.startsWith('role:')) ?? '';
    expect(line, 'a role inferred from a unit nobody could ask').not.toMatch(/neither/);
    expect(line).toMatch(/unknown/);
    expect(out).toMatch(/services: +.*ccrc\.service unknown/);
  });

  // ── _box_role, every combination of what the two units can say ───────────
  // Called DIRECTLY, by sourcing `ccrc` and setting `BOX_UNITS` — the file
  // carries a source guard for exactly this, and it is the only way to reach
  // all nine states without nine fixtures. The e2e cases above prove the
  // function is wired to a real measurement; this proves what it does with it.
  //
  // THE RULE: no answer may state something no unit was asked about. "unknown"
  // is a state a unit really reaches (no systemctl, no bus, an empty answer),
  // and it is NOT "inactive" — the same distinction this whole file keeps
  // between a check that failed and a check that could not run.
  describe('_box_role never asserts a state it did not measure', () => {
    // An EMPTY fixture HOME made at collection: `_box_role` reads only the preset BOX_UNITS array, so nothing is put in
    // it; the env is contained so a stray systemctl, curl or ssh answers a poison (wave 17, D-5322).
    const roleHome = mkTmp('ccrc-doctor-boxrole-');
    const roleFor = (ccrc: string, agent: string): string => {
      const r = spawnSync(BASH, ['-c',
        `source "${CCRC_SRC}"; BOX_UNITS=(${ccrc} ${agent}); _box_role; echo`],
        { encoding: 'utf8', env: ccrcContainedEnv(roleHome, process.env, { managers: true, curl: 'poison' }) });
      expect(r.status, `_box_role exited ${r.status}\n${r.stderr}`).toBe(0);
      expect(r.stderr).toBe('');
      return r.stdout.trim();
    };

    it.each([
      ['active', 'active', 'server AND fleet host'],
      ['active', 'inactive', 'server'],
      ['inactive', 'active', 'fleet host'],
      ['inactive', 'inactive', 'neither'],
    ] as const)('(%s, %s) — both units answered, so the inference is stated: %s', (c, a, want) => {
      const line = roleFor(c, a);
      expect(line).toContain(want);
      expect(line, 'the word that makes it an inference rather than a fact').toMatch(/inferred|not declared/);
    });

    it('(active, inactive) is "server" and not the single-box answer', () => {
      expect(roleFor('active', 'inactive')).not.toContain('fleet host');
    });

    it.each([
      ['unknown', 'inactive', 'ccrc.service'],
      ['inactive', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'unknown', 'ccrc.service'],
    ] as const)('(%s, %s) is UNKNOWN — one unmeasured unit is enough to withhold "neither"', (c, a, names) => {
      // The verified defect: the `elif` that answers "unknown" required BOTH
      // units to be unknown, so a box where one unit could not be asked and
      // the other was merely inactive fell into the `else` and was told "no
      // ccrc unit is active here" — a negative claim about a unit nobody
      // asked. Same class as the `connected` bug fixed one commit earlier:
      // asserting a state that was never measured.
      const line = roleFor(c, a);
      expect(line, 'partial evidence still produced a confident "neither"').not.toContain('neither');
      expect(line).toContain('unknown');
      expect(line, 'the unmeasured unit is not named, so nobody can tell which one to check')
        .toContain(names);
    });

    it.each([
      ['active', 'unknown', 'ccrc-agent.service'],
      ['unknown', 'active', 'ccrc.service'],
    ] as const)('(%s, %s) names the active unit AND says the other was never asked', (c, a, unasked) => {
      // The same rule pointing the other way. One unit is measurably active,
      // so the box IS at least that role — but "server" alone silently answers
      // the question "is it also a fleet host?", which nobody measured. The
      // single-box case (both active) is a real and different answer.
      const line = roleFor(c, a);
      expect(line).toContain(c === 'active' ? 'server' : 'fleet host');
      expect(line, 'the unasked unit is not named').toContain(unasked);
      expect(line).toMatch(/could not be asked|not measured/);
      expect(line, 'a half-measured box must not be reported as the single-box install')
        .not.toContain('a single-box install');
    });
  });

  it('counts the sessions the registry really holds, not a constant', () => {
    const home = statusBox('ccrc-status-sessions-');
    writeSessions(home, 7);
    expect(runDoctor(home, ['status']).stdout).toMatch(/sessions: +7\b/);
  });

  it('reads the stamp through version\'s own reader — one reader, two renderings', () => {
    // The pin against a second parser growing here: a dirty stamp is a fact
    // `version` already knows how to see, and status must see the same one.
    const home = statusBox('ccrc-status-dirty-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'deadbee', ref: 'feat/x', builtAt: '2026-08-15T01:00:00Z', dirty: true }));
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/build: +deadbee \(feat\/x\)/);
    expect(out).toMatch(/dirty/i);
    expect(runDoctor(home, ['version']).stdout).toMatch(/dirty/);
  });

  it('says "unstamped" rather than inventing a build when there is no stamp', () => {
    const home = statusBox('ccrc-status-unstamped-');
    rmSync(join(home, '.ccrc', 'build.json'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/build: +unstamped/);
    expect(r.code).toBe(0);
  });

  it('reports a fleet it could not measure as NOT MEASURED, never as agreement', () => {
    const home = statusBox('ccrc-status-noaddr-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).not.toMatch(/fleet: +agreed/);
    expect(r.code).toBe(0);
  });

  it('says the GATE refused it, not "HTTP 401", when the gate is armed (D-150)', () => {
    // The second caller of `_box_health`, and it had the same misleading
    // sentence: `fleet: not measured (the server answered HTTP 401 …)`. Both
    // callers now read arm 9, so neither can drift back on its own.
    const home = statusBox('ccrc-status-gated-');
    stubHealth(home, '{"ok":false,"error":"unauthenticated","verdict":"no-session"}', 401);
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +not measured/);
    expect(r.stdout).toMatch(/session gate is armed/);
    // It must read as EXPECTED, not as a fault — this is the state every armed
    // box is in, on every run.
    expect(r.stdout).toMatch(/not a fault/);
    expect(r.stdout).not.toMatch(/HTTP 401/);
    expect(r.code).toBe(0);
  });

  it('reports a skewed fleet as the fact it is, and still exits 0 — status judges nothing', () => {
    const home = statusBox('ccrc-status-skewed-');
    stubHealth(home, { mode: 'remote', connected: true, build: 'skewed', roster: 'agreed' });
    const r = runDoctor(home, ['status']);
    expect(r.stdout).toMatch(/fleet: +disagreed/);
    expect(r.stdout).toMatch(/build skewed/);
    expect(r.code).toBe(0);
    // …and doctor, on the same box, does not shrug at it.
    expect(runDoctor(home, ['doctor']).code).toBe(1);
  });

  it('will not say "agreed" over a link the server says is DOWN', () => {
    // Both halves agree, and the server is not in contact with the fleet host:
    // the answers describe the last contact. `agreed` is the strongest claim
    // this verb makes and it is not available here.
    const home = statusBox('ccrc-status-down-');
    stubHealth(home, { mode: 'remote', connected: false, build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/NOT currently in contact/);
  });

  it('will not say "agreed" beside a `connected` it could not read either', () => {
    // The status half of the same defect: the line used to read
    // `fleet: agreed` directly under `mode: remote (fleet host connected: ?)`,
    // so the verb contradicted itself two lines apart.
    const home = statusBox('ccrc-status-conn-unknown-');
    stubHealth(home, { mode: 'remote', connected: 'yes', build: 'agreed', roster: 'agreed' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/connected: \?/);
    expect(out).toMatch(/fleet: +stale/);
    expect(out).not.toMatch(/fleet: +agreed/);
    expect(out).toMatch(/did not say whether it is in contact/);
  });

  it('says so when the server is in local mode, rather than reporting agreement', () => {
    const home = statusBox('ccrc-status-local-');
    stubHealth(home, { mode: 'local', connected: true, build: 'unknown', roster: 'unknown' });
    const out = runDoctor(home, ['status']).stdout;
    expect(out).toMatch(/fleet: +not measured/);
    expect(out).toMatch(/local mode/);
  });

  it('never asks anything but the health route, and asks it once', () => {
    const home = statusBox('ccrc-status-readonly-');
    runDoctor(home, ['status']);
    const calls = curlCalls(home);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/api/fleet/health');
    // Read-only in the strongest sense available here: no method flag at all,
    // which is a GET, and no request body.
    expect(calls[0]).not.toMatch(/-X|--request|--data|-d\b/);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = statusBox('ccrc-status-args-');
    const r = runDoctor(home, ['status', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('names units that really exist in deploy/, not two plausible strings', () => {
    const src = readFileSync(CCRC_SRC, 'utf8');
    const units = [...src.matchAll(/\b(ccrc(?:-agent)?\.service)\b/g)].map((m) => m[1]);
    expect(new Set(units)).toEqual(new Set(['ccrc.service', 'ccrc-agent.service']));
    for (const u of new Set(units)) expect(existsSync(join(REPO, 'deploy', u!)), u).toBe(true);
  });
});


// ── the wrapper-shape library's own contract ──────────────────────────────

describe('ccrc doctor: ccrc-wrapper-shape', () => {
  it('_wrap_set_diff does not shadow its caller\'s locals inside the callback', () => {
    // The callback runs INSIDE _wrap_set_diff's scope — that is the whole
    // mechanism, and it is why every local in there is `_wrap_*`-prefixed. A
    // bare `local x y found` (which is what it shipped with) handed the
    // callback the loop's own `x` in place of the caller's, silently, for
    // exactly as long as nobody happened to name a variable `x`.
    const script = [
      'set -uo pipefail',
      `. ${shq(LIB_SRC)}`,
      'note() { printf "%s saw x=%s y=%s found=%s\\n" "$2" "$x" "$y" "$found"; }',
      'outer() {',
      '  local x=OUTER-X y=OUTER-Y found=OUTER-FOUND',
      '  local -a mine=(only-in-a) theirs=()',
      '  _wrap_set_diff note mine theirs',
      '}',
      'outer',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('only-in-a saw x=OUTER-X y=OUTER-Y found=OUTER-FOUND');
  });
});


// ── the output contract ───────────────────────────────────────────────────

describe('ccrc doctor: the output contract', () => {
  it('names a remedy for EVERY failing check — a check with no remedy is a complaint', () => {
    // Asserted per FAIL line, not once over the whole output: a single stray
    // "remedy:" anywhere would satisfy the weaker form while nine checks
    // shipped without one.
    const lines = runDoctor(broken('ccrc-doctor-remedy-')).stdout.split('\n');
    const fails = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('FAIL'));
    expect(fails.length, 'the broken fixture must actually fail something').toBeGreaterThan(0);
    for (const [line, i] of fails)
      expect(lines[i + 1], `no remedy after: ${line}`).toMatch(/^ {2}remedy: \S/);
  });

  it('names a remedy after a WARN too', () => {
    const home = healthy('ccrc-doctor-remedy-warn-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN '));
    expect(i, 'this fixture must produce a WARN').toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
  });

  it('every line is exactly PASS|WARN|FAIL|SKIP <name>: <detail>', () => {
    // SKIP is in the alternation and NOT in the verdict count: a check that did
    // not run has not answered, and counting it as an answer is the whole
    // defect the skip exists to avoid. Both fixtures are walked, because the
    // healthy box's own skip (`HEALTHY_SKIPS` — `models`, everywhere, plus
    // `scopes` on macOS) is not zero on either platform any more, and the
    // address-less one has exactly two ADDITIONAL skips on top of that —
    // `fleet` and, since Stage 4 Task 9, `build`, each for its own reading of
    // the same missing address. `HEALTHY_SKIPS` is added to both below for
    // exactly that reason: it is not something only a platform quirk adds,
    // it is the healthy box's own baseline now.
    const home = healthy('ccrc-doctor-shape-');
    ghStub(home, ['github.com', '  - Logged in to github.com account fixture-bot (oauth_token)'], 0);
    const skipBox = healthy('ccrc-doctor-shape-skip-');
    rmSync(join(skipBox, '.ccrc', 'ccrc.env'), { force: true });
    // THE NAME HALF IS DERIVED FROM THE TABLE, not spelled as a charset
    // (D-1345). It used to read `[a-z0-9_]+`, which was never a rule anybody
    // stated — it was the alphabet every check id happened to use — and R3's
    // `graphify-path`, whose hyphen the spec and `_check_graphify-path`'s own
    // header both choose deliberately, made it a false verdict about the SHAPE
    // this test is named for: `PASS graphify-path: …` is exactly
    // `<VERDICT> <name>: <detail>`. Deriving the alternation from
    // `CCRC_DOCTOR_CHECKS` is this project's own "enumerate once, derive" rule
    // and it is STRICTER than any charset — a verdict printed under a name the
    // table does not carry is now red here, where the old regex accepted it.
    const nameAlt = tableNames()
      .map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
    const shape = new RegExp(`^(PASS|WARN|FAIL|SKIP) (${nameAlt}): \\S`);
    for (const [h, wantSkips] of [
      [home, HEALTHY_SKIPS], [skipBox, 2 + HEALTHY_SKIPS],
    ] as const) {
      let verdicts = 0; let skips = 0;
      for (const l of runDoctor(h).stdout.split('\n')) {
        if (!l || l.startsWith('  remedy: ') || l.startsWith('summary: ')) continue;
        expect(l).toMatch(shape);
        if (l.startsWith('SKIP ')) skips++; else verdicts++;
      }
      // Without this the loop above is a scan over an empty list, which passes
      // everything — the exact vacuity this suite's red run exhibited.
      expect(skips).toBe(wantSkips);
      expect(verdicts).toBe(tableNames().length - wantSkips);
    }
  });

  it('exits 1 when any check fails and 0 when every check passes or warns', () => {
    expect(runDoctor(broken('ccrc-doctor-exit-bad-')).code).toBe(1);
    expect(runDoctor(healthy('ccrc-doctor-exit-ok-')).code).toBe(0);
  });

  it('prints a summary count LAST, and it adds up to the table', () => {
    const home = healthy('ccrc-doctor-summary-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(pass + warn + fail).toBe(verdicts);
    // On a HEALTHY box every check answers exactly once EXCEPT the
    // `HEALTHY_SKIPS` checks that legitimately SKIP (`models`, everywhere;
    // `scopes` too on macOS) — which is what makes the two-class run's
    // disagreement meaningful by contrast. A SKIP is an answer but NOT a
    // verdict (cmd_doctor counts them apart), so a box with `HEALTHY_SKIPS`
    // legitimate skips has that many fewer verdicts than checks. On Linux
    // `HEALTHY_SKIPS` is 1, not 0 — the skip is real now, not a
    // Darwin-only special case.
    expect(verdicts).toBe(total - HEALTHY_SKIPS);
    expect(skipped).toBe(HEALTHY_SKIPS);
    expect(fail).toBe(0);
    // A HEALTHY macOS BOX CARRIES EXACTLY ONE STANDING WARN, and it is not a
    // fault to be fixed: `linger` has no counterpart on a platform where a
    // LaunchAgent lives and dies with the login session. The arithmetic above
    // is the property this test is really about and it holds on both; what
    // differs is how many verdicts a correct box is entitled to warn about.
    if (process.platform === 'darwin') {
      expect(warn).toBe(1);
      expect(lineFor(r.stdout, 'linger')).toMatch(/^WARN linger: not a macOS concept/);
    } else {
      expect(warn).toBe(0);
    }
  });

  it('a healthy box says nothing on stderr — the verdicts are the RESULT, on stdout', () => {
    const home = healthy('ccrc-doctor-stderr-');
    const r = runDoctor(home);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('refuses an argument, exit 2, like every other verb', () => {
    const home = healthy('ccrc-doctor-args-');
    const r = runDoctor(home, ['doctor', '--all']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --all/m);
  });

  it('a table entry with no _check_ function FAILS loudly and blames ccrc, not the box', () => {
    // The table and its implementations are two files' worth of one thing; if
    // they drift, the entry must not be silently skipped — a skipped check is
    // a check that reports nothing and lets the summary claim a clean box.
    const home = healthy('ccrc-doctor-orphan-entry-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=(ghost)\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL ghost: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/no _check_ghost function exists/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('one check that DIES mid-run does not take the rest of the table with it', () => {
    // `set -u` (which ccrc runs under, and must) makes an unbound variable
    // FATAL to the shell it happens in — not a `return 1`. Called directly,
    // one such check ended the whole run: no summary, and every later check
    // silently unmeasured, which is exactly what doctor exists not to do. Each
    // check therefore runs in a subshell.
    const home = healthy('ccrc-doctor-fatal-check-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha boom omega)',
      '_check_alpha() { printf "PASS alpha: measured\\n"; }',
      '_check_boom()  { printf "%s\\n" "$CCRC_NOT_SET_ANYWHERE"; }',
      '_check_omega() { printf "PASS omega: measured\\n"; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    expect(r.stdout).toMatch(/^PASS alpha: measured$/m);
    // The explosion is reported as a bug in ccrc, with a remedy, in the dead
    // check's own name — not as a missing line.
    const i = lines.findIndex((l) => l.startsWith('FAIL boom: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/printed no verdict line of its own/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    // The run CONTINUED past it, and still added up.
    expect(r.stdout).toMatch(/^PASS omega: measured$/m);
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 2 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
    // bash's own diagnosis is not swallowed — stderr is deliberately not captured.
    expect(r.stderr).toMatch(/unbound variable/);
  });

  it('a check that answers with an illegal status is a bug, not a fifth outcome', () => {
    const home = healthy('ccrc-doctor-bad-status-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(weird)\n'
      + '_check_weird() { printf "PASS weird: printed a verdict, then lied\\n"; return 4; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL weird: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 4, which is not one of 0 \(pass\), 1 \(fail\), 2 \(warn\) or 3 \(skipped\)/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  // ── the FOURTH outcome: a check that did not run ────────────────────────
  // A check with nothing to measure (`fleet` on a box with no server to ask)
  // must not report a PASS it never earned, and must not report a WARN either —
  // there is nothing wrong. It prints ONE `SKIP <name>: <detail>` line, no
  // verdict line, and exits 3; the runner counts it against CHECKS and not
  // against verdicts, so the summary's two nouns stay honest.
  it('counts a SKIP as a check that did not answer, never as one that passed', () => {
    const home = healthy('ccrc-doctor-skip-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha nothing)',
      '_check_alpha()   { printf "PASS alpha: measured\\n"; }',
      '_check_nothing() { printf "SKIP nothing: there was nothing here to measure\\n"; return 3; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP nothing: there was nothing here to measure$/m);
    expect(r.stdout).toMatch(/^summary: 2 checks \(1 skipped\), 1 verdicts — 1 passed, 0 warned, 0 failed$/m);
    expect(r.code).toBe(0);
  });

  it('a check that exits 3 while printing a VERDICT is a bug, not a skip', () => {
    // The two halves of the skip are cross-checked against each other, exactly
    // as the return code and the verdict lines already are: "I did not run" and
    // "here is my answer" cannot both be true.
    const home = healthy('ccrc-doctor-skip-and-verdict-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "PASS liar: measured\\n"; return 3; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/a skipped check prints exactly one SKIP line/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('a SKIP line with a return code that is not 3 is a bug too', () => {
    // The other direction. Without this, a check could print SKIP and exit 0,
    // and the summary would count a measurement nobody made.
    const home = healthy('ccrc-doctor-skip-rc0-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(sneak)\n'
      + '_check_sneak() { printf "SKIP sneak: nothing to do\\n"; return 0; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL sneak: .*a skipped check prints exactly one SKIP line/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a check that exits 3 and prints NOTHING is a bug — a skip owes a reason', () => {
    // An invisible skip is a check that vanished from the run. The detail is
    // the whole difference between "this box has no server to ask" and a
    // silence the operator has to reverse-engineer from a count.
    const home = healthy('ccrc-doctor-skip-silent-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(mute)\n'
      + '_check_mute() { return 3; }\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL mute: /m);
    expect(r.code).toBe(1);
  });

  it('counts a check that answers in TWO classes in both, and reports both lines', () => {
    // The runner half of the wrappers split: a check with findings of two
    // classes prints a line each and returns the WORSE. The tally is over
    // verdict lines, so the summary shows both — and, deliberately, more
    // verdicts than checks.
    const home = healthy('ccrc-doctor-two-class-count-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(dual)',
      '_check_dual() {',
      '  printf "FAIL dual: a real defect\\n  remedy: fix it\\n"',
      '  printf "WARN dual: something deliberate\\n  remedy: or leave it\\n"',
      '  return 1',
      '}',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL dual: a real defect$/m);
    expect(r.stdout).toMatch(/^WARN dual: something deliberate$/m);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 2 verdicts — 0 passed, 1 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a verdict line for ANOTHER check does not count as this one answering', () => {
    // The tally matches `PASS <name>: `, with the name bound — not a bare
    // `PASS `. A check that prints somebody else's verdict has not answered
    // for itself, and counting it as though it had is how a check that was
    // never wired up rides in on its neighbour's line. All three classes,
    // because the matcher has three arms and loosening any one of them was
    // green before this test.
    const home = healthy('ccrc-doctor-wrong-name-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(alpha beta gamma)',
      '_check_alpha() { printf "PASS other: not my name\\n"; return 0; }',
      '_check_beta()  { printf "WARN other: not my name\\n  remedy: x\\n"; return 2; }',
      '_check_gamma() { printf "FAIL other: not my name\\n  remedy: x\\n"; return 1; }',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    for (const n of ['alpha', 'beta', 'gamma'])
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL ${n}: the check printed no verdict line of its own`, 'm'));
    expect(r.stdout).toMatch(/^summary: 3 checks \(0 skipped\), 3 verdicts — 0 passed, 0 warned, 3 failed$/m);
    expect(r.code).toBe(1);
  });

  it('a return code that disagrees with the verdict lines is a bug, not an answer', () => {
    // Counting the LINES moved the tally off the return code; this is what
    // keeps the code from becoming decoration. A check that returns 1 while
    // printing only a WARN would otherwise have made doctor exit 0 — silently
    // downgrading a failure to a warning.
    const home = healthy('ccrc-doctor-rc-mismatch-');
    writeChecks(home,
      'CCRC_DOCTOR_CHECKS=(liar)\n'
      + '_check_liar() { printf "WARN liar: measured\\n  remedy: do something\\n"; return 1; }\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL liar: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/exited 1, but the worst verdict line it printed is a WARN, which is 2/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*bug in ccrc/);
    expect(r.stdout).toMatch(/^summary: 1 checks \(0 skipped\), 1 verdicts — 0 passed, 0 warned, 1 failed$/m);
    expect(r.code).toBe(1);
  });

  it('refuses an EMPTY check table rather than reporting a box nobody measured', () => {
    const home = healthy('ccrc-doctor-empty-table-');
    writeChecks(home, 'CCRC_DOCTOR_CHECKS=()\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is empty/m);
  });

  it('refuses a check table file that declares no table at all', () => {
    const home = healthy('ccrc-doctor-no-table-');
    writeChecks(home, '# nothing here\n');
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table declares no CCRC_DOCTOR_CHECKS/m);
  });

  it('refuses to run at all when its check table is missing, rather than passing vacuously', () => {
    // A doctor that finds no checks and exits 0 is the worst possible failure
    // mode: it reports a healthy box by measuring nothing.
    const home = healthy('ccrc-doctor-nochecks-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'), { force: true });
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc: doctor's check table is missing/m);
  });
});


describe('ccrc doctor: exposure', () => {
  it('SKIPs when the box was never exposed — a BYO proxy or a pre-3b box is an end state, not a fault', () => {
    const home = healthy('ccrc-doctor-exposure-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    const l = skipLineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toBeTruthy();
    expect(l).toContain('not configured');
    expect(l).toContain('pre-3b');
    // The SKIP contract: no verdict line, and no remedy under it.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) exposure: /m);
  });

  it('PASSes naming the origin when the file is 0600 and both origin keys are set', () => {
    const home = healthy('ccrc-doctor-exposure-ok-');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toMatch(/^PASS exposure: /);
    expect(l).toContain(`https://${EXPOSED_HOST}`);
  });

  it('never prints the token — not in any verdict, any remedy, or anywhere else in a full run', () => {
    const home = healthy('ccrc-doctor-exposure-token-');
    const r = runDoctor(home);
    expect(r.stdout).not.toContain(CANARY_TOKEN);
    expect(r.stderr).not.toContain(CANARY_TOKEN);
  });

  it('FAILs with the ccrc expose remedy when the mode is not 0600', () => {
    const home = healthy('ccrc-doctor-exposure-mode-');
    chmodSync(join(home, '.ccrc', 'exposure.env'), 0o644);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL exposure: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('644');
    expect(lines[i + 1]).toContain('ccrc expose');
    expect(r.code).toBe(1);
  });

  it('FAILs with the ccrc expose remedy when an origin key is missing', () => {
    const home = healthy('ccrc-doctor-exposure-key-');
    writeExposureEnv(home, { omit: ['CCRC_RP_ID'] });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL exposure: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('CCRC_RP_ID');
    expect(lines[i + 1]).toContain('ccrc expose');
  });

  it('PASSes mode ip with no rp id at all — passphrase-only is the design, not a gap', () => {
    // Stage 5, S10: `ccrc expose ip` writes no CCRC_RP_ID (an rpId must be a
    // domain), so the missing-key FAIL above must not fire when the file says
    // CCRC_EXPOSE_MODE=ip. The mutation this pins: drop the mode read and the
    // check FAILs every ip box on the key its own verb refuses to write.
    const home = healthy('ccrc-doctor-exposure-ip-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'exposure');
    expect(l, r.stdout).toMatch(/^PASS exposure: /);
    expect(l).toContain('https://203.0.113.7');
    expect(l).toContain('mode ip');
  });
});


describe('ccrc doctor: caddy', () => {
  it('SKIPs without exposure — no proxy is owed on a box that never ran the verb', () => {
    const home = healthy('ccrc-doctor-caddy-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'caddy'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) caddy: /m);
  });

  it('PASSes when the caddy SYSTEM unit is active', () => {
    // The stub answers system-scope `is-active caddy` from its own fixture
    // file and `--user is-active caddy` from a different (absent) one — so
    // reaching this PASS at all pins the scope: a check that asked systemd's
    // user manager would find nothing and FAIL here.
    const home = healthy('ccrc-doctor-caddy-ok-');
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'caddy'), r.stdout).toMatch(/^PASS caddy: /);
  });

  it('FAILs with the sudo ceremony when exposure is configured but the unit is not active', () => {
    const home = healthy('ccrc-doctor-caddy-dead-');
    writeFileSync(join(home, 'fixture-system-unit-caddy'), 'inactive\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL caddy: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('inactive');       // systemd's own word, quoted back
    // The remedy IS the D2 ceremony — all three steps, so an operator can act
    // on the line without going back to the expose transcript.
    expect(lines[i + 1]).toContain('install caddy');
    // The destination the remedy PRINTS is the one the `caddyfile` check
    // MEASURES — the same constant, so a fixture redirect moves both or
    // neither. Asserting the literal /etc path here would have passed while
    // the two drifted apart (D-166).
    expect(lines[i + 1]).toContain(sysCaddyfile(home));
    expect(lines[i + 1]).toContain('enable --now caddy');
    // D-165: never the symlink form. It cannot work — caddy runs as its own
    // user and cannot traverse `$HOME/.ccrc` (0700, ccrc's own doing).
    expect(lines[i + 1], 'a symlink remedy the caddy user could not follow')
      .not.toContain('ln -s');
    expect(r.code).toBe(1);
  });

  it('SKIPs when there is no systemctl at all — a container or dev box cannot run a system unit', () => {
    const home = healthy('ccrc-doctor-caddy-nosystemctl-');
    // THE SYSTEM systemd, not the user one: this is the caddy check, which asks
    // about a SYSTEM unit. `systemctl` by name is right here on both platforms —
    // macOS has none either, and the check's SKIP is the same verdict for the
    // same reason.
    unstub(home, 'systemctl');
    const r = runDoctor(home);
    // `services` FAILs beside it (that box has user unit FILES and nothing to
    // ask about them — its own finding); the caddy check itself must skip.
    expect(skipLineFor(r.stdout, 'caddy'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) caddy: /m);
  });
});


describe('ccrc doctor: cert', () => {
  it('SKIPs without exposure — there is no certificate this box is supposed to serve', () => {
    const home = healthy('ccrc-doctor-cert-skip-');
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    const r = runDoctor(home);
    expect(skipLineFor(r.stdout, 'cert'), r.stdout).toBeTruthy();
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) cert: /m);
  });

  it('PASSes naming the days when the served cert is at least 14 days out — measured on the LOOPBACK listener with SNI', () => {
    const home = healthy('ccrc-doctor-cert-ok-');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'cert');
    expect(l, r.stdout).toMatch(/^PASS cert: /);
    const m = /(\d+) days/.exec(l ?? '');
    expect(m, `no day count in: ${l}`).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(85);
    expect(Number(m![1])).toBeLessThanOrEqual(90);
    // The probe went to 127.0.0.1:443 with the origin's host in SNI — before
    // DNS propagates and independent of the WAN path (spec D6).
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls).toContain('-connect 127.0.0.1:443');
    expect(calls).toContain(`-servername ${EXPOSED_HOST}`);
  });

  // Live finding, 2026-08-21 ceremony: caddy CAN bind one interface only —
  // tailscaled held the tailnet IP's :471, so caddy took the public IP and
  // loopback refused. A loopback-only probe FAILed a box that was serving a
  // perfectly good certificate. The probe now walks loopback first, then the
  // box's own addresses (`hostname -I`, the name check's source), and
  // measures the first listener that answers.
  it('falls back to the box\'s own addresses when loopback refuses — caddy bound to one interface is not a missing cert', () => {
    const home = healthy('ccrc-doctor-cert-onebind-');
    writeFileSync(join(home, 'fixture-tls-refused-addrs'), '127.0.0.1\n');
    writeFileSync(join(home, 'fixture-host-ips'), '203.0.113.7 10.0.0.5\n');
    const r = runDoctor(home);
    const l = lineFor(r.stdout, 'cert');
    expect(l, r.stdout).toMatch(/^PASS cert: /);
    expect(l).toContain('203.0.113.7');
    // Loopback was still tried FIRST — the fallback is ordered, not a swap.
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls.indexOf('-connect 127.0.0.1:443')).toBeGreaterThan(-1);
    expect(calls.indexOf('-connect 127.0.0.1:443'))
      .toBeLessThan(calls.indexOf('-connect 203.0.113.7:443'));
  });

  it('still FAILs when NO listener answers on any of the box\'s addresses', () => {
    const home = healthy('ccrc-doctor-cert-nowhere-');
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*caddy/);
  });

  it('WARNs when the cert expires within 14 days — renewal is failing, not yet failed', () => {
    const home = healthy('ccrc-doctor-cert-close-');
    writeFileSync(join(home, 'fixture-cert-enddate'), `${endDateFixture(5)}\n`);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/\d+ days/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(0);                       // a warning does not fail the run
  });

  it('FAILs pointing at the caddy check when nothing answers the handshake', () => {
    const home = healthy('ccrc-doctor-cert-refused-');
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    // "nothing serves TLS here" is the CADDY check's territory, and this line
    // must send the reader there rather than duplicating its diagnosis.
    expect(`${lines[i]}\n${lines[i + 1]}`).toContain('caddy check');
    expect(r.code).toBe(1);
  });

  // ── mode ip (stage 5, S10): the chain is caddy's internal CA, by design ──
  // The internal leaf renews every 12 hours, so the 14-day floor would cry
  // renewal-failure forever on a box working exactly as built. The verdict is
  // the honest one: served, and not publicly trusted until each device has
  // done the trust ceremony once — WARN, never PASS-green and never FAIL.
  it('WARNs on mode ip that the chain is not publicly trusted, naming the trust ceremony', () => {
    const home = healthy('ccrc-doctor-cert-ip-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    // An internal-CA leaf: expiry hours out — under the public floor, and
    // exactly what a HEALTHY ip box serves. The mutation this pins: route ip
    // mode through the 14-day arm and this test reds on the renewal costume.
    writeFileSync(join(home, 'fixture-cert-enddate'), `${endDateFixture(1)}\n`);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN cert: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('not publicly trusted');
    expect(lines[i]).not.toMatch(/renewal is failing/);
    // The remedy IS the trust ceremony: this box's own command, and the root
    // file a phone installs.
    expect(lines[i + 1]).toContain('caddy trust');
    expect(lines[i + 1]).toContain('/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt');
    expect(r.code, 'a by-design WARN must not fail the run').toBe(0);
  });

  it('probes mode ip WITHOUT SNI — a servername is a HOSTNAME, and this box has none', () => {
    const home = healthy('ccrc-doctor-cert-ip-sni-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'cert'), r.stdout).toMatch(/^WARN cert: /);
    const calls = readFileSync(join(home, 'openssl-calls'), 'utf8');
    expect(calls).toContain('-connect 127.0.0.1:443');
    expect(calls).not.toContain('-servername');
  });

  it('mode ip still FAILs when nothing answers — the trust WARN sits AFTER presence, not instead of it', () => {
    const home = healthy('ccrc-doctor-cert-ip-refused-');
    writeExposureEnv(home, { ip: '203.0.113.7' });
    writeFileSync(join(home, 'fixture-tls-refused'), '');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL cert: /m);
    expect(r.code).toBe(1);
  });
});
