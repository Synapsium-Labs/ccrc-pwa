#!/usr/bin/env node
// ccd/compact-card.mjs — the compaction card's helper. `card` mines a
// transcript window for the files a context was working in, resolves them
// against graphify's graph.json and renders a structural card; `measure`
// scores a compaction summary against that working set.
//
// Spec: docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md
// (§3.2 `card`, §3.4 `measure`). Invoked ONLY by ccd/session-hook.sh, under
// the hook's locally resolved `timeout`/`gtimeout` deadline, on PreCompact and
// PostCompact; installed beside the hook as
// ~/.cc-sessions/compact-card.mjs by deploy.sh's agent lane and `ccrc install`.
//
// Plain node, `node:*` imports only — the `shared/mark.mjs` class: a
// deploy-side script the PWA never bundles, importable by vitest directly
// (types in the hand-written `compact-card.d.mts` beside it). Reads only the
// files it is given; writes only the two PRIVATE STAGE paths the hook names —
// `--set-stage` and `--card-stage` — each through its own `<stage>.part` temp
// and a rename, so a stage exists iff it is complete. NO CANONICAL PATHNAME
// REACHES THIS PROCESS'S ARGV (round 7, option A): there is no `--out` and no
// `--set`, this helper cannot open or rename a canonical artifact, and every
// ownership decision and canonical publication is the hook's, under a lock it
// reacquires after this process has exited.
//
// Exit codes (spec §3.2): 0 written; 3 empty working set (the set is written
// with `files: []`, no card); 2 usage; 1 any failure. `card` prints nothing on
// stdout; `measure` prints exactly one JSON object. Every failure names itself
// on stderr, which the hook discards — the hook's contract is silence.
import { openSync, readSync, closeSync, fstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 2, EMPTY: 3 });

/** The window when no boundary exists: the last 16 MiB, realigned to a line
 *  start — a mid-line start is not a partial parse, `JSON.parse` rejects it
 *  wholesale, which the prototype measured as a silently empty set. 16 MiB,
 *  not 64: a transcript that has never compacted is far smaller (auto-
 *  compaction fires long before), and the cap bounds the helper's time and
 *  memory (a 64 MiB window measured 0.3 s to read and 0.4 s to mine). */
export const WINDOW_CAP = 16 * 1024 * 1024;
/** The backwards-scan chunk; a parameter of `readWindow` so a test can build
 *  a deterministic chunk-edge straddle with a small one. */
export const CHUNK = 1024 * 1024;
/** A boundary row is small (measured on this session's own transcript: 1,348
 *  and 1,943 bytes). A `"compact_boundary"` literal whose line start or end
 *  lies further away than this is inside a message body, not a row. */
const LINE_SCAN_MAX = 65536;
const NEEDLE = Buffer.from('"compact_boundary"');

/** Is this line the harness's own boundary row — `{type:"system",
 *  subtype:"compact_boundary"}` — and not a literal inside a message body? */
export function isBoundaryLine(line) {
  try {
    const o = JSON.parse(line);
    return o !== null && typeof o === 'object' && o.type === 'system' && o.subtype === 'compact_boundary';
  } catch {
    return false;
  }
}

/** The line containing byte offset `at`, bounded by LINE_SCAN_MAX on either
 *  side; null when a line end is not found inside the bound. */
function lineAt(fd, at, size) {
  const before = Math.min(LINE_SCAN_MAX, at);
  const after = Math.min(LINE_SCAN_MAX, size - at);
  const buf = Buffer.alloc(before + after);
  readSync(fd, buf, 0, buf.length, at - before);
  const nlBefore = before > 0 ? buf.lastIndexOf(0x0a, before - 1) : -1;
  const start = nlBefore >= 0 ? nlBefore + 1 : (at - before === 0 ? 0 : -1);
  const nlAfter = buf.indexOf(0x0a, before);
  const end = nlAfter >= 0 ? nlAfter : (at + after === size ? buf.length : -1);
  if (start < 0 || end < 0) return null;
  return { start: at - before + start, text: buf.subarray(start, end).toString('utf8') };
}

function readFrom(fd, start, size) {
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  return buf.toString('utf8');
}

/** The transcript window (spec §3.2): from the last CONFIRMED compaction
 *  boundary to EOF, found by scanning BACKWARDS in 1 MiB chunks for the
 *  literal and parsing the line it sits on; else the whole file, capped at the
 *  last `cap` bytes realigned to a line start. Chunks are searched as they
 *  are read and concatenated once, so a 64 MiB file with no boundary costs one
 *  pass, not sixty-four. */
