// Writes delegation-synthetic.jsonl: the hand-made payloads (one {p, wr?, ver?} per line) that join the capture corpus
// (server/test/fixtures/delegation) as inputs of `spool` and `lrec`. Edge cases of every closed field's bound, shape and
// type. Regenerate the golden with gen-delegation-golden.sh after changing this file.
import { writeFileSync } from 'node:fs';

const SID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const TR = `/rig/cfg/projects/-rig-repo/${SID}.jsonl`;
const SCRIPT = `/rig/cfg/projects/-rig-repo/${SID}/workflows/scripts/x-wf_0123abcd-0ab.js`;
const base = (name, extra = {}) => ({ hook_event_name: name, session_id: SID, transcript_path: TR, cwd: '/rig/repo', ...extra });
const rows = [];
const add = (p, o = {}) => rows.push({ p, ...o });

// session events
for (const s of ['startup', 'resume', 'clear', 'compact', 'fork', '', 5, null, 'x'.repeat(128), 'x'.repeat(129), 'é'.repeat(64), 'é'.repeat(65)])
  add(base('SessionStart', { source: s }));
add(base('SessionStart'));
add({ hook_event_name: 'SessionStart', source: 'startup' });
add({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'bad id!' });
add(base('SessionStart', { source: 'startup', cwd: 'x'.repeat(513) }));
add(base('SessionStart', { source: 'startup', cwd: 'é'.repeat(256) }));
add(base('SessionStart', { source: 'startup', cwd: 7, transcript_path: ['a'] }));
add(base('SessionStart', { source: 'startup', transcript_path: '/'.padEnd(513, 'y') }));
for (const r of ['logout', 'other', '', 3]) add(base('SessionEnd', { reason: r }));

// subagent events
for (const a of ['a1b2c3', 'bad id', 'x'.repeat(64), 'x'.repeat(65), '', 5, null, 'é', 'a-b_c'])
  for (const ev of ['SubagentStart', 'SubagentStop'])
    add(base(ev, { agent_id: a, agent_type: 'general-purpose', agent_transcript_path: '/rig/sub/agent-1.jsonl' }));
for (const t of ['x'.repeat(128), 'x'.repeat(129), 'é'.repeat(64), 7, null, ''])
  add(base('SubagentStart', { agent_id: 'ag1', agent_type: t }));
add(base('SubagentStop', { agent_id: 'ag1', agent_transcript_path: 'y'.repeat(513) }));
add(base('SubagentStop', { agent_id: 'ag1', agent_transcript_path: 4 }));
add(base('SubagentStop', { agent_id: 'ag1' }));
add(base('SubagentStart', { agent_id: 'ag1', agent_type: 'general-purpose', cwd: 'z'.repeat(400), transcript_path: '/'.padEnd(480, 'q') }));

// notifications
const note = (lines) => `<task-notification>\n${lines.join('\n')}\n</task-notification>`;
const tag = (t, v) => `<${t}>${v}</${t}>`;
for (const st of ['completed', 'failed', 'killed', 'cancelled', 'canceled', 'stopped', 'timeout', 'Completed', 'a'.repeat(32), 'a'.repeat(33), 'with space', ''])
  add(base('UserPromptSubmit', { prompt: note([tag('task-id', 't1'), tag('tool-use-id', 'toolu_01'), tag('status', st), 'rest']) }));
add(base('UserPromptSubmit', { prompt: note([tag('task-id', 't1'), tag('tool-use-id', 'toolu_01'), '<output-file>/x</output-file>', tag('status', 'completed')]) }));
add(base('UserPromptSubmit', { prompt: note([tag('task-id', 't1'), tag('tool-use-id', 'toolu_01'), '<output-file>/x</output-file>', tag('summary', 's'), tag('status', 'completed')]) }));
add(base('UserPromptSubmit', { prompt: note([tag('task-id', 'bad id'), tag('tool-use-id', 'toolu_01'), tag('status', 'completed')]) }));
add(base('UserPromptSubmit', { prompt: note([tag('task-id', ''), tag('tool-use-id', 'toolu_01'), tag('status', 'completed')]) }));
add(base('UserPromptSubmit', { prompt: note([tag('tool-use-id', 'toolu_01'), tag('task-id', 't1'), tag('status', 'completed')]) }));
add(base('UserPromptSubmit', { prompt: note([tag('task-id', 't1')]) }));
add(base('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>u1</tool-use-id>\n<status>completed</status>' }));
add(base('UserPromptSubmit', { prompt: 'hello <task-notification>' }));
add(base('UserPromptSubmit', { prompt: 12 }));
add(base('UserPromptSubmit'));

// tool events
for (const tool of ['Agent', 'Task', 'Workflow', 'Bash', 'Read', 'SendMessage', ''])
  for (const tu of ['toolu_01AAAA', 'bad id', '', null, 'x'.repeat(65)])
    add(base('PreToolUse', { tool_name: tool, tool_use_id: tu, tool_input: { isolation: 'worktree', command: 'git worktree add x' } }));
