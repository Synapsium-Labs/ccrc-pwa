// ccrc-token-sync.test.ts — the fleet box's half of the box-token lifecycle
// (design 2026-10-07 §4.5, §10.1; plan Tasks B1-B2): `ccrc token sync --from
// agent` and `ccrc token probe`, run FOR REAL through `ccd/ccrc`'s dispatch
// under fixture HOMEs.
//
// Two curls. Most cases plant a RECORDING curl at `<home>/.local/bin/curl`
// (first on PATH; `ccrcContainedEnv` keeps a file already there) that keeps
// each call's argv, stdin and environment in `curl.<n>.*` and answers from
// `fixture-*` files: so "never argv, never environ" is asserted as a negative
// on what curl was really handed. One case runs the REAL curl behind the
// loopback front against an in-process listener, because only a real curl can
// prove the `-K -` data line arrives as the exact JSON body.
//
// Every value and code below is a FIXTURE built from pieces at run time, and so
// are the patterns that prove neither leaks (plan Global Constraints: tests that
// prove "never printed" build their search patterns from pieces).
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import {
  CLAIM_CODE_RE, NODE_FILES, TOKEN_SYNC_EXIT, TOKEN_SYNC_FROM, TOKEN_SYNC_STDERR_PREFIX, TOKEN_SYNC_SYNCED_RE,
  TOKEN_TRANSPORTS, tokenSyncSpawnArgv,
} from '../../shared/agent-protocol.js';
import {
  CLAIM_REFUSALS, FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_CLAIM_PATH, TOKEN_VALUE_RE,
} from '../../shared/box-token.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const VERB = join(REPO, 'ccd', 'ccrc-token-sync');

// ── fixtures, from pieces ──────────────────────────────────────────────────
const VALUE = ['c0ffee', '5eed'].join('').repeat(7).slice(0, 64);     // the NEW value the claim answers
const OLD = ['0d', 'd0'].join('').repeat(16);                         // the value the file held before
const CODE = ['Qx', 'Zk_', '-9'].join('').repeat(7).slice(0, 43);      // the one-time claim code
const GEN = ['0123', '4567', '89ab', 'cdef'].join('');
const NODE_ID = '0123abcd-0000-4000-8000-000000000001';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Everything that must never appear where a person, a log or a process listing can read it. */
const SECRETS = (): string[] => [VALUE, CODE, sha(VALUE), sha(CODE), sha(`${VALUE}\n`), sha(`${CODE}\n`)];
const PREAMBLE = '# ccrc box token — do not commit, do not print.\n#\n# read by coord/token.ts\'s extractToken\n\n';

interface Run { code: number; stdout: string; stderr: string }

/** The recording curl: one numbered set of files per call, the URL its last
 *  argument, the body written to `-o`'s file, the status printed for `-w`.
 *  The claim and the proof answer from separate fixtures. */
const RECORDING_CURL = [
  '#!/usr/bin/env bash',
  'n=0; [ -f "$HOME/curl.count" ] && IFS= read -r n < "$HOME/curl.count"',
  'n=$((n + 1)); printf \'%s\\n\' "$n" > "$HOME/curl.count"',
  'printf \'%s\\n\' "$@" > "$HOME/curl.$n.argv"',
  'cat > "$HOME/curl.$n.stdin"',
  'env > "$HOME/curl.$n.env"',
  'url="${!#}"; out=""; prev=""',
  'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done',
  'case "$url" in',
  `  *${TOKEN_CLAIM_PATH}) kind=claim ;;`,
  '  */api/ledger) kind=proof ;;',
  '  *) kind=other ;;',
  'esac',
  'if [ -f "$HOME/fixture-$kind-rc" ]; then IFS= read -r rc < "$HOME/fixture-$kind-rc"; exit "$rc"; fi',
  'body=""; [ -f "$HOME/fixture-$kind-body" ] && body="$(cat "$HOME/fixture-$kind-body")"',
  'if [ -n "$out" ] && [ "$out" != - ]; then printf \'%s\' "$body" > "$out"; else printf \'%s\' "$body"; fi',
  'status=000; [ -f "$HOME/fixture-$kind-status" ] && IFS= read -r status < "$HOME/fixture-$kind-status"',
  'printf \'%s\' "$status"',
  '',
].join('\n');

/** A fleet node as `ccrc install --role fleet` leaves one: agent.env, node-id,
 *  the token file wrapped in a comment preamble, and the recording curl. The
 *  claim answers VALUE/GEN and the proof answers 400 unless a case says not. */
function box(prefix: string, o: { url?: string; token?: string | null; secretsDir?: boolean } = {}): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    `CCRC_AGENT_TOKEN=agent-bearer-fixture\nCCRC_SERVER_URL=${o.url ?? 'https://example.invalid'}\n`);
  writeFileSync(join(home, '.ccrc', 'node-id'), `${NODE_ID}\n`);
  if (o.secretsDir !== false) {
    mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    if (o.token !== null) {
      writeFileSync(join(home, '.cc-secrets', 'ccrc-mail.token'), o.token ?? `${PREAMBLE}${OLD}\n`, { mode: 0o600 });
    }
  }
  writeFileSync(join(harnessBin(home), 'curl'), RECORDING_CURL, { mode: 0o755 });
  claimAnswers(home, 200, JSON.stringify({ ok: true, value: VALUE, generation: GEN }));
  proofAnswers(home, 400);
  return home;
}
const claimAnswers = (home: string, status: number, body: string): void => {
  writeFileSync(join(home, 'fixture-claim-status'), `${status}\n`);
  writeFileSync(join(home, 'fixture-claim-body'), body);
};
const proofAnswers = (home: string, status: number): void => {
  writeFileSync(join(home, 'fixture-proof-status'), `${status}\n`);
  writeFileSync(join(home, 'fixture-proof-body'), '{"ok":false,"error":"bad-request"}');
};

/** The real `ccd/ccrc`, as the agent's spawn reaches it, under an explicit
 *  `umask 022`. The 0600 modes of the files the verb leaves come from `mktemp` (which creates 0600 whatever the umask),
 *  so this run does NOT prove the verb's own `umask 077`; that guard is pinned by the static check in 'set +x first,
 *  umask 077' below (the verb's second statement). */
