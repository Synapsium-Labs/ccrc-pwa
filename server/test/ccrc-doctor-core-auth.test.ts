// `ccrc doctor`, part: core-auth (D-6767): the auth gate and its passphrase. It moved here unchanged from `ccrc-doctor-core.test.ts`,
// itself a part of what was one 17,000-line file, which ran about 410 s on a CI runner and past the trace job's 1560 s budget under
// `strace -f`; the fixtures the parts share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { fixtureSecretLine } from './authFixtures.js';
import { itLinux, itDarwin } from './platformFixtures.js';
import { installDoctorHooks, REPO, CCRC_SRC, CHECKS_SRC, BASH, writeAuthSecret, unstub, shq, writeCcrcEnv, unitDirOf, writeUnitFile, removeUnitFile, sysCaddyfile, runDoctor, healthy, lineFor, expectUndecided, UnitEnvAnswer, remedyFor } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

/** One row of `_box_unit_env`'s answer, read back from a sourced `ccd/ccrc`: the rc and its four out-params. */
interface UnitEnvRow { label: string; env: string | null; exp: string | 'UNREADABLE' | null; key: string }

/** The UTF-8 locale this host's bash really runs under (D-3833's pins): the first candidate under which bash counts the
 *  two-byte `é` as ONE character. A locale that is not installed falls back to C silently, which would make a UTF-8
 *  row hollow — so the probe measures the effect, and a host with none THROWS (the case fails, never skips). Linux
 *  runners carry `C.UTF-8`; macOS ships `en_US.UTF-8`, tried second. */
function utf8Locale(): string {
  for (const loc of ['C.UTF-8', 'en_US.UTF-8']) {
    const r = spawnSync(BASH, ['-c', `x=$'\\xc3\\xa9'; printf '%s' "\${#x}"`], { encoding: 'utf8', env: { LC_ALL: loc } });
    if (r.status === 0 && r.stdout === '1') return loc;
  }
  throw new Error('no UTF-8 locale takes effect in bash on this host (C.UTF-8, en_US.UTF-8): the UTF-8 rows cannot run');
}

/** `_box_unit_env <key>` over each row's fixture files, with `CCD_OS` set AFTER sourcing (so the Darwin arm runs on
 *  every platform). One bash for all rows; every result goes through a file, so no `$(…)` eats a byte. The files are
 *  written byte for byte (latin1: every row below `\u0100`). `locale` replaces the harness's `LC_ALL=C` (D-3833), and
 *  the run first proves it took effect — bash counts `é` as one character — or exits 7, which fails the case. */
function unitEnvAnswers(rows: UnitEnvRow[], os: 'linux' | 'darwin', locale = 'C'): UnitEnvAnswer[] {
  const dir = mkTmp('ccrc-doctor-unitenv-');
  rows.forEach((row, i) => {
    const d = join(dir, `r${i}`);
    mkdirSync(d, { recursive: true });
    if (row.env !== null) writeFileSync(join(d, 'ccrc.env'), row.env, 'latin1');
    if (row.exp === 'UNREADABLE') mkdirSync(join(d, 'exposure.env'));
    else if (row.exp !== null) writeFileSync(join(d, 'exposure.env'), row.exp, 'latin1');
    writeFileSync(join(d, 'key'), row.key);
  });
  const proof = locale === 'C' ? [] : [
    `x=$'\\xc3\\xa9'; [ "\${#x}" -eq 1 ] || { echo "LC_ALL=${locale} did not take effect: \${#x} characters in a 2-byte é" >&2; exit 7; }`,
  ];
  const script = [
    'set -uo pipefail', ...proof, `. ${shq(CCRC_SRC)}`, `CCD_OS=${os}`,
    `for ((i=0;i<${rows.length};i++)); do d=${shq(dir)}/r$i`,
    '  BOX_ENV_FILE=$d/ccrc.env; CCRC_EXPOSURE_FILE=$d/exposure.env; read -r key < "$d/key"',
    '  _box_unit_env "$key"; rc=$?',
    '  printf "%s" "$rc" > "$d/rc"; printf "%s" "$BUE_VAL" > "$d/val"; printf "%s" "$BUE_SRC" > "$d/src"',
    '  printf "%s" "$BUE_WHY" > "$d/why"; printf "%s" "$BUE_FIX" > "$d/fix"',
    'done',
  ].join('\n');
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: locale } });
  expect(r.status, r.stderr).toBe(0);
  return rows.map((_, i) => {
    const d = join(dir, `r${i}`);
    const g = (n: string): string => readFileSync(join(d, n), 'utf8');
    return { rc: Number(g('rc')), val: g('val'), src: g('src'), why: g('why'), fix: g('fix'),
      envPath: join(d, 'ccrc.env'), expPath: join(d, 'exposure.env') };
  });
}


