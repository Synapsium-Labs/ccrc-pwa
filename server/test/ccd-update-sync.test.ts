// ccd-update-sync.test.ts — the fleet node's update-intent puller (design
// 2026-09-20 §9; programme wave 4 Task 10), run FOR REAL against fixture
// HOMEs: a stub `curl` answers the route, the real `ccd/ccd-update-sync`
// validates and installs, and the real reader — `ccrc channel`, the verb over
// `_upd_intent_state` — reads back what it installed.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s
// `/^ccd.*\.ts$/` containment scan, so EVERY bash spawn below builds its env
// through `ghContainedEnv(…, { systemd: true, tmux: true })` AT THE CALL SITE,
// inside the scan's twelve-line window (`SCAN_LOOKBACK_LINES`). A helper at
// the top of the file would be invisible to it — `ccd-pool-sync.test.ts`'s
// `run` measured that.
//
// The documents are built from spec §9's grammar here, never imported from
// W2's renderer: Task 15 feeds W2's real route through this same puller once
// W2 has merged (D-3235). `intentDoc` is this file's
// own, on the field names of Task 8's `intentDoc` in `ccrc-update.test.ts`
// but NOT a copy of it and never an import of it (importing a .test.ts
// registers its whole suite — `build-release.test.ts`'s stated reason): it
// reads a LIVE clock where Task 8's is frozen at `INTENT_NOW`, because the
// puller's clock bound is python's `time.time()`, which Task 8's `date`
// shim never reaches; and an override of `issued` must override `lease`
// with it (Task 8's derives `lease` from an overridden `issued`).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC = join(REPO, 'ccd', 'ccd-update-sync');
const CCRC = join(REPO, 'ccd', 'ccrc');
/** Lowercase, as `_inst_node_id` mints and W2's `NODE_ID_RE` keys rows. */
const NODE_ID = '0123abcd-0000-4000-8000-000000000001';
const TOKEN = 'tok-update-sync-fixture';
const DAY = 86_400;

interface IntentFields {
  epoch: string; issued: string; lease: string; channel: string;
  desired: string; desiredStable: string; desiredDev: string; auto: string;
}
interface Run { code: number; stdout: string; stderr: string }

const nowS = (): number => Math.floor(Date.now() / 1000);

/** Spec §9's nine lines, unix SECONDS, `end` last, exactly one trailing
 *  newline. A test that overrides `issued` overrides `lease` with it. */
const intentDoc = (o: Partial<IntentFields> = {}): string => {
  const issued = nowS();
  const f: IntentFields = {
    epoch: '7', issued: String(issued), lease: String(issued + 900), channel: 'stable',
    desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off', ...o,
  };
  return [
    `epoch ${f.epoch}`, `issued ${f.issued}`, `lease ${f.lease}`, `channel ${f.channel}`,
    `desired ${f.desired}`, `desired-stable ${f.desiredStable}`, `desired-dev ${f.desiredDev}`,
    `auto ${f.auto}`, 'end',
  ].join('\n') + '\n';
};

/** A fleet node as `ccrc install --role fleet` leaves one: agent.env (the
 *  server URL beside the agent bearer), the box token wrapped in a comment
 *  preamble, the node id — and a stub `curl` in `~/bin` that records its argv,
 *  its stdin AND its environment (so "never argv, never environ" is asserted
 *  as a negative, not inferred from the positive), then answers
 *  `fixture-body` + `\n` + `fixture-status` (default 200), or exits
 *  `fixture-curl-rc` having printed nothing. */
