// `ccrc quiz-record` (Overlord W1a, plan 2026-11-17-overlord-quiz-record.md §5 and Task 10): the operator's verb that
// records a replay quiz report. The verb is ccd/ccrc-quiz-record, reached by one dispatch line in ccd/ccrc.
//
// It posts THROUGH THE CLIENT (`ccrc-api quiz record --json -`, coordinator ruling `quiz-record-posts-through-the-client`),
// so this file STUBS that client: a fixture executable at the installed name under the fixture HOME, which records its
// argv and its stdin and prints a canned body. The row in the real client is that client's own tests' business, and
// nothing here reaches a network.
//
// Held here: it refuses inside a session and inside a pane before it reads anything; it refuses a missing, a
// non-regular and an oversize report and a sha that is not 64 hex; a good report is handed to the client once, as UTF-8
// JSON on stdin, with a trace; the client's three answers (recorded, already recorded, refused) and its two failures
// (no response, not JSON) each print their own line and exit; and the file names no curl, no credential file and no
// server address, keeps the portability rules and passes shellcheck. Fixture HOME only.
import { beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = path.join(REPO, 'ccd', 'ccrc');
const VERB = path.join(REPO, 'ccd', 'ccrc-quiz-record');
const SHA = 'ab12'.repeat(16);
const REPORT = 'Replay quiz \u2014 3 of 4 right.\nna\u00efve r\u00e9sum\u00e9 \u2713\n';
const PENDING = '{"ok":true,"id":7,"fresh":true,"state":"pending"}';

let home: string;

/** The client, stubbed: argv to `client-argv`, stdin to `client-stdin`, `http 200` on stderr like the real one, the
 *  canned body (`client-body`) on stdout and the canned exit (`client-rc`). */
function plantClient(body: string, rc = 0): void {
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'ccrc-api'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/client-argv"\ncat >> "$HOME/client-stdin"\n'
    + 'echo "http 200" >&2\ncat "$HOME/client-body"\nexit "$(cat "$HOME/client-rc")"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, 'client-body'), `${body}\n`);
  fs.writeFileSync(path.join(home, 'client-rc'), `${rc}\n`);
}
const clientCalls = (): string[] => {
  const p = path.join(home, 'client-argv');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const clientStdin = (): string => {
  const p = path.join(home, 'client-stdin');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

beforeEach(() => {
  home = mkTmp('quiz-record-');
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  plantClient(PENDING);
});

interface Out { code: number; stdout: string; stderr: string }

function run(args: string[], extra: Record<string, string | undefined> = {}): Promise<Out> {
  const env = ccrcContainedEnv(home, { ...process.env }, { managers: true, curl: 'poison' });
  // Explicit, never inherited: a developer's own pane or session must not decide these cases.
  delete env['CLAUDECODE']; delete env['TMUX_PANE'];
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return new Promise<Out>((resolve) => {
    const child = spawn('bash', [CCRC, 'quiz-record', ...args], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdin.end();
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const report = (text: string = REPORT): string => {
  const p = path.join(home, 'report.txt');
  fs.writeFileSync(p, text);
  return p;
};

describe('ccrc quiz-record: refusals before any read', () => {
  it('refuses in-session when CLAUDECODE is set: exit 2, the client never called', async () => {
    const r = await run(['--report', report(), '--sha', SHA], { CLAUDECODE: '1' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/in-session/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses in-session when CLAUDECODE is set but empty, as history\'s single-arm module reads it (review 2442 F9)', async () => {
    const r = await run(['--report', report(), '--sha', SHA], { CLAUDECODE: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/in-session/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses in-pane when TMUX_PANE is set: exit 2, the client never called', async () => {
    const r = await run(['--report', report(), '--sha', SHA], { TMUX_PANE: '%3' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/in-pane/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses before it reads the report: a missing file does not change the word', async () => {
    const r = await run(['--report', path.join(home, 'absent.txt'), '--sha', SHA], { CLAUDECODE: '1' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/in-session/);
  });
});

describe('ccrc quiz-record: the report file and the sha', () => {
  it('refuses a missing file', async () => {
    const r = await run(['--report', path.join(home, 'absent.txt'), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/quiz-record: .*absent\.txt/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses a directory', async () => {
    const r = await run(['--report', home, '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a regular file/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses a FIFO without opening it', async () => {
    const fifo = path.join(home, 'fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const r = await run(['--report', fifo, '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a regular file/);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses a file over 64 KiB and accepts one of exactly 64 KiB', async () => {
    const over = await run(['--report', report('x'.repeat(65537)), '--sha', SHA]);
    expect(over.code).toBe(1);
    expect(over.stderr).toMatch(/over 65536 bytes/);
    expect(clientCalls()).toEqual([]);
    const exact = await run(['--report', report('x'.repeat(65536)), '--sha', SHA]);
    expect(exact.code, exact.stderr).toBe(0);
    expect(clientCalls()).toHaveLength(1);
  });
  it('is a usage error (exit 2) without --report, without --sha, with an empty or a short or a non-hex --sha', async () => {
    expect((await run(['--sha', SHA])).code).toBe(2);
    expect((await run(['--report', report()])).code).toBe(2);
    expect((await run(['--report', report(), '--sha', ''])).code).toBe(2);
    expect((await run(['--report', report(), '--sha', 'abc123'])).code).toBe(2);
    expect((await run(['--report', report(), '--sha', 'z'.repeat(64)])).code).toBe(2);
    expect(clientCalls()).toEqual([]);
  });
  it('refuses when the client is not installed, naming it, and posts nothing', async () => {
    fs.rmSync(path.join(home, '.local', 'bin', 'ccrc-api'));
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no ccrc-api/);
  });
});

describe('ccrc quiz-record: the post and the answers', () => {
  it('hands the body to the client once, on stdin, as UTF-8 JSON with a trace, and prints the pending line', async () => {
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`recorded run 7, report sha ${SHA.slice(0, 12)}, pending: confirm it on the Shadow lanes card\n`);
    expect(clientCalls()).toEqual(['quiz record --json -']);
    const body = JSON.parse(clientStdin()) as { report: string; sha256: string; recordedBy: string };
    expect(body.report).toBe(REPORT);
    expect(body.sha256).toBe(SHA);
    expect(body.recordedBy).toMatch(/^quiz-record \S+ \S+ \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(body.recordedBy.split(' ')[2]).toBe('fleet');
    expect(Object.keys(body).sort()).toEqual(['recordedBy', 'report', 'sha256']);
  });
  it('records the role as unknown when the box records none', async () => {
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(clientStdin()) as { recordedBy: string }).recordedBy.split(' ')[2]).toBe('unknown');
  });
  it('prints the already-recorded line for fresh:false', async () => {
    plantClient('{"ok":true,"id":4,"fresh":false,"state":"confirmed"}');
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`already recorded as run 4, report sha ${SHA.slice(0, 12)} (confirmed)\n`);
  });
  it('prints a refusal as <word>: <detail> on stderr and exits 1', async () => {
    plantClient('{"ok":false,"error":"bad-request","detail":"sha256 does not match the report"}');
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('bad-request: sha256 does not match the report');
    expect(r.stdout).toBe('');
  });
  it('prints a 401 the same way', async () => {
    plantClient('{"ok":false,"error":"unauthenticated","detail":"box token required"}');
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unauthenticated: box token required');
  });
  it('says there was no answer when the client exits 3, and exits 1', async () => {
    plantClient('{"ok":false,"error":"transport","detail":"no response from the server (curl rc 7)"}', 3);
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no answer from the server \(ccrc-api exited 3\)/);
    expect(r.stdout).toBe('');
  });
  it('says the answer was not JSON, and exits 1', async () => {
    plantClient('<html>bad gateway</html>');
    const r = await run(['--report', report(), '--sha', SHA]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not JSON/);
    expect(r.stdout).toBe('');
  });
});

describe('ccrc quiz-record: the file itself', () => {
  const text = fs.readFileSync(VERB, 'utf8');
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  it('uses none of the non-portable spellings', () => {
    expect(code).not.toMatch(/stat -c/);
    expect(code).not.toMatch(/sha256sum/);
    expect(code).not.toMatch(/(^|[\s|;&(])timeout(\s|$)/m);
  });
  it('runs no curl and reads no credential file and no server address, in code or comment', () => {
    expect(text).not.toMatch(/curl/i);
    expect(text).not.toMatch(/\.cc-secrets|mail\.token|agent\.env|CCRC_SERVER_URL|https?:\/\//);
  });
  it('posts through the client, and says why', () => {
    expect(code).toContain('quiz record --json -');
    expect(text).toContain('quiz-record-posts-through-the-client');
  });
  it('is executable', () => {
    expect(fs.statSync(VERB).mode & 0o111).not.toBe(0);
  });
  const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;
  it.skipIf(!hasShellcheck)('passes shellcheck with zero findings', () => {
    const r = spawnSync('shellcheck', ['-x', VERB], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
