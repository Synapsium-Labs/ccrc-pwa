#!/usr/bin/env node
// ccd/compact-card.mjs — the compaction card's helper. `card` mines a
// transcript window for the files a context was working in, resolves them
// against graphify's graph.json and renders a structural card; `measure`
// scores a compaction summary against that working set.
//
// Spec: docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md
// (§3.2 `card`, §3.4 `measure`). Invoked ONLY by ccd/session-hook.sh, under
// `timeout`, on PreCompact and PostCompact; installed beside the hook as
// ~/.cc-sessions/compact-card.mjs by deploy.sh's agent lane and `ccrc install`.
//
// Plain node, `node:*` imports only — the `shared/mark.mjs` class: a
// deploy-side script the PWA never bundles, importable by vitest directly
// (types in the hand-written `compact-card.d.mts` beside it). Reads only the
// files it is given; writes only `--out` and `--set`, each through a
// dot-prefixed temp name and a rename — the hook's own idiom.
//
// Exit codes (spec §3.2): 0 written; 3 empty working set (the set is written
// with `files: []`, no card); 2 usage; 1 any failure. `card` prints nothing on
// stdout; `measure` prints exactly one JSON object. Every failure names itself
// on stderr, which the hook discards — the hook's contract is silence.
import { openSync, readSync, closeSync, fstatSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
    if (pos > 0 || buf.length > cap) {
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

export function loadGraph(graphPath, maxBytes = GRAPH_MAX_BYTES) {
  const size = statSync(graphPath).size;
  if (size > maxBytes) throw new Error(`graph.json: too large (${size} bytes over ${maxBytes})`);
  const g = JSON.parse(readFileSync(graphPath, 'utf8'));
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
const isFileNode = (n, file) =>
  (n.metadata && n.metadata.kind === 'file') || (n.source_location === 'L1' && n.label === basename(file));

/** One file's facts: the community label of its file node; its top five
 *  symbols by total degree, as `label:L<line>`; the files OUTSIDE the working
 *  set that carry a depends-on link INTO any of its nodes, by link count then
 *  path. A dependent that is in the working set is not "outside". */
export function fileFacts(file, graph, labels, workset) {
  const nodes = graph.byFile.get(file) ?? [];
  const deg = (n) => graph.degree.get(n.id) ?? 0;
  const byDegree = (a, b) => deg(b) - deg(a) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const fileNode = nodes.find((n) => isFileNode(n, file)) ?? [...nodes].sort(byDegree)[0] ?? null;
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
  if (text.length > opts.maxChars) text = assemble(n, true);
  return text;
}

// ── THE TWO FILES ────────────────────────────────────────────────────────
/** Dot-prefixed temp beside the target, then rename: the hook's own idiom.
 *  Nothing partial is ever left at the target's name. */
function writeAtomic(target, text) {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to remove */ }
    throw e;
  }
}

/** THE SLOT CHECK (spec §3.0, overlap). The hook wrote the set before
 *  running this helper; if the set on disk no longer carries this helper's
 *  `at`, an overlapping PreCompact has taken the slot and marked it
 *  ambiguous — this helper must not overwrite that verdict. Re-read
 *  immediately before EACH write; what remains is the interval between the
 *  read and the rename. Returns the set when it is ours (its fields are
 *  carried into the rewrite), else null. */
export function slotIsMine(setPath, at) {
  try {
    const cur = JSON.parse(readFileSync(setPath, 'utf8'));
    return cur && typeof cur === 'object' && cur.at === at ? cur : null;
  } catch {
    return null;
  }
}

/** `card`: window → tokens → working set → set file (always) → card (when
 *  the set is non-empty). Key ORDER in the set is part of the contract: `at`
 *  and `transcript` sit in the first 4 KiB, where the hook reads them with a
 *  bounded, fork-free `read -N` (spec §3.3 step 2). `at` is the hook's nonce
 *  — never Date.now() here — and it is ALSO the card's first line, which is
 *  what pairs a card to its set. `parentLive`, `liveAgents` and `served` are
 *  the hook's and are CARRIED; `steered` is always false here — the hook
 *  stamps it after the print (Plan C), never the helper. A refused slot
 *  throws, which `main` reports as exit 1 with nothing written. */
export function cardCommand(o) {
  const graph = loadGraph(o.graph);
  const labels = loadLabels(o.labels);
  const win = readWindow(o.transcript);
  const re = tokenRegex(extensionsOf(graph.files));
  const tokens = mineTokens(win.text, re);
  const { files, stats } = workingSet(tokens, graph.index, o.cwd);
  const mine = slotIsMine(o.set, o.at);
  if (!mine) throw new Error(`set at ${o.set} is no longer this helper's slot`);
  const set = { v: 1, at: o.at, scope: o.scope, agent: o.agent ?? null, transcript: o.transcript,
    parentLive: typeof mine.parentLive === 'boolean' ? mine.parentLive : null,
    liveAgents: Number.isInteger(mine.liveAgents) ? mine.liveAgents : null,
    cwd: o.cwd, built: o.built || null, fresh: o.fresh || null, steered: false, served: mine.served === true, files, stats };
  writeAtomic(o.set, JSON.stringify(set) + '\n');
  if (files.length === 0) return EXIT.EMPTY;
  const text = renderCard(set, graph, labels, { maxChars: o.maxChars, maxFiles: o.maxFiles,
    built: o.built, fresh: o.fresh, scope: o.scope, agent: o.agent ?? null });
  if (!slotIsMine(o.set, o.at)) throw new Error(`set at ${o.set} changed hands before the card was written — slot taken`);
  writeAtomic(o.out, `${o.at}\n${text}\n`);
  return EXIT.OK;
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

const REQUIRED_CARD = ['transcript', 'cwd', 'graph', 'labels', 'out', 'set', 'maxChars', 'maxFiles', 'built', 'fresh', 'scope', 'at'];

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
      if (!Number.isInteger(at) || at <= 0) return usage('--at must be the set\'s epoch-ms nonce');
      return cardCommand({ transcript: o.transcript, cwd: o.cwd, graph: o.graph, labels: o.labels,
        out: o.out, set: o.set, maxChars, maxFiles, built: o.built, fresh: o.fresh,
        scope: o.scope, agent: o.agent ?? null, at });
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
