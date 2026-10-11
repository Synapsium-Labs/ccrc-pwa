// THE RECYCLED-SLUG PROOF'S THREE PREMISES, PINNED BY SCAN (child-workspace reclamation wave 7, spec 2026-09-22
// §5.10). The collector's proof that no spawn on a recycled slug can lose its leaf rests on three facts about the code
// that HANDS a leaf out.
// Each is one line a later change could quietly break, so each is scanned for, each scan is measured against planted
// lines (the CONTROL below), and each is measured red under mutation (the plan's table):
//   1. ONE TMPDIR COMPOSER. `_child_tmpdir` is called from ONE line, in `_spawn_start`, which composes the child's
//      TMPDIR from its answer; no other line composes a TMPDIR from a value, exports one, or points one under
//      `.cc-tmp`. (`ccd-child-tmpdir.test.ts` pins the FUNCTION that calls it; this pins the LINE.)
//   2. ONE `.child` WRITER. `cmd_ws_add`'s `_reg_set "$id" child …`. Nothing else writes the marker by name, by a
//      redirect or by a file verb into the registry, and every `_reg_set` whose FIELD is a variable — any of which
//      could be handed `child` — is on a reviewed census.
//   3. THE MARKER IS READ BEFORE THE MKDIR, BY DIRECT LOOKUP. `_child_tmpdir` reads `$REG/<id>.child` through
//      `_reg_get` — a path test, never a listing, so an unlistable registry cannot blind it — and answers rc 1 before
//      it makes anything.
// LITERAL PINS, and only that: a writer spelled through `eval`, a registry path held in another variable, a field
// assembled into `child` by concatenation, or a command split across a line continuation is not seen. The census in
// (2) is the backstop for the field shapes; review is the backstop for the rest.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const REPO = path.resolve(path.dirname(CCD), '..');
const ROOTS = [path.join(REPO, 'ccd'), path.join(REPO, 'deploy')];

