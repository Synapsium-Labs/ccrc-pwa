// ONE CLASS NAME, ONE ELEMENT — whenever a @ccrc/ui component wears it.
//
// WHY THIS EXISTS. The account picker's row is `<ListRow>`, and it was handed
// the hook class `acct-row`. `AccountMeterRow`'s 5h/7d gauge line is a plain
// `<div className="acct-row">`, and fleet.css styles that div with an
// UNSCOPED, UNLAYERED rule — `display: grid; grid-template-columns: 1.5em
// minmax(0,1fr) auto auto; gap: 5px`. ListRow's own shape is Tailwind
// utilities in `@layer utilities`, and an unlayered rule beats every layer
// (`ui/src/styles/theme.css` states the ordering). So the gauge line's grid won
// on the picker row: grid for flex, gap 5px for 12px, the account chip
// squeezed from 87px to 18px, and in the Swap sheet the "suggested" pill laid
// over the account name — in both pickers, at every width, in every palette.
//
// Nothing in the suite could see it. The contrast gate reads colours; the
// censuses read rules or markup one side at a time; vitest renders no
// stylesheet. And the comment that deleted the old scoped rule said the
// opposite of what happened: "A component cannot collide with a class name".
// It can — in exactly one direction, the one the layering makes the app win.
//
// THE RULE THIS PINS. A class that some app stylesheet selects, worn by a
// @ccrc/ui component, is that component's hook and names nothing else: not an
// intrinsic element, not an app component, not a second @ccrc/ui component.
// A rule written for one of them otherwise lands on the other, and on the
// component it lands unlayered.
//
// WHAT IT DOES NOT SEE, said rather than discovered: a class reaching
// `className` through a variable or a constant (only literals, template
// literal pieces, both arms of a ternary, `&&`/`||` operands and `cn()`/`clsx()`
// arguments are read), and a collision between two plain app elements, which
// is ordinary app CSS and not this layering inversion.
//
// MEASURED (baseline green):
//
//   | mutation                                                 | result |
//   |----------------------------------------------------------|--------|
//   | AccountRow's ListRow back to `className="acct-row"`      | 2 red  |
//   | the parser stops reading `cn()` arguments                | 1 red  |
//   | the parser stops reading ternary arms                    | 1 red  |
//   | an exception registered for a class no longer shared     | 1 red  |
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const APP_SRC = path.join(import.meta.dirname, '..', 'src');

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext) && !e.name.endsWith('.stories.tsx')) out.push(p);
  }
  return out;
}

/** Every class an APP stylesheet selects, in any position of any selector.
 *  These sheets are the unlayered ones — the side of the cascade that wins. */
