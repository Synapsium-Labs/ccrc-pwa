// W5's redactor census, held two ways (D-7071; ARCH-67, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md): a
// FIXTURE tree, so each query counts what it claims and passes over what it must not (a heredoc's body, a generated
// byte-equal copy), and the REAL tree. Two REAL rows REPORT, as `accountMarkers.test.ts` (C5a) does
// (`reportRow.ts#expectReportRow`), because their tasks move them: `pythonRedactorTables()` 1 at base (C5h takes it to 0)
// and `logLineRedactors()` 2 (C5i takes it to 1). Each prints its sites and holds only that every name is a base site or
// the plan's target and that the count never grows past the base; the exact may-only-shrink pin lands in that task's
// ratchet commit. `inlineUserinfoStrips()` 1 is at target, so it is pinned now by name with its reason and may only
// shrink: `ccd/ccrc-doctor-checks#_check_box-settings` strips one setting's DISPLAYED value (CCRC_RELEASE_BASE_URL) before
// `_upd_redact` runs over the whole doctor line, so it is not a log-line redactor (plan, item 10).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inlineUserinfoStrips, logLineRedactors, pythonRedactorTables, type RedactorSite } from './redactors.js';
import { expectReportRow } from './reportRow.js';

const SH = '#!/usr/bin/env bash\n';
const show = (name: string, sites: readonly RedactorSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.name}  (${s.file}:${s.line}  ${s.text.trim()})`).join('\n')}`);
};

let roots: string[] = [];
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots = []; });
const tree = (files: Record<string, string>): string => {
  const t = mkdtempSync(path.join(tmpdir(), 'w5-redact-'));
  roots.push(t);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(t, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, { mode: 0o755 });
  }
  return t;
};

/** A line redactor, in the two shapes the base has: a userinfo strip, and a `$HOME` -> `~` rewrite. */
const FX_REDACT = [
  'fx_redact() {',
  '  local s="${1:-}"',
  '  local sre=\':(/+)[^/@?#[:space:]]+@\'; while [[ "$s" =~ $sre ]]; do s="${s/"${BASH_REMATCH[0]}"/":${BASH_REMATCH[1]}"}"; done',
  '  printf \'%s\' "$s"',
  '}',
].join('\n');
const FX_HOME = [
  'fx_home() {',
  '  local s="$1" home="${HOME:-}"',
  '  [ -n "$home" ] && s="${s//"$home"/\\~}" && s="${s//"\\~"/~}"',
  '  printf \'%s\\n\' "$s"',
  '}',
].join('\n');
const region = (body: string): string =>
  `# ── BEGIN GENERATED REDACTOR (fixture) ──\n# ccrc:generated 1 sha256=${'0'.repeat(64)}\n${body}\n# ── END GENERATED REDACTOR ──\n`;

describe('logLineRedactors: bash functions that redact a line (D-7071)', () => {
  it('FIXTURE: a userinfo strip and a home rewrite are redactors; a function that only names $HOME, or strips without printing its line, is not', () => {
    const t = tree({
      'ccd/ccd': `${SH}${FX_REDACT}\n${FX_HOME}\nnames_home() { local d="$1"; echo "$HOME/$d"; }\n`,
      'ccd/sibling': `${SH}strip_only() { local v="$1"; [[ ! "$v" =~ ^([^/@[:space:]]*@)+ ]] || v="x"; KNOB="$v"; }\n`,
    });
    expect(logLineRedactors(t).map((s) => s.name)).toEqual(['ccd/ccd#fx_redact', 'ccd/ccd#fx_home']);
  });

  it('FIXTURE: a generated region\'s byte-equal copy of a ccd/ccd function counts zero; one byte changed counts as its own', () => {
    const copy = tree({ 'ccd/ccd': `${SH}${FX_REDACT}\n`, 'ccd/sibling': `${SH}${region(FX_REDACT)}main() { fx_redact "$1"; }\n` });
    expect(logLineRedactors(copy).map((s) => s.name)).toEqual(['ccd/ccd#fx_redact']);
    const edited = tree({ 'ccd/ccd': `${SH}${FX_REDACT}\n`, 'ccd/sibling': `${SH}${region(FX_REDACT.replace('${1:-}', '${1-}'))}` });
    expect(logLineRedactors(edited).map((s) => s.name)).toEqual(['ccd/ccd#fx_redact', 'ccd/sibling#fx_redact']);
  });

  it('REAL: reported by name (2 at base, `ccd/ccrc#_upd_redact` and `ccd/ccd-update-sync#redact`; C5i takes it to 1)', () => {
    const sites = logLineRedactors();
    show('logLineRedactors', sites);
    expectReportRow('logLineRedactors', sites.map((s) => s.name), ['ccd/ccd-update-sync#redact', 'ccd/ccrc#_upd_redact'], ['ccd/ccrc#_upd_redact'], 1);
  });
});

