#!/usr/bin/env node
// build-matrix.mjs — the delegation fixture corpus -> matrix.json (delegation broker wave 1, spec
// 2026-10-04 §8.1). DERIVED, never hand-edited: delegation-rig.test.ts compares the committed file
// with this builder's output. A run that did not go as scripted (a timeout, a missing prompt, an
// aborted run, the capture cap) is `unmeasured` and carries no question field, so every value in a
// `measured` cell was observed; inside one, `null` means "not observed in this run", never "unmeasured".
// A PROBE that was not reached (`probe [...]: not reached`) is an outcome, recorded in `probesMissed`.
// Usage: node build-matrix.mjs <fixtures-dir> <scenarios-dir> [--write]
import fs from 'node:fs';
import path from 'node:path';

const [fixDir, scenDir, flag] = process.argv.slice(2);
if (!fixDir || !scenDir || (flag !== undefined && flag !== '--write') || process.argv.length > 5) {
  process.stderr.write('usage: node build-matrix.mjs <fixtures-dir> <scenarios-dir> [--write]\n');
  process.exit(2);
}
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const cmpV = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const FAIL_NOTE = /timeout|no ready prompt|no session id|no pid|unknown step|run aborted/;
const PROBE_NOTE = /^probe (\[.*\]): not reached$/;
const CAPTURE_CAP = 200;
const share = (xs, pred) => (xs.length === 0 ? null : xs.every(pred) ? 'all' : xs.some(pred) ? 'some' : 'none');
const isStr = (v) => typeof v === 'string' && v.length > 0;
const DELEGATED = /^(agent-|wf_)/;

