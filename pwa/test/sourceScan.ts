// THE SOURCE SCANS THE TWO IDENTITY GUARDS SHARE (D-5094): `skin-identity.test.ts` (the token half) and
// `skin-boundary.test.ts` (the element half, W2 Task S4a). One copy each, so a colour the token half refuses is the
// colour the element half refuses, and neither half can narrow a predicate the other still relies on. Moved here
// verbatim from `skin-identity.test.ts`; not a test file, so it registers no suite of its own.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Every CSS named colour (CSS Color 4), `transparent`, and the system colours,
 *  deprecated ones included, since a browser still paints them. `currentColor`
 *  is deliberately NOT here: it has its own check (d2), and a second copy would
 *  let either check be deleted unnoticed. */
export const NAMED_COLOURS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
  'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue',
  'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
  'transparent',
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
  'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext',
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight',
  'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption', 'inactivecaptiontext',
  'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar', 'threeddarkshadow',
  'threedface', 'threedhighlight', 'threedlightshadow', 'threedshadow', 'window', 'windowframe',
  'windowtext',
]);

/** Comments blanked, as `design/audit.mjs`'s `readCss` does: a comment is
 *  never a declaration, and skins.css's own header names the hazards it
 *  guards against. */
export const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

export const squash = (s: string): string => s.trim().replace(/\s+/g, ' ');

export interface Decl {
  readonly prop: string;
  readonly value: string;
  /** Every enclosing prelude, outermost first: `['@media (pointer: fine)',
   *  ":root[data-skin='instrument']"]`. */
  readonly chain: readonly string[];
}

export interface Parsed {
  readonly decls: readonly Decl[];
  /** Every block's chain, its own prelude last. */
  readonly chains: readonly (readonly string[])[];
  /** Statements outside every block (an `@import`, a bare declaration). */
  readonly stray: readonly string[];
}

/** A brace walk, not a lazy regex: a regex stops at a nested rule's closing
 *  brace and sees half a media block. Quotes and parentheses are tracked, so
 *  a `;` inside either never splits a declaration. Unbalanced braces throw,
 *  which reds the case that read the file. */
export function parseCss(text: string): Parsed {
  const src = stripCss(text);
  const decls: Decl[] = [];
  const chains: string[][] = [];
  const stray: string[] = [];
  const stack: string[] = [];
  let buf = '';
  let paren = 0;
  let quote = '';
  const flush = (): void => {
    const t = squash(buf);
    buf = '';
    if (t === '') return;
    if (stack.length === 0) {
      stray.push(t);
      return;
    }
    const colon = t.indexOf(':');
    decls.push(colon < 0
      ? { prop: t, value: '', chain: [...stack] }
      : { prop: t.slice(0, colon).trim(), value: t.slice(colon + 1).trim(), chain: [...stack] });
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] as string;
    if (quote !== '') {
      buf += c;
      if (c === '\\') buf += src[(i += 1)] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    if (paren > 0) {
      buf += c;
      continue;
    }
    if (c === '{') {
      stack.push(squash(buf));
      chains.push([...stack]);
      buf = '';
    } else if (c === '}') {
      flush();
      if (stack.pop() === undefined) throw new Error('an unbalanced } in the stylesheet');
    } else if (c === ';') {
      flush();
    } else {
      buf += c;
    }
  }
  flush();
  if (stack.length > 0) throw new Error(`an unclosed { after "${stack.join(' { ')}"`);
  return { decls, chains, stray };
}

/** Every colour literal in one value: hex, a colour function, a named colour.
 *  An identifier counts only standing alone, never inside a custom property's
 *  name (`--edge-strong`) or as a function's name. */
export function colourLiteralsIn(value: string): string[] {
  const hits: string[] = [];
  for (const m of value.matchAll(/#[0-9a-f]{3,8}\b/gi)) hits.push(m[0]);
  for (const m of value.matchAll(
    /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\s*\(/gi,
  )) hits.push(`${m[1] ?? ''}()`);
  for (const m of value.matchAll(/(?<![\w-])([a-z]+)(?![\w(-])/gi)) {
    const word = m[1] ?? '';
    if (NAMED_COLOURS.has(word.toLowerCase())) hits.push(word);
  }
  return hits;
}

/** Every file under `root` whose name `keep` accepts, repo-relative, sorted. */
export function filesUnder(tree: string, root: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(tree, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(rel);
      } else if (e.isFile() && keep(e.name)) {
        out.push(rel);
      }
    }
  };
  if (existsSync(path.join(tree, root))) walk(root);
  return out.sort();
}

/** JS and TS with their comments blanked, and their strings, template
 *  literals and regex literals kept verbatim. Not a regex replace: the tree
 *  holds `'image/*'` and `/^\/*\/` (a string and a regex), and a bare
 *  block-comment regex opens a "comment" at either and swallows real code up
 *  to the next `*\/`, hiding whatever it holds. */
export function stripJs(src: string): string {
  let out = '';
  let i = 0;
  let last = ''; // the last significant character of code
  const closes: number[] = []; // the brace depth each open `${` closes at
  let depth = 0;
  const regexMayStart = (): boolean =>
    last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last)
    || /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new|throw)$/.test(out.slice(-16).trimEnd());
  const template = (): void => {
    while (i < src.length) {
      const c = src[i] as string;
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        out += c;
        i += 1;
        last = c;
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        closes.push(depth);
        depth += 1;
        last = '{';
        return;
      } else {
        out += c;
        i += 1;
      }
    }
  };
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      last = c;
    } else if (c === '`') {
      out += c;
      i += 1;
      template();
    } else if (c === '/' && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        const r = src[j];
        if (r === '\\') {
          j += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        j += 1;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      last = '/';
    } else {
      if (c === '{') depth += 1;
      if (c === '}') {
        depth -= 1;
        if (closes.length > 0 && closes[closes.length - 1] === depth) {
          closes.pop();
          out += c;
          i += 1;
          template();
          continue;
        }
      }
      out += c;
      i += 1;
      if (!/\s/.test(c)) last = c;
    }
  }
  return out;
}
