// The paste delivery recipe (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// L0: imports only `shared/` siblings (the PWA never imports this file, but the rule is the ring's). A second recipe on the
// one build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md): the box starts a real
// Claude Code build against the stand-in model, sends each fixed case below through the product's own send
// (`server/src/inject/send.ts#sendPrompt`, run by `server/src/inject/deliveryDrive.ts`), and the stand-in records every
// request the build makes. This file holds what is decided about that, and nothing that acts:
// - the cases, built from fixed rules (no case text travels on any wire: a case is named by its id);
// - the composer's documented normalisations, which make the text the console sends;
// - what counts as a turn the model received, and that turn's prompt, read from a Messages API request body;
// - each case's verdict and the recipe's word;
// - the result, and its ONE reader.
//
// IT NEVER TOUCHES BUILD TRUST. The build-trust verdict is `claudeBuildTrust.ts`'s and lives in `claude_builds`; nothing
// here reads or writes it, and a delivery result is never a `BuildCaptureResult`.
import { composePrompt } from './api.js';
import { isClaudeVersion } from './claudeVersion.js';

// ── the cases (paste-reliability.md section 3) ───────────────────────────────────────────────────────────────────

/** The case ids, in the order the recipe sends them: a short control first, then the earlier wave's synthetic cases. */
export type DeliveryCaseId = 'c0' | 'c1' | 'c1b' | 'c2a' | 'c2b' | 'c3' | 'c3b' | 'c3c' | 'c4' | 'c4b' | 'c5';
export const DELIVERY_CASE_ID_MAP: Record<DeliveryCaseId, true> = {
  c0: true, c1: true, c1b: true, c2a: true, c2b: true, c3: true, c3b: true, c3c: true, c4: true, c4b: true, c5: true,
};
export const DELIVERY_CASE_IDS: readonly DeliveryCaseId[] = Object.keys(DELIVERY_CASE_ID_MAP) as DeliveryCaseId[];

export const isDeliveryCaseId = (v: unknown): v is DeliveryCaseId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DELIVERY_CASE_ID_MAP, v);

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

/** One case's verdict. `intact`: one turn, equal. `refused`: the send refused and nothing reached the model (honest, not
 *  silent). The rest are faults: `duplicate` (two or more turns, each equal), `split` (two or more turns, not all equal),
 *  `altered` (one turn, unequal), `false-confirmation` (the send answered ok and no turn arrived), `partial` (the send
 *  refused, yet something reached the model). */
export type DeliveryCaseVerdict = 'intact' | 'refused' | 'duplicate' | 'split' | 'altered' | 'false-confirmation' | 'partial';
export const DELIVERY_CASE_VERDICT_MAP: Record<DeliveryCaseVerdict, true> = {
  intact: true, refused: true, duplicate: true, split: true, altered: true, 'false-confirmation': true, partial: true,
};
export const DELIVERY_CASE_VERDICTS: readonly DeliveryCaseVerdict[] = Object.keys(DELIVERY_CASE_VERDICT_MAP) as DeliveryCaseVerdict[];

/** The recipe's word: `fault` when any case is a fault, else `refused` when any case was refused, else `intact`. */
export type DeliveryWord = 'intact' | 'refused' | 'fault';
export const DELIVERY_WORD_MAP: Record<DeliveryWord, true> = { intact: true, refused: true, fault: true };

/** The send's answer as the driver reported it: `ok`, sendPrompt's refusal word, or a word of the driver's own when it
 *  could not run the send (kebab case, at most 40 characters). */
export const DELIVERY_SEND_WORD = /^[a-z][a-z-]{0,39}$/;

/** The witness of the build's own UserPromptSubmit hook: its `prompt` equal to the expected text, unequal, or no hook in
 *  the case's window. Reported beside the verdict, never an input to it. */
export type DeliveryHookWitness = 'equal' | 'unequal' | 'absent';
export const DELIVERY_HOOK_WITNESS_MAP: Record<DeliveryHookWitness, true> = { equal: true, unequal: true, absent: true };

/** How many code points of context each side of a divergence keeps. */
export const DELIVERY_CONTEXT = 40;

/** Where a received prompt first differs from the expected one, in code points, with the context each side. */
export interface DeliveryDivergence {
  /** Which turn of the case's window, 0-based. */
  readonly turn: number;
  readonly index: number;
  readonly expected: string;
  readonly received: string;
}

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

