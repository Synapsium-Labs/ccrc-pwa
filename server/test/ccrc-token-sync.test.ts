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
  FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_CLAIM_PATH, TOKEN_VALUE_RE,
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
 *  `umask 022` — so a 0600 file can only come from the verb's own `umask 077`. */
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
    expectRefusal(sync(home), 'code-used');
    expect(read(tokenFile(home))).toBe(`${PREAMBLE}${OLD}\n`);
    expect(existsSync(genFile(home))).toBe(false);
    expect(calls(home)).toBe(1);
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
    }
    const home = box('tok-sync-norc-');
    writeFileSync(join(home, 'fixture-claim-rc'), '7\n');
    expectRefusal(sync(home), 'claim-refused');
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
  });

  it('write-failed: a ~/.cc-secrets the verb cannot write refuses before the claim — nothing is claimed', () => {
    const home = box('tok-sync-ro-');
    chmodSync(join(home, '.cc-secrets'), 0o500);
    try {
      const r = sync(home);
      expectRefusal(r, 'write-failed');
      expect(calls(home)).toBe(0);
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

  it('the agent\'s frozen argv is the verb this file answers', () => {
    expect([...tokenSyncSpawnArgv()]).toEqual(['token', 'sync', '--from', assigned(verb(), 'FROM_WORD')]);
    expect(readFileSync(CCRC, 'utf8')).toMatch(/^\s+token\)\s+cmd_token "\$@" ;;$/m);
  });
});