export function readWindow(path, cap = WINDOW_CAP, chunkSize = CHUNK) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const chunks = [];
    let pos = size, total = 0;
    // The head of the previously read (later) chunk: a needle split across
    // the chunk edge is matched in `chunk + carry`, never lost.
    let carry = Buffer.alloc(0);
    while (pos > 0 && total < cap) {
      const len = Math.min(chunkSize, pos, cap - total);
      pos -= len;
      const chunk = Buffer.alloc(len);
      readSync(fd, chunk, 0, len, pos);
      chunks.unshift(chunk);
      total += len;
      const probe = Buffer.concat([chunk, carry]);
      let at = probe.lastIndexOf(NEEDLE);
      while (at >= 0) {
        const line = lineAt(fd, pos + at, size);
        if (line && isBoundaryLine(line.text)) return { text: readFrom(fd, line.start, size), boundary: true };
        at = at > 0 ? probe.lastIndexOf(NEEDLE, at - 1) : -1;
      }
      carry = chunk.subarray(0, Math.min(NEEDLE.length - 1, chunk.length));
    }
    let buf = Buffer.concat(chunks);
    // `total` (== buf.length here) can never exceed `cap`: each iteration's
    // `len` is bounded by `cap - total`, so the loop invariant total <= cap
    // holds from the first iteration on — `buf.length > cap` was therefore
    // unreachable and is swept (Task 3 deferred, Task 8's sweep list).
    if (pos > 0) {
      buf = buf.subarray(Math.max(0, buf.length - cap));
      const nl = buf.indexOf(0x0a);
      buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0);
    }
    return { text: buf.toString('utf8'), boundary: false };
  } finally {
    closeSync(fd);
  }
}

// ── MINING (spec §3.2) ───────────────────────────────────────────────────
/** Ranked tags, strongest first. */
export const TAGS = Object.freeze(['edited', 'touched', 'carried']);
/** DERIVED from `TAGS`, never a second hand-kept copy. */
const TAG_RANK = Object.fromEntries(TAGS.map((t, i) => [t, i]));
const TAG_SET = new Set(TAGS);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** The working set is capped here; the card prints the first `--max-files`
 *  of it (two populations, spec §3.2). */
export const WORKSET_CAP = 100;

/** Every extension the graph's own files carry, longest first then
 *  alphabetical — DERIVED, never typed. Files with no extension (`ccd/ccd`)
 *  cannot be mined from shell text: a stated limitation, not a bug. */
export function extensionsOf(files) {
  const exts = new Set();
  for (const f of files) {
    const b = basename(f);
    const i = b.lastIndexOf('.');
    if (i > 0 && i < b.length - 1) exts.add(b.slice(i + 1));
  }
  return [...exts].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** `[A-Za-z0-9_./-]+\.(<ext>)`, trailing lookahead so `baz.tsz` never
 *  matches; null when the graph names no extension.
 *  The LEADING lookbehind is not a match filter — it never changes what
 *  matches: the prefix class already contains its own separators (`.`, `/`,
 *  `-`), so a match starting mid-run is always also found starting from the
 *  run's own beginning (proven, and differentially measured against 2.3M
 *  random strings with zero output differences). It is a START-POSITION
 *  FILTER kept for COST: without it, a class-char run with no token in it
 *  forces the engine to restart the greedy `+` scan at every position in the
 *  run, which is quadratic in run length — measured: a 64 KB such run mines
 *  in ~7.5 s without the lookbehind and ~0.8 ms with it (32 KB: ~1.5 s vs
 *  ~0.3 ms). The helper runs under an 8 s deadline against a 16 MiB window
 *  and fails SILENTLY when killed, so that cost is disqualifying, not just
 *  slow. */
