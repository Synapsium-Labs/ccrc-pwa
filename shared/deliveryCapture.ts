// The paste delivery recipe (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// L0: imports only `shared/` siblings (the PWA never imports this file, but the rule is the ring's). A second recipe on the
// one build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md): the box starts a real
// Claude Code build against the stand-in model, sends each fixed case below through the product's own send
// (`server/src/inject/send.ts#sendPrompt`, run by `server/src/inject/deliveryDrive.ts`), and the stand-in records every
// request the build makes. This file holds what is decided about that, and nothing that acts:
// - the cases, built from fixed rules (no case text travels on any wire: a case is named by its id);
// - the composer's documented normalisations, which make the text the console sends;
// - what counts as a turn the model received, and that turn's prompt, read from a Messages API request body;
// - each case's verdict, and the recipe's version (computed from the cases and the rule, never kept by hand).
// The result, its vocabulary and its ONE reader are `deliveryResult.ts`'s, so the case texts travel in no module graph
// the capture contract is part of.
//
// IT NEVER TOUCHES BUILD TRUST. The build-trust verdict is `claudeBuildTrust.ts`'s and lives in `claude_builds`; nothing
// here reads or writes it, and a delivery result is never a `BuildCaptureResult`.
import { composePrompt } from './api.js';
import {
  DELIVERY_CASE_IDS, DELIVERY_CONTEXT, DELIVERY_COUNT_MAX, DELIVERY_TURNS_MAX, deliveryParts, deliveryWord,
  type DeliveryCaptureResult, type DeliveryCaseId, type DeliveryCaseResult, type DeliveryCaseVerdict, type DeliveryDivergence, type DeliveryHookWitness,
} from './deliveryResult.js';

// ── the cases (paste-reliability.md section 3) ───────────────────────────────────────────────────────────────────

/** A long ASCII run: 100-character blocks, each `<id@NNNNN>` (the block's start offset, five digits) padded with
 *  `abcdefghij` repeats, cut to `n` characters. */
export function asciiRun(id: string, n: number): string {
  let out = '';
  for (let at = 0; out.length < n; at += 100) {
    const head = `<${id}@${String(at).padStart(5, '0')}>`;
    out += (head + 'abcdefghij'.repeat(10)).slice(0, 100);
  }
  return out.slice(0, n);
}

const UNICODE_PAD = ['Ж', '漢', '\u{1F642}', 'é', 'ש'] as const;

/** The Unicode run: 50-code-point groups, each `<c4b#NNNN>` (the group index) padded by cycling `Ж`, `漢`, `🙂`, `é`, `ש`
 *  from the group index modulo 5, cut to `n` code points. */
export function unicodeRun(id: string, n: number): string {
  const out: string[] = [];
  for (let g = 0; out.length < n; g++) {
    const group = Array.from(`<${id}#${String(g).padStart(4, '0')}>`);
    for (let k = 0; group.length < 50; k++) group.push(UNICODE_PAD[(g + k) % 5]!);
    out.push(...group);
  }
  return out.slice(0, n).join('');
}

const c3cLines = (): string => {
  const lines: string[] = [];
  for (let n = 1; n <= 45; n++) lines.push(n % 5 === 0 ? '' : `c3c line ${String(n).padStart(2, '0')} of 45`);
  return lines.join('\n');
};

/** Each case's raw text: what the operator put in the console's field, before the composer's normalisations. For `c2a`
 *  that is the typed prefix followed by the pasted run, one string by the time it leaves the browser. */
export const DELIVERY_CASE_RAW: Readonly<Record<DeliveryCaseId, () => string>> = Object.freeze({
  c0: () => 'paste probe control c0 ZQX-END-c0',
  c1: () => `${asciiRun('c1', 6000)} ZQX-END-c1`,
  c1b: () => `${asciiRun('c1b', 3000)}\nline two of c1b\nline three ZQX-END-c1b`,
  c2a: () => `Prefix typed before the paste: ${asciiRun('c2a', 5000)} ZQX-END-c2a`,
  c2b: () => `short prefix line c2b\n${asciiRun('c2b', 5000)}\ntail line ZQX-END-c2b`,
  c3: () => '    def first_line_indented():\n        return 1\n\n\tTabbed line\twith inner\ttabs\nline with trailing spaces   \n\n\n'
    + '  - bullet after two blank lines\n      deeper indent  inner  double  spaces\n   \nZQX-END-c3',
  c3b: () => '\n\n  leading blank lines then indent c3b\n\nmiddle\n\nZQX-END-c3b\n\n',
  c3c: () => `${c3cLines()}\nZQX-END-c3c`,
  c4: () => 'Ünïcödé c4 — Кириллица 漢字かな 한국어 עברית العربية \u{1F642} \u{1F469}‍\u{1F4BB} \u{1F3F3}️‍\u{1F308} é NBSP here ZQX-END-c4',
  c4b: () => `${unicodeRun('c4b', 4000)} ZQX-END-c4b`,
  c5: () => 'crlf line one c5\r\ncrlf line two\r\n\r\ncrlf line four ZQX-END-c5',
});