describe('ccrc doctor: auth — the gate, and the passphrase it needs', () => {
  /** `CCRC_AUTH=<value>` appended to the fixture's own `ccrc.env` — the file
   *  the SERVER reads its environment from. Appended rather than rewritten so
   *  the other checks that read that file keep measuring what they measured. */
  const armGate = (home: string, value = 'on'): void => {
    const p = join(home, '.ccrc', 'ccrc.env');
    writeFileSync(p, `${readFileSync(p, 'utf8')}CCRC_AUTH=${value}\n`);
  };
  const authLine = (out: string): string => lineFor(out, 'auth') ?? '';

  // Wave 8 item D (decision D) correction: `healthy()`'s exposure file carries
  // CCRC_AUTH=on (`writeExposureEnv`, :769-790) — under the fix, `_check_auth`
  // reads the flag through `_box_unit_env`, which honours that file, so every
  // case below that expected the gate OFF while building on `healthy()` alone
  // was passing at main only on the live defect: the exposure file's
  // CCRC_AUTH=on did not arm the gate. `unexposedBox` is `unexposed()`'s own
  // recipe (the update-exposure describe below, :7145) copied here so a
  // "gate OFF" case is built on a box that really is unexposed.
  const unexposedBox = (prefix: string, env = 'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n'): string => {
    const home = healthy(prefix);
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, '.ccrc', 'Caddyfile'), { force: true });
    rmSync(sysCaddyfile(home), { force: true });
    writeCcrcEnv(home, env);
    return home;
  };

  it('PASSES a box with no passphrase and the gate off — a fresh install ends GREEN', () => {
    // ── OPERATOR RULING (Task 9 review), amending the plan's own text ─────
    // This shipped as a WARN, faithfully to the plan. The operator overruled
    // it: `CCRC_AUTH` off with no passphrase is the state EVERY box ships in —
    // `ccrc install` writes no passphrase, by doctrine — so the warning ended
    // every clean install yellow, which trains an operator to skim past the
    // warnings that matter. The state is a fact about a box configured the way
    // the project ships it (`rc`'s rule), and the arming instructions ride the
    // DETAIL as next-steps text instead of a remedy.
    const home = unexposedBox('ccrc-doctor-auth-none-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file at .*\/\.ccrc\/auth\.scrypt/);
    // …and the line still says, out loud, that nothing is gated. A PASS that
    // read as "we are protected" would be worse than the WARN it replaced.
    expect(authLine(r.stdout)).toMatch(/nothing is gated/);
    expect(authLine(r.stdout)).toMatch(/ccrc passwd/);
    // A PASS owes no remedy line, and must not print one.
    expect(remedyFor(r.stdout, 'auth')).toBe('');
    expect(r.code).toBe(0);
  });

  it('names CCRC_RP_ID and CCRC_ORIGIN in the same breath as CCRC_AUTH', () => {
    // Task 8's finding, and the reason it has to be said by the CLI: with the
    // flag armed and those two wrong, every /ws/* upgrade and every non-exempt
    // write is refused from the real origin — and the server cannot warn about
    // it at boot, because behind `tailscale serve` it never learns the
    // hostname it is reached under. An operator who arms the flag from this
    // line alone would find out one tap at a time.
    const home = unexposedBox('ccrc-doctor-auth-rpid-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const line = authLine(runDoctor(home).stdout);
    expect(line).toContain('CCRC_AUTH=on');
    expect(line).toContain('CCRC_RP_ID');
    expect(line).toContain('CCRC_ORIGIN');
  });

  it('FAILS when the gate is ARMED and there is no passphrase — the fail-shut state, made visible', () => {
    // `readAuthSecret` returning null with the flag on is Task 5's fail-SHUT
    // polarity: every route answers 401 `'unconfigured'` and no login can
    // succeed. The server logs one line at boot; this is the instrument that
    // reports it without reading a journal.
    const home = healthy('ccrc-doctor-auth-armed-none-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*CCRC_AUTH=on.*NO passphrase file/);
    expect(authLine(r.stdout)).toMatch(/failing SHUT|401/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/ccrc passwd/);
    expect(r.code).toBe(1);
  });

  it('PASSES an armed box with a usable passphrase, naming what it measured', () => {
    const home = healthy('ccrc-doctor-auth-armed-ok-');
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on/);
    // The detail is a MEASUREMENT, never the bare word "ok": the parameters
    // and the generation the reader really found in the file.
    expect(authLine(r.stdout)).toMatch(/N=\d+,r=\d+,p=\d+,gen=\d+/);
    expect(r.code).toBe(0);
  });

  it('PASSES a box with a passphrase and the gate OFF — and says nothing is gated yet', () => {
    // A PASS rather than a WARN: `CCRC_AUTH` off is the shipped default and a
    // legitimate state (`rc`'s rule — a doctor that WARNed here would be
    // asserting a preference). The detail is what stops the line reading as
    // "we are protected".
    const home = unexposedBox('ccrc-doctor-auth-unarmed-ok-');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: .*holds a usable passphrase/);
    expect(authLine(r.stdout)).toMatch(/the gate is OFF \(CCRC_AUTH is not "on"/);
    expect(authLine(r.stdout)).toMatch(/no request is gated yet/);
    expect(r.code).toBe(0);
  });

  it('reads the flag from the unit\'s env files and NOT from the shell it was run in', () => {
    // The server's environment comes from `ccrc.service`'s `EnvironmentFile=`
    // lines, i.e. from `~/.ccrc/ccrc.env` then the exposure file. An exported
    // `CCRC_AUTH` in the operator's own shell arms nothing, and a check that
    // believed it would report a box that does not exist — here, a FAIL about
    // a fail-shut gate on a box whose gate is off.
    const home = unexposedBox('ccrc-doctor-auth-env-shell-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home, ['doctor'], { CCRC_AUTH: 'on' });
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
    expect(r.code).toBe(0);
  });

  it('reads a value systemd would not set as OFF, exactly as config.ts does', () => {
    // `config.ts#loadConfig` is `env.CCRC_AUTH === 'on'` and nothing else. A check
    // laxer OR stricter than the reader it describes reports a box nobody is
    // running — `_check_config` pins the same rule for CCRC_FLEET.
    const home = unexposedBox('ccrc-doctor-auth-flagcase-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    // D-3824: `'on '` and `'"on"x'` LEFT this list. `'on '` was pinned OFF on a wrong premise — systemd hands `on` to the
    // server for `CCRC_AUTH=on ` (A1 below, which expects ARMED) — and `'"on"x'` is now case E8: this reader does not
    // model what either parser does after a closing quote, so it answers "not measured", never a value.
    for (const v of ['ON', 'true', 'yes']) {
      armGate(home, v);
      expect(authLine(runDoctor(home).stdout), v).toMatch(/^PASS auth: no passphrase file/);
      writeCcrcEnv(home, readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
        .split('\n').filter((l) => !l.startsWith('CCRC_AUTH=')).join('\n'));
    }
  });

  it('FAILS on a file the server would refuse to boot on, and quotes NOT ONE BYTE of it', () => {
    // The boot-brick state. With the flag on, `buildServer`'s uncaught
    // `readAuthSecret` means the unit does not come up at all — which reaches
    // an operator as a dead service and a journal to read, unless something
    // measured it first.
    //
    // AND THE CONTENT NEVER APPEARS. `AuthSecretUnusable`'s message quotes the
    // FIELD it choked on — measured: `unknown prefix "<field 1>" (want
    // "scrypt")` — so a misplaced copy of some other secret would put its
    // bytes, verbatim, in a transcript that goes into a ticket. CLAUDE.md:
    // never print secret file CONTENTS. The fixture is exactly that shape.
    const home = healthy('ccrc-doctor-auth-garbled-');
    const planted = 'PLANTED-SECRET-9f3a2b';
    writeAuthSecret(home, `${planted}$b$c$d$e\n`);
    armGate(home);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*auth\.scrypt exists and this box cannot use it/);
    expect(authLine(r.stdout)).toMatch(/REFUSES TO BOOT/);
    expect(r.stdout).not.toContain(planted);
    expect(r.stderr).not.toContain(planted);
    // The remedy is the `mv`, because `ccrc passwd` REFUSES to overwrite a file
    // it cannot read (it cannot read the generation either, and inventing one
    // revalidates sessions instead of expiring them). A bare `ccrc passwd` here
    // would send an operator to a command that is about to refuse.
    // The session file is NAMED, absolutely, and resolved rather than assumed —
    // see the override case below.
    expect(remedyFor(r.stdout, 'auth'))
      .toMatch(/mv .*auth\.scrypt .*auth\.scrypt\.broken && rm -f .*sessions\.json && ccrc passwd/);
    expect(remedyFor(r.stdout, 'auth')).toContain(join(home, '.ccrc', 'sessions.json'));
    expect(r.code).toBe(1);
  });

  it('the remedy RESOLVES the session file, it does not hard-code it (D-148)', () => {
    // D-143's defect class, one key over. This remedy resolved the SECRET
    // through `_box_auth_path` and then printed a literal
    // `rm -f ~/.ccrc/sessions.json` beside it — so on a box that redirects
    // `CCRC_SESSIONS_PATH` it told the operator to delete a file nothing reads,
    // leaving the sessions that the fresh generation-1 secret is about to
    // REVALIDATE exactly where they were. Both paths now come from one
    // parameterised resolver, so they cannot disagree.
    const home = healthy('ccrc-doctor-auth-sessover-');
    writeAuthSecret(home, 'PLANTED-SECRET-4c1a$b$c$d$e\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
      }CCRC_SESSIONS_PATH=/srv/ccrc/sessions.json\n`);
    const remedy = remedyFor(runDoctor(home).stdout, 'auth');
    expect(remedy).toContain('rm -f /srv/ccrc/sessions.json');
    expect(remedy).not.toContain('.ccrc/sessions.json');
    expect(remedy).toContain('CCRC_SESSIONS_PATH');
  });

  it('names NO session file at all when CCRC_SESSIONS_PATH is relative', () => {
    // The `_box_auth_path` rule for a relative override, reached by the same
    // code: the server resolves it against systemd's working directory and this
    // tool against the operator's, so nothing on the box can say which file it
    // is. A remedy that guessed would delete something else.
    const home = healthy('ccrc-doctor-auth-sessrel-');
    writeAuthSecret(home, 'PLANTED-SECRET-4c1a$b$c$d$e\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')
      }CCRC_SESSIONS_PATH=sessions.json\n`);
    const remedy = remedyFor(runDoctor(home).stdout, 'auth');
    expect(remedy).toContain("rm -f <this box's session file>");
    expect(remedy).toContain('RELATIVE');
    // …and it must not have fallen back to the default, which is the mistake
    // this arm exists to refuse.
    expect(remedy).not.toContain(join(home, '.ccrc', 'sessions.json'));
  });

  it('FAILS on the same file with the gate OFF too — a boot refusal waiting to happen', () => {
    // Same class, different tense, and the tense is in the detail: the box
    // works today, and the one command that arms it takes the server down.
    const home = unexposedBox('ccrc-doctor-auth-garbled-off-');
    writeAuthSecret(home, 'not a secret line at all\n');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);
    expect(authLine(r.stdout)).toMatch(/the moment CCRC_AUTH=on is set, the server will refuse to boot/);
    expect(r.code).toBe(1);
  });

  it('never prints the salt or the hash out of a file it CAN read', () => {
    const home = healthy('ccrc-doctor-auth-quiet-');
    const r = runDoctor(home);
    const [, , salt, hash] = fixtureSecretLine().trim().split('$');
    expect(salt.length).toBeGreaterThan(10);
    expect(r.stdout).not.toContain(salt);
    expect(r.stdout).not.toContain(hash);
  });

  it('WARNS — not passes — when this box has no server build to read the file with', () => {
    // A dev checkout that never ran `npm run build`. The file is there and
    // nothing on this box can say whether it is usable, which is neither a
    // PASS (nothing was measured) nor a FAIL (nothing is known to be wrong).
    const home = healthy('ccrc-doctor-auth-nobuild-');
    // `dist/` only — `server/package.json` beside it is what the `node` check
    // reads its floor out of, and taking that away too would make this a test
    // about two checks at once.
    rmSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^WARN auth: .*no server build/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/npm run build/);
    expect(r.code).toBe(0);
  });

  it('FAILS, naming the node check, when node is not on PATH', () => {
    // `_check_wrappers`' rule: a box with no node gets exactly one FAIL about
    // node itself, and every check that NEEDED it says which one to read
    // rather than inventing a second diagnosis of the same absence.
    const home = healthy('ccrc-doctor-auth-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: node is not on PATH/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/see the 'node' check above/);
  });

  it('FAILS, blaming ccrc, when the hasher did not ship beside it', () => {
    const home = healthy('ccrc-doctor-auth-nohelper-');
    rmSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper is missing/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
  });

  it('SKIPS on a FLEET-ROLE box — the gate belongs to the server, with no remedy', () => {
    // `_check_config`'s D-86 evidence, reused for the same reason: `ccrc` ships
    // to the fleet host, nothing there reads `~/.ccrc/auth.scrypt`, and a WARN
    // would send that operator to write a file no process will ever open. NO
    // REMEDY under a skip — there is nothing here to fix.
    const home = healthy('ccrc-doctor-auth-fleetrole-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP auth: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) auth: /m);
    expect(r.stdout).not.toMatch(/ccrc passwd/);
  });

  // ── CCRC_AUTH_SECRET_PATH: the override, and the silent no-op it would be ──
  // `config.ts#loadConfig` is `env.CCRC_AUTH_SECRET_PATH || <default>`, so a box can
  // redirect the gate's secret. A doctor that measured the DEFAULT on such a
  // box would report `PASS auth … gen=1` about a file nothing reads — right
  // after a `ccrc passwd` that wrote the same wrong file. An operator rotating
  // after a compromise would get a green transcript over a live, unchanged
  // secret. Both tools go through ONE resolver (`ccrc`'s `_box_auth_path`).

  it('MEASURES the overridden path, and says the redirect out loud', () => {
    const home = healthy('ccrc-doctor-auth-override-');
    const elsewhere = join(home, 'secrets', 'gate.scrypt');
    mkdirSync(join(home, 'secrets'), { recursive: true });
    writeFileSync(elsewhere, fixtureSecretLine(), { mode: 0o600 });
    // …and the DEFAULT path is deliberately left holding something unusable:
    // if the check were still reading it, this would be a FAIL, not a PASS.
    writeAuthSecret(home, 'not a secret line at all\n');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=${elsewhere}\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toContain(elsewhere);
    expect(authLine(r.stdout)).toContain('CCRC_AUTH_SECRET_PATH');
    expect(r.code).toBe(0);
  });

  it('FAILS a RELATIVE override rather than guessing which file it means', () => {
    // `config.ts` does not resolve it either, so the server resolves it against
    // whatever working directory systemd gives ccrc.service and every tool
    // against its own. Nothing on the box can say which file the secret is, and
    // a verdict about "the secret" is not available.
    const home = healthy('ccrc-doctor-auth-relative-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: .*RELATIVE path \(secrets\/gate\.scrypt\)/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/make it absolute/);
    expect(r.code).toBe(1);
  });

  it('an EMPTY override is absent, exactly as config.ts\'s `||` reads it', () => {
    // The bare-`KEY=` lesson (`accountsPath`, D-…): systemd sets an empty
    // string for `CCRC_AUTH_SECRET_PATH=`, and `||` falls through to the
    // default. A resolver using `??` would take the empty string as a path.
    const home = healthy('ccrc-doctor-auth-emptyoverride-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH_SECRET_PATH=\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toContain(join(home, '.ccrc', 'auth.scrypt'));
    expect(authLine(r.stdout)).not.toContain('CCRC_AUTH_SECRET_PATH');
  });

  // ── the two layers that keep a byte of the file off the screen ───────────
  // D-140 rests on TWO defences, and each one alone is enough to keep the suite
  // green while the other is deleted — which is how a defence-in-depth pair
  // quietly becomes a defence-in-depth single. Both are pinned here with a
  // STUB helper: the fixture's copy is replaced by a script that leaks
  // deliberately, so the check's own containment is what is under test.

  /** Replace the fixture's helper copy with a script of our own. */
  const stubHelper = (home: string, body: string): void =>
    writeFileSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'),
      `#!/usr/bin/env node\n${body}\n`, { mode: 0o644 });

  it('discards the helper\'s stderr — a leaky subprocess cannot print through this check', () => {
    const home = healthy('ccrc-doctor-auth-stderr-');
    const planted = 'LEAKED-VIA-STDERR-4b1c';
    stubHelper(home, `process.stderr.write(${JSON.stringify(planted)} + "\\n"); process.exit(4);`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);      // the state still lands
    expect(r.stdout).not.toContain(planted);
    expect(r.stderr).not.toContain(planted);
  });

  it('refuses a state line it does not recognise instead of printing it', () => {
    // The second layer. `--check`'s stdout crosses into a verdict line a human
    // reads on a terminal that acts on control bytes, so it is pinned to a
    // shape rather than trusted — `_box_build_fields`' rule for the build
    // stamp's fields.
    const home = healthy('ccrc-doctor-auth-shape-');
    const planted = 'LEAKED-VIA-STDOUT-7c2d';
    stubHelper(home, `process.stdout.write(${JSON.stringify(planted)} + "\\n"); process.exit(0);`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper reported a state line this check does not recognise/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
    expect(r.stdout).not.toContain(planted);
  });

  it('names an exit code it does not understand as a bug in ccrc', () => {
    // `_check_wrappers` pins the same arm for the same reason: a code nobody
    // taught this check about must not fall through to one of the legal
    // answers.
    const home = healthy('ccrc-doctor-auth-badcode-');
    stubHelper(home, 'process.exit(9);');
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^FAIL auth: reading .* exited 9 — this check does not know what that means/);
    expect(remedyFor(r.stdout, 'auth')).toMatch(/bug in ccrc/);
    expect(r.code).toBe(1);
  });

  it('a dev checkout with no units at all is NOT the fleet role — it still answers', () => {
    // The other side of that branch, exactly as `config` draws it: "no
    // ccrc.service" alone is also a box that has installed nothing, and a dev
    // checkout DOES run a server.
    const home = unexposedBox('ccrc-doctor-auth-nounits-');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    rmSync(unitDirOf(home), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
    expect(r.stdout).not.toMatch(/^SKIP auth: /m);
  });

  // ── wave 8 item D (decision D): the flag as ccrc.service actually gets it ─
  // The unit carries TWO EnvironmentFile lines, ccrc.env then the
  // exposure file, and the later one wins by PRESENCE — `_box_unit_env`,
  // shared with `_check_update-exposure` and install's gate line. D4–D6
  // below are D-3596's unreadable-exposure-file cases.

  it('D1: the exposure file OVERRIDES ccrc.env — CCRC_AUTH=off there does not disarm a box `ccrc expose` armed (the live defect this wave fixes)', () => {
    const home = healthy('ccrc-doctor-auth-exposure-wins-');
    writeCcrcEnv(home, `${readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')}CCRC_AUTH=off\n`);
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on/);
    expect(authLine(r.stdout)).toContain(join(home, '.ccrc', 'exposure.env'));
    expect(authLine(r.stdout)).toMatch(/logins are gated/);
    expect(r.code).toBe(0);
  });

  it('D2: a present-but-empty CCRC_AUTH= in the exposure file wins over ccrc.env=on — gate OFF, and the arming words name the file that decides it', () => {
    const home = unexposedBox('ccrc-doctor-auth-bare-exp-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    writeFileSync(join(home, '.ccrc', 'exposure.env'), '# fixture — a hand-edited bare line\nCCRC_AUTH=\n');
    const r = runDoctor(home);
    const exp = join(home, '.ccrc', 'exposure.env');
    expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
    expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
    expect(authLine(r.stdout)).toContain(exp);
    expect(authLine(r.stdout)).toContain(`set CCRC_AUTH=on in ${exp}, which overrides`);
    expect(remedyFor(r.stdout, 'auth')).toBe('');
  });

  it('D3: an unexposed box with CCRC_AUTH=on in ccrc.env and no passphrase — the fail-shut FAIL, unaffected by item D', () => {
    const home = unexposedBox('ccrc-doctor-auth-d3-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=on\n');
    rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
    const r = runDoctor(home);
    expect(authLine(r.stdout)).toBe(
      `FAIL auth: CCRC_AUTH=on in ${join(home, '.ccrc', 'ccrc.env')} and there is NO passphrase file at `
      + `${join(home, '.ccrc', 'auth.scrypt')} — the gate is armed and failing SHUT: every route answers `
      + '401 and no login can succeed');
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    // Controller fix round 1: "one WARN auth, rc 2" is a COUNT, not just a
    // shape — a mutation that fired the block twice (once per flag-dependent
    // arm it guards) would still match `/^WARN auth: /` on the FIRST line
    // `lineFor` returns. `rc 2` itself is `_dr_warn`'s own return, pinned
    // generically elsewhere (the header's own "`_dr_warn` exists and returns
    // rc 2" measurement); the class this check answers with is WARN, and
    // that class is observable only through the verdict word on the line —
    // there is no separate "rc 2" annotation doctor prints per check.
    'D4: an exposure file that is there and cannot be read is UNMEASURED — one WARN, naming the file, with a usable passphrase', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      const r = runDoctor(home);
      const warnLines = r.stdout.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warnLines.length, r.stdout).toBe(1);
      expect(warnLines[0]).toContain(join(home, '.ccrc', 'exposure.env'));
      expect(warnLines[0]).toMatch(/was not measured/);
      expect(authLine(r.stdout)).toMatch(/^WARN auth: /);
      // Fix round 1 item 3 / review 196 F4: the verdict no longer claims which
      // file would have won — what the service manager does with an
      // unreadable exposure file was not measured, on either platform.
      expect(warnLines[0]).not.toContain('would win');
      expect(warnLines[0]).not.toContain('would have won');
      // …and the remedy no longer states the macOS-stops-the-job premise that
      // was wrong; it still points the operator at the file itself.
      expect(remedyFor(r.stdout, 'auth')).not.toContain('stops the server job');
      expect(remedyFor(r.stdout, 'auth')).toContain('ls -ld');
    });

  it.skipIf(process.getuid?.() === 0)(
    // Controller fix round 1: item D's rc-3 unmeasured block is UNPINNED by
    // D4/D5/D6 alone — all three keep an auth.scrypt, so deleting the rc-3
    // block (as opposed to the rc-0 one D4 already pins) never reds any of
    // them. This is the rc-3 twin: no passphrase file EITHER, same unreadable
    // exposure file — the false verdict item D exists to stop is exactly
    // "PASS auth: … the gate is OFF …" on a box whose real armed state
    // nothing here measured. Root reads through a chmod 000, so this case
    // cannot run as uid 0 — skipped there, not weakened.
    'D4b: the SAME unreadable exposure file with NO passphrase file either is still UNMEASURED — one WARN, never the false "gate is OFF" PASS', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-nofile-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      const r = runDoctor(home);
      const warnLines = r.stdout.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warnLines.length, r.stdout).toBe(1);
      expect(warnLines[0]).toContain(join(home, '.ccrc', 'exposure.env'));
      expect(warnLines[0]).toMatch(/was not measured/);
      expect(r.stdout).not.toMatch(/^PASS auth: /m);
    });

  it.skipIf(process.getuid?.() === 0)(
    'D5: the same unreadable exposure file with a GARBLED auth.scrypt is still a FAIL (rc 4 is flag-independent) — no WARN auth: line', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-garbled-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      writeAuthSecret(home, 'not a secret line at all\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: /);
      // rc 4's third tense (unmeasured=1): the armed-vs-unarmed wording
      // never applies here — neither ccrc.env nor the exposure file's
      // CCRC_AUTH is knowable, so the sentence hedges on the condition
      // itself rather than asserting either state.
      expect(authLine(r.stdout)).toContain('if CCRC_AUTH is on (');
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
      // Fix round 1 item 3 / review 196 F4: the hedge no longer names the
      // exposure file as the one "which decides it" — which file would win
      // was never measured either.
      expect(authLine(r.stdout)).not.toContain('which decides it');
    });

  it.skipIf(process.getuid?.() === 0)(
    'D6: the same unreadable exposure file with the helper MISSING is still the helper FAIL — no WARN auth: line', () => {
      const home = healthy('ccrc-doctor-auth-exp-unread-nohelper-');
      chmodSync(join(home, '.ccrc', 'exposure.env'), 0o000);
      rmSync(join(home, 'ccrc', 'deploy', 'gen-auth-hash.mjs'), { force: true });
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: the passphrase helper is missing/);
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

  it('D7: an unexposed box whose ccrc.env says CCRC_AUTH=off stays OFF even with CCRC_AUTH=on exported in doctor\'s own shell', () => {
    const home = unexposedBox('ccrc-doctor-auth-d7-',
      'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_AUTH=off\n');
    const r = runDoctor(home, ['doctor'], { CCRC_AUTH: 'on' });
    expect(authLine(r.stdout)).toMatch(/gate is OFF/);
    expect(authLine(r.stdout)).not.toMatch(/^FAIL auth: /);
  });

  // D8's model: `ccrc-doctor-core-state.test.ts`'s own update-sync case
  // ("says so, rather than guessing, when ccrc's own update-intent reader is
  // not loaded") sources the check table WITHOUT ccrc's constants. This case
  // sources ccrc TOO (so `_box_unit_env`, `_box_auth_path` and
  // `_box_sessions_path` ARE declared), but strips the one thing the new
  // preflight also requires: `CCRC_EXPOSURE_FILE`.
  it('D8: sourced with ccrc\'s own functions loaded but no CCRC_EXPOSURE_FILE — "the config reader is not loaded" FAIL', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-auth');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; unset CCRC_EXPOSURE_FILE; _check_auth`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL auth: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  // Fix round 1 item 4 / review 196 F5: `_check_auth`'s guard tests
  // `_box_unit_env` too (`:1282`). Unlike D8, this sources BOTH files intact
  // and removes only the FUNCTION, so every constant the guard also checks
  // stays present — a dropped `_box_unit_env` term is the only thing that can
  // red this pin. `BUE_VAL=on` is preset AFTER sourcing ccrc (a shell
  // assignment, never an env entry — `BUE_VAL=""`, the out-param block's first line above `_box_unit_env`, resets it at file scope
  // on load) in case some path through the ungoverned body reads it, but in
  // THIS harness (`PATH` pointing nowhere) it never gets the chance.
  // MEASURED (wave 9, R11-F2), with the guard's `|| ! declare -F _box_unit_env`
  // term dropped from a scratch copy of the checks file: the read
  // `_box_unit_env CCRC_AUTH || unmeasured=$?` runs the missing function
  // (bash prints `_box_unit_env: command not found` on stderr, rc 127 lands in
  // `unmeasured`), nothing between that read and the node check prints the
  // unmeasured state, and `_check_auth` prints `FAIL auth: node is not on PATH,
  // so the passphrase file could not be read` (the node check, `command -v node`
  // under `PATH` pointing nowhere) and returns 1 — never the not-measured WARN.
  // So it is the SPECIFIC regex below, not a stale-ARMED read, that makes this
  // pin red.
  it('the not-loaded guard also requires _box_unit_env — without that term the read\'s `command not found` (rc 127) is swallowed by `|| unmeasured=$?` and the node check FAILs instead, not this check’s own text', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-auth-bue');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(CCRC_SRC)}; . ${shq(CHECKS_SRC)}; unset -f _box_unit_env; BUE_VAL=on; _check_auth`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL auth: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });

  // ── wave 9 R10a/R10e (D-3822, D-3823, D-3824) ───────────────────────────
  // The flag as the unit's FEEDER hands it. Linux: systemd's `EnvironmentFile=`, which discards whitespace around an
  // unquoted value — modelled — and whose other quirks are not modelled but REPORTED as not measured. macOS: the
  // launchd job's `set -a; . file` under bash, where a file that is not plain assignments throughout (round-2 ruling
  // R-A) makes every key not measured. Cases marked `d` are the macOS twins of the Linux case before them and run on
  // macOS only (`itDarwin`); the Linux ones cannot run there for the platform's own reason.
  describe('wave 9 R10a/R10e — the flag as the unit\'s feeder hands it, and not measured where that cannot be decided', () => {
    const envPath = (home: string): string => join(home, '.ccrc', 'ccrc.env');
    const expPath = (home: string): string => join(home, '.ccrc', 'exposure.env');
    const readEnv = (home: string): string => readFileSync(envPath(home), 'utf8');
    /** The 1-based number of the LAST line of a file that ends in a newline. */
    const lastLineNo = (p: string): number => readFileSync(p, 'utf8').split('\n').length - 1;
    const editExposure = (home: string, f: (s: string) => string): void =>
      writeFileSync(expPath(home), f(readFileSync(expPath(home), 'utf8')));
    /** `unexposedBox`, no passphrase, then `CCRC_AUTH=<value>` appended — A1/E4/E6/E7/E8/E11/E12's box. */
    const noPassBox = (prefix: string, appended: string): string => {
      const home = unexposedBox(prefix);
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}${appended}`);
      return home;
    };
    /** Exactly one `WARN auth` line, not measured, about `file` — and never a PASS or FAIL auth line. */
    const expectOneUndecidedWarn = (out: string, file: string): void => {
      const warns = out.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warns.length, out).toBe(1);
      expectUndecided(warns[0] ?? '', file);
      expect(out).not.toMatch(/^(PASS|FAIL) auth: /m);
    };

    // D-3824: `reads a value systemd would not set as OFF` once pinned `'on '` as OFF. systemd hands `on` to the
    // server for `CCRC_AUTH=on ` (it discards the whitespace), so that premise was wrong.
    itLinux('A1: whitespace around an UNQUOTED value is discarded, as systemd discards it — `on `, `on<tab>`, ` on` and `<tab>on ` all arm the gate', () => {
      const home = noPassBox('ccrc-doctor-auth-a1-', '');
      const base = readEnv(home);
      for (const v of ['on ', 'on\t', ' on', '\ton ']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        const r = runDoctor(home);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/failing SHUT/);
        expect(r.code, JSON.stringify(v)).toBe(1);
      }
    });

    // PLATFORM-ONLY: this is the macOS reader — the launchd job sources the file with `set -a; . file`, so bash's
    // rules decide the line, where on Linux systemd's EnvironmentFile= does (A1). Its Linux twin is A1.
    itDarwin('A1d: the same box on macOS — a trailing space or tab is dropped by bash (ARMED); a leading one makes the line a command, so not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-a1d-', '');
      const base = readEnv(home);
      for (const v of ['on ', 'on\t']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        const r = runDoctor(home);
        expect(authLine(r.stdout), JSON.stringify(v)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
        expect(r.code, JSON.stringify(v)).toBe(1);
      }
      for (const v of [' on', '\ton ']) {
        writeCcrcEnv(home, `${base}CCRC_AUTH=${v}\n`);
        expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
        expect(authLine(runDoctor(home).stdout)).toContain(`${envPath(home)} line ${lastLineNo(envPath(home))} `);
      }
    });

    it('A2: the control — a QUOTED inner space stays, so `"on "` is not `on` and the gate is OFF (green at main, on both platforms)', () => {
      const home = noPassBox('ccrc-doctor-auth-a2-', 'CCRC_AUTH="on "\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: no passphrase file/);
      expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
      expect(r.code).toBe(0);
    });

    it('E1: the exposure file names the flag with spaces around `=` — one WARN, not measured, naming that file (main: a false ARMED PASS)', () => {
      const home = healthy('ccrc-doctor-auth-e1-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH = off\n'));
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, expPath(home));
    });

    it('E2: a physical line ending in a backslash above the key line in the exposure file — not measured (main: a false ARMED PASS)', () => {
      const home = healthy('ccrc-doctor-auth-e2-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      // ASCII-only comment: with the fixture's em-dash comment AND a line ending in a backslash the file is not measured
      // as a whole instead (D-3831, fix round 2 — E18); this case is about the per-key continuation.
      editExposure(home, (s) => s.replace('\u2014', '-').replace('CCRC_AUTH=on\n', 'FOO=bar \\\nCCRC_AUTH=on\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    itLinux('E3: a key line after a comment ending in \\ is not measured — systemd before v254 continued it, v254+ does not, and the reader does not know which runs', () => {
      const home = healthy('ccrc-doctor-auth-e3-');
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', '# a comment ending in a backslash \\\nCCRC_AUTH=on\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    // PLATFORM-ONLY: bash ends a comment at the newline; systemd's EnvironmentFile= (E3) may continue it
    // after a backslash. The two readers disagree, so each has its own case. Its Linux twin is E3.
    itDarwin('E3d: the same files read gated on macOS — bash ends a comment at the newline, backslash or not (measured, bash 5.2)', () => {
      const home = healthy('ccrc-doctor-auth-e3d-');
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', '# a comment ending in a backslash \\\nCCRC_AUTH=on\n'));
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
    });

    it('E4: `CCRC_AUTH = on` in ccrc.env, no passphrase — one WARN, not measured, naming ccrc.env (main: a false OFF PASS)', () => {
      const home = noPassBox('ccrc-doctor-auth-e4-', 'CCRC_AUTH = on\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itLinux('E5: the control for precedence by presence — an undecidable ccrc.env LOSES to an exposure file that decides the key, as the second EnvironmentFile= does (green at main by accident)', () => {
      const home = healthy('ccrc-doctor-auth-e5-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH = on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH=off\n'));
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: .*but the gate is OFF/);
      expect(authLine(r.stdout)).toContain(expPath(home));
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

    // PLATFORM-ONLY: the macOS reader is bash's `. file`, whose whole-file rule has no precedence over a
    // failing file; on Linux the second EnvironmentFile= wins by presence (E5). Its Linux twin is E5.
    itDarwin('E5d: the same files on macOS — the WHOLE-FILE rule has no precedence over a failing file: not measured, naming ccrc.env', () => {
      const home = healthy('ccrc-doctor-auth-e5d-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH = on\n`);
      editExposure(home, (s) => s.replace('CCRC_AUTH=on\n', 'CCRC_AUTH=off\n'));
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itLinux('E6: `export CCRC_AUTH=on` in ccrc.env, no exposure file — not measured (systemd does not take `export`)', () => {
      const home = noPassBox('ccrc-doctor-auth-e6-', 'export CCRC_AUTH=on\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    // PLATFORM-ONLY: bash accepts `export NAME=value` as a plain assignment; systemd's EnvironmentFile=
    // does not take `export` (E6). The platforms differ by reader. Its Linux twin is E6.
    itDarwin('E6d: the same line on macOS — bash\'s `export NAME=value` is a plain assignment, so ARMED, and with no passphrase the gate FAILs shut', () => {
      const home = noPassBox('ccrc-doctor-auth-e6d-', 'export CCRC_AUTH=on\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
      expect(r.code).toBe(1);
    });

    it('E6b: the export arm\'s control — `export CCRC_AUTH_SECRET_PATH=…` is another key, so `CCRC_AUTH=off` after it is MEASURED (OFF), on both platforms', () => {
      const missing = join(mkTmp('ccrc-doctor-auth-e6b-secret-'), 'no-such-secret');
      const home = unexposedBox('ccrc-doctor-auth-e6b-');
      writeCcrcEnv(home, `${readEnv(home)}export CCRC_AUTH_SECRET_PATH=${missing}\nCCRC_AUTH=off\n`);
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: /);
      expect(authLine(r.stdout)).toMatch(/the gate is OFF/);
      expect(authLine(r.stdout)).not.toContain('was not measured');
    });

    it('E7: `CCRC_AUTH="o\\"n"` — an escaped quote inside the value — is not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-e7-', 'CCRC_AUTH="o\\"n"\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E8: `CCRC_AUTH="on"x` — text after a closing quote, the value that left the `reads a value systemd would not set as OFF` list — is not measured (main: PASS OFF)', () => {
      const home = noPassBox('ccrc-doctor-auth-e8-', 'CCRC_AUTH="on"x\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E9: an unclosed double quote that may swallow the key line — not measured, naming the exposure file (main: a false ARMED)', () => {
      const home = healthy('ccrc-doctor-auth-e9-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), 'CCRC_ORIGIN="https://x\nCCRC_AUTH=on\nCCRC_RP_ID=x\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    it('E10: a single-quoted value spanning lines may swallow the key line — not measured (main: a false ARMED)', () => {
      const home = healthy('ccrc-doctor-auth-e10-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), "FOO='a\nCCRC_AUTH=on\n'\n");
      expectOneUndecidedWarn(runDoctor(home).stdout, expPath(home));
    });

    it('E11: an unquoted escape — `CCRC_AUTH=o\\n` (systemd reads `on`) — is not measured (main: PASS OFF)', () => {
      const home = noPassBox('ccrc-doctor-auth-e11-', 'CCRC_AUTH=o\\n\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    it('E12: a trailing unpaired quote — `CCRC_AUTH=on"` — is not measured', () => {
      const home = noPassBox('ccrc-doctor-auth-e12-', 'CCRC_AUTH=on"\n');
      expectOneUndecidedWarn(runDoctor(home).stdout, envPath(home));
    });

    itDarwin('E13: the round-2 attack\'s readonly shape — `readonly CCRC_AUTH` in ccrc.env keeps `off` against the exposure file\'s `on` — is not measured, naming ccrc.env line 2 of the failing shape, never the exposure file\'s PASS', () => {
      const home = healthy('ccrc-doctor-auth-e13-');
      const base = readEnv(home);
      writeCcrcEnv(home, `${base}CCRC_AUTH=off\nreadonly CCRC_AUTH\n`);
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, envPath(home));
      expect(authLine(r.stdout)).toContain(`${envPath(home)} line ${base.split('\n').length + 1} `);
    });

    itLinux('E13l: the control — the same files read gated on Linux (systemd ignores a line with no `=`, and the exposure file wins by presence)', () => {
      const home = healthy('ccrc-doctor-auth-e13l-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\nreadonly CCRC_AUTH\n`);
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
      expect(authLine(r.stdout)).toContain(expPath(home));
    });

    // PLATFORM-ONLY: this is systemd's EnvironmentFile= reading — it discards a CR. The macOS reader is
    // bash's `. file`, which keeps it, so that platform's answer differs. Its macOS twin is E14d.
    itLinux('E14: a CR in the OTHER file is discarded by systemd — `CCRC_AUTH=on` in ccrc.env still arms, and with no passphrase the gate FAILs shut, as at main', () => {
      const home = healthy('ccrc-doctor-auth-e14-');
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(home), 'CCRC_RP_ID=x\r\n');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^FAIL auth: CCRC_AUTH=on in .*NO passphrase file/);
      expect(r.code).toBe(1);
    });

    // PLATFORM-ONLY: bash's `. file` keeps a CR in the value; systemd's EnvironmentFile= discards it
    // (E14). The platforms differ by reader. Its Linux twin is E14.
    itDarwin('E14d: the same files on macOS — bash keeps a CR in the exposure file\'s value, so not measured, naming the exposure file line 1', () => {
      const home = healthy('ccrc-doctor-auth-e14d-');
      rmSync(join(home, '.ccrc', 'auth.scrypt'), { force: true });
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(home), 'CCRC_RP_ID=x\r\n');
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, expPath(home));
      expect(authLine(r.stdout)).toContain(`${expPath(home)} line 1 `);
    });

    // ── wave 9 R10a (D-3831): a FILE systemd would split or skip whole ──────────────
    // Review found three shapes the Linux reader DECIDED (rc 0, `on`) while systemd hands the server something else: a
    // carriage return inside a line (systemd's NEWLINE is "\n\r", so a bare CR ends a line), a NUL byte (the file is
    // unreadable to systemd, and both EnvironmentFile= lines are `-`-prefixed, so it is skipped whole), and a byte that
    // is not valid UTF-8 in a key or value (the file fails). Each is written byte for byte (latin1).
    /** `[label, the lines that follow `CCRC_AUTH=…`'s own decider, the phrase BUE_WHY must carry]`. */
    const WHOLE_FILE: Array<[string, (decider: string) => string, string]> = [
      ['a CR inside a line', (d) => `# c\rX=1\r${d}\r\n`, 'carriage return inside a line'],
      ['a NUL byte', (d) => `CCRC_RP_ID=x\0y\n${d}\n`, 'NUL byte'],
      ['a byte that is not valid UTF-8 in a value', (d) => `CCRC_RP_ID=x\xff\n${d}\n`, 'non-ASCII byte in a NAME=value line'],
    ];
    const expectWholeFileWarn = (out: string, file: string, phrase: string, label: string): void => {
      const warns = out.split('\n').filter((l) => l.startsWith('WARN auth: '));
      expect(warns.length, `${label}\n${out}`).toBe(1);
      expect(warns[0], label).toContain(file);
      expect(warns[0], label).toContain(phrase);
      expect(warns[0], label).toContain('was not measured');
      expect(warns[0], label).not.toContain('cannot be read');
      expect(out, label).not.toMatch(/^(PASS|FAIL) auth: /m);
    };

    // PLATFORM-ONLY: splitting or skipping a file whole on a CR, NUL or non-UTF-8 byte is systemd's
    // EnvironmentFile= behaviour. bash's `. file` splits on none of them and checks no UTF-8. A NUL it neither splits on
    // nor skips: the launchd job's /bin/bash 3.2 stops reading the file at its first NUL (bash 5.2 strips each NUL
    // instead — measured, and why an earlier comment here said "neither"). The macOS whole-file cases are E5d, E14d and
    // E19d (a NUL, D-3832).
    itLinux('E15: the EXPOSURE file is split or skipped whole by systemd — ccrc.env says `on`, the exposure file `off` (or a key the reader would have decided) — not measured, never a false ARMED (main: `on`)', () => {
      for (const [label, shape, phrase] of WHOLE_FILE) {
        const home = healthy('ccrc-doctor-auth-e15-');
        writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=on\n`);
        writeFileSync(expPath(home), shape('CCRC_AUTH=off'), 'latin1');
        expectWholeFileWarn(runDoctor(home).stdout, expPath(home), phrase, label);
      }
    });

    // PLATFORM-ONLY: splitting or skipping a file whole on a CR, NUL or non-UTF-8 byte is systemd's
    // EnvironmentFile= behaviour; bash's `. file` does neither (a NUL truncates the file under /bin/bash 3.2 — E15's
    // comment). Its pair is E15; the macOS whole-file cases are E5d, E14d and E19d.
    itLinux('E16: ccrc.env is split or skipped whole by systemd — with the flag on in it and no exposure file, not measured, never a false OFF or ARMED (main: a false OFF for a CR, a false ARMED for NUL and non-UTF-8)', () => {
      for (const [label, shape, phrase] of WHOLE_FILE) {
        const home = noPassBox('ccrc-doctor-auth-e16-', '');
        writeFileSync(envPath(home), `${readEnv(home)}${shape('CCRC_AUTH=on')}`, 'latin1');
        expectWholeFileWarn(runDoctor(home).stdout, envPath(home), phrase, label);
      }
    });

    itLinux('E18: a comment-looking line inside a value that may span lines is part of that VALUE, and systemd UTF-8-checks it — the exemption is off for the whole file, so a decided key is not answered (main and round 1: a false ARMED, and a false OFF)', () => {
      // false ARMED: ccrc.env carries no key; the exposure file `decides` `on` before a quote that may span lines.
      const armed = healthy('ccrc-doctor-auth-e18a-');
      writeFileSync(expPath(armed), 'CCRC_AUTH=on\r\n"\nFOO=\'a\n # \xff\n', 'latin1');
      expectWholeFileWarn(runDoctor(armed).stdout, expPath(armed), 'non-ASCII byte in a NAME=value line', 'false ARMED');
      // false OFF: ccrc.env says `on`; the exposure file `decides` off, and systemd skips it whole.
      const off = healthy('ccrc-doctor-auth-e18b-');
      writeCcrcEnv(off, `${readEnv(off)}CCRC_AUTH=on\n`);
      writeFileSync(expPath(off), 'CCRC_AUTH=off\nFOO="a\n\r\n # \xff\n', 'latin1');
      expectWholeFileWarn(runDoctor(off).stdout, expPath(off), 'non-ASCII byte in a NAME=value line', 'false OFF');
    });

    // PLATFORM-ONLY: the launchd job's /bin/bash 3.2 stops reading a file at its first NUL byte (`_evalfile` hands it to
    // the parser as a C string), so the job never sets what follows it. Its Linux pair is E15's NUL row (systemd skips the
    // file whole); the reader table U4 runs both readers on every platform.
    itDarwin('E19d: a NUL byte anywhere in the exposure file on macOS — above the key, inside its value, or in a comment above it — is not measured, naming the file and the NUL, never a PASS ARMED (D-3832; f74f5e90: PASS, the gate off)', () => {
      const shapes: Array<[string, string]> = [
        ['a NUL at the end of a line above the key', 'X=1\0\nCCRC_AUTH=on\n'],
        ['a NUL inside the value', 'CCRC_AUTH=o\0n\n'],
        ['a NUL in a comment above the key', '# c\0\nCCRC_AUTH=on\n'],
      ];
      for (const [label, bytes] of shapes) {
        const home = healthy('ccrc-doctor-auth-e19d-');
        writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
        writeFileSync(expPath(home), bytes, 'latin1');
        const r = runDoctor(home);
        expectWholeFileWarn(r.stdout, expPath(home), 'NUL byte', label);
        expect(r.stdout, label).not.toMatch(/^PASS update-exposure: .*CCRC_AUTH=on/m);
      }
    });

    itLinux('E17: the control — a valid UTF-8 em dash in a COMMENT of the exposure file reads ARMED as before (the real writer\'s own first line carries one)', () => {
      const home = healthy('ccrc-doctor-auth-e17-');
      writeCcrcEnv(home, `${readEnv(home)}CCRC_AUTH=off\n`);
      writeFileSync(expPath(home), '# a comment with an em dash \xe2\x80\x94 in it\nCCRC_AUTH=on\n', 'latin1');
      const r = runDoctor(home);
      expect(authLine(r.stdout)).toMatch(/^PASS auth: CCRC_AUTH=on in .*logins are gated/);
      expect(r.stdout).not.toMatch(/^WARN auth: /m);
    });

    // ── the reader itself, as tables ─────────────────────────────────────
    // [label, file bytes, [stdout, rc] at MAIN (two-argument, `_box_env_value f CCRC_AUTH`), [stdout, rc] in `unit` mode]
    // The `main` column was CAPTURED from a copy of `ccd/ccrc` at the merge base, in a scratch tree, before the
    // function was touched: it is what 45 callers must keep reading, byte for byte.
    const SHAPES: Array<[string, string, [string, number], [string, number]]> = [
      ['A1 trailing space', 'CCRC_AUTH=on \n', ['on ', 0], ['on', 0]],
      ['A1 trailing tab', 'CCRC_AUTH=on\t\n', ['on\t', 0], ['on', 0]],
      ['A1 leading space in value', 'CCRC_AUTH= on\n', [' on', 0], ['on', 0]],
      ['A1 leading tab and trailing space', '\tCCRC_AUTH=on \n', ['on ', 0], ['on', 0]],
      ['A1 indented key and tab', ' CCRC_AUTH=\ton\n', ['\ton', 0], ['on', 0]],
      ['A2 quoted inner space', 'CCRC_AUTH="on "\n', ['on ', 0], ['on ', 0]],
      ['E1 spaced key', 'CCRC_AUTH = off\n', ['', 1], ['', 2]],
      ['E2 continuation above', 'FOO=bar \\\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['E3 comment continuation above', '# c \\\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['E6 export', 'export CCRC_AUTH=on\n', ['', 1], ['', 2]],
      ['E6b export of another key', 'export CCRC_AUTH_SECRET_PATH=/x/y\nCCRC_AUTH=off\n', ['off', 0], ['off', 0]],
      ['E7 escaped quote', 'CCRC_AUTH="o\\"n"\n', ['o\\"n', 0], ['', 2]],
      ['E8 text after a closing quote', 'CCRC_AUTH="on"x\n', ['"on"x', 0], ['', 2]],
      ['E9 open double quote above', 'CCRC_ORIGIN="https://x\nCCRC_AUTH=on\nCCRC_RP_ID=x\n', ['on', 0], ['', 2]],
      ['E10 open single quote above', 'FOO=\'a\nCCRC_AUTH=on\n\'\n', ['on', 0], ['', 2]],
      ['E11 unquoted escape', 'CCRC_AUTH=o\\n\n', ['o\\n', 0], ['', 2]],
      ['E12 trailing unpaired quote', 'CCRC_AUTH=on"\n', ['on"', 0], ['', 2]],
      ['E13 readonly line', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', ['off', 0], ['off', 0]],
      ['E14 CR on another line', 'CCRC_AUTH=on\nCCRC_RP_ID=x\r\n', ['on', 0], ['on', 0]],
      ['CR after value', 'CCRC_AUTH=on\r\n', ['on', 0], ['on', 0]],
      // D-3831: after ONE trailing CR is stripped a CR still inside the line makes the file undecidable (`unit` mode).
      ['two CRs after value', 'CCRC_AUTH=v\r\r\n', ['v\r', 0], ['', 2]],
      ['one CR after value', 'CCRC_AUTH=v\r\n', ['v', 0], ['v', 0]],
      ['no trailing newline', 'CCRC_AUTH=on', ['on', 0], ['on', 0]],
      ['bare key', 'CCRC_AUTH=\n', ['', 0], ['', 0]],
      ['single-quoted', 'CCRC_AUTH=\'on\'\n', ['on', 0], ['on', 0]],
      ['double-quoted inner space', 'CCRC_AUTH="o n"\n', ['o n', 0], ['o n', 0]],
      ['longer key', 'CCRC_AUTHX=on\n', ['', 1], ['', 1]],
      ['last wins', 'CCRC_AUTH=off\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
      ['one-char quote value', 'CCRC_AUTH="\n', ['"', 0], ['', 2]],
      ['empty quote pair', 'CCRC_AUTH=""\n', ['', 0], ['', 0]],
      ['absent key', 'FOO=1\n', ['', 1], ['', 1]],
      // Wave 9 R10a (D-3831): a file systemd would split or skip whole. `main` is again captured from the merge-base
      // copy (two-argument reads are untouched); the `unit` column is rc 2 for a carriage return inside a line, a NUL
      // byte anywhere, and a byte >= 0x80 in a non-comment line — and the two controls, whose only non-ASCII is a COMMENT,
      // read as before. Every row is written byte for byte (latin1), so `\xff` is one invalid-UTF-8 byte.
      ['W CR mid-line, key after it', 'X=1\rCCRC_AUTH=off\r\n', ['', 1], ['', 2]],
      ['W CR mid-line in a comment', '# c\rCCRC_AUTH=off\r\n', ['', 1], ['', 2]],
      ['W NUL in another line', 'CCRC_RP_ID=x\0y\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W invalid UTF-8 in another value', 'CCRC_RP_ID=x\xff\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W invalid UTF-8 in the key line', 'CCRC_AUTH=\xff\n', ['\xff', 0], ['', 2]],
      ['W valid UTF-8 in a value (a cost, never a false answer)', 'CCRC_RP_ID=\xc3\xa9\nCCRC_AUTH=on\n', ['on', 0], ['', 2]],
      ['W control: a valid UTF-8 em dash in a comment', '# a \xe2\x80\x94 b\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
      ['W control: a non-ASCII comment after the key', 'CCRC_AUTH=on\n; \xe2\x80\x94\n', ['on', 0], ['on', 0]],
      // D-3831, fix round 2: the comment exemption is OFF for a whole file in which a non-comment line ends in a
      // backslash or carries a quote that is not one whole pair — systemd is then not in its key state on a later
      // "comment", it is inside a VALUE, and UTF-8-checks it. A quote that IS one whole pair changes nothing.
      ['W comment high byte inside a double-quoted value that spans lines', 'CCRC_AUTH=on\nX="a\n# \xff\n"\n', ['on', 0], ['', 2]],
      ['W comment high byte inside a single-quoted value that spans lines', 'CCRC_AUTH=on\nX=\'a\n# \xff\n\'\n', ['on', 0], ['', 2]],
      ['W comment high byte after an unquoted value ending in a backslash', 'CCRC_AUTH=on\nX=a\\\n# \xff\n', ['on', 0], ['', 2]],
      ['W comment high byte BEFORE a value that may span lines (the whole file, conservatively)', '# \xff\nCCRC_AUTH=on\nX="a\n"\n', ['on', 0], ['', 2]],
      ['W control: a quote that is one whole pair does not turn the exemption off', 'X="a"\n# \xff\nCCRC_AUTH=on\n', ['on', 0], ['on', 0]],
    ];
    /** `_box_env_value <file> CCRC_AUTH [mode]` over every shape: stdout and rc, read back through files. */
    const readShapes = (mode: string): Array<[string, number]> => {
      const dir = mkTmp('ccrc-doctor-shapes-');
      SHAPES.forEach(([, content], i) => writeFileSync(join(dir, `f${i}`), content, 'latin1'));
      const script = [
        'set -uo pipefail', `. ${shq(CCRC_SRC)}`,
        `for ((i=0;i<${SHAPES.length};i++)); do _box_env_value ${shq(dir)}/f$i CCRC_AUTH ${mode} > ${shq(dir)}/o$i; echo $? > ${shq(dir)}/c$i; done`,
      ].join('\n');
      const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: 'C' } });
      expect(r.status, r.stderr).toBe(0);
      return SHAPES.map((_, i): [string, number] =>
        [readFileSync(join(dir, `o${i}`), 'latin1'), Number(readFileSync(join(dir, `c${i}`), 'utf8').trim())]);
    };

    it('U1: plain mode (two arguments) reads every shape exactly as main did — stdout and rc, byte for byte, CR handling included', () => {
      const got = readShapes('');
      SHAPES.forEach(([label, , plain], i) => expect(got[i], label).toEqual(plain));
    });

    it('U2: `unit` mode — whitespace around an unquoted value goes, a quoted inner space stays, and every shape the reader cannot decide is rc 2 with nothing on stdout', () => {
      const got = readShapes('unit');
      SHAPES.forEach(([label, , , unit], i) => expect(got[i], label).toEqual(unit));
    });

    /** `[label, ccrc.env, exposure file, key, macOS answer, Linux answer]`. */
    type Dar = { rc: 3; file: 'env' | 'exp'; line: number; cause: 'cr' | 'shape' } | { rc: 0 | 2; val: string; src: '' | 'env' | 'exp' };
    type Lin = [number, string, '' | 'env' | 'exp'];
    const U3: Array<[string, string | null, string | null, string, Dar, Lin]> = [
      ['a CR after the value', 'CCRC_AUTH=on\r\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'cr' }, [0, 'on', 'env']],
      ['a second assignment on a later line', 'CCRC_AUTH=on\nFOO=1 CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['an unset behind an assignment', 'CCRC_AUTH=on\nFOO=a unset CCRC_AUTH\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['a semicolon command behind an assignment', 'CCRC_AUTH=on\nFOO=1;unset CCRC_AUTH\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['a command substitution on line 3', 'X=1\nCCRC_AUTH=on\nFOO=$(echo) CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 3, cause: 'shape' }, [0, 'on', 'env']],
      ['a space after the equals sign', 'CCRC_AUTH= on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['a declare word', 'declare CCRC_AUTH=off\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '', '']],
      ['a semicolon comment', '; c\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['a trailing comment on the assignment', 'CCRC_AUTH=on # c\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on # c', 'env']],
      ['a plus-equals assignment', 'CCRC_AUTH+=x\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '', '']],
      ['an indented assignment', '  CCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, 'on', 'env']],
      ['readonly in ccrc.env, the exposure file arms', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', 'CCRC_AUTH=on\n', 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'exp']],
      ['a CR in the exposure file only', 'CCRC_AUTH=on\n', 'X=1\r\n', 'CCRC_AUTH', { rc: 3, file: 'exp', line: 1, cause: 'cr' }, [0, 'on', 'env']],
      ['a planted canary after the key line', 'CCRC_AUTH=on\nFOO=canary-9f2 x\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, 'on', 'env']],
      ['every key: the readonly files read through CCRC_HOST', 'CCRC_AUTH=off\nreadonly CCRC_AUTH\n', 'CCRC_AUTH=on\n', 'CCRC_HOST', { rc: 3, file: 'env', line: 2, cause: 'shape' }, [0, '', '']],
      ['control: a trailing space', 'CCRC_AUTH=on \n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: a trailing tab', 'CCRC_AUTH=on\t\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: export', 'export CCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [3, '', '']],
      ['control: export of another name', 'export FOO=1\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      // Fix round 1, F2: `unit` mode's export arm is `export<ws>+KEY<ws>*=` (D-3823's "never a longer key that begins with
      // KEY") — an export of a LONGER key that ends in KEY, or of a value that spells `KEY=`, names another key.
      ['export of a longer key ending in the key', 'export OLD_CCRC_HOST=203.0.113.7\nCCRC_HOST=127.0.0.1\n', null, 'CCRC_HOST', { rc: 0, val: '127.0.0.1', src: 'env' }, [0, '127.0.0.1', 'env']],
      ['export of a value that spells the key', 'export NOTE=CCRC_AUTH=x\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['export of a longer key ending in the key, a space before =', 'export OLD_CCRC_HOST =203.0.113.7\nCCRC_HOST=127.0.0.1\n', null, 'CCRC_HOST', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [0, '127.0.0.1', 'env']],
      ['control: export with a space before =', 'export CCRC_AUTH =on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [3, '', '']],
      ['control: export of the key, tabs around it', 'export\t\tCCRC_AUTH\t=on\n', null, 'CCRC_AUTH', { rc: 3, file: 'env', line: 1, cause: 'shape' }, [3, '', '']],
      ['control: a comment', '# comment\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: a comment ending in a backslash', '# x \\\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [3, '', '']],
      ['control: single quotes', 'CCRC_AUTH=\'on\'\n', null, 'CCRC_AUTH', { rc: 0, val: 'on', src: 'env' }, [0, 'on', 'env']],
      ['control: double quotes with an inner space', 'CCRC_AUTH="o n"\n', null, 'CCRC_AUTH', { rc: 0, val: 'o n', src: 'env' }, [0, 'o n', 'env']],
      ['control: the exposure file wins by presence', 'CCRC_AUTH=off\n', 'CCRC_AUTH=on\n', 'CCRC_AUTH', { rc: 0, val: 'on', src: 'exp' }, [0, 'on', 'exp']],
      ['control: a bare key in the exposure file wins', 'CCRC_AUTH=on\n', 'CCRC_AUTH=\n', 'CCRC_AUTH', { rc: 0, val: '', src: 'exp' }, [0, '', 'exp']],
      ['control: an exposure file there and unreadable', 'CCRC_AUTH=on\n', 'UNREADABLE', 'CCRC_AUTH', { rc: 2, val: 'on', src: 'env' }, [2, 'on', 'env']],
    ];
    const u3Rows: UnitEnvRow[] = U3.map(([label, env, exp, key]) => ({ label, env, exp, key }));

    it('U3: the Darwin table through `_box_unit_env` — either file not plain assignments (or any CR) is rc 3 for EVERY key, naming the file and the line NUMBER, never its bytes; plain files answer what bash would', () => {
      const got = unitEnvAnswers(u3Rows, 'darwin');
      U3.forEach(([label, , , , dar], i) => {
        const a = got[i]!;
        const path = (w: 'env' | 'exp' | ''): string => (w === 'env' ? a.envPath : w === 'exp' ? a.expPath : '');
        expect(a.rc, label).toBe(dar.rc);
        if (dar.rc === 3) {
          expect([a.val, a.src], label).toEqual(['', '']);
          expect(a.why.startsWith(`${path(dar.file)} line ${dar.line} `), `${label}: ${a.why}`).toBe(true);
          expect(a.why, label).toContain(dar.cause === 'cr' ? 'carriage return' : 'is not a plain NAME=value line');
          expect(a.fix, label).toContain(path(dar.file));
          // The reason names a NUMBER, never a line: ccrc.env holds tokens.
          expect(a.why + a.fix, label).not.toContain('canary-9f2');
        } else {
          expect([a.val, a.src], label).toEqual([dar.val, path(dar.src)]);
          expect([a.why, a.fix], label).toEqual(['', '']);
        }
      });
    });

    // Fix round 1, F1 (D-3832): /bin/bash 3.2's `. file` stops at the first NUL byte in the FILE, so the launchd job sets
    // what comes before it and nothing after; `read` drops the NUL, so the plain test passed such a file and decided the
    // key (review 265: rc 0 `on`, a false ARMED). Every row here is rc 3 on BOTH feeders — on Linux by D-3831's whole-file
    // rule — and on Darwin the reason names the file and the cause, with no line number.
    /** `[label, ccrc.env, exposure file, key, the file the reason names]`. */
    const U4: Array<[string, string, string | null, string, 'env' | 'exp']> = [
      ['a NUL at the end of a line above the key', 'CCRC_AUTH=off\n', 'X=1\0\nCCRC_AUTH=on\n', 'CCRC_AUTH', 'exp'],
      ['a NUL inside the value', 'CCRC_AUTH=off\n', 'CCRC_AUTH=o\0n\n', 'CCRC_AUTH', 'exp'],
      ['a NUL in a comment above the key', 'CCRC_AUTH=off\n', '# c\0\nCCRC_AUTH=on\n', 'CCRC_AUTH', 'exp'],
      ['a NUL in ccrc.env, no exposure file', 'X=1\0\nCCRC_AUTH=on\n', null, 'CCRC_AUTH', 'env'],
      ['every key: CCRC_HOST through a NUL exposure file', 'CCRC_HOST=127.0.0.1\n', 'X=1\0\nCCRC_AUTH=on\n', 'CCRC_HOST', 'exp'],
    ];
    const u4Rows: UnitEnvRow[] = U4.map(([label, env, exp, key]) => ({ label, env, exp, key }));

    it('U4: a NUL byte anywhere in either file is rc 3 for every key on Darwin, naming the file and "a NUL byte", never a line or the bytes — and rc 3 on Linux too (D-3832; main and f74f5e90: Darwin rc 0 `on`)', () => {
      for (const os of ['darwin', 'linux'] as const) {
        const got = unitEnvAnswers(u4Rows, os);
        U4.forEach(([label, , , , which], i) => {
          const a = got[i]!;
          const file = which === 'env' ? a.envPath : a.expPath;
          expect([a.rc, a.val, a.src], `${os}: ${label}`).toEqual([3, '', '']);
          expect(a.why.startsWith(`${file} holds a NUL byte`), `${os}: ${label}: ${a.why}`).toBe(true);
          expect(a.fix, `${os}: ${label}`).toContain(`remove the NUL byte from ${file}`);
          if (os === 'darwin') expect(a.why, label).toContain('/bin/bash, which stops reading a file at its first NUL byte');
        });
      }
    });

    // Fix round 2 (D-3833, review 266 F1/F2): every row above runs under the harness's LC_ALL=C. Under a UTF-8 locale bash
    // `read`s CHARACTERS: an incomplete lead byte (0xC3) takes the NUL after it (the NUL is never seen) or the newline
    // after it (two lines read as one). The Darwin arm reads bytes whatever the caller's locale (D-3833); these rows run
    // both feeders under a UTF-8 one, proved in effect first.
    // Wave 11 (D-3979), three things. The F2 row is no longer Darwin-only: `unit` mode reads bytes too, since the Linux
    // arm of `_box_unit_env` pins `LC_ALL=C` below its Darwin dispatch, so a comment ending in a lone lead byte keeps
    // its newline on both feeders (it read ccrc.env's `on` where systemd hands the unit `off`, measured identical at
    // b40f4145, f74f5e90, 670d25fd and main), and L1 is the same merge inside ccrc.env, a false OFF. And G1 is the input
    // review 269 measured giving a false ARMED under the "relocated pin" mutant: the plain test's own line loop under
    // UTF-8 reads the comment and the `unset` line as one, so it passes a file that unsets the key (Darwin rc 3, line 2);
    // systemd ignores a line with no `=`, so Linux decides `on` from ccrc.env.
    /** What one feeder answers: today's NUL arm, the line the plain test refuses, or a decided value and where it came from. */
    type Want = { rc: 3; nul: true } | { rc: 3; line: number } | { rc: 0; val: string; src: 'env' | 'exp' };
    /** `[label, ccrc.env, exposure file or null, answers per feeder]`. A feeder a row does not list is not asserted for it
     *  (none today: every row states both). */
    const U4U: Array<[string, string, string | null, { darwin?: Want; linux?: Want }]> = [
      ['F1: a lead byte right before the NUL', 'CCRC_AUTH=off\n', '# caf\xc3\0\nCCRC_AUTH=on\n',
        { darwin: { rc: 3, nul: true }, linux: { rc: 3, nul: true } }],
      ['F1b: the NUL as the last byte, after a lead byte', 'CCRC_AUTH=off\n', 'CCRC_AUTH=on\n#\xc3\0',
        { darwin: { rc: 3, nul: true }, linux: { rc: 3, nul: true } }],
      ['F2: a comment ending in a lone lead byte keeps its newline', 'CCRC_AUTH=on\n', '# caf\xc3\nCCRC_AUTH=off\n',
        { darwin: { rc: 0, val: 'off', src: 'exp' }, linux: { rc: 0, val: 'off', src: 'exp' } }],
      ['L1: the same merge in ccrc.env, no exposure file', '# caf\xc3\nCCRC_AUTH=on\n', null,
        { darwin: { rc: 0, val: 'on', src: 'env' }, linux: { rc: 0, val: 'on', src: 'env' } }],
      ['G1: the plain test\'s own line loop (review 269 F1)', 'CCRC_AUTH=on\n', '# caf\xc3\nunset CCRC_AUTH\n',
        { darwin: { rc: 3, line: 2 }, linux: { rc: 0, val: 'on', src: 'env' } }],
    ];

    it('U4u: under a UTF-8 locale, a lead byte before a NUL still reads rc 3, and a comment ending in a lead byte does not swallow the next line on either feeder (D-3833, D-3979; main under UTF-8: Linux rc 0 `on` for F2 and rc 0 empty for L1)', () => {
      const loc = utf8Locale();
      // `expect.soft`: every row is measured, so a red run names each one that moved (F2 and L1 together), not the first.
      const rows: UnitEnvRow[] = U4U.map(([label, env, exp]) => ({ label, env, exp, key: 'CCRC_AUTH' }));
      for (const os of ['darwin', 'linux'] as const) {
        const got = unitEnvAnswers(rows, os, loc);
        U4U.forEach(([label, , , wants], i) => {
          const want = wants[os];
          if (want === undefined) return;
          const a = got[i]!;
          const tag = `${os} under LC_ALL=${loc}: ${label}`;
          if (want.rc === 3 && 'nul' in want) {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([3, '', '']);
            expect.soft(a.why.startsWith(`${a.expPath} holds a NUL byte`), `${tag}: ${a.why}`).toBe(true);
          } else if (want.rc === 3) {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([3, '', '']);
            expect.soft(a.why.startsWith(`${a.expPath} line ${want.line} is not a plain NAME=value line`), `${tag}: ${a.why}`).toBe(true);
          } else {
            expect.soft([a.rc, a.val, a.src], tag).toEqual([0, want.val, want.src === 'env' ? a.envPath : a.expPath]);
          }
        });
      }
    });

    // Wave 11 (D-3979): the placement of the Linux pin is pinned structurally, in whatever spelling. `local LC_ALL=C` must
    // sit BELOW the Darwin dispatch: above it, it would also cover `_box_unit_env_shell`, whose own `LC_ALL=C` (D-3833)
    // would stop being load-bearing, and T4-M31 (dropping that one) would no longer red U4u (measured). No `LC_ALL` token
    // at all may precede the dispatch, on its own line or on the first `local` line.
    it('U4p: `_box_unit_env` pins `local LC_ALL=C` below its Darwin dispatch and no `LC_ALL` above it, and `_box_unit_env_shell` keeps its own pin (D-3979; T4-M31)', () => {
      const src = readFileSync(CCRC_SRC, 'utf8');
      const m = /_box_unit_env\(\) \{([\s\S]*?)\n\}/.exec(src);
      expect(m, '_box_unit_env must be readable by /_box_unit_env\\(\\) \\{([\\s\\S]*?)\\n\\}/').not.toBeNull();
      const body = m![1]!;
      const d = body.indexOf('_box_unit_env_shell "$key"; return; fi');
      expect(d, 'the Darwin dispatch must be in _box_unit_env').toBeGreaterThan(-1);
      expect(/\bLC_ALL\b/.test(body.slice(0, d)), 'an LC_ALL token above the Darwin dispatch would cover _box_unit_env_shell too, so T4-M31 would stop reding (D-3979)').toBe(false);
      expect(/^  local LC_ALL=C$/m.test(body.slice(d)), 'the Linux arm must pin `local LC_ALL=C` below the dispatch (D-3979)').toBe(true);
      expect(/_box_unit_env_shell\(\) \{[^\n]*\n  local key="\$1" v rc bad="" LC_ALL=C\n/.test(src), '_box_unit_env_shell must keep its own LC_ALL=C (T4-M31, D-3833)').toBe(true);
    });

    it('U4n: `_box_env_has_nul` alone, called with NO caller pinning a locale, under a UTF-8 one — it reads bytes itself, so neither arm\'s answer leans on its caller (D-3833)', () => {
      const loc = utf8Locale();
      const dir = mkTmp('ccrc-doctor-hasnul-');
      /** `[label, bytes, rc]`: 0 = a NUL is there, 1 = none. */
      const files: Array<[string, string, number]> = [
        ['a lead byte right before the NUL', '# caf\xc3\0\nCCRC_AUTH=on\n', 0],
        ['the NUL as the last byte, after a lead byte', 'CCRC_AUTH=on\n#\xc3\0', 0],
        ['a three-byte lead pair before the NUL', '# \xe2\x80\0\n', 0],
        ['control: high bytes and no NUL', '# caf\xc3\nX=\xe2\x80\x94\n', 1],
      ];
      files.forEach(([, bytes], i) => writeFileSync(join(dir, `f${i}`), bytes, 'latin1'));
      const script = [
        `x=$'\\xc3\\xa9'; [ "\${#x}" -eq 1 ] || { echo "LC_ALL=${loc} did not take effect" >&2; exit 7; }`,
        `. ${shq(CCRC_SRC)}`,
        `for ((i=0;i<${files.length};i++)); do _box_env_has_nul ${shq(dir)}/f$i; echo $?; done`,
      ].join('\n');
      const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: join(dir, 'no-bin'), LC_ALL: loc } });
      expect(r.status, r.stderr).toBe(0);
      const rcs = r.stdout.trim().split('\n').map(Number);
      files.forEach(([label, , want], i) => expect(rcs[i], `LC_ALL=${loc}: ${label}`).toBe(want));
    });

    it('U3l: the same rows with CCD_OS=linux — `unit` mode\'s answers, the platform split stated as data: one set of bytes, two feeders', () => {
      const got = unitEnvAnswers(u3Rows, 'linux');
      U3.forEach(([label, , , , , lin], i) => {
        const a = got[i]!;
        const path = (w: '' | 'env' | 'exp'): string => (w === 'env' ? a.envPath : w === 'exp' ? a.expPath : '');
        expect([a.rc, a.val, a.src], label).toEqual([lin[0], lin[1], path(lin[2])]);
        if (lin[0] === 3) {
          expect(a.why, label).toContain('in a shape this reader does not decide');
          expect(a.why.startsWith(a.envPath), label).toBe(true);
          expect(a.fix, label).toContain(a.envPath);
        }
      });
    });

    // Wave 11 R14(j) (D-3980): the launchd job sources both env files with /bin/bash under `set -a`. Assigning one of the
    // names /bin/bash reserves ends that shell before its `exec` when POSIXLY_CORRECT has turned POSIX mode on (bash's
    // read-only variables, five of this set in bash 3.2 (BASHOPTS arrived in 4.1) and six in 5.2; in 3.2 also
    // BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME and GROUPS), so the
    // job never starts, whatever CCRC_AUTH says. The plain test refuses the fifteen as a NAME, in either file and in any
    // order, under its own cause: the reason names the line, never the variable (A1) and calls none of them read-only (A5).
    // D-3987 widens it to fifteen: HISTCMD and OPTIND are integer variables with no assign function, so a value that is an
    // arithmetic error ends the job's bash before its `exec` in every bash, with no POSIX mode (review of Task 2, F1).
    const U5_NAMES = ['POSIXLY_CORRECT', 'BASHOPTS', 'BASH_VERSINFO', 'EUID', 'PPID', 'SHELLOPTS', 'UID',
      'BASH_ARGC', 'BASH_ARGV', 'BASH_LINENO', 'BASH_SOURCE', 'FUNCNAME', 'GROUPS', 'HISTCMD', 'OPTIND'];
    /** Names that merely look like one of the fifteen (or are other reserved-looking names bash lets a file set). */
    const U5_CONTROLS = ['PATH=/usr/bin', 'HOME=/x', 'LC_ALL=C.UTF-8', 'BASH_COMPAT=0', 'BASH_XTRACEFD=0', 'MY_UID=0', 'MY_OPTIND=0', 'UIDX=0', 'uid=0', 'POSIXLY_CORRECTX=1'];
    const U5_ARITH: UnitEnvRow[] = [
      { label: 'OPTIND=1/0', env: 'OPTIND=1/0\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'HISTCMD=1/0', env: 'HISTCMD=1/0\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'OPTIND=09', env: 'OPTIND=09\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'export OPTIND="1/0"', env: 'export OPTIND="1/0"\nCCRC_AUTH=on\n', exp: null, key: 'CCRC_AUTH' },
      { label: 'exposure HISTCMD=1+', env: 'CCRC_AUTH=on\n', exp: 'CCRC_RP_ID=x\nHISTCMD=1+\n', key: 'CCRC_AUTH' },
    ];
    const U5_REVIEW: UnitEnvRow = { label: 'the review\'s input', env: 'POSIXLY_CORRECT=1\n', exp: 'UID=0\nCCRC_AUTH=on\n', key: 'CCRC_AUTH' };

    it('U5: on Darwin, each of the fifteen names /bin/bash reserves is rc 3 for the gate, naming the file and the line and never the variable; names that only look like one read as before (D-3980)', () => {
      const rows: UnitEnvRow[] = [
        ...U5_NAMES.map((n) => ({ label: n, env: `${n}=0\nCCRC_AUTH=on\n`, exp: null, key: 'CCRC_AUTH' })),
        U5_REVIEW,
        { label: 'order-free: the name below the key, in the exposure file', env: 'CCRC_AUTH=on\n', exp: 'CCRC_RP_ID=x\nGROUPS=0\n', key: 'CCRC_AUTH' },
        // The review's measured arithmetic-error inputs: every value here passes the plain test's value rule, so only the NAME refuses it.
        ...U5_ARITH,
        ...U5_CONTROLS.map((c) => ({ label: `control: ${c}`, env: `${c}\nCCRC_AUTH=on\n`, exp: null, key: 'CCRC_AUTH' })),
      ];
      const got = unitEnvAnswers(rows, 'darwin');
      const prefix = 'assigns a variable /bin/bash reserves';
      U5_NAMES.forEach((name, i) => {
        const a = got[i]!;
        expect.soft([a.rc, a.val, a.src], name).toEqual([3, '', '']);
        expect.soft(a.why.startsWith(`${a.envPath} line 1 ${prefix}`), `${name}: ${a.why}`).toBe(true);
        expect.soft(a.why, name).not.toContain(name);
        expect.soft(a.fix, name).not.toContain(name);
        expect.soft(a.fix, name).toContain(`line 1 of ${a.envPath}`);
        expect.soft(a.why + a.fix, name).not.toMatch(/read-only|readonly/i);
      });
      const n = U5_NAMES.length;
      const rev = got[n]!;
      expect.soft([rev.rc, rev.val, rev.src], 'the review\'s input').toEqual([3, '', '']);
      expect.soft(rev.why.startsWith(`${rev.envPath} line 1 ${prefix}`), rev.why).toBe(true);
      const ord = got[n + 1]!;
      expect.soft([ord.rc, ord.val, ord.src], 'order-free').toEqual([3, '', '']);
      expect.soft(ord.why.startsWith(`${ord.expPath} line 2 ${prefix}`), ord.why).toBe(true);
      expect.soft(ord.why + ord.fix, 'order-free').not.toContain('GROUPS');
      const arithLines = [1, 1, 1, 1, 2];
      U5_ARITH.forEach((row, i) => {
        const a = got[n + 2 + i]!;
        const file = row.exp === null ? a.envPath : a.expPath;
        expect.soft([a.rc, a.val, a.src], row.label).toEqual([3, '', '']);
        expect.soft(a.why.startsWith(`${file} line ${arithLines[i]} ${prefix}`), `${row.label}: ${a.why}`).toBe(true);
        expect.soft(a.why + a.fix, row.label).not.toMatch(/HISTCMD|OPTIND/);
      });
      U5_CONTROLS.forEach((c, i) => {
        const a = got[n + 2 + U5_ARITH.length + i]!;
        expect.soft([a.rc, a.val, a.src, a.why, a.fix], `control: ${c}`).toEqual([0, 'on', a.envPath, '', '']);
      });
    });

    it('U5l: the same input with CCD_OS=linux reads `on` from the exposure file — systemd sets both as plain environment, so the platform split is data (D-3980)', () => {
      const [a] = unitEnvAnswers([U5_REVIEW], 'linux');
      expect([a!.rc, a!.val, a!.src]).toEqual([0, 'on', a!.expPath]);
    });

    // macOS only: the end-to-end line. The coordinator reads it on `test-macos`.
    itDarwin('E20d: the review\'s input through `ccrc doctor` on macOS — one WARN auth, not measured, naming ccrc.env line 1, never a PASS ARMED (D-3980)', () => {
      const home = healthy('ccrc-doctor-auth-e20d-');
      writeCcrcEnv(home, `POSIXLY_CORRECT=1\n${readEnv(home)}`);
      writeFileSync(expPath(home), 'UID=0\nCCRC_AUTH=on\n');
      const r = runDoctor(home);
      expectOneUndecidedWarn(r.stdout, envPath(home));
      expect(authLine(r.stdout)).toContain(`${envPath(home)} line 1 `);
      // A1 at the doctor surface: the line is named by number, never the variable.
      expect(authLine(r.stdout)).not.toContain('POSIXLY_CORRECT');
      expect(r.stdout).not.toMatch(/^PASS auth: .*gated/m);
    });
  });
});
