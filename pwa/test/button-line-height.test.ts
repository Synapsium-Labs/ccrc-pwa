// Every Button the app renders sets its text on a line-height of 1.
//
// WHY. On main every button family declared its type as a `font` shorthand
// ending `/ 1` — `.btn-primary`, `.btn-ghost`, and the four raised mono
// controls `Button`'s `quiet` variant folded (`.program-start-door` among
// them). The design system's variants said `text-base` with no leading, and a
// Tailwind v4 `text-*` utility also sets `line-height: var(--tw-leading,
// var(--text-*--line-height))` — Tailwind's own default, 1.5 for `text-base`.
// Measured in a rendered build: Reboot, Restart session, Swap account,
// Archive, Hold, Cancel and Reconnect went 15px -> 22.5px, and the quiet
// "Start a program" door 12px -> 16px, because tailwind-merge drops a
// `leading-none` when a later `text-*` arrives through `className`. Invisible
// on a one-line label inside `min-h-tap`; +50% per line once a label wraps.
//
// SO THE CHECK IS ON THE MERGED STRING, per call site: what `Button` actually
// puts on the element is `cn(buttonVariants({ variant, size }), className)`,
// and the call site's `className` is exactly where a `text-*` can knock the
// leading out. Derived from the tree, not listed.
//
// MEASURED (baseline green): `leading-none` dropped from the primary variant
// -> 2 red; from the ghost variant -> 2 red; RunsScreen's door back to
// `className="program-start-door text-xs"` -> 1 red; `PROGRAM_GO` back to
// `'program-start-go text-sm …'` with no leading -> 1 red.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { buttonVariants, cn } from '@ccrc/ui';

const APP_SRC = path.join(import.meta.dirname, '..', 'src');
const VARIANTS = ['primary', 'ghost', 'quiet'] as const;
type Variant = (typeof VARIANTS)[number];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out.sort();
}

/** Every top-level `const NAME = '<literal>'` in the app, by name — the way a
 *  class string travels as a constant (`PROGRAM_GO` is written in one file and
 *  worn in two). A name bound to two different strings is left out. */
function stringConsts(files: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const clash = new Set<string>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (!ts.isIdentifier(d.name) || init === undefined) continue;
        if (!ts.isStringLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init)) continue;
        const prev = out.get(d.name.text);
        if (prev !== undefined && prev !== init.text) clash.add(d.name.text);
        out.set(d.name.text, init.text);
      }
    }
  }
  for (const c of clash) out.delete(c);
  return out;
}

const CONSTS = stringConsts(walk(APP_SRC));

/** The string values an attribute can take: a literal, a string constant, or
 *  the arms of a ternary. `null` when it is not statically knowable. */
function literals(init: ts.JsxAttributeValue | undefined): string[] | null {
  if (init === undefined) return null;
  const of = (e: ts.Expression): string[] | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isIdentifier(e)) {
      const v = CONSTS.get(e.text);
      return v === undefined ? null : [v];
    }
    if (ts.isParenthesizedExpression(e)) return of(e.expression);
    if (ts.isConditionalExpression(e)) {
      const a = of(e.whenTrue);
      const b = of(e.whenFalse);
      return a === null || b === null ? null : [...a, ...b];
    }
    return null;
  };
  if (ts.isStringLiteral(init)) return [init.text];
  if (ts.isJsxExpression(init) && init.expression !== undefined) return of(init.expression);
  return null;
}

interface Site { where: string; merged: string }

/** Every `<Button>` in the app, as the class string it would render. */
function sites(): { found: Site[]; opaque: string[] } {
  const found: Site[] = [];
  const opaque: string[] = [];
  for (const file of walk(APP_SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!/\bButton\b/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === 'Button') {
        const where = `${path.relative(APP_SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
        let variants: string[] | null = ['primary'];
        let sizes: string[] | null = ['full'];
        let classNames: string[] | null = [''];
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a)) continue;
          const name = a.name.getText(sf);
          if (name === 'variant') variants = literals(a.initializer);
          if (name === 'size') sizes = literals(a.initializer);
          if (name === 'className') classNames = literals(a.initializer);
        }
        // An unknowable variant is checked under every variant; an unknowable
        // className is recorded, because it is the one input that can carry a
        // `text-*` this file cannot see.
        if (classNames === null) { opaque.push(where); classNames = ['']; }
        for (const variant of variants ?? VARIANTS) {
          for (const size of sizes ?? ['full', 'fit']) {
            for (const className of classNames) {
              const merged = cn(buttonVariants({
                variant: variant as Variant, size: size as 'full' | 'fit',
              }), className);
              found.push({ where: `${where} ${variant}/${size} "${className}"`, merged });
            }
          }
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return { found, opaque };
}

const hasLeadingOne = (classes: string): boolean => /(^|\s)leading-none(\s|$)/.test(classes);

describe('every Button sets its text at line-height 1, as main did', () => {
  it('each variant on its own', () => {
    for (const variant of VARIANTS) {
      expect(hasLeadingOne(buttonVariants({ variant })), variant).toBe(true);
    }
  });

  it('every call site, after its className is merged in', () => {
    const { found } = sites();
    const lost = found.filter((s) => !hasLeadingOne(s.merged)).map((s) => s.where);
    expect(lost, 'a `text-*` in className drops the leading — pass `leading-none` after it').toEqual([]);
  });

  it('read real call sites — the scan is not vacuously empty', () => {
    const { found } = sites();
    // Measured 70 the day this landed, every className resolved — the three
    // that are not literals wear `PROGRAM_GO`, a constant carrying `text-sm`,
    // which knocked the quiet variant's `leading-none` out exactly as the door
    // above did. A parser that stopped seeing Button would leave the check
    // above passing over nothing; one that stopped resolving constants would
    // stop seeing the second case.
    expect(found.length).toBeGreaterThan(40);
    expect(sites().opaque).toEqual([]);
    expect(found.some((s) => s.where.includes('program-start-go'))).toBe(true);
    expect(found.some((s) => s.where.includes('quiet') && s.where.includes('program-start-door'))).toBe(true);
  });

  it('the merge really does drop a leading a later text-* collides with — the reason for the scan', () => {
    expect(hasLeadingOne(cn('text-2xs leading-none', 'text-xs'))).toBe(false);
    expect(hasLeadingOne(cn('text-2xs leading-none', 'text-xs leading-none'))).toBe(true);
  });
});