for (const iso of ['worktree', 'x'.repeat(129), 5, null]) add(base('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { isolation: iso } }));
add(base('PreToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: 'not an object' }));
add(base('PreToolUse', { tool_name: 5, tool_use_id: 'tu1' }));
for (const cmd of ['ls', 'git worktree add ../x', 'git worktree list', 5, null])
  for (const cwd of ['/rig/repo', 'rel/path', '/rig/re\npo', '/rig/re\x7fpo', '/', '/é', 'x'.repeat(513)])
    add(base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1', cwd, tool_input: { command: cmd } }));
add(base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1', cwd: '/ends/with/space ', tool_input: { command: 'git worktree add x' } }));
add(base('PreToolUse', { tool_name: 'Bash', tool_use_id: 'tu1', cwd: '/tab\there', tool_input: { command: 'git worktree add x' } }));

const agentResp = (o = {}) => ({ status: 'async_launched', isAsync: true, agentId: 'aef14f3b6908dc0a9', ...o });
for (const r of [agentResp(), agentResp({ isAsync: false }), agentResp({ isAsync: undefined }), agentResp({ isAsync: 'yes' }),
  agentResp({ status: 'completed' }), agentResp({ status: 'failed' }), agentResp({ status: 'error' }), agentResp({ status: 'weird' }),
  agentResp({ agentId: 'bad id' }), agentResp({ agentId: undefined }), agentResp({ status: undefined }), 'text', [1], null])
  for (const tool of ['Agent', 'Task'])
    add(base('PostToolUse', { tool_name: tool, tool_use_id: 'tu1', tool_input: { prompt: 'p' }, tool_response: r }));
const wf = (o = {}) => ({ status: 'async_launched', taskId: 't1', runId: 'wf_0123abcd-0ab', taskType: 'local_workflow', workflowName: 'demo',
  transcriptDir: `/rig/cfg/projects/-rig-repo/${SID}/workflows/wf_0123abcd-0ab`, scriptPath: SCRIPT, ...o });
for (const o of [{}, { status: 'completed' }, { status: 'failed' }, { taskType: undefined }, { workflowName: '' }, { transcriptDir: 'x'.repeat(513) },
  { scriptPath: 'x'.repeat(513) }, { taskId: 'bad id' }, { runId: undefined }, { taskType: 'x'.repeat(129) }, { scriptPath: `/rig/other/${SID}.js` },
  { scriptPath: SCRIPT.replace('x-wf', 'a/../x-wf') }, { scriptPath: SCRIPT.replace('x-wf', '.hidden') }, { scriptPath: SCRIPT.replace('x-wf', '-lead') },
  { scriptPath: SCRIPT.replace('x-wf', 'sp ace') }, { scriptPath: SCRIPT.replace('x-wf', 'y'.repeat(128)) }, { scriptPath: SCRIPT.replace('x-wf', 'y'.repeat(129)) },
  { scriptPath: SCRIPT.replace('x-wf', '@a+b') }, { scriptPath: SCRIPT.replace('x-wf', 'a//b') }, { scriptPath: SCRIPT.replace('/x-wf_0123abcd-0ab', '/') }])
  add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { script: 'return 1' }, tool_response: wf(o) }));
add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { script: 'x' }, tool_response: wf(), transcript_path: '/other/x.jsonl' }));
add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { script: 'x' }, tool_response: wf(), transcript_path: undefined }));
add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { script: 'x' }, tool_response: wf(), transcript_path: 5 }));
add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { script: 'x' }, tool_response: wf(), session_id: 'sid-1' }));
for (const rr of ['wf_0123abcd-0ab', 'bad id', 0, false, ''])
  for (const st of ['async_launched', 'completed'])
    add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: { resumeFromRunId: rr }, tool_response: wf({ status: st }) }));
for (const r of [{ interrupted: true, stdout: '' }, { stdout: 'ok' }, { stdout: 5 }, { interrupted: false }, {}, 'out', null, { interrupted: 'true', stdout: 's' }])
  for (const cmd of ['git worktree add x', 'ls'])
    add(base('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: cmd }, tool_response: r }));
for (const to of ['aef14f3b6908dc0a9', 'bad id', 5, null, '*', 'x'.repeat(65)])
  add(base('PostToolUse', { tool_name: 'SendMessage', tool_use_id: 'tu1', tool_input: { to, message: 'm' }, tool_response: { success: true } }));
add(base('PostToolUse', { tool_name: 'SendMessage', tool_input: { to: 'ag1' }, session_id: 'bad id' }));
add(base('PostToolUse', { tool_name: 'Agent', tool_input: {}, tool_response: agentResp(), session_id: 'bad id' }));
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), agent_id: 'sub1', agent_type: 'general-purpose' }));
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), agent_id: 'bad id' }));
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), agent_id: '' }));
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), agent_id: 12 }));
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), agent_id: false }));
for (const ev of ['Stop', 'PreCompact', 'PostCompact', 'PermissionRequest', 'StopFailure', 'Mystery']) add(base(ev));

// the wrapper word and the version
for (const wr of ['lane-a', '', 'x'.repeat(64), 'x'.repeat(65), 'bad wrapper', 'ok.name_1-2', 'é'])
  add(base('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'tu1', tool_input: {}, tool_response: wf() }), { wr });
for (const ver of ['2.1.318', '', '1', '2.1.318-beta+x', 'x'.repeat(33), '9'.repeat(32)])
  add(base('SessionStart', { source: 'startup' }), { ver });
add(base('PostToolUse', { tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: agentResp(), cwd: 'c'.repeat(300), agent_type: 'general-purpose' }), { ver: '2.1.318' });

writeFileSync(new URL('delegation-synthetic.jsonl', import.meta.url), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(rows.length, 'cases');
