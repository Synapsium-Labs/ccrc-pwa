// THE CONSOLE NEVER OFFERS A COMMAND THE CLI DOES NOT HAVE (desktop-polish wave 180, fix round 1). The Add account door's
// reason once offered `ccrc auth on` to copy, a verb `ccrc` did not have, and `ccrc expose` with no subcommand, which
// exits 2: a person who ran either got the usage text and nothing else. This scan reads the CLI's own table, the
// dispatch of `ccd/ccrc` (the `case "$VERB" in` at its end), and every `ccrc <word>` in what a person sees in the
// console: the string literals, template text and JSX text of `pwa/src` (comments and test files are left out). It
// lives here, beside the scans that already read the console's source and the CLI, so no CI reach entry is needed.
//
// THE RULE. After the product's name, a word is either
//   - a verb of the dispatch: then, when the verb refuses to run without a subcommand, the next word must be one of the
//     subcommands it names (or, in prose only, a word of PLAIN_WORDS: "ccrc expose writes all three");
//   - a word of PLAIN_WORDS, in prose: ordinary words nobody would read as a command ("ccrc has not read…"), with one
//     shared reason, the product's name followed by an ordinary word;
//   - a word of COMMAND_LIKE, in prose, inside one of the sentences listed for it. These are words that could be read
//     as a command if they stood after the product's name in an instruction ("ccrc connect", "ccrc release"), so each
//     is excused only in the sentence it stands in today, read and confirmed to be prose that offers nothing to run.
//     The second list exists because a word list can hide exactly the fault this guard is for: a new sentence that
//     uses one of these words is red until a reviewer reads it and lists it.
// A listed word excuses prose, never a command: inside backticks, in a <code>, <kbd>, <pre> or <samp>, or in a command
// position (a `fix`, a `command`, or anything a name with "command" in it holds, like `fixCommands`), only a verb
// counts. A new word is red until it is put in one list or the other.
//
// KNOWN WIDTH. Verbs are checked everywhere in that text; subcommands only where the CLI's text lets the scan read
// them (a verb whose body says "missing subcommand", read from its `*_SUBS` list or its first `case "$sub" in`), so a
// verb that runs with no subcommand accepts any next word, and a dispatch label counts as a verb even when its arm only
// refuses. A command assembled from pieces at run time (`'ccrc' + ' ' + verb`), split across JSX elements, written in
// a comment or in CSS, or with a capitalised product name is not seen. The dispatch is read, not the usage text.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ts } from '../scan/parse.js';
import { ccrcRoot, rel, sources } from './helpers.js';

const CCRC = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc'), 'utf8');

/** The verbs of the CLI's top-level dispatch, read from its `case "$VERB" in … esac`. */
function verbs(): Set<string> {
  const start = CCRC.lastIndexOf('case "$VERB" in');
  if (start < 0) throw new Error('ccd/ccrc has no `case "$VERB" in` dispatch');
  const body = CCRC.slice(start, CCRC.indexOf('\nesac', start));
  const out = new Set<string>();
  for (const m of body.matchAll(/^\s+([a-z][a-z-]*(?:\|[a-z][a-z-]*)*)\)/gm)) for (const v of m[1]!.split('|')) out.add(v);
  return out;
}
const VERBS = verbs();

/** The body of `cmd_<verb>`, from its opening line to the next top-level `}`. */
function cmdBody(verb: string): string | null {
  const head = `\ncmd_${verb.replace(/-/g, '_')}() {`;
  const start = CCRC.indexOf(head);
  if (start < 0) return null;
  return CCRC.slice(start, CCRC.indexOf('\n}\n', start));
}

/** The subcommands a verb REQUIRES, or `null` when it runs without one. A verb requires one when its body refuses an
 *  empty subcommand (`missing subcommand` / `missing-subcommand`). Its subcommands are the `*_SUBS` list it names, or
 *  else the labels of its first `case "$sub" in`, less help and the catch-alls. */
