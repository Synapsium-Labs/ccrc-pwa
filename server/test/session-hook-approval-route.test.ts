/**
 * The approval envelope's route word (approvals plan 2026-11-18, §3.1 and Task 1.2): every PermissionRequest the hook
 * writes as an approval envelope carries `ask.approval.route`, the first pre-send gate that stopped the prompt or
 * `sent`; after the request, a refusal or a lost answer patches the word to `request-refused:<word>` or
 * `request-failed`, only over the bytes the hook itself wrote.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, with the approval-wait suite's stubbed client (it records every
 * call and answers from `$HOME/stub`). The payloads are Task 13's captures, only `transcript_path` pointed into the
 * fixture HOME. Never the live HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { APPROVAL_ROUTE_SKIP_WORDS, parseApprovalRoute } from '../../shared/approval-census.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const VERIFIER = path.resolve(__dirname, '../../ccd/approval-verify.mjs');
const CAPTURES = path.resolve(__dirname, 'fixtures/approvals/captures');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const UUID = '00000000-0000-4000-8000-0000000000aa';
const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';

type Payload = Record<string, unknown> & { tool_input: Record<string, unknown> };
const capturedRequest = (file: string): Payload => {
  const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, '2.1.302', file), 'utf8')) as { events: Array<{ event: string; payload: Payload }> };
  const ev = doc.events.find((e) => e.event === 'PermissionRequest');
  if (ev === undefined) throw new Error(`no PermissionRequest in ${file}`);
  return ev.payload;
};
const MAIN = capturedRequest('permission-main.json');
const SUB = capturedRequest('permission-subagent.json');

const keys = generateKeyPairSync('ed25519');
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The approval-wait suite's stub, cut to the request: it records the call, and `request.touch` makes it rewrite the
 *  session's hookstate before it answers (another event writing between the hook's write and its patch). */
const STUB_API = `#!/usr/bin/env bash
d="$HOME/stub"
printf '%s\\n' "$*" >> "$d/calls"
case "$1 $2" in
  "approvals request")
    cat > "$d/request.body"
    [[ -f "$d/request.touch" ]] && cp "$d/request.touch" "$HOME/.cc-sessions/${ID}.hookstate.json"
    [[ -f "$d/request.rc" ]] && exit "$(cat "$d/request.rc")"
    cat "$d/request.out"
    printf 'http %s\\n' "$(cat "$d/request.code")" >&2 ;;
  "approvals ruling")
    printf '{"state":"declined"}'
    printf 'http 200\\n' >&2 ;;
esac
exit 0
`;

let home: string;
const put = (rel: string, text: string, mode = 0o644): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode });
};
const reg = (rel: string): string => path.join(home, '.cc-sessions', rel);

beforeEach(() => {
  home = mkTmp('ccrc-aprroute-');
  put(`.cc-sessions/${ID}.generation`, GENERATION);
  put(`.cc-sessions/${ID}.child`, '7');
  put(`.cc-sessions/${ID}.uuid`, `${UUID}\n`);
  put('.cc-sessions/child-deny.settings.json', DENY_FILE);
  put(`.cc-sessions/${ID}.deny-settings`, sha(DENY_FILE));
  fs.copyFileSync(VERIFIER, reg('approval-verify.mjs'));
  put('.ccrc/approval-signing.pub', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  put('bin/tmux', `#!/bin/sh\necho "cc-${ID}"\n`, 0o755);
  put('.local/bin/ccrc-api', STUB_API, 0o755);
  put('stub/request.out', '{"id":41,"waitS":1}');
  put('stub/request.code', '201');
  put('cfg/projects/-rig-proj/main.jsonl', '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CCRC_APPROVAL_TICK_S: '0.05', CCRC_APPROVAL_POLL_TICKS: '2', CCRC_APPROVAL_CEILING_S: '2',
});
const payloadFor = (p: Payload, over: Record<string, unknown> = {}): Payload =>
  ({ ...p, transcript_path: path.join(home, 'cfg/projects/-rig-proj/main.jsonl'), ...over });

interface Run { stdout: string; sent: boolean; state: Record<string, unknown> | null }
const fire = (p: Payload): Run => {
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(p), encoding: 'utf8', env: ENV(), timeout: 30_000 });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const calls = fs.existsSync(path.join(home, 'stub/calls')) ? fs.readFileSync(path.join(home, 'stub/calls'), 'utf8') : '';
  const f = reg(`${ID}.hookstate.json`);
  return { stdout: r.stdout, sent: calls.includes('approvals request'), state: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown> : null };
};
const routeOf = (r: Run): unknown => ((r.state?.['ask'] as { approval?: { route?: unknown } } | null)?.approval?.route);

