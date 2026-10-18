/**
 * The approval wait (plan Task 14, spec §6.3 hook steps 1 to 7; D-5297, D-5439, D-5440, D-5441): a dispatched child's
 * PermissionRequest hook asks the server for a ruling and prints one only when it verifies, and otherwise prints
 * nothing so the prompt stays with the operator. It ends its own wait at the request's window, on an escalation, on a
 * TERM, and when it sees for itself that the prompt was answered in the pane.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. The stubbed `ccrc-api` answers from a table under
 * `$HOME/stub` and records every call; a ruling is signed in the stub by a key pair generated in this test. The clock
 * is the hook's own, shortened by its test knobs (`CCRC_APPROVAL_TICK_S`, `CCRC_APPROVAL_POLL_TICKS`,
 * `CCRC_APPROVAL_CEILING_S`), and the windows are scaled down (a `waitS` of 1 stands for 60). The PermissionRequest
 * payloads are Task 13's captures (`fixtures/approvals/captures/2.1.302`), every key kept, only `transcript_path`
 * pointed into the fixture HOME. Never the live HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  APPROVAL_HOOK_STOP_STATES, APPROVAL_HOOK_WAIT_S, APPROVAL_HOOK_VERSIONS, APPROVAL_CWD_TRUSTED, approvalDigestBytes,
} from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const VERIFY = path.resolve(__dirname, '../../ccd/approval-verify.mjs');
const CAPTURES = path.resolve(__dirname, 'fixtures/approvals/captures');
const GUARD = path.resolve(__dirname, 'fixtures/approvals/guard-corpus.json');
const DIGEST_CORPUS = path.resolve(__dirname, 'fixtures/approvals/digest-corpus.json');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const UUID = '00000000-0000-4000-8000-0000000000aa';
const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';
const TOOLU = 'toolu_000000000000000000000001';

type Payload = Record<string, unknown> & { tool_input: Record<string, unknown> };
const capturedRequest = (file: string): Payload => {
  const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, '2.1.302', file), 'utf8')) as { events: Array<{ event: string; payload: Payload }> };
  const ev = doc.events.find((e) => e.event === 'PermissionRequest');
  if (ev === undefined) throw new Error(`no PermissionRequest in ${file}`);
  return ev.payload;
};
const MAIN = capturedRequest('permission-main.json');
const SUB = capturedRequest('permission-subagent.json');

const hookText = (): string => fs.readFileSync(HOOK, 'utf8');
const hookAssign = (name: string): string => {
  const m = hookText().match(new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)"|([^\\s#]*))`, 'm'));
  if (m === null) throw new Error(`${name} is not assigned in the hook`);
  return (m[1] ?? m[2] ?? m[3]) as string;
};

const ours = generateKeyPairSync('ed25519');
const theirs = generateKeyPairSync('ed25519');
const pem = (k: { export(o: object): string | Buffer }, type: 'spki' | 'pkcs8'): string => k.export({ type, format: 'pem' }).toString();

let home: string;
let stub: string;
let transcript: string;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The signer the stub runs: the record template under stub/record.json, its `@` words filled from the request. */
const SIGNER = `import fs from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { recordBytes } from ${JSON.stringify(VERIFY)};
const d = process.env.HOME + '/stub';
const req = JSON.parse(fs.readFileSync(d + '/request.body', 'utf8'));
const t = JSON.parse(fs.readFileSync(d + '/record.json', 'utf8'));
const flags = JSON.parse(fs.readFileSync(d + '/sign.json', 'utf8'));
const fill = (v) => v === '@row' ? Number(process.argv[2]) : v === '@digest' ? req.digest : v === '@nonce' ? req.nonce
  : v === '@agent' ? JSON.parse(req.canonical)[1] : v === '@later' ? Date.now() + 60000 : v === '@past' ? Date.now() - 1000 : v;
const record = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fill(v)]));
const signed = flags.sigOverDigest ? { ...record, digest: flags.sigOverDigest } : record;
const key = createPrivateKey(fs.readFileSync(d + '/key.pem', 'utf8'));
const sig = sign(null, Buffer.from(recordBytes(signed), 'utf8'), key).toString('base64');
const ruling = flags.nosig ? { record } : { record, sig };
process.stdout.write(JSON.stringify({ state: flags.state ?? 'allowed', ruling }));
`;

