// THE CONSOLE NEVER OFFERS A COMMAND THE CLI DOES NOT HAVE (desktop-polish wave 180, fix round 1). The Add account door's
// reason once offered `ccrc auth on` to copy, a verb `ccrc` did not have until wave 181, and `ccrc expose` with no
// subcommand, which exits 2: a person who ran either got the usage text and nothing else. This scan reads the CLI's own
// table, the dispatch of `ccd/ccrc` (the `case "$VERB" in` at its end), and every `ccrc <word>` in what a person sees in
// the console: the string literals, template text and JSX text of `pwa/src` (comments and test files are left out). It
// lives here, beside the scans that already read the console's source and the CLI, so no CI reach entry is needed.
//
// THE RULE. After the product's name and any white space (a tab, a narrow or thin space, a line wrap in JSX text), a
// word is either
//   - a verb of the dispatch: then, when the verb refuses to run without a subcommand, the next word must be one of the
//     subcommands it names, or, in prose only, the hit must stand inside a sentence AFTER_VERB_PROSE lists for that verb
//     ("(ccrc expose writes all three)"), so "run ccrc expose now" is red;
//   - a word of PLAIN_WORDS, in prose: ordinary words nobody would read as a command ("ccrc has not read…"), with one
//     shared reason, the product's name followed by an ordinary word;
//   - a word of COMMAND_LIKE, in prose, where the hit itself stands inside one of the sentences listed for it, or is one
//     exact literal of one named file (the passkey's user name, "ccrc operator"). These are words that could be read
//     as a command if they stood after the product's name in an instruction ("ccrc connect", "ccrc release"), so each
//     is excused only where it stands today, read and confirmed to be prose or a name that offers nothing to run. The
//     excuse is per hit: a second use of the word in the same text is judged on its own. The second list exists
//     because a word list can hide exactly the fault this guard is for: a new sentence that uses one of these words is
//     red until a reviewer reads it and lists it.
// A listed word excuses prose, never a command: inside backticks; anywhere inside a <code>, <kbd>, <pre> or <samp>,
// a nested element's text and a string in an expression included; or in a command position (a `fix`, a `command`, or
// anything a name with "command" in it holds, like `fixCommands`), only a verb counts. A new word is red until it is
// put in one list or the other.
//
// THE CLI READER. Verbs are the labels of the dispatch. A verb needs a subcommand when its `cmd_<verb>` body, comment
// lines left out, refuses an empty one ("missing subcommand" / "missing-subcommand"); its subcommands are then the
// `*_SUBS` list that body names, or else the four-space labels of its first `case "$sub" in`. A refusal with neither,
// or a `case` that names none, THROWS, and the reader is asked of every verb of the dispatch, so a verb it cannot read
// is a red suite, never one that accepts any next word.
//
// KNOWN WIDTH. A verb whose body runs with no subcommand, or that refuses one only inside a helper it calls, accepts any
// next word; a dispatch label counts as a verb even when its arm only refuses, and a label written `"auth")` or `auth*)`
// is not read. A command assembled from pieces at run time (`'ccrc' + ' ' + verb`, `${'ccrc'}`, a template
// substitution between the words), split across JSX elements or `{' '}`, set by an attribute's template, written in a
// comment or in CSS, JSON, Markdown or HTML under pwa/src, in a file whose name starts with `__` (the source walk
// skips those transient mutants), or with a capitalised product name is not seen. Only pwa/src is read: words the
// server or shared/ sends are not. The dispatch is read, not the usage text.
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

/** The body of `cmd_<verb>` in `cli`, from its opening line to the next top-level `}`, with its comment lines left out:
 *  a comment that names the refusal ("a bare `ccrc expose` exits 2 (missing subcommand)") is not one. */