/** The composer's documented normalisations, in their order: the field's line breaks read as LF (a textarea normalises CR
 *  and CRLF; measured for c5 in the browser wave), then `value.trim()` (pwa/src/session/Composer.tsx's send). The result
 *  is the `text` the console posts to `POST /api/sessions/:id/prompt`. */
export const composerOutput = (raw: string): string => raw.replace(/\r\n?/g, '\n').trim();

/** The text the console sends for one case. */
export const deliveryCaseText = (id: DeliveryCaseId): string => composerOutput(DELIVERY_CASE_RAW[id]());

/** What the model should receive for one case: the sent text through the send path's own compose step
 *  (`composePrompt`, which strips leading blank lines; no attachments on this path). */
export const deliveryExpected = (id: DeliveryCaseId): string => composePrompt(deliveryCaseText(id), []);

/** The first characters Claude Code's input box reads as a mode switch (a slash command, a shell line, a memory note, a
 *  file mention). The send path neutralises none of them (wave 178's reading), so no case may start with one: a case is
 *  never allowed to become a shell line in the capture's pane. */
export const DELIVERY_MODE_CHARS: readonly string[] = Object.freeze(['/', '!', '#', '@']);

// ── what the model received ──────────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function blocksOf(m: unknown): Obj[] {
  if (!isObj(m)) return [];
  const c = m['content'];
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c.filter(isObj) : [];
}

const REMINDER = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** A turn the model was asked for, read from one Messages API request body: the request offers tools (a side request, a
 *  title or a summary, offers none), and its last message is the user's, carrying text and no tool result. Its prompt is
 *  that message's text blocks, less every block that is wholly a system reminder, and `blocks` counts what is left (more
 *  than one is reported as it is, joined by a line break). `null`: the request is not a turn. */
export function turnOf(body: unknown): { readonly prompt: string; readonly blocks: number } | null {
  if (!isObj(body) || !Array.isArray(body['messages']) || !Array.isArray(body['tools']) || body['tools'].length === 0) return null;
  const messages = body['messages'] as unknown[];
  const last = messages[messages.length - 1];
  if (!isObj(last) || last['role'] !== 'user') return null;
  const bs = blocksOf(last);
  if (bs.some((b) => b['type'] === 'tool_result')) return null;
  const texts = bs.filter((b) => b['type'] === 'text' && typeof b['text'] === 'string').map((b) => b['text'] as string);
  const kept = texts.filter((t) => !REMINDER.test(t));
  if (kept.length === 0) return null;
  return { prompt: kept.join('\n'), blocks: kept.length };
}

// ── the verdict ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The first divergence of `received` from `expected`, or null when they are equal. Indexes are code points. */
export function firstDivergence(expected: string, received: string, turn = 0): DeliveryDivergence | null {
  if (expected === received) return null;
  const a = Array.from(expected);
  const b = Array.from(received);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - DELIVERY_CONTEXT);
  return { turn, index: i, expected: a.slice(from, i + DELIVERY_CONTEXT).join(''), received: b.slice(from, i + DELIVERY_CONTEXT).join('') };
}

/** What the runner observed in one case's window. */
export interface DeliveryObserved {
  /** The driver's word for the send (`ok`, or a refusal). */
  readonly send: string;
  /** Every turn's prompt in the window, in arrival order. */
  readonly turns: readonly string[];
  /** The requests in the window that were not turns. */
  readonly sideRequests: number;
  /** The UserPromptSubmit hooks' prompts in the window, in order. */
  readonly hookPrompts: readonly string[];
}

const cps = (s: string): number => Array.from(s).length;

/** THE verdict rule for one case, from what the window held. */
export function deliveryCaseVerdict(expected: string, o: Pick<DeliveryObserved, 'send' | 'turns'>): DeliveryCaseVerdict {
  const n = o.turns.length;
  if (o.send !== 'ok') return n === 0 ? 'refused' : 'partial';
  if (n === 0) return 'false-confirmation';
  if (n === 1) return o.turns[0] === expected ? 'intact' : 'altered';
  return o.turns.every((t) => t === expected) ? 'duplicate' : 'split';
}

/** A count as the result carries it: at most the reader's ceiling, so the producer never writes what the reader refuses
 *  (the capture owner's call 1159). */
const capped = (n: number): number => Math.min(n, DELIVERY_COUNT_MAX);

/** One case's result from what the window held. The divergence is the first unequal turn's, or, with no turn at all,
 *  none. Only the first `DELIVERY_TURNS_MAX` turns are judged and reported (the reader's bound): a seventeenth unequal turn
 *  then reads `duplicate` where the whole window would read `split`. Both are faults and the word is the same. Every count
 *  is capped at the reader's ceiling, so a build that sends a turn longer than the ceiling still reads as its fault
 *  verdict, never as an answer the reader refuses (which would hide the build's defect as the box's). The sent length and a
 *  divergence's index need no cap: the first is a case's own text, and the second is at most the expected text's length,
 *  and every case keeps both under the ceiling (pinned). */
