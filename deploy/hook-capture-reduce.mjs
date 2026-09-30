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
//     one `[]` segment, `tool_input`/`tool_response` never descended, and a key
//     segment that fails the token test printed `(unprintable)`. An object is
//     collapsed to one `(map)` segment, its keys never printed, when it is wider
//     than 50 keys, or, below the payload root, when any of its keys carries a
//     digit: a map keyed by ids (task ids, agent ids, session ids) is the one
//     shape whose KEYS are data, and no field name of a hook payload has a digit.
//     That digit test is a heuristic, not a proof: an id spelled with letters
//     only would still print as a key segment;
//   - counts, and booleans turned into counts: agent_id (absent, empty,
//     nonEmpty); the pane's meta-line id against the payload's session_id
//     (absent: the meta line names no id; equalsPayload and differsFromPayload:
//     both ids are strings; payloadAbsent: the payload has no string
//     session_id); and background_tasks' shape (absent, notArray, array);
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
// Usage: node deploy/hook-capture-reduce.mjs <capture-dir>
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

const tok = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : UNPRINTABLE);
const errValue = (v) => (typeof v === 'string' && ERROR_VALUE.test(v) ? v : UNPRINTABLE);
const seg = (k) => (KEY.test(k) ? k : UNPRINTABLE);
const idKeyed = (names) => names.some((k) => DIGIT.test(k));
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
  if (names.length > MAP_WIDTH || (segs.length > 0 && idKeyed(names))) {
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

const dir = process.argv[2];
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
      a.elementKeys.add(JSON.stringify(Object.keys(e).map(seg).sort()));
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
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