const walk = (dir: string, keep: (p: string) => boolean, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (e.isFile() && keep(p)) out.push(p);
  }
  return out;
};
/** Every shell script shipped under the roots, found by SHEBANG (`sh` or `bash`), never by a hand-kept list. */
const shellScripts = (roots: readonly string[]): string[] => roots.flatMap((r) => walk(r, (p) =>
  /^#!.*[/ ](ba)?sh(\s|$)/.test(fs.readFileSync(p, 'utf8').split('\n', 1)[0] ?? ''))).sort();
const pythonFiles = (roots: readonly string[]): string[] => roots.flatMap((r) => walk(r, (p) => p.endsWith('.py'))).sort();

/** A line as CODE: a whole-line comment is none, and a trailing ` # …` comment is cut. */
const codeOf = (line: string): string | null => (/^\s*#/.test(line) ? null : line.replace(/\s#\s.*$/, ''));
/** Every code line matching `re`, as `<file> <function>: <code>` — the function being the last `name() {` at column 0
 *  above it. */
const hits = (files: readonly string[], re: RegExp): string[] => files.flatMap((file) => {
  let fn = '(top level)';
  const out: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(raw);
    if (def) fn = def[1]!;
    const code = codeOf(raw);
    if (code !== null && re.test(code)) out.push(`${path.relative(REPO, file)} ${fn}: ${code.trim()}`);
  }
  return out;
});

/** (1) A CALL of `_child_tmpdir`: its name, not followed by `()`. */
const CALLS_CHILD_TMPDIR = /\b_child_tmpdir\b(?!\(\))/;
/** (1) A TMPDIR COMPOSED FROM A VALUE: `TMPDIR=`, a quote, an expansion — the shape that puts a computed path into an
 *  environment string. A message that merely names `TMPDIR=$x` carries no quote, and a Python `b"TMPDIR="` no `$`. */
const COMPOSES_TMPDIR = /\bTMPDIR=["']\$/;
/** (1) A TMPDIR pointed under `.cc-tmp`, or exported. */
const TMPDIR_UNDER_CC_TMP = /\bTMPDIR=[^\s;]*\.cc-tmp\b|\bexport\s+TMPDIR\b/;
/** (2) The marker written BY NAME through the registry setter. */
const SETS_CHILD = /\b_reg_set\s+\S+\s+["']?child["']?(\s|$)/;
/** (2) A registry path ending `.child` as the target of a redirect or of a file verb. Anchored at the registry
 *  (`$REG`, `$_SVC_REG`, `$reg`, or a spelled `.cc-sessions`): `ccd-account-auth`'s `$AUTH_RUN/in.child` FIFO is not
 *  the marker. */
const WRITES_CHILD_PATH =
  /(>{1,2}|\b(mv|cp|ln|install|touch|tee)\b[^;&|]*?)\s*["']?(\$\{?(REG|_SVC_REG|reg)\}?|[^\s"'<>]*\.cc-sessions)\/[^\s"'<>]*\.child["']?(\s|;|$)/;
/** (2) A `_reg_set` whose FIELD is a variable. */
const VARIABLE_FIELD = /\b_reg_set\s+\S+\s+["']?\$/;

/** The four variable-field `_reg_set` calls measured at b0647d850, by the function each sits in, and why none can be
 *  handed `child`: `cmd_route` and `_route_argv_write` write a route field the route vocabulary validated first
 *  (`_route_valid`), `_pane_narrow_note` writes `<site>narrownote`, and `_route_note_floored` writes a marker every
 *  caller spells as a literal note name (`routenote…`, `swappinnote`). A new one is a possible second `.child` writer:
 *  review it, then add it here with the reason it cannot write `child`. */
const VARIABLE_FIELD_CENSUS = ['_pane_narrow_note', '_route_argv_write', '_route_note_floored', 'cmd_route'];

describe('premise 1 — ONE TMPDIR composer', () => {
  const files = shellScripts(ROOTS);

  it('the walk reaches ccd/ccd', () => {
    expect(files, 'the walk must reach the file the composer lives in').toContain(CCD);
  });

  it('`_child_tmpdir` is called from exactly ONE line, in `_spawn_start`, and that line composes the TMPDIR', () => {
    expect(hits(files, CALLS_CHILD_TMPDIR)).toEqual([
      `ccd/ccd _spawn_start: ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"`,
    ]);
  });

  it('no other line composes a TMPDIR from a value, and none exports one or points one under `.cc-tmp`', () => {
    expect(hits(files, COMPOSES_TMPDIR)).toEqual([
      `ccd/ccd _spawn_start: ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"`,
    ]);
    expect(hits(files, TMPDIR_UNDER_CC_TMP)).toEqual([]);
  });
});

describe('premise 2 — ONE `.child` writer', () => {
  const files = shellScripts(ROOTS);

  it('the marker is set by name at one line, in `cmd_ws_add`', () => {
    const hs = hits(files, SETS_CHILD);
    expect(hs).toHaveLength(1);
    expect(hs[0]).toMatch(/^ccd\/ccd cmd_ws_add: .*_reg_set "\$id" child "\$lc_child"/);
  });

  it('no line writes a registry `.child` path by a redirect or a file verb', () => {
    expect(hits(files, WRITES_CHILD_PATH)).toEqual([]);
  });

  it('every variable-field `_reg_set` is on the reviewed census', () => {
    expect([...new Set(hits(files, VARIABLE_FIELD).map((x) => x.replace(/^\S+ (\S+):.*$/, '$1')))].sort())
      .toEqual(VARIABLE_FIELD_CENSUS);
  });

  it('no shipped Python names a `.child` marker', () => {
    const py = pythonFiles(ROOTS);
    expect(py.length, 'the walk reached the Python helpers').toBeGreaterThan(0);
    expect(py.filter((p) => /\.child\b/.test(fs.readFileSync(p, 'utf8'))).map((p) => path.relative(REPO, p))).toEqual([]);
  });
});

describe('premise 3 — the marker is read, by direct lookup, BEFORE the mkdir', () => {
  const src = fs.readFileSync(CCD, 'utf8');

  it('`_child_tmpdir` reads `.child`, and returns on a non-child, before its one `mkdir`', () => {
    expect([...src.matchAll(/^_child_tmpdir\(\) \{/gm)], 'defined once').toHaveLength(1);
    const from = src.indexOf('\n_child_tmpdir() {');
    const code = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const read = code.indexOf('run=$(_reg_get "$id" child)');
    const judged = code.indexOf('_child_runid_valid "$run" || return 1');
    const made = code.indexOf('mkdir ');
    expect(read, 'the marker is read through `_reg_get`').toBeGreaterThan(0);
    expect(judged, 'and judged right after').toBeGreaterThan(read);
    expect(made, 'the mkdir comes after the marker is judged').toBeGreaterThan(judged);
    expect(code.match(/\bmkdir\b/g), 'one mkdir').toHaveLength(1);
  });

  it('`_reg_get` is a direct lookup — a path test, never a listing', () => {
    expect(src).toMatch(/^_reg_get\(\) \{ \[\[ -f "\$REG\/\$1\.\$2" && ! -L "\$REG\/\$1\.\$2" \]\]/m);
  });
});

describe.skipIf(process.getuid?.() === 0)('the hand-out sees `.child` whether or not the registry can be listed', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-collect-pins-'); });
  afterEach(() => { try { fs.chmodSync(path.join(h.home, '.cc-sessions'), 0o700); } catch { /* gone */ } h.cleanup(); });

  it('at 0300 (searchable, not listable) `_child_tmpdir` still reads the marker and hands the leaf out', () => {
    const out = h.sh('_reg_set demo-calm-mesa child 9; chmod 0300 "$REG"; d=$(_child_tmpdir demo-calm-mesa);'
      + ' echo "rc=$? $d"; chmod 0700 "$REG"');
    expect(out).toBe(`rc=0 ${path.join(h.home, '.cc-tmp', 'demo-calm-mesa')}`);
  });
});

describe('the CONTROL: each scan finds the shape it names, and only that', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-collect-pins-control-'); });
  afterEach(() => { h.cleanup(); });

  it('flags the planted writers and composers, and not the reads, the messages or the comments', () => {
    const dir = path.join(h.home, 'census-control');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'planted');
    fs.writeFileSync(f, [
      '#!/usr/bin/env bash',
      'ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"',
      'x=$(_child_tmpdir "$y")',
      '# _child_tmpdir "$z"',
      '_child_tmpdir() {   # a definition',
      'export TMPDIR="$HOME/.cc-tmp/$id"',
      'shown+="carries TMPDIR=$pth"',
      '_reg_set "$id" child "$run"',
      'printf \'%s\' "$r" > "$REG/$id.child"',
      'mv -f -- "$tmp" "$REG/$id.child"',
      '[[ -e "$REG/$id.child" ]] && echo yes',
      'exec 9<>"$AUTH_RUN/in.child"',
      'echo "could not write $REG/$id.child" >&2',
      '_reg_set "$id" "$k" "$v"',
      '}',
      '',
    ].join('\n'));
    expect(shellScripts([dir])).toEqual([f]);
    const at = (re: RegExp): string[] => hits([f], re).map((x) => x.replace(/^\S+ /, ''));
    expect(at(CALLS_CHILD_TMPDIR)).toEqual([
      '(top level): ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"', '(top level): x=$(_child_tmpdir "$y")']);
    expect(at(COMPOSES_TMPDIR)).toEqual([
      '(top level): ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR=\'$ctmp\'"', '_child_tmpdir: export TMPDIR="$HOME/.cc-tmp/$id"']);
    expect(at(TMPDIR_UNDER_CC_TMP)).toEqual(['_child_tmpdir: export TMPDIR="$HOME/.cc-tmp/$id"']);
    expect(at(SETS_CHILD)).toEqual(['_child_tmpdir: _reg_set "$id" child "$run"']);
    expect(at(WRITES_CHILD_PATH)).toEqual([
      '_child_tmpdir: printf \'%s\' "$r" > "$REG/$id.child"', '_child_tmpdir: mv -f -- "$tmp" "$REG/$id.child"']);
    expect(at(VARIABLE_FIELD)).toEqual(['_child_tmpdir: _reg_set "$id" "$k" "$v"']);
  });
});
