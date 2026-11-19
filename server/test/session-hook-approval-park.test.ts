/**
 * The approval park and the operator's v2 verdict words (approvals PR 3): the hook's approval wait prints the park deny
 * when a live-armed request is still unruled at its window's end, or when the ruling read answers `parked`; it names the
 * authority in a deny; and it prints `allow:operator` even for a child whose deny digest is only in the installer's
 * history (a v1 `allow` prints nothing there).
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. The verifier is a STUB here (it prints `stub/verdict.line`), so
 * no signatures are needed: this suite pins the hook's reading of the request's `park` field, of the `parked` state, and
 * of the printed verdict line, not the verifier's checks. The `ccrc-api` client is a stub as in the wait suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { approvalParkDenyText } from '../../shared/approval-park.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const CAPTURES = path.resolve(__dirname, 'fixtures/approvals/captures');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const UUID = '00000000-0000-4000-8000-0000000000aa';
const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';
const VERIFIER_NAME = ['approval', '-', 'verify', '.mjs'].join('');
const PUB_NAME = ['approval', '-signing', '.pub'].join('');

type Payload = Record<string, unknown> & { tool_input: Record<string, unknown> };
const MAIN: Payload = (() => {
  const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, '2.1.302', 'permission-main.json'), 'utf8')) as { events: Array<{ event: string; payload: Payload }> };
  const ev = doc.events.find((e) => e.event === 'PermissionRequest');
  if (ev === undefined) throw new Error('no PermissionRequest capture');
  return ev.payload;
})();

const hookAssign = (name: string): string => {
  const m = fs.readFileSync(HOOK, 'utf8').match(new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)"|([^\\s#]*))`, 'm'));
  if (m === null) throw new Error(`${name} is not assigned in the hook`);
  return (m[1] ?? m[2] ?? m[3]) as string;
};

let home: string;
let stub: string;
let transcript: string;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The stub verifier: prints stub/verdict.line (when it exists) and a newline, exits 0. */
const STUB_VERIFIER = `import fs from 'node:fs';
const p = process.env.HOME + '/stub/verdict.line';
if (fs.existsSync(p)) process.stdout.write(fs.readFileSync(p, 'utf8').replace(/\\n$/, '') + '\\n');
`;

const STUB_API = `#!/usr/bin/env bash
d="$HOME/stub"
printf '%s\\n' "$*" >> "$d/calls"
case "$1 $2" in
  "approvals request")
    cat > "$d/request.body"
    cat "$d/request.out"
    printf 'http %s\\n' "$(cat "$d/request.code")" >&2 ;;
  "approvals ruling")
    n=$(( $(cat "$d/ruling.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/ruling.n"
    cat "$d/ruling.out"
    printf 'http 200\\n' >&2 ;;
esac
exit 0
`;

const put = (rel: string, text: string, mode = 0o644): void => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, { mode });
};

const ALLOWED = '{"state":"allowed","ruling":{"record":{},"sig":"x"}}';
const verdict = (line: string): void => put('stub/verdict.line', `${line}\n`);

beforeEach(() => {
  home = mkTmp('ccrc-aprpark-');
  stub = path.join(home, 'stub');
  put(`.cc-sessions/${ID}.generation`, GENERATION);
  put(`.cc-sessions/${ID}.child`, '7');
  put(`.cc-sessions/${ID}.uuid`, `${UUID}\n`);
  put('.cc-sessions/child-deny.settings.json', DENY_FILE);
  put(`.cc-sessions/${ID}.deny-settings`, sha(DENY_FILE));
  put(`.cc-sessions/${VERIFIER_NAME}`, STUB_VERIFIER);
  put(`.ccrc/${PUB_NAME}`, 'stub pinned key\n');
  put('bin/tmux', `#!/bin/sh\necho "cc-${ID}"\n`, 0o755);
  put('.local/bin/ccrc-api', STUB_API, 0o755);
  put('stub/request.out', '{"id":41,"waitS":1}');
  put('stub/request.code', '201');
  put('stub/ruling.out', ALLOWED);
  transcript = path.join(home, 'cfg', 'projects', '-rig-proj', 'main.jsonl');
  put(path.relative(home, transcript), '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CCRC_APPROVAL_TICK_S: '0.05', CCRC_APPROVAL_POLL_TICKS: '2', CCRC_APPROVAL_CEILING_S: '4',
});
const payloadFor = (): Payload => ({ ...MAIN, transcript_path: transcript });
interface Run { stdout: string; ms: number; rulings: number }
const fire = (env: NodeJS.ProcessEnv = ENV()): Run => {
  const t0 = Date.now();
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payloadFor()), encoding: 'utf8', env, timeout: 30_000 });
  const ms = Date.now() - t0;
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const callsFile = path.join(stub, 'calls');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n') : [];
  return { stdout: r.stdout, ms, rulings: calls.filter((c) => c.startsWith('approvals ruling ')).length };
};
type Decision = { hookSpecificOutput: { hookEventName: string; decision: { behavior: string; message?: string } } };
const decision = (r: Run): Decision | null => {
  if (r.stdout === '') return null;
  const lines = r.stdout.trim().split('\n');
  expect(lines, 'one envelope, never two').toHaveLength(1);
  return JSON.parse(lines[0] as string) as Decision;
};

