// Reduce one hook-capture directory to what may be committed (worker stall
// watch, design 2026-09-29 §5.1, the first task of wave 2).
//
// `ccd/session-hook.sh`'s capture arm copies every hook payload of a `-hookcap`
// session to `$HOME/.ccrc/hook-capture/<id>/<event>-<epochms>-<pid>.cap`: line 1
// is a meta line, `{"envSid":"<the pane's CLAUDE_CODE_SESSION_ID, sanitised>"}`,
// and the rest is the payload exactly as Claude Code sent it. Those raw files
// never leave the fleet box: a payload carries `last_assistant_message`,
// `transcript_path`, `prompt`, `cwd` and tool arguments, and this repository is
// public. This tool prints ONE JSON document that holds only:
//   - key paths and their JSON types (never a value), to depth 4, with an array
//     one `[]` segment and `tool_input`/`tool_response` never descended. A key
//     name is printed only if it passes the KEY test (letters, digits, `_`, `.`,
//     `-`, 1 to 40 characters, NO space); any other prints `(unprintable)`. That
//     is its own rule, apart from the token test below, which admits a space.
//     An object is collapsed to one `(map)` segment, and NONE of its keys is
//     printed, when it is wider than 50 keys or when any of its keys carries a
//     digit. That holds on both paths that print key names taken from the
//     payload: the key paths above and background_tasks' `elementKeys` (an
//     element is an object too). The only other key names printed are the
//     `error`/`reason` fields below, which a fixed pattern picks out and which
//     are not collected from the object. The payload ROOT is exempt from the
//     digit test only (a root wider than 50 keys still collapses). The digit test
//     exists because a map keyed by ids (task ids, agent ids, session ids) is the
//     one shape whose KEYS are data. It rests on an ASSUMPTION the tool cannot
//     check: that no field name of a hook payload carries a digit. The root exemption is the guard for the day it fails: a
//     new top-level field such as `mcp_v2` then keeps the hook's own top-level
//     key names visible, where collapsing the root would erase them all. A
//     digit-bearing name below the root does collapse its object, and that shows
//     as a `(map)` in the output, which is the cue to revisit the test. The digit
//     test is also a heuristic, not a proof: an id spelled with letters only
//     would still print as a key;
//   - counts, and booleans turned into counts: agent_id (absent, empty,
//     nonEmpty); the pane's meta-line id against the payload's session_id; and
//     background_tasks' shape (absent, notArray, array). The meta-line counts
//     have a fixed precedence: a meta line that names no id counts under
//     `absent` FIRST, whatever the payload says; only then does a payload with no
//     string `session_id` count under `payloadAbsent`; and only when both ids are
//     strings do `equalsPayload` and `differsFromPayload` apply;
//   - three kinds of string value. A background_tasks element's `type` and
//     SessionStart's `source` pass the token test (letters, digits, space, `_`,
//     `.`, `-`, at most 40). StopFailure's error-field values pass a STRICTER
//     enum test (`[a-z0-9_]`, at most 40: `server_error`, `rate_limit`), because
//     a sibling field such as `error_details` may hold free text that the token
//     test would let through. The names of the `error` and `reason` fields (with
//     an optional lowercase suffix, `error_details`) are reported as they are;
//   - the time-ordered `sequence` of (event, agent_id class), so the checkpoint's
//     C1 can see WHERE the non-empty agent_ids fall (inside a SubagentStart ..
//     SubagentStop window, or not), which per-event counts alone cannot show.
// No id is emitted as a VALUE: not a session id, not an agent id, not a task id.
//
// THE DELEGATION BLOCK (delegation broker wave 1, spec §8.1) adds what the real-lane
// cross-check needs and the document above cannot show — still no value, no id, no path:
//   - tool names from a FIXED set (`Agent`, `Task`, `Workflow`, `Bash`); any other name
//     counts as `(other)`, so a plugin's tool name is never printed;
//   - for an Agent/Task/Workflow call, the TOP-LEVEL key names of `tool_input` and
//     `tool_response` (the KEY test and the same width and digit collapse as above) — the one
//     place the never-descend rule above bends, and only for key NAMES; a Bash call's are never
//     printed — and `tool_input.isolation` counted as `worktree`, `remote`, `absent` or `other`;
//   - SessionEnd's `reason` through the enum test (`[a-z_]`, at most 40);
//   - ordinals in place of ids: the n-th distinct session_id is `s<n>`, agent_id `a<n>`,
//     tool_use_id `t<n>`, first seen first — equality is visible, the id is not;
//   - `cwd` classified against `--root <label>=<abs-path>` arguments: the label when equal,
//     `<label>/*` when below the longest matching root, `other`, `(absent)`, or
//     `unclassified` when no root was given;
//   - whether SubagentStop's `agent_transcript_path` is named `agent-<its agent_id>.jsonl`.
//
// Usage: node deploy/hook-capture-reduce.mjs <capture-dir> [--root <label>=<abs-path>]...
// Exit 0 with the document on stdout; exit 2 with one stderr line when the
// argument is missing or is not a directory.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const TOKEN = /^[A-Za-z0-9 _.-]{1,40}$/;
const KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const CAP_NAME = /^([A-Za-z]{1,40})-([0-9]{1,16})-([0-9]{1,10})\.cap$/;
const ERROR_KEY = /^(error|reason)(_[a-z]+)?$/;
const ERROR_VALUE = /^[a-z0-9_]{1,40}$/;
const DIGIT = /[0-9]/;
const MAX_DEPTH = 4;
const MAP_WIDTH = 50;
const OPAQUE = new Set(['tool_input', 'tool_response']);
const UNPRINTABLE = '(unprintable)';
const MAP = '(map)';
const ABSENT = '(absent)';
const MEASURED_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'Bash']);
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
const ISOLATION = new Set(['worktree', 'remote']);
const ENUM = /^[a-z_]{1,40}$/;
const LABEL = /^[a-z][a-z0-9-]{0,20}$/;

