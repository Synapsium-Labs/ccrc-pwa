// D-8270 (ruling Q8): the census's measuring half. `bashCode` reduces a bash source to the text bash would RUN — comments,
// heredoc bodies and the literal text of quoted strings blanked, every command substitution inside a string kept —
// with every newline kept, so a line number in the result is a line number in the file. `rawBashTmux` finds each
// `tmux` invocation in it, and `rawTsTmux` each call in TypeScript or JavaScript that names the literal 'tmux' as the
// program. The suite that holds the tree to them is `tmux-socket-census.test.ts`.
//
// KNOWN WIDTH, said rather than hidden: a tmux command inside a STRING that is later run (`bash -c "…tmux …"`, an
// `eval`) is literal text here and is not seen; a `case` pattern's `)` inside a `$( … )` would end the substitution
// early. Neither shape is in the tree; a new one is a review question, not a census one.
import { stripTs } from './growthCheck.js';

/** `src` with comments, heredoc bodies and quoted literal text replaced by spaces; newlines kept. */
export function bashCode(src: string): string {
  const out: string[] = [];
  /** Open frames: `c` code (top level, `$( … )` with its paren depth, or a backtick span), `a` arithmetic (`$(( … ))`,
   *  `(( … ))`, where `<<` is a shift and never a heredoc), `d` a double-quoted string. */
  const stack: { k: 'c' | 'a' | 'd' | 'b'; depth: number }[] = [{ k: 'c', depth: 0 }];
  /** Heredocs opened on the current line, whose bodies follow its newline. */
  const pending: { delim: string; tabs: boolean }[] = [];
  const n = src.length;
  let i = 0;
  const blank = (c: string): string => (c === '\n' ? '\n' : ' ');
  const top = () => stack[stack.length - 1]!;
  const wordStart = (): boolean => {
    const p = out.length === 0 ? '\n' : out[out.length - 1]!;
    return /[\s;|&(]/.test(p);
  };
  while (i < n) {
    const c = src[i]!;
    const f = top();
    if (c === '\n' && pending.length > 0) {
      // The heredoc bodies start on the next line: blank every line up to and including each delimiter.
      out.push('\n'); i++;
      while (pending.length > 0 && i < n) {
        const end = src.indexOf('\n', i);
        const line = src.slice(i, end < 0 ? n : end);
        const { delim, tabs } = pending[0]!;
        if ((tabs ? line.replace(/^\t+/, '') : line) === delim) pending.shift();
        out.push(line.replace(/[^\n]/g, ' '));
        if (end < 0) { i = n; break; }
        out.push('\n'); i = end + 1;
      }
      continue;
    }
    if (f.k === 'd') {
      if (c === '\\') { out.push(' ', blank(src[i + 1] ?? '')); i += 2; continue; }
      if (c === '"') { stack.pop(); out.push(c); i++; continue; }
      if (c === '$' && src[i + 1] === '(' && src[i + 2] === '(') { stack.push({ k: 'a', depth: 2 }); out.push('$(('); i += 3; continue; }
      if (c === '$' && src[i + 1] === '(') { stack.push({ k: 'c', depth: 1 }); out.push('$('); i += 2; continue; }
      if (c === '`') { stack.push({ k: 'b', depth: 0 }); out.push(c); i++; continue; }
      out.push(blank(c)); i++;
      continue;
    }
    // Code: the top level, a `$( … )` or a backtick span.
    if (c === '\\') { out.push(c, src[i + 1] ?? ''); i += 2; continue; }
    if (c === '#' && wordStart()) {
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (c === "'" || (c === '$' && src[i + 1] === "'")) {
      const ansi = c === '$';
      out.push(ansi ? '$\'' : "'"); i += ansi ? 2 : 1;
      while (i < n && src[i] !== "'") {
        if (ansi && src[i] === '\\') { out.push(' ', blank(src[i + 1] ?? '')); i += 2; continue; }
        out.push(blank(src[i]!)); i++;
      }
      out.push("'"); i++;
      continue;
    }
    if (c === '"') { stack.push({ k: 'd', depth: 0 }); out.push(c); i++; continue; }
    if (c === '`') {
      if (f.k === 'b') stack.pop(); else stack.push({ k: 'b', depth: 0 });
      out.push(c); i++;
      continue;
    }
    if (c === '$' && src[i + 1] === '(' && src[i + 2] === '(') { stack.push({ k: 'a', depth: 2 }); out.push('$(('); i += 3; continue; }
    if (c === '$' && src[i + 1] === '(') { stack.push({ k: 'c', depth: 1 }); out.push('$('); i += 2; continue; }
    if (c === '(' && src[i + 1] === '(' && f.k !== 'a' && wordStart()) { stack.push({ k: 'a', depth: 2 }); out.push('(('); i += 2; continue; }
    if (c === '(' && (f.k === 'a' || (stack.length > 1 && f.k === 'c'))) { f.depth++; out.push(c); i++; continue; }
    if (c === ')' && (f.k === 'a' || (stack.length > 1 && f.k === 'c'))) {
      f.depth--; out.push(c); i++;
      if (f.depth === 0) stack.pop();
      continue;
    }
    if (f.k !== 'a' && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && (i === 0 || src[i - 1] !== '<')) {
      const m = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(src.slice(i, i + 80));
      if (m) { pending.push({ delim: m[3]!, tabs: m[1] === '-' }); out.push(m[0]); i += m[0].length; continue; }
    }
    out.push(c); i++;
  }
  return out.join('');
}

export interface Site { file: string; line: number; text: string }

/** `tmux` as a program: the word, then a blank, then an argument — never `command -v tmux`, `type -t tmux` or
 *  `declare -F tmux` (questions about the program, not calls of it), never `tmux)` or `tmux >/dev/null`. */
const BASH_TMUX = /(^|[^A-Za-z0-9_.$:{-])tmux(?=[ \t]+[^\s>)<;|&=\]}])/g;
const NOT_A_CALL = /(?:command[ \t]+-v|type[ \t]+-[tP]|declare[ \t]+-[fF])[ \t]+$/;

export function rawBashTmux(file: string, src: string): Site[] {
  const code = bashCode(src).split('\n');
  const lines = src.split('\n');
  const out: Site[] = [];
  code.forEach((l, i) => {
    for (const m of l.matchAll(BASH_TMUX)) {
      const before = l.slice(0, m.index! + m[1]!.length);
      if (NOT_A_CALL.test(before)) continue;
      out.push({ file, line: i + 1, text: lines[i]!.trim() });
    }
  });
  return out;
}

/** A call whose program is the literal 'tmux' (`spawn('tmux', …)`, `this.run('tmux', …)`, `spawnSync("tmux", …)`),
 *  or a spawn table row naming it (`file: 'tmux'`), in comment-stripped TypeScript or JavaScript. */
const TS_TMUX = /\b[A-Za-z_$][\w$]*\s*\(\s*(['"`])tmux\1|\bfile\s*:\s*(['"`])tmux\2/g;

export function rawTsTmux(file: string, src: string): Site[] {
  const code = stripTs(src).split('\n');
  const lines = src.split('\n');
  const out: Site[] = [];
  code.forEach((l, i) => {
    for (const _ of l.matchAll(TS_TMUX)) out.push({ file, line: i + 1, text: lines[i]!.trim() });
  });
  return out;
}