function runToken(home: string, args: string[], input: string, extra: NodeJS.ProcessEnv = {}): Run {
  const env = { ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }), ...extra };
  assertNoRealTool(env, home);
  const r = spawnSync('bash', ['-c', 'umask 022; exec bash "$0" "$@"', CCRC, 'token', ...args],
    { encoding: 'utf8', env, input });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const sync = (home: string, input = `${CODE}\n`, extra: NodeJS.ProcessEnv = {}): Run =>
  runToken(home, ['sync', '--from', 'agent'], input, extra);

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const tokenFile = (home: string): string => join(home, '.cc-secrets', 'ccrc-mail.token');
const genFile = (home: string): string => join(home, '.ccrc', NODE_FILES.tokenGeneration);
const reportOf = (home: string): Record<string, unknown> | null => {
  const t = read(join(home, '.ccrc', 'token-sync.json'));
  return t === '' ? null : JSON.parse(t) as Record<string, unknown>;
};
const calls = (home: string): number => Number(read(join(home, 'curl.count')).trim() || '0');
const callArgv = (home: string, n: number): string[] => read(join(home, `curl.${n}.argv`)).split('\n').filter(Boolean);
const callStdin = (home: string, n: number): string => read(join(home, `curl.${n}.stdin`));
const temps = (home: string): string[] => ['.cc-secrets', '.ccrc'].flatMap((d) =>
  existsSync(join(home, d)) ? readdirSync(join(home, d)).filter((n) => n.startsWith('.ccrc-token-sync.')) : []);

/** The agent's mapping (plan Task A2): exit code TOKEN_SYNC_EXIT[w] AND a first
 *  stderr line starting with the prefix, the word and a colon. */
function expectRefusal(r: Run, word: keyof typeof TOKEN_SYNC_EXIT): void {
  expect(r.code, r.stderr).toBe(TOKEN_SYNC_EXIT[word]);
  expect(r.stderr.split('\n')[0]!.startsWith(`${TOKEN_SYNC_STDERR_PREFIX}${word}:`), r.stderr).toBe(true);
  expect(r.stdout).toBe('');
}
/** No secret in any text a person or a process listing can read. */
function expectNoSecret(home: string, r: Run): void {
  const texts: Array<[string, string]> = [['stdout', r.stdout], ['stderr', r.stderr],
    ['token-sync.json', read(join(home, '.ccrc', 'token-sync.json'))]];
  // Every regular file the verb may have left in ~/.ccrc (the report, the generation record, a stray temp) is
  // readable by a doctor, a backup and a person: none may hold a secret.
  for (const name of existsSync(join(home, '.ccrc')) ? readdirSync(join(home, '.ccrc')) : []) {
    const f = join(home, '.ccrc', name);
    if (lstatSync(f).isFile()) texts.push([`~/.ccrc/${name}`, read(f)]);
  }
  for (let n = 1; n <= calls(home); n++) {
    texts.push([`curl.${n}.argv`, read(join(home, `curl.${n}.argv`))], [`curl.${n}.env`, read(join(home, `curl.${n}.env`))]);
  }
  for (const [where, text] of texts) {
    for (const s of SECRETS()) expect(text.includes(s), `a secret reached ${where}`).toBe(false);
  }
}

