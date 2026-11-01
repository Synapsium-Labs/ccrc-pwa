// Graphify revision 2, Task GR1 (D-7347): the consumer censuses, measured on
// today's code BEFORE any task of the wave moves a line. Four censuses, each a
// pure function over a map of tracked text so the mutation rows below can feed
// it a mutated copy, and each pinned to the literal harvested on the base:
//
//   censusReaders()     who names the sweep's census and how often they read its
//                       per-tree rows (`.trees` / `trees[]` / `trees:`);
//   treeWriteSites()    every command of ccd/ccd-graph-sweep that writes or
//                       removes under a tree, by enclosing function;
//   engineCalls()       every invocation of the engine in ccd/;
//   graphPathReaders()  every ccd/ line that reads a graphify-out/ member.
//
// Later tasks of the wave only LOWER these rows (GR4: the sweep's engine call
// and its in-tree writes; GR4, GR5, GR7: the `trees[]` readers), and each such
// change is a counted exit of that task, made here in the same PR.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
/** This file names every spelling it counts; it is never its own consumer. */
const SELF = 'server/test/graph-r2-consumers.test.ts';
const SWEEP = 'ccd/ccd-graph-sweep';

/** Every tracked (or new, not ignored) text file, by repo-relative path. */
const trackedText = (): Map<string, string> => {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0')
    .filter((f) => f !== '' && f !== SELF);
  const files = new Map<string, string>();
  for (const f of listed) {
    let text: string;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }   // deleted, not yet staged
    if (text.includes('\0')) continue;                                              // binary
    files.set(f, text);
  }
  return files;
};

// ── censusReaders ─────────────────────────────────────────────────────────
// A reader is a file outside docs/ (plans and specs describe the census; they
// do not read it) that NAMES `graph-sweep.json`. Its row count is every
// spelling of the census's per-tree array: `.trees` (a jq path or a JS
// member), `trees[` (a jq iterator or an index) and `trees:` (the writer's jq
// object key and the fixtures' literal passes).
const NAMES_CENSUS = /graph-sweep\.json/g;
const TREES_READ = /\.trees\b|\btrees\s*[[:]/g;
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

interface ReaderRow { file: string; names: number; trees: number }
const censusReaders = (files: Map<string, string>): ReaderRow[] => {
  const rows: ReaderRow[] = [];
  for (const [file, text] of files) {
    if (file.startsWith('docs/')) continue;
    const names = count(text, NAMES_CENSUS);
    if (names === 0) continue;
    rows.push({ file, names, trees: count(text, TREES_READ) });
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file));
};

/** THE trees[] ROW — MAY ONLY SHRINK. The base measurement (plan item 11), one
 *  ceiling per file. GR4, GR5 and GR7 lower these numbers as they re-point
 *  their readers to the repository rows; the last of them sets every one to 0,
 *  empties this object, and the row then reads "absent everywhere" (the test
 *  below asserts no file reads `trees` at all once this is `{}`). */
const TREES_CEILING: Record<string, number> = {
  // GR4 (D-7350): the sweep writes repos[] and no per-tree array (1 -> 0, so it moved to NAMES_ONLY), and the per-tree
  // sweep's test file is gone (22 -> 0); session-hook.test.ts's sweep-writer fixture reads the repository rows now
  // (2 -> 1: its hand-written old-shape pass, which the hook still reads, stays).
  'ccd/session-hook.sh': 1,
  'ccd/ccrc-doctor-checks': 5,
  'server/test/ccrc-doctor-graphify.test.ts': 12,
  'server/test/session-hook.test.ts': 1,
  'server/test/ccrc-doctorFixture.ts': 1,
};
/** Files that name the census and read no per-tree row: documentation of the
 *  path (README), GR1's hook pins (their census fixture is written by the
 *  sweep's own writer), GR5's linked-tree rows (their census rows are the
 *  repository rows), the vocabulary scan that names it, the lifecycle
 *  row that declares it, and the lifecycle test that pins that row's root. A new consumer of the census is added to one of the two
 *  lists in the PR that adds it, so a reviewer sees it. */
const NAMES_ONLY = [
  'ccd/ccd-graph-sweep',                            // the writer (GR4: repos[] only)
  'README.md',
  'server/test/graph-repo-sweep.test.ts',           // GR4's rows read repos[]
  'server/test/lifecycle.test.ts',                  // pins the census row's root
  'server/test/session-hook-graph-pins.test.ts',
  'server/test/session-hook-graph-repo.test.ts',
  'server/test/single-definition/vocabularies.test.ts',
  'shared/lifecycle.ts',
];

