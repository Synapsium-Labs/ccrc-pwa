// The paste delivery recipe's RESULT (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// L0: imports only `shared/` siblings. Split from the cases (`deliveryCapture.ts`) so that what travels — the result, its
// vocabulary and its ONE reader — is all the capture contract (`claudeBuildCapture.ts`, `testbox.ts`, `agent-protocol.ts`)
// pulls into any module graph, the front end's included: the case texts and their generators stay out of it.
//
// IT NEVER TOUCHES BUILD TRUST: a delivery result is never a `BuildCaptureResult` and decides nothing.
import { isClaudeVersion } from './claudeVersion.js';

/** The case ids, in the order the recipe sends them: a short control first, then the earlier wave's synthetic cases. */
export type DeliveryCaseId = 'c0' | 'c1' | 'c1b' | 'c2a' | 'c2b' | 'c3' | 'c3b' | 'c3c' | 'c4' | 'c4b' | 'c5';
export const DELIVERY_CASE_ID_MAP: Record<DeliveryCaseId, true> = {
  c0: true, c1: true, c1b: true, c2a: true, c2b: true, c3: true, c3b: true, c3c: true, c4: true, c4b: true, c5: true,
};
export const DELIVERY_CASE_IDS: readonly DeliveryCaseId[] = Object.keys(DELIVERY_CASE_ID_MAP) as DeliveryCaseId[];

export const isDeliveryCaseId = (v: unknown): v is DeliveryCaseId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DELIVERY_CASE_ID_MAP, v);

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

/** The recipe version's shape: 16 lowercase hex characters (`deliveryCapture.ts#DELIVERY_RECIPE_VERSION`, computed). */
export const DELIVERY_VERSION_SHAPE = /^[0-9a-f]{16}$/;

/** Where a received prompt first differs from the expected one, in code points, with the context each side. */
export interface DeliveryDivergence {
  /** Which turn of the case's window, 0-based. */
  readonly turn: number;
  readonly index: number;
  readonly expected: string;
  readonly received: string;
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

/** A delivery capture's result: the recipe it echoes, the recipe's version (so the lane can tell a result of an older
 *  recipe), the build, the word and every case. Never a `BuildCaptureResult`, never a trust input. */
export interface DeliveryCaptureResult {
  readonly recipe: 'delivery';
  readonly version: string;
  readonly build: string;
  readonly word: DeliveryWord;
  readonly cases: readonly DeliveryCaseResult[];
}

/** The recipe's word over its cases. */
export function deliveryWord(verdicts: readonly DeliveryCaseVerdict[]): DeliveryWord {
  if (verdicts.some((v) => v !== 'intact' && v !== 'refused')) return 'fault';
  return verdicts.includes('refused') ? 'refused' : 'intact';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const keysAre = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const cps = (s: string): number => Array.from(s).length;
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

/** THE ONE READER of a delivery capture's result, for `build`: the recipe echoed, a version of its shape, every case once in
 *  `DELIVERY_CASE_IDS` order, each well formed, and the word the cases decide. `null`: not a delivery result for this
 *  build (another build or recipe, a field missing, mistyped or unnamed, a case missing, repeated or out of order, or a
 *  word the cases do not give). */
export function readDeliveryCaptureResult(v: unknown, build: string): DeliveryCaptureResult | null {
  if (!isObj(v) || !keysAre(v, ['recipe', 'version', 'build', 'word', 'cases'])) return null;
  if (v['recipe'] !== 'delivery' || v['build'] !== build || !isClaudeVersion(build) || !has(DELIVERY_WORD_MAP, v['word'])) return null;
  if (typeof v['version'] !== 'string' || !DELIVERY_VERSION_SHAPE.test(v['version'])) return null;
  if (!Array.isArray(v['cases']) || v['cases'].length !== DELIVERY_CASE_IDS.length) return null;
  const cases: DeliveryCaseResult[] = [];
  for (const [i, raw] of (v['cases'] as unknown[]).entries()) {
    const c = readCase(raw);
    if (c === null || c.id !== DELIVERY_CASE_IDS[i]) return null;
    cases.push(c);
  }
  if (deliveryWord(cases.map((c) => c.verdict)) !== v['word']) return null;
  return { recipe: 'delivery', version: v['version'], build, word: v['word'], cases };
}