describe('ccrc token sync: the synced path (spec §4.5, Figure 4)', () => {
  it('claims, writes the file with its preamble kept, records the generation, proves it, reports, and prints exactly one line', () => {
    const home = box('tok-sync-ok-');
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} https\n`);
    expect(TOKEN_SYNC_SYNCED_RE.test(r.stdout.trimEnd())).toBe(true);
    // The token file: the preamble verbatim, then the one new value line, 0600 from birth.
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${VALUE}\n`);
    expect(statSync(tokenFile(home)).mode & 0o777).toBe(0o600);
    expect(read(genFile(home))).toBe(`${GEN}\n`);
    expect(statSync(genFile(home)).mode & 0o777).toBe(0o600);
    const rep = reportOf(home)!;
    expect(rep).toEqual({ v: 1, at: expect.any(Number), result: 'synced', generation: GEN, transport: 'https', proof: 'proved' });
    expect(statSync(join(home, '.ccrc', 'token-sync.json')).mode & 0o777).toBe(0o600);
    // Two calls: the claim, then the proof.
    expect(calls(home)).toBe(2);
    const claim = callArgv(home, 1);
    expect(claim.at(-1)).toBe(`https://example.invalid${TOKEN_CLAIM_PATH}`);
    expect(claim.join(' ')).toMatch(/-K - /);
    expect(claim.join(' ')).toMatch(/--max-filesize 4096 --max-time 15 /);
    expect(callStdin(home, 1)).toBe(`data = "{\\"code\\":\\"${CODE}\\",\\"nodeId\\":\\"${NODE_ID}\\"}"\n`);
    const proof = callArgv(home, 2);
    expect(proof.at(-1)).toBe('https://example.invalid/api/ledger');
    expect(proof.join(' ')).toMatch(/-K - /);
    expect(callStdin(home, 2)).toBe(`header = "x-ccrc-mail-token: ${VALUE}"\n`);
    expect(temps(home)).toEqual([]);
    expectNoSecret(home, r);
  });

  it('a ws:// address rotates over http:// and the report records transport http — never refused (R2)', () => {
    const home = box('tok-sync-ws-', { url: 'ws://example.invalid:7788/' });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} http\n`);
    expect(callArgv(home, 1).at(-1)).toBe(`http://example.invalid:7788${TOKEN_CLAIM_PATH}`);
    expect(reportOf(home)!['transport']).toBe('http');
  });

  it('a wss:// address becomes https://', () => {
    const home = box('tok-sync-wss-', { url: 'wss://example.invalid' });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`synced ${GEN} https\n`);
    expect(callArgv(home, 1).at(-1)).toBe(`https://example.invalid${TOKEN_CLAIM_PATH}`);
  });

  it('no token file before: the fixed comment line, then the value; an absent ~/.cc-secrets is made 0700', () => {
    const home = box('tok-sync-fresh-', { secretsDir: false });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(tokenFile(home))).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${VALUE}\n`);
    expect(statSync(join(home, '.cc-secrets')).mode & 0o777).toBe(0o700);
  });

  it('an existing ~/.cc-secrets keeps its mode, and its other files are untouched', () => {
    const home = box('tok-sync-keepmode-');
    chmodSync(join(home, '.cc-secrets'), 0o750);
    writeFileSync(join(home, '.cc-secrets', 'lane.secret'), 'operator lane secret\n', { mode: 0o600 });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(statSync(join(home, '.cc-secrets')).mode & 0o777).toBe(0o750);
    expect(read(join(home, '.cc-secrets', 'lane.secret'))).toBe('operator lane secret\n');
  });

  it('a token file of a bare value line keeps no preamble and gains none', () => {
    const home = box('tok-sync-bare-', { token: `${OLD}\n` });
    expect(sync(home).code).toBe(0);
    expect(read(tokenFile(home))).toBe(`${VALUE}\n`);
  });

  it('stale temps a killed run left in ~/.cc-secrets and ~/.ccrc are swept; nothing else is', () => {
    const home = box('tok-sync-sweep-');
    writeFileSync(join(home, '.cc-secrets', '.ccrc-token-sync.AAAAAA'), 'killed run\n', { mode: 0o600 });
    writeFileSync(join(home, '.ccrc', '.ccrc-token-sync.BBBBBB'), 'killed run\n', { mode: 0o600 });
    writeFileSync(join(home, '.cc-secrets', '.other-tool.tmp'), 'not ours\n', { mode: 0o600 });
    const r = sync(home);
    expect(r.code, r.stderr).toBe(0);
    expect(temps(home)).toEqual([]);
    expect(existsSync(join(home, '.cc-secrets', '.other-tool.tmp'))).toBe(true);
  });
});

describe('ccrc token sync: refusals — each word, its exit code, and what it leaves', () => {
  it('bad-code: a code of the wrong shape is refused before any network call, and reported', () => {
    for (const input of ['short\n', `${CODE}=\n`, `${CODE.slice(0, 42)}!\n`, '\n', '']) {
      const home = box('tok-sync-badcode-');
      const r = sync(home, input);
      expectRefusal(r, 'bad-code');
      expect(calls(home), JSON.stringify(input)).toBe(0);
      expect(reportOf(home)!['result']).toBe('bad-code');
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
      expectNoSecret(home, r);
    }
  });

  it('bad-code: a second line on stdin is refused — one line, then EOF', () => {
    const home = box('tok-sync-twolines-');
    expectRefusal(sync(home, `${CODE}\n${CODE}\n`), 'bad-code');
    expect(calls(home)).toBe(0);
  });

  it('stale-client: a ccrc-api that puts the token on its argv refuses the sync before the claim', () => {
    const home = box('tok-sync-stale-');
    writeFileSync(join(harnessBin(home), 'ccrc-api'),
      '#!/usr/bin/env bash\ncurl -sS -m 30 -X "$method" -H "x-ccrc-mail-token: $TOKEN" "$url"\n', { mode: 0o755 });
    const r = sync(home);
    expectRefusal(r, 'stale-client');
    expect(calls(home)).toBe(0);
    expect(reportOf(home)!['result']).toBe('stale-client');
    expectNoSecret(home, r);
  });

  it('stale-client passes: no client, the shipped wave-13 client, and a link to it', () => {
    for (const plant of ['none', 'copy', 'link'] as const) {
      const home = box(`tok-sync-client-${plant}-`);
      const dest = join(harnessBin(home), 'ccrc-api');
      if (plant === 'copy') writeFileSync(dest, readFileSync(join(REPO, 'ccd', 'ccrc-api')), { mode: 0o755 });
      if (plant === 'link') symlinkSync(join(REPO, 'ccd', 'ccrc-api'), dest);
      const r = sync(home);
      expect(r.code, `${plant}: ${r.stderr}`).toBe(0);
    }
  });

  it('code-used: a 410 code-used claim answer; the old file is byte-equal and no generation is recorded', () => {
    const home = box('tok-sync-used-');
    claimAnswers(home, 410, '{"ok":false,"error":"code-used"}');
    const r = sync(home);
    expectRefusal(r, 'code-used');
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
    expect(existsSync(genFile(home))).toBe(false);
    expect(calls(home)).toBe(1);
    expectNoSecret(home, r);
  });

  it('claim-refused: every other non-200 (410 code-expired, 403, 404, 429, 503) and a claim with no answer', () => {
    const cases: Array<[number, string]> = [[410, 'code-expired'], [403, 'wrong-node'], [404, 'no-claim'],
      [429, 'rate-limited'], [503, 'unavailable']];
    for (const [status, word] of cases) {
      const home = box(`tok-sync-refused-${status}-`);
      claimAnswers(home, status, JSON.stringify({ ok: false, error: word }));
      const r = sync(home);
      expectRefusal(r, 'claim-refused');
      expect(r.stderr).toContain(`answered ${status} ${word}`);
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
      expectNoSecret(home, r);
    }
    const home = box('tok-sync-norc-');
    writeFileSync(join(home, 'fixture-claim-rc'), '7\n');
    const norc = sync(home);
    expectRefusal(norc, 'claim-refused');
    expectNoSecret(home, norc);
  });

  it('claim-refused: a 200 whose answer is not exactly {ok, 64-hex value, 16-hex generation} writes nothing', () => {
    const bad = [
      { ok: true, value: VALUE.toUpperCase(), generation: GEN },
      { ok: true, value: VALUE.slice(1), generation: GEN },
      { ok: true, value: VALUE, generation: GEN.slice(1) },
      { ok: true, value: VALUE, generation: GEN, extra: 1 },
      { ok: 'true', value: VALUE, generation: GEN },
      { value: VALUE, generation: GEN },
    ];
    for (const body of [...bad.map((b) => JSON.stringify(b)), 'not json', '']) {
      const home = box('tok-sync-shape-');
      claimAnswers(home, 200, body);
      const r = sync(home);
      expectRefusal(r, 'claim-refused');
      expect(read(tokenFile(home)), body).toBe(`${PREAMBLE}${OLD}\n`);
      expect(existsSync(genFile(home))).toBe(false);
      expect(temps(home)).toEqual([]);
      // The refused answer carried a value (or a near-miss of one): none of it is echoed.
      expectNoSecret(home, r);
    }
  });

  it('write-failed: a token path that is not a regular file is left as it was, and nothing is renamed', () => {
    const home = box('tok-sync-notfile-', { token: null });
    const elsewhere = join(home, 'elsewhere.token');
    writeFileSync(elsewhere, `${OLD}\n`, { mode: 0o600 });
    symlinkSync(elsewhere, tokenFile(home));
    const r = sync(home);
    expectRefusal(r, 'write-failed');
    expect(lstatSync(tokenFile(home)).isSymbolicLink()).toBe(true);
    expect(read(elsewhere)).toBe(`${OLD}\n`);
    expect(existsSync(genFile(home))).toBe(false);
    expect(temps(home)).toEqual([]);
    expectNoSecret(home, r);
  });

  it('write-failed: the token file written but the generation record not — its own sentence, the new value kept, no secret printed', () => {
    const home = box('tok-sync-genfail-');
    mkdirSync(genFile(home));   // a directory where the record belongs: the rename refuses
    const r = sync(home);
    expectRefusal(r, 'write-failed');
    expect(r.stderr.split('\n')[0]).toContain('the token file was written, but ~/.ccrc/box-token-generation could not be');
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${VALUE}\n`);
    expect(calls(home)).toBe(1);
    expect(temps(home)).toEqual([]);
    expectNoSecret(home, r);
  });

  it('write-failed: a ~/.cc-secrets the verb cannot write refuses before the claim — nothing is claimed', () => {
    const home = box('tok-sync-ro-');
    chmodSync(join(home, '.cc-secrets'), 0o500);
    try {
      const r = sync(home);
      expectRefusal(r, 'write-failed');
      expect(calls(home)).toBe(0);
      expectNoSecret(home, r);
    } finally {
      chmodSync(join(home, '.cc-secrets'), 0o700);
    }
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
  });

  it('proof words: 401 is proof-failed, 501 and a timeout are proof-unmeasured — never folded together', () => {
    const home401 = box('tok-sync-p401-');
    proofAnswers(home401, 401);
    expectRefusal(sync(home401), 'proof-failed');
    expect(reportOf(home401)).toMatchObject({ result: 'proof-failed', generation: GEN, proof: 'proof-failed' });
    // The file already holds the new value: the server accepts it (spec §6).
    expect(read(tokenFile(home401))).toBe(`${PREAMBLE}${VALUE}\n`);

    const home501 = box('tok-sync-p501-');
    proofAnswers(home501, 501);
    expectRefusal(sync(home501), 'proof-unmeasured');
    expect(reportOf(home501)).toMatchObject({ result: 'proof-unmeasured', proof: 'proof-unmeasured' });

    const homeTo = box('tok-sync-ptimeout-');
    writeFileSync(join(homeTo, 'fixture-proof-rc'), '28\n');
    expectRefusal(sync(homeTo), 'proof-unmeasured');
  });

  it('no refusal path prints a secret, and every one leaves no temp', () => {
    const home = box('tok-sync-nosecret-');
    proofAnswers(home, 401);
    const r = sync(home);
    expectRefusal(r, 'proof-failed');
    expectNoSecret(home, r);
    expect(temps(home)).toEqual([]);
  });
});