const STUB_API = `#!/usr/bin/env bash
d="$HOME/stub"
printf '%s\\n' "$*" >> "$d/calls"
case "$1 $2" in
  "approvals request")
    cat > "$d/request.body"
    [[ -f "$d/request.rc" ]] && { cat "$d/request.out" 2>/dev/null; exit "$(cat "$d/request.rc")"; }
    cat "$d/request.out"
    printf 'http %s\\n' "$(cat "$d/request.code")" >&2 ;;
  "approvals ruling")
    n=$(( $(cat "$d/ruling.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/ruling.n"
    for a in "$d"/append*; do
      [[ -d "$a" && ! -f "$a/done" ]] || continue
      (( n >= $(cat "$a/on") )) && { cat "$a/line" >> "$(cat "$a/to")"; : > "$a/done"; }
    done
    if [[ -f "$d/ruling.out" ]]; then cat "$d/ruling.out"; else node "$d/sign.mjs" "$3"; fi
    printf 'http %s\\n' "$(cat "$d/ruling.code" 2>/dev/null || echo 200)" >&2 ;;
esac
exit 0
`;

const put = (rel: string, text: string, mode = 0o644): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode });
};
const reg = (rel: string): string => path.join(home, '.cc-sessions', rel);

/** An assistant row holding a tool_use, and the user row that resolves it (Task 13's shapes). */
const assistantRow = (toolu: string, input: unknown): string => `${JSON.stringify({
  type: 'assistant', uuid: `as-${toolu}`, promptId: 'p1', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolu, name: 'Bash', input }] },
})}\n`;
const resultRow = (toolu: string): string => `${JSON.stringify({
  type: 'user', promptId: 'p1', sourceToolAssistantUUID: `as-${toolu}`, permissionDecision: { decision: 'accept', source: 'user_temporary' },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolu, is_error: false, content: 'ok' }] },
})}\n`;

beforeEach(() => {
  home = mkTmp('ccrc-aprwait-');
  stub = path.join(home, 'stub');
  put(`.cc-sessions/${ID}.generation`, GENERATION);
  put(`.cc-sessions/${ID}.child`, '7');
  put(`.cc-sessions/${ID}.uuid`, `${UUID}\n`);
  put('.cc-sessions/child-deny.settings.json', DENY_FILE);
  put(`.cc-sessions/${ID}.deny-settings`, sha(DENY_FILE));
  fs.copyFileSync(VERIFY, reg('approval-verify.mjs'));
  put('.ccrc/approval-signing.pub', pem(ours.publicKey, 'spki'));
  put('bin/tmux', `#!/bin/sh\necho "cc-${ID}"\n`, 0o755);
  put('.local/bin/ccrc-api', STUB_API, 0o755);
  put('stub/sign.mjs', SIGNER);
  put('stub/key.pem', pem(ours.privateKey, 'pkcs8'));
  put('stub/sign.json', '{}');
  put('stub/request.out', '{"id":41,"waitS":1}');
  put('stub/request.code', '201');
  put('stub/record.json', JSON.stringify({ v: 1, rowId: '@row', sessionId: ID, agentId: '@agent', digest: '@digest', nonce: '@nonce',
    class: 'ordinary', verdict: 'allow', reason: 'a cleanup inside your worktree', expiresAt: '@later' }));
  transcript = path.join(home, 'cfg', 'projects', '-rig-proj', 'main.jsonl');
  put(path.relative(home, transcript), '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CCRC_APPROVAL_TICK_S: '0.05', CCRC_APPROVAL_POLL_TICKS: '2', CCRC_APPROVAL_CEILING_S: '4',
});
const payloadFor = (p: Payload, over: Record<string, unknown> = {}): Payload => ({ ...p, transcript_path: transcript, ...over });
interface Run { stdout: string; ms: number; calls: string[]; body: Record<string, unknown> | null; rulings: number }
const readCalls = (): string[] => (fs.existsSync(path.join(stub, 'calls')) ? fs.readFileSync(path.join(stub, 'calls'), 'utf8').trim().split('\n') : []);
const fire = (p: Payload, env: NodeJS.ProcessEnv = ENV()): Run => {
  const t0 = Date.now();
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(p), encoding: 'utf8', env, timeout: 30_000 });
  const ms = Date.now() - t0;
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const calls = readCalls();
  const bodyFile = path.join(stub, 'request.body');
  return { stdout: r.stdout, ms, calls, body: fs.existsSync(bodyFile) ? JSON.parse(fs.readFileSync(bodyFile, 'utf8')) : null,
    rulings: calls.filter((c) => c.startsWith('approvals ruling ')).length };
};
type Decision = { hookSpecificOutput: { hookEventName: string; decision: { behavior: string; message?: string } & Record<string, unknown> } };
const decision = (r: Run): Decision | null => {
  if (r.stdout === '') return null;
  const lines = r.stdout.trim().split('\n');
  expect(lines, 'one envelope, never two').toHaveLength(1);
  return JSON.parse(lines[0] as string) as Decision;
};

