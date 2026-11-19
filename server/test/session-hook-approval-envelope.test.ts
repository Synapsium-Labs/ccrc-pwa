/**
 * The per-agent approval envelope (approvals plan 2026-11-18, §3.2.2 and Task 2.1; Table 2a, path 6). A subagent's
 * permission prompt is kept in hook state's `approvals` list, one entry per agent: added by its PermissionRequest,
 * removed by that agent's own next tool event, its SubagentStop or the transcript tie's tool_result, and carried
 * unchanged by every other event, the main thread's and a sibling's alike, with or without a `waitPrev` standing. So a
 * subagent's menu painted after its hook returned still has its envelope, and the server's one reader of the painted
 * prompt (`paintedApprovalOf`, over `hookstate.ts`'s read) gives the console the approval surface, not a bare menu.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. The session is no dispatched child (no `.child` mark) unless a
 * case needs the wait, so the gate answers `not-a-child` and nothing is sent. The tie case runs the wait with a stubbed
 * client. The PermissionRequest is Task 13's subagent capture. Never the live HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { localIO } from '../src/io.js';
import { readHookStateRawMeasured } from '../src/hookstate.js';
import { paintedApprovalOf } from '../src/coord/approvalEnvelope.js';
import type { Dialog } from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const VERIFIER = path.resolve(__dirname, '../../ccd/approval-verify.mjs');
const CAPTURES = path.resolve(__dirname, 'fixtures/approvals/captures');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const UUID = '00000000-0000-4000-8000-0000000000aa';
const DENY_FILE = '{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}\n';

type Payload = Record<string, unknown>;
const capture = (file: string): Payload => {
  const doc = JSON.parse(fs.readFileSync(path.join(CAPTURES, '2.1.302', file), 'utf8')) as { events: Array<{ event: string; payload: Payload }> };
  const ev = doc.events.find((e) => e.event === 'PermissionRequest');
  if (ev === undefined) throw new Error(`no PermissionRequest in ${file}`);
  return ev.payload;
};
const SUB = capture('permission-subagent.json');
const A = String(SUB['agent_id']);
const B = 'b0000000000000002';
const SUB_COMMAND = String((SUB['tool_input'] as { command: unknown }).command);

const STUB_API = `#!/usr/bin/env bash
d="$HOME/stub"
printf '%s\\n' "$*" >> "$d/calls"
case "$1 $2" in
  "approvals request")
    cat > "$d/request.body"; cat "$d/request.out"; printf 'http 201\\n' >&2 ;;
  "approvals ruling")
    n=$(( $(cat "$d/ruling.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/ruling.n"
    if [[ -f "$d/append/line" && ! -f "$d/append/done" ]] && (( n >= 2 )); then cat "$d/append/line" >> "$(cat "$d/append/to")"; : > "$d/append/done"; fi
    printf '{"state":"held"}'; printf 'http 200\\n' >&2 ;;
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
const transcript = (): string => path.join(home, 'cfg/projects/-rig-proj/main.jsonl');

beforeEach(() => {
  home = mkTmp('ccrc-aprenv-');
  put(`.cc-sessions/${ID}.generation`, GENERATION);
  put(`.cc-sessions/${ID}.uuid`, `${UUID}\n`);
  put('bin/tmux', `#!/bin/sh\necho "cc-${ID}"\n`, 0o755);
  put('cfg/projects/-rig-proj/main.jsonl', '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
  CCRC_APPROVAL_TICK_S: '0.05', CCRC_APPROVAL_POLL_TICKS: '2', CCRC_APPROVAL_CEILING_S: '3',
});

/** Behind the server's word `hook-main-state-v1`, an agent event keeps the main state and a subagent's wait stores the
 *  `waitPrev` it replaced (D-5232): the wait-present cases need it. */
const advertise = (word: string): void => put('.ccrc/server-caps', `at ${Math.floor(Date.now() / 1000)}\ncaps ${word}\nend\n`);

const base = (): Payload => ({
  session_id: SUB['session_id'], transcript_path: transcript(), cwd: SUB['cwd'], permission_mode: 'bypassPermissions',
});
let seq = 0;
const toolEvent = (event: 'PreToolUse' | 'PostToolUse', agent: string | null, command = 'ls'): Payload => ({
  ...base(), hook_event_name: event, tool_name: 'Bash', tool_use_id: `toolu_${String(++seq).padStart(24, '0')}`,
  tool_input: { command }, ...(event === 'PostToolUse' ? { tool_response: { stdout: '', stderr: '' } } : {}),
  ...(agent === null ? {} : { agent_id: agent, agent_type: 'general-purpose' }),
});
const request = (agent: string | null, command = SUB_COMMAND): Payload => {
  const p: Payload = { ...SUB, transcript_path: transcript(), tool_input: { ...(SUB['tool_input'] as object), command } };
  if (agent === null) delete p['agent_id']; else p['agent_id'] = agent;
  return p;
};
const plain = (event: string, extra: Payload = {}): Payload => ({ ...base(), hook_event_name: event, ...extra });