describe('ccrc token sync: set +x first, umask 077, and the environment exits', () => {
  it('an inherited xtrace (SHELLOPTS=xtrace) prints neither the code nor the value — set +x is the first statement', () => {
    const home = box('tok-sync-xtrace-');
    const r = sync(home, `${CODE}\n`, { SHELLOPTS: 'xtrace' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr, 'xtrace reached the run at all').toMatch(/^\+/m);
    expectNoSecret(home, r);
    const lines = readFileSync(VERB, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
    expect(lines[0]).toMatch(/^set \+x\b/);
    expect(lines[1]).toBe('umask 077');
  });

  // Review of B1: an inherited allexport (an exported SHELLOPTS=allexport) turns every plain
  // assignment into an export, so `code` and `tok` reached curl's ENVIRONMENT. The option is cleared in the
  // same first statement as xtrace, before any assignment.
  it('an inherited allexport (SHELLOPTS=allexport) puts neither the code nor the value in curl\'s environment', () => {
    const home = box('tok-sync-allexport-');
    const r = sync(home, `${CODE}\n`, { SHELLOPTS: 'allexport' });
    expect(r.code, r.stderr).toBe(0);
    expect(calls(home)).toBe(2);
    // The hunt is not vacuous: the value really was sent, on stdin.
    expect(callStdin(home, 2)).toContain(VALUE);
    expectNoSecret(home, r);
    for (const n of [1, 2]) expect(read(join(home, `curl.${n}.env`)), `curl.${n}.env`).not.toMatch(/^(code|tok)=/m);
  });

  it('a code or tok already EXPORTED by the caller does not carry the secret into curl\'s environment either', () => {
    const home = box('tok-sync-preexport-');
    const r = sync(home, `${CODE}\n`, { code: 'inherited', tok: 'inherited' });
    expect(r.code, r.stderr).toBe(0);
    expectNoSecret(home, r);
    for (const n of [1, 2]) expect(read(join(home, `curl.${n}.env`)), `curl.${n}.env`).not.toMatch(/^(code|tok)=/m);
  });

  it('the first statement clears xtrace AND allexport', () => {
    const lines = readFileSync(VERB, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
    expect(lines[0]).toMatch(/^set \+x \+a\b/);
  });

  it('exit 1 with no report: no agent.env, no CCRC_SERVER_URL, a non-http address, no node id', () => {
    const plant: Array<[string, (h: string) => void]> = [
      ['no agent.env', (h) => { writeFileSync(join(h, '.ccrc', 'agent.env'), ''); chmodSync(join(h, '.ccrc', 'agent.env'), 0o000); }],
      ['no CCRC_SERVER_URL', (h) => writeFileSync(join(h, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=x\n')],
      ['an ftp address', (h) => writeFileSync(join(h, '.ccrc', 'agent.env'), 'CCRC_SERVER_URL=ftp://example.invalid\n')],
      ['no node id', (h) => writeFileSync(join(h, '.ccrc', 'node-id'), 'not-a-uuid\n')],
    ];
    for (const [what, f] of plant) {
      const home = box('tok-sync-env-');
      f(home);
      const r = sync(home);
      expect(r.code, `${what}: ${r.stderr}`).toBe(1);
      expect(calls(home), what).toBe(0);
      expect(reportOf(home), what).toBeNull();
    }
  });

  it('usage is exit 2: no subverb, an unknown subverb, no --from, a --from word other than agent', () => {
    for (const args of [[], ['nope'], ['sync'], ['sync', '--from'], ['sync', '--from', 'pwa'], ['sync', '--from', 'agent', 'x']]) {
      const home = box('tok-sync-usage-');
      const r = runToken(home, args, `${CODE}\n`);
      expect(r.code, args.join(' ')).toBe(2);
      expect(calls(home)).toBe(0);
    }
  });
});

describe('ccrc token sync: the real curl, against a listener on loopback', () => {
  it('the claim body arrives as exactly {"code","nodeId"} JSON, and the proof carries the new value as its header', async () => {
    const home = box('tok-sync-real-', { url: 'http://placeholder.invalid' });
    // The real curl behind the loopback front (containedTools.ts), not the recorder.
    rmRecorder(home);
    const seen: Array<{ method: string; url: string; type: string; token: string; body: string }> = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', type: String(req.headers['content-type'] ?? ''),
          token: String(req.headers['x-ccrc-mail-token'] ?? ''), body });
        if (req.url === TOKEN_CLAIM_PATH) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, value: VALUE, generation: GEN }));
        } else {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end('{"ok":false,"error":"bad-request"}');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      writeFileSync(join(home, '.ccrc', 'agent.env'), `CCRC_SERVER_URL=http://127.0.0.1:${port}\n`);
      writeFileSync(join(home, 'curl-allow-ports'), `${port}\n`);
      const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'loopback' });
      assertNoRealTool(env, home);
      // ASYNC: the listener is in this process, and a synchronous spawn would block its event loop.
      const r = await new Promise<Run>((resolve) => {
        const child = spawn('bash', [CCRC, 'token', 'sync', '--from', 'agent'], { env });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
        child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
        child.stdin.end(`${CODE}\n`);
        child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe(`synced ${GEN} http\n`);
      expect(read(join(home, 'curl-poison')), 'the loopback front refused a call').toBe('');
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${TOKEN_CLAIM_PATH}`, 'GET /api/ledger']);
      expect(seen[0]!.type).toBe('application/json');
      expect(JSON.parse(seen[0]!.body)).toEqual({ code: CODE, nodeId: NODE_ID });
      expect(seen[0]!.body).toBe(JSON.stringify({ code: CODE, nodeId: NODE_ID }));
      expect(seen[1]!.token).toBe(VALUE);
      expect(read(tokenFile(home))).toBe(`${PREAMBLE}${VALUE}\n`);
    } finally {
      await new Promise<void>((r) => { server.close(() => r()); });
    }
  });
});

/** The recorder is planted by `box`; the real-curl case wants the loopback front in its place. */
function rmRecorder(home: string): void {
  rmSync(join(harnessBin(home), 'curl'), { force: true });
}

describe('ccrc token sync: the shell spellings agree with L0 (plan Global Constraints, single definition)', () => {
  /** Read per case, never at collection: a missing file reds each case by name instead of the whole file. */
  const verb = (): string => readFileSync(VERB, 'utf8');
  /** The value of a top-level `NAME='…'` or `NAME="…"` assignment, which must appear exactly once. */
  const assigned = (text: string, name: string): string => {
    const all = [...text.matchAll(new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)")$`, 'gm'))];
    expect(all.length, `${name}= is assigned ${all.length} times in ccd/ccrc-token-sync`).toBe(1);
    return all[0]![1] ?? all[0]![2]!;
  };
  /** `_ts_exit`'s case table as word -> code. */
  const exitTable = (text: string): Record<string, number> => {
    const body = /^_ts_exit\(\) \{\n([\s\S]*?)\n\}$/m.exec(text);
    expect(body, 'ccd/ccrc-token-sync has no _ts_exit() { … }').not.toBeNull();
    return Object.fromEntries([...body![1]!.matchAll(/^\s+([a-z-]+)\) echo (\d+) ;;$/gm)].map((m) => [m[1]!, Number(m[2])]));
  };

  it('the exit table is TOKEN_SYNC_EXIT, both directions', () => {
    expect(exitTable(verb())).toEqual({ ...TOKEN_SYNC_EXIT });
  });

  it('CONTROL: the table reader sees a moved code and a missing word', () => {
    const src = verb();
    expect(exitTable(src.replace('code-used) echo 22 ;;', 'code-used) echo 27 ;;'))).not.toEqual({ ...TOKEN_SYNC_EXIT });
    expect(exitTable(src.replace(/^\s+stale-client\) echo 26 ;;\n/m, ''))).not.toEqual({ ...TOKEN_SYNC_EXIT });
  });

  it('the prefix, the three shapes, the claim path, the --from word, the comment line and the generation file', () => {
    const src = verb();
    expect(assigned(src, 'TS_PREFIX')).toBe(TOKEN_SYNC_STDERR_PREFIX);
    expect(assigned(src, 'CODE_RE')).toBe(CLAIM_CODE_RE.source);
    expect(assigned(src, 'GEN_RE')).toBe(GENERATION_ID_RE.source);
    expect(assigned(src, 'VALUE_RE')).toBe(TOKEN_VALUE_RE.source);
    expect(assigned(src, 'CLAIM_PATH')).toBe(TOKEN_CLAIM_PATH);
    expect(assigned(src, 'FROM_WORD')).toBe(TOKEN_SYNC_FROM);
    expect(assigned(src, 'FLEET_COMMENT')).toBe(FLEET_TOKEN_FILE_COMMENT);
    expect(assigned(src, 'GEN_FILE')).toBe(`$HOME/.ccrc/${NODE_FILES.tokenGeneration}`);
  });

  // Plan assembly (review): A1 says this scan holds the verb's synced line to TOKEN_SYNC_SYNCED_RE. One printf, and the
  // shell's own generation shape and transport words rebuild the L0 regex's source exactly.
  it('the one synced line is TOKEN_SYNC_SYNCED_RE, rebuilt from GEN_RE and the transport words', () => {
    const src = verb();
    const printfs = src.split('\n').filter((l) => /printf 'synced /.test(l));
    expect(printfs.map((l) => l.trim())).toEqual([`printf 'synced %s %s\\n' "$R_GEN" "$R_TRANSPORT"`]);
    const gen = assigned(src, 'GEN_RE').replace(/^\^/, '').replace(/\$$/, '');
    const words = [...new Set([...src.matchAll(/\bR_TRANSPORT=(\w+)/g)].map((m) => m[1]))].sort();
    expect(words).toEqual([...TOKEN_TRANSPORTS].sort());
    expect(`^synced (${gen}) (${[...TOKEN_TRANSPORTS].join('|')})$`).toBe(TOKEN_SYNC_SYNCED_RE.source);
  });

  it('the claim door\'s refusal word is spelled once, at file scope, and is a CLAIM_REFUSALS word', () => {
    const src = verb();
    const spelled = assigned(src, 'CLAIM_USED');
    expect([...CLAIM_REFUSALS]).toContain(spelled);
    expect(spelled).toBe('code-used');
    // Beyond that one assignment, the literal survives only as the verb's OWN word (the exit table's key and the
    // `_ts_refuse` call that names it); the comparison with the door's answer and the sentence use the variable.
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const stray = code.filter((l) => l.includes('code-used'))
      .filter((l) => !/^CLAIM_USED=/.test(l) && !/^\s+code-used\) echo 22 ;;$/.test(l) && !/^\s*&& _ts_refuse code-used "/.test(l));
    expect(stray).toEqual([]);
    expect(code.some((l) => l.includes('"$word" = "$CLAIM_USED"')), 'the door\'s answer is compared with $CLAIM_USED').toBe(true);
  });

  it('every stderr prefix is "$TS_PREFIX" — the sync prefix is spelled once, at file scope', () => {
    const code = verb().split('\n').filter((l) => !l.trimStart().startsWith('#'));
    const literal = code.filter((l) => l.includes(TOKEN_SYNC_STDERR_PREFIX) && !/^TS_PREFIX=/.test(l));
    expect(literal).toEqual([]);
    expect(code.filter((l) => l.includes('$TS_PREFIX')).length).toBeGreaterThanOrEqual(3);
  });

  it('every python3 runs isolated (-I): no cwd or user site on sys.path, no PYTHON* variable read', () => {
    const code = verb().split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(code.filter((l) => /\bpython3 -c\b/.test(l))).toEqual([]);
    expect(code.filter((l) => /\bpython3 -I -c\b/.test(l)).length).toBe(3);
    // And no spelling that takes another route to the interpreter (a bare `python3 "$x"`, `python3 -m`, `python3 -`).
    expect(code.filter((l) => /\bpython3 (?!-I -c\b)(?!>\/dev\/null)(?![a-z])/.test(l) && !/command -v python3/.test(l))).toEqual([]);
  });

  it('the agent\'s frozen argv is the verb this file answers', () => {
    expect([...tokenSyncSpawnArgv()]).toEqual(['token', 'sync', '--from', assigned(verb(), 'FROM_WORD')]);
    expect(readFileSync(CCRC, 'utf8')).toMatch(/^\s+token\)\s+cmd_token "\$@" ;;$/m);
  });
});