export function tokenRegex(exts) {
  if (exts.length === 0) return null;
  const alt = exts.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![A-Za-z0-9_./-])[A-Za-z0-9_./-]+\\.(?:${alt})(?![A-Za-z0-9_])`, 'g');
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
  return '';
};

/** Raw path tokens out of a window, one row per occurrence (the mining table
 *  of spec §3.2): Edit-shaped tools' `file_path`/`notebook_path` → edited;
 *  `Read`'s `file_path` → touched; regex hits in a `Bash` command → touched;
 *  regex hits in the previous compaction's summary → carried. A line that
 *  does not parse is skipped, never fatal. */
export function mineTokens(windowText, re) {
  const out = [];
  for (const line of windowText.split('\n')) {
    if (line === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o === null || typeof o !== 'object') continue;
    const msg = o.message;
    if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (!item || item.type !== 'tool_use' || !item.input || typeof item.input !== 'object') continue;
        const inp = item.input;
        if (EDIT_TOOLS.has(item.name)) {
          const p = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
          if (typeof p === 'string' && p !== '') out.push({ token: p, tag: 'edited' });
        } else if (item.name === 'Read') {
          if (typeof inp.file_path === 'string' && inp.file_path !== '') out.push({ token: inp.file_path, tag: 'touched' });
        } else if (item.name === 'Bash' && re && typeof inp.command === 'string') {
          for (const m of inp.command.matchAll(re)) out.push({ token: m[0], tag: 'touched' });
        }
      }
    } else if (o.isCompactSummary === true && msg && re) {
      for (const m of textOf(msg.content).matchAll(re)) out.push({ token: m[0], tag: 'carried' });
    }
  }
  return out;
}

// ── RESOLUTION (spec §3.2) ───────────────────────────────────────────────
/** The graph's `source_file` set, indexed by basename. A suffix match can
 *  only ever hit a file with the token's own basename, so the candidates for
 *  a token are one Map lookup — O(tokens) for the whole window, never a scan
 *  of every file per token (the review measured that scan at 2–12 s on a
 *  64 MiB window against a 5,000-file graph). */
export function fileIndex(files) {
  const set = new Set(files);
  const byBase = new Map();
  for (const f of set) {
    const b = basename(f);
    const list = byBase.get(b);
    if (list) list.push(f); else byBase.set(b, [f]);
  }
  return { files: set, byBase };
}

/** One token against the index: strip a leading `<cwd>/` or `./`; exact
 *  match first; else a suffix match on a path-segment boundary that is UNIQUE
 *  in the set. Two or more → `ambiguous`; an absolute path outside `<cwd>` →
 *  `outside`; none → `nomatch`. */
export function resolveToken(token, index, cwd) {
  let t = token;
  if (cwd && (t === cwd || t.startsWith(cwd + '/'))) t = t.slice(cwd.length + 1);
  if (t.startsWith('/')) return { reason: 'outside' };
  while (t.startsWith('./')) t = t.slice(2);
  if (t === '') return { reason: 'nomatch' };
  if (index.files.has(t)) return { path: t };
  const suffix = '/' + t;
  const hits = (index.byBase.get(basename(t)) ?? []).filter((f) => f.endsWith(suffix));
  if (hits.length === 1) return { path: hits[0] };
  return { reason: hits.length > 1 ? 'ambiguous' : 'nomatch' };
}

/** The working set: every resolved file, the strongest tag it earned, its
 *  occurrence count; ranked edited > touched > carried, then count, then
 *  path; capped. `stats` is what tells a thin card from a thin session. A
 *  token whose tag is not in `TAGS` is ignored — counted nowhere, no entry,
 *  never upgrades or corrupts one that already exists — rather than let an
 *  out-of-vocabulary tag reach the rank lookup, where it would be `undefined`
 *  and the comparator would return `NaN`. */
export function workingSet(tokens, index, cwd, cap = WORKSET_CAP) {
  const stats = { tokens: tokens.length, resolved: 0, ambiguous: 0, outside: 0, nomatch: 0 };
  const acc = new Map();
  for (const { token, tag } of tokens) {
    if (!TAG_SET.has(tag)) continue;
    const r = resolveToken(token, index, cwd);
    if (!r.path) { stats[r.reason]++; continue; }
    stats.resolved++;
    const cur = acc.get(r.path);
    if (!cur) acc.set(r.path, { path: r.path, tag, count: 1 });
    else { cur.count++; if (TAG_RANK[tag] < TAG_RANK[cur.tag]) cur.tag = tag; }
  }
  const ranked = [...acc.values()].sort((a, b) =>
    TAG_RANK[a.tag] - TAG_RANK[b.tag] || b.count - a.count || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: ranked.slice(0, cap), stats };
}

// ── THE GRAPH (spec §3.2) ────────────────────────────────────────────────
/** graph.json is networkx node-link JSON (measured on this repo's 0.9.9
 *  graph: 8,914 nodes, 17,452 links, 13 relations): `nodes[]` carry `id`,
 *  `label`, `source_file`, `source_location` (`L<n>`), `community`; the edges
 *  are under `links[]` as `{source, target, relation, …}`. `built_at_commit`
 *  is the LAST key — a duplicate at the head is the decoy `plantGraph` plants
 *  for the hook's tail read, and JSON.parse takes the last. Parsed ONCE per
 *  run: 0.13–0.18 s at 9 MB, measured. */
/** A graph.json larger than this is not parsed: node's peak RSS runs about
 *  five times the file (measured 249 MB at 51 MB), on a box that runs ~20
 *  sessions under a memory.high cgroup. The 70 MB MekWarLive graph passes. */
export const GRAPH_MAX_BYTES = 96 * 1024 * 1024;

/** Reads no more than `maxBytes + 1` from an already-open graph descriptor.
 * The extra byte turns descriptor-local growth into an overflow rather than an
 * unbounded parse. `read` is injected only to make that invariant diagnosable. */
export function readBoundedDescriptor(fd, maxBytes, read = readSync) {
  const size = fstatSync(fd).size;
  if (size > maxBytes) throw new Error(`graph.json: too large (${size} bytes over ${maxBytes})`);
  const chunks = [];
  let total = 0, position = 0;
  while (total <= maxBytes) {
    const buf = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
    const count = read(fd, buf, 0, buf.length, position);
    if (count === 0) break;
    chunks.push(buf.subarray(0, count));
    total += count;
    position += count;
  }
  if (total > maxBytes) throw new Error(`graph.json: too large (${total} bytes over ${maxBytes})`);
  return Buffer.concat(chunks, total).toString('utf8');
}

export function loadGraph(graphPath, maxBytes = GRAPH_MAX_BYTES) {
  const fd = openSync(graphPath, 'r');
  let text;
  try {
    text = readBoundedDescriptor(fd, maxBytes);
  } finally {
    closeSync(fd);
  }
  const g = JSON.parse(text);
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.links)) throw new Error('graph.json: no nodes/links arrays');
  const nodes = new Map(), byFile = new Map(), files = new Set(), degree = new Map();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.source_file !== 'string') continue;
    nodes.set(n.id, n);
    files.add(n.source_file);
    const list = byFile.get(n.source_file);
    if (list) list.push(n); else byFile.set(n.source_file, [n]);
    degree.set(n.id, 0);
  }
  const links = [];
  for (const l of g.links) {
    if (!l || typeof l.source !== 'string' || typeof l.target !== 'string') continue;
    links.push(l);
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  return { nodes, byFile, files, index: fileIndex(files), links, degree };
}

/** `.graphify_labels.json` is `{"<community>": "<label>"}`. Absent or
 *  malformed → `{}`: every community clause is then omitted, which is what
 *  the spec says for a file "absent from it". */
export function loadLabels(labelsPath) {
  try {
    const o = JSON.parse(readFileSync(labelsPath, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** The link relations that mean "depends on" (spec §3.2 `used by`). */
const DEPENDS = new Set(['imports', 'imports_from', 'calls', 'references', 'indirect_call']);
const lineOf = (n) => { const m = /^L(\d+)$/.exec(String(n.source_location ?? '')); return m ? m[1] : null; };
const isFileNode = (n) => n.metadata && n.metadata.kind === 'file';

/** One file's facts: the community label of its file node; its top five
 *  symbols by total degree, as `label:L<line>`; the files OUTSIDE the working
 *  set that carry a depends-on link INTO any of its nodes, by link count then
 *  path. A dependent that is in the working set is not "outside". */
export function fileFacts(file, graph, labels, workset) {
  const nodes = graph.byFile.get(file) ?? [];
  const deg = (n) => graph.degree.get(n.id) ?? 0;
  const byDegree = (a, b) => deg(b) - deg(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const fileNode = nodes.find(isFileNode) ?? [...nodes].sort(byDegree)[0] ?? null;
  const community = fileNode && fileNode.community !== undefined ? labels[String(fileNode.community)] : undefined;
  const symbols = nodes.filter((n) => n !== fileNode).sort(byDegree).slice(0, 5)
    .map((n) => { const l = lineOf(n); return l ? `${n.label}:L${l}` : String(n.label); });
  const ids = new Set(nodes.map((n) => n.id));
  const dependents = new Map();
  for (const l of graph.links) {
    if (!DEPENDS.has(l.relation) || !ids.has(l.target)) continue;
    const src = graph.nodes.get(l.source);
    if (!src || src.source_file === file || workset.has(src.source_file)) continue;
    dependents.set(src.source_file, (dependents.get(src.source_file) ?? 0) + 1);
  }
  const usedBy = [...dependents.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[0]);
  return { community: typeof community === 'string' ? community : null, symbols, usedBy };
}

const FOOTER = 'Re-derive any node with `graphify explain "<symbol>"`; cite path:symbol:line rather than re-reading whole files.';

/** The card (spec §3.2): file-centric, one line per carded file, terse, no
 *  tables. Truncation drops WHOLE files from the bottom until the text fits,
 *  then collapses `used by` lists to their `(+n)`, never mid-line, and ALWAYS
 *  prints `(+k files not shown)` when anything was dropped — a short card must
 *  never read as a small working set (the prototype's `(not in graph)` meant
 *  both; this repo calls that an overloaded null). */
export function renderCard(set, graph, labels, opts) {
  const workset = new Set(set.files.map((f) => f.path));
  const facts = new Map(set.files.map((f) => [f.path, fileFacts(f.path, graph, labels, workset)]));
  const blast = new Set();
  for (const f of facts.values()) for (const d of f.usedBy) blast.add(d);
  const built = (opts.built || '').slice(0, 8) || 'unknown';
  const who = opts.scope === 'subagent' ? ` (subagent ${opts.agent ?? 'unknown'})` : '';
  const header = `graphify card — this context's working set at compaction${who}, from graphify-out/ (built at ${built}${opts.fresh ? ', ' + opts.fresh : ''}):`;
  const row = (f, collapsed) => {
    const x = facts.get(f.path);
    let s = `- ${f.path} [${f.tag}]`;
    if (x.community) s += ` · community "${x.community}"`;
    if (x.symbols.length) s += ` · symbols ${x.symbols.join(' ')}`;
    if (x.usedBy.length) {
      if (collapsed) s += ` · used by (+${x.usedBy.length})`;
      else {
        const shown = x.usedBy.slice(0, 3), rest = x.usedBy.length - shown.length;
        s += ` · used by ${shown.join(' ')}${rest > 0 ? ` (+${rest})` : ''}`;
      }
    }
    return s;
  };
  const assemble = (n, collapsed) => {
    const shown = set.files.slice(0, n);
    const lines = [header, ...shown.map((f) => row(f, collapsed))];
    const hidden = set.files.length - shown.length;
    if (hidden > 0) lines.push(`(+${hidden} files not shown)`);
    lines.push(`Blast radius: ${blast.size} ${blast.size === 1 ? 'file imports or calls' : 'files import or call'} something in these ${set.files.length} files.`);
    lines.push(FOOTER);
    return lines.join('\n');
  };
  let n = Math.min(opts.maxFiles, set.files.length);
  let text = assemble(n, false);
  while (text.length > opts.maxChars && n > 1) { n--; text = assemble(n, false); }
  if (text.length > opts.maxChars) {
    text = assemble(n, true);
    while (text.length > opts.maxChars && n > 0) { text = assemble(--n, true); }
  }
  return text;
}