export function deliveryCaseResult(id: DeliveryCaseId, observed: DeliveryObserved): DeliveryCaseResult {
  const o: DeliveryObserved = { ...observed, turns: observed.turns.slice(0, DELIVERY_TURNS_MAX) };
  const expected = deliveryExpected(id);
  const unequal = o.turns.findIndex((t) => t !== expected);
  const hook: DeliveryHookWitness = o.hookPrompts.length === 0 ? 'absent' : o.hookPrompts.every((p) => p === expected) ? 'equal' : 'unequal';
  return {
    id, verdict: deliveryCaseVerdict(expected, o), send: o.send, sentChars: cps(deliveryCaseText(id)),
    receivedChars: o.turns.map((t) => capped(cps(t))), divergence: unequal < 0 ? null : firstDivergence(expected, o.turns[unequal]!, unequal),
    sideRequests: capped(o.sideRequests), hook,
  };
}

// ── the recipe's version ─────────────────────────────────────────────────────────────────────────────────────────

/** FNV-1a over a string's UTF-16 code units, from `seed`: 32 bits. Pure and the same on every engine. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** What the rule answers on a fixed probe table: the verdict rule over each send word and turn shape, the divergence over
 *  each pair, the turn reader over each request shape, and the composer over each edge. A change in what the rule does on
 *  any probe changes this text, and with it the version; a change in how its source is spelled does not. */
function ruleFingerprint(): string {
  const E = 'abc\ndef';
  const sends = ['ok', 'verify-failed'];
  const turnSets: readonly (readonly string[])[] = [[], [E], ['abc'], [E, E], ['abc', 'def'], ['def\nabc']];
  const verdicts = sends.flatMap((s) => turnSets.map((t) => deliveryCaseVerdict(E, { send: s, turns: t })));
  const divergences = [['abc', 'abc'], ['abc', 'abd'], ['abc', 'ab'], ['', 'x'], ['x'.repeat(100), 'x'.repeat(99) + 'y']].map(([a, b]) => firstDivergence(a!, b!));
  const bodies: unknown[] = [
    { tools: [{ name: 'B' }], messages: [{ role: 'user', content: 'p' }] },
    { messages: [{ role: 'user', content: 'p' }] },
    { tools: [{ name: 'B' }], messages: [{ role: 'user', content: [{ type: 'text', text: '<system-reminder>r</system-reminder>' }, { type: 'text', text: 'p' }] }] },
    { tools: [{ name: 'B' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }] },
    { tools: [{ name: 'B' }], messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'x' }] }] },
    { tools: [{ name: 'B' }], messages: [{ role: 'user', content: 'p' }, { role: 'assistant', content: 'q' }] },
  ];
  const composed = [' \r\n a\r\nb \n', '\n\n  x', 'y\r'].map((t) => [composerOutput(t), composePrompt(composerOutput(t), [])]);
  return JSON.stringify({ verdicts, divergences, turns: bodies.map(turnOf), composed, context: DELIVERY_CONTEXT });
}

/** The recipe's version: 16 hex characters computed from every case's sent and expected text, in order, the split into
 *  parts (so a row of one partition never joins a row of another), and the rule's fingerprint. The lane measures a build again when no delivery result exists for it at this version. */
export function deliveryRecipeVersionOf(parts: readonly (readonly DeliveryCaseId[])[] = deliveryParts()): string {
  const text = JSON.stringify({ cases: DELIVERY_CASE_IDS.map((id) => [id, deliveryCaseText(id), deliveryExpected(id)]), parts, rule: ruleFingerprint() });
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  return hex(fnv1a(text, 0x811c9dc5)) + hex(fnv1a(text, 0x9e3779b9));
}
export const DELIVERY_RECIPE_VERSION: string = deliveryRecipeVersionOf();

/** The result of one part from the cases the runner judged, at this recipe's version. */
export function deliveryCaptureResult(build: string, part: number, cases: readonly DeliveryCaseResult[]): DeliveryCaptureResult {
  return { recipe: 'delivery', version: DELIVERY_RECIPE_VERSION, build, part, word: deliveryWord(cases.map((c) => c.verdict)), cases };
}

/** How a read result stands against THIS side's recipe (the capture owner's call 1159). `current`: its version is this
 *  recipe's and its cases are exactly this recipe's cases for its part, in order; the lane stores only these. `another-recipe`:
 *  its version is not this side's, which is ordinary skew between a server and a box on different releases; the lane stores
 *  no row and asks again at its hour, never as intact and never as a fault of the build. `contradiction`: the version IS
 *  this side's and the cases are not this part's, which cannot happen without a defect, since the version covers the
 *  split; the lane stores no row and writes one log line. */
export type DeliveryCurrency = 'current' | 'another-recipe' | 'contradiction';
export const DELIVERY_CURRENCY_MAP: Record<DeliveryCurrency, true> = { current: true, 'another-recipe': true, contradiction: true };

export function deliveryResultCurrency(r: DeliveryCaptureResult): DeliveryCurrency {
  if (r.version !== DELIVERY_RECIPE_VERSION) return 'another-recipe';
  const want = deliveryParts()[r.part];
  return want !== undefined && r.cases.length === want.length && r.cases.every((c, i) => c.id === want[i]) ? 'current' : 'contradiction';
}