// ── F2: the fleet file's atomic, fsynced write is pinned by what the writer DOES ───────────────────────────────────
// The spec names this file as the pin for the temp-then-rename write, the file fsync and the directory fsync. A text
// scan of the verb cannot red when a call is removed from the python body, so this runs the verb's OWN writer body
// (`_TS_WRITE_PY`, extracted verbatim) under `python3 -I` through a recording wrapper that logs every `os.open`,
// builtin `open`, `os.fsync` and `os.rename`/`os.replace` the body makes, then judges the log: the destination is never
// opened for writing, the temp beside it is written and fsynced BEFORE the rename onto the destination, and the
// destination's own directory (not the cwd) is fsynced AFTER it. The wrapper replaces nothing in the body; `-I` is kept.
describe('ccrc token sync: the fleet file write is temp-then-rename, file-fsynced and directory-fsynced (F2, spec §4.5)', () => {
  const WRAPPER = [
    'import builtins, json, os, sys',
    'real_open, real_fsync, real_rename, real_replace = os.open, os.fsync, os.rename, os.replace',
    'bopen = builtins.open',
    'log, fds = [], {}',
    'logf, bodyf = sys.argv[1], sys.argv[2]',
    'with bopen(bodyf, "r") as f: body = f.read()',
    'sys.argv = ["-c"] + sys.argv[3:]',
    'def wr(flags): return bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_TRUNC | os.O_CREAT | os.O_APPEND))',
    'def o(p, flags, *a, **k):',
    '    fd = real_open(p, flags, *a, **k); fds[fd] = os.path.abspath(os.fspath(p))',
    '    log.append({"k": "open", "p": fds[fd], "w": wr(flags)}); return fd',
    'def bo(p, mode="r", *a, **k):',
    '    if isinstance(p, (str, bytes, os.PathLike)):',
    '        log.append({"k": "bopen", "p": os.path.abspath(os.fspath(p)), "w": any(c in mode for c in "wax+")})',
    '    return bopen(p, mode, *a, **k)',
    'def fs(fd):',
    '    log.append({"k": "fsync", "p": fds.get(fd if isinstance(fd, int) else fd.fileno(), "?")}); return real_fsync(fd)',
    'def rn(a, b, *x, **k):',
    '    log.append({"k": "rename", "a": os.path.abspath(os.fspath(a)), "b": os.path.abspath(os.fspath(b))}); return real_rename(a, b, *x, **k)',
    'def rp(a, b, *x, **k):',
    '    log.append({"k": "rename", "a": os.path.abspath(os.fspath(a)), "b": os.path.abspath(os.fspath(b))}); return real_replace(a, b, *x, **k)',
    'os.open, os.fsync, os.rename, os.replace, builtins.open = o, fs, rn, rp, bo',
    'try:',
    '    exec(compile(body, "<writer>", "exec"), {"__name__": "__main__"})',
    'finally:',
    '    with bopen(logf, "w") as f: json.dump(log, f)',
    '',
  ].join('\n');

  /** The writer body, exactly as the shell single-quotes it. */
  const writerBody = (): string => {
    const m = /^_TS_WRITE_PY='\n([\s\S]*?)\n'$/m.exec(readFileSync(VERB, 'utf8'));
    expect(m, 'ccd/ccrc-token-sync has no _TS_WRITE_PY=\'…\' block').not.toBeNull();
    return m![1]!;
  };

  interface WriterLog { k: string; p?: string; a?: string; b?: string; w?: boolean }
  /** Run a writer body on a fixture claim answer; return what it did and its verdict. */
  function runWriter(body: string): { events: WriterLog[]; dest: string; tmp: string; stdout: string; stderr: string } {
    const dir = mkTmp('tok-writer-');
    const secrets = join(dir, 'secrets'); const cwd = join(dir, 'cwd');
    mkdirSync(secrets, { mode: 0o700 }); mkdirSync(cwd);
    const dest = join(secrets, 'ccrc-mail.token'); const tmp = join(secrets, '.ccrc-token-sync.AAAAAA');
    writeFileSync(tmp, '', { mode: 0o600 });
    writeFileSync(join(dir, 'answer.json'), JSON.stringify({ ok: true, value: VALUE, generation: GEN }));
    writeFileSync(join(dir, 'wrapper.py'), WRAPPER); writeFileSync(join(dir, 'body.py'), body);
    // cwd is NOT the destination's directory, so a directory fsync aimed at the cwd is distinguishable.
    const r = spawnSync('python3', ['-I', join(dir, 'wrapper.py'), join(dir, 'log.json'), join(dir, 'body.py'),
      join(dir, 'answer.json'), dest, tmp, FLEET_TOKEN_FILE_COMMENT, TOKEN_VALUE_RE.source, GENERATION_ID_RE.source, '4096'],
    { encoding: 'utf8', cwd });
    const events = JSON.parse(readFileSync(join(dir, 'log.json'), 'utf8')) as WriterLog[];
    return { events, dest, tmp, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  /** Every way the log departs from: write+fsync the temp, rename it onto dest, fsync dest's directory. */
  function violations(w: { events: WriterLog[]; dest: string; tmp: string }): string[] {
    const { events: ev, dest, tmp } = w; const dir = path.dirname(dest); const bad: string[] = [];
    if (path.dirname(tmp) !== dir) bad.push('fixture: the temp is not beside the destination');
    if (ev.some((e) => (e.k === 'open' || e.k === 'bopen') && e.w && e.p === dest)) bad.push('the destination is opened for writing in place');
    const opened = ev.findIndex((e) => e.k === 'open' && e.w && e.p === tmp);
    if (opened < 0) bad.push('the temp beside the destination is never opened for writing');
    const renamed = ev.findIndex((e) => e.k === 'rename' && e.a === tmp && e.b === dest);
    if (renamed < 0) bad.push('the temp is never renamed onto the destination');
    const fileSynced = ev.findIndex((e) => e.k === 'fsync' && e.p === tmp);
    if (fileSynced < 0) bad.push('the temp file is never fsynced');
    else if (renamed >= 0 && fileSynced > renamed) bad.push('the temp file is fsynced only after the rename');
    const dirSynced = ev.findIndex((e) => e.k === 'fsync' && e.p === dir);
    if (dirSynced < 0) bad.push('the destination\'s directory is never fsynced');
    else if (renamed >= 0 && dirSynced < renamed) bad.push('the destination\'s directory is fsynced before the rename');
    return bad;
  }

  it('the real writer body: temp opened and fsynced, renamed onto the destination, then the destination\'s directory fsynced', () => {
    const w = runWriter(writerBody());
    expect(w.stdout, w.stderr).toBe(`ok ${GEN}\n`);
    expect(violations(w)).toEqual([]);
    expect(readFileSync(w.dest, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${VALUE}\n`);
    // The verb hands this very body to the isolated interpreter (so the body judged is the body that runs).
    expect(readFileSync(VERB, 'utf8')).toContain('python3 -I -c "$_TS_WRITE_PY" "$T_RESP" "$TOKEN_FILE" "$T_TOKEN"');
  });

  // CONTROL: the judge is not vacuous. Each row is a mutation of the real body that the review ran against the old pin
  // (which stayed green under all four); each must still run to a verdict and be refused for ITS OWN reason.
  const MUTATIONS: Array<[string, (b: string) => string, string]> = [
    ['m1 open the destination in place', (b) => b.replace('os.open(tmp, os.O_WRONLY | os.O_TRUNC)',
      'os.open(dest, os.O_WRONLY | os.O_TRUNC | os.O_CREAT, 0o600)'), 'the destination is opened for writing in place'],
    ['m2 delete the file fsync', (b) => b.replace(/^ +os\.fsync\(fd\)\n/m, ''), 'the temp file is never fsynced'],
    ['m3 delete the directory-fsync block', (b) => b.replace(/try:\n    dfd = [\s\S]*?\nexcept OSError:\n    pass\n/, ''),
      'the destination\'s directory is never fsynced'],
    ['m4 fsync the cwd, not the destination\'s directory', (b) => b.replace('os.open(os.path.dirname(dest), os.O_RDONLY)',
      'os.open(os.getcwd(), os.O_RDONLY)'), 'the destination\'s directory is never fsynced'],
  ];
  for (const [name, mutate, reason] of MUTATIONS) {
    it(`CONTROL: ${name} is refused`, () => {
      const body = writerBody(); const mutated = mutate(body);
      expect(mutated, `${name}: the mutation did not apply to the body`).not.toBe(body);
      expect(violations(runWriter(mutated))).toContain(reason);
    });
  }
  it('CONTROL: a rename that comes before the file fsync is refused', () => {
    const body = writerBody();
    const mutated = body.replace(/^ +os\.rename\(tmp, dest\)\n/m, '').replace(/^( +)os\.fsync\(fd\)\n/m, '$1os.rename(tmp, dest)\n$1os.fsync(fd)\n');
    expect(mutated).not.toBe(body);
    expect(violations(runWriter(mutated))).toContain('the temp file is fsynced only after the rename');
  });
});

describe('ccrc token probe --file <path> [--url <base>] (spec §10.3)', () => {
  /** A probe box: the recorder answers the proof call only. */
  const probeBox = (prefix: string, status: number): { home: string; file: string } => {
    const home = box(prefix);
    proofAnswers(home, status);
    const file = join(home, 'probe-me.token');
    writeFileSync(file, `${PREAMBLE}${VALUE}\n`, { mode: 0o600 });
    return { home, file };
  };
  const probe = (home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Run => runToken(home, ['probe', ...args], '', extra);

  for (const [status, word, rc] of [[400, 'accepted', 0], [401, 'refused', 0], [501, 'unmeasured', 1], [503, 'unmeasured', 1]] as const) {
    it(`${status}: prints exactly "probe: ${status} ${word}" and exits ${rc}`, () => {
      const { home, file } = probeBox(`tok-probe-${status}-`, status);
      const r = probe(home, ['--file', file]);
      expect(r.code, r.stderr).toBe(rc);
      expect(r.stdout).toBe(`probe: ${status} ${word}\n`);
      expect(calls(home)).toBe(1);
      expect(callArgv(home, 1).at(-1)).toBe('https://example.invalid/api/ledger');
      expect(callArgv(home, 1).join(' ')).toMatch(/-K - /);
      expect(callStdin(home, 1)).toBe(`header = "x-ccrc-mail-token: ${VALUE}"\n`);
      // A probe measures; it writes no report and leaves no temp.
      expect(reportOf(home)).toBeNull();
      expect(temps(home)).toEqual([]);
    });
  }

  it('no answer at all is "probe: 000 unmeasured", exit 1', () => {
    const { home, file } = probeBox('tok-probe-norc-', 400);
    writeFileSync(join(home, 'fixture-proof-rc'), '7\n');
    const r = probe(home, ['--file', file]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('probe: 000 unmeasured\n');
    expectNoSecret(home, r);
  });

  it('--url overrides agent.env, and a ws:// base is rewritten as the verb rewrites it', () => {
    const { home, file } = probeBox('tok-probe-url-', 401);
    const r = probe(home, ['--file', file, '--url', 'ws://127.0.0.1:7788/']);
    expect(r.stdout).toBe('probe: 401 refused\n');
    expect(callArgv(home, 1).at(-1)).toBe('http://127.0.0.1:7788/api/ledger');
  });

  it('never prints the value or its sha256 — not on stdout, stderr, curl\'s argv or its environment', () => {
    for (const status of [400, 401, 501]) {
      const { home, file } = probeBox(`tok-probe-secret-${status}-`, status);
      const r = probe(home, ['--file', file]);
      expectNoSecret(home, r);
      // And the hunt is not vacuous: the value really was sent, on stdin.
      expect(callStdin(home, 1)).toContain(VALUE);
    }
  });

  it('an inherited xtrace or allexport leaves the value out of stderr and out of curl\'s environment', () => {
    for (const opt of ['xtrace', 'allexport']) {
      const { home, file } = probeBox(`tok-probe-${opt}-`, 400);
      const r = probe(home, ['--file', file], { SHELLOPTS: opt });
      expect(r.code, r.stderr).toBe(0);
      if (opt === 'xtrace') expect(r.stderr, 'xtrace reached the run at all').toMatch(/^\+/m);
      expect(callStdin(home, 1)).toContain(VALUE);
      expectNoSecret(home, r);
      expect(read(join(home, 'curl.1.env')), opt).not.toMatch(/^(code|tok)=/m);
    }
  });

  it('a file with no value line, or that cannot be read, exits 1 with no call and prints nothing secret; a missing --file is usage, exit 2', () => {
    const { home, file } = probeBox('tok-probe-empty-', 400);
    writeFileSync(file, '# only a comment\n\n');
    let r = probe(home, ['--file', file]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expectNoSecret(home, r);
    r = probe(home, ['--file', join(home, 'absent.token')]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expectNoSecret(home, r);
    expect(calls(home)).toBe(0);
    expect(probe(home, []).code).toBe(2);
    expect(probe(home, ['--file']).code).toBe(2);
    expect(probe(home, ['--file', file, '--url']).code).toBe(2);
    expect(probe(home, ['--file', file, 'extra']).code).toBe(2);
    expect(calls(home)).toBe(0);
  });

  it('no base: --url absent and no CCRC_SERVER_URL is exit 1 with no call; a non-http --url is exit 1', () => {
    const { home, file } = probeBox('tok-probe-nobase-', 400);
    writeFileSync(join(home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=x\n');
    let r = probe(home, ['--file', file]);
    expect(r.code).toBe(1);
    r = probe(home, ['--file', file, '--url', 'ftp://example.invalid']);
    expect(r.code).toBe(1);
    expect(calls(home)).toBe(0);
  });

  it('the usage names probe, and the help text of ccrc token lists it', () => {
    const { home } = probeBox('tok-probe-usage-', 400);
    const r = runToken(home, ['--help'], '');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ccrc token probe --file <path> [--url <base>]');
  });
});