const LONG_S = 10;
const EARLY_MS = 5_000;
const longWindow = (park?: unknown): NodeJS.ProcessEnv => {
  put('stub/request.out', JSON.stringify({ id: 41, waitS: LONG_S, ...(park === undefined ? {} : { park }) }));
  return { ...ENV(), CCRC_APPROVAL_CEILING_S: String(LONG_S) };
};
const parkDeny = (id: number): Decision => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: approvalParkDenyText(id) } } });
const ALLOW: Decision = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };

describe('the park deny text\'s bash copy', () => {
  it('APPROVAL_PARK_DENY_TAIL, after "approval 41 ", is approvalParkDenyText(41)', () => {
    expect(`approval 41 ${hookAssign('APPROVAL_PARK_DENY_TAIL')}`).toBe(approvalParkDenyText(41));
  });
});

describe('the park: printed at the window\'s end on an exact live, or at once on a parked answer', () => {
  it('park "live" and a ruling that stays held: at the window\'s end the park deny for the row id is printed', () => {
    put('stub/request.out', '{"id":41,"waitS":1,"park":"live"}');
    put('stub/ruling.out', '{"state":"held"}');
    const r = fire();
    expect(decision(r)).toEqual(parkDeny(41));
    expect(r.rulings).toBeGreaterThan(1);
    expect(r.ms).toBeGreaterThanOrEqual(900);
  });
  it('a ruling read answering parked prints the park deny at once, after one poll', () => {
    put('stub/ruling.out', '{"state":"parked"}');
    const r = fire(longWindow());
    expect(decision(r)).toEqual(parkDeny(41));
    expect(r.rulings, 'it stopped on the first poll').toBe(1);
    expect(r.ms, 'it ended at the answer, not at its window').toBeLessThan(EARLY_MS);
  });
  it.each([
    ['shadow', 'shadow'], ['capped', 'capped'], ['absent', undefined], ['"Live"', 'Live'], ['" live"', ' live'], ['a non-string', 1],
  ] as const)('park %s: at the window\'s end nothing is printed', (_n, park) => {
    put('stub/request.out', JSON.stringify({ id: 41, waitS: 1, ...(park === undefined ? {} : { park }) }));
    put('stub/ruling.out', '{"state":"held"}');
    const r = fire();
    expect(r.stdout).toBe('');
    expect(r.rulings).toBeGreaterThan(1);
  });
  it('the retry: park "live" and a first poll that answers allowed prints the allow on the first poll', () => {
    verdict('allow ok');
    const r = fire(longWindow('live'));
    expect(decision(r)).toEqual(ALLOW);
    expect(r.rulings).toBe(1);
    expect(r.ms).toBeLessThan(EARLY_MS);
  });
});

describe('a deny names its authority', () => {
  it.each([
    ['deny:operator not here', 'denied by the operator: not here'],
    ['deny:overlord not here', 'denied by the Overlord: not here'],
    ['deny not here', 'denied by your coordinator: not here'],
  ])('%s -> %s', (line, message) => {
    verdict(line);
    expect(decision(fire(longWindow()))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } });
  });
  it('allow:operator prints the allow decision', () => {
    verdict('allow:operator fine');
    expect(decision(fire(longWindow()))).toEqual(ALLOW);
  });
});

describe('an unknown verdict line prints nothing', () => {
  it.each([['allow:overlord x'], ['deny:foo x'], ['allow:operatorx y']])('%s', (line) => {
    verdict(line);
    // The wait does not end on an unknown line, it keeps polling to its window: a short one.
    const r = fire();
    expect(r.stdout).toBe('');
  });
});

describe('a child whose deny digest is only in the installer\'s history', () => {
  const OLD = 'c'.repeat(64);
  beforeEach(() => {
    put(`.cc-sessions/${ID}.deny-settings`, OLD);
    put('.cc-sessions/child-deny.digests', `${OLD} 1700000000000\n`);
  });
  it('a v1 allow prints nothing', () => {
    verdict('allow ok');
    const r = fire(longWindow());
    expect(r.rulings, 'the ruling was read').toBeGreaterThan(0);
    expect(r.stdout).toBe('');
  });
  it('allow:operator prints the allow decision', () => {
    verdict('allow:operator ok');
    expect(decision(fire(longWindow()))).toEqual(ALLOW);
  });
  it('deny:operator prints the deny', () => {
    verdict('deny:operator r');
    expect(decision(fire(longWindow()))).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'denied by the operator: r' } } });
  });
});