const tok = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : UNPRINTABLE);
const errValue = (v) => (typeof v === 'string' && ERROR_VALUE.test(v) ? v : UNPRINTABLE);
const seg = (k) => (KEY.test(k) ? k : UNPRINTABLE);
const idKeyed = (names) => names.some((k) => DIGIT.test(k));
/** An object whose keys are not printed: too wide, or (below the payload root) a digit in a key. */
const asMap = (names, atRoot) => names.length > MAP_WIDTH || (!atRoot && idKeyed(names));
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sorted = (set) => [...set].sort();

function add(keys, p, t) {
  let s = keys.get(p);
  if (s === undefined) { s = new Set(); keys.set(p, s); }
  s.add(t);
}

/** The members of an object at `segs` (the payload itself at `[]`). */
function walkObject(obj, segs, keys) {
  const names = Object.keys(obj);
  if (asMap(names, segs.length === 0)) {
    for (const k of names) add(keys, [...segs, MAP].join('.'), typeOf(obj[k]));
    return;
  }
  for (const k of names) {
    if (OPAQUE.has(k)) { add(keys, [...segs, seg(k)].join('.'), typeOf(obj[k])); continue; }
    walk(obj[k], [...segs, seg(k)], keys);
  }
}

/** One value at `segs` (length >= 1): record its type, then descend. */
function walk(v, segs, keys) {
  const p = segs.join('.');
  add(keys, p, typeOf(v));
  if (segs.length >= MAX_DEPTH) return;
  if (Array.isArray(v)) { for (const e of v) walk(e, [...segs, '[]'], keys); return; }
  if (isObject(v)) walkObject(v, segs, keys);
}

function parseMeta(line) {
  try {
    const m = JSON.parse(line);
    return isObject(m) && typeof m.envSid === 'string' && m.envSid.length > 0 ? m.envSid : null;
  } catch { return null; }
}

function parsePayload(text) {
  try {
    const p = JSON.parse(text);
    return isObject(p) ? p : null;
  } catch { return null; }
}

function newAcc() {
  return {
    count: 0, keys: new Map(),
    agentId: { absent: 0, empty: 0, nonEmpty: 0 },
    envSid: { absent: 0, equalsPayload: 0, differsFromPayload: 0, payloadAbsent: 0 },
    bg: { absent: 0, notArray: 0, array: 0 }, elementKeys: new Set(), types: new Set(),
    source: new Set(), errFields: new Set(), errValues: new Set(),
  };
}