describe('the hook\'s skip words are shared/approval-census.ts\'s, in both directions', () => {
  it('every `apr_route=<word>` the gate assigns is a skip word or `sent`, and every skip word is assigned', () => {
    const text = fs.readFileSync(HOOK, 'utf8');
    const body = /^_hook_approval_gate\(\) \{[^\n]*\n([\s\S]*?)\n\}\n/m.exec(text)?.[1];
    expect(body, 'the gate function').toBeDefined();
    const assigned = new Set([...body!.matchAll(/apr_route=([a-z-]+)/g)].map((m) => m[1]));
    expect([...assigned].sort()).toEqual([...APPROVAL_ROUTE_SKIP_WORDS, 'sent'].sort());
  });
  it('each word parses as the route it is', () => {
    for (const w of APPROVAL_ROUTE_SKIP_WORDS) expect(parseApprovalRoute(w)).toEqual({ kind: 'skip', word: w });
    expect(parseApprovalRoute('sent')).toEqual({ kind: 'sent' });
    expect(parseApprovalRoute('request-failed')).toEqual({ kind: 'failed' });
    expect(parseApprovalRoute('request-refused:deny-not-engaged')).toEqual({ kind: 'refused', word: 'deny-not-engaged' });
    expect(parseApprovalRoute('request-refused:Not Found')).toBeNull();
    expect(parseApprovalRoute('something-else')).toBeNull();
    expect(parseApprovalRoute(undefined)).toBeNull();
  });
});

describe('every pre-send gate stamps its word into the envelope, and sends nothing', () => {
  const cases: ReadonlyArray<readonly [string, () => void, Payload?]> = [
    ['not-a-child', () => fs.rmSync(reg(`${ID}.child`))],
    ['kill-switch', () => put('.cc-sessions/approvals-disabled', '')],
    ['deny-unreadable', () => fs.rmSync(reg(`${ID}.deny-settings`))],
    ['deny-unreadable', () => put(`.cc-sessions/${ID}.deny-settings`, 'not-a-digest\n')],
    ['deny-unreadable', () => fs.rmSync(reg('child-deny.settings.json'))],
    ['deny-unknown', () => put(`.cc-sessions/${ID}.deny-settings`, sha('an older deny file'))],
    ['no-verifier', () => fs.rmSync(reg('approval-verify.mjs'))],
    ['no-key', () => fs.rmSync(path.join(home, '.ccrc/approval-signing.pub'))],
    ['no-client', () => fs.chmodSync(path.join(home, '.local/bin/ccrc-api'), 0o644)],
    ['no-uuid', () => fs.rmSync(reg(`${ID}.uuid`))],
    ['forbidden', () => undefined, { ...MAIN, tool_input: { ...MAIN.tool_input, command: 'ccd ws-rm project-a-old' } }],
    ['canonical-failed', () => undefined, { ...MAIN, tool_input: { ...MAIN.tool_input, timeout: 1.5 } }],
    ['nonce-failed', () => put('bin/od', '#!/bin/sh\nexit 1\n', 0o755)],
  ];
  it.each(cases.map(([w, setup, p], i) => [`${w} #${i}`, w, setup, p] as const))('%s', (_n, word, setup, p) => {
    setup();
    const r = fire(payloadFor(p ?? MAIN));
    expect(r.stdout, 'nothing printed').toBe('');
    expect(r.sent, 'no request sent').toBe(false);
    expect(r.state?.['state']).toBe('waiting');
    expect(routeOf(r)).toBe(word);
  });
});

describe('the request\'s own outcome', () => {
  it('a 201: `sent`, for the main thread and for a subagent', () => {
    put('stub/request.out', '{"id":41,"waitS":1}');
    const r = fire(payloadFor(MAIN));
    expect(r.sent).toBe(true);
    expect(routeOf(r)).toBe('sent');
    const s = fire(payloadFor(SUB));
    expect(routeOf(s)).toBe('sent');
  });
  it('a refusal with its kebab word: `request-refused:<word>`', () => {
    put('stub/request.out', '{"ok":false,"error":"deny-not-engaged"}');
    put('stub/request.code', '409');
    const r = fire(payloadFor(MAIN));
    expect(r.sent).toBe(true);
    expect(r.stdout).toBe('');
    expect(routeOf(r)).toBe('request-refused:deny-not-engaged');
  });
  it('a refusal whose error is no kebab word (an older server\'s 404): `request-refused:http-<code>`', () => {
    put('stub/request.out', '{"message":"Route POST:/x not found","error":"Not Found","statusCode":404}');
    put('stub/request.code', '404');
    expect(routeOf(fire(payloadFor(MAIN)))).toBe('request-refused:http-404');
  });
  it('no answer at all: `request-failed`', () => {
    put('stub/request.rc', '1');
    expect(routeOf(fire(payloadFor(MAIN)))).toBe('request-failed');
  });
  it('a 201 the hook cannot read: `request-failed`', () => {
    put('stub/request.out', '{"id":"forty-one"}');
    expect(routeOf(fire(payloadFor(MAIN)))).toBe('request-failed');
  });
  it('the patch is made only over the hook\'s own bytes: a state written since is left as it stands', () => {
    const since = { v: 1, state: 'working', event: 'PreToolUse', sessionId: 'uuid-1', pid: 4242, updatedAt: 1, ask: null };
    put('stub/request.touch', `${JSON.stringify(since)}\n`);
    put('stub/request.out', '{"ok":false,"error":"run-unreadable"}');
    put('stub/request.code', '503');
    const r = fire(payloadFor(MAIN));
    expect(r.state).toEqual(since);
  });
});
