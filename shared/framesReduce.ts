// The box frames recipe's REDUCER and the receiver's CHECK (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.2; the capture owner's calls 1549 and 1558, and its yes
// to packet 2 with its corrected rule 2). L0, pure: imports only `shared/` siblings, and no `node:*` module. The private-name
// matcher (`shared/private-names.mjs#hitsIn`, which needs `node:crypto`) is INJECTED by each caller as `scan`: the runner
// on the test box, and the lane and the read on the server.
//
// - `reduceFrame` runs ON THE TEST BOX, on the frame the driver read, before anything leaves the capture. The raw frame
//   then goes out of scope and is never written or sent.
// - `checkReducedFrame` is its own check, run by the server before the lane stores a frame and again before the read
//   serves one: every refusing rule, and `reduceFrame` with no box-side list must leave the text as it is. One function,
//   the reducer's, never a copy (the owner's condition 1).
//
// A frame the reducer cannot clear is REFUSED WHOLE with its rule word. Nothing is ever cut out to make one pass.
import { CREDENTIAL_MASKS } from './api.js';
import { frameTextFits, type FramesPane, type FramesRefusal } from './framesResult.js';

/** An SGR sequence (a frame's only escape, by the shape rule). */
const SGR = /\x1b\[[0-9;:]*m/g;
const stripSgr = (s: string): string => s.replace(SGR, '');
/** Whitespace erased, as `server/src/inject/send.ts`'s `squash` reads a box row: wrapping moves only spaces. */
const squash = (s: string): string => s.replace(/\s+/g, '');

/** THE DECORATION LIST (the owner's corrected rule 2): the characters a row may carry around our text at its two ends and
 *  still be ours. The box's and a card's border characters, the prompt glyph (and its older `>`), the turn markers and
 *  spaces. A closed list, no pattern: a character not on it is foreign. */
export const FRAMES_DECORATION: readonly string[] = Object.freeze([
  '│', '╭', '╮', '╰', '╯', '❯', '>', '⏺', '●', '⎿', ' ', ' ',
]);
const DECOR = new Set(FRAMES_DECORATION);

/** A row's three spans by code point: the decoration it starts with, its content, the decoration it ends with. */
function spans(row: string): { readonly lead: string; readonly content: string; readonly tail: string } {
  const cps = Array.from(row);
  let a = 0;
  while (a < cps.length && DECOR.has(cps[a]!)) a++;
  let b = cps.length;
  while (b > a && DECOR.has(cps[b - 1]!)) b--;
  return { lead: cps.slice(0, a).join(''), content: cps.slice(a, b).join(''), tail: cps.slice(b).join('') };
}

/** RULE 2: a row is ours when, SGR removed and the decoration stripped from its two ends, what is left is not empty and,
 *  squashed, is a run of one of `ours` (squashed). One foreign character anywhere and it is not. A wrapped turn's
 *  fragment is a run of our text, so it is ours. */
export function rowIsOurs(plainRow: string, oursSquashed: readonly string[]): boolean {
  const left = squash(spans(plainRow).content);
  return left !== '' && oursSquashed.some((o) => o.includes(left));
}

/** A rule row: a run of 10 or more `─`. Its label is kept byte for byte (rule 7). */
const RULE_RUN = /─{10,}/;
export const isRuleRow = (plainRow: string): boolean => RULE_RUN.test(plainRow);

/** RULE 4: a path-like run, whole or cut short (the owner's condition 2). It is two or more components around `/`, a
 *  leading `/` before two components, or an ellipsis or a home mark followed by `/`. */
export const PATH_LIKE = /(?:[\w.-]+\/){2,}|(?:\/[\w.-]+){2,}|(?:…|\.\.\.|~)\//;

/** RULE 5: a model's name, as a word, case-insensitive (the stand-in's own model name included). */
export const MODEL_WORD = /\b(?:opus|sonnet|haiku|fable|claude-[a-z0-9.-]+|ccrc-capture-stand-in)\b/i;

/** RULE 6: an account or a plan. */
export const ACCOUNT_WORD = /api usage billing|\bclaude (?:pro|max|team|enterprise)\b|\borganization\b|\baccount\b|\bplan\b|@[a-z0-9-]+\.[a-z]/i;

/** The fixed texts a replaced row's content becomes. */
export const FRAMES_REPLACED = Object.freeze({ cwd: '‹working directory›', model: '‹model›', account: '‹account›' });

/** A row with its content replaced by `token`, padded with spaces or cut to the content's width, its two decoration spans
 *  kept, its SGR gone with its content: every row keeps its width. */
function replaced(plainRow: string, token: string): string {
  const s = spans(plainRow);
  const w = Array.from(s.content).length;
  const t = Array.from(token).slice(0, w).join('');
  return s.lead + t + ' '.repeat(w - Array.from(t).length) + s.tail;
}

/** RULE 9's private shapes, on rows not ours, after reduction: an absolute path under a home or a mount, a home-relative
 *  path, an email, an IPv4 address other than loopback, a dotted host name with a public suffix, and a run of 32 or more
 *  hex characters (an id or a token). */
export const PRIVATE_SHAPES: readonly RegExp[] = Object.freeze([
  /\/(?:home|Users|root|mnt)(?:\/|\b)/, /~\//, /[\w.+-]+@[\w-]+\.[\w.-]+/,
  /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|ai|app|cloud|ts\.net|duckdns\.org)\b/i,
  /[0-9a-f]{32,}/i,
]);

/** RULE 9's masker shapes on the test box: the product masker's credential shapes, from their one home. */
const CREDENTIAL_RES: readonly RegExp[] = CREDENTIAL_MASKS.map((m) => new RegExp(m.source));
/** Whether the product masker's shapes would change `text`. */
export const credentialShaped = (text: string): boolean => CREDENTIAL_RES.some((r) => r.test(text));

