/**
 * Overlord W1, the vocabulary piece, Task 2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-vocabulary.md`;
 * spec §3.8, H7). The census of what ccrc types into a session's pane, against `INJECTED_PROMPTS`
 * (`shared/injected-prompts.mjs`), in both directions:
 *
 * - THE SERVER, by `parsedFile` over `server/src`: every `sendPrompt` text is a reference to the list or an operator
 *   site; `sendLiteral` is called only inside the two primitives; every `sendKey` key is a word of a closed set or a
 *   named computed site; none of the four names is aliased; `send-keys` is spelled only in `exec.ts`.
 * - CCD, as text: every `send-keys` of ccd's bash (`ccdSource()` for `ccd/ccd` and its libraries, every other bash
 *   file under `ccd/` raw) is a `ccd` row's text, a named non-prompt literal, a key of a closed set, or a splice on
 *   `CCD_SPLICED_SITES`, whose entry names its own rule; a mapped function holds exactly the one splice it names.
 *
 * NOTHING THIS SUITE PRINTS IS A TYPED VALUE: every failure names the file, the function, the line and the mapped word,
 * never an argument's text, so a sign-in code a send carries can never reach a test log. A `none` splice is pinned by
 * the SHA-256 of its argument as written (source text such as `"$dest "`, never a runtime value), for the same reason.
 *
 * It lives among the guard suites (`.github/ci/fast-plan.mjs#GUARD_TESTS`) because it reads `ccd/ccd` as text, which
 * no import reaches (the plan's question 4).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as prompts from '../../../shared/injected-prompts.mjs';
import {
  INJECTED_PROMPTS, INJECTED_PROMPT_KEYS, IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX, injectedPromptOf,
} from '../../../shared/injected-prompts.mjs';
import { injectedRowCases } from '../sim/vocabularySets.js';
import * as api from '../../../shared/api.js';
import { renderMailNudge } from '../../src/coord/envelope.js';
import { parseSource, ts, type ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';
import { codeOnly } from '../rings/ring.js';
import { walkSrc } from '../rings/walkSrc.js';
import { CCD, CCD_LIBS, ccdSource } from '../ccdWsHelpers.js';
import { ALL, ALL_MJS, ccrcRoot, rel } from './helpers.js';

interface Row { text: string; match: 'exact' | 'head'; typer: 'server' | 'ccd' }
type Rows = Readonly<Record<string, Row>>;
const ROWS = INJECTED_PROMPTS as unknown as Rows;

// ── the rows ──

describe('INJECTED_PROMPTS, its rows and its reader', () => {
  // The census's "Rows" cases, written once in the mutant set's file and run here against the real module.
  for (const [name, run] of Object.entries(injectedRowCases(prompts))) it(name, run);

  it('the list is frozen, and so is each row', () => {
    expect(Object.isFrozen(INJECTED_PROMPTS)).toBe(true);
    for (const k of INJECTED_PROMPT_KEYS) expect(Object.isFrozen(INJECTED_PROMPTS[k]), k).toBe(true);
  });

  it('INJECTED_PROMPT_KEYS is the list\'s own keys, and the .d.mts tuple spells the same keys (F17)', () => {
    expect([...INJECTED_PROMPT_KEYS]).toEqual(Object.keys(INJECTED_PROMPTS));
    const dts = readFileSync(path.join(ccrcRoot, 'shared/injected-prompts.d.mts'), 'utf8');
    const m = /export declare const INJECTED_PROMPT_KEYS: readonly \[([^\]]*)\]/.exec(dts);
    expect(m, 'the tuple in injected-prompts.d.mts').not.toBeNull();
    expect([...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(Object.keys(INJECTED_PROMPTS));
  });

  it('the two prompt constants are the rows\' texts, by binding, and shared/api.ts re-exports the same values', () => {
    expect(INJECTED_PROMPTS['idle-compact-nudge'].text).toBe(IDLE_COMPACT_NUDGE_PROMPT);
    expect(INJECTED_PROMPTS.resume.text).toBe(RESUME_PROMPT_PREFIX);
    expect(api.IDLE_COMPACT_NUDGE_PROMPT).toBe(IDLE_COMPACT_NUDGE_PROMPT);
    expect(api.RESUME_PROMPT_PREFIX).toBe(RESUME_PROMPT_PREFIX);
  });

  it('renderMailNudge(\'x\') is the mail-nudge row\'s', () => {
    expect(injectedPromptOf(renderMailNudge('x'))).toBe('mail-nudge');
  });
});

// ── the server ──

/** The names whose every reference must be a call, an import or the name's own definition. */
const TYPER_NAMES = new Set(['sendPrompt', 'sendLiteral', 'sendKey', 'answerDialogText']);

/** A `sendPrompt` text that references the list, matched against the argument's WHOLE flattened text (F11). Its
 *  identifier must be BOUND to the list: imported, by a value import, from one of `from` (the list's module or a module
 *  that re-exports the name), or the file is itself one of them, so a file-local `INJECTED_PROMPTS` is no reference
 *  (review 2125, F6). */