const ords = { s: new Map(), a: new Map(), t: new Map() };
/** The ordinal standing in for an id: `s1`, `a2`, `t3` — first seen first; null when absent or empty. */
const ord = (kind, v) => {
  if (typeof v !== 'string' || v.length === 0) return null;
  const m = ords[kind];
  if (!m.has(v)) m.set(v, `${kind}${m.size + 1}`);
  return m.get(v);
};
/** A cwd as a root label, never as a path. */
const cwdClass = (v) => {
  if (v === undefined || v === null) return ABSENT;
  if (typeof v !== 'string') return UNPRINTABLE;
  if (roots.length === 0) return 'unclassified';
  const p = v.replace(/\/+$/, '') || '/';
  let best = null;
  for (const r of roots) {
    if (p === r.path) return r.label;
    if (p.startsWith(`${r.path}/`) && (best === null || r.path.length > best.path.length)) best = r;
  }
  return best === null ? 'other' : `${best.label}/*`;
};
/** Top-level key names of a value, under the same KEY test and collapse as the walk. */
const topKeys = (v) => {
  if (!isObject(v)) return [`(${typeOf(v)})`];
  const names = Object.keys(v);
  return asMap(names, false) ? [MAP] : names.map(seg).sort();
};
const dlg = { toolNames: {}, calls: new Map(), sessionEndReasons: new Set(), sequence: [] };

const argv = process.argv.slice(2);
const dir = argv[0];
const roots = [];
let badArgs = false;
for (let i = 1; i < argv.length; i += 2) {
  const m = argv[i] === '--root' && typeof argv[i + 1] === 'string' ? /^([^=]+)=(\/.*)$/.exec(argv[i + 1]) : null;
  if (m === null || !LABEL.test(m[1])) { badArgs = true; break; }
  roots.push({ label: m[1], path: m[2].replace(/\/+$/, '') || '/' });
}
if (badArgs) {
  process.stderr.write('usage: node deploy/hook-capture-reduce.mjs <capture-dir> [--root <label>=<abs-path>]... (bad argument)\n');
  process.exit(2);
}
let isDir = false;
try { isDir = typeof dir === 'string' && dir.length > 0 && statSync(dir).isDirectory(); } catch { isDir = false; }
if (!isDir) {
  process.stderr.write('usage: node deploy/hook-capture-reduce.mjs <capture-dir> (no such directory)\n');
  process.exit(2);
}