// ── THE TWO STAGE FILES (spec §3.4, "helper stage set/card") ─────────────
/** `<stage>.part`, then rename onto `<stage>`: A STAGE EXISTS IFF IT IS
 *  COMPLETE, which is the property the hook's reacquired-lock rename depends
 *  on — it renames a stage onto canonical without reading it, so a half-written
 *  stage would publish a truncated canonical artifact.
 *
 *  The temp carries NO helper pid: `<stage>` already carries the HOOK's pid and
 *  the nonce, so the name is already private to one compaction and a second
 *  component would only make the exact-family grammar wider. Every target this
 *  function can receive is a stage path the hook NAMED — no canonical pathname
 *  reaches this process's argv at all (round 7, option A), which is why these
 *  two primitives are excluded from the canonical-write scan by its filter
 *  rather than by an allow-list entry. */
function writeAtomic(target, text) {
  const tmp = `${target}.part`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to remove */ }
    throw e;
  }
}

/** `card`: window → tokens → the two PRIVATE STAGE FILES. Round 7's option A:
 *  no canonical pathname appears in this process's argv at all, so the helper
 *  cannot open, read, rename or roll back a canonical artifact, and every
 *  ownership decision and canonical publication belongs to the bash arm, under
 *  a lock it reacquires. That is why there is no slot check here any more: the
 *  old one was a CHECK whose ACT was a separate canonical write — check-then-act,
 *  never a compare-and-swap — so a sibling could publish between the two and
 *  have its verdict destroyed by this process's later write.
 *
 *  Key ORDER in the set is part of the contract: `at`, `nonce` and `transcript`
 *  sit in the first 4 KiB, where the hook re-reads them with a bounded,
 *  fork-free `read -N` (spec §3.3 step 2, and the reconfirm at protocol step
 *  12 — that head parse IS the ownership check now).
 *
 *  `parentLive` and `liveAgents` are COPIED VERBATIM from the hook's own
 *  already-computed §3.0 values, which now arrive as flags: with `--set` gone
 *  the helper has no other channel to learn them, and deriving them from
 *  `scope` would be a different measurement wearing the same name. "Verbatim"
 *  constrains the VALUE, not the spelling — the wire carries strings and the
 *  set carries a JSON boolean/integer or null, so `main` converts
 *  exhaustively before calling here. `steered` is always false; in Plan A the
 *  hook publishes that staged value unchanged. `served` is NOT written at all
 *  any more (D-2605: the canonical set is never rewritten, and `served` is
 *  marker-derived at measure time). */