describe('the shared constants\' bash copies', () => {
  it('APPROVAL_HOOK_WAIT_S and the stop states are shared/api.ts\'s, and the wait stays under the managed hook timeout', () => {
    expect(Number(hookAssign('APPROVAL_HOOK_WAIT_S'))).toBe(APPROVAL_HOOK_WAIT_S);
    expect(hookAssign('APPROVAL_HOOK_STOP_STATES').split(' ')).toEqual([...APPROVAL_HOOK_STOP_STATES]);
    const installer = fs.readFileSync(path.resolve(__dirname, '../../ccd/install-session-hooks.sh'), 'utf8');
    const timeout = Number(/^HOOK_TIMEOUT_S=(\d+)/m.exec(installer)?.[1]);
    expect(timeout).toBe(600);
    expect(APPROVAL_HOOK_WAIT_S).toBeLessThan(timeout);
  });
  it('APPROVAL_CWD_TRUSTED never admits a version APPROVAL_HOOK_VERSIONS leaves out; 2.1.299 is in neither', () => {
    for (const v of APPROVAL_CWD_TRUSTED) expect(APPROVAL_HOOK_VERSIONS).toContain(v);
    expect(APPROVAL_HOOK_VERSIONS).not.toContain('2.1.299');
    expect(APPROVAL_CWD_TRUSTED).not.toContain('2.1.299');
  });
});

describe('the digest: APPROVAL_DIGEST_JQ is held equal to approvalDigestBytes over digest-corpus.json', () => {
  const rows = (JSON.parse(fs.readFileSync(DIGEST_CORPUS, 'utf8')) as { rows: Array<{ name: string; inputText: string; canonical: string }> }).rows;
  it.each(rows.map((r) => [r.name, r] as const))('%s', (_n, row) => {
    const r = spawnSync('jq', ['-cSa', hookAssign('APPROVAL_DIGEST_JQ')], { input: row.inputText, encoding: 'utf8' });
    const sh = r.status === 0 ? r.stdout.trim() : 'none';
    const ts = approvalDigestBytes(JSON.parse(row.inputText) as Record<string, unknown>) ?? 'none';
    expect(sh, 'the jq program').toBe(row.canonical);
    expect(ts, 'approvalDigestBytes').toBe(row.canonical);
  });
});