const box = (prefix: string, o: { url?: string; nodeId?: string | null } = {}): string => {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    `CCRC_AGENT_TOKEN=agent-bearer-fixture\nCCRC_SERVER_URL=${o.url ?? 'https://example.invalid'}\n`);
  mkdirSync(join(home, '.cc-secrets'), { recursive: true });
  writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), `# box token\n${TOKEN}\n`);
  if (o.nodeId !== null) writeFileSync(join(home, '.ccrc', 'node-id'), `${o.nodeId ?? NODE_ID}\n`);
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" > "$HOME/curl.argv"',
    'cat > "$HOME/curl.stdin"',
    'env > "$HOME/curl.env"',
    'if [ -f "$HOME/fixture-curl-rc" ]; then IFS= read -r rc < "$HOME/fixture-curl-rc"; exit "$rc"; fi',
    // D-3280 (fix round 1): the real script's body now lands via `-o
    // <file>`, never on stdout combined with the status — so the stub honors
    // that flag, the way a real `curl` would, rather than always writing the
    // body to its own stdout.
    'outfile=""; prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "-o" ]; then outfile="$a"; fi',
    '  prev="$a"',
    'done',
    'if [ -z "$outfile" ] || [ "$outfile" = "-" ]; then',
    '  cat "$HOME/fixture-body"',
    'else',
    '  cat "$HOME/fixture-body" > "$outfile"',
    'fi',
    'status=200; [ -f "$HOME/fixture-status" ] && IFS= read -r status < "$HOME/fixture-status"',
    'printf \'%s\' "$status"',
    '',
  ].join('\n'), { mode: 0o755 });
  return home;
};

const answer = (home: string, body: string, status = '200'): void => {
  writeFileSync(join(home, 'fixture-body'), body);
  writeFileSync(join(home, 'fixture-status'), `${status}\n`);
};

/** The REAL puller, under an explicit `umask 022` — so the 0600 it must
 *  produce can only come from its own `umask 077`, never the ambient one. */
const sync = (home: string, extra: NodeJS.ProcessEnv = {}): Run => {
  const env = ghContainedEnv(home, {
    ...process.env, CCRC_UPDATE_SYNC_TIMEOUT: undefined, ...extra,
    HOME: home, PATH: `${join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  }, { systemd: true, tmux: true });
  const r = spawnSync('bash', ['-c', 'umask 022; exec bash "$0"', SYNC], { encoding: 'utf8', env });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const dest = (home: string): string => join(home, '.ccrc', 'update-intent');
const residue = (home: string): string[] =>
  readdirSync(join(home, '.ccrc')).filter((n) => n.startsWith('.update-intent.'));

/** One good document installed first, so a refusal is measured as leaving
 *  THAT document byte for byte — "a stale document inside its lease is better
 *  than no document" (`ccd-pool-sync`'s header), not merely "wrote nothing". */
const primed = (prefix: string): { home: string; before: Buffer } => {
  const home = box(prefix);
  answer(home, intentDoc());
  const r = sync(home);
  expect(r.code, r.stderr).toBe(0);
  return { home, before: readFileSync(dest(home)) };
};

const refusesAndKeeps = (prefix: string, body: string, why: RegExp, status = '200'): void => {
  const { home, before } = primed(prefix);
  answer(home, body, status);
  const r = sync(home);
  expect(r.code, r.stderr).toBe(1);
  expect(r.stderr).toMatch(why);
  expect(readFileSync(dest(home)), 'a refused answer touched the installed projection').toEqual(before);
  expect(residue(home), 'a refused answer left a staged file behind').toEqual([]);
};

/** The REAL reader, on the configured fleet arm: `CCRC_ROLE=fleet` recorded
 *  and `ccd-update-sync.timer`'s unit FILE installed (zero bytes — the
 *  `ccdWsHelpers.ts:136-139` idiom; `_upd_intent_state` measures the file,
 *  never the projection's own absence). */
const readBack = (home: string): Run => {
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'ccd-update-sync.timer'), '');
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  const r = spawnSync('bash', [CCRC, 'channel'], { encoding: 'utf8', env });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('ccd-update-sync: one GET of the node\'s own route, installed by rename', () => {
  it('installs a 200\'s document byte for byte at 0600, and says nothing', () => {
    const home = box('upd-sync-ok-');
    const doc = intentDoc();
    answer(home, doc);
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(readFileSync(dest(home), 'utf8')).toBe(doc);
    expect(statSync(dest(home)).mode & 0o777, 'the projection is not 0600').toBe(0o600);
    expect(residue(home)).toEqual([]);
  });

  it('asks /api/updates/intent/<node-id>: ws:// becomes http://, the trailing slash goes, the timeout is the knob', () => {
    const home = box('upd-sync-url-', { url: 'ws://203.0.113.7:7788/' });
    answer(home, intentDoc());
    expect(sync(home, { CCRC_UPDATE_SYNC_TIMEOUT: '5' }).code).toBe(0);
    const argv = readFileSync(join(home, 'curl.argv'), 'utf8');
    expect(argv).toContain(`http://203.0.113.7:7788/api/updates/intent/${NODE_ID}`);
    expect(argv).not.toContain('//api');
    expect(argv).toContain('--max-time 5');
    expect(argv).toContain('-K -');
    // F2 (fix round 1, D-3280): curl's own bound, matching the reader's cap —
    // an oversized transfer never finishes downloading in the first place.
    expect(argv).toContain('--max-filesize 65536');
    const wss = box('upd-sync-wss-', { url: 'wss://example.invalid' });
    answer(wss, intentDoc());
    expect(sync(wss).code).toBe(0);
    expect(readFileSync(join(wss, 'curl.argv'), 'utf8'))
      .toContain(`https://example.invalid/api/updates/intent/${NODE_ID}`);
    expect(readFileSync(join(wss, 'curl.argv'), 'utf8')).toContain('--max-time 20');
  });

  it('hands the box token to curl on STDIN — never in argv, never in the environment', () => {
    const home = box('upd-sync-token-');
    answer(home, intentDoc());
    expect(sync(home).code).toBe(0);
    expect(readFileSync(join(home, 'curl.stdin'), 'utf8')).toBe(`header = "x-ccrc-mail-token: ${TOKEN}"\n`);
    expect(readFileSync(join(home, 'curl.argv'), 'utf8')).not.toContain(TOKEN);
    expect(readFileSync(join(home, 'curl.env'), 'utf8')).not.toContain(TOKEN);
  });
});