export function cardCommand(o) {
  const graph = loadGraph(o.graph);
  const labels = loadLabels(o.labels);
  const win = readWindow(o.transcript);
  const re = tokenRegex(extensionsOf(graph.files));
  const tokens = mineTokens(win.text, re);
  const { files, stats } = workingSet(tokens, graph.index, o.cwd);
  const set = { v: 1, at: o.at, nonce: o.nonce, scope: o.scope, agent: o.agent ?? null, transcript: o.transcript,
    parentLive: o.parentLive, liveAgents: o.liveAgents,
    cwd: o.cwd, built: o.built || null, fresh: o.fresh || null, steered: false, files, stats };
  // Rendering is intentionally complete before the helper first names a target.
  const card = files.length === 0 ? null : `${o.nonce}\n${renderCard(set, graph, labels, {
    maxChars: o.maxChars, maxFiles: o.maxFiles, built: o.built, fresh: o.fresh,
    scope: o.scope, agent: o.agent ?? null })}\n`;
  const write = o.writeAtomic ?? writeAtomic;
  write(o.setStage, JSON.stringify(set) + '\n');
  if (card === null) return EXIT.EMPTY;
  write(o.cardStage, card);
  return EXIT.OK;
}

// ── MEASURE (spec §3.4) ──────────────────────────────────────────────────
/** Mirrors what the harness does to `compact_summary` before injecting it
 *  (2.1.266, measured): drop the FIRST <analysis> block (non-greedy, no
 *  global flag); REPLACE <summary>X</summary> with a `Summary:` line and
 *  X.trim() — replace, not unwrap, because the session sees that line and
 *  `chars` must count what the session sees; collapse runs of blank lines to
 *  one; trim. */