describe('inlineUserinfoStrips: userinfo strips outside a counted function, in bash code only (D-7071)', () => {
  const PY_HEREDOC = [
    '_fx_py() {',
    "  python3 /dev/fd/3 \"$@\" 3<<'FX_PY'",
    "RULES=((r'(://)[^/@\\t\\n\\v\\f\\r ]+@','***@'),)",
    'FX_PY',
    '}',
  ].join('\n');
  const BASH_STRIP = 'knob_show() {\n  local v="$1"\n  [[ ! "$v" =~ ^([^/@[:space:]]*@)+ ]] || v="${v#"${BASH_REMATCH[0]}"}"; KNOB="$v"\n}';

  it('FIXTURE: a heredoc whose body holds the shape reports nothing; the same shape on a bash line outside a counted function reports one', () => {
    expect(inlineUserinfoStrips(tree({ 'ccd/ccd': `${SH}${PY_HEREDOC}\n` }))).toEqual([]);
    expect(inlineUserinfoStrips(tree({ 'ccd/ccd': `${SH}${PY_HEREDOC}\n`, 'ccd/checks': `${SH}${BASH_STRIP}\n` })).map((s) => s.name))
      .toEqual(['ccd/checks#knob_show']);
  });

  it('FIXTURE: a line redactor\'s own strip is not inline; a generated byte-equal copy is a counted function too, and one byte changed reports one', () => {
    expect(inlineUserinfoStrips(tree({ 'ccd/ccd': `${SH}${FX_REDACT}\n` }))).toEqual([]);
    const copy = tree({ 'ccd/ccd': `${SH}${FX_REDACT}\n`, 'ccd/sibling': `${SH}${region(FX_REDACT)}` });
    expect(inlineUserinfoStrips(copy)).toEqual([]);
    const edited = tree({ 'ccd/ccd': `${SH}${FX_REDACT}\n`, 'ccd/sibling': `${SH}${region(FX_REDACT.replace('${1:-}', '${1-}'))}` });
    expect(inlineUserinfoStrips(edited).map((s) => s.name)).toEqual(['ccd/sibling#fx_redact']);
  });

  it('REAL: 1, `ccd/ccrc-doctor-checks#_check_box-settings`, pinned by name: it strips one setting\'s displayed value, may only shrink', () => {
    const sites = inlineUserinfoStrips();
    show('inlineUserinfoStrips', sites);
    expect(sites.map((s) => s.name)).toEqual(['ccd/ccrc-doctor-checks#_check_box-settings']);
  });
});

describe('pythonRedactorTables: python (pattern, suffix) tables fed to re.compile (D-7071)', () => {
  it('FIXTURE: a table in a bash heredoc and one in a .py file count, named by function or file; a table nothing compiles does not', () => {
    const t = tree({
      'ccd/ccd': `${SH}_fx_py() {\n  python3 /dev/fd/3 3<<'FX'\nRULES=((r'a','b'),(r'c','d'))\nCOMPILED = tuple((re.compile(p), s) for p, s in RULES)\nFX\n}\n`,
      'ccd/tool.py': "TABLE = [(r'x', 'y')]\nPATTERNS = [re.compile(p) for p, _ in TABLE]\nUNUSED = [('a', 'b')]\n",
    });
    expect(pythonRedactorTables(t).map((s) => s.name)).toEqual(['ccd/ccd#_fx_py:RULES', 'ccd/tool.py:TABLE']);
  });

  it('REAL: reported by name (1 at base, `ccd/ccd#_docs_py:REDACT_RULES`; C5h takes it to 0)', () => {
    const sites = pythonRedactorTables();
    show('pythonRedactorTables', sites);
    expectReportRow('pythonRedactorTables', sites.map((s) => s.name), ['ccd/ccd#_docs_py:REDACT_RULES'], [], 0);
  });
});