/** The committed private-name matcher, as each caller composes it: `true` when it hits anything in `text`. */
export type FramesScan = (text: string) => boolean;

/** What `reduceFrame` decided, with how many rows each rule replaced (the owner's wave-done ask). */
export type ReduceAnswer =
  | { readonly kind: 'reduced'; readonly text: string; readonly replaced: { readonly cwd: number; readonly path: number; readonly model: number; readonly account: number } }
  | { readonly kind: 'refused'; readonly refusal: FramesRefusal };

/** THE REDUCER, rules 1 to 9 (plan 5.2). `ours`: the case's fixed texts (`framesCapture.ts#framesOurs`). `privates`: the
 *  exact strings this capture knows (none on the server). `scan`: the committed matcher. `mask`: whether the product's
 *  masker would change a text: its shapes on the box (the default), the live masker on the server. */
export function reduceFrame(
  frame: string, pane: FramesPane, ours: readonly string[], privates: readonly string[], scan: FramesScan, mask: (t: string) => boolean = credentialShaped,
): ReduceAnswer {
  // Rule 1: the shape gate.
  if (!frameTextFits(frame, pane)) return { kind: 'refused', refusal: 'not-a-frame' };
  const oursSq = ours.map(squash).filter((o) => o !== '');
  const priv = privates.filter((p) => p !== '');
  const count = { cwd: 0, path: 0, model: 0, account: 0 };
  const scanned: string[] = [];
  let ruleLeak = false;
  const rows = frame.split('\n').map((row) => {
    const plain = stripSgr(row);
    const hasPrivate = priv.some((p) => plain.includes(p));
    if (isRuleRow(plain)) {
      // Rule 7: a rule row's label is kept byte for byte, unless it holds a private string. A label rules 4 to 6 would
      // catch is never kept and never rewritten: the frame is refused (below), so a cut-short path, a model or a plan
      // cannot ride a rule row out of the box (the security review of F3).
      if (hasPrivate) { count.cwd++; return replaced(plain, FRAMES_REPLACED.cwd); }
      if (PATH_LIKE.test(plain) || MODEL_WORD.test(plain) || ACCOUNT_WORD.test(plain)) ruleLeak = true;
      scanned.push(plain);
      return row;
    }
    // Rule 2: our rows stay byte for byte.
    if (rowIsOurs(plain, oursSq)) return row;
    let out: string | null = null;
    if (hasPrivate) { count.cwd++; out = replaced(plain, FRAMES_REPLACED.cwd); } // rule 3
    else if (PATH_LIKE.test(plain)) { count.path++; out = replaced(plain, FRAMES_REPLACED.cwd); } // rule 4
    else if (MODEL_WORD.test(plain)) { count.model++; out = replaced(plain, FRAMES_REPLACED.model); } // rule 5
    else if (ACCOUNT_WORD.test(plain)) { count.account++; out = replaced(plain, FRAMES_REPLACED.account); } // rule 6
    // Rule 8: the capture configures no status line, so a row below the box is read by rules 3 to 6 like any other.
    scanned.push(out ?? plain);
    return out ?? row;
  });
  const text = rows.join('\n');
  // Rule 9: the scans over every row not ours, then the masker's over the whole frame. A hit refuses it whole.
  const foreign = scanned.join('\n');
  if (scan(foreign)) return { kind: 'refused', refusal: 'private-name' };
  if (ruleLeak || PRIVATE_SHAPES.some((r) => r.test(foreign)) || priv.some((p) => foreign.includes(p))) return { kind: 'refused', refusal: 'private-shape' };
  // The masker over the whole frame as drawn AND with its SGR removed, so a colour change inside a key cannot split it
  // past the shapes (the security review of F3).
  if (mask(text) || mask(stripSgr(text))) return { kind: 'refused', refusal: 'masked' };
  return { kind: 'reduced', text, replaced: count };
}

/** THE RECEIVER'S CHECK (the owner's condition 1): the reducer's own rules on a text that is already reduced, with no
 *  box-side list. Clear only when the reducer refuses nothing and leaves the text as it is; a text a rule would still
 *  replace is a private shape left in it. */
export function checkReducedFrame(
  text: string, pane: FramesPane, ours: readonly string[], scan: FramesScan, mask: (t: string) => boolean = credentialShaped,
): { readonly ok: true } | { readonly ok: false; readonly refusal: FramesRefusal } {
  const r = reduceFrame(text, pane, ours, [], scan, mask);
  if (r.kind === 'refused') return { ok: false, refusal: r.refusal };
  return r.text === text ? { ok: true } : { ok: false, refusal: 'private-shape' };
}

/** What the reducer answers on a fixed probe table, folded into the recipe's version (`framesCapture.ts`), so a change in
 *  what the reducer does changes the version and a change in how it is spelled does not. */
export function reducerFingerprint(): string {
  const pane = { cols: 40, rows: 6 };
  const none: FramesScan = () => false;
  const probes = [
    '❯ ours text here', '│ /work/a/b and more │', 'see …/x/y here', 'Haiku 9 · Claude Max', 'Claude Pro account', '──────────── ↑ 9 more ──',
    'mail a@b.example.com', 'host 10.1.2.3', 'tok ' + 'a'.repeat(32), 'sk-ant-api03-abcdefghij', 'plain row', '\x1b]8;;x\x1b\\',
  ];
  return JSON.stringify(probes.map((p) => reduceFrame(p + '\n', pane, ['ours text here'], ['/secret/x'], none)));
}