describe('ccd-update-sync: no node id, no request', () => {
  it('refuses with no ~/.ccrc/node-id — curl never runs and nothing is written', () => {
    const home = box('upd-sync-no-nid-', { nodeId: null });
    answer(home, intentDoc());
    const r = sync(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: no node id at ~/.ccrc/node-id — run ccrc install; nothing was synced');
    expect(existsSync(join(home, 'curl.argv')), 'a request went out with no node id').toBe(false);
    expect(existsSync(dest(home))).toBe(false);
  });

  it('refuses a node id that is not a LOWERCASE uuid — the spelling W2 keys its rows by', () => {
    const home = box('upd-sync-upper-nid-', { nodeId: NODE_ID.toUpperCase() });
    answer(home, intentDoc());
    const r = sync(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: ~/.ccrc/node-id is not a lowercase uuid — nothing was synced');
    expect(existsSync(join(home, 'curl.argv'))).toBe(false);
    expect(existsSync(dest(home))).toBe(false);
  });

  // F3 (fix round 1): the third node-id arm — present, but not a readable
  // REGULAR file. A directory is the cleanest way to make `-e` true and `-f`
  // false without touching filesystem permissions the harness's own user may
  // not be able to revoke.
  it('refuses a node id that exists but is not a readable regular file — curl never runs', () => {
    const home = box('upd-sync-nid-dir-', { nodeId: null });
    mkdirSync(join(home, '.ccrc', 'node-id'));
    answer(home, intentDoc());
    const r = sync(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: ~/.ccrc/node-id is not a readable file — nothing was synced');
    expect(existsSync(join(home, 'curl.argv')), 'a request went out with an unreadable node id').toBe(false);
    expect(existsSync(dest(home))).toBe(false);
  });
});

describe('ccd-update-sync: no usable box token, no request (F3, fix round 1)', () => {
  it.skipIf(process.getuid?.() === 0)('refuses when the token file exists but is not readable — curl never runs', () => {
    const home = box('upd-sync-token-unreadable-');
    const tokenPath = join(home, '.cc-secrets', 'ccrc-mail.token');
    chmodSync(tokenPath, 0o000);
    answer(home, intentDoc());
    let r: Run;
    try {
      r = sync(home);
    } finally {
      chmodSync(tokenPath, 0o600);
    }
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: no readable box token at $HOME/.cc-secrets/ccrc-mail.token');
    expect(existsSync(join(home, 'curl.argv')), 'a request went out with an unreadable token').toBe(false);
    expect(existsSync(dest(home))).toBe(false);
  });

  it('refuses when the token file has no value line — curl never runs', () => {
    const home = box('upd-sync-token-empty-');
    writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), '# just a comment\n\n');
    answer(home, intentDoc());
    const r = sync(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: the box token file has no value line');
    expect(existsSync(join(home, 'curl.argv')), 'a request went out with an empty token').toBe(false);
    expect(existsSync(dest(home))).toBe(false);
  });
});

describe('ccd-update-sync: a transport failure writes nothing', () => {
  it('a non-200 — even one carrying a well-formed document — leaves the installed projection as it was', () => {
    refusesAndKeeps('upd-sync-404-', intentDoc({ epoch: '8' }), /ccd-update-sync: unmeasured — HTTP 404/, '404');
  });

  it('names curl\'s own failures, and leaves the installed projection as it was', () => {
    const { home, before } = primed('upd-sync-curl-rc-');
    for (const [rc, why] of [
      ['7', /unmeasured — curl exited 7 \(could not connect\)/],
      ['28', /unmeasured — curl exited 28 \(timed out after 20s\)/],
      ['6', /unmeasured — curl exited 6 \(could not resolve host in https:\/\/example\.invalid\)/],
      // F2 (fix round 1, D-3280): curl's own `--max-filesize` overflow, rc
      // 63 — named with its own cap-naming sentence rather than the generic
      // `curl exited 63` fallback.
      ['63', /unmeasured — curl exited 63 \(response exceeded the 65536-byte cap\)/],
    ] as const) {
      writeFileSync(join(home, 'fixture-curl-rc'), `${rc}\n`);
      const r = sync(home);
      expect(r.code, rc).toBe(1);
      expect(r.stderr, rc).toMatch(why);
      expect(readFileSync(dest(home)), rc).toEqual(before);
    }
  });
});

describe('ccd-update-sync: no credential or absolute home path in a printed line (fix round 1 item 11 / review 155 C18)', () => {
  it('a CCRC_SERVER_URL carrying userinfo never reaches stderr on a curl failure (rc 6)', () => {
    const secret = 'hunter2';
    const home = box('upd-sync-redact-url-', { url: `http://alice:${secret}@nonexistent.invalid` });
    answer(home, intentDoc());
    writeFileSync(join(home, 'fixture-curl-rc'), '6\n');
    const r = sync(home);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).not.toContain(secret);
    expect(r.stderr).not.toContain('alice');
    expect(r.stderr).toMatch(/unmeasured — curl exited 6 \(could not resolve host in http:\/\/nonexistent\.invalid\)/);
    expect(existsSync(dest(home))).toBe(false);
  });

  it('agent.env is spelled ~/.ccrc/agent.env, never the absolute HOME path, on both refusals that name it', () => {
    // Unreadable: agent.env absent entirely.
    const missing = mkTmp('upd-sync-redact-home-missing-');
    mkdirSync(join(missing, 'bin'), { recursive: true });
    writeFileSync(join(missing, 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const envMissing = ghContainedEnv(missing,
      { ...process.env, HOME: missing, PATH: `${join(missing, 'bin')}:${process.env['PATH'] ?? ''}` },
      { systemd: true, tmux: true });
    const rMissing = spawnSync('bash', [SYNC], { encoding: 'utf8', env: envMissing });
    expect(rMissing.status).toBe(1);
    expect(rMissing.stderr).not.toContain(missing);
    expect(rMissing.stderr).toMatch(/cannot read ~\/\.ccrc\/agent\.env/);

    // Readable, but CCRC_SERVER_URL absent from it.
    const noUrl = mkTmp('upd-sync-redact-home-nourl-');
    mkdirSync(join(noUrl, '.ccrc'), { recursive: true });
    writeFileSync(join(noUrl, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=agent-bearer-fixture\n');
    mkdirSync(join(noUrl, 'bin'), { recursive: true });
    writeFileSync(join(noUrl, 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const envNoUrl = ghContainedEnv(noUrl,
      { ...process.env, HOME: noUrl, PATH: `${join(noUrl, 'bin')}:${process.env['PATH'] ?? ''}` },
      { systemd: true, tmux: true });
    const rNoUrl = spawnSync('bash', [SYNC], { encoding: 'utf8', env: envNoUrl });
    expect(rNoUrl.status).toBe(1);
    expect(rNoUrl.stderr).not.toContain(noUrl);
    expect(rNoUrl.stderr).toMatch(/CCRC_SERVER_URL is not set in ~\/\.ccrc\/agent\.env/);
  });

  // Review fix round 1, M2: the inline python's OWN exception text — the
  // validator's `except Exception`/`except OSError` arms, and the rename
  // one-liner's (previously bare) failure — used to reach stderr RAW, past
  // `say`. A `.ccrc` this puller cannot write into makes the staged write
  // fail with a real OSError, so this measures the actual python exception
  // text, redacted, never the fixture's absolute HOME.
  it('a write failure inside the python validator never prints the absolute HOME (fix round 1 review M2)', () => {
    const { home } = primed('upd-sync-redact-write-fail-');
    chmodSync(join(home, '.ccrc'), 0o555);
    try {
      answer(home, intentDoc({ epoch: '9' }));
      const r = sync(home);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr, r.stderr).not.toContain(home);
      // A measurement, not just an absence: the run DID fail, on a write
      // this HOME's own permissions refused.
      expect(r.stderr.length).toBeGreaterThan(0);
    } finally {
      chmodSync(join(home, '.ccrc'), 0o755);
    }
  });

  // NEW, Minor (batch C re-review of fix round 1, item 0). M2's own
  // mutation table measured only the VALIDATOR arm's redaction — reverting
  // the RENAME arm's `2>/dev/null` suppression (restoring the pre-M2 bare
  // `os.rename … "$tmp" "$DEST" \` line) left the full suite green, so a
  // future "cleanup" of that redirect would silently reopen the exact leak
  // M2 closed: a bare `os.rename`'s own OSError traceback names BOTH
  // absolute paths (`$tmp` AND `$DEST`, both under this HOME). This pins the
  // RENAME arm itself, the write-failure pin's own shape: a python3 stub
  // shadows ONLY the rename invocation (matched by its own literal `-c`
  // script — the validator call is real python3 straight through, so the
  // good document really does get staged at `$tmp` first), makes `.ccrc`
  // read-only AFTER that stage-write already landed, then runs the REAL
  // `os.rename` — a genuine PermissionError, a genuine traceback, not a
  // fabricated one.
  it('a rename failure never prints the absolute HOME either (batch C re-review item 0)', () => {
    const home = box('upd-sync-redact-rename-fail-');
    answer(home, intentDoc());
    const realPython3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
    expect(realPython3, 'no real python3 on PATH to shadow').not.toBe('');
    writeFileSync(join(home, 'bin', 'python3'), [
      '#!/usr/bin/env bash',
      'if [ "$1" = "-c" ] && [ "$2" = "import os, sys; os.rename(sys.argv[1], sys.argv[2])" ]; then',
      '  chmod 555 "$HOME/.ccrc"',
      `  "${realPython3}" "$@"`,
      '  rc=$?',
      '  chmod 755 "$HOME/.ccrc"',
      '  exit "$rc"',
      'fi',
      `exec "${realPython3}" "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    try {
      const r = sync(home);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr, r.stderr).not.toContain(home);
      expect(r.stderr).toMatch(/could not install the projection at ~\/\.ccrc\/update-intent/);
    } finally {
      chmodSync(join(home, '.ccrc'), 0o755);
    }
  });
});

describe('ccd-update-sync: the projection is whole-or-nothing (spec §18)', () => {
  // Pass 2 — the whole-document `DOC.fullmatch` and the byte cap — is the
  // ONLY check that counts lines or looks for `end`. Each of the first four
  // cases here passes pass 1 line by line and is refused by pass 2 alone.
  it('a document torn just before its `end` line is refused', () => {
    const torn = intentDoc().replace(/end\n$/, '');
    expect(torn.endsWith('auto off\n'), 'the fixture is not the torn shape').toBe(true);
    refusesAndKeeps('upd-sync-torn-', torn, /is not exactly nine lines, epoch through end/);
  });

  it('a document with no trailing newline is refused', () => {
    refusesAndKeeps('upd-sync-no-nl-', intentDoc().slice(0, -1), /is not exactly nine lines, epoch through end/);
  });

  it('a tenth line after `end` is refused', () => {
    refusesAndKeeps('upd-sync-tenth-', `${intentDoc()}extra\n`, /is not exactly nine lines, epoch through end/);
  });

  it('a document at or over 65536 bytes is refused even when every line is grammatical', () => {
    const big = intentDoc({ epoch: `1${'0'.repeat(70_000)}` });
    expect(Buffer.byteLength(big), 'the fixture is not over the cap').toBeGreaterThanOrEqual(65_536);
    refusesAndKeeps('upd-sync-cap-', big, /at or over the 65536-byte cap/);
  });

  // C4 (review 155, fix round 1 item 23): the exact boundary. Pass 0's
  // `len(raw) >= CAP` is the ONLY guard that fires at exactly 65536 bytes —
  // pass 1's per-line regex and pass 2's `DOC.fullmatch` do not count bytes
  // — so a document at exactly the cap must be refused BY THAT CHECK, and
  // one byte under must install cleanly. `desired-stable` is unbounded
  // digits by grammar (TAG's version numbers), so padding it (with
  // `channel dev`, so `desired` is checked against `desired-dev` instead —
  // `desired-stable` is then free to be any length) reaches an exact byte
  // count without breaking any OTHER check.
  it('a grammatical document of exactly 65536 bytes is refused at the byte cap, and one of 65535 bytes installs', () => {
    const docWithStableDigits = (n: number): string => intentDoc({
      channel: 'dev', desired: 'v0.0.12', desiredStable: `v0.0.${'1'.repeat(n)}`,
    });
    const d1 = docWithStableDigits(1);
    const d2 = docWithStableDigits(2);
    const perDigit = Buffer.byteLength(d2) - Buffer.byteLength(d1);
    expect(perDigit, 'one more digit must add exactly one byte').toBe(1);
    const digitsAtCap = 1 + (65_536 - Buffer.byteLength(d1));
    const atCap = docWithStableDigits(digitsAtCap);
    expect(Buffer.byteLength(atCap)).toBe(65_536);
    refusesAndKeeps('upd-sync-cap-exact-', atCap, /the document is 65536 bytes, at or over the 65536-byte cap/);

    const underCap = docWithStableDigits(digitsAtCap - 1);
    expect(Buffer.byteLength(underCap)).toBe(65_535);
    const home = box('upd-sync-cap-under-');
    answer(home, underCap);
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(dest(home), 'utf8')).toBe(underCap);
  });

  // Pass 1 — the per-line diagnostic. These two are refused by pass 2 as
  // well; what they pin is the diagnostic, which names the line.
  it('CRLF line endings are refused, and the diagnostic names the first line', () => {
    refusesAndKeeps('upd-sync-crlf-', intentDoc().replace(/\n/g, '\r\n'), /line 1 \(epoch\) is off-grammar: 'epoch 7\\r'/);
  });

  it('a value carrying an injected newline forges a line the positional grammar refuses', () => {
    refusesAndKeeps('upd-sync-inject-', intentDoc({ channel: 'stable\nchannel dev' }),
      /line 5 \(desired\) is off-grammar: 'channel dev'/);
  });
});

describe('ccd-update-sync: a NUL byte in the body is refused, never repaired (D-3280, fix round 1)', () => {
  // The measured defect: bash's `$( )` silently drops a NUL byte from a
  // captured command's stdout, so `ep\0och 8` arrived at the (old) validator
  // as `epoch 8` — a malformed answer REPAIRED and installed rather than
  // refused. The body now reaches the validator as bytes read straight from
  // a file curl wrote, so the NUL survives to be refused on its own terms.
  it('a NUL byte inside a line is refused, and the installed projection is unchanged', () => {
    const body = intentDoc({ epoch: '8' }).replace('epoch 8', 'ep\0och 8');
    refusesAndKeeps('upd-sync-nul-', body, /the document contains a NUL byte/);
  });
});

describe('ccd-update-sync: the validator reads at most the cap plus one byte (C20, fix round 1 item 14)', () => {
  // The fixture `curl` stub (`box`, above) does not enforce `--max-filesize`
  // at all — the same gap a curl older than 8.4.0 has for real on a chunked
  // body (this file's own header) — so a body far over the cap reaches the
  // validator whole on disk. What proves the READ itself is bounded, never
  // `f.read()` on the whole file, is that the refusal never names a SIZE
  // past the cap: a read bounded to `CAP + 1` cannot know the document's
  // true, much larger size, and (fix round 1 review, m2) saying so once
  // would be a false measurement, not a true one — so it says "more than",
  // never a specific count it cannot back up.
  it('a document far over the cap is refused by "more than" — never a specific size past the cap (fix round 1 review m2)', () => {
    const home = box('upd-sync-bounded-read-');
    const huge = `epoch 7\n${'x'.repeat(10 * 1024 * 1024)}`;   // 10 MiB+, no `end`
    answer(home, huge);
    const r = sync(home);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/the document is more than 65536 bytes, at or over the 65536-byte cap/);
    expect(r.stderr).not.toMatch(/65537/);         // the read's own ceiling, not a real size
    expect(r.stderr).not.toMatch(/10485\d{3}/);    // sanity: never the real ~10 MiB size
    expect(residue(home)).toEqual([]);
  });
});

describe('ccd-update-sync: the EXIT trap removes the staged file too (C19, fix round 1 item 13)', () => {
  it('a kill between the write and the rename leaves no staged file behind', () => {
    // Shadows the real python3 (this HOME's own `bin`, first on PATH — the
    // same directory `box` plants its `curl` stub in, and `sync`'s own env
    // build puts it ahead of everything else) for exactly ONE of the two
    // python3 invocations ccd-update-sync makes: the FINAL rename
    // (`os.rename(tmp, DEST)`, matched by its own literal `-c` script — the
    // validator call is a real python3 straight through, so the good
    // document really does get written to `$tmp` first). At that one call it
    // sends its OWN PARENT (the puller's single bash process — the outer
    // wrapper `exec`s into it, same pid throughout) a SIGTERM before any
    // rename runs: review 155 C19's exact window, python's write already
    // landed at `$tmp` and the rename that would move it to
    // `~/.ccrc/update-intent` never does. Measured directly (not assumed):
    // bash's EXIT trap DOES fire on an untrapped SIGTERM, unlike SIGKILL
    // (`ccd-ws-reap.test.ts`'s own note) — the child sleeps rather than
    // exiting on its own, so the parent is killed by the SIGNAL itself, not
    // by an ordinary nonzero exit this script's own `||` fallback would also
    // have cleaned up.
    const home = box('upd-sync-trap-kill-');
    answer(home, intentDoc());
    const realPython3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
    expect(realPython3, 'no real python3 on PATH to shadow').not.toBe('');
    writeFileSync(join(home, 'bin', 'python3'), [
      '#!/usr/bin/env bash',
      'if [ "$1" = "-c" ] && [ "$2" = "import os, sys; os.rename(sys.argv[1], sys.argv[2])" ]; then',
      '  kill -TERM "$PPID"',
      '  sleep 2',
      '  exit 0',
      'fi',
      `exec "${realPython3}" "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const r = sync(home);
    expect(r.code, 'a SIGTERMed process has no ordinary exit code').not.toBe(0);
    expect(existsSync(dest(home)), 'the rename never ran — the destination must be untouched').toBe(false);
    expect(residue(home), 'a kill between write and rename left a staged file behind').toEqual([]);
  });
});

describe('ccd-update-sync: seconds stay seconds (the C1 lesson — the pool-epoch route\'s own doc comment in server.ts)', () => {
  // A 13-digit value is GRAMMATICAL, and a seconds reader reads a millisecond
  // lease as ~56,700 years away: `ok`, never `stale`. The reader's own
  // lease-window check now refuses a ms-shaped lease (beside it) as a side
  // effect, but carries no digit-count check of its own, so the puller must.
  it('a millisecond `issued` is refused by its digit count', () => {
    const ms = String(Date.now());
    refusesAndKeeps('upd-sync-ms-issued-', intentDoc({ issued: ms, lease: ms }), /issued carries 13 digits/);
  });

  it('a millisecond `lease` is refused the same way', () => {
    refusesAndKeeps('upd-sync-ms-lease-', intentDoc({ lease: String(Date.now() + 900_000) }), /lease carries 13 digits/);
  });

  it('an `issued` more than a day ahead of this node\'s clock is refused — the direction that would read an ended lease as live', () => {
    const i = nowS() + 2 * DAY;
    refusesAndKeeps('upd-sync-future-', intentDoc({ issued: String(i), lease: String(i + 900) }),
      /issued \d+ is more than a day from this node clock/);
  });

  // C5 (review 155, fix round 1 item 23): only the FUTURE half of this bound
  // was ever pinned above. `abs(issued - now) > DAY` is symmetric in the
  // puller — nothing reds if the past direction is removed without this.
  it('an `issued` more than a day BEHIND this node\'s clock is refused too', () => {
    const i = nowS() - 2 * DAY;
    refusesAndKeeps('upd-sync-past-', intentDoc({ issued: String(i), lease: String(i + 900) }),
      /issued \d+ is more than a day from this node clock/);
  });

  it('a `lease` before its `issued`, or more than a day after it, is refused', () => {
    const i = nowS();
    refusesAndKeeps('upd-sync-lease-early-', intentDoc({ issued: String(i), lease: String(i - 1) }),
      /lease \d+ does not fall in the day after issued \d+/);
    refusesAndKeeps('upd-sync-lease-long-', intentDoc({ issued: String(i), lease: String(i + 2 * DAY) }),
      /lease \d+ does not fall in the day after issued \d+/);
  });

  it('`desired` must be the document\'s own channel\'s resolution (spec §9)', () => {
    refusesAndKeeps('upd-sync-desired-', intentDoc({ desired: 'v0.0.12' }),
      /desired v0\.0\.12 disagrees with desired-stable v0\.0\.11/);
  });
});

describe('ccd-update-sync: the epoch bound matches the reader\'s own (D-3279, fix round 1)', () => {
  // The measured defect: the reader (`_upd_intent_state`, plan D-3265)
  // refuses any epoch/issued/lease wider than 18 digits — its own bash
  // arithmetic wraps past 2^63-1 above that — but the puller's grammar left
  // `epoch` unbounded, so a wide `epoch` installed cleanly over a good
  // in-lease projection and the reader then refused every subsequent read as
  // `malformed`, with a remedy (re-run the puller) that reinstalled the same
  // unreadable document.
  it('a 19-digit epoch is refused, and the installed projection is unchanged', () => {
    refusesAndKeeps('upd-sync-epoch19-', intentDoc({ epoch: `1${'0'.repeat(18)}` }),
      /epoch carries 19 digits: the reader refuses anything wider than 18 digits \(D-3265\)/);
  });

  itLinux('an 18-digit epoch installs cleanly, and the reader never calls it malformed', () => {
    const home = box('upd-sync-epoch18-');
    answer(home, intentDoc({ epoch: `1${'0'.repeat(17)}` }));
    expect(sync(home).code).toBe(0);
    const r = readBack(home);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout.split('\n')[0]).toMatch(/^channel: state=ok /);
    expect(r.stdout).not.toContain('malformed');
  });
});

describe('ccd-update-sync: a directory at the destination', () => {
  it('refuses, leaves the directory, and removes its own staged file', () => {
    const home = box('upd-sync-dir-');
    mkdirSync(dest(home));
    answer(home, intentDoc());
    const r = sync(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccd-update-sync: a directory sits at ~/.ccrc/update-intent');
    expect(statSync(dest(home)).isDirectory()).toBe(true);
    expect(residue(home)).toEqual([]);
  });
});

describe('ccd-update-sync → the real reader (`ccrc channel`, Task 8)', () => {
  // LINUX-ONLY: `_upd_intent_state` answers `not-configured` on Darwin by
  // decision 17 before it reads any file, which is Task 8's pin, not this one.
  itLinux('an installed projection reads `ok`, carrying the document\'s own fields', () => {
    const home = box('upd-sync-read-ok-');
    answer(home, intentDoc());
    expect(sync(home).code).toBe(0);
    const r = readBack(home);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout.split('\n')[0])
      .toBe('channel: state=ok channel=stable desired=v0.0.11 desired-stable=v0.0.11 desired-dev=v0.0.12 auto=off');
  });

  itLinux('a `desired none` projection is installed and reads `none`', () => {
    const home = box('upd-sync-read-none-');
    answer(home, intentDoc({ desired: 'none', desiredStable: 'none' }));
    expect(sync(home).code).toBe(0);
    const r = readBack(home);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout.split('\n')[0]).toMatch(/^channel: state=none channel=stable desired=none desired-stable=none /);
  });

  itLinux('an ended lease is INSTALLED — the puller never judges freshness — and the reader answers `stale`', () => {
    const home = box('upd-sync-read-stale-');
    const i = nowS() - 1000;
    answer(home, intentDoc({ issued: String(i), lease: String(i + 900) }));
    expect(sync(home).code).toBe(0);
    const r = readBack(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^channel: state=stale /m);
  });
});