const LIST_REFERENCES: ReadonlyArray<{ re: RegExp; row: (m: RegExpExecArray) => string; from: readonly string[] }> = [
  { re: /^INJECTED_PROMPTS(?:\.([a-z]+)|\['([a-z-]+)'\])\.text$/, row: (m) => m[1] ?? m[2]!, from: ['shared/injected-prompts.mjs'] },
  { re: /^IDLE_COMPACT_NUDGE_PROMPT$/, row: () => 'idle-compact-nudge', from: ['shared/injected-prompts.mjs', 'shared/api.ts'] },
  { re: /^renderMailNudge\([\w.]+\)$/, row: () => 'mail-nudge', from: ['server/src/coord/envelope.ts'] },
  // The mail lane's line for one due delivery: the id-agnostic nudge, or an operator message's fixed line (both open with the
  // `mail-nudge` head, so the echo needle is the same).
  // The sweep passes its one designation read and its pass's clock, which the fixed-line table's wake line reads (W1 inbox, Task 4).
  { re: /^mailNudgeOf\([\w.]+, \w+(?:, (?:\w+|\w+\(\w+\)), \w+)?\)\.line$/, row: () => 'mail-nudge', from: ['server/src/coord/envelope.ts'] },
];

/** Whether `file` binds `name` to one of `from`: a value import of it from one of them, or `file` is one of them. */
function boundFrom(file: string, p: ParsedFile, name: string, from: readonly string[]): boolean {
  if (from.includes(file)) return true;
  return p.imports.some((e) => {
    if (e.kind !== 'import' || e.typeOnly || !e.names.includes(name) || !e.specifier.startsWith('.')) return false;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), e.specifier));
    return from.includes(target) || from.includes(target.replace(/\.js$/, '.ts'));
  });
}

/** The operator's own text: the console's prompt route and its dialog's free-text row. An anonymous arrow inside
 *  `app.post` has no symbol, so a site is keyed by its file, its callee, its argument's exact text, and a count. */
const OPERATOR_TEXT_SITES: ReadonlyArray<{ file: string; callee: string; arg: string; count: number }> = [
  { file: 'server/src/server.ts', callee: 'sendPrompt', arg: 'body.text', count: 1 },
  // `pressDialogText`'s arrow passes the operator's answer to a dialog's free-text row.
  { file: 'server/src/server.ts', callee: 'answerDialogText', arg: 'text', count: 1 },
  // The paste delivery recipe's driver (Desktop polish wave 178) sends what the console sends for one fixed case, on a test
  // box capture's private server only: the operator's text, stood in for by `shared/deliveryCapture.ts`'s cases.
  { file: 'server/src/inject/deliveryDrive.ts', callee: 'sendPrompt', arg: 'deliveryCaseText(input.case)', count: 1 },
];

/** The keys the server presses by name. */
const SERVER_KEYS = new Set(['Enter', 'M-Enter', 'C-u', 'C-s', 'Tab', 'Up', 'Escape']);

/** The four keys the server computes, each with its derivation (F13). */
const COMPUTED_KEY_SITES: ReadonlyArray<{ file: string; symbol: string; arg: string; derivation: string }> = [
  { file: 'server/src/inject/send.ts', symbol: 'walkCursor', arg: 'key', derivation: 'a direction word, Down or Up' },
  { file: 'server/src/inject/send.ts', symbol: 'moveDialogTab', arg: 'key', derivation: 'a direction word, Left or Right' },
  { file: 'server/src/inject/send.ts', symbol: 'answerDialogMulti', arg: 'String(k)', derivation: 'a digit from an index' },
  { file: 'server/src/inject/ask.ts', symbol: 'answerAsk', arg: 'String(i + 1)', derivation: 'a digit from an index' },
];

interface ServerFile { file: string; parsed: ParsedFile }
interface ServerCensus { findings: string[]; promptCallers: number; literalCallers: number; rowsTyped: Set<string> }