describe('the digest, end to end: the request the real hook sends carries each corpus row\'s canonical array', () => {
  const rows = (JSON.parse(fs.readFileSync(DIGEST_CORPUS, 'utf8')) as { rows: Array<{ name: string; inputText: string; canonical: string }> }).rows;
  it('every row: the canonical string sent is the row\'s, and a "none" row sends nothing', () => {
    const wrong: string[] = [];
    for (const row of rows) {
      for (const f of ['calls', 'request.body']) fs.rmSync(path.join(stub, f), { force: true });
      put('stub/ruling.out', '{"state":"declined"}');
      // The row's input text, raw (so 1.0 reaches jq as written), with the PermissionRequest event name the hook routes on.
      const text = row.inputText.replace(/^\{/, '{"hook_event_name":"PermissionRequest",');
      const r = spawnSync('bash', [HOOK], { input: text, encoding: 'utf8', env: ENV(), timeout: 30_000 });
      expect(r.status).toBe(0);
      const bodyFile = path.join(stub, 'request.body');
      const sent = fs.existsSync(bodyFile) ? (JSON.parse(fs.readFileSync(bodyFile, 'utf8')) as { canonical: string; digest: string }) : null;
      if (row.canonical === 'none') { if (sent !== null) wrong.push(`${row.name}: sent ${sent.canonical}`); continue; }
      if (sent === null) { wrong.push(`${row.name}: nothing sent`); continue; }
      if (sent.canonical !== row.canonical) wrong.push(`${row.name}: sent ${sent.canonical}`);
      if (sent.digest !== sha(row.canonical)) wrong.push(`${row.name}: digest ${sent.digest}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('a verified ruling is printed, once, and nothing else is', () => {
  it('a signed ordinary allow for this session, agent, digest and nonce: exactly one allow decision, no updatedPermissions or updatedInput', () => {
    const r = fire(payloadFor(MAIN));
    const d = decision(r);
    expect(d).not.toBeNull();
    expect(d!.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(d!.hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
    expect(r.stdout).not.toContain('updatedPermissions');
    expect(r.stdout).not.toContain('updatedInput');
  });
  it('a subagent\'s request is ruled for its agent', () => {
    const d = decision(fire(payloadFor(SUB)));
    expect(d?.hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
  });
  it('a signed deny prints the deny with "denied by your coordinator: <reason>"', () => {
    put('stub/record.json', JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(stub, 'record.json'), 'utf8')), verdict: 'deny', class: 'escalate', reason: 'not that directory' }));
    put('stub/sign.json', '{"state":"denied"}');
    const d = decision(fire(payloadFor(MAIN)));
    expect(d?.hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'denied by your coordinator: not that directory' });
  });
  const tmpl = (): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(stub, 'record.json'), 'utf8'));
  const forged: Array<[string, () => void]> = [
    ['signed by another key', () => put('stub/key.pem', pem(theirs.privateKey, 'pkcs8'))],
    ['unsigned', () => put('stub/sign.json', '{"nosig":true}')],
    ['a good signature over another digest', () => put('stub/sign.json', JSON.stringify({ sigOverDigest: 'b'.repeat(64) }))],
    ['another nonce', () => put('stub/record.json', JSON.stringify({ ...tmpl(), nonce: 'f'.repeat(32) }))],
    ['another session', () => put('stub/record.json', JSON.stringify({ ...tmpl(), sessionId: 'project-a-still-cove' }))],
    ['expired', () => put('stub/record.json', JSON.stringify({ ...tmpl(), expiresAt: '@past' }))],
    ['an allow with class escalate', () => put('stub/record.json', JSON.stringify({ ...tmpl(), class: 'escalate' }))],
  ];
  it.each(forged)('a forged ruling (%s) prints nothing', (_n, arrange) => {
    arrange();
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings, 'it kept polling for a real ruling').toBeGreaterThan(1);
  });
});

describe('every other answer prints nothing, and the hook exits 0 within its bound', () => {
  it.each([['404'], ['409'], ['500']])('the request answered %s', (code) => {
    put('stub/request.out', '{"ok":false,"error":"x"}');
    put('stub/request.code', code);
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings, 'no wait after a refusal').toBe(0);
  });
  it('the request answered with a transport error (ccrc-api exits 3)', () => {
    put('stub/request.out', '{"ok":false,"error":"transport"}');
    put('stub/request.rc', '3');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings).toBe(0);
  });
  it('a 201 with no waitS waits for nothing', () => {
    put('stub/request.out', '{"id":41}');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings).toBe(0);
  });
  it('never a ruling: prints nothing and stops at the window', () => {
    put('stub/ruling.out', '{"state":"held"}');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings).toBeGreaterThan(1);
    expect(r.ms).toBeLessThan(3500);
  });
});

describe('the window (D-5441): the hook waits for the request\'s waitS, never past the ceiling', () => {
  it('a waitS of 1 under a ceiling of 4: it stops near 1 s, not at the ceiling', () => {
    put('stub/ruling.out', '{"state":"held"}');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.ms).toBeGreaterThanOrEqual(900);
    expect(r.ms).toBeLessThan(2800);
  });
  it('a waitS above the ceiling is bounded by the ceiling', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":100}');
    const r = fire(payloadFor(MAIN), { ...ENV(), CCRC_APPROVAL_CEILING_S: '1' });
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(2800);
  });
  it('the ceiling knob only shortens: a value above APPROVAL_HOOK_WAIT_S is ignored', () => {
    expect(hookText()).toMatch(/CCRC_APPROVAL_CEILING_S < ceil/);
  });
});

describe('an escalation ends the wait (D-5440)', () => {
  it.each(APPROVAL_HOOK_STOP_STATES.map((s) => [s]))('a %s row: the hook exits at once, prints nothing and polls no more', (state) => {
    put('stub/ruling.out', JSON.stringify({ state }));
    put('stub/request.out', '{"id":41,"waitS":3}');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings).toBe(1);
    expect(r.ms).toBeLessThan(1500);
  });
});

describe('the hook ends itself when the pane answered (D-5439)', () => {
  /** The stub appends `line` to `file` on its `on`-th ruling poll (one slot per `slot`). */
  const arm = (line: string, file = transcript, on = 2, slot = 'a'): void => {
    put(`stub/append-${slot}/on`, String(on));
    put(`stub/append-${slot}/line`, line);
    put(`stub/append-${slot}/to`, file);
  };
  /** The wait really ran: the armed row was appended (on its `on`-th poll) before the hook exited, so an early exit is
   *  the tie's, never a hook that did not wait at all. */
  const landed = (r: Run, slot = 'a'): void => {
    expect(fs.existsSync(path.join(stub, `append-${slot}`, 'done')), `the armed row ${slot} landed before the exit`).toBe(true);
    expect(r.rulings, 'it polled up to the armed row').toBeGreaterThanOrEqual(Number(fs.readFileSync(path.join(stub, `append-${slot}`, 'on'), 'utf8')));
  };
  it('main thread: the transcript gains the tool_result for this request: exit within one poll, nothing printed, no more polls', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":3}');
    fs.appendFileSync(transcript, assistantRow(TOOLU, MAIN.tool_input));
    arm(resultRow(TOOLU));
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings, 'it stopped right after the row landed').toBeLessThanOrEqual(3);
    expect(r.ms).toBeLessThan(1500);
    landed(r);
  });
  it('an earlier identical command already answered (a repeated `npm test`): the open one is tied, and its answer ends the wait', () => {
    // The record's tie takes the last matching tool_use "which has no tool_result yet": the earlier, resolved twin is
    // not a second candidate. A hook that counted it would call the tie ambiguous and run to its window.
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":3}');
    const earlier = 'toolu_000000000000000000000003';
    fs.appendFileSync(transcript, assistantRow(earlier, MAIN.tool_input) + resultRow(earlier) + assistantRow(TOOLU, MAIN.tool_input));
    arm(resultRow(TOOLU));
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.rulings, 'it stopped right after the row landed').toBeLessThanOrEqual(3);
    expect(r.ms).toBeLessThan(1500);
    landed(r);
  });
  it('a subagent: the watch reads <dir>/<session_id>/subagents/agent-<agent_id>.jsonl', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":3}');
    const sub = path.join(path.dirname(transcript), String(SUB['session_id']), 'subagents', `agent-${String(SUB['agent_id'])}.jsonl`);
    put(path.relative(home, sub), assistantRow(TOOLU, SUB.tool_input));
    fs.appendFileSync(transcript, assistantRow(TOOLU, SUB.tool_input));
    arm(resultRow(TOOLU), sub);
    const r = fire(payloadFor(SUB));
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1500);
    landed(r);
  });
  it('a row that lands after the hook started is still tied (re-scanned each tick)', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":3}');
    // A real transcript is never empty: earlier rows that match nothing are there when the hook starts, so its first
    // look finds no match and must look again on every poll rather than give the tie up (Task 13's Linux record).
    fs.appendFileSync(transcript, `${JSON.stringify({ type: 'user', promptId: 'p0', message: { role: 'user', content: 'start the task' } })}\n`
      + assistantRow('toolu_000000000000000000000009', { command: 'ls' }) + resultRow('toolu_000000000000000000000009'));
    arm(assistantRow(TOOLU, MAIN.tool_input), transcript, 1, 'a');
    arm(resultRow(TOOLU), transcript, 3, 'b');
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1500);
    landed(r, 'a');
    landed(r, 'b');
  });
  it('two concurrent requests with distinct commands: the other one\'s answer does not end this wait; its own does', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":1}');
    const other = 'toolu_000000000000000000000002';
    fs.appendFileSync(transcript, assistantRow(TOOLU, MAIN.tool_input) + assistantRow(other, { command: 'echo something else' }));
    arm(resultRow(other));
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.ms, 'it ran to its window').toBeGreaterThanOrEqual(900);
    fs.rmSync(path.join(stub, 'append-a'), { recursive: true }); fs.rmSync(path.join(stub, 'calls')); fs.rmSync(path.join(stub, 'ruling.n'));
    fs.writeFileSync(transcript, assistantRow(TOOLU, MAIN.tool_input) + assistantRow(other, { command: 'echo something else' }));
    put('stub/request.out', '{"id":41,"waitS":3}');
    arm(resultRow(TOOLU));
    expect(fire(payloadFor(MAIN)).ms, 'its own answer ends it').toBeLessThan(1500);
  });
  it('two concurrent requests with identical commands: no tie, so one answer ends neither wait early', () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":1}');
    const twin = 'toolu_000000000000000000000002';
    fs.appendFileSync(transcript, assistantRow(TOOLU, MAIN.tool_input) + assistantRow(twin, MAIN.tool_input));
    // The LAST open match is the one answered: a hook that tied itself to it anyway (the record's "last such entry",
    // without the ambiguity rule) would end early, and must not.
    arm(resultRow(twin));
    const r = fire(payloadFor(MAIN));
    expect(r.stdout).toBe('');
    expect(r.ms, 'it fell back to its window').toBeGreaterThanOrEqual(900);
  });
});

describe('a TERM ends the hook at once, exit 0, printing nothing', () => {
  it('SIGTERM during the wait', async () => {
    put('stub/ruling.out', '{"state":"held"}');
    put('stub/request.out', '{"id":41,"waitS":20}');
    const child = spawn('bash', [HOOK], { env: { ...ENV(), CCRC_APPROVAL_CEILING_S: '20' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    child.stdin.end(JSON.stringify(payloadFor(MAIN)));
    for (let i = 0; i < 200 && !readCalls().some((c) => c.startsWith('approvals ruling ')); i++) await new Promise((r) => setTimeout(r, 25));
    expect(readCalls().some((c) => c.startsWith('approvals ruling ')), 'it reached the wait').toBe(true);
    const t0 = Date.now();
    child.kill('SIGTERM');
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((res) => child.on('exit', (c, s) => res([c, s])));
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(out).toBe('');
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('it engages only where it can act, and asks for nothing otherwise', () => {
  const noRequest = (r: Run): void => {
    expect(r.stdout).toBe('');
    expect(r.calls, 'ccrc-api was never called').toEqual([]);
  };
  it('no .child: today\'s bytes, no request', () => {
    fs.rmSync(reg(`${ID}.child`));
    noRequest(fire(payloadFor(MAIN)));
  });
  it('approvals-disabled present: no request', () => {
    put('.cc-sessions/approvals-disabled', '');
    noRequest(fire(payloadFor(MAIN)));
  });
  it('no .deny-settings, or one naming another digest: no request', () => {
    fs.rmSync(reg(`${ID}.deny-settings`));
    noRequest(fire(payloadFor(MAIN)));
    put(`.cc-sessions/${ID}.deny-settings`, 'c'.repeat(64));
    noRequest(fire(payloadFor(MAIN)));
  });
  it('no pinned key: no request', () => {
    fs.rmSync(path.join(home, '.ccrc', 'approval-signing.pub'));
    noRequest(fire(payloadFor(MAIN)));
  });
  it('no approval-verify.mjs beside the hook: no request', () => {
    fs.rmSync(reg('approval-verify.mjs'));
    noRequest(fire(payloadFor(MAIN)));
  });
  it('node missing from PATH: no request', () => {
    // Every PATH directory that holds `node` is replaced by a shadow of itself without it.
    const dirs = (ENV()['PATH'] ?? '').split(':').filter((d) => d !== '');
    const shadowed = dirs.map((d, i) => {
      if (!fs.existsSync(path.join(d, 'node'))) return d;
      const s = path.join(home, `shadow${i}`);
      fs.mkdirSync(s, { recursive: true });
      for (const n of fs.readdirSync(d)) if (n !== 'node') { try { fs.symlinkSync(path.join(d, n), path.join(s, n)); } catch { /* skip */ } }
      return s;
    });
    const env = { ...ENV(), PATH: shadowed.join(':') };
    expect(spawnSync('bash', ['-c', 'command -v node'], { env }).status, 'the harness PATH really has no node').not.toBe(0);
    noRequest(fire(payloadFor(MAIN), env));
  });
  it('a forbidden command, iterating over the forbidden Bash rows of Task 12\'s corpus: no request', () => {
    const rows = (JSON.parse(fs.readFileSync(GUARD, 'utf8')) as Array<{ tool: string; input: Record<string, unknown>; class: string }>)
      .filter((r) => r.class === 'forbidden' && r.tool === 'Bash');
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) noRequest(fire(payloadFor(MAIN, { tool_input: row.input })));
  });
  it('AskUserQuestion delivered as PermissionRequest: today\'s questions envelope, no request', () => {
    const r = fire(payloadFor(MAIN, { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'which?', options: [] }] } }));
    noRequest(r);
    const hs = JSON.parse(fs.readFileSync(reg(`${ID}.hookstate.json`), 'utf8')) as { state: string; ask: unknown };
    expect(hs.state).toBe('waiting');
    expect(hs.ask).toEqual({ questions: [{ question: 'which?', options: [] }] });
  });
});

describe('the request carries the canonical array, and the digest is its sha256', () => {
  it('the body is the v1 request: session, uuid, canonical, digest, nonce', () => {
    const r = fire(payloadFor(MAIN));
    expect(r.body).not.toBeNull();
    const b = r.body as { v: number; sessionId: string; sessionUuid: string; canonical: string; digest: string; nonce: string };
    expect(Object.keys(b).sort()).toEqual(['canonical', 'digest', 'nonce', 'sessionId', 'sessionUuid', 'v']);
    expect(b.v).toBe(1);
    expect(b.sessionId).toBe(ID);
    expect(b.sessionUuid).toBe(UUID);
    expect(b.canonical).toBe(approvalDigestBytes(payloadFor(MAIN)));
    expect(b.digest).toBe(sha(b.canonical));
    expect(b.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(b.canonical)[3], 'the hook input\'s own cwd').toBe(MAIN['cwd']);
  });
  it('a canonical string over 64 KiB is sent truncated: no canonical field, the digest of the whole string, a nonce', () => {
    const big = payloadFor(MAIN, { tool_input: { ...MAIN.tool_input, command: `echo ${'a'.repeat(70_000)}` } });
    const r = fire(big);
    expect(r.body).not.toBeNull();
    const b = r.body as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(['digest', 'nonce', 'sessionId', 'sessionUuid', 'truncated', 'v']);
    expect(b['truncated']).toBe(true);
    const canon = approvalDigestBytes(big);
    expect(canon, 'the payload has a canonical string').not.toBeNull();
    expect((canon as string).length, 'over the cap').toBeGreaterThan(65_536);
    expect(b['digest']).toBe(sha(canon as string));
    expect(b['nonce']).toMatch(/^[0-9a-f]{32}$/);
  });
  it('a change of cwd alone changes the digest', () => {
    const a = fire(payloadFor(MAIN)).body as { digest: string };
    fs.rmSync(path.join(stub, 'calls'));
    const b = fire(payloadFor(MAIN, { cwd: '/rig/proj/sub' })).body as { digest: string };
    expect(b.digest).not.toBe(a.digest);
  });
  it('a fresh nonce per request', () => {
    const a = fire(payloadFor(MAIN)).body as { nonce: string };
    const b = fire(payloadFor(MAIN)).body as { nonce: string };
    expect(b.nonce).not.toBe(a.nonce);
  });
});

// D-5486: committed under fixtures/approvals/captures, not fixtures/delegation (whose census pins its own scenarios),
// and normalised past Task 13's footnote 8 so the corpus scan passes and no model prose lands.
describe('Task 13\'s captures, committed for this PR', () => {
  const versions = fs.readdirSync(CAPTURES).sort();
  it('one directory per captured version, each with the main and the subagent capture', () => {
    expect(versions).toEqual(['2.1.296', '2.1.299', '2.1.300', '2.1.301', '2.1.302']);
    for (const v of versions) expect(fs.readdirSync(path.join(CAPTURES, v)).sort()).toEqual(['permission-main.json', 'permission-subagent.json']);
  });
  it('no PermissionRequest carries tool_use_id, and every one carries the keys the hook reads', () => {
    for (const v of versions) for (const f of ['permission-main.json', 'permission-subagent.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, v, f), 'utf8')) as { events: Array<{ event: string; payload: Record<string, unknown> }> };
      const prs = doc.events.filter((e) => e.event === 'PermissionRequest');
      expect(prs.length, `${v}/${f}`).toBeGreaterThan(0);
      for (const e of prs) {
        expect(e.payload).not.toHaveProperty('tool_use_id');
        for (const k of ['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'tool_name', 'tool_input', 'permission_suggestions']) expect(e.payload, `${v}/${f} ${k}`).toHaveProperty(k);
      }
      if (f === 'permission-subagent.json') expect(prs.some((e) => typeof e.payload['agent_id'] === 'string')).toBe(true);
    }
  });
  it('every id is neutral, one tmp-root spelling, and no model prose', () => {
    for (const v of versions) for (const f of fs.readdirSync(path.join(CAPTURES, v))) {
      const text = fs.readFileSync(path.join(CAPTURES, v, f), 'utf8');
      for (const m of text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g) ?? []) expect(m, `${v}/${f}`).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
      for (const m of text.match(/(?<![0-9A-Za-z])a[0-9a-f]{16}(?![0-9a-f])/g) ?? []) expect(m, `${v}/${f}`).toMatch(/^a\d{16}$/);
      for (const m of text.match(/toolu_[A-Za-z0-9]+/g) ?? []) expect(m, `${v}/${f}`).toMatch(/^toolu_\d{24}$/);
      for (const m of text.match(/\/tmp\/claude-[^/"\s)]+/g) ?? []) expect(m, `${v}/${f}`).toBe('/tmp/claude-1000');
      const doc = JSON.parse(text) as { events: Array<{ payload: Record<string, unknown> }> };
      for (const e of doc.events) if ('last_assistant_message' in e.payload) expect(e.payload['last_assistant_message']).toMatch(/stubbed/);
    }
  });
  it('the corpus scan the delegation captures pass is clean here too', () => {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, 'delegation-rig/sanitize.mjs'), '--scan', CAPTURES], { encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).toMatch(/no residue/);
    expect(r.status).toBe(0);
  });
});