const fire = (p: Payload): void => {
  const r = spawnSyncGroup('bash', [HOOK], { input: JSON.stringify(p), encoding: 'utf8', env: ENV(), timeout: 30_000 });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
};
const stateOf = (): Record<string, unknown> => JSON.parse(fs.readFileSync(reg(`${ID}.hookstate.json`), 'utf8')) as Record<string, unknown>;
const entries = (): Array<Record<string, unknown>> => (stateOf()['approvals'] as Array<Record<string, unknown>> | undefined) ?? [];
const agents = (): string[] => entries().map((e) => String(e['agentId']));

/** The menu Claude Code paints for a Bash prompt (the shape of `cc280-permission-wrapped-100.txt`, parsed). */
const menuFor = (command: string): Dialog => ({
  id: 'd1', title: 'Bash command', body: `Tip: auto mode handles these prompts for you\n\n  ${command}\n  Run it\n\nDo you want to proceed?`,
  options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'Yes, and always allow access to this project' }, { index: 3, label: 'No' }],
  selectedIndex: 1, parsed: true, raw: '',
});
/** What the server makes of the painted menu, through `hookstate.ts`, the list's one reader. */
const painted = async (command = SUB_COMMAND) => {
  const raw = await readHookStateRawMeasured(localIO, path.join(home, '.cc-sessions'), ID, UUID);
  if (!raw.ok) throw new Error(`hookstate unread: ${raw.reason}`);
  return paintedApprovalOf({ ask: raw.state.ask, approvals: raw.state.approvals ?? [] }, menuFor(command));
};

describe('a subagent\'s PermissionRequest adds its entry', () => {
  it('one entry, its agent, tool, summary, route and the write\'s own stamp', () => {
    fire(plain('UserPromptSubmit', { prompt: 'go' }));
    fire(request(A));
    const s = stateOf();
    expect(entries()).toEqual([{ agentId: A, tool: 'Bash', summary: SUB_COMMAND.slice(0, 200), route: 'not-a-child', at: s['updatedAt'] }]);
  });
  it('the main thread\'s PermissionRequest adds none', () => {
    fire(request(null));
    expect(stateOf()['approvals']).toBeUndefined();
  });
  it('a second prompt of the same agent replaces its entry; another agent\'s is a second entry', () => {
    fire(request(A, 'rm -rf one'));
    fire(request(A, 'rm -rf two'));
    fire(request(B, 'rm -rf three'));
    expect(entries().map((e) => [e['agentId'], e['summary']])).toEqual([[A, 'rm -rf two'], [B, 'rm -rf three']]);
  });
  it('the list keeps the newest 16', () => {
    for (let i = 0; i < 18; i++) fire(request(`a${String(i).padStart(16, '0')}`, `rm -rf d${i}`));
    expect(agents()).toHaveLength(16);
    expect(agents()[0]).toBe(`a${'2'.padStart(16, '0')}`);
  });
});

describe('a subagent\'s prompt survives the main thread\'s events', () => {
  it.each([
    ['PreToolUse', () => toolEvent('PreToolUse', null)],
    ['PostToolUse', () => toolEvent('PostToolUse', null)],
    ['Stop', () => plain('Stop', { stop_hook_active: false })],
    ['UserPromptSubmit', () => plain('UserPromptSubmit', { prompt: 'and then' })],
  ])('the main thread\'s %s', async (_n, ev) => {
    fire(request(A));
    fire(ev());
    expect(agents()).toEqual([A]);
    const p = await painted();
    expect(p.entry?.agentId).toBe(A);
    expect(p.ask).toEqual({ approval: { tool: 'Bash', summary: SUB_COMMAND.slice(0, 200), route: 'not-a-child', thread: 'subagent' } });
  });
  it('all three in a row (PreToolUse, PostToolUse, Stop)', () => {
    fire(request(A));
    fire(toolEvent('PreToolUse', null));
    fire(toolEvent('PostToolUse', null));
    fire(plain('Stop', { stop_hook_active: false }));
    expect(agents()).toEqual([A]);
  });
});

