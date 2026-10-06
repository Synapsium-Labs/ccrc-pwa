#!/usr/bin/env node
// build-matrix.mjs — the delegation fixture corpus -> matrix.json (delegation broker wave 1, spec
// 2026-10-04 §8.1). DERIVED, never hand-edited: delegation-rig.test.ts compares the committed file
// with this builder's output. A run that did not go as scripted (a timeout, a missing prompt, an
// aborted run, the capture cap) is `unmeasured` and carries no question field, so every value in a
// `measured` cell was observed; inside one, `null` means "not observed in this run", never "unmeasured".
// A PROBE that was not reached (`probe [...]: not reached`) is an outcome, recorded in `probesMissed`.
// An unparseable payload, a file that does not parse, and a fixture filed under another version or scenario
// than it names are `unmeasured` too (reasons `unparseable payload`, `fixture unreadable`, `fixture misplaced`).
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
// The notes rig.sh writes when a run did not go as scripted, spelled as rig.sh's own printf/note lines spell
// them. Anchored at the START only: a probe's `probe ["x-timeout"]: not reached`, or a dialog's text, must never
// match (an outcome note begins `probe ` or `dialog answered: `, never with a failure template), while a note that
// STARTS with one of these templates is a failure even with text after it. An end anchor could only turn such a
// note into "measured", the unsafe direction: a failed run's zeros would read as observed.
const FAIL_NOTE = /^(waitLabels \[.*\]: timeout|waitReady: no ready prompt|kill9: no pid|relaunch: no session id captured|unknown step verb .*|run aborted)/;
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
  // Every question field below reads payloads. An event whose payload did not parse would count in `events`
  // yet vanish from the fields, so `subagentStarts: 0` could sit beside `events.SubagentStart.count: 1` and
  // read as "never fired" when nothing was measured: such a run is unmeasured.
  if (f.events.some((e) => !e.payload)) return { status: 'unmeasured', reason: 'unparseable payload', eventsSeen: seen };

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
  const stops = withP.filter((e) => e.event === 'SubagentStop');
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
    transcriptNamesAgent: share(stops, (e) => isStr(e.payload.agent_transcript_path) && isStr(e.payload.agent_id)
      && path.basename(e.payload.agent_transcript_path) === `agent-${e.payload.agent_id}.jsonl`),
    snapshots,
  };
}

const dirs = fs.readdirSync(fixDir).sort().filter((n) => fs.statSync(path.join(fixDir, n)).isDirectory());
// A directory that is not a version is skipped LOUDLY, by ordinal: its name could be residue.
dirs.forEach((n, i) => { if (!VERSION.test(n)) process.stderr.write(`build-matrix: skipped a non-version directory (#${i})\n`); });
// The Fixture shape cell() reads; anything else is a corrupt file, not an absent one.
const shaped = (f) => f !== null && typeof f === 'object' && Array.isArray(f.events) && Array.isArray(f.notes) && Array.isArray(f.labels)
  && f.disk !== null && typeof f.disk === 'object' && f.disk.admin !== null && typeof f.disk.admin === 'object'
  && Array.isArray(f.disk.worktreesLeft) && f.disk.metas !== null && typeof f.disk.metas === 'object';
const versions = dirs.filter((n) => VERSION.test(n)).sort(cmpV);
const scenarios = fs.readdirSync(scenDir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)).sort();
const cells = {};
for (const v of versions) {
  for (const s of scenarios) {
    const file = path.join(fixDir, v, `${s}.json`);
    let f = null;
    if (!fs.existsSync(file)) { cells[`${v}/${s}`] = { status: 'unmeasured', reason: 'no fixture' }; continue; }
    try { f = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { f = null; }
    if (!shaped(f)) cells[`${v}/${s}`] = { status: 'unmeasured', reason: 'fixture unreadable' };
    else if (f.version !== v || f.scenario !== s) cells[`${v}/${s}`] = { status: 'unmeasured', reason: 'fixture misplaced' };
    else cells[`${v}/${s}`] = cell(f);
  }
}
const text = `${JSON.stringify({ v: 1, versions, scenarios, cells }, null, 1)}\n`;
if (flag === '--write') fs.writeFileSync(path.join(fixDir, 'matrix.json'), text);
else process.stdout.write(text);