export function normalizeSummary(raw) {
  let t = String(raw);
  t = t.replace(/<analysis>[\s\S]*?<\/analysis>/, '');
  t = t.replace(/<summary>([\s\S]*?)<\/summary>/, (_m, inner) => `Summary:\n${inner.trim()}`);
  t = t.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
  return t.trim();
}

/** A numbered heading as the corpus spells them: optional `#`s, optional
 *  `**`, `<n>.`, a title, an optional colon, optional closing `**`. */
const HEADING_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?[ \t]*\d+\.[ \t]+([^\n]*?)[ \t]*:?[ \t]*(?:\*\*)?[ \t]*$/gm;

/** Markdown backtick fences begin at a line start with at most three spaces.
 *  An opener may carry an info string; a close must be at least as wide as its
 *  opener and otherwise whitespace, so only the opener accepts trailing text.
 *  This preserves both Markdown's grammar and the line scanner's linear pass. */
const FENCE_OPEN_RE = /^(?: {0,3})(\x60{3,})/;
const FENCE_CLOSE_RE = /^(?: {0,3})(\x60{3,})[ \t\r]*$/;

/** JS string-offset ranges covered by Markdown fenced code blocks. The line
 *  scanner visits each line once; an unmatched opener covers EOF. A numbered-
 *  looking line inside one range is code content, not document structure. */
function fencedRanges(text) {
  const ranges = [];
  let start = -1, width = 0, closed = 0, lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    if (start < 0) {
      const open = FENCE_OPEN_RE.exec(line);
      if (open) { start = lineStart; width = open[1].length; }
    } else {
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1].length >= width) {
        ranges.push([start, nl < 0 ? lineEnd : nl + 1]);
        start = -1;
        width = 0;
        closed++;
      }
    }
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  if (start >= 0) ranges.push([start, text.length]);
  return { ranges, closed };
}

/** Chars from the "Files and Code Sections" heading to the next numbered
 *  heading (or EOF); null when the summary has no such heading — 19% of the
 *  corpus is not in the nine-section format, and null is what keeps this
 *  field honest. A numbered-looking line inside a Markdown fenced region is
 *  skipped entirely — never a section start, never the terminating heading
 *  — since the corpus routinely quotes fenced numbered lists inside this
 *  very section (D-2553). */