function cmdBodyOf(cli: string, verb: string): string | null {
  const head = `\ncmd_${verb.replace(/-/g, '_')}() {`;
  const start = cli.indexOf(head);
  if (start < 0) return null;
  return cli.slice(start, cli.indexOf('\n}\n', start)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

/** The subcommands a verb REQUIRES in `cli`, or `null` when it runs without one. A verb requires one when its body
 *  refuses an empty subcommand (`missing subcommand` / `missing-subcommand`). Its subcommands are the `*_SUBS` list it
 *  names, or else the labels of its first `case "$sub" in`, less help and the catch-alls. A refusal with neither, or a
 *  `case` that names none, THROWS, so a verb the reader cannot read is a red suite, never a verb that accepts any word
 *  (the carry-3 case asks it of every verb of the dispatch). */
function requiredSubsOf(cli: string, verb: string): Set<string> | null {
  const body = cmdBodyOf(cli, verb);
  if (body === null || !/missing[ -]subcommand/.test(body)) return null;
  const list = /\$\{?([A-Z_]+_SUBS)\b/.exec(body);
  if (list !== null) {
    const def = new RegExp(`^${list[1]}="([^"]*)"`, 'm').exec(cli);
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
  if (subs.size === 0) throw new Error(`cmd_${verb} refuses an empty subcommand but its \`case "$sub" in\` names no subcommand`);
  return subs;
}
const requiredSubs = (verb: string): Set<string> | null => requiredSubsOf(CCRC, verb);

/** List 1: ordinary words after the product's name, in prose. One reason for all: the product's name followed by an
 *  ordinary word ("ccrc has not read this repository's visibility yet"), which nobody would read as a command. */
const PLAIN_WORDS: ReadonlySet<string> = new Set([
  'accepts', 'added', 'can', 'cannot', 'closes', 'connects', 'could', 'did', 'does', 'has', 'held', 'holds', 'is', 'keeps',
  'leaves', 'looks', 'made', 'makes', 'never', 'now', 'only', 'pinned', 'predates', 'reaches', 'reads', 'records',
  'returns', 'stopped', 'takes', 'tells', 'to', 'tried', 'tries', 'typed', 'warns', 'will', 'with', 'works', 'would', 'wrote',
]);

/** After a verb that needs a subcommand, prose that names the verb without one, each excused only in the sentence it
 *  stands in today (review run 3901 F1: a plain word after the verb once excused any instruction, "run ccrc expose now"). */
const AFTER_VERB_PROSE: Readonly<Record<string, readonly string[]>> = {
  expose: ['(ccrc expose writes all three)'],
};

/** An exact literal of one file, excused whole, with why: for a text that is the two words and no sentence. */
interface ExactLiteral { readonly file: string; readonly literal: string; readonly why: string }
/** List 2: words that could be read as a command after the product's name, each excused only inside the sentences it
 *  stands in today, or as one exact literal of one file. Every site was read (fix round 1; wave 181) and is prose or a
 *  name that offers nothing to run. A sentence excuses the hit it covers, never another use of the word in the text. */
const COMMAND_LIKE: Readonly<Record<string, readonly (string | ExactLiteral)[]>> = {
  access: ['Give ccrc access'],
  close: ['Let ccrc close these on its own?'],
  connect: ['Address the box sees ccrc connect from (only if the box refused the key)', 'The box sees ccrc connect from a different address than the line allowed.'],
  managed: ['started before ccrc managed browser tools'],
  moves: ['ccrc moves it back to'],
  next: ['when ccrc next checks what this row holds'],
  on: ['Update this Mac with ccrc on the Mac itself.'],
  operator: [{
    file: 'pwa/src/lib/passkey.ts', literal: 'ccrc operator',
    why: "the passkey's user name and display name, which the browser's account picker shows, never an instruction",
  }],
  push: ['[ccrc push] subscribe failed:', '[ccrc push] enable failed:'],
  release: ['Which ccrc release the fleet runs', 'onto the current ccrc release and the newest Claude Code build'],
  restarts: ['ccrc restarts it in place.'],
  runs: ['Each machine ccrc runs on.'],
  sends: ['is not one ccrc sends'],
  sets: ['ccrc sets it up over ssh'],
  stops: ['ccrc stops keeping it for run'],
};

/** One `ccrc <word> [<word>]` the console shows. `shaped` when it sits where a command does. `at` and `end` bound the
 *  product's name and its word in `text`, so a listed sentence excuses this hit only. */
interface Hit { file: string; line: number; text: string; word: string; next?: string; shaped: boolean; at: number; end: number }

const CODE_TAGS = new Set(['code', 'kbd', 'pre', 'samp']);
const COMMAND_NAME = /(^fix$|command)/i;

/** Whether a node sits inside a <code>, <kbd>, <pre> or <samp>, at any depth: its own text, a string in an expression
 *  of one, and an element nested in one (review run 3901 F4). */
function inCodeTag(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isJsxElement(n) && CODE_TAGS.has(n.openingElement.tagName.getText(sf))) return true;
  }
  return false;
}

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
  // Any white space between the words (review run 3901 F2): a tab, a narrow or thin space, and a line wrap in JSX text,
  // which renders as one space.
  for (const m of text.matchAll(/\bccrc\s+([A-Za-z][\w-]*)(?:\s+([A-Za-z-][\w-]*))?/g)) {
    const ticks = ticksBefore + ticksIn(text.slice(0, m.index));
    const end = m.index + m[0].indexOf(m[1]!, 4) + m[1]!.length;
    out.push({ file, line, text, word: m[1]!, next: m[2], shaped: shapedNode || ticks % 2 === 1, at: m.index, end });
  }
  return out;
}

/** Every hit in one source file's string literals, template text and JSX text. */
function hitsOf(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Hit[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push(...hitsIn(n.text, file, lineOf(n), inCommandPosition(n) || inCodeTag(n, sf)));
    } else if (ts.isTemplateExpression(n)) {
      const shaped = inCommandPosition(n) || inCodeTag(n, sf);
      let ticks = 0;
      for (const piece of [n.head, ...n.templateSpans.map((s) => s.literal)]) {
        out.push(...hitsIn(piece.text, file, lineOf(n), shaped, ticks));
        ticks += ticksIn(piece.text);
      }
    } else if (ts.isJsxText(n)) {
      out.push(...hitsIn(n.text, file, lineOf(n), inCodeTag(n, sf)));
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/** Whether `sentence` stands in the hit's text over the hit itself: one of its places in the text covers the product's
 *  name and the word this hit read, so it excuses this hit and no other use of the word (review run 3901 A4). */
function covers(h: Hit, sentence: string): boolean {
  for (let i = h.text.indexOf(sentence); i >= 0; i = h.text.indexOf(sentence, i + 1)) {
    if (i <= h.at && h.end <= i + sentence.length) return true;
  }
  return false;
}
const excusedBy = (h: Hit, e: string | ExactLiteral): boolean =>
  typeof e === 'string' ? covers(h, e) : h.file === e.file && h.text === e.literal;

/** Why a hit is not a command the CLI has and not listed prose, or `null` when it is fine. */
function problem(h: Hit): string | null {
  const where = `${h.file}:${h.line}`;
  if (VERBS.has(h.word)) {
    const subs = requiredSubs(h.word);
    if (subs === null || subs.has(h.next ?? '')) return null;
    if (!h.shaped && (AFTER_VERB_PROSE[h.word] ?? []).some((s) => covers(h, s))) return null;
    return `${where}: "ccrc ${h.word} ${h.next ?? ''}" — ccrc ${h.word} needs one of ${[...subs].join(', ')}`;
  }
  if (h.shaped) return `${where}: "ccrc ${h.word}" is written as a command, and ccrc has no verb "${h.word}"`;
  if (PLAIN_WORDS.has(h.word)) return null;
  if ((COMMAND_LIKE[h.word] ?? []).some((e) => excusedBy(h, e))) return null;
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
    expect(at('pwa/src/fleet/accountWords.ts', (h) => h.word === 'account' && h.next === 'disable' && h.shaped),
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

  // Desktop-polish wave 181 (review run 3901 F1, F2, F4, A4 and carry 3): each case below was red on the guard before it.
  it('after a verb that needs a subcommand, a plain word is excused only in its listed sentence (F1)', () => {
    expect(check("const s = 'Run ccrc expose now to fix it.';")).toHaveLength(1);
    expect(check("const s = 'Fix: run ccrc expose to set the https origin.';")).toHaveLength(1);
    expect(check("const s = 'Then ccrc expose writes the file for you.';")).toHaveLength(1);
    expect(check("const s = 'Each needs a restart (ccrc expose writes all three).';")).toEqual([]);
  });

  it('any white space separates the product name and the word, a line wrap in JSX text included (F2)', () => {
    for (const sep of ['\\t', '\\n', '\\u202f', '\\u2009', '\\u00a0', '  ']) {
      expect(check(`const s = 'Run ccrc${sep}frobnicate-zz there.';`), JSON.stringify(sep)).toHaveLength(1);
    }
    expect(check('const e = <p>Run ccrc\n  frobnicate-zz there.</p>;')).toHaveLength(1);
    expect(check('const e = <p>Run <code>ccrc\n  frobnicate-zz</code> there.</p>;')).toHaveLength(1);
  });

  it('inside a code tag, a string expression and a nested element are read as commands (F4)', () => {
    expect(check("const e = <code>{'ccrc has'}</code>;")).toHaveLength(1);
    expect(check("const e = <code>{ok ? 'ccrc has' : 'ccrc passwd'}</code>;")).toHaveLength(1);
    expect(check('const e = <code><span>ccrc has</span></code>;')).toHaveLength(1);
    expect(check('const e = <kbd><b><i>ccrc has</i></b></kbd>;')).toHaveLength(1);
    // Outside one, prose stays prose.
    expect(check("const e = <p>{'ccrc has not read it yet.'}</p>;")).toEqual([]);
  });

  it('a command-like word is excused per hit, never by its sentence elsewhere in the text (A4)', () => {
    expect(check("const s = 'If it sticks, run ccrc operator reset there.';")).toHaveLength(1);
    expect(check("const s = 'Give ccrc access, then run ccrc access --all.';")).toHaveLength(1);
    expect(check("const s = 'Give ccrc access to the repository.';")).toEqual([]);
    // The passkey's user name is excused as that exact literal in that file only.
    expect(check("const o = { name: 'ccrc operator' };", 'pwa/src/lib/passkey.ts')).toEqual([]);
    expect(check("const o = { name: 'ccrc operator' };", 'pwa/src/lib/other.ts')).toHaveLength(1);
  });

  it('every listed sentence names its own word after the product name and is a sentence, not the two words', () => {
    for (const [w, entries] of Object.entries(COMMAND_LIKE)) {
      for (const e of entries) {
        if (typeof e === 'string') {
          expect(e, `COMMAND_LIKE ${w}`).toMatch(new RegExp(`\\bccrc\\s+${w}\\b`));
          expect(e.trim().split(/\s+/).length, `COMMAND_LIKE ${w}: "${e}" is more than the two words`).toBeGreaterThan(2);
        } else {
          expect(e.literal, `COMMAND_LIKE ${w}`).toMatch(new RegExp(`^ccrc\\s+${w}$`));
          expect(e.file).toMatch(/^pwa\/src\//);
          expect(e.why.split(/\s+/).length, `COMMAND_LIKE ${w}: the exact literal's reason is a sentence`).toBeGreaterThan(5);
        }
      }
    }
    for (const [v, sentences] of Object.entries(AFTER_VERB_PROSE)) {
      expect(VERBS.has(v), `AFTER_VERB_PROSE ${v} is a verb`).toBe(true);
      for (const t of sentences) expect(t, `AFTER_VERB_PROSE ${v}`).toMatch(new RegExp(`\\bccrc\\s+${v}\\s+\\w`));
    }
  });

  it('the reader finds a verb\'s subcommands from its refusal, and a refusal it cannot read fails loudly (carry 3)', () => {
    expect([...requiredSubs('auth')!].sort()).toEqual(['off', 'on']);
    expect(check("const s = 'Then run ccrc auth on there.';")).toEqual([]);
    expect(check("const s = 'Then run ccrc auth now.';")).toHaveLength(1);
    // Every verb of the dispatch is readable: a refusal with no list to read throws here, whatever the console shows.
    for (const v of VERBS) expect(() => requiredSubs(v), v).not.toThrow();
    // The same reader over an invented CLI: a refusal and no list throws; a comment naming the refusal is not one.
    const cli = (body: string): string => `\ncmd_zz() {\n${body}\n}\n`;
    expect(() => requiredSubsOf(cli('  echo "zz: missing subcommand" >&2; exit 2'), 'zz')).toThrow(/no `case "\$sub" in`/);
    expect(requiredSubsOf(cli('  # a bare `ccrc zz` exits 2 (missing subcommand)\n  echo ok'), 'zz')).toBeNull();
  });

  it('no sentence of the second list is stale', () => {
    // COMMAND_LIKE only: each of its sentences excuses a word that could be read as a command, so one that is gone is
    // cut. PLAIN_WORDS is not checked: a stale plain word excuses only an ordinary word, and a word another branch needs
    // ("tells", from main) is listed before that branch's sentence reaches this one.
    const prose = HITS.filter((h) => !h.shaped);
    for (const [w, entries] of Object.entries(COMMAND_LIKE)) {
      for (const e of entries) {
        expect(prose.some((h) => h.word === w && excusedBy(h, e)), `COMMAND_LIKE ${w}: ${JSON.stringify(e)} is gone`).toBe(true);
      }
    }
    for (const [v, sentences] of Object.entries(AFTER_VERB_PROSE)) {
      for (const t of sentences) expect(prose.some((h) => h.word === v && covers(h, t)), `AFTER_VERB_PROSE ${v}: "${t}" is gone`).toBe(true);
    }
  });
});
