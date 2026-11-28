// An item's text as one line of plain words, for every place that SUMMARISES it (a list row, a push, a mail subject,
// a notice, a card, a live region). The item's own page draws the Markdown; everywhere else the marks would read as noise.
//
// Ring: L0/L1, context Coordination. It imports nothing at all, because the PWA bundles `shared/*.ts` and the server
// reads the same file: ONE projection, so a surface cannot disagree with another about what a title says.
//
// It is a hand-written scanner, not a Markdown parser, and it removes only what an item writer MEANS as a mark: fences, inline
// code, asterisk emphasis, `~~`, links, images and autolinks (an address or a mail address in angle brackets). It KEEPS what old
// prose used as words: leading `#` and `> `, list markers, underscores (`snake_case`, `__init__`), a glob star
// (`src/*.ts`) and `5*3*2` (an asterisk run whose outer side is a letter, a digit, `/` or `.` is no emphasis), and a glob that
// ends a sentence (`Remove *.log. Keep src/* as it is.`: a run with `.` or `/` just inside its opener, or `/` just inside its
// closer, is no emphasis either), a backslash before punctuation and a character reference (`\\.`, `&amp;`), both as written,
// as the item page keeps them (fix round 1 of wave 186, A2). A paragraph's lines are read as one text, as the page reads them,
// so a code span or an emphasis across a soft line break is one mark (F7); `itemPlainLines` keeps the lines.
// Text with no marks comes back unchanged apart from its whitespace. Every scan is bounded, so a hostile run of `*`, `[` or
// backticks costs linear time.