export function filesSectionChars(text) {
  const { ranges } = fencedRanges(text);
  let fence = 0;
  let start = -1;
  for (const m of text.matchAll(HEADING_RE)) {
    // Heading matches arrive in source order, so advance rather than re-scan
    // every fenced range for each heading.
    while (fence < ranges.length && m.index >= ranges[fence][1]) fence++;
    if (fence < ranges.length && m.index >= ranges[fence][0]) continue;
    if (start < 0) { if (/^files and code sections$/i.test(m[1])) start = m.index; }
    else return m.index - start;
  }
  return start < 0 ? null : text.length - start;
}

/** A path-continuation character: the same alphabet `tokenRegex` mines with.
 *  Full paths need non-path characters on both sides; unique suffixes use a
 *  segment-aligned left boundary but keep the same strict right boundary. */
const PATH_CHAR = /[A-Za-z0-9_./-]/;

function hasFullPathOccurrence(text, p) {
  let i = text.indexOf(p);
  while (i >= 0) {
    const end = i + p.length;
    if ((i === 0 || !PATH_CHAR.test(text[i - 1])) && (end === text.length || !PATH_CHAR.test(text[end]))) return true;
    i = text.indexOf(p, i + 1);
  }
  return false;
}

function hasUniqueSuffixOccurrence(text, suffix) {
  let i = text.indexOf(suffix);
  while (i >= 0) {
    const end = i + suffix.length;
    // A suffix begins at a segment boundary: `/` is allowed here even though
    // it is a path character. A full path deliberately does not share this.
    if ((i === 0 || text[i - 1] === '/' || !PATH_CHAR.test(text[i - 1])) &&
        (end === text.length || !PATH_CHAR.test(text[end]))) return true;
    i = text.indexOf(suffix, i + 1);
  }
  return false;
}

/** Working-set files the summary names: the repo-relative path, or a
 *  path-segment-aligned suffix of it of at least two segments that is unique
 *  WITHIN THE SET. Computed from the set alone; no graph needed. */
export function citedCount(text, paths) {
  let n = 0;
  for (const p of paths) {
    if (hasFullPathOccurrence(text, p)) { n++; continue; }
    const segs = p.split('/');
    let hit = false;
    for (let k = 2; k < segs.length && !hit; k++) {
      const suffix = segs.slice(-k).join('/');
      const unique = paths.filter((q) => q === suffix || q.endsWith('/' + suffix)).length === 1;
      if (unique && hasUniqueSuffixOccurrence(text, suffix)) hit = true;
    }
    if (hit) n++;
  }
  return n;
}

const SCOPES = new Set(['main', 'subagent', 'ambiguous']);

/** The helper measurement object Task 9 enriches into the sole journal record.
 *  null — never 0, never "main" — wherever the set could not say: no set,
 *  or a set with `files: null`. No ordinal is persisted. */
export function measureCommand(raw, set, trigger) {
  const text = normalizeSummary(raw);
  // A malformed individual `files[]` entry means the working-set denominator
  // is unknown. Do not filter it into a smaller valid set: that would publish
  // a misleading citation rate. A valid `files: []` remains a known zero.
  const entries = set && Array.isArray(set.files) ? Array.from(set.files) : null;
  const paths = entries && entries.every((f) =>
    f && typeof f.path === 'string' && f.path.length > 0)
    ? entries.map((f) => f.path)
    : null;
  const { closed: fences } = fencedRanges(text);
  return {
    at: Date.now(),
    trigger,
    scope: set && SCOPES.has(set.scope) ? set.scope : null,
    chars: text.length,
    filesChars: filesSectionChars(text),
    fences,
    cited: paths ? citedCount(text, paths) : null,
    setSize: paths ? paths.length : null,
    steered: set ? set.steered === true : false,
    served: set ? set.served === true : false,
  };
}

/** The set for `measure`: absent, unreadable, or JSON that does not parse to
 *  a plain object all read here as NO SET (spec §3.4). Individual `files[]`
 *  entries remain in the returned set for `measureCommand`, which treats the
 *  whole set-derived denominator as unknown when any entry is malformed; it
 *  never filters a bad entry into a smaller apparently complete set. */