/** The violations of the may-only-shrink row, as sentences a red can print. */
const treesViolations = (rows: ReaderRow[]): string[] => {
  const bad: string[] = [];
  for (const r of rows) {
    if (r.trees === 0) continue;
    const ceiling = TREES_CEILING[r.file];
    if (ceiling === undefined) bad.push(`${r.file}: reads trees[] ${r.trees} time(s) and is not a known reader`);
    else if (r.trees > ceiling) bad.push(`${r.file}: reads trees[] ${r.trees} time(s), ceiling ${ceiling}`);
  }
  return bad;
};

describe('censusReaders: who reads the sweep census, and its trees[] rows (D-7347)', () => {
  const rows = censusReaders(trackedText());

  it('the trees[] row may only shrink: no file over its ceiling, no new reader', () => {
    expect(treesViolations(rows)).toEqual([]);
    if (Object.keys(TREES_CEILING).length === 0) {
      expect(rows.filter((r) => r.trees > 0), 'trees[] is absent everywhere once the ceiling is empty').toEqual([]);
    }
  });

  it('every file that names the census is a listed consumer', () => {
    const listed = new Set([...Object.keys(TREES_CEILING), ...NAMES_ONLY]);
    expect(rows.map((r) => r.file).filter((f) => !listed.has(f)), 'a new consumer of graph-sweep.json').toEqual([]);
    expect(rows.filter((r) => r.trees === 0).map((r) => r.file)).toEqual(NAMES_ONLY);
  });

  it('calibration: the counter sees each spelling, and a mutated reader goes red', () => {
    const probe = new Map([['ccd/probe', 'jq ".passes[-1].trees[]" ~/.ccrc/graph-sweep.json; x = {trees: []}; p.trees.find()\n']]);
    expect(censusReaders(probe)).toEqual([{ file: 'ccd/probe', names: 1, trees: 3 }]);
    // the GR1 Step 2 mutation, as a row: one more trees[] read in the doctor
    // is counted, and a count over a ceiling (or a reader with none) is a red
    const files = trackedText();
    const doctor = 'ccd/ccrc-doctor-checks';
    const before = censusReaders(files).find((r) => r.file === doctor)?.trees ?? 0;
    files.set(doctor, `${files.get(doctor)!}\njq '[.passes[-1].trees[]?] | length' "$HOME/.ccrc/graph-sweep.json"\n`);
    expect(censusReaders(files).find((r) => r.file === doctor)!.trees).toBe(before + 1);
    const over = (TREES_CEILING[doctor] ?? 0) + 1;
    expect(treesViolations([{ file: doctor, names: 1, trees: over }])).toEqual([
      doctor in TREES_CEILING
        ? `${doctor}: reads trees[] ${over} time(s), ceiling ${TREES_CEILING[doctor]}`
        : `${doctor}: reads trees[] ${over} time(s) and is not a known reader`]);
    // …and a docs/ mention is not a reader
    expect(censusReaders(new Map([['docs/x.md', 'graph-sweep.json .trees[]']]))).toEqual([]);
  });
});

// ── the shell-line reader the other three censuses share ───────────────────
interface CodeLine { file: string; fn: string; n: number; code: string }
const JS_LIKE = /\.(m?js|ts)$/;
/** Blank comments and string literals that cannot be a path: a `#` comment
 *  (at a word start, outside quotes), any single-quoted or backtick span, and
 *  any double-quoted span whose own literal text holds whitespace (a message,
 *  never a path). A quoted path such as "$tree/.graphifyignore" survives, and
 *  a `$( … )` inside double quotes is read as code. Per line: a span still
 *  open at the end of a line is kept as read so far, which is how the
 *  restamp's multi-line `res="$( … <<'GFXPY'` opener is read. */