const MAX_DEPTH = 8;
const MAX_DEST = 400;
/** CommonMark's two autolinks: an absolute address (a scheme, then no space or angle bracket) and a mail address. */
const URI_AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL_AUTOLINK = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const isPunct = (c: string): boolean => c.length === 1 && c.charCodeAt(0) < 128 && /[!-/:-@[-`{-~]/.test(c);
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
/** The outer side of an emphasis run may not be one of these: it is a word, a number, a path or a glob, not a mark. */
const wordish = (c: string | undefined): boolean => c !== undefined && (/[\p{L}\p{N}]/u.test(c) || c === '/' || c === '.');
/** After a closing run, a full stop ends the sentence (`*this*.`), so only a letter, a digit or `/` binds it; the item's
 *  renderer reads the same rule (`remarkItemGuard.ts`). */
const closeBound = (c: string | undefined): boolean => c !== undefined && (/[\p{L}\p{N}]/u.test(c) || c === '/');

function runEnd(s: string, i: number, ch: string): number {
  let j = i;
  while (j < s.length && s[j] === ch) j++;
  return j;
}

/** The index just past the `]` that closes the `[` at each position, or -1; one pass with a stack, so `[[[[` is linear. */
function bracketMatches(s: string): Int32Array {
  const match = new Int32Array(s.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '[') stack.push(i);
    else if (c === ']' && stack.length > 0) match[stack.pop()!] = i;
  }
  return match;
}

function inline(s: string, depth: number): string {
  if (depth > MAX_DEPTH) return s;
  const brackets = s.includes('[') ? bracketMatches(s) : null;
  const failed = new Set<string>();
  // A run length's first closer that turned out to end a glob (`src/*`) or to be bound (`*b*c`): every opener before it meets
  // that closer first, so each is refused at once, which keeps the scan linear.
  const globClose = new Map<string, number>();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    // An escaped mark is no mark, and its backslash stays: old text reads as written (`ccrc-[0-9]+\\.log`).
    if (c === '\\' && i + 1 < s.length && isPunct(s[i + 1]!)) { out += s.slice(i, i + 2); i += 2; continue; }
    if (c === '`') {
      const end = runEnd(s, i, '`');
      const n = end - i;
      let j = end;
      let close = -1;
      while (j < s.length) {
        if (s[j] !== '`') { j++; continue; }
        const e = runEnd(s, j, '`');
        if (e - j === n) { close = j; break; }
        j = e;
      }
      if (close < 0) { out += s.slice(i, end); i = end; continue; }
      let body = s.slice(end, close);
      if (body.length > 2 && body.startsWith(' ') && body.endsWith(' ') && body.trim() !== '') body = body.slice(1, -1);
      out += body;
      i = close + n;
      continue;
    }
    if ((c === '[' || (c === '!' && s[i + 1] === '[')) && brackets !== null) {
      const open = c === '!' ? i + 1 : i;
      const m = brackets[open]!;
      if (m > open && s[m + 1] === '(') {
        let d = 1;
        let k = m + 2;
        const stop = Math.min(s.length, m + 2 + MAX_DEST);
        while (k < stop && d > 0) {
          if (s[k] === '\\') k++;
          else if (s[k] === '(') d++;
          else if (s[k] === ')') d--;
          k++;
        }
        if (d === 0) { out += inline(s.slice(open + 1, m), depth + 1); i = k; continue; }
      }
      out += c; i++; continue;
    }
    if (c === '<') {
      const stop = Math.min(s.length, i + MAX_DEST);
      let k = i + 1;
      while (k < stop && s[k] !== '>' && s[k] !== '<' && !/\s/.test(s[k]!)) k++;
      const inner = s.slice(i + 1, k);
      if (k < stop && s[k] === '>' && (URI_AUTOLINK.test(inner) || EMAIL_AUTOLINK.test(inner))) { out += inner; i = k + 1; continue; }
      out += c; i++; continue;
    }
    if (c === '*' || c === '~') {
      const end = runEnd(s, i, c);
      const n = end - i;
      const key = c + n;
      const ok = c === '*' ? n <= 3 : n === 2;
      const glob = s[end] === '.' || s[end] === '/' || (globClose.get(key) ?? -1) > i;
      if (ok && !glob && !failed.has(key) && !wordish(s[i - 1]) && !isSpace(s[end])) {
        let j = end;
        let close = -1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] !== c) { j++; continue; }
          const e = runEnd(s, j, c);
          if (e - j === n && !isSpace(s[j - 1])) { close = j; break; }
          j = e;
        }
        // The nearest closing run is the one the page's parser pairs, and the guard then refuses the pair when the closer ends
        // a glob (`src/*`) or is bound by what follows it (`*b*c`): the opener stays as written, and no later run closes it
        // (fix round 1 of wave 186, F7, the parity corpus).
        if (close >= 0 && (s[close - 1] === '/' || closeBound(s[close + n]))) globClose.set(key, close);
        else if (close >= 0) { out += inline(s.slice(end, close), depth + 1); i = close + n; continue; }
        else failed.add(key);
      }
      out += s.slice(i, end); i = end; continue;
    }
    out += c; i++;
  }
  return out;
}

/** The text's lines outside a fence, read block by block: a run of non-blank lines is one paragraph, scanned as one text when
 *  `joined` (so a mark may cross a soft line break, as on the page), else line by line; a fenced block keeps its inner lines
 *  (fence lines and info string go). */
function plainBlocks(text: string, joined: boolean): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  const kept: string[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length === 0) return;
    if (joined) kept.push(inline(para.join('\n'), 0));
    else for (const l of para) kept.push(inline(l, 0));
    para = [];
  };
  let fence: { ch: string; n: number } | null = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null) {
      if (m !== null && !(m[1]![0] === '`' && m[2]!.includes('`'))) { flush(); fence = { ch: m[1]![0]!, n: m[1]!.length }; continue; }
      if (line.trim() === '') { flush(); kept.push(''); continue; }
      para.push(line);
    } else if (m !== null && m[1]![0] === fence.ch && m[1]!.length >= fence.n && m[2]!.trim() === '') {
      fence = null;
    } else {
      kept.push(line);
    }
  }
  flush();
  return kept;
}

/** Markdown item text as one line of plain text. A fenced block keeps its inner text (fence lines and info string go). */
export function itemPlainText(text: string): string {
  return plainBlocks(text, true).join(' ').replace(/\s+/g, ' ').trim();
}

/** The same projection, line by line: each line of the text as plain words, the lines joined by a newline, blank lines and
 *  fence lines dropped. For a summary that keeps a text's lines (a Waiting row's why of an action item, fix round 1 F6). */
export function itemPlainLines(text: string): string {
  return plainBlocks(text, false).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '').join('\n');
}
