// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sourceOfSymbol, callsIn } from '../scan/symbols.js';
import { markerDefinitions, reclaimPauseParseSites } from '../consolidationCensus.js';
import { parseSource } from '../scan/parse.js';
import { SWITCHES } from '../../../shared/switches.js';
import { ALL, ALL_MJS, BASH, ROOTS, ccrcRoot, codeLines, here, holdersOf, isBashComment, rel, stallCode, stallCodeText } from './helpers.js';


// ── auto-advance spec §2.1, D21: the advance file has one writer and one clock ─────────────────────────────────
describe('the advance file and its clock, each spelled once (auto-advance spec §2.1, D21)', () => {
  const walkSrc = (dir: string): string[] => {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir)) {
      if (e.startsWith('__') || e === 'node_modules' || e === 'dist') continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { out.push(...walkSrc(p)); continue; }
      if (/\.(tsx?|mjs|mts)$/.test(p)) out.push(p);
    }
    return out;
  };
  /** Every shipped source a second spelling could hide in: the four TypeScript roots, `deploy/` and `shared/`
   *  (their `.mjs`), and every bash tool, comments stripped. */
  const SHIPPED = [...new Set([
    ...['shared', 'deploy', 'server/src', 'pwa/src', 'agent/src'].flatMap((d) => walkSrc(path.join(ccrcRoot, d))),
    ...BASH,
  ])];
  const textOf = (f: string): string => (BASH.includes(f) ? codeLines(f).join('\n') : readFileSync(f, 'utf8'));
  const OP = path.join(ccrcRoot, 'deploy', 'models-op.mjs');
  /** `deploy/models-op.mjs` cut at each top-level `function` line: name → that function's text, to the next. */
  const functionsOf = (src: string): Map<string, string> => {
    const starts = [...src.matchAll(/^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map((m) => ({ name: m[1]!, at: m.index! }));
    return new Map(starts.map((s, i) => [s.name, src.slice(s.at, i + 1 < starts.length ? starts[i + 1]!.at : src.length)]));
  };

  it('the corpus is real', () => {
    const names = SHIPPED.map(rel);
    for (const f of ['deploy/models-op.mjs', 'shared/model-advance.mjs', 'ccd/ccrc']) expect(names).toContain(f);
  });

  it('`.advance.json` is spelled by deploy/models-op.mjs alone, on advancePath\'s one line, and by no bash tool', () => {
    expect(SHIPPED.filter((f) => textOf(f).includes('.advance.json')).map(rel).sort()).toEqual(['deploy/models-op.mjs']);
    expect(readFileSync(OP, 'utf8').split('\n').filter((l) => l.includes('.advance.json')))
      .toEqual(['const advancePath = (id) => path.join(modelsDir(), `${id}.advance.json`);']);
  });

  it('its bytes come from one place: writeAdvance writes through writeJsonFile (D-5783), and nothing else writes the file or spells its bytes', () => {
    const src = readFileSync(OP, 'utf8');
    const fns = functionsOf(src);
    // The one writer: the only function that names both the path and the JSON write is writeAdvance, and it hands
    // that write the path with its own error word.
    const writesIt = (body: string): boolean => /\badvancePath\(/.test(body) && /\bwriteJsonFile\(/.test(body);
    expect([...fns].filter(([, body]) => writesIt(body)).map(([n]) => n)).toEqual(['writeAdvance']);
    expect(fns.get('writeAdvance')).toMatch(/\bwriteJsonFile\(advancePath\(id\), \w+, 'advance-unwritable'\)/);
    // serializeAdvance spells writeJsonFile's bytes for readers and tests (model-advance-file.test.ts pins that the
    // two agree), so a shipped call of it could only be a second writer's.
    const CALL = /(?<!function )\bserializeAdvance\(/;
    expect(SHIPPED.filter((f) => CALL.test(textOf(f))).map(rel)).toEqual([]);
    expect(src.split('\n')
      .filter((l) => /\badvancePath\(/.test(l) && /\b(?:writeFileSync|renameSync|appendFileSync)\(/.test(l))).toEqual([]);
    // Every call of advancePath in the file, pinned whole, the `.advance.json` case's idiom: a writer that holds the
    // path in a variable, or an arrow const after writeAdvance (which the function cut above folds into it), adds a
    // line here. readAdvance's, writeAdvance's and rm's reap (Task 5).
    expect(src.split('\n').filter((l) => /\badvancePath\(/.test(l)).map((l) => l.trim())).toEqual([
      'const p = advancePath(id);',
      "return writeJsonFile(advancePath(id), parsed, 'advance-unwritable');",
      'windowsPath(a.id), advancePath(a.id)]) {',
    ]);
  });

  it('CCRC_MODELS_NOW is read in one place, and models-op reads the wall clock on two named lines only', () => {
    expect(SHIPPED.filter((f) => textOf(f).includes('CCRC_MODELS_NOW')).map(rel)).toEqual(['deploy/models-op.mjs']);
    const lines = readFileSync(OP, 'utf8').split('\n');
    expect(lines.filter((l) => l.includes("process.env['CCRC_MODELS_NOW']"))).toHaveLength(1);
    expect(lines.filter((l) => /\bnew Date\(|\bDate\.now\(/.test(l)).map((l) => l.trim())).toEqual([
      "const now = () => process.env['CCRC_MODELS_NOW'] ?? new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z');",
      'raw.windows[a.model] = { ...prev, tokens, setAt: new Date().toISOString() };',
    ]);
  });

  it("REASON_MAX is assigned once, in shared/model-advance.mjs: every other source that caps a reason imports it", () => {
    // The advance reason's cappers live in deploy/, shared/, the models server code, the PWA and the bash tools.
    // server/src/coord/briefwatch.ts holds its own, unrelated REASON_MAX (a wave brief's word cap), so the
    // coordination code is outside this census rather than a second spelling of this one.
    const ASSIGN = /\bREASON_MAX\s*=(?!=)/;
    const inScope = (f: string): boolean => BASH.includes(f) || /^(?:deploy|shared|server\/src\/models|pwa\/src)\//.test(rel(f));
    expect(SHIPPED.filter((f) => inScope(f) && ASSIGN.test(textOf(f))).map(rel)).toEqual(['shared/model-advance.mjs']);
    expect(readFileSync(path.join(ccrcRoot, 'shared', 'model-advance.mjs'), 'utf8')).toContain('export const REASON_MAX = 200;');
  });
});


// ── auto-advance spec D21: the lane-files lock, and the one list of ops that run under it ──────────────────────
describe('the lane-files lock: one path outside ~/.ccrc/models, and one list of writing ops (auto-advance spec D21)', () => {
  it('the lock path is spelled once, in ccd/ccrc, on _models_lock_path\'s one line, and by no node or TypeScript source', () => {
    // The accounts plan's lane locks (Task A11; D-5755 (14)) share the directory: `ccrc` derives it from this one line
    // (`_acct_locks_dir`), and `ccd-account-health`, a separate program the timer runs, spells it once on its own.
    expect(holdersOf('.ccrc/locks')).toEqual(['ccd/ccd-account-health', 'ccd/ccrc']);
    expect(codeLines(path.join(ccrcRoot, 'ccd', 'ccrc')).filter((l) => l.includes('.ccrc/locks')))
      .toEqual(['_models_lock_path() { printf \'%s\' "$HOME/.ccrc/locks/models-$1.lock"; }']);
    expect(codeLines(path.join(ccrcRoot, 'ccd', 'ccd-account-health')).filter((l) => l.includes('.ccrc/locks')))
      .toEqual(['AH_LOCKS_DIR="$HOME/.ccrc/locks"']);
    const mjs = (d: string): string[] => readdirSync(path.join(ccrcRoot, d)).filter((f) => f.endsWith('.mjs'))
      .map((f) => path.join(ccrcRoot, d, f));
    expect([...ALL, ...mjs('deploy'), ...mjs('shared')].filter((f) => readFileSync(f, 'utf8').includes('.ccrc/locks')).map(rel))
      .toEqual([]);
  });

  it('MODELS_WRITE_OPS is exactly the OPS rows marked writes: true, in both directions, and every row says which', () => {
    const bash = /^MODELS_WRITE_OPS="([^"]*)"$/m.exec(readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8'));
    expect(bash, 'ccd/ccrc has no file-scope MODELS_WRITE_OPS').toBeTruthy();
    const op = readFileSync(path.join(ccrcRoot, 'deploy', 'models-op.mjs'), 'utf8');
    const start = op.indexOf('const OPS = {');
    expect(start).toBeGreaterThan(0);
    const block = op.slice(start, op.indexOf('\n};\n', start));
    const rows = [...block.matchAll(/^ {2}'?([a-z][a-z-]*)'?: \{([^\n]*)\},$/gm)]
      .map((m) => ({ op: m[1]!, writes: /\bwrites: (true|false)\b/.exec(m[2]!)?.[1] ?? null }));
    expect(rows.length, 'the OPS scan found too few rows to be reading the table').toBeGreaterThanOrEqual(12);
    // Every row is ONE line, so the scan above sees it: a row written over several lines would be invisible to it in
    // both directions, and a new writing op left out of MODELS_WRITE_OPS would run unlocked with this case green.
    const starts = [...block.matchAll(/^ {2}'?([a-z][a-z-]*)'?: \{/gm)].map((m) => m[1]!);
    expect(starts, 'an OPS row written over several lines: write each row on one line').toEqual(rows.map((r) => r.op));
    expect(rows.filter((r) => r.writes === null).map((r) => r.op), 'an OPS row with no writes flag').toEqual([]);
    expect(bash![1]!.split(' ').filter(Boolean).sort())
      .toEqual(rows.filter((r) => r.writes === 'true').map((r) => r.op).sort());
  });
});


// D-5517, D-5751 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A1). APPENDED. The lane's kind on
// the wire has one reader: `rosterKindOf` derives `provider`, `kind`, `telemetry` and `managed` from a parsed roster
// entry, and its vocabulary (`RosterKind`, `RosterKindWire`) is declared beside it. A second derivation in the server's
// handler or the PWA would be a second answer to "what kind of lane is this", free to disagree with the first.
describe("the lane's kind is derived in one place, shared/roster.ts (D-5517)", () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('rosterKindOf').test('export function rosterKindOf(entry: AccountDef)')).toBe(true);
    expect(decl('rosterKindOf').test('...rosterKindOf(a),')).toBe(false);
  });
  it('rosterKindOf and its vocabulary are declared once, in shared/roster.ts', () => {
    for (const c of ['rosterKindOf', 'RosterKind', 'RosterKindWire']) {
      expect(holders(decl(c)), c).toEqual(['shared/roster.ts']);
    }
  });
  it("it is called by the accounts handler alone, which is the RosterWire builder", () => {
    expect(holders(/\brosterKindOf\(/)).toEqual(['server/src/server.ts', 'shared/roster.ts']);
  });
});

// D-5849 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0b; ARCH-40 (#775); spec 2026-10-19
// §2.1 rule (f), §5.1 rule 3). APPENDED, because this file is cited by line. One writer per fact, for the two switches
// whose writer set is ALREADY at its target, so each set may only shrink (a pin on a fact not yet at target would be a
// freeze; those land with the series that reaches it, the feed archive's with C1e).
//   - `reclaim-paused`: one writer, ccd's `reclaim-pause` verb (`cmd_reclaim_pause` in `ccd/ccd`), which the server
//     reaches only through its CCD_ARGV row. No TS or .mjs file writes it.
//   - `mail-disabled`: hand-only ("removable only by a human at a terminal", `ccd/ccrc`). Nothing in the tree writes it.
// The O13 describe's `writes` is block-local to that describe, so this one defines its own classifiers, and they also
// follow a shell variable that holds the path (`local marker="$REG/reclaim-paused"` … `touch -- "$marker"`), which is
// how the one writer spells it. The corpus is bash (ccd/, deploy/, install.sh), TS under ROOTS, .mjs, and every tracked
// .py; the tree's .mts files are all .d.mts declarations. TS/.mjs and Python follow a `const|let|var` (Python: a plain
// assignment) whose initialiser builds the path, per FILE, and count a spawn/exec of a write verb naming it. A bash
// writer is named `file:function` (`file:(top level)` outside a function); a TS or Python writer by its file. KNOWN
// WIDTH: a name assembled from pieces, a bash variable assigned in one function and written in another, a path passed
// through a parameter or object field, and an fs call split over lines are not seen.
// The import sits here, not at the head, so the append moves no cited line (ESM hoists it either way).
describe('one writer per fact (ARCH-40): the switches whose writer set is already at target (D-5849)', () => {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const WRITE_VERB = '(?:touch|mv|cp|ln|rm|rmdir|mkdir|install|tee|truncate)';
  /** The functions of one bash text that write `name`'s path, directly or through a variable assigned from it. */
  const bashWriters = (text: string, name: string): string[] => {
    const out = new Set<string>();
    let fn = '(top level)';
    let vars: string[] = [];
    for (const raw of text.split('\n')) {
      const open = /^([A-Za-z_][\w-]*)\s*\(\)\s*\{/.exec(raw);
      if (open) { fn = open[1]!; vars = []; }
      if (isBashComment(raw)) continue;
      const l = raw.replace(/\d?>\s*\/dev\/null|>&\d/g, '');
      for (const m of l.matchAll(new RegExp(`\\b([A-Za-z_]\\w*)=[^\\s;]*${esc(name)}\\b`, 'g'))) vars.push(m[1]!);
      const target = [`[^\\s<>|;&]*${esc(name)}\\b`, ...vars.map((v) => `\\$\\{?${v}\\}?(?![\\w])`)].join('|');
      if (new RegExp(`>{1,2}\\s*["']?(?:${target})`).test(l)
        || new RegExp(`(?:^|[\\s;&|({])${WRITE_VERB}\\s[^;&|]*?["']?(?:${target})`).test(l)) out.add(fn);
      if (/^}\s*$/.test(raw)) { fn = '(top level)'; vars = []; }
    }
    return [...out];
  };
  /** The alternation that names `name`'s path: the literal, or one of `ids` (constants and variables holding it). */
  const naming = (name: string, ids: readonly string[]): string =>
    [esc(name), ...ids.map((c) => `\\b${esc(c)}\\b`)].join('|');
  /** A TS or .mjs code line that writes `name`'s path: a file-changing fs call, or a spawn/exec of a write verb, naming
   *  the literal or one of `consts`. */
  const tsWrites = (line: string, name: string, consts: readonly string[]): boolean =>
    new RegExp(`\\b(?:writeFile|appendFile|createWriteStream|rename|copyFile|symlink|link|truncate|utimes|lutimes|open|mkdir|rm|unlink|cp)(?:Sync)?\\s*\\([^;]*(?:${
      naming(name, consts)})`).test(line)
    || new RegExp(`\\b(?:execFile|spawn|exec)(?:Sync)?\\s*\\(\\s*[\`'"]${WRITE_VERB}\\b[^;]*(?:${naming(name, consts)})`).test(line);
  /** The ids a text binds to `name`'s PATH, followed to a fixed point (`const m = join(reg, X)`, then `const q = m`).
   *  `decl` captures the id and the initialiser of one line; an initialiser binds only when it names the path AND builds
   *  one (`pathy`: a join, a string or template, a concatenation) or is a bare alias, so `const r = f(names.includes(X))`
   *  does not bind `r`. Per FILE: two functions' same-named locals merge. */
  const boundIds = (lines: readonly string[], name: string, seed: readonly string[], decl: RegExp,
    pathy: RegExp): string[] => {
    const ids = [...seed];
    for (let grew = true; grew;) {
      grew = false;
      const named = new RegExp(naming(name, ids));
      const alias = new RegExp(`^\\s*(?:${[esc(name), ...ids.map(esc)].join('|')})\\s*;?\\s*$`);
      for (const l of lines) {
        const m = decl.exec(l);
        if (m && !ids.includes(m[1]!) && named.test(m[2]!) && (pathy.test(m[2]!) || alias.test(m[2]!))) {
          ids.push(m[1]!); grew = true;
        }
      }
    }
    return ids;
  };
  /** A TS or .mjs FILE's code writes `name`'s path, directly or through a `const|let|var` bound to it (D-5849). */
  const tsFileWrites = (text: string, name: string, consts: readonly string[]): boolean => {
    const lines = text.split('\n');
    const ids = boundIds(lines, name, consts, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=(?![=>])(.*)/,
      /^\s*(?:(?:await\s+)?(?:path\.)?(?:join|resolve)\s*\(|[`'"]|[\w$.]+\s*\+)/);
    return lines.some((l) => tsWrites(l, name, ids));
  };
  /** A Python FILE's code writes `name`'s path (an `open` for writing, a pathlib/os/shutil change, a write verb in
   *  argv), directly or through a name assigned from it (D-5849). */
  const pyFileWrites = (text: string, name: string): boolean => {
    const lines = text.split('\n').filter((l) => !l.trim().startsWith('#'));
    const target = new RegExp(naming(name, boundIds(lines, name, [], /^\s*([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)(.*)/,
      /^\s*(?:os\.path\.(?:join|abspath|realpath)\s*\(|(?:pathlib\.)?Path\s*\(|[rbf]?['"]|\(|[\w.]+\s*[/+])/)));
    const write = new RegExp([
      `\\bopen\\s*\\(.*,\\s*(?:mode\\s*=\\s*)?['"][a-z]*[wax+]`,
      '\\.(?:touch|write_text|write_bytes|mkdir|unlink|rename|replace|symlink_to|hardlink_to|rmdir)\\s*\\(',
      '\\bos\\.(?:replace|renames?|remove|unlink|mknod|symlink|link|mkdirs?|makedirs|rmdir|truncate)\\s*\\(',
      '\\bshutil\\.(?:copy\\w*|move|rmtree)\\s*\\(',
      `['"]${WRITE_VERB}['"]`,
    ].join('|'));
    return lines.some((l) => target.test(l) && write.test(l));
  };
  /** Every tracked Python file (none is a bash, TS or .mjs corpus member). A failed `git ls-files` (no checkout) throws
   *  rather than scanning nothing, and the CONTROL row holds the corpus non-empty. */
  const pyFiles = (): string[] => {
    const r = spawnSync('git', ['ls-files', '-z', '*.py'], { cwd: ccrcRoot, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files *.py exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    return r.stdout.split('\0').filter(Boolean).map((f) => path.join(ccrcRoot, f));
  };
  /** The constants that hold `name` (`const X = 'name'`), from the census module's own query. */
  const constsOf = (name: string): string[] =>
    markerDefinitions(name).map((s) => /\bconst\s+([A-Za-z_$][\w$]*)/.exec(s.text)![1]!);
  const writersOf = (name: string): string[] => {
    const out: string[] = [];
    for (const f of BASH) for (const fn of bashWriters(readFileSync(f, 'utf8'), name)) out.push(`${rel(f)}:${fn}`);
    const consts = constsOf(name);
    for (const f of [...ALL, ...ALL_MJS]) if (tsFileWrites(stallCode(f), name, consts)) out.push(rel(f));
    for (const f of pyFiles()) if (pyFileWrites(readFileSync(f, 'utf8'), name)) out.push(rel(f));
    return out.sort();
  };

  it('CONTROL (fixture): the classifiers see the verb, a second writer, a write through a variable, and pass over a read', () => {
    const verb = [
      'cmd_reclaim_pause() {',
      '  local marker="$REG/reclaim-paused"',
      '  touch -- "$marker" || die "could not raise it"',
      '}',
      'cmd_reap() {',
      '  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \\',
      '    || { _reap_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused)"; return 1; }',
      '  # touch "$REG/reclaim-paused" is the operator\'s, not this function\'s',
      '}',
    ].join('\n');
    expect(bashWriters(verb, 'reclaim-paused')).toEqual(['cmd_reclaim_pause']);
    expect(bashWriters(`${verb}\ncmd_other() {\n  : > "$REG/reclaim-paused"\n}`, 'reclaim-paused'))
      .toEqual(['cmd_reclaim_pause', 'cmd_other']);
    expect(bashWriters('cmd_x() {\n  local m="$REG/reclaim-paused"\n  rm -f -- "$m"\n}', 'reclaim-paused')).toEqual(['cmd_x']);
    expect(bashWriters('cmd_y() {\n  touch "$REG/mail-disabled"\n}', 'mail-disabled')).toEqual(['cmd_y']);
    expect(bashWriters('cmd_z() {\n  [[ -e "$REG/mail-disabled" ]] && return 0\n}', 'mail-disabled')).toEqual([]);
    expect(bashWriters('cmd_q() {\n  : > "$REG"/reclaim-paused\n}', 'reclaim-paused')).toEqual(['cmd_q']);
    expect(bashWriters('cmd_r() {\n  : >> "${REG}"/mail-disabled\n}', 'mail-disabled')).toEqual(['cmd_r']);
    expect(bashWriters('cmd_t() {\n  local m="$REG"/reclaim-paused\n  rm -f -- "$m"\n}', 'reclaim-paused')).toEqual(['cmd_t']);
    expect(bashWriters('cmd_s() {\n  [[ -e "$REG"/mail-disabled ]] && return 0\n}', 'mail-disabled')).toEqual([]);
    expect(tsWrites("writeFileSync(join(reg, 'reclaim-paused'), '');", 'reclaim-paused', ['RECLAIM_PAUSE_MARKER'])).toBe(true);
    expect(tsWrites('await writeFile(path.join(reg, RECLAIM_PAUSE_MARKER), "");', 'reclaim-paused', ['RECLAIM_PAUSE_MARKER'])).toBe(true);
    expect(tsWrites('if (names.includes(RECLAIM_PAUSE_MARKER)) return;', 'reclaim-paused', ['RECLAIM_PAUSE_MARKER'])).toBe(false);
    const C = ['RECLAIM_PAUSE_MARKER'];
    expect(tsFileWrites("function raise(reg) {\n  const marker = join(reg, RECLAIM_PAUSE_MARKER);\n  writeFileSync(marker, '');\n}",
      'reclaim-paused', C)).toBe(true);
    expect(tsFileWrites("let p: string = path.join(reg, 'reclaim-paused');\nconst q = p;\nawait rm(q, { force: true });",
      'reclaim-paused', C)).toBe(true);
    expect(tsFileWrites("execFileSync('touch', [join(reg, RECLAIM_PAUSE_MARKER)]);", 'reclaim-paused', C)).toBe(true);
    expect(tsFileWrites("spawnSync(`rm`, ['-f', m]);\nconst m = join(reg, RECLAIM_PAUSE_MARKER);", 'reclaim-paused', C)).toBe(true);
    expect(tsFileWrites("const p = join(reg, RECLAIM_PAUSE_MARKER);\nif (existsSync(p)) return;\nwriteFileSync(other, '');",
      'reclaim-paused', C)).toBe(false);
    expect(tsFileWrites("execFileSync('ls', [join(reg, RECLAIM_PAUSE_MARKER)]);", 'reclaim-paused', C)).toBe(false);
    expect(tsFileWrites('createWriteStream(join(reg, RECLAIM_PAUSE_MARKER)).end();', 'reclaim-paused', C)).toBe(true);
    expect(tsFileWrites("const m = join(reg, RECLAIM_PAUSE_MARKER);\nawait utimes(m, now, now);", 'reclaim-paused', C)).toBe(true);
    expect(pyFiles().length, 'the Python corpus is empty: git ls-files found no .py').toBeGreaterThan(0);
    expect(pyFileWrites("with open(os.path.join(reg, 'mail-disabled'), 'w') as f:\n    pass", 'mail-disabled')).toBe(true);
    expect(pyFileWrites("m = os.path.join(reg, 'mail-disabled')\nos.remove(m)", 'mail-disabled')).toBe(true);
    expect(pyFileWrites("(Path(reg) / 'mail-disabled').touch()", 'mail-disabled')).toBe(true);
    expect(pyFileWrites("subprocess.run(['touch', os.path.join(reg, 'mail-disabled')])", 'mail-disabled')).toBe(true);
    expect(pyFileWrites("m = os.path.join(reg, 'mail-disabled')\nif os.path.exists(m):\n    open(m).read()", 'mail-disabled'))
      .toBe(false);
    expect(pyFileWrites("# open(os.path.join(reg, 'mail-disabled'), 'w') is the operator's", 'mail-disabled')).toBe(false);
    expect(constsOf('reclaim-paused')).toEqual(['RECLAIM_PAUSE_MARKER']);
    expect(constsOf('mail-disabled')).toEqual(['MAIL_DISABLED_MARKER']); // one definition since D-5855
  });

  it("reclaim-paused: one writer, ccd's reclaim-pause verb", () => {
    expect(writersOf('reclaim-paused')).toEqual(['ccd/ccd:cmd_reclaim_pause']);
  });

  it('reclaim-paused: the server reaches the verb only through its CCD_ARGV row', () => {
    const verb = /(['"])reclaim-pause\1/;
    const holders = ALL.filter((f) => rel(f).startsWith('server/src/') && verb.test(stallCode(f))).map(rel).sort();
    expect(holders).toEqual(['server/src/ccdargv.ts']);
    const lines = stallCode(path.join(ccrcRoot, 'server/src/ccdargv.ts')).split('\n');
    const at = lines.findIndex((l) => /^export const CCD_ARGV\s*=\s*\{/.test(l));
    const end = lines.findIndex((l, i) => i > at && /^\}/.test(l));
    expect(at, 'ccdargv.ts declares no CCD_ARGV').toBeGreaterThan(-1);
    const uses = lines.flatMap((l, i) => (verb.test(l) ? [i] : []));
    expect(uses.length).toBe(1);
    expect(uses[0]!, 'the reclaim-pause argv is spelled outside CCD_ARGV').toBeGreaterThan(at);
    expect(uses[0]!).toBeLessThan(end);
  });

  it('mail-disabled: hand-only, no writer in the tree', () => {
    expect(writersOf('mail-disabled')).toEqual([]);
  });

  // D-6785 (PR landing in ccrc, stage 1): the checks lane's two markers are rows of the switchboard with writer
  // `hand-only`. Nothing in the tree writes `landing-disabled` or `landing-checks-live` (the operator arms the lane
  // by hand, after a week of agreeing shadow rows).
  it.each(['landing-disabled', 'landing-checks-live'])('%s: hand-only, no writer in the tree', (name) => {
    expect(SWITCHES[name as 'landing-disabled' | 'landing-checks-live'].writer).toBe('hand-only');
    expect(constsOf(name), 'CONTROL: the switchboard defines it').toHaveLength(1);
    expect(writersOf(name)).toEqual([]);
  });

  // D4 (#757): the roster card's arming marker is hand-only too. Nothing in the tree writes it; the operator arms the
  // card by hand after reading the shadow log.
  it('coordinator-roster-card-live: hand-only, no writer in the tree', () => {
    expect(SWITCHES['coordinator-roster-card-live'].writer).toBe('hand-only');
    expect(constsOf('coordinator-roster-card-live'), 'CONTROL: the switchboard defines it').toHaveLength(1);
    expect(writersOf('coordinator-roster-card-live')).toEqual([]);
  });

  // D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a; ARCH-70 (#805)).
  // The switchboard's exit: `mail-disabled` is defined once (2 -> 1 on C1a's tip; the count may only shrink), and so
  // is every other marker row; and every marker literal a `const *_MARKER` defines under `server/src` or `shared/` is
  // a `SWITCHES` row. KNOWN WIDTH: the stall watch's map keys (`coord/stall.ts`) are not `*_MARKER` constants and are
  // not rows yet; a name assembled from pieces is not seen.
  it('mail-disabled is defined once, in its switchboard row (may only shrink)', () => {
    const sites = markerDefinitions('mail-disabled');
    expect(sites.length, 'a second definition of mail-disabled').toBeLessThanOrEqual(1);
    expect(sites.map((x) => x.file)).toEqual(['shared/switches.ts']);
  });

  it('every marker row is defined once, in shared/switches.ts', () => {
    const markers = Object.values(SWITCHES).flatMap((r) => ('marker' in r.storage ? [r.storage.marker] : []));
    expect(markers.length, 'CONTROL: the switchboard has marker rows').toBeGreaterThan(10);
    for (const m of markers) expect(markerDefinitions(m).map((x) => x.file), m).toEqual(['shared/switches.ts']);
  });

  it('every marker literal is a SWITCHES row: no const *_MARKER under server/src or shared/ names a marker without one', () => {
    const DEF = /\bconst\s+([A-Z0-9_]*_MARKER)\s*(?::[^=]+)?=\s*(['"])([a-z][a-z0-9-]*)\2/g;
    const rows = new Set<string>(Object.values(SWITCHES).flatMap((r) => ('marker' in r.storage ? [r.storage.marker] : [])));
    expect([...'const X_MARKER = \'x-y\';'.matchAll(DEF)].map((m) => m[3]), 'CONTROL: the pattern sees a definition')
      .toEqual(['x-y']);
    const rowless = ALL.filter((f) => /^(?:server\/src|shared)\//.test(rel(f)))
      .flatMap((f) => [...stallCode(f).matchAll(DEF)].filter((m) => !rows.has(m[3]!)).map((m) => `${rel(f)}: ${m[1]} = ${m[3]}`));
    expect(rowless, 'a marker constant with no SWITCHES row').toEqual([]);
  });

  // D-5856 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1b; ARCH-70 (#805)).
  // Every reclaim-paused reader, at the pass and at the act, goes through `readSwitches`: the private parse sites fold
  // 10 -> 1 on C1b's tip. The one left is the stop-done lane's (`stopDoneSweep.ts`), which W4 moves. May only shrink.
  it('reclaim-paused is parsed at <= 1 site outside readSwitches (may only shrink)', () => {
    const sites = reclaimPauseParseSites();
    expect(sites.length, 'a private includes(RECLAIM_PAUSE_MARKER): read it through readSwitches').toBeLessThanOrEqual(1);
    expect(sites.map((x) => x.file)).toEqual(sites.length === 0 ? [] : ['server/src/stopDoneSweep.ts']);
  });

  // D-5853 (Task C0f; ARCH-00 (#525)). The test scanners' TS parser, the operator's option (a) (a TypeScript 6 alias),
  // has ONE importer, `server/test/scan/parse.ts`, and an exact version. The corpus is every tracked or new untracked
  // .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs file (not .d.*ts), with comment lines dropped (`stallCodeText`). Under
  // `server/` any TS parser package counts (the 7.x compiler's `typescript/unstable/*` among them); elsewhere only the
  // alias does, because the PWA's tests use the PWA's own TypeScript 6. KNOWN WIDTH: a `createRequire` require and a
  // specifier built at run time are not seen.
  const SCAN_PARSER = 'typescript-api';
  const TS_PARSERS = ['typescript', SCAN_PARSER, 'oxc-parser', '@typescript-eslint/parser',
    '@typescript-eslint/typescript-estree', '@babel/parser', '@swc/core', 'acorn', 'esprima'];
  const importsPkg = (code: string, pkgs: readonly string[]): boolean =>
    new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)['"\`](?:${pkgs.map(esc).join('|')
    })(?:/[^'"\`]*)?['"\`]`).test(code);
  const parserImporters = (): string[] => {
    const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
      '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'], { cwd: ccrcRoot, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    return [...new Set(r.stdout.split('\0').filter((f) => f && !/\.d\.[mc]?ts$/.test(f)))]
      .filter((f) => existsSync(path.join(ccrcRoot, f)))
      .filter((f) => importsPkg(stallCodeText(readFileSync(path.join(ccrcRoot, f), 'utf8')),
        f.startsWith('server/') ? TS_PARSERS : [SCAN_PARSER]))
      .sort();
  };

  it('CONTROL: the parser-import pattern sees each import form and passes over a comment and a longer name', () => {
    const sees = (code: string): boolean => importsPkg(stallCodeText(code), TS_PARSERS);
    // Each specifier is quoted by `q`, so this file's own text names none and stays out of the importer list.
    const q = (s: string, c = "'"): string => `${c}${s}${c}`;
    expect(sees(`import ts from ${q('typescript-api')};`)).toBe(true);
    expect(sees(`import {\n  createSourceFile,\n} from ${q('typescript', '"')};`)).toBe(true);
    expect(sees(`const m = await import(${q('typescript/unstable/ast')});`)).toBe(true);
    expect(sees(`const p = require(${q('oxc-parser')});`)).toBe(true);
    expect(sees(`export { parse } from ${q('@babel/parser')};`)).toBe(true);
    expect(sees(`// import ts from ${q('typescript-api')};\nconst x = 1;`)).toBe(false);
    expect(sees(`import x from ${q('typescript-api-extra')};`)).toBe(false);
  });

  it('only scan/parse.ts imports a TS parser (D-5853)', () => {
    expect(parserImporters()).toEqual(['server/test/scan/parse.ts']);
  });

  it('the parser is a dev-only dependency pinned exactly, and the lockfile resolves that version (D-5853)', () => {
    const pkg = JSON.parse(readFileSync(path.join(ccrcRoot, 'server/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const spec = pkg.devDependencies?.[SCAN_PARSER] ?? '';
    expect(spec).toMatch(/^npm:typescript@6\.\d+\.\d+$/);
    expect(pkg.dependencies?.[SCAN_PARSER]).toBeUndefined();
    const lock = JSON.parse(readFileSync(path.join(ccrcRoot, 'server/package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; dev?: boolean; devDependencies?: Record<string, string> }> };
    expect(lock.packages['']!.devDependencies?.[SCAN_PARSER]).toBe(spec);
    expect(lock.packages[`node_modules/${SCAN_PARSER}`]).toMatchObject({ version: spec.split('@').pop(), dev: true });
  });

  // D-5854 (Task C0g; ARCH-06 (#554), the W1a slice). The ratchet on literal source-text pins over W1a's files (ARCH-06's
  // whole-tree slice widened the rule to every server/src .ts file: `namesSrcFile`, `SRC_FILES`, and the last ratchet below), by the
  // ticket's written counting rule, `literalSourcePins`: a test file counts when it reads one of W1A_FILES with
  // `readFileSync` (directly, through a path constant one hop away, or through a function whose body reads it), and a
  // pin counts when `indexOf`, `match`, `toContain` or `toMatch` (the `expect` spelling of `match`) is called with a
  // string or regex literal on that read,
  // on a variable bound to it, or on one derived from such a variable (`const body = src.slice(…)`). A name resolves to
  // its innermost declaration (`parse.ts` `bindings`), so two describes' `src` stay apart. Each file's count is pinned at
  // what it measured on merge day and may only shrink: a new literal pin over a W1a file moves the region it reads onto
  // `scan/symbols.ts` (`sourceOfSymbol`, `callsIn`) instead. Security censuses keep their literal pins and move one per
  // PR (ARCH-06's risk line). KNOWN WIDTH: a read through a parameter, an object field, a loop over file names or a
  // constant more than one hop from the path literal, a pin on a value passed to a helper, and
  // `includes`/`search`/`matchAll` are not counted.
  const W1A_FILES = ['server/src/watch.ts', 'server/src/server.ts', 'server/src/interruptlog.ts',
    'server/src/coord/routes.ts', 'server/src/coord/childReclaim.ts', 'server/src/coord/expireArchived.ts',
    'server/src/coord/collectTempRoot.ts', 'server/src/coord/endDeadCoordinator.ts', 'server/src/coord/rundefs.ts'];
  // D-6114 (Task C0o; ARCH-06 (#554), the W1b slice). The same counting rule over W1b's files: `watch.ts` and
  // `coord/routes.ts` (shared with W1a), and the three only W1b moves.
  const W1B_FILES = ['server/src/watch.ts', 'server/src/coord/routes.ts', 'server/src/ccdargv.ts',
    'server/src/registry.ts', 'server/src/coord/redact.ts'];
  // ARCH-06 (#554), the whole-tree slice: the rule counts a read of ANY server/src .ts file, not only W1a's and W1b's.
  // `SRC_FILES` is what git lists under server/src; W1A_FILES and W1B_FILES keep their own rows (and ceilings) above.
  const SRC_FILES: string[] = (() => {
    const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'server/src/*.ts'],
      { cwd: ccrcRoot, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    return r.stdout.split('\0').filter((x) => x && existsSync(path.join(ccrcRoot, x))).sort();
  })();
  const RATCHET_FILES = SRC_FILES;
  const SRC_BASENAMES = new Set(SRC_FILES.map((f) => path.basename(f)));
  /** Does `text` quote a server/src basename at all? The cheap test that decides whether a test file is parsed. */
  const spellsSrcBasename = (text: string): boolean =>
    [...text.matchAll(/['"`/]([\w.-]+\.ts)['"`]/g)].some((m) => SRC_BASENAMES.has(m[1]!));
  /** The server/src files a read's source text names: the basename quoted or after a `/`; a basename that two
   *  directories share (`routes.ts`, `redact.ts`, `io.ts`) resolves to the directory the text (or the reading function's,
   *  `context`) also quotes, else to the one at server/src's root, else to nothing; a basename only ONE file has resolves
   *  to that file whatever directory the text spells (`path.join(dirVar, 'delegation-ingest.ts')`); nothing when the text names
   *  another package. */
  const namesSrcFile = (text: string, context = ''): string[] => {
    const all = `${text}\n${context}`;
    if (/['"`/](?:agent|pwa|ui|ccd|shared)['"`/]/.test(all)) return [];
    const out: string[] = [];
    for (const base of SRC_BASENAMES) {
      if (!new RegExp(`['"\`/]${esc(base)}['"\`]`).test(text)) continue;
      const same = SRC_FILES.filter((f) => path.basename(f) === base);
      const dir = (f: string): string => path.basename(path.dirname(f));
      const beside = same.filter((f) => dir(f) !== 'src' && new RegExp(`['"\`/]${esc(dir(f))}['"\`/]`).test(all));
      out.push(...(beside.length ? beside : same.length === 1 ? same : same.filter((f) => dir(f) === 'src')));
    }
    return out;
  };
  interface SourcePin { line: number; target: string; method: string; literal: string }
  /** How many texts `literalSourcePins` has parsed (D-6111's guard reads it). */
  let pinParses = 0;
  /** ARCH-06's counting rule over one test file's text (D-5854). */
  const literalSourcePins = (text: string, file = 'probe.ts'): SourcePin[] => {
    // D-6111: every target below comes from `namesSrcFile` over a substring of `text`, and it answers nothing unless
    // that substring spells a W1a basename, so a text that spells none has no pin and is not parsed. Parsing all of
    // server/test took 9.9 s of the 20 s Linux budget untraced, and timed out under the map's trace. KNOWN WIDTH: a
    // template that splits a basename across lines is joined by `flat` before `namesSrcFile` reads it, so this raw-text
    // check would miss it; no such pin exists (the counts with and without this check were measured equal).
    // D-6114: every ratcheted file's basename, W1b's too, or a pin over `ccdargv.ts` alone would never be parsed.
    if (!text.includes('readFileSync') || !spellsSrcBasename(text)) return [];
    pinParses += 1;
    const p = parseSource(text, file);
    const raw = (c: { start: number; end: number }): string => text.slice(c.start, c.end);
    const resolve = (name: string, at: number): number => {
      let best = -1;
      p.bindings.forEach((b, i) => {
        if (b.name !== name || at < b.scopeStart || at > b.scopeEnd) return;
        const o = p.bindings[best];
        if (!o || b.scopeEnd - b.scopeStart < o.scopeEnd - o.scopeStart) best = i;
      });
      return best;
    };
    const tracked = new Map<number, Set<string>>();
    const track = (i: number, targets: Iterable<string>): boolean => {
      if (i < 0) return false;
      const s = tracked.get(i) ?? new Set<string>();
      const n = s.size;
      for (const t of targets) s.add(t);
      tracked.set(i, s);
      return s.size > n;
    };
    /** The W1a files a `readFileSync(…)` call's text reads: named in it, or (one hop) in the initialiser of the binding
     *  its first argument names when that argument is a bare identifier (`readFileSync(WATCH_TS, 'utf8')`). */
    const readNames = (callText: string, at: number): string[] => {
      const id = /^readFileSync\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(callText)?.[1];
      const j = id === undefined ? -1 : resolve(id, at);
      return [...new Set([...namesSrcFile(callText), ...(j < 0 ? [] : namesSrcFile(p.bindings[j]!.init, callText))])];
    };
    const readers = new Map<string, { fixed: string[]; context: string }>();
    for (const r of p.calls.filter((c) => c.name === 'readFileSync')) {
      const names = readNames(raw(r), r.start);
      if (r.boundTo !== null) { track(resolve(r.boundTo, r.start), names); continue; }
      const fn = p.symbols.filter((s) => s.kind !== 'class' && s.start <= r.start && s.end >= r.end)
        .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      if (fn) readers.set(fn.name.split('.').pop()!, { fixed: names, context: raw(r) });
    }
    /** The W1a files an expression reads inline: `reader('x.ts')…` or `readFileSync(…'x.ts'…)…`. */
    const inlineRead = (expr: string, at: number): string[] => {
      const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
      const rd = m ? readers.get(m[1]!) : undefined;
      return !m ? [] : m[1] === 'readFileSync' ? readNames(expr, at)
        : !rd ? [] : rd.fixed.length ? rd.fixed : namesSrcFile(expr, rd.context);
    };
    for (const c of p.calls) if (c.boundTo !== null && c.name !== null && c.callee === c.name && readers.has(c.name)) {
      track(resolve(c.boundTo, c.start), inlineRead(raw(c), c.start));
    }
    for (let grew = true; grew;) {
      grew = false;
      p.bindings.forEach((b, i) => {
        // String contents are blanked (same length, so offsets hold): `'routes.ts'` names no binding `routes`.
        const init = b.init.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (q) => ' '.repeat(q.length));
        for (const m of init.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
          const j = resolve(m[0], b.initStart + m.index);
          if (j >= 0 && j !== i && tracked.has(j) && track(i, tracked.get(j)!)) grew = true;
        }
      });
    }
    const out: SourcePin[] = [];
    for (const c of p.calls) {
      const a = c.args[0];
      if (!a || a.kind === 'other' || c.head === null) continue;
      const subject = (c.name === 'indexOf' || c.name === 'match') && c.head !== 'expect'
        ? (c.headArgs === null ? c.head : `${c.head}(${c.headArgs.join(', ')})`)
        : (c.name === 'toContain' || c.name === 'toMatch') && c.head === 'expect' ? c.headArgs?.[0] ?? null : null;
      if (subject === null) continue;
      const id = /^[A-Za-z_$][\w$]*/.exec(subject)?.[0];
      const targets = new Set([...inlineRead(subject, c.start),
        ...(id === undefined ? [] : tracked.get(resolve(id, c.start)) ?? [])]);
      for (const t of targets) out.push({ line: c.line, target: t, method: c.name!, literal: a.text });
    }
    return out;
  };
  /** Every tracked or new untracked .ts file under server/test, its pins' count per ratcheted file (W1a's and W1b's,
   *  D-6114), and how many files were listed and parsed. Scanned once and shared by both ratchets and D-6111's guard. */
  /** The security censuses' test files (#554: they are exempt from the ratchet and migrate one at a time, each in its own
   *  PR). Their pins are tallied in `exempt` for information and carry no ceiling, so a security PR that adds a route
   *  or a pin never goes red here. */
  const SECURITY_CENSUS_TESTS: readonly string[] = ['server/test/auth-gate.test.ts', 'server/test/box-token-census.test.ts',
    'server/test/token-policy.test.ts', 'server/test/token-claim-route.test.ts', 'server/test/notify-token.test.ts'];
  let pinScan: { counts: Record<string, number>; exempt: Record<string, number>; listed: number; parsed: number } | undefined;
  const literalSourcePinScan = (): NonNullable<typeof pinScan> => {
    if (pinScan) return pinScan;
    const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'server/test/*.ts'],
      { cwd: ccrcRoot, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ls-files exited ${String(r.status)}: ${(r.stderr || '').trim()}`);
    const counts: Record<string, number> = Object.fromEntries(RATCHET_FILES.map((f) => [f, 0]));
    const exempt: Record<string, number> = {};
    const files = new Set(r.stdout.split('\0').filter((x) => x && existsSync(path.join(ccrcRoot, x))));
    const before = pinParses;
    // The reader functions an area file imports from this directory's helpers (`stallCode`) are read by the
    // counting rule where they are defined, so a file that imports them is scanned with the helpers' text after
    // its own: the split of this guard by area moved them out of the one file that used to hold them, and the
    // pins that reach a src file through them must keep counting (D-6928; the ratchet is exact).
    const helpersText = readFileSync(path.join(here, 'single-definition', 'helpers.ts'), 'utf8');
    for (const f of files) {
      const own = readFileSync(path.join(ccrcRoot, f), 'utf8');
      const text = /from '\.\/helpers\.js'/.test(own) && f.startsWith('server/test/single-definition/') ? `${own}\n${helpersText}` : own;
      for (const pin of literalSourcePins(text, f)) {
        if (SECURITY_CENSUS_TESTS.includes(f)) exempt[pin.target] = (exempt[pin.target] ?? 0) + 1;
        else counts[pin.target]! += 1;
      }
    }
    pinScan = { counts, exempt, listed: files.size, parsed: pinParses - before };
    return pinScan;
  };
  /** The shared scan's counts for `files` alone, in their order (D-6114: one scan serves both ratchets). */
  const literalSourcePinCounts = (files: readonly string[] = W1A_FILES): Record<string, number> => {
    const { counts } = literalSourcePinScan();
    return Object.fromEntries(files.map((f) => [f, counts[f]!]));
  };

  // D-6111. The ratchet's scan parses only the files that spell a W1a basename, so it fits a traced run's budget; a
  // scan that parsed every listed file again would put main's map-build red whenever tracing slowed it past 20 s.
  it('the pin scan parses only the test files that spell a W1a basename (D-6111)', () => {
    const { listed, parsed } = literalSourcePinScan();
    expect(listed, 'git listed too few server/test files: the scan saw nothing').toBeGreaterThan(500);
    expect(parsed, 'no file was parsed: the ratchet would count nothing').toBeGreaterThan(0);
    expect(parsed, 'the scan parsed most of server/test again').toBeLessThan(listed / 3);
  });

  it('CONTROL (fixture): the counting rule sees a read, a reader, a slice and an inline read, and keeps scopes apart', () => {
    const pins = (code: string): string[] =>
      literalSourcePins(code).map((x) => `${x.line} ${x.target.replace('server/src/', '')} ${x.method} ${x.literal}`);
    const L = (...lines: string[]): string => lines.join('\n');
    expect(pins(L(
      "const src = codeOnly(readFileSync(path.join(srcDir, 'watch.ts'), 'utf8'));",
      "const body = src.slice(src.indexOf('  tick('), src.indexOf('\\n  }\\n'));",
      "expect(body, 'the tick').not.toContain('await');",
      'expect(src).toMatch(/import \\{ X \\}/);',
      'expect(src.length).toBeGreaterThan(0);',
      "expect(src.includes('x')).toBe(true);",
    ))).toEqual(['2 watch.ts indexOf   tick(', '2 watch.ts indexOf \n  }\n', '3 watch.ts toContain await',
      '4 watch.ts toMatch /import \\{ X \\}/']);
    expect(pins(L(
      "const code = (rel: string): string => readFileSync(path.join(srcRoot, 'coord', rel), 'utf8');",
      "const routes = code('routes.ts');",
      "expect(routes).toContain('app.post(');",
      "expect(code('childReclaim.ts')).toMatch(/x/);",
      "const update = readFileSync(path.join(srcRoot, 'update', 'routes.ts'), 'utf8');",
      "expect(update).toContain('app.get(');",
      "const agent = readFileSync(path.join(root, 'agent', 'src', 'server.ts'), 'utf8');",
      "expect(agent.indexOf('listen(')).toBeGreaterThan(0);",
    ))).toEqual(['3 coord/routes.ts toContain app.post(', '4 coord/childReclaim.ts toMatch /x/',
      '6 update/routes.ts toContain app.get(']);   // the counting rule sees it; whether it is ratcheted depends on the reading test file
    expect(pins(L(
      "describe('a', () => { const src = readFileSync(join(dir, 'server.ts'), 'utf8'); expect(src).toContain('a'); });",
      "describe('b', () => { const src = readFileSync(join(dir, 'other.ts'), 'utf8'); expect(src).toContain('b'); });",
      "const watchSrc = (): string => readFileSync(join(dir, 'watch.ts'), 'utf8');",
      "it('c', () => { const w = watchSrc(); expect(w.indexOf('c')).toBe(1); });",
    ))).toEqual(['1 server.ts toContain a', '4 watch.ts indexOf c']);
    // A basename one file owns counts when the directory is built elsewhere; a shared one still needs its directory.
    expect(pins(L(
      "const a = readFileSync(path.join(dirVar, 'childReclaim.ts'), 'utf8');",
      "expect(a.indexOf('x')).toBe(1);",
      "const b = readFileSync(path.join(dirVar, 'delegation-ingest.ts'), 'utf8');",
      "expect(b).toContain('y');",
      "const c = readFileSync(path.join(dirVar, 'routes.ts'), 'utf8');",
      "expect(c).toContain('z');",
    ))).toEqual(['2 coord/childReclaim.ts indexOf x', '4 coord/delegation-ingest.ts toContain y']);
    // A read whose path sits in a constant resolves one hop through that constant's binding.
    expect(pins(L(
      "const W = path.resolve(dir, '../src/watch.ts');",
      "expect(readFileSync(W, 'utf8')).toContain('x');",
      "const S = path.join(root, 'server', 'src', 'server.ts');",
      "const s = readFileSync(S, 'utf8');",
      "expect(s.match(/y/)).not.toBeNull();",
      "const A = path.join(root, 'agent', 'src', 'server.ts');",
      "expect(readFileSync(A, 'utf8')).toContain('z');",
    ))).toEqual(['2 watch.ts toContain x', '5 server.ts match /y/']);
  });

  it('literal source pins over W1a\'s files may only shrink (D-5854; ARCH-06\'s counting rule)', () => {
    // Measured on merge day. Lower a row when a pin moves onto scan/symbols.ts; never raise one.
    const CEILING: Record<string, number> = {
      'server/src/watch.ts': 79,
      'server/src/server.ts': 23,
      'server/src/interruptlog.ts': 0,
      'server/src/coord/routes.ts': 38,
      'server/src/coord/childReclaim.ts': 6,
      'server/src/coord/expireArchived.ts': 0,
      'server/src/coord/collectTempRoot.ts': 0,
      'server/src/coord/endDeadCoordinator.ts': 5,
      'server/src/coord/rundefs.ts': 0,
    };
    const counts = literalSourcePinCounts();
    expect(Object.keys(counts)).toEqual(Object.keys(CEILING));
    for (const f of W1A_FILES) {
      expect(counts[f], `${f}: a new literal source pin — key it on scan/symbols.ts (sourceOfSymbol) `
        + 'or a parse.ts-based census instead (and lower the row to the new count: the ratchet is exact)')
        .toBe(CEILING[f]!);
    }
  });

  it('CONTROL (fixture, D-6114): W1b\'s three files are counted the same way, `redact.ts` whatever directory is spelled, a package\'s own `registry.ts` not', () => {
    const pins = (code: string): string[] =>
      literalSourcePins(code).map((x) => `${x.line} ${x.target.replace('server/src/', '')} ${x.method} ${x.literal}`);
    expect(pins([
      "const a = readFileSync(path.join(srcDir, 'ccdargv.ts'), 'utf8');",
      "expect(a).toContain('x');",
      "const b = readFileSync(path.join(srcDir, 'registry.ts'), 'utf8');",
      "expect(b.indexOf('y')).toBe(1);",
      "const c = readFileSync(path.join(srcDir, 'coord', 'redact.ts'), 'utf8');",
      'expect(c).toMatch(/z/);',
      "const d = readFileSync(path.join(srcDir, 'docs', 'redact.ts'), 'utf8');",
      "expect(d).toContain('w');",
      "const e = readFileSync(path.join(root, 'pwa', 'src', 'command', 'registry.ts'), 'utf8');",
      "expect(e).toContain('v');",
    ].join('\n'))).toEqual(['2 ccdargv.ts toContain x', '4 registry.ts indexOf y', '6 coord/redact.ts toMatch /z/',
      '8 coord/redact.ts toContain w']);   // ARCH-06: a basename one file owns resolves to it whatever directory the text spells
  });

  // D-6114 (Task C0o; ARCH-06 (#554), the W1b slice). The same rule over W1b's files, its own ceiling, so a slice moved
  // onto scan/symbols.ts ahead of W1b lowers a row here. Measured on this slice's tip; may only shrink.
  it('literal source pins over W1b\'s files may only shrink (D-6114; ARCH-06\'s counting rule)', () => {
    const CEILING: Record<string, number> = {
      'server/src/watch.ts': 79,
      'server/src/coord/routes.ts': 38,
      'server/src/ccdargv.ts': 6,
      'server/src/registry.ts': 2,
      'server/src/coord/redact.ts': 0,
    };
    const counts = literalSourcePinCounts(W1B_FILES);
    expect(Object.keys(counts)).toEqual(Object.keys(CEILING));
    for (const f of W1B_FILES) {
      expect(counts[f], `${f}: a new literal source pin — key it on scan/symbols.ts (sourceOfSymbol) `
        + 'or a parse.ts-based census instead (and lower the row to the new count: the ratchet is exact)')
        .toBe(CEILING[f]!);
    }
  });

  // ARCH-06 (#554), the whole-tree slice. W1a's and W1b's rows above keep their own ceilings; this is every OTHER
  // server/src file, measured on merge day. A file absent from the table has a ceiling of 0, so the first literal pin
  // over a file nobody pinned before is red. Lower a row when a pin moves onto `scan/symbols.ts`; never raise one.
  // The security censuses' test files (SECURITY_CENSUS_TESTS) are exempt, as the ticket says: their pins are not counted
  // here and have no row, so each migrates in its own PR. Another test's pin over those src files still counts.
  /** The files whose pin count exceeds their ceiling (absent = 0), in `files`' order. A named function so a fixture can
   *  prove the check is red on a new pin. */
  const overCeiling = (counts: Record<string, number>, ceiling: Record<string, number>, files: readonly string[]): string[] =>
    files.filter((f) => (counts[f] ?? 0) > (ceiling[f] ?? 0));

  it('CONTROL (fixture, ARCH-06): a new pin in a security census test file is exempt, in any other test file it counts', () => {
    const { exempt } = literalSourcePinScan();
    expect(Object.keys(exempt).length, 'the exempt tally saw no security census pin').toBeGreaterThan(0);
    expect(SECURITY_CENSUS_TESTS.every((f) => existsSync(path.join(ccrcRoot, f))), 'an exempt file is gone').toBe(true);
    const gate = 'server/src/auth/gate.ts';
    const extra = literalSourcePins("expect(readFileSync(path.join(srcRoot, 'auth', 'gate.ts'), 'utf8')).toContain('x');", 'probe.ts');
    expect(extra.map((x) => x.target)).toEqual([gate]);
    // The scan's rule: a pin read from an exempt file never reaches `counts`, so a new one cannot be over a ceiling.
    expect(SECURITY_CENSUS_TESTS.includes('server/test/auth-gate.test.ts')).toBe(true);
    expect(SECURITY_CENSUS_TESTS.includes('server/test/other.test.ts')).toBe(false);
    expect(literalSourcePinScan().counts[gate] ?? 0, 'auth/gate.ts has no row: only a non-census test may pin it').toBe(0);
    expect(overCeiling({ [gate]: 1 }, {}, [gate])).toEqual([gate]);
  });

  it('CONTROL (fixture, ARCH-06): one new indexOf source pin over an unpinned file is counted, and over its ceiling', () => {
    const code = "const src = readFileSync(path.join(srcDir, 'coord', 'rundefs.ts'), 'utf8');\nexpect(src.indexOf('x')).toBe(1);";
    expect(literalSourcePins(code).map((x) => `${x.target} ${x.method}`)).toEqual(['server/src/coord/rundefs.ts indexOf']);
    expect(overCeiling({ 'server/src/coord/rundefs.ts': 1 }, {}, ['server/src/coord/rundefs.ts'])).toEqual(['server/src/coord/rundefs.ts']);
    expect(overCeiling({ 'server/src/coord/store.ts': 56 }, { 'server/src/coord/store.ts': 56 }, ['server/src/coord/store.ts'])).toEqual([]);
  });

  it('literal source pins over every other server/src file may only shrink (ARCH-06; the counting rule)', () => {
    const CEILING: Record<string, number> = {
      'server/src/accounts/mask.ts': 1,
      'server/src/askbody.ts': 1,
      'server/src/askkey.ts': 1,
      'server/src/askwindow.ts': 1,
      'server/src/auth/sessions.ts': 3,
      'server/src/auth/webauthn.ts': 2,
      'server/src/childReclaimSweep.ts': 7,
      'server/src/collectLane.ts': 7,
      'server/src/config.ts': 3,
      'server/src/coord/caps.ts': 6,
      'server/src/coord/close.ts': 2,
      'server/src/coord/collectLaneJournal.ts': 5,
      'server/src/coord/db.ts': 4,
      'server/src/coord/delegation-checkpoint.ts': 33,
      'server/src/coord/delegation-correlation.ts': 4,
      'server/src/coord/delegation-ingest.ts': 5,
      'server/src/coord/delegation-journal.ts': 14,
      'server/src/coord/delegation-model.ts': 5,
      'server/src/coord/delegation-policy.ts': 6,
      'server/src/coord/digest.ts': 2,
      'server/src/coord/dispatch.ts': 5,
      'server/src/coord/dispatchDecide.ts': 3,
      'server/src/coord/drift.ts': 1,
      'server/src/coord/envelope.ts': 3,
      'server/src/coord/heldFor.ts': 2,
      'server/src/coord/items.ts': 5,
      'server/src/coord/kickoff.ts': 4,
      'server/src/coord/landing.ts': 6,
      'server/src/coord/placement.ts': 7,
      'server/src/coord/reclaim.ts': 4,
      'server/src/coord/released.ts': 5,
      'server/src/coord/schema.ts': 3,
      'server/src/coord/stall.ts': 6,
      'server/src/coord/stallsettings.ts': 5,
      'server/src/coord/store.ts': 56,
      'server/src/coord/token.ts': 1,
      'server/src/deps.ts': 2,
      'server/src/docs/policy.ts': 10,
      'server/src/exec.ts': 1,
      'server/src/fleet.ts': 3,
      'server/src/hibernateSweep.ts': 2,
      'server/src/hookstate.ts': 3,
      'server/src/index.ts': 38,
      'server/src/inject/ask.ts': 4,
      'server/src/inject/send.ts': 3,
      'server/src/io.ts': 8,
      'server/src/limits.ts': 1,
      'server/src/linear/client.ts': 2,
      'server/src/livestate.ts': 2,
      'server/src/localcaps.ts': 3,
      'server/src/pane/dialog.ts': 4,
      'server/src/poolrule.ts': 6,
      'server/src/pools.ts': 2,
      'server/src/prstate.ts': 2,
      'server/src/remote/io.ts': 1,
      'server/src/remote/runner.ts': 1,
      'server/src/stopDoneSweep.ts': 3,
      'server/src/turnidle.ts': 9,
      'server/src/update/converge.ts': 12,
      'server/src/update/dispatch.ts': 8,
      'server/src/update/resolve.ts': 2,
      'server/src/update/routes.ts': 1,
    };
    const { counts } = literalSourcePinScan();
    const taken = new Set([...W1A_FILES, ...W1B_FILES]);
    const rest = SRC_FILES.filter((f) => !taken.has(f));
    expect(Object.keys(CEILING).filter((f) => !rest.includes(f)), 'a ceiling row names a file that is gone or has its own table').toEqual([]);
    for (const f of Object.keys(CEILING)) {
      expect(counts[f] ?? 0, `${f}: the row is not what the scan measures — lower it when a pin moves (exact, so no slack hides a new pin)`).toBe(CEILING[f]!);
    }
    expect(overCeiling(counts, CEILING, rest), 'a new literal source pin over these files — key it on scan/symbols.ts '
      + '(sourceOfSymbol, callsIn, sqlStatementsIn) or a parse.ts-based census instead').toEqual([]);
  });
});


// D-5866 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1k, Step 4;
// ARCH-71 (#806); spec §5.1 rule 3). The capability ratchet, placed directly after the ARCH-40 tail block and ahead of
// the next appended block, so no cited line above it moves. Every verb question goes through `ccdCan(state, row)`:
// a `verbSupported(` or a verb-tagged `capSupported(` (`consolidationCensus.ts`'s `capabilityChoiceSites`, tagged
// from `CCD_CAN`) may stand only in W4's two files, which W1b never edits (three `verbSupported(` there). `watch.ts`'s
// seven deferred calls moved in the follow-up `c1k-watch-after-c1f`, so nothing else is exempt. The W4 set may only
// shrink. Flag and verb-precondition sites are reported, never ratcheted. The census is loaded inside the rows, so
// this block adds no import line.
describe('one verb question (ARCH-71): ccdCan(state, row) (D-5866)', () => {
  it('no verb question outside ccdCan, except W4\'s three', async () => {
    const { capabilityChoiceSites, W4_HELD_FILES } = await import('../consolidationCensus.js');
    const sites = await capabilityChoiceSites();
    const legacy = sites.filter((x) => x.tag === 'verb' && x.form !== 'ccdCan');
    const show = (xs: typeof sites): string[] => xs.map((x) => `${x.file}:${x.line} ${x.text.trim()}`);
    expect(show(legacy), 'ask ccdCan(state, row) instead').toEqual([]);
    const w4 = sites.filter((x) => x.tag === 'w4-held');
    expect(w4.filter((x) => x.form === 'verbSupported').length, 'W4\'s three verb sites may only shrink')
      .toBeLessThanOrEqual(3);
    expect(w4.every((x) => W4_HELD_FILES.includes(x.file))).toBe(true);
    console.log(`capability census: flag ${sites.filter((x) => x.tag === 'flag').length}, verb-precondition ${
      sites.filter((x) => x.tag === 'verb-precondition').length}, w4-held ${w4.length}, ccdCan ${
      sites.filter((x) => x.form === 'ccdCan').length}`);
  });

  it('CONTROL: the census tags a planted verbSupported( outside W4 as a verb', async () => {
    const { capabilityChoiceSites } = await import('../consolidationCensus.js');
    const { mkdtempSync: mk, mkdirSync: md, writeFileSync: wf, rmSync: rm } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tree = mk(path.join(tmpdir(), 'ccd-can-ratchet-'));
    try {
      md(path.join(tree, 'server/src'), { recursive: true });
      wf(path.join(tree, 'server/src/x.ts'), 'if (!verbSupported(state, CCD_ARGV.wsHold(id, r, null))) return;\n');
      const [x] = await capabilityChoiceSites(tree);
      expect([x?.form, x?.tag]).toEqual(['verbSupported', 'verb']);
    } finally {
      rm(tree, { recursive: true, force: true });
    }
  });
});


// D-5861 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1g, Step 4;
// ARCH-76 (#811); spec §5.1 rule 3). The change-latch ratchet, placed after the capability ratchet above and ahead of
// the next appended block. "Warn once until it changes" is `changeLatch` (`server/src/changeLatch.ts`): no `last*` field
// of `FleetWatcher` is compared with a key before a `console.warn` and assigned in the same method
// (`consolidationCensus.ts`'s `changeLatchSites`, a parse.ts-based query). The count may only shrink, and it is 0.
// `DelegationLane#lastMarkWarnHour` has the same shape and is another series' file, so it is reported
// (`changeLatchReported`), never counted, until a later PR moves it. The census is loaded inside the rows, so this
// block adds no import line.
describe('one change latch (ARCH-76): changeLatch (D-5861)', () => {
  it('no hand-rolled change latch remains', async () => {
    const { changeLatchSites } = await import('../consolidationCensus.js');
    expect(changeLatchSites().map((x) => `${x.file}:${x.line} ${x.text.trim()}`),
      'use changeLatch() from server/src/changeLatch.ts instead of a last* field').toEqual([]);
  });

  it('CONTROL: the census sees a planted latch', async () => {
    const { changeLatchSites } = await import('../consolidationCensus.js');
    const { mkdtempSync: mk, mkdirSync: md, writeFileSync: wf, rmSync: rm } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tree = mk(path.join(tmpdir(), 'change-latch-ratchet-'));
    try {
      md(path.join(tree, 'server/src'), { recursive: true });
      wf(path.join(tree, 'server/src/watch.ts'), [
        'class FleetWatcher {',
        '  f(key: string): void {',
        '    if (key !== this.lastFooWhy) console.warn(key);',
        '    this.lastFooWhy = key;',
        '  }',
        '}',
      ].join('\n'));
      expect(changeLatchSites(tree)).toHaveLength(1);
    } finally {
      rm(tree, { recursive: true, force: true });
    }
  });

  // ARCH-76 follow-up (D-6991): a `warn…Once` helper outside changeLatch.ts is a row of
  // `ONCE_WARN_ALLOWED` with its reason, or it is a change latch and uses changeLatch(). The list only shrinks, and a
  // row whose helper has gone is stale and fails too.
  it('every warn…Once helper outside changeLatch.ts is allowlisted with a reason, 1 row (tmpSweepLane.ts)', async () => {
    const { onceWarnDefinitions, ONCE_WARN_ALLOWED } = await import('../consolidationCensus.js');
    const allowed = new Set(ONCE_WARN_ALLOWED.map((r) => r.file));
    const sites = onceWarnDefinitions();
    expect(sites.filter((s) => !allowed.has(s.file)).map((s) => `${s.file}:${s.line} ${s.text.trim()}`),
      'use changeLatch() from server/src/changeLatch.ts, or add a ONCE_WARN_ALLOWED row saying why it is not a change latch').toEqual([]);
    expect(ONCE_WARN_ALLOWED.filter((r) => !sites.some((s) => s.file === r.file)).map((r) => r.file), 'a stale allowlist row').toEqual([]);
    expect(ONCE_WARN_ALLOWED.every((r) => r.reason.trim().length > 0), 'a row without a reason').toBe(true);
    expect(ONCE_WARN_ALLOWED.length, 'the allowlist only shrinks').toBeLessThanOrEqual(1);
  });
});


// D-5862 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1h, Step 6;
// ARCH-68 (#803); spec K11, §2.3's clock row, §5.1 rule 1b). The lane-schedule ratchet, placed after the change-latch
// ratchet above and ahead of the next appended block. A lane's cadence, clock, single flight and catch are one row of
// `LANE_SCHEDULE` (`server/src/laneSchedule.ts`) and one `runLane` (`FleetWatcher`): no lane keeps a `last*` clock or a
// guard field of its own. Named by `consolidationCensus.ts`'s `laneClockFields` and `singleFlightGuards`, and for a clock
// nobody named by `laneClockShapes` (a numeric field compared as `now - this.X < CONST`). What stays is reported by name:
// W4's two lanes (`stopDoneSweeping`/`lastStopDoneSweep`, `hibernateSweeping`/`lastHibernateSweep`), the tick's own guard,
// `dispatchNow`'s run and its one follow-up (a trigger with no cadence). `DelegationLane#lastSweepAt` is the `delegation` row
// (the series that held that class has merged). Each counts only down. The census is loaded inside the rows, so this block adds no import line.
describe('one lane schedule (ARCH-68): LANE_SCHEDULE and runLane (D-5862)', () => {
  const text = (xs: ReadonlyArray<{ text: string }>): string[] => xs.map((x) => x.text.trim());

  it('only W4\'s two clocks remain as lane clock fields, and no unnamed clock is compared with a constant', async () => {
    const { laneClockFields, laneClockShapes } = await import('../consolidationCensus.js');
    expect(text(laneClockFields()), 'a lane clock is a row of LANE_SCHEDULE, not a field').toEqual([
      'private lastStopDoneSweep = 0;', 'private lastHibernateSweep = 0;',
    ]);
    const shapes = laneClockShapes().map((x) => x.text.trim());
    expect(shapes.filter((t) => !/lastStopDoneSweep|lastHibernateSweep/.test(t)), 'no lane clock outside runLane').toEqual([
      // Nothing remains in `FleetWatcher`. Four lanes that landed on main while this ratchet was in review kept clocks of their
      // own, and the consolidation (GitHub #1279) moved them out: the orphan-worktree lane (D-6631) is the `orphanTrees` row now,
      // and the stale-archive arm (D-6643), the disk alarm (D-6615) and the tmp sweep census (D-6624) keep their wall-clock
      // throttles in `StaleArchiveBeat`, `DiskAlarmLane` and `TmpCensusBeat`. Making those three rows is a follow-up (#1391; the
      // rows are monotonic, so it changes their clock); the next test names them. This list only shrinks.
    ]);
  });

  // The three wall-clock throttles the `laneClockShapes` census cannot see (it scans `FleetWatcher` only), named so they stay bound
  // (GitHub #1391, the follow-up that makes them rows and so changes their clock). This list only shrinks.
  it('the three beat classes keep exactly their three throttle lines and the one single-flight guard, #1391', () => {
    const lines = (f: string): string[] => readFileSync(path.join(ccrcRoot, f), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => /now - this\.\w+ < \w+|this\.sweeping\b|private sweeping\b/.test(l));
    expect({
      'server/src/diskAlarmLane.ts': lines('server/src/diskAlarmLane.ts'),
      'server/src/tmpSweepLane.ts': lines('server/src/tmpSweepLane.ts'),
      'server/src/staleArchiveBeat.ts': lines('server/src/staleArchiveBeat.ts'),
    }, 'a beat\'s clock or guard is a row of LANE_SCHEDULE (#1391); no new one').toEqual({
      'server/src/diskAlarmLane.ts': ['if (this.lastSweep !== 0 && now - this.lastSweep < DISK_SWEEP_MS) return;'],
      'server/src/tmpSweepLane.ts': ['if (this.last !== 0 && now - this.last < TMP_SWEEP_CENSUS_MS) return;'],
      'server/src/staleArchiveBeat.ts': [
        'private sweeping = false;',
        'if (this.sweeping || (this.last !== 0 && now - this.last < STALE_ARCHIVE_SWEEP_MS)) return;',
        'this.sweeping = true;',
        'this.sweeping = false;',
      ],
    });
  });

  it('only the tick\'s guard, dispatchNow\'s run and its follow-up, and W4\'s two guards remain as single-flight fields', async () => {
    const { singleFlightGuards } = await import('../consolidationCensus.js');
    expect(text(singleFlightGuards()).sort(), 'a lane\'s single flight is its row\'s flight').toEqual([
      'private dispatchAgain = false;', 'private dispatchRun: Promise<DispatchRunResult> | null = null;',
      'private hibernateSweeping = false;', 'private stopDoneSweeping = false;', 'private ticking = false;',
    ]);
  });

  it('the delegation lane keeps no clock or guard of its own: its cadence and single flight are the `delegation` row', async () => {
    const { laneClockReported } = await import('../consolidationCensus.js');
    expect(laneClockReported(), 'DelegationLane#lastSweepAt is a row of LANE_SCHEDULE').toEqual([]);
  });

  it('no throttle reads the wall clock: every row of LANE_SCHEDULE is monotonic (OA-C4, ruled (a) on #803), 0 wall rows', async () => {
    const { LANE_SCHEDULE } = await import('../../src/laneSchedule.js');
    expect(LANE_SCHEDULE.filter((r) => r.clock === 'wall').map((r) => r.name), 'a throttle on Date.now(): verdicts keep the wall clock, cadences do not').toEqual([]);
  });

  it('no bare cadence literal is compared with a lane clock', async () => {
    const { cadenceLiterals } = await import('../consolidationCensus.js');
    expect(text(cadenceLiterals()), 'a cadence is a named row').toEqual([]);
  });

  it('each declared derivation is a reference to the constant it follows, 3 of 3', async () => {
    const { declaredDerivations } = await import('../consolidationCensus.js');
    const d = declaredDerivations();
    expect(d.filter((x) => x.file === null).map((x) => x.name), 'a derivation is declared nowhere').toEqual([]);
    expect(d.filter((x) => !x.reference).map((x) => x.name), 'each derivation is a reference').toEqual([]);
    expect(d).toHaveLength(3);
  });

  it('CONTROL: the census sees a planted clock, guard, literal and re-declared derivation', async () => {
    const { laneClockShapes, singleFlightGuards, cadenceLiterals, declaredDerivations } = await import('../consolidationCensus.js');
    const { mkdtempSync: mk, mkdirSync: md, writeFileSync: wf, rmSync: rm } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tree = mk(path.join(tmpdir(), 'lane-schedule-ratchet-'));
    try {
      md(path.join(tree, 'server/src'), { recursive: true });
      wf(path.join(tree, 'server/src/watch.ts'), [
        'class FleetWatcher {',
        '  private lastFooSweep = 0;',
        '  private collectSweeping = false;',
        '  f(now: number): void { if (now - this.lastFooSweep < 60_000) return; }',
        '}',
        'export const COLLECT_OBSERVE_INTERVAL_MS = 60_000;',
      ].join('\n'));
      expect(laneClockShapes(tree)).toHaveLength(1);
      expect(singleFlightGuards(tree)).toHaveLength(1);
      expect(cadenceLiterals(tree)).toHaveLength(1);
      expect((declaredDerivations(tree)).find((x) => x.name === 'COLLECT_OBSERVE_INTERVAL_MS')?.reference).toBe(false);
    } finally {
      rm(tree, { recursive: true, force: true });
    }
  });
});


// D-5864 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1j, Step 4;
// ARCH-51 (#786); spec K13's listing half). The one-listing ratchet, placed after the lane-schedule ratchet above and ahead
// of the next appended block. A steady tick lists the registry once to choose rows (`FleetWatcher.tick`, which builds the
// `FleetReadModel`); every lane that chooses its rows takes that model. What stays fresh is named: the mail lane's switch
// read and the divergence census's listing (`ACT_LISTING_METHODS`), the tick's snapshot re-confirmation, and each lane's
// own read when called with no model, reached by tests alone (`TESTS_ONLY_LISTING_METHODS`). Named by `consolidationCensus.ts`'s
// `registryListingSites`, a parse-based query. The count of selection sites outside the tick may only shrink, and it is 0.
// The census is loaded inside the rows, so this block adds no import line.
describe('one registry listing per tick (ARCH-51): the tick\'s FleetReadModel (D-5864)', () => {
  const where = (xs: ReadonlyArray<{ line: number; method: string; text: string }>): string[] => xs.map((x) => `${x.method}:${x.line} ${x.text.trim()}`);

  it('no lane selects its rows from a registry listing of its own: a selection site stands only in tick', async () => {
    const { registryListingSites, SELECTION_LISTING_METHOD } = await import('../consolidationCensus.js');
    const lanes = registryListingSites().filter((x) => x.tag === 'selection' && x.method !== SELECTION_LISTING_METHOD);
    expect(where(lanes), 'take the tick\'s FleetReadModel (fleetFor) instead of listing the registry').toEqual([]);
  });

  it('the tick lists once to select, and the act-time reads stand where they are named', async () => {
    const { registryListingSites, SELECTION_LISTING_METHOD, ACT_LISTING_METHODS } = await import('../consolidationCensus.js');
    const sites = registryListingSites();
    expect(where(sites.filter((x) => x.tag === 'selection')), 'exactly one selection listing, the tick\'s').toHaveLength(1);
    expect(sites.filter((x) => x.tag === 'selection').every((x) => x.method === SELECTION_LISTING_METHOD)).toBe(true);
    expect([...new Set(sites.filter((x) => x.tag === 'act' && x.method !== SELECTION_LISTING_METHOD).map((x) => x.method))].sort())
      .toEqual([...ACT_LISTING_METHODS].sort());
  });

  it('CONTROL: the census sees a lane that lists for itself', async () => {
    const { registryListingSites } = await import('../consolidationCensus.js');
    const { mkdtempSync: mk, mkdirSync: md, writeFileSync: wf, rmSync: rm } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tree = mk(path.join(tmpdir(), 'listing-ratchet-'));
    try {
      md(path.join(tree, 'server/src'), { recursive: true });
      wf(path.join(tree, 'server/src/watch.ts'), [
        'class FleetWatcher {',
        '  async tick(): Promise<void> { await readRegistryMeasured(io, cfg); }',
        '  private async fooPass(): Promise<void> { await readRegistry(io, cfg); }',
        '}',
      ].join('\n'));
      expect(registryListingSites(tree).filter((x) => x.tag === 'selection' && x.method !== 'FleetWatcher.tick')).toHaveLength(1);
    } finally {
      rm(tree, { recursive: true, force: true });
    }
  });
});