function requiredSubs(verb: string): Set<string> | null {
  const body = cmdBody(verb);
  if (body === null || !/missing[ -]subcommand/.test(body)) return null;
  const list = /\$\{?([A-Z_]+_SUBS)\b/.exec(body);
  if (list !== null) {
    const def = new RegExp(`^${list[1]}="([^"]*)"`, 'm').exec(CCRC);
    if (def === null) throw new Error(`ccd/ccrc names ${list[1]} but never sets it`);
    return new Set(def[1]!.split(/\s+/).filter(Boolean));
  }
  const at = body.indexOf('case "$sub" in');
  if (at < 0) throw new Error(`cmd_${verb} refuses an empty subcommand but has no \`case "$sub" in\` to read`);
  const block = body.slice(at, body.indexOf('\n  esac', at));
  const subs = new Set<string>();
  for (const m of block.matchAll(/^\s{4}([^\s)]+)\)/gm)) {
    for (const label of m[1]!.split('|')) if (/^[a-z][a-z-]*$/.test(label)) subs.add(label);
  }
  return subs;
}

/** List 1: ordinary words after the product's name, in prose. One reason for all: the product's name followed by an
 *  ordinary word ("ccrc has not read this repository's visibility yet"), which nobody would read as a command. */
const PLAIN_WORDS: ReadonlySet<string> = new Set([
  'accepts', 'added', 'can', 'cannot', 'closes', 'connects', 'could', 'did', 'does', 'has', 'held', 'holds', 'is', 'keeps',
  'leaves', 'looks', 'made', 'makes', 'never', 'now', 'only', 'pinned', 'predates', 'reaches', 'reads', 'records',
  'returns', 'stopped', 'takes', 'tells', 'to', 'tried', 'tries', 'typed', 'warns', 'will', 'with', 'works', 'would', 'wrote',
  // After a verb that needs a subcommand, in prose: "(ccrc expose writes all three)" (settingsText.ts).
  'writes',
]);

/** List 2: words that could be read as a command after the product's name, each excused only inside the sentences it
 *  stands in today. Every site was read (fix round 1) and is prose that offers nothing to run. */
const COMMAND_LIKE: Readonly<Record<string, readonly string[]>> = {
  access: ['Give ccrc access'],
  close: ['Let ccrc close these on its own?'],
  connect: ['Address the box sees ccrc connect from (only if the box refused the key)', 'The box sees ccrc connect from a different address than the line allowed.'],
  managed: ['started before ccrc managed browser tools'],
  moves: ['ccrc moves it back to'],
  next: ['when ccrc next checks what this row holds'],
  on: ['Update this Mac with ccrc on the Mac itself.'],
  operator: ['ccrc operator'],
  push: ['[ccrc push] subscribe failed:', '[ccrc push] enable failed:'],
  release: ['Which ccrc release the fleet runs', 'onto the current ccrc release and the newest Claude Code build'],
  restarts: ['ccrc restarts it in place.'],
  runs: ['Each machine ccrc runs on.'],
  sends: ['is not one ccrc sends'],
  sets: ['ccrc sets it up over ssh'],
  Settings: ['Appearance follows ccrc Settings'], // Static label naming the console's Settings screen; nothing to run.
  stops: ['ccrc stops keeping it for run'],
};

/** One `ccrc <word> [<word>]` the console shows. `shaped` when it sits where a command does. */
interface Hit { file: string; line: number; text: string; word: string; next?: string; shaped: boolean }

const CODE_TAGS = new Set(['code', 'kbd', 'pre', 'samp']);
const COMMAND_NAME = /(^fix$|command)/i;

/** Whether a literal sits in a command position: walking up through the expressions that only carry it, the first
 *  name it meets (a property, a variable, a JSX attribute or a function) is `fix` or has "command" in it. */
function inCommandPosition(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isPropertyAssignment(n) || ts.isVariableDeclaration(n) || ts.isJsxAttribute(n)
      || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
      if (n.name !== undefined && COMMAND_NAME.test(n.name.getText())) return true;
      // An arrow in an object (`fixCommands.check`): the object's own name decides.
      if (ts.isPropertyAssignment(n) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) continue;
      return false;
    }
    if (!(ts.isParenthesizedExpression(n) || ts.isConditionalExpression(n) || ts.isBinaryExpression(n)
      || ts.isTemplateExpression(n) || ts.isTemplateSpan(n) || ts.isAsExpression(n) || ts.isArrowFunction(n)
      || ts.isFunctionExpression(n) || ts.isReturnStatement(n) || ts.isBlock(n) || ts.isJsxExpression(n)
      || ts.isArrayLiteralExpression(n) || ts.isObjectLiteralExpression(n) || ts.isSatisfiesExpression(n))) return false;
  }
  return false;
}