export function appSelected(css: string): Set<string> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '');
  const out = new Set<string>();
  // Selectors only: the text before each `{`, never a declaration value.
  for (const m of bare.matchAll(/([^{};]+)\{/g)) {
    const sel = m[1] ?? '';
    if (sel.trim().startsWith('@')) continue;
    for (const c of sel.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(c[1] ?? '');
  }
  return out;
}

/** The whole class tokens a className expression can put on an element. A
 *  token touching a template hole (`foo-${x}`) is not a class this file can
 *  name, so it is dropped rather than guessed. */
function classTokens(e: ts.Expression | ts.JsxExpression | undefined, sf: ts.SourceFile): string[] {
  if (e === undefined) return [];
  const words = (s: string, keepHead = true, keepTail = true): string[] => {
    const parts = s.split(/\s+/);
    if (!keepHead) parts.shift();
    if (!keepTail) parts.pop();
    return parts.filter((p) => /^[a-z][a-z0-9-]*$/.test(p));
  };
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return words(e.text);
  if (ts.isTemplateExpression(e)) {
    const out = words(e.head.text, true, /\s$/.test(e.head.text));
    for (const span of e.templateSpans) {
      const t = span.literal.text;
      const last = span === e.templateSpans[e.templateSpans.length - 1];
      out.push(...words(t, /^\s/.test(t), last || /\s$/.test(t)));
    }
    return out;
  }
  if (ts.isJsxExpression(e)) return classTokens(e.expression, sf);
  if (ts.isParenthesizedExpression(e)) return classTokens(e.expression, sf);
  if (ts.isConditionalExpression(e)) return [...classTokens(e.whenTrue, sf), ...classTokens(e.whenFalse, sf)];
  if (ts.isBinaryExpression(e)) return [...classTokens(e.left, sf), ...classTokens(e.right, sf)];
  if (ts.isCallExpression(e) && /^(cn|clsx)$/.test(e.expression.getText(sf))) {
    return e.arguments.flatMap((a) => classTokens(a, sf));
  }
  return [];
}

/** `class -> wearers` for one file. A wearer is `ui:<Component>` for a
 *  component this file imports from `@ccrc/ui`, `<tag>` for an intrinsic
 *  element, `app:<Component>` for anything else. */
export function wearers(file: string, source: string): Map<string, Set<string>> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fromUi = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (st.moduleSpecifier.text !== '@ccrc/ui') continue;
    const nb = st.importClause?.namedBindings;
    if (nb !== undefined && ts.isNamedImports(nb)) for (const el of nb.elements) fromUi.add(el.name.text);
  }
  const out = new Map<string, Set<string>>();
  const visit = (n: ts.Node): void => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const who = /^[a-z]/.test(tag)
        ? `<${tag}>`
        : fromUi.has(tag.split('.')[0] ?? '') ? `ui:${tag}` : `app:${tag}`;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'className') continue;
        for (const c of classTokens(a.initializer as ts.Expression | undefined, sf)) {
          const set = out.get(c) ?? new Set<string>();
          set.add(who);
          out.set(c, set);
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/** Classes a @ccrc/ui component wears that something else also wears, among
 *  the classes `selected` names. `class -> sorted wearers (with files)`. */
export function collisions(
  files: readonly { file: string; source: string }[], selected: Set<string>,
): Record<string, string[]> {
  const all = new Map<string, Set<string>>();
  for (const { file, source } of files) {
    for (const [c, ws] of wearers(file, source)) {
      const set = all.get(c) ?? new Set<string>();
      for (const w of ws) set.add(`${w} ${file}`);
      all.set(c, set);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [c, ws] of all) {
    if (!selected.has(c)) continue;
    const kinds = new Set([...ws].map((w) => w.split(' ')[0] ?? ''));
    const ui = [...kinds].filter((k) => k.startsWith('ui:'));
    if (ui.length === 0) continue;
    if (kinds.size > 1) out[c] = [...ws].sort();
  }
  return out;
}

/** Shared names that are ONE role rendered two ways, with the reason. A rule
 *  written for one of them is written for both, so nothing lands by accident. */
export const ONE_ROLE: Record<string, string> = {
  'compaction-body':
    "MessageBubble's compaction card body, rendered as `<pre>` for a raw body and as `<Prose>` "
    + 'for a markdown one — the same slot in the same component, and `.compaction-body` '
    + '(chat.css: padding and the top hairline) is written for that slot whichever renders it.',
};

const FILES = walk(APP_SRC, '.tsx').map((f) => ({
  file: path.relative(APP_SRC, f), source: readFileSync(f, 'utf8'),
}));
const SELECTED = appSelected(walk(APP_SRC, '.css').map((f) => readFileSync(f, 'utf8')).join('\n'));

describe('a class worn by a @ccrc/ui component names nothing else', () => {
  it('no app-selected class is worn by a design-system component and by another element', () => {
    const found = collisions(FILES, SELECTED);
    for (const c of Object.keys(ONE_ROLE)) delete found[c];
    expect(
      found,
      'an unlayered app rule written for one wearer lands on the other, and beats the component\'s '
      + 'utilities there — give the component its own hook class',
    ).toEqual({});
  });

  it('registers no one-role exception the scan no longer finds', () => {
    const found = collisions(FILES, SELECTED);
    expect(Object.keys(ONE_ROLE).filter((c) => found[c] === undefined)).toEqual([]);
  });

  it('every exception carries its reason', () => {
    for (const [c, why] of Object.entries(ONE_ROLE)) {
      expect(why.length, `${c} is registered with no reason`).toBeGreaterThan(40);
    }
  });

  it('the account picker and the gauge line wear different names', () => {
    const merged = new Map<string, Set<string>>();
    for (const { file, source } of FILES) {
      for (const [c, ws] of wearers(file, source)) {
        const set = merged.get(c) ?? new Set<string>();
        for (const w of ws) set.add(w);
        merged.set(c, set);
      }
    }
    expect([...(merged.get('acct-row') ?? [])]).toEqual(['<div>']);
    expect([...(merged.get('acct-pick') ?? [])]).toEqual(['ui:ListRow']);
    // The gauge line's rule is the unscoped one the picker must never meet.
    expect(SELECTED.has('acct-row')).toBe(true);
  });

  it('scanned real hooks — the walk is not vacuously empty', () => {
    let hooks = 0;
    const seen = new Set<string>();
    for (const { file, source } of FILES) {
      for (const [c, ws] of wearers(file, source)) {
        if ([...ws].some((w) => w.startsWith('ui:')) && SELECTED.has(c) && !seen.has(c)) {
          seen.add(c);
          hooks += 1;
        }
      }
    }
    // Measured 74 files and 33 hooks the day this landed.
    expect(FILES.length).toBeGreaterThan(50);
    expect(hooks).toBeGreaterThanOrEqual(25);
  });
});

describe('the collision scan, against the shapes it exists for', () => {
  const sel = new Set(['acct-row', 'menu-item', 'x-hook']);
  const imp = "import { ListRow, Button } from '@ccrc/ui';\n";

  it('reds on the exact shape that shipped', () => {
    const files = [
      { file: 'AccountRow.tsx', source: `${imp}export const A = () => <ListRow className="acct-row">a</ListRow>;` },
      { file: 'AccountMeterRow.tsx', source: 'export const B = () => <div className="acct-row">b</div>;' },
    ];
    expect(Object.keys(collisions(files, sel))).toEqual(['acct-row']);
  });

  it('reads cn() arguments, both ternary arms, && operands and template pieces', () => {
    const src = `${imp}export const A = (p: boolean) => <>
      <Button className={cn('x-hook', p && 'menu-item')}>a</Button>
      <ListRow className={p ? 'acct-row' : 'z'}>b</ListRow>
      <span className={\`x-hook \${p ? 'q' : 'r'}\`} />
      <i className={\`menu-\${p}\`} />
    </>;`;
    const w = wearers('A.tsx', src);
    expect([...(w.get('x-hook') ?? [])].sort()).toEqual(['<span>', 'ui:Button']);
    expect([...(w.get('menu-item') ?? [])]).toEqual(['ui:Button']);
    expect([...(w.get('acct-row') ?? [])]).toEqual(['ui:ListRow']);
    // a token touching a template hole is not a nameable class
    expect(w.has('menu-')).toBe(false);
  });

  it('reds on two DIFFERENT design-system components sharing a hook', () => {
    const files = [
      { file: 'A.tsx', source: `${imp}export const A = () => <Button className="x-hook">a</Button>;` },
      { file: 'B.tsx', source: `${imp}export const B = () => <ListRow className="x-hook">b</ListRow>;` },
    ];
    expect(Object.keys(collisions(files, sel))).toEqual(['x-hook']);
  });

  it('leaves alone a hook worn only by its component, a utility no app rule selects, and app-only sharing', () => {
    const files = [
      { file: 'A.tsx', source: `${imp}export const A = () => <><ListRow className="menu-item">a</ListRow><ListRow className="menu-item">b</ListRow></>;` },
      { file: 'B.tsx', source: `${imp}export const B = () => <><Button className="flex-none">c</Button><div className="flex-none" /></>;` },
      { file: 'C.tsx', source: 'export const C = () => <><div className="acct-row" /><p className="acct-row" /></>;' },
    ];
    expect(collisions(files, sel)).toEqual({});
  });

  it('reads selectors, not declaration values or comments', () => {
    const s = appSelected('/* .ghost {} */ .a .b:hover, .c > .d { background: url(x.png); width: .5em }');
    expect([...s].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