export function readSetForMeasure(setPath) {
  if (!setPath) return null;
  try {
    const o = JSON.parse(readFileSync(setPath, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
/** `--kebab-flag value` pairs into camelCase keys; `--steer` alone is a
 *  boolean; anything else is a usage error the caller reports. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--steer') { opts.steer = true; continue; }
    if (!a.startsWith('--')) return { error: `unexpected argument ${a}` };
    const v = rest[i + 1];
    if (v === undefined) return { error: `${a} needs a value` };
    i++;
    opts[a.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] = v;
  }
  return { cmd, opts };
}

/** ORDER IS BEHAVIOUR: `main`'s loop returns on the FIRST missing key, so the
 *  message a caller gets names the first gap in THIS order, and `nonce` stays
 *  last so a test that drops only `--nonce` still reaches the nonce message.
 *  `out`/`set` are gone (no canonical pathname reaches this process);
 *  `setStage`/`cardStage` are the two private paths the hook names, and
 *  `parentLive`/`liveAgents` are the provenance channel `--set` used to carry.
 *  `trigger` is NOT here and must not be: the record's trigger comes from the
 *  PostCompact payload at `measure` time, never from a PreCompact flag. */
const REQUIRED_CARD = ['transcript', 'cwd', 'graph', 'labels', 'setStage', 'cardStage', 'parentLive', 'liveAgents',
  'maxChars', 'maxFiles', 'built', 'fresh', 'scope', 'at', 'nonce'];

function usage(msg) {
  process.stderr.write(`compact-card: ${msg}\n`);
  return EXIT.USAGE;
}

export function main(argv) {
  const p = parseArgs(argv);
  if (p.error) return usage(p.error);
  if (!p.cmd) return usage('no subcommand (card | measure)');
  const o = p.opts;
  try {
    if (p.cmd === 'card') {
      for (const k of REQUIRED_CARD) if (!(k in o)) return usage(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required`);
      if (o.scope !== 'main' && o.scope !== 'subagent') return usage('--scope must be main or subagent');
      const maxChars = Number(o.maxChars), maxFiles = Number(o.maxFiles), at = Number(o.at);
      if (!Number.isInteger(maxChars) || maxChars <= 0) return usage('--max-chars must be a positive integer');
      if (!Number.isInteger(maxFiles) || maxFiles <= 0) return usage('--max-files must be a positive integer');
      if (!Number.isInteger(at) || at <= 0) return usage('--at must be epoch milliseconds');
      if (typeof o.nonce !== 'string' || o.nonce === '') return usage('--nonce must be a nonempty string');
      // THE TWO PROVENANCE FLAGS, CONVERTED EXHAUSTIVELY — empty means JSON
      // `null`, which is the hook's own measured encoding: `_hook_compact_scope`
      // leaves `CS_PARENT_LIVE=""`/`CS_LIVE_N=""` and returns on a manual
      // trigger, and the hook's own initial-set `jq` already decodes `""` as
      // null on both fields.
      //
      // `Number(v)` IS THE TRAP HERE, and this file's own established idiom two
      // lines above (`const maxChars = Number(o.maxChars), …`) is what makes it
      // the likely mistake: measured, `Number('') === 0` and
      // `Number.isInteger(Number('')) === true`, so `Number(o.liveAgents)`
      // publishes `liveAgents: 0` for every MANUAL compaction whose true value
      // is null — a tuple §3.0's matrix does not contain, which
      // `JOURNAL_RECORD_PRED` rejects, so no journal line commits at all on the
      // dominant population. `REQUIRED_CARD`'s `k in o` presence test is
      // satisfied by an empty string and cannot catch it either. The regex is
      // tested BEFORE any numeric conversion, so no conversion ever sees ''.
      if (o.parentLive !== '' && o.parentLive !== 'true' && o.parentLive !== 'false') return usage('--parent-live must be true, false or empty');
      if (o.liveAgents !== '' && !/^[0-9]+$/.test(String(o.liveAgents))) return usage('--live-agents must be a non-negative integer or empty');
      const parentLive = o.parentLive === '' ? null : o.parentLive === 'true';
      const liveAgents = o.liveAgents === '' ? null : Number(o.liveAgents);
      return cardCommand({ transcript: o.transcript, cwd: o.cwd, graph: o.graph, labels: o.labels,
        setStage: o.setStage, cardStage: o.cardStage, parentLive, liveAgents,
        maxChars, maxFiles, built: o.built, fresh: o.fresh,
        scope: o.scope, agent: o.agent ?? null, at, nonce: o.nonce });
    }
    if (p.cmd === 'measure') {
      if (o.trigger !== 'auto' && o.trigger !== 'manual') return usage('--trigger must be auto or manual');
      const raw = readFileSync(0, 'utf8');
      const set = readSetForMeasure(o.set);
      process.stdout.write(JSON.stringify(measureCommand(raw, set, o.trigger)) + '\n');
      return EXIT.OK;
    }
    return usage(`unknown subcommand ${p.cmd}`);
  } catch (e) {
    process.stderr.write(`compact-card: ${e && e.message ? e.message : String(e)}\n`);
    return EXIT.FAILURE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