const files = readdirSync(dir)
  .map((name) => ({ name, m: CAP_NAME.exec(name) }))
  .filter((f) => f.m !== null)
  .map((f) => ({ name: f.name, event: f.m[1], ms: Number(f.m[2]), pid: Number(f.m[3]) }))
  .sort((a, b) => a.ms - b.ms || a.pid - b.pid || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const events = new Map();
const sessionStarts = [];
const sequence = [];
let unparsed = 0;
let prevSid;   // undefined before the first file; null when that file's meta named none

for (const f of files) {
  let text = '';
  try { text = readFileSync(path.join(dir, f.name), 'utf8'); } catch { text = ''; }
  const nl = text.indexOf('\n');
  const envSid = parseMeta(nl === -1 ? text : text.slice(0, nl));
  const p = parsePayload(nl === -1 ? '' : text.slice(nl + 1));
  let a = events.get(f.event);
  if (a === undefined) { a = newAcc(); events.set(f.event, a); }
  a.count += 1;
  if (f.event === 'SessionStart') {
    const vs = prevSid === undefined ? 'first'
      : prevSid === null || envSid === null ? 'unmeasured'
        : prevSid === envSid ? 'same' : 'changed';
    const source = p === null ? UNPRINTABLE : p.source === undefined ? ABSENT : tok(p.source);
    sessionStarts.push({ source, envSidVsPrevious: vs });
  }
  prevSid = envSid;
  if (p === null) { unparsed += 1; sequence.push({ event: f.event, agentId: 'unparsed' }); continue; }

  walkObject(p, [], a.keys);

  const tn = typeof p.tool_name === 'string' ? (MEASURED_TOOLS.has(p.tool_name) ? p.tool_name : '(other)') : null;
  if (tn !== null) {
    const h = (dlg.toolNames[f.event] ??= {});
    h[tn] = (h[tn] ?? 0) + 1;
  }
  if (tn !== null && DELEGATION_TOOLS.has(tn)) {
    const k = `${f.event}:${tn}`;
    let c = dlg.calls.get(k);
    if (c === undefined) {
      c = { count: 0, inputKeys: new Set(), responseKeys: new Set(), isolation: { worktree: 0, remote: 0, absent: 0, other: 0 } };
      dlg.calls.set(k, c);
    }
    c.count += 1;
    c.inputKeys.add(JSON.stringify(p.tool_input === undefined ? [ABSENT] : topKeys(p.tool_input)));
    if (p.tool_response !== undefined) c.responseKeys.add(JSON.stringify(topKeys(p.tool_response)));
    const iso = isObject(p.tool_input) ? p.tool_input.isolation : undefined;
    c.isolation[iso === undefined ? 'absent' : ISOLATION.has(iso) ? iso : 'other'] += 1;
  }
  if (f.event === 'SessionEnd') {
    dlg.sessionEndReasons.add(p.reason === undefined ? ABSENT
      : typeof p.reason === 'string' && ENUM.test(p.reason) ? p.reason : UNPRINTABLE);
  }
  const tp = p.agent_transcript_path;
  dlg.sequence.push({
    event: f.event, sid: ord('s', p.session_id), agent: ord('a', p.agent_id), toolUse: ord('t', p.tool_use_id),
    tool: tn, cwd: cwdClass(p.cwd),
    transcriptNamesAgent: typeof tp === 'string' && typeof p.agent_id === 'string' && p.agent_id.length > 0
      ? path.basename(tp) === `agent-${p.agent_id}.jsonl` : null,
  });

  const aid = p.agent_id;
  const cls = aid === undefined || aid === null ? 'absent' : aid === '' ? 'empty' : 'nonEmpty';
  a.agentId[cls] += 1;
  sequence.push({ event: f.event, agentId: cls });

  if (envSid === null) a.envSid.absent += 1;
  else if (typeof p.session_id !== 'string') a.envSid.payloadAbsent += 1;
  else if (p.session_id === envSid) a.envSid.equalsPayload += 1;
  else a.envSid.differsFromPayload += 1;

  const bt = p.background_tasks;
  if (bt === undefined) a.bg.absent += 1;
  else if (!Array.isArray(bt)) a.bg.notArray += 1;
  else {
    a.bg.array += 1;
    for (const e of bt) {
      if (!isObject(e)) continue;
      const names = Object.keys(e);
      a.elementKeys.add(JSON.stringify(asMap(names, false) ? [MAP] : names.map(seg).sort()));
      if (e.type !== undefined) a.types.add(tok(e.type));
    }
  }

  if (f.event === 'SessionStart') a.source.add(p.source === undefined ? ABSENT : tok(p.source));
  if (f.event === 'StopFailure') {
    for (const k of Object.keys(p)) {
      if (!ERROR_KEY.test(k) || typeof p[k] !== 'string') continue;
      a.errFields.add(k);
      a.errValues.add(errValue(p[k]));
    }
  }
}

const out = { v: 1, files: files.length, unparsed, events: {}, sessionStarts, sequence };
for (const name of sorted(events.keys())) {
  const a = events.get(name);
  const keys = {};
  for (const k of sorted(a.keys.keys())) keys[k] = sorted(a.keys.get(k));
  const e = {
    count: a.count, keys, agentId: a.agentId, envSid: a.envSid,
    backgroundTasks: { ...a.bg, elementKeys: sorted(a.elementKeys).map((s) => JSON.parse(s)), types: sorted(a.types) },
  };
  if (name === 'SessionStart') e.source = sorted(a.source);
  if (name === 'StopFailure') e.error = { fields: sorted(a.errFields), values: sorted(a.errValues) };
  out.events[name] = e;
}
out.delegation = {
  toolNames: dlg.toolNames,
  calls: Object.fromEntries(sorted(dlg.calls.keys()).map((k) => {
    const c = dlg.calls.get(k);
    return [k, {
      count: c.count,
      inputKeys: sorted(c.inputKeys).map((s) => JSON.parse(s)),
      responseKeys: sorted(c.responseKeys).map((s) => JSON.parse(s)),
      isolation: c.isolation,
    }];
  })),
  sessionEndReasons: sorted(dlg.sessionEndReasons),
  ids: { sessions: ords.s.size, agents: ords.a.size, toolUses: ords.t.size },
  sequence: dlg.sequence,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