function cell(f) {
  const seen = {};
  for (const e of f.events) seen[e.event] = (seen[e.event] ?? 0) + 1;
  const failed = f.notes.filter((n) => FAIL_NOTE.test(n));
  if (f.events.length === 0) return { status: 'unmeasured', reason: f.notes.join('; ') || 'no events captured', eventsSeen: seen };
  if (failed.length > 0) return { status: 'unmeasured', reason: failed.join('; '), eventsSeen: seen };
  if (f.events.length >= CAPTURE_CAP) return { status: 'unmeasured', reason: 'capture cap reached', eventsSeen: seen };

  const by = {};
  for (const e of f.events) {
    const b = (by[e.event] ??= { count: 0, withAgentId: 0, keys: new Set() });
    b.count += 1;
    if (e.payload && isStr(e.payload.agent_id)) b.withAgentId += 1;
    if (e.payload) for (const k of Object.keys(e.payload)) b.keys.add(k);
  }
  const events = Object.fromEntries(Object.keys(by).sort().map((k) => [k, { count: by[k].count, withAgentId: by[k].withAgentId, keys: [...by[k].keys].sort() }]));
  const withP = f.events.filter((e) => e.payload);
  const sidOrd = new Map();
  const ordOf = (s) => { if (!isStr(s)) return null; if (!sidOrd.has(s)) sidOrd.set(s, `s${sidOrd.size + 1}`); return sidOrd.get(s); };
  for (const e of withP) ordOf(e.payload.session_id);
  const firstSid = withP.map((e) => e.payload.session_id).find(isStr);
  const agentCall = withP.find((e) => e.event === 'PreToolUse' && ['Agent', 'Task'].includes(e.payload.tool_name) && !isStr(e.payload.agent_id));
  const starts = withP.filter((e) => e.event === 'SubagentStart');
  const startIds = new Set(starts.map((e) => e.payload.agent_id).filter(isStr));
  const admin = Object.entries(f.disk.admin);
  const delegated = admin.filter(([n]) => DELEGATED.test(n));
  const others = admin.filter(([n]) => !DELEGATED.test(n));
  const agentRecords = admin.filter(([n]) => n.startsWith('agent-'));
  const metas = Object.values(f.disk.metas).filter((m) => m && m.spawnedWithWorktree === true);
  // Subagent-side Bash calls are found by the SCRIPTED marker in their command (`DLG-ACK-`), not by
  // agent_id — whether they carry an agent_id is one of the questions.
  const acks = withP.filter((e) => (e.event === 'PreToolUse' || e.event === 'PostToolUse') && e.payload.tool_name === 'Bash'
    && typeof e.payload.tool_input?.command === 'string' && e.payload.tool_input.command.includes('DLG-ACK-'));
  const stops = withP.filter((e) => e.event === 'SubagentStop' && isStr(e.payload.agent_transcript_path) && isStr(e.payload.agent_id));
  const ends = withP.filter((e) => e.event === 'SessionEnd');
  const probesMissed = f.notes.map((n) => PROBE_NOTE.exec(n)).filter(Boolean).flatMap((m) => JSON.parse(m[1])).sort();
  const snapshots = Object.fromEntries(Object.entries(f.disk.snapshots ?? {}).sort()
    .map(([k, v]) => [k, (v.adminRecords ?? []).filter((n) => DELEGATED.test(n)).sort()]));
  return {
    status: 'measured',
    events,
    labels: [...f.labels].sort(),
    probesMissed,
    agentTool: agentCall ? agentCall.payload.tool_name : null,
    agentIsolationInInput: agentCall ? Object.prototype.hasOwnProperty.call(agentCall.payload.tool_input ?? {}, 'isolation') : null,
    subagentStarts: starts.length,
    subagentTypes: [...new Set(starts.map((e) => (isStr(e.payload.agent_type) ? e.payload.agent_type : null)))].sort(),
    agentIdNamesWorktree: agentRecords.length === 0 ? null : agentRecords.every(([n]) => startIds.has(n.slice('agent-'.length))),
    metaHasWorktreePath: share(metas, (m) => isStr(m.worktreePath)),
    recordsWithMeta: share(delegated, ([, a]) => metas.some((m) => isStr(m.worktreePath) && a.gitdir === `${m.worktreePath}/.git`)),
    claudeBase: share(delegated, ([, a]) => typeof a.claudeBase === 'string' && /^[0-9a-f]{40}$/.test(a.claudeBase)),
    claudeBaseIsFirstLog: share(delegated, ([, a]) => isStr(a.claudeBase) && a.claudeBase === a.firstLogSha),
    delegatedRecordsLeft: delegated.length,
    otherRecordsLeft: others.length,
    otherClaudeBase: share(others, ([, a]) => isStr(a.claudeBase)),
    worktreesLeft: f.disk.worktreesLeft.length,
    sessionEnd: { count: ends.length, reasons: [...new Set(ends.map((e) => (isStr(e.payload.reason) ? e.payload.reason : null)))].sort() },
    sessionIds: sidOrd.size,
    sessionStarts: withP.filter((e) => e.event === 'SessionStart').map((e) => [isStr(e.payload.source) ? e.payload.source : null, ordOf(e.payload.session_id)]),
    subagentBash: acks.length === 0 ? null : {
      count: acks.length,
      withAgentId: acks.filter((e) => isStr(e.payload.agent_id)).length,
      firstSessionId: share(acks, (e) => e.payload.session_id === firstSid),
      cwdInWorktree: share(acks, (e) => isStr(e.payload.cwd) && e.payload.cwd.startsWith('/rig/repo/.claude/worktrees/')),
    },
    transcriptNamesAgent: share(stops, (e) => path.basename(e.payload.agent_transcript_path) === `agent-${e.payload.agent_id}.jsonl`),
    snapshots,
  };
}

const versions = fs.readdirSync(fixDir).filter((n) => VERSION.test(n) && fs.statSync(path.join(fixDir, n)).isDirectory()).sort(cmpV);
const scenarios = fs.readdirSync(scenDir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort();
const cells = {};
for (const v of versions) {
  for (const s of scenarios) {
    let f = null;
    try { f = JSON.parse(fs.readFileSync(path.join(fixDir, v, `${s}.json`), 'utf8')); } catch { f = null; }
    cells[`${v}/${s}`] = f === null ? { status: 'unmeasured', reason: 'no fixture' } : cell(f);
  }
}
const text = `${JSON.stringify({ v: 1, versions, scenarios, cells }, null, 1)}\n`;
if (flag === '--write') fs.writeFileSync(path.join(fixDir, 'matrix.json'), text);
else process.stdout.write(text);