const enclosing = (p: ParsedFile, at: number): string =>
  p.symbols.filter((s) => s.start <= at && at <= s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.name
    ?? '(top)';

/** Each reference to a typer name that is not a call, an import or the name's own definition, and each element access
 *  by a typer's name (`d.tmux['sendLiteral']`, review 2125 F6), as `<line>`. */
function aliasLines(p: ParsedFile): number[] {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: number[] = [];
  const isDefinition = (n: ts.Identifier): boolean => {
    const q = n.parent;
    return (ts.isFunctionDeclaration(q) || ts.isMethodDeclaration(q) || ts.isMethodSignature(q)
      || ts.isPropertySignature(q)) && q.name === n;
  };
  const isCallee = (n: ts.Identifier): boolean => {
    const q = n.parent;
    if (ts.isCallExpression(q) && q.expression === n) return true;
    return ts.isPropertyAccessExpression(q) && q.name === n && ts.isCallExpression(q.parent) && q.parent.expression === q;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && TYPER_NAMES.has(n.text)) {
      const imp = ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isExportSpecifier(n.parent);
      if (!imp && !isCallee(n) && !isDefinition(n)) out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && TYPER_NAMES.has(n.argumentExpression.text)) {
      out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The server's census over `files` (each repo-relative, with its parse). Pure over its input, so a control plants a
 *  source string and runs the same rules. */
export function serverCensus(files: readonly ServerFile[]): ServerCensus {
  const findings: string[] = [];
  const rowsTyped = new Set<string>();
  const operatorSeen = new Map<string, number>();
  let promptCallers = 0, literalCallers = 0;
  for (const { file, parsed: p } of files) {
    for (const c of p.calls) {
      const where = `${file}:${c.line} ${enclosing(p, c.start)}`;
      if (c.name === 'sendPrompt') {
        promptCallers++;
        const a = c.args[2];
        const site = OPERATOR_TEXT_SITES.find((s) => s.file === file && s.callee === 'sendPrompt' && a?.kind === 'other' && s.arg === a.text);
        if (site !== undefined) { const k = `${site.file}#${site.callee}#${site.arg}`; operatorSeen.set(k, (operatorSeen.get(k) ?? 0) + 1); continue; }
        const ref = a?.kind === 'other' ? LIST_REFERENCES.map((r) => ({ r, m: r.re.exec(a.text) })).find((x) => x.m !== null) : undefined;
        if (ref === undefined) {
          findings.push(`${where}: sendPrompt's text is no reference to INJECTED_PROMPTS and no OPERATOR_TEXT_SITES entry`);
          continue;
        }
        if (!boundFrom(file, p, /^\w+/.exec(a!.text)![0], ref.r.from)) {
          findings.push(`${where}: sendPrompt's text names the list, but the name is not imported from ${ref.r.from.join(' or ')}`);
          continue;
        }
        const row = ref.r.row(ref.m!);
        if (!(row in ROWS) || ROWS[row]!.typer !== 'server') findings.push(`${where}: sendPrompt types row ${row}, which is no server row`);
        else rowsTyped.add(row);
      } else if (c.name === 'sendLiteral') {
        literalCallers++;
        const sym = enclosing(p, c.start);
        const inPrimitive = file === 'server/src/inject/send.ts'
          && (sym === 'sendPrompt' || sym.startsWith('sendPrompt.') || sym === 'answerDialogText' || sym.startsWith('answerDialogText.'));
        if (!inPrimitive) findings.push(`${where}: sendLiteral is called outside sendPrompt and answerDialogText`);
      } else if (c.name === 'answerDialogText') {
        const a = c.args[4];
        const site = OPERATOR_TEXT_SITES.find((s) => s.file === file && s.callee === 'answerDialogText' && a?.kind === 'other' && s.arg === a.text);
        if (site === undefined) findings.push(`${where}: answerDialogText's text is no OPERATOR_TEXT_SITES entry`);
        else { const k = `${site.file}#${site.callee}#${site.arg}`; operatorSeen.set(k, (operatorSeen.get(k) ?? 0) + 1); }
      } else if (c.name === 'sendKey') {
        const a = c.args[1];
        if (a?.kind === 'string') {
          if (!SERVER_KEYS.has(a.text)) findings.push(`${where}: sendKey presses a key outside SERVER_KEYS`);
          continue;
        }
        const sym = enclosing(p, c.start);
        if (!COMPUTED_KEY_SITES.some((s) => s.file === file && s.symbol === sym && a?.kind === 'other' && s.arg === a.text)) {
          findings.push(`${where}: sendKey's key is computed at a site COMPUTED_KEY_SITES does not name`);
        }
      }
    }
    for (const line of aliasLines(p)) findings.push(`${file}:${line}: a typer name is referenced other than as a call, an import or its definition`);
    if (file !== 'server/src/exec.ts' && codeOnly(p.text).includes('send-keys')) {
      findings.push(`${file}: spells send-keys outside comments; only server/src/exec.ts may`);
    }
  }
  for (const s of OPERATOR_TEXT_SITES) {
    const k = `${s.file}#${s.callee}#${s.arg}`;
    if (files.some((f) => f.file === s.file) && (operatorSeen.get(k) ?? 0) !== s.count) {
      findings.push(`${s.file}: OPERATOR_TEXT_SITES names ${s.callee} ${s.count} time(s), measured ${operatorSeen.get(k) ?? 0}`);
    }
  }
  return { findings, promptCallers, literalCallers, rowsTyped };
}

/** The rows of `typer` no site of a census typed. */
const untypedRows = (rows: Rows, typer: Row['typer'], rowsTyped: ReadonlySet<string>): string[] =>
  Object.keys(rows).filter((k) => rows[k]!.typer === typer && !rowsTyped.has(k));

const serverFiles = (): ServerFile[] =>
  walkSrc({ roots: ['server/src'], min: 300, match: /\.ts$/ }).map((file) => ({ file, parsed: parsedFile(file) }));

const planted = (text: string, file = 'server/src/planted.ts'): ServerFile => ({ file, parsed: parseSource(text, file) });

describe('the server types only the list and the operator\'s own text', () => {
  const census = serverCensus(serverFiles());

  it('every typer is a reference to the list, an operator site, a primitive or a named key', () => {
    expect(census.findings).toEqual([]);
  });

  it('floors: four sendPrompt callers and two sendLiteral callers, so the scan cannot go vacuous', () => {
    expect(census.promptCallers).toBeGreaterThanOrEqual(4);
    expect(census.literalCallers).toBeGreaterThanOrEqual(2);
  });

  it('every server row has at least one typer that references it', () => {
    expect(untypedRows(ROWS, 'server', census.rowsTyped)).toEqual([]);
  });

  it('renderMailNudge begins with the mail-nudge row, by reference', () => {
    const p = parsedFile('server/src/coord/envelope.ts');
    const sym = p.symbols.find((s) => s.name === 'renderMailNudge')!;
    expect(p.text.slice(sym.start, sym.end)).toMatch(/\$\{INJECTED_PROMPTS\['mail-nudge'\]\.text\}/);
  });

  it('send.ts spells the string /clear nowhere outside comments', () => {
    expect(codeOnly(parsedFile('server/src/inject/send.ts').text)).not.toContain('/clear');
  });

  describe('CONTROLS: each planted typer reds the census', () => {
    const red = (f: ServerFile, plant: string | null = null): void => {
      const { findings } = serverCensus([f]);
      expect(findings.length, f.parsed.text).toBeGreaterThan(0);
      if (plant !== null) for (const m of findings) expect(m).not.toContain(plant);
    };
    it('a sendPrompt with a string literal', () => red(planted("function f(d, id) { return sendPrompt(d, id, 'hello'); }"), 'hello'));
    it('a sendPrompt with a template literal', () => red(planted('function f(d, id, x) { return sendPrompt(d, id, `hey ${x}`); }'), 'hey'));
    it('a sendPrompt reached through an alias', () => red(planted('const f = sendPrompt;\nfunction g(d, id) { return f(d, id, INJECTED_PROMPTS.clear.text); }')));
    it('a sendLiteral in a new function', () => red(planted("async function f(d, id) { await d.tmux.sendLiteral(id, 'typed'); }"), 'typed'));
    it('a sendLiteral in send.ts outside the primitives', () => red(planted("async function f(d, id) { await d.tmux.sendLiteral(id, 'x'); }", 'server/src/inject/send.ts')));
    it('a sendKey outside the closed set', () => red(planted("async function f(d, id) { await d.tmux.sendKey(id, '/'); }")));
    it('a computed sendKey at an unnamed site', () => red(planted('async function f(d, id, k) { await d.tmux.sendKey(id, k); }')));
    it('an answerDialogText off the operator sites', () => red(planted("function f(d, id) { return answerDialogText(d, id, 'a', 0, 'pick'); }"), 'pick'));
    it('a send-keys string in a server file other than exec.ts', () => red(planted("const argv = ['send-keys', '-t', 'x'];")));
    it('a sendPrompt typing a ccd row', () => {
      const f = planted("import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';\nfunction f(d, id) { return sendPrompt(d, id, INJECTED_PROMPTS.model.text); }");
      expect(serverCensus([f]).findings).toEqual([expect.stringMatching(/types row model, which is no server row/)]);
    });
    it('a sendPrompt naming a file-local INJECTED_PROMPTS, not the imported list (review 2125, F6)', () => red(planted("const INJECTED_PROMPTS = { clear: { text: 'x' } };\nfunction f(d, id) { return sendPrompt(d, id, INJECTED_PROMPTS.clear.text); }")));
    it('a typer called by element access (review 2125, F6)', () => red(planted("async function f(d, id) { await d.tmux['sendLiteral'](id, 'typed'); }"), 'typed'));
    it('an operator site measured above its count (review 2125, F7)', () => {
      const two = planted('function f(d, id, body) { sendPrompt(d, id, body.text); return sendPrompt(d, id, body.text); }', 'server/src/server.ts');
      expect(serverCensus([two]).findings).toContainEqual(expect.stringMatching(/OPERATOR_TEXT_SITES names sendPrompt 1 time\(s\), measured 2/));
    });
    it('a server row no site types (review 2125, F7)', () => {
      const rows = { ...ROWS, planted: { text: '/planted', match: 'exact', typer: 'server' } } as Rows;
      expect(untypedRows(rows, 'server', census.rowsTyped)).toEqual(['planted']);
    });
    it('the census itself is green over a planted reference to a server row', () => {
      const ref = "import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';\nfunction f(d, id) { return sendPrompt(d, id, INJECTED_PROMPTS.clear.text); }";
      expect(serverCensus([planted(ref)]).findings).toEqual([]);
    });
  });
});

// ── ccd ──

/** The keys ccd presses by name. */
const CCD_KEYS = new Set(['Enter', 'Escape', 'Left', 'Right', 'Up', 'Down']);

/** A `-l` literal ccd types that is no prompt, with why. */
const CCD_NON_PROMPT_LITERALS: Readonly<Record<string, string>> = {
  s: "a picker's select key, typed by _route_type_model and _route_type_effort after walking to the row",
};

type SpliceRule =
  | { rule: 'head'; row: string }
  | { rule: 'prompt-var'; row: string; arg: string; fn: string; variable: string; starts: readonly string[] }
  | { rule: 'none'; word: 'operator-supplied' | 'operator-secret'; sha: string };

/** Every function whose send splices a value, with the one splice it holds and that splice's rule (ruled, F2). */
const CCD_SPLICED_SITES: Readonly<Record<string, SpliceRule>> = {
  // `/compact` with the launch profile's compaction text after a space: the text before the first `$` is the row's, and
  // what follows it is nothing, a space, or a `${x:+ …}` whose text begins with one (review 2125, F5).
  _auto_compact_check: { rule: 'head', row: 'compact' },
  // The whole resume prompt, built by `_resume_prompt_for` from RESUME_PROMPT, which begins with the row's text: every
  // `printf` there prints a text that starts with `$RESUME_PROMPT` or `$head`, its part before the cause (review 2125, F4).
  _redrive_after_spawn: {
    rule: 'prompt-var', row: 'resume', arg: '"$(_resume_prompt_for "$id")"', fn: '_resume_prompt_for', variable: 'RESUME_PROMPT',
    starts: ['$RESUME_PROMPT', '$head'],
  },
  // The path of a clip the operator filed, then a space: the whole send as written, its flags included
  // (`send-keys -t "$(_tmux_t "$id")" -l "$dest "`), so a dropped `-l` changes the digest (review 2125, F5).
  cmd_clip: { rule: 'none', word: 'operator-supplied', sha: 'e6686f63971e9e2f' },
};

/** The SHA-256 of a send as written (source text, never a typed value), its first 16 hex digits. */
const argSha = (raw: string): string => createHash('sha256').update(raw).digest('hex').slice(0, 16);

interface CcdFile { file: string; text: string }
interface CcdSend { file: string; fn: string; line: number; literal: boolean; args: string[]; raw: string }

/** The functions that forward their own arguments to tmux (`"$@"`), each a head the verb read follows too, with why. */
const CCD_TMUX_FORWARDERS: Readonly<Record<string, string>> = {
  _pane_scope_tmux: 'one tmux call bounded by a deadline; its callers name the verb, and the census reads it there',
};

/** tmux's verbs that type into a pane without `send-keys`: the buffer verbs and their aliases (`man tmux`). */
const BUFFER_VERB = /^(?:paste|load|set)(?:b|-b[a-z]*)$/;

/** The global flags tmux reads before its verb that take a value. */
const TMUX_VALUE_FLAGS = new Set(['-L', '-S', '-f', '-c', '-T']);

/** One shell word at `i` of `s`, as written (quotes kept), and where it ends; null at a command's end. */
function shellWord(s: string, i: number): { word: string; end: number } | null {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  if (i >= s.length || ';&|\n)'.includes(s[i]!) || s[i] === '#') return null;
  const start = i;
  const skipParen = (j: number): number => { // at the char after `$(`
    let depth = 1;
    while (j < s.length && depth > 0) {
      const c = s[j]!;
      if (c === '\\') { j += 2; continue; }
      if (c === "'") { j = s.indexOf("'", j + 1) + 1 || s.length; continue; }
      if (c === '"') { j = skipDouble(j + 1); continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    return j;
  };
  const skipDouble = (j: number): number => { // at the char after an opening `"`; returns past the closing one
    while (j < s.length && s[j] !== '"') {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '$' && s[j + 1] === '(') { j = skipParen(j + 2); continue; }
      if (s[j] === '$' && s[j + 1] === '{') { j = s.indexOf('}', j) + 1 || s.length; continue; }
      j++;
    }
    return j + 1;
  };
  while (i < s.length && !' \t;&|\n)'.includes(s[i]!)) {
    const c = s[i]!;
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { i = s.indexOf("'", i + 1) + 1 || s.length; continue; }
    if (c === '"') { i = skipDouble(i + 1); continue; }
    if (c === '$' && s[i + 1] === '(') { i = skipParen(i + 2); continue; }
    if (c === '$' && s[i + 1] === '{') { i = s.indexOf('}', i) + 1 || s.length; continue; }
    i++;
  }
  return { word: s.slice(start, i), end: i };
}

/** A word's value when it splices nothing (no `$`, no backquote), its quotes removed; else null. */
const plainValue = (w: string): string | null => (/[$`]/.test(w) ? null : w.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1'));

/** Every `send-keys` invocation of `files`, each with its enclosing function (the nearest `name() {` line above it). */
export function ccdSends(files: readonly CcdFile[]): { sends: CcdSend[]; findings: string[] } {
  const sends: CcdSend[] = [];
  const findings: string[] = [];
  const heads = ['_tmx', 'tmux', ...Object.keys(CCD_TMUX_FORWARDERS)].join('|');
  for (const { file, text } of files) {
    let fn = '(top)';
    text.split('\n').forEach((line, idx) => {
      const def = /^\s*(?:function\s+)?([A-Za-z_][\w:-]*)\s*\(\)\s*\{/.exec(line);
      if (def) fn = def[1]!;
      if (/^\s*#/.test(line)) return;
      // Inside a comment that trails code: not an invocation.
      const inComment = (at: number): boolean => /(?:^|\s)#/.test(line.slice(0, at).replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ''));
      const where = `${file}:${idx + 1} ${fn}`;
      // The verb after each tmux head (review 2125, F2): `send` and every `send-…` other than `send-keys` itself, a
      // buffer verb, and a verb that is no literal are findings. A forwarder's own `"$@"` is its callers' verb. A head is
      // a word of its own followed by a blank (never `.tmux.conf`, `"tmux(`). A verb that is no literal is read only where
      // a command starts, since a message's prose (`"… Check with: tmux ls" … "$reason"`) is no call.
      for (const h of line.matchAll(new RegExp(`(?<![\\w$./"'-])(?:${heads})(?=[ \\t])`, 'g'))) {
        if (inComment(h.index)) continue;
        const atCommand = /(?:^|[;&|(!{]|\b(?:then|do|else|if|while|until|command|exec))\s*$/.test(line.slice(0, h.index));
        let i = h.index + h[0].length;
        let verb: string | null = null;
        for (let w = shellWord(line, i); w !== null; w = shellWord(line, i)) {
          i = w.end;
          if (TMUX_VALUE_FLAGS.has(w.word)) { const v = shellWord(line, i); if (v === null) break; i = v.end; continue; }
          if (/^-/.test(w.word) || /^\$\{\w+:\+-/.test(w.word)) continue; // a flag, or `${X:+-L …}`, an optional one
          verb = w.word;
          break;
        }
        if (verb === null || /^[<>0-9&]/.test(verb)) continue; // no verb: prose, a test, or a redirection
        const v = plainValue(verb);
        if (v === null) {
          if (atCommand && !(fn in CCD_TMUX_FORWARDERS && verb === '"$@"')) findings.push(`${where}: a tmux verb that is no literal`);
        } else if (v === 'send' || (v.startsWith('send-') && v !== 'send-keys')) {
          findings.push(`${where}: tmux's send-keys under another spelling (an alias or a prefix); spell it send-keys`);
        } else if (BUFFER_VERB.test(v) && !v.endsWith('-buffer')) { // the full names are read anywhere, below
          findings.push(`${where}: a tmux buffer verb, which types into a pane without send-keys`);
        }
      }
      for (const b of line.matchAll(/(?<![\w-])(?:paste|load|set)-buffer(?![\w-])/g)) {
        if (!inComment(b.index)) findings.push(`${where}: a tmux buffer verb, which types into a pane without send-keys`);
      }
      for (const m of line.matchAll(/(?<![\w-])send-keys(?![\w-])/g)) {
        if (inComment(m.index)) continue;
        let i = m.index + 'send-keys'.length;
        let literal = false;
        const args: string[] = [];
        let flags = true;
        for (let w = shellWord(line, i); w !== null; w = shellWord(line, i)) {
          i = w.end;
          if (flags && w.word === '-t') { const t = shellWord(line, i); if (t === null) break; i = t.end; continue; }
          if (flags && w.word === '-l') { literal = true; continue; }
          if (flags && w.word === '--') { flags = false; continue; }
          if (flags && /^-/.test(w.word)) { findings.push(`${where}: send-keys with a flag the census does not read`); continue; }
          flags = false;
          args.push(w.word);
        }
        sends.push({ file, fn, line: idx + 1, literal, args, raw: line.slice(m.index, i).trim() });
      }
    });
  }
  return { sends, findings };
}

/** A ccd function's body, from its `name() {` line to the next `}` at column 0, from any of `files`. */
const ccdBody = (files: readonly CcdFile[], name: string): string | null => {
  for (const f of files) {
    const m = new RegExp(`^${name}\\(\\) *\\{[^\\n]*\\n([\\s\\S]*?)^\\}`, 'm').exec(f.text);
    if (m) return m[1]!;
  }
  return null;
};

/** The text each `printf` of a function's `body` prints, as written with its quotes removed: the format, or for a
 *  `'%s'` format the word after it. A `printf` inside a `$(…)` prints into that substitution, not the function's
 *  output, so each `$(…)` is cut first. */
function printfTexts(body: string): string[] {
  let flat = '';
  for (let i = 0; i < body.length;) {
    if (body[i] === '$' && body[i + 1] === '(') {
      let depth = 1, j = i + 2;
      while (j < body.length && depth > 0) { if (body[j] === '(') depth++; else if (body[j] === ')') depth--; j++; }
      i = j;
      continue;
    }
    flat += body[i++];
  }
  const unq = (w: string): string => w.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  const out: string[] = [];
  for (const line of flat.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(/(?<![\w-])printf(?![\w-])/g)) {
      const f = shellWord(line, m.index + 'printf'.length);
      if (f === null) { out.push(''); continue; }
      out.push(unq(f.word) === '%s' ? unq(shellWord(line, f.end)?.word ?? '') : unq(f.word));
    }
  }
  return out;
}

interface CcdCensus { findings: string[]; sends: CcdSend[]; rowsTyped: Set<string> }

/** ccd's census over `files` and `rows`. Pure over its input, so a control plants a bash source string. */
export function ccdCensus(files: readonly CcdFile[], rows: Rows = ROWS, sites = CCD_SPLICED_SITES): CcdCensus {
  const { sends, findings } = ccdSends(files);
  const rowsTyped = new Set<string>();
  const ccdTexts = new Map(Object.entries(rows).filter(([, r]) => r.typer === 'ccd').map(([k, r]) => [r.text, k]));
  const splices = new Map<string, Array<{ send: CcdSend; arg: string }>>();
  for (const send of sends) {
    const where = `${send.file}:${send.line} ${send.fn}`;
    for (const arg of send.args) {
      const v = plainValue(arg);
      if (send.literal && v !== null) {
        const row = ccdTexts.get(v);
        if (row !== undefined) rowsTyped.add(row);
        else if (!(v in CCD_NON_PROMPT_LITERALS)) findings.push(`${where}: an -l literal that is no ccd row and not on CCD_NON_PROMPT_LITERALS`);
        continue;
      }
      if (!send.literal && v !== null && CCD_KEYS.has(v)) continue;
      const list = splices.get(send.fn) ?? [];
      list.push({ send, arg });
      splices.set(send.fn, list);
    }
  }
  for (const [fn, list] of splices) {
    const site = sites[fn];
    const where = `${list[0]!.send.file}:${list[0]!.send.line} ${fn}`;
    if (site === undefined) { findings.push(`${where}: a splice (or a key outside CCD_KEYS) in a function CCD_SPLICED_SITES does not map`); continue; }
    const word = site.rule === 'none' ? site.word : site.row;
    if (list.length !== 1) { findings.push(`${where} (${word}): ${list.length} splices where CCD_SPLICED_SITES names exactly one`); continue; }
    const { send, arg } = list[0]!;
    if (site.rule === 'head') {
      const t = rows[site.row]?.text;
      const head = plainValue(arg.slice(0, arg.indexOf('$')).replace(/^"/, ''));
      const rest = arg.slice(arg.indexOf('$')).replace(/"$/, '');
      if (!send.literal || t === undefined || (head !== t && head !== `${t} `)) findings.push(`${where} (${word}): the splice's text before its first $ is not the row's`);
      else if (head === t && !/^\$\{\w+:\+ [^}]*\}$/.test(rest)) findings.push(`${where} (${word}): the row's text is not followed by a space or the end`);
      else rowsTyped.add(site.row);
    } else if (site.rule === 'prompt-var') {
      const body = ccdBody(files, site.fn);
      const value = files.map((f) => new RegExp(`^${site.variable}="([^"]*)"`, 'm').exec(f.text)?.[1]).find((x) => x !== undefined);
      const printed = body === null ? [] : printfTexts(body);
      const fromVar = printed.length > 0 && printed.every((t) => site.starts.some((h) => t.startsWith(h) && !/\w/.test(t.charAt(h.length))));
      if (!send.literal || arg !== site.arg) findings.push(`${where} (${word}): the splice is not the one CCD_SPLICED_SITES pins`);
      else if (!fromVar) findings.push(`${where} (${word}): a printf in ${site.fn} does not start its text with ${site.starts.join(' or ')}`);
      else if (value === undefined || !value.startsWith(rows[site.row]?.text ?? '\0')) findings.push(`${where} (${word}): ${site.variable} does not begin with the row's text`);
      else rowsTyped.add(site.row);
    } else if (argSha(send.raw) !== site.sha) {
      findings.push(`${where} (${word}): the send is not the one CCD_SPLICED_SITES pins (measured sha ${argSha(send.raw)})`);
    }
  }
  for (const fn of Object.keys(sites)) {
    if (!splices.has(fn) && files.some((f) => ccdBody([f], fn) !== null)) findings.push(`ccd ${fn}: CCD_SPLICED_SITES maps it, and it holds no splice`);
  }
  return { findings, sends, rowsTyped };
}

/** Every bash file under `ccd/` the census reads: `ccdSource()` stands for `ccd/ccd` and its libraries (F10); every
 *  other `ccd/lib/*.sh` and every file whose first line is a bash or sh shebang is read raw, each once. */
function ccdFiles(): CcdFile[] {
  const spliced = new Set([CCD, ...CCD_LIBS].map((f) => path.resolve(f)));
  // Named for what it is: ccd/ccd with its libraries spliced back, so its line numbers are ccdSource()'s, not the file's.
  const out: CcdFile[] = [{ file: 'ccd/ccd+libs', text: ccdSource() }];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('__')) continue;
      const abs = path.join(dir, e);
      if (statSync(abs).isDirectory()) { visit(abs); continue; }
      if (spliced.has(path.resolve(abs))) continue;
      const r = rel(abs);
      const text = readFileSync(abs, 'utf8');
      if (/^ccd\/lib\/[^/]+\.sh$/.test(r) || /^#!.*\b(?:bash|sh)\b/.test(text.slice(0, 200).split('\n')[0]!)) out.push({ file: r, text });
    }
  };
  visit(path.join(ccrcRoot, 'ccd'));
  return out;
}

describe('ccd types only its rows, named literals, named keys and mapped splices', () => {
  const files = ccdFiles();
  const census = ccdCensus(files);

  it('every send-keys of ccd is accounted for', () => {
    expect(census.findings).toEqual([]);
  });

  it('every ccd row is typed by at least one site', () => {
    expect(untypedRows(ROWS, 'ccd', census.rowsTyped)).toEqual([]);
  });

  it('floors: five functions and eight -l sends, five with no $ and three spliced (F12)', () => {
    const lit = census.sends.filter((s) => s.literal);
    expect(new Set(lit.map((s) => s.fn)).size).toBeGreaterThanOrEqual(5);
    expect(lit.length).toBeGreaterThanOrEqual(8);
    expect(lit.filter((s) => s.args.every((a) => plainValue(a) !== null)).length).toBeGreaterThanOrEqual(5);
    expect(lit.filter((s) => s.args.some((a) => plainValue(a) === null)).length).toBeGreaterThanOrEqual(3);
  });

  it('the reads are de-duplicated: no file is read twice, and ccd/ccd\'s libraries are inside ccdSource()', () => {
    const names = files.map((f) => f.file);
    expect(new Set(names).size).toBe(names.length);
    for (const lib of CCD_LIBS) expect(names).not.toContain(rel(lib));
  });

  describe('CONTROLS: each planted send reds the census, and no message carries the planted value', () => {
    const red = (text: string, plant: string | null = null, rows: Rows = ROWS): void => {
      const { findings } = ccdCensus([...files, { file: 'ccd/planted.sh', text }], rows);
      expect(findings.length, text).toBeGreaterThan(0);
      if (plant !== null) for (const m of findings) expect(m).not.toContain(plant);
    };
    it('a new -l literal that is no row', () => red('planted_exit() {\n  _tmx send-keys -t "$t" -l "/exit"\n}\n', '/exit'));
    it('a spliced -l in a function the map does not name', () => red('planted_splice() {\n  _tmx send-keys -t "$t" -l "$x"\n}\n', '$x'));
    it('a second splice inside _redrive_after_spawn', () => red('_redrive_after_spawn() {\n  _tmx send-keys -t "$t" -l "$(_resume_prompt_for "$id")"\n  _tmx send-keys -t "$t" -l "$secret_code"\n}\n', 'secret_code'));
    it('a key outside the closed set', () => red('planted_key() {\n  _tmx send-keys -t "$t" C-c\n}\n', 'C-c'));
    it('a bare tmux send-keys with a literal', () => red('planted_tmux() {\n  tmux send-keys -t "$pane" -l "rm -rf x"\n}\n', 'rm -rf'));
    it('a row no site types', () => {
      const rows = { ...ROWS, planted: { text: '/planted', match: 'exact', typer: 'ccd' } } as Rows;
      expect(untypedRows(rows, 'ccd', ccdCensus(files, rows).rowsTyped)).toEqual(['planted']);
    });
    it('a head splice whose head is not the row\'s', () => red('_auto_compact_check() {\n  _tmx send-keys -t "$t" -l "/compacted${x}"\n}\n'));
    it('a commented send-keys is no send', () => {
      expect(ccdSends([{ file: 'ccd/planted.sh', text: 'planted_f() {\n  # _tmx send-keys -t "$t" -l "/exit"\n  echo x  # send-keys -l "/exit"\n}\n' }]).sends).toEqual([]);
    });

    // Review 2125: each control below plants one change and reds for its own reason, named by the finding it expects.
    const reason = (text: string, re: RegExp, plant: string): void => {
      const { findings } = ccdCensus([...files, { file: 'ccd/planted.sh', text }]);
      expect(findings, text).toContainEqual(expect.stringMatching(re));
      for (const m of findings) expect(m).not.toContain(plant);
    };
    it('tmux\'s send alias, and a send- prefix, after _tmx or tmux (F2)', () => {
      reason('planted_alias() {\n  _tmx send -t "$t" -l "/exit"\n}\n', /another spelling/, '/exit');
      reason('planted_prefix() {\n  tmux -L "$sock" send-k -t "$t" -l "/exit"\n}\n', /another spelling/, '/exit');
    });
    it('a buffer verb in ccd, by name or alias (F2)', () => {
      reason('planted_paste() {\n  _tmx paste-buffer -t "$t"\n}\n', /buffer verb/, 'paste-buffer');
      reason('planted_load() {\n  printf x | tmux load-buffer -\n}\n', /buffer verb/, 'load-buffer');
      reason('planted_set() {\n  _tmx set-buffer -- "$planted_code"\n}\n', /buffer verb/, 'planted_code');
      reason('planted_alias() {\n  _tmx pasteb -t "$t"\n}\n', /buffer verb/, 'pasteb');
    });
    it('a tmux verb that is no literal (F2)', () => reason('planted_verb() {\n  _tmx "$verb" -t "$t" -l "/exit"\n}\n', /verb that is no literal/, '$verb'));

    /** The real ccd source with `from` replaced by `to` once (held present), census over it and the other files. */
    const mutated = (from: string, to: string): string[] => {
      const real = files.find((f) => f.file === 'ccd/ccd+libs')!;
      expect(real.text.includes(from), `the mutation's target ${from}`).toBe(true);
      return ccdCensus(files.map((f) => (f === real ? { ...f, text: f.text.replace(from, to) } : f))).findings;
    };
    it('a printf in _resume_prompt_for whose text starts other than from RESUME_PROMPT (F4)', () => {
      expect(mutated(`printf '%s' "$RESUME_PROMPT"`, `printf '%s' "Hi $RESUME_PROMPT"`))
        .toEqual([expect.stringMatching(/a printf in _resume_prompt_for does not start its text/)]);
    });
    it('a compact head followed by a splice with no space (F5)', () => {
      expect(mutated('-l "/compact${ctext:+ $ctext}"', '-l "/compact$ctext"'))
        .toEqual([expect.stringMatching(/not followed by a space or the end/)]);
    });
    it('cmd_clip\'s send with its -l dropped (F5)', () => {
      expect(mutated('-t "$(_tmux_t "$id")" -l "$dest "', '-t "$(_tmux_t "$id")" "$dest "'))
        .toEqual([expect.stringMatching(/cmd_clip \(operator-supplied\): the send is not the one/)]);
    });
  });
});

// ── one definition each ──

describe('INJECTED_PROMPTS and its two constants have one definition (F3)', () => {
  const HOME = 'shared/injected-prompts.mjs';
  for (const [what, re] of [
    ['the INJECTED_PROMPTS list', /export const INJECTED_PROMPTS\b/],
    ['the injectedPromptOf reader', /export function injectedPromptOf\b/],
    ['IDLE_COMPACT_NUDGE_PROMPT', /\bIDLE_COMPACT_NUDGE_PROMPT\s*=/],
    ['RESUME_PROMPT_PREFIX', /\bRESUME_PROMPT_PREFIX\s*=/],
  ] as const) {
    it(`${what} is declared in exactly one file, ${HOME}, over the .ts roots and every .mjs together`, () => {
      const holders = [...ALL, ...ALL_MJS].filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
      expect(holders).toEqual([HOME]);
    });
  }

  it('shared/api.ts re-exports the two constants and declares neither', () => {
    // An import and a bare `export { … }`: `collect-lane-l0.test.ts` holds api.ts's import lines to a list and refuses
    // an `export … from`.
    const p = parsedFile('shared/api.ts');
    const edge = p.imports.find((e) => e.kind === 'import' && e.specifier === './injected-prompts.mjs');
    expect(edge?.names.sort()).toEqual(['IDLE_COMPACT_NUDGE_PROMPT', 'RESUME_PROMPT_PREFIX']);
    expect(p.text).toMatch(/^export \{ IDLE_COMPACT_NUDGE_PROMPT, RESUME_PROMPT_PREFIX \};$/m);
    expect(p.bindings.filter((b) => b.name === 'IDLE_COMPACT_NUDGE_PROMPT' || b.name === 'RESUME_PROMPT_PREFIX')).toEqual([]);
  });
});