describe('it is removed by its own agent\'s next tool event, or its SubagentStop', () => {
  it.each([
    ['its PreToolUse', () => toolEvent('PreToolUse', A)],
    ['its PostToolUse', () => toolEvent('PostToolUse', A)],
    ['its SubagentStop', () => plain('SubagentStop', { agent_id: A, agent_type: 'general-purpose', stop_hook_active: false })],
  ])('%s', async (_n, ev) => {
    fire(plain('SubagentStart', { agent_id: A, agent_type: 'general-purpose' }));
    fire(request(A));
    fire(request(B, 'rm -rf other'));
    fire(ev());
    expect(agents()).toEqual([B]);
    expect((await painted()).entry).toBeNull();
  });
  it('a SessionStart empties it: the agents died with the old process', () => {
    fire(request(A));
    fire(plain('SessionStart', { source: 'resume' }));
    expect(stateOf()['approvals']).toBeUndefined();
  });
});

describe('a sibling\'s events never clear it (Task 2.1\'s sibling cases)', () => {
  it('with no wait present: the sibling\'s PreToolUse and PostToolUse land while the menu is painted', async () => {
    fire(plain('UserPromptSubmit', { prompt: 'go' }));
    fire(request(A));
    fire(toolEvent('PreToolUse', B));
    fire(toolEvent('PostToolUse', B));
    expect(stateOf()['ask'], 'today\'s hook erases the ask itself').toBeNull();
    expect(agents()).toEqual([A]);
    const p = await painted();
    expect(p.entry?.agentId).toBe(A);
    expect(p.ask && 'approval' in p.ask ? p.ask.approval.thread : null).toBe('subagent');
  });
  it('with a wait present (the main thread\'s state under the subagent\'s wait, `waitPrev`): the restore keeps it', async () => {
    advertise('hook-main-state-v1');
    fire(plain('UserPromptSubmit', { prompt: 'go' }));
    fire(request(A));
    expect(stateOf()['waitPrev'], 'the subagent\'s wait stored the main state it replaced').toBeDefined();
    fire(toolEvent('PreToolUse', B));
    fire(toolEvent('PostToolUse', B));
    expect(stateOf()['state'], 'the sibling restored the main state').toBe('working');
    expect(agents()).toEqual([A]);
    const p = await painted();
    expect(p.entry?.agentId).toBe(A);
    expect(p.ask && 'approval' in p.ask ? p.ask.approval.summary : null).toBe(SUB_COMMAND.slice(0, 200));
  });
  it('a menu that is not the entry\'s command is not its prompt', async () => {
    fire(request(A));
    expect((await painted('git push origin main')).entry).toBeNull();
  });
});

describe('the transcript tie\'s tool_result removes it (the wait saw the pane answered)', () => {
  const keys = generateKeyPairSync('ed25519');
  const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
  const TOOLU = 'toolu_000000000000000000000077';
  const row = (r: unknown): string => `${JSON.stringify(r)}\n`;
  const asChild = (): void => {
    put(`.cc-sessions/${ID}.child`, '7');
    put('.cc-sessions/child-deny.settings.json', DENY_FILE);
    put(`.cc-sessions/${ID}.deny-settings`, sha(DENY_FILE));
    fs.copyFileSync(VERIFIER, reg('approval-verify.mjs'));
    put('.ccrc/approval-signing.pub', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    put('.local/bin/ccrc-api', STUB_API, 0o755);
  };
  it('a refused request patches the entry\'s route word with the envelope\'s (PR 1\'s patch, over the hook\'s own bytes)', () => {
    asChild();
    put('stub/request.out', '{"ok":false,"error":"version-unverified"}');
    put('.local/bin/ccrc-api', STUB_API.replace('http 201', 'http 409'), 0o755);
    fire(request(A));
    expect((stateOf()['ask'] as { approval: { route: string } }).approval.route).toBe('request-refused:version-unverified');
    expect(entries().map((e) => e['route'])).toEqual(['request-refused:version-unverified']);
  });
  it('the entry of the agent whose prompt was answered goes; a sibling\'s stays', () => {
    asChild();
    put('stub/request.out', '{"id":41,"waitS":3}');
    fire(request(B, 'rm -rf other'));
    const sub = path.join(path.dirname(transcript()), String(SUB['session_id']), 'subagents', `agent-${A}.jsonl`);
    put(path.relative(home, sub), row({ type: 'assistant', uuid: `as-${TOOLU}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: TOOLU, name: 'Bash', input: SUB['tool_input'] }] } }));
    put('stub/append/to', sub);
    put('stub/append/line', row({ type: 'user', sourceToolAssistantUUID: `as-${TOOLU}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: TOOLU, is_error: false, content: 'ok' }] } }));
    const t0 = Date.now();
    fire(request(A));
    expect(fs.existsSync(path.join(home, 'stub/append/done')), 'the tool_result landed during the wait').toBe(true);
    expect(Date.now() - t0, 'the tie ended the wait, not its window').toBeLessThan(2_900);
    expect(agents()).toEqual([B]);
  });
});