/** One case's result. */
export interface DeliveryCaseResult {
  readonly id: DeliveryCaseId;
  readonly verdict: DeliveryCaseVerdict;
  readonly send: string;
  /** The sent text's length in code points. */
  readonly sentChars: number;
  /** Each turn's prompt length in code points, in arrival order; its length is the turn count. */
  readonly receivedChars: readonly number[];
  readonly divergence: DeliveryDivergence | null;
  readonly sideRequests: number;
  readonly hook: DeliveryHookWitness;
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

/** One case's result from what the window held. The divergence is the first unequal turn's, or, with no turn at all,
 *  none. */
export function deliveryCaseResult(id: DeliveryCaseId, o: DeliveryObserved): DeliveryCaseResult {
  const expected = deliveryExpected(id);
  const unequal = o.turns.findIndex((t) => t !== expected);
  const hook: DeliveryHookWitness = o.hookPrompts.length === 0 ? 'absent' : o.hookPrompts.every((p) => p === expected) ? 'equal' : 'unequal';
  return {
    id, verdict: deliveryCaseVerdict(expected, o), send: o.send, sentChars: cps(deliveryCaseText(id)),
    receivedChars: o.turns.map(cps), divergence: unequal < 0 ? null : firstDivergence(expected, o.turns[unequal]!, unequal),
    sideRequests: o.sideRequests, hook,
  };
}

/** The recipe's word over its cases. */
export function deliveryWord(verdicts: readonly DeliveryCaseVerdict[]): DeliveryWord {
  if (verdicts.some((v) => v !== 'intact' && v !== 'refused')) return 'fault';
  return verdicts.includes('refused') ? 'refused' : 'intact';
}

// ── the result and its one reader ────────────────────────────────────────────────────────────────────────────────

/** A delivery capture's result. Never a `BuildCaptureResult`, never stored in `claude_builds`. */
export interface DeliveryCaptureResult {
  readonly recipe: 'delivery';
  readonly build: string;
  readonly word: DeliveryWord;
  readonly cases: readonly DeliveryCaseResult[];
}

/** The result from the cases the runner judged. */
export function deliveryCaptureResult(build: string, cases: readonly DeliveryCaseResult[]): DeliveryCaptureResult {
  return { recipe: 'delivery', build, word: deliveryWord(cases.map((c) => c.verdict)), cases };
}

const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const keysAre = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const shortText = (v: unknown): v is string => typeof v === 'string' && cps(v) <= 2 * DELIVERY_CONTEXT;

function readDivergence(v: unknown): DeliveryDivergence | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !keysAre(v, ['turn', 'index', 'expected', 'received'])) return undefined;
  if (!isCount(v['turn']) || !isCount(v['index']) || !shortText(v['expected']) || !shortText(v['received'])) return undefined;
  return { turn: v['turn'], index: v['index'], expected: v['expected'], received: v['received'] };
}

const CASE_KEYS = ['id', 'verdict', 'send', 'sentChars', 'receivedChars', 'divergence', 'sideRequests', 'hook'];

function readCase(v: unknown): DeliveryCaseResult | null {
  if (!isObj(v) || !keysAre(v, CASE_KEYS)) return null;
  const { id, verdict, send, sentChars, receivedChars, sideRequests, hook } = v;
  if (!isDeliveryCaseId(id) || !has(DELIVERY_CASE_VERDICT_MAP, verdict) || typeof send !== 'string' || !DELIVERY_SEND_WORD.test(send)) return null;
  if (!isCount(sentChars) || !isCount(sideRequests) || !has(DELIVERY_HOOK_WITNESS_MAP, hook)) return null;
  if (!Array.isArray(receivedChars) || !receivedChars.every(isCount)) return null;
  const divergence = readDivergence(v['divergence']);
  if (divergence === undefined) return null;
  // The verdict must be the rule's for the send word and the turn count it carries (equality aside, which the counts
  // cannot show): a verdict the rule could not give is not a result.
  const n = receivedChars.length;
  const possible: readonly DeliveryCaseVerdict[] = send !== 'ok' ? [n === 0 ? 'refused' : 'partial']
    : n === 0 ? ['false-confirmation'] : n === 1 ? ['intact', 'altered'] : ['duplicate', 'split'];
  if (!possible.includes(verdict)) return null;
  // No divergence where every turn was equal or none arrived; one where a turn must have differed; `partial` either way.
  if ((verdict === 'intact' || verdict === 'duplicate' || n === 0) && divergence !== null) return null;
  if ((verdict === 'altered' || verdict === 'split') && divergence === null) return null;
  if (divergence !== null && divergence.turn >= n) return null;
  return { id, verdict, send, sentChars, receivedChars: [...receivedChars], divergence, sideRequests, hook };
}

/** THE ONE READER of a delivery capture's result, for `build`: every case once, in `DELIVERY_CASE_IDS` order, each well
 *  formed, and the word the cases decide. `null`: not a delivery result for this build (another build, a field missing,
 *  mistyped or unnamed, a case missing, repeated or out of order, or a word the cases do not give). */
export function readDeliveryCaptureResult(v: unknown, build: string): DeliveryCaptureResult | null {
  if (!isObj(v) || !keysAre(v, ['recipe', 'build', 'word', 'cases'])) return null;
  if (v['recipe'] !== 'delivery' || v['build'] !== build || !isClaudeVersion(build) || !has(DELIVERY_WORD_MAP, v['word'])) return null;
  if (!Array.isArray(v['cases']) || v['cases'].length !== DELIVERY_CASE_IDS.length) return null;
  const cases: DeliveryCaseResult[] = [];
  for (const [i, raw] of (v['cases'] as unknown[]).entries()) {
    const c = readCase(raw);
    if (c === null || c.id !== DELIVERY_CASE_IDS[i]) return null;
    cases.push(c);
  }
  if (deliveryWord(cases.map((c) => c.verdict)) !== v['word']) return null;
  return { recipe: 'delivery', build, word: v['word'], cases };
}