const codeOf = (line: string, jsLike: boolean): string => {
  let i = 0;
  let done = false;
  const code = (inSubst: boolean): string => {
    let out = ''; let depth = 0;
    while (i < line.length && !done) {
      const c = line[i]!;
      if (!jsLike && c === '#' && (i === 0 || /[\s;]/.test(line[i - 1]!))) { done = true; break; }
      if (jsLike && c === '/' && line[i + 1] === '/' && (i === 0 || line[i - 1] !== ':')) { done = true; break; }
      if (c === "'" || c === '`') {
        const close = line.indexOf(c, i + 1);
        out += `${c}${c}`; i = close < 0 ? line.length : close + 1; continue;
      }
      if (c === '"') { i++; out += dq(); continue; }
      if (c === '$' && line[i + 1] === '(') { i += 2; out += `$(${code(true)}`; continue; }
      if (inSubst && c === '(') depth++;
      if (inSubst && c === ')') { if (depth === 0) { i++; return `${out})`; } depth--; }
      out += c; i++;
    }
    return out;
  };
  const dq = (): string => {
    let text = '"'; let literal = '';
    while (i < line.length && !done) {
      const c = line[i]!;
      if (c === '\\') { text += line.slice(i, i + 2); literal += line.slice(i, i + 2); i += 2; continue; }
      if (c === '$' && line[i + 1] === '(') { i += 2; text += `$(${code(true)}`; continue; }
      if (c === '"') { i++; return /\s/.test(literal) ? '""' : `${text}"`; }
      text += c; literal += c; i++;
    }
    return text;
  };
  const out = code(false);
  if (jsLike && /^\s*(\*|\/\*)/.test(out)) return '';
  return out;
};
/** Each code line of a file, with its enclosing shell function (`(main)` at
 *  top level). Heredoc bodies are skipped: they are another language's text. */
const codeLines = (file: string, text: string): CodeLine[] => {
  const jsLike = JS_LIKE.test(file);
  const lines = text.split('\n');
  const res: CodeLine[] = [];
  let fn = '(main)'; let heredoc: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (heredoc !== null) { if (raw.trim() === heredoc) heredoc = null; continue; }
    if (!jsLike) {
      const def = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/.exec(raw);
      if (def) fn = def[1]!;
      else if (/^\}/.test(raw)) fn = '(main)';
      const hd = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(raw.replace(/<<</g, ''));
      if (hd) heredoc = hd[1]!;
    }
    const code = codeOf(raw, jsLike);
    if (code.trim() !== '') res.push({ file, fn, n: i + 1, code });
  }
  return res;
};
const ccdFiles = (files: Map<string, string>): [string, string][] =>
  [...files].filter(([f]) => f.startsWith('ccd/') && !f.endsWith('.md'));