const ticksIn = (s: string): number => (s.match(/`/g) ?? []).length;

/** Every `ccrc <word>` in one text a person sees. `shapedNode` says whether the whole text sits where a command does;
 *  a backticked span inside the text is a command either way. `ticksBefore` carries the backticks of a template's
 *  earlier pieces, so a span that closes after a `${…}` is read as closed. */
function hitsIn(text: string, file: string, line: number, shapedNode: boolean, ticksBefore = 0): Hit[] {
  const out: Hit[] = [];
  for (const m of text.matchAll(/\bccrc[  ]+([A-Za-z][\w-]*)(?:[  ]+([A-Za-z-][\w-]*))?/g)) {
    const ticks = ticksBefore + ticksIn(text.slice(0, m.index));
    out.push({ file, line, text, word: m[1]!, next: m[2], shaped: shapedNode || ticks % 2 === 1 });
  }
  return out;
}

/** Every hit in one source file's string literals, template text and JSX text. */
function hitsOf(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Hit[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(...hitsIn(n.text, file, lineOf(n), inCommandPosition(n)));
    else if (ts.isTemplateExpression(n)) {
      const shaped = inCommandPosition(n);
      let ticks = 0;
      for (const piece of [n.head, ...n.templateSpans.map((s) => s.literal)]) {
        out.push(...hitsIn(piece.text, file, lineOf(n), shaped, ticks));
        ticks += ticksIn(piece.text);
      }
    } else if (ts.isJsxText(n)) {
      const el = n.parent;
      const tag = ts.isJsxElement(el) ? el.openingElement.tagName.getText(sf) : '';
      out.push(...hitsIn(n.text, file, lineOf(n), CODE_TAGS.has(tag)));
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/** Why a hit is not a command the CLI has and not listed prose, or `null` when it is fine. */
function problem(h: Hit): string | null {
  const where = `${h.file}:${h.line}`;
  if (VERBS.has(h.word)) {
    const subs = requiredSubs(h.word);
    if (subs === null || subs.has(h.next ?? '')) return null;
    if (!h.shaped && h.next !== undefined && PLAIN_WORDS.has(h.next)) return null;
    return `${where}: "ccrc ${h.word} ${h.next ?? ''}" — ccrc ${h.word} needs one of ${[...subs].join(', ')}`;
  }
  if (h.shaped) return `${where}: "ccrc ${h.word}" is written as a command, and ccrc has no verb "${h.word}"`;
  if (PLAIN_WORDS.has(h.word)) return null;
  if ((COMMAND_LIKE[h.word] ?? []).some((s) => h.text.includes(s))) return null;
  return `${where}: ccrc has no verb "${h.word}" (${JSON.stringify(h.text.trim().slice(0, 120))}). A command: use a verb the `
    + 'CLI has. Prose: put the word in PLAIN_WORDS, or in COMMAND_LIKE with its sentence (see the header).';
}

const PWA_SRC = path.join(ccrcRoot, 'pwa', 'src');
const HITS: Hit[] = sources(PWA_SRC).filter((f) => !/\.test\.tsx?$/.test(f)).flatMap((f) => hitsOf(rel(f), readFileSync(f, 'utf8')));
const check = (src: string, file = 'probe.tsx'): string[] => hitsOf(file, src).map(problem).filter((p) => p !== null);

describe('every ccrc command the console shows is one the CLI has (desktop-polish wave 180)', () => {
  it('reads the CLI: its verbs, and a verb that needs a subcommand', () => {
    // The reader itself, against facts of the CLI that no wave of this one changes.
    expect(VERBS.has('passwd')).toBe(true);
    expect(VERBS.has('expose')).toBe(true);
    expect(requiredSubs('passwd')).toBeNull();
    expect([...requiredSubs('expose')!].sort()).toEqual(['byo', 'duckdns', 'ip', 'status']);
    expect(requiredSubs('account')!.has('check')).toBe(true);
    // An invented verb nobody will build is not one, and a verb that needs a subcommand needs it.
    expect(VERBS.has('frobnicate-zz')).toBe(false);
    expect(check("const fix = 'ccrc expose';")).toHaveLength(1);
    expect(check("const fix = 'ccrc expose status';")).toEqual([]);
  });

  it('the scan sees the console: commands where they are offered, and prose where it is written (positive control)', () => {
    // Without these the case below would pass over an empty scan.
    const at = (file: string, pred: (h: Hit) => boolean): Hit[] => HITS.filter((h) => h.file === file && pred(h));
    expect(HITS.length).toBeGreaterThan(100);
    expect(at('pwa/src/fleet/accountWords.ts', (h) => h.word === 'passwd' && h.shaped), 'the door copy line, a `fix`').not.toEqual([]);
    expect(at('pwa/src/fleet/accountWords.ts', (h) => h.word === 'disable' || (h.word === 'account' && h.next === 'disable' && h.shaped)),
      'a trouble card command, through `fixCommands`').not.toEqual([]);
    expect(at('pwa/src/fleet/accountWords.ts', (h) => h.word === 'account' && h.next === 'add' && !h.shaped), 'the door reason, prose').not.toEqual([]);
    expect(at('pwa/src/fleet/FleetHostBanner.tsx', (h) => h.word === 'rollout' && h.shaped), 'a <code> command').not.toEqual([]);
    expect(HITS.filter((h) => !VERBS.has(h.word) && !h.shaped).length, 'prose after the product name').toBeGreaterThan(50);
  });

  it('each one the console shows', () => {
    expect(HITS.map(problem).filter((p) => p !== null)).toEqual([]);
  });

  it('a missing verb is red in plain prose, in backticks, in a <code> and in a copy line', () => {
    expect(check("const s = 'If it sticks, run ccrc frobnicate-zz there.';")).toHaveLength(1);
    expect(check('const s = "Run `ccrc frobnicate-zz` there.";')).toHaveLength(1);
    expect(check('const e = <p>Run <code>ccrc frobnicate-zz</code> there.</p>;')).toHaveLength(1);
    expect(check("const r = { fix: 'ccrc frobnicate-zz' };")).toHaveLength(1);
    expect(check('const fixCommands = { go: (id: string): string => `ccrc frobnicate-zz --id ${id}` };')).toHaveLength(1);
    expect(check("const e = <CopyCommand command={'ccrc frobnicate-zz'} />;")).toHaveLength(1);
  });

  it('a listed word excuses prose, never a command', () => {
    // List 1 in prose, fine; the same word written as a command, red.
    expect(check("const s = 'ccrc has not read it yet.';")).toEqual([]);
    expect(check('const s = "Run `ccrc has` now.";')).toHaveLength(1);
    // A backticked span that closes after a `${…}` is closed: the prose after it is prose.
    expect(check('const s = `Pushes \\`${branch}\\` to the repo. ccrc cannot undo this.`;')).toEqual([]);
    expect(check('const s = `Run \\`${tool} ccrc has\\` now.`;')).toHaveLength(1);
    expect(check("const r = { fix: 'ccrc has' };")).toHaveLength(1);
    // List 2 in its listed sentence, fine; in a new sentence, red; as a command, red even in its listed sentence.
    expect(check("const s = 'Address the box sees ccrc connect from (only if the box refused the key)';")).toEqual([]);
    expect(check("const s = 'Then ccrc connect to the box.';")).toHaveLength(1);
    expect(check('const s = "Run `ccrc connect` to the box.";')).toHaveLength(1);
    expect(check("const r = { command: 'Address the box sees ccrc connect from (only if the box refused the key)' };")).toHaveLength(1);
    // After a verb that needs a subcommand: a plain word in prose is fine, but never in a command.
    expect(check("const s = '(ccrc expose writes all three)';")).toEqual([]);
    expect(check("const r = { fix: 'ccrc expose writes' };")).toHaveLength(1);
  });

  it('no sentence of the second list is stale', () => {
    // COMMAND_LIKE only: each of its sentences excuses a word that could be read as a command, so one that is gone is
    // cut. PLAIN_WORDS is not checked: a stale plain word excuses only an ordinary word, and a word another branch needs
    // ("tells", from main) is listed before that branch's sentence reaches this one.
    const prose = HITS.filter((h) => !h.shaped);
    for (const [w, sentences] of Object.entries(COMMAND_LIKE)) {
      for (const s of sentences) expect(prose.some((h) => h.word === w && h.text.includes(s)), `COMMAND_LIKE ${w}: "${s}" is gone`).toBe(true);
    }
  });
});