// ── treeWriteSites ────────────────────────────────────────────────────────
interface WriteSite { fn: string; n: number; verb: string; target: string }
const REDIRECT = /(?<![-<>&=\d])(\d*)(>>?)(?![>&=(])\s*("[^"]*"|[^\s;|&)]+)/g;
const FILE_CMD = /(?:^|[\s;&|(!{])(rm|mv|cp|ln|chmod|mkdir|touch|tee)\s+([^;|&)]*)/g;
/** Every write or remove target of a file, by function: redirections and the
 *  file verbs' operands (flags dropped). `/dev/null` is not a file written. */
const writeSites = (file: string, text: string): WriteSite[] => {
  const sites: WriteSite[] = [];
  for (const l of codeLines(file, text)) {
    for (const m of l.code.matchAll(REDIRECT)) {
      if (m[3] === '/dev/null') continue;
      sites.push({ fn: l.fn, n: l.n, verb: `${m[1]}${m[2]}`, target: m[3]! });
    }
    for (const m of l.code.matchAll(FILE_CMD)) {
      for (const arg of m[2]!.match(/"[^"]*"|\S+/g) ?? []) {
        if (arg.startsWith('-') || arg === '/dev/null') continue;
        sites.push({ fn: l.fn, n: l.n, verb: m[1]!, target: arg });
      }
    }
  }
  return sites;
};
/** UNDER A TREE: the target is spelled from the tree itself (`$tree`, the
 *  helpers' `$1`/`$t`), from `$out` (the sweep's `$tree/graphify-out`, pinned
 *  below), or is `$res`, the restamp's temp the python helper creates INSIDE
 *  graphify-out/. Everything else (the census temp, the log, the probe temps
 *  mktemp makes outside the tree) is the other list, pinned too, so a write
 *  through a NEW variable shows up there. */
const UNDER_TREE = /^"?\$\{?(tree|out|t|1|res)\b/;
const fmt = (s: WriteSite): string => `${s.fn} ${s.verb} ${s.target}`;
const treeWriteSites = (text: string): string[] => writeSites(SWEEP, text).filter((s) => UNDER_TREE.test(s.target)).map(fmt);
const otherWriteSites = (text: string): string[] => writeSites(SWEEP, text).filter((s) => !UNDER_TREE.test(s.target)).map(fmt);

/** The base harvest (GR1 Step 1), kept as the record GR4's counted exit is measured from: the seven
 *  `.graphifyignore` write/remove sites (in and around the per-tree `_gs_guard`), the restamp's rename and its temp's
 *  removal, and the two `.graphify_engine` receipts. */
const TREE_WRITES_BASE = [
  '_gs_rm_generated rm "$t/.graphifyignore"',
  '_gs_open_filter > "$1/.graphifyignore"',
  '_gs_guard rm "$tree/.graphifyignore"',
  '_gs_guard >> "$tree/.graphifyignore"',
  '_gs_guard >> "$tree/.graphifyignore"',
  '_gs_guard rm "$tree/.graphifyignore"',
  '_gs_restamp mv "$res"',
  '_gs_restamp mv "$out/$f"',
  '_gs_restamp rm "$res"',
  '_gs_build > "$out/.graphify_engine"',
  '_gs_build > "$out/.graphify_engine"',
  '(main) rm "$tree/.graphifyignore"',
];
/** GR4 (D-7350, D-7649): what the repository sweep writes under a tree, literal — the link (spec §6.1) and the
 *  ownership-gated removal of a stray `.graphifyignore` a per-tree sweep left behind (spec §9.1, "as today"). Counted
 *  exit 12 -> 2; the `.graphifyignore` write-or-remove sites 7 -> 1, that one removal. GR6 adds only
 *  `_gs_migrate_one`'s named moves. */
const TREE_WRITES = [
  '_gs_rm_stray rm "$tree/.graphifyignore"',
  '_gs_link ln "$tree/graphify-out"',
];
/** Every other write target of the sweep, literal: the census, the store (the per-repository directory, the
 *  checkout's generated filter and exclude line, staging, the stamp's temp, meta.json, the build's publish, settings.json),
 *  the log, and the pass lock. Harvested on GR4's tip; a write through a NEW variable shows up here. */
const OTHER_WRITES_BASE = [
  "_gs_finish > \"$tmp\"",
  "_gs_finish rm \"$tmp\"",
  "_gs_finish > \"$tmp.2\"",
  "_gs_finish > \"$tmp.2\"",
  "_gs_finish mv \"$tmp.2\"",
  "_gs_finish mv \"$CENSUS\"",
  "_gs_finish rm \"$tmp\"",
  "_gs_noise cp \"$gen\"",
  "_gs_noise cp \"$ck/.git/graphifyignore.committed\"",
  "_gs_noise > \"$ck/.git/graphifyignore.committed\"",
  "_gs_noise > \"$probe\"",
  "_gs_noise rm \"$probe\"",
  "_gs_noise > \"$ck/.git/graphifyignore.new\"",
  "_gs_noise mv \"$ck/.git/graphifyignore.new\"",
  "_gs_noise mv \"$gen\"",
  "_gs_noise rm \"$ck/.git/graphifyignore.committed\"",
  "_gs_prepare mkdir \"$kd/memory\"",
  "_gs_prepare chmod 0755",
  "_gs_prepare chmod \"$kd\"",
  "_gs_prepare chmod \"$kd/memory\"",
  "_gs_prepare > \"$kd/source\"",
  "_gs_prepare rm \"$ck\"",
  "_gs_prepare rm \"$ck\"",
  "_gs_prepare >> \"$ck/.git/info/exclude\"",
  "_gs_prepare mkdir \"$ck/.git/info\"",
  "_gs_rmtree chmod u+w",
  "_gs_rmtree chmod {}",
  "_gs_rmtree chmod +",
  "_gs_rmtree chmod 2>/dev/null",
  "_gs_rmtree rm \"$doomed\"",
  "_gs_rmtree rm \"$doomed\"",
  "_gs_stage mkdir 0755",
  "_gs_stage mkdir \"$stg\"",
  "_gs_stage mkdir 0755",
  "_gs_stage mkdir \"$stg/graphify-out\"",
  "_gs_stage ln \"$kd/memory\"",
  "_gs_stage ln \"$stg/graphify-out/memory\"",
  "_gs_guard 2>> \"$LOG\"",
  "_gs_stamp_dir 2>> \"$LOG\"",
  "_gs_stamp_dir >> \"$LOG\"",
  "_gs_stamp_dir mv \"$spliced\"",
  "_gs_stamp_dir mv \"$dir/$f\"",
  "_gs_stamp_dir rm \"$spliced\"",
  "_gs_build > \"$stg/changed.z\"",
  "_gs_build >> \"$LOG\"",
  "_gs_build > \"$bout\"",
  "_gs_build 2> \"$berr\"",
  "_gs_build >> \"$LOG\"",
  "_gs_build > \"$g/meta.json\"",
  "_gs_build mkdir \"$kd/builds\"",
  "_gs_build chmod a-w",
  "_gs_build chmod {}",
  "_gs_build chmod +",
  "_gs_build chmod 2>/dev/null",
  "_gs_build chmod u+w",
  "_gs_build chmod {}",
  "_gs_build chmod +",
  "_gs_build chmod 2>/dev/null",
  "_gs_build chmod a-w",
  "_gs_build chmod \"$kd/builds/$id\"",
  "_gs_build chmod 2>/dev/null",
  "_gs_link ln \"$tgt\"",
  "_gs_settings > \"$GS_STORE/.settings.json.new\"",
  "_gs_settings mv \"$GS_STORE/.settings.json.new\"",
  "_gs_settings mv \"$GS_STORE/settings.json\"",
  "(main) 9> \"$LOCK\"",
];

describe('treeWriteSites: what the sweep writes under a tree (D-7347)', () => {
  const sweep = fs.readFileSync(path.join(ROOT, SWEEP), 'utf8');

  it('the link and the stray removal, literal (GR4: 12 -> 2)', () => {
    expect(treeWriteSites(sweep)).toEqual(TREE_WRITES);
    expect(TREE_WRITES_BASE.filter((s) => s.includes('.graphifyignore')), 'the base\'s seven filter sites').toHaveLength(7);
    expect(TREE_WRITES.filter((s) => s.includes('.graphifyignore')), 'one left: the ownership-gated removal').toEqual(['_gs_rm_stray rm "$tree/.graphifyignore"']);
    expect([TREE_WRITES_BASE.length, TREE_WRITES.length], 'the counted exit').toEqual([12, 2]);
  });

  it('every other write target is a named one outside the tree', () => {
    expect(otherWriteSites(sweep)).toEqual(OTHER_WRITES_BASE);
  });

  it('`$out`, the per-tree sweep\'s spelling of a tree\'s graphify-out, is set nowhere any more', () => {
    // GR4: the sweep names a tree's graphify-out only as "$tree/graphify-out" (the link); every output directory
    // it writes is the store's, spelled from $kd, $stg or $g, which UNDER_TREE does not match.
    const outs = [...sweep.matchAll(/\bout="([^"]*)"/g)].map((m) => m[1]);
    expect(outs).toEqual([]);
  });

  it('calibration: an extra write under the tree goes red, and comments and messages are not writes', () => {
    const mutated = sweep.replace(/^_gs_build\(\) \{[^\n]*\n/m, (m) => `${m}  : > "$tree/x"\n`);
    expect(mutated).not.toBe(sweep);
    expect(treeWriteSites(mutated)).toContain('_gs_build > "$tree/x"');
    expect(treeWriteSites(mutated)).not.toEqual(TREE_WRITES);
    expect(treeWriteSites('f() {\n  # rm -f "$tree/a"\n  echo "x -> y > z" >&2\n}\n')).toEqual([]);
  });
});

// ── engineCalls ───────────────────────────────────────────────────────────
// A call is the sweep's `$ENGINE` with any argument, or a build (`update`) run
// through a local `$engine` (the doctor's spelling) or through any path that
// ends in `graphify`, quoted or not (`"$VENV/bin/graphify" update .`). The
// lowercase variable is counted only with `update`: the doctor tests it
// (`-x "$engine"`, `realpath "$engine"`), and a test of the path is not a call.
const ENGINE_CALL = /\$\{?ENGINE\}?"?\s+\S|(?:\$\{?engine\}?|\bgraphify)"?\s+update\b/;
const engineCalls = (files: Map<string, string>): string[] =>
  ccdFiles(files).flatMap(([f, t]) => codeLines(f, t).filter((l) => ENGINE_CALL.test(l.code)).map((l) => `${f}#${l.fn}`));

describe('engineCalls: who runs the engine (D-7347)', () => {
  it('no invocation in ccd/: the wrapper imports the engine instead (GR4: 1 -> 0, the sweep\'s `_gs_build`)', () => {
    expect(engineCalls(trackedText())).toEqual([]);
  });

  it('calibration: the assignment, a comment, the card\'s prohibition and a test of the path are not calls; a bare, a quoted-path and a local-variable call are', () => {
    const probe = new Map([['ccd/probe', [
      'ENGINE="$VENV/bin/graphify"',
      '# "$ENGINE" update . here would be a comment',
      'line="$line"\'. Do not run `graphify update` here.\'',
      'f() {',
      '  ( cd "$tree" && graphify update . )',
      '}',
      'g() {',
      '  ( cd "$tree" && "$VENV/bin/graphify" update . )',
      '}',
      'h() {',
      '  ( cd "$tree" && "$HOME/.ccrc/graphify-venv/bin/graphify" update . )',
      '}',
      'k() {',
      '  local engine="$HOME/.ccrc/graphify-venv/bin/graphify"',
      '  [ ! -x "$engine" ] && return 1',
      '  want="$(realpath "$engine" 2>/dev/null)"',
      '  ( cd "$tree" && "$engine" update . )',
      '}',
    ].join('\n')]]);
    expect(engineCalls(probe)).toEqual(['ccd/probe#f', 'ccd/probe#g', 'ccd/probe#h', 'ccd/probe#k']);
  });
});

// ── graphPathReaders ──────────────────────────────────────────────────────
const MEMBER = String.raw`(graph\.json|GRAPH_REPORT\.md|\.graphify_engine|\.graphify_labels\.json|meta\.json)`;
const MEMBER_PATH = new RegExp(String.raw`graphify-out/${MEMBER}`, 'g');
/** In the sweep only, `$out` is the tree's graphify-out (pinned above), and the
 *  restamp's `$out/$f` loops `f` over graph.json and GRAPH_REPORT.md. */
const SWEEP_OUT_PATH = new RegExp(String.raw`\$\{?out\}?/(\$f|${MEMBER.slice(1, -1)})`, 'g');
/** One row per reading line: `file#function: member[, member]`. A line that is
 *  one of the sweep's tree write sites is a write, counted there, not here. */
const graphPathReaders = (files: Map<string, string>): string[] => {
  const rows: string[] = [];
  for (const [f, t] of ccdFiles(files)) {
    const writes = new Set(f === SWEEP ? writeSites(f, t).filter((s) => UNDER_TREE.test(s.target)).map((s) => s.n) : []);
    for (const l of codeLines(f, t)) {
      if (writes.has(l.n)) continue;
      const found = [...l.code.matchAll(MEMBER_PATH)].map((m) => m[1]!);
      if (f === SWEEP) found.push(...[...l.code.matchAll(SWEEP_OUT_PATH)].map((m) => m[1]!));
      if (found.length) rows.push(`${f}#${l.fn}: ${[...new Set(found)].join(', ')}`);
    }
  }
  return rows;
};

/** The base harvest, in file order (plan item 10's sites, measured). */
/** GR4 (D-7350) took the sweep's ten rows to none: it reads no tree's graphify-out member; what it reads of a build
 *  is the store's (`$kd/current/meta.json`, `$g/graph.json`), never through a tree. */
const GRAPH_READERS_BASE = [
  'ccd/session-hook.sh#_hook_graph_measure: graph.json',
  'ccd/session-hook.sh#_hook_graph_measure: graph.json',
  'ccd/session-hook.sh#_hook_graph_measure: GRAPH_REPORT.md',
  'ccd/session-hook.sh#_hook_graph_measure: .graphify_engine',
  'ccd/session-hook.sh#_hook_graph_meta: meta.json',   // GR5 (D-7351): the linked tree's one read
  'ccd/session-hook.sh#_hook_compact_pre: graph.json',
  'ccd/session-hook.sh#_hook_compact_pre: .graphify_labels.json',
];

describe('graphPathReaders: who reads a graphify-out member (D-7347)', () => {
  it('the base list, literal', () => {
    expect(graphPathReaders(trackedText())).toEqual(GRAPH_READERS_BASE);
  });

  it('calibration: a new member read goes red, a message naming one does not', () => {
    const probe = new Map([['ccd/probe', [
      'g() {',
      '  jq -r .commit "$cwd/graphify-out/meta.json"',
      '  echo "read graphify-out/GRAPH_REPORT.md for architecture"',
      '}',
    ].join('\n')]]);
    expect(graphPathReaders(probe)).toEqual(['ccd/probe#g: meta.json']);
  });
});
