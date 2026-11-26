// The paste delivery recipe's RESULT (Desktop polish wave 178; task note docs/superpowers/programs/desktop-polish/paste-delivery.md).
// L0: imports only `shared/` siblings. Split from the cases (`deliveryCapture.ts`) so that what travels — the result, its
// vocabulary and its ONE reader — is all the capture contract (`claudeBuildCapture.ts`, `testbox.ts`, `agent-protocol.ts`)
// pulls into any module graph, the front end's included: the case texts and their generators stay out of it.
//
// IT NEVER TOUCHES BUILD TRUST: a delivery result is never a `BuildCaptureResult` and decides nothing.
import { isReleaseTag } from './api.js';
import { isClaudeVersion } from './claudeVersion.js';
import { BUILD_CAPTURE_NOT_SENT_MAP, type BuildCaptureNotSent } from './claudeBuildTrust.js';

/** The case ids, in the order the recipe sends them: a short control first, then the earlier wave's synthetic cases. */
export type DeliveryCaseId = 'c0' | 'c1' | 'c1b' | 'c2a' | 'c2b' | 'c3' | 'c3b' | 'c3c' | 'c4' | 'c4b' | 'c5';
export const DELIVERY_CASE_ID_MAP: Record<DeliveryCaseId, true> = {
  c0: true, c1: true, c1b: true, c2a: true, c2b: true, c3: true, c3b: true, c3c: true, c4: true, c4b: true, c5: true,
};
export const DELIVERY_CASE_IDS: readonly DeliveryCaseId[] = Object.keys(DELIVERY_CASE_ID_MAP) as DeliveryCaseId[];

export const isDeliveryCaseId = (v: unknown): v is DeliveryCaseId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DELIVERY_CASE_ID_MAP, v);

/** How many parts the cases run in, each part a capture of its own (the capture owner's call 1148). DERIVED, not chosen:
 *  `agent/src/testbox/captureDelivery.ts#deliveryPartCount` computes the smallest count whose largest part fits the pair
 *  bound in every pairing, from the one timing object and this file's case list, and an agent test holds this
 *  value equal to it, so a change to a timing or to the case list turns that test red until this value follows. It lives
 *  here because the server's lane needs it and cannot read the agent's timing object. */
export const DELIVERY_PART_COUNT = 3;

/** The cases split evenly over `count` parts in their order: sizes differ by at most one, the larger parts first (4, 4, 3
 *  today). */
export function deliveryParts(count: number = DELIVERY_PART_COUNT, ids: readonly DeliveryCaseId[] = DELIVERY_CASE_IDS): readonly (readonly DeliveryCaseId[])[] {
  const parts: DeliveryCaseId[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const n = Math.floor(ids.length / count) + (i < ids.length % count ? 1 : 0);
    parts.push(ids.slice(at, at + n));
    at += n;
  }
  return parts;
}

/** A part index this side's recipe has: an integer from 0 to `DELIVERY_PART_COUNT - 1`. */
export const isDeliveryPart = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < DELIVERY_PART_COUNT;

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

/** The reader's bounds (the capture owner's call 1145): the turns one case's window may report, and every count's ceiling
 *  (a length in code points or a request count). */
export const DELIVERY_TURNS_MAX = 16;
export const DELIVERY_COUNT_MAX = 1_000_000;

/** The stand-in's routes (`agent/src/testbox/captureStub.ts`), as each recorded request is tagged with the one it came by
 *  (review 3882 F4): the Messages API, and its token count. A `count_tokens` request is a side request, never a turn. */
export type DeliveryRoute = 'messages' | 'count_tokens';
export const DELIVERY_ROUTE_MAP: Record<DeliveryRoute, true> = { messages: true, count_tokens: true };
export const DELIVERY_ROUTES: readonly DeliveryRoute[] = Object.keys(DELIVERY_ROUTE_MAP) as DeliveryRoute[];
export const isDeliveryRoute = (v: unknown): v is DeliveryRoute => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DELIVERY_ROUTE_MAP, v);

/** One case's side requests (every request in its window that was not a turn), counted by the route it came by, so the
 *  first real run shows what a real build asks beside a turn (review 3882 F4). */
export type DeliverySideRequests = Readonly<Record<DeliveryRoute, number>>;

/** What a part's result could not measure as the product has it, by name (review 3882 A3). `fleet-tmux-config`: the release
 *  tree held no fleet tmux configuration (`ccd/tmux.conf`), so the pane started without it and is not the product's pane. */
export type DeliveryUnmeasured = 'fleet-tmux-config';
export const DELIVERY_UNMEASURED_MAP: Record<DeliveryUnmeasured, true> = { 'fleet-tmux-config': true };
export const DELIVERY_UNMEASURED: readonly DeliveryUnmeasured[] = Object.keys(DELIVERY_UNMEASURED_MAP) as DeliveryUnmeasured[];

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
  readonly sideRequests: DeliverySideRequests;
  readonly hook: DeliveryHookWitness;
}

/** A delivery capture's result: the recipe it echoes, the recipe's version (so the lane can tell a result of an older
 *  recipe), the build, the part it ran, the word and every case of that part, the release of the box that ran it, and what
 *  it could not measure. Never a `BuildCaptureResult`, never a trust
 *  input. The case ids are the box's own copy of the part, so a box on another recipe can be told apart (the lane stores
 *  a row as current only when the version and the ids are its own recipe's for that part). */
export interface DeliveryCaptureResult {
  readonly recipe: 'delivery';
  readonly version: string;
  readonly build: string;
  readonly part: number;
  readonly word: DeliveryWord;
  readonly cases: readonly DeliveryCaseResult[];
  /** The release tag of the test box that ran the send (its tree's stamp, the one its status answer carries); null when
   *  that box could not read it, and when the field is absent (an older box): unknown (review 3882 F5, the coordinator's
   *  ruling). The send measured is that release's. */
  readonly release: string | null;
  /** What this part did not measure as the product has it, each name once, in {@link DELIVERY_UNMEASURED} order. */
  readonly unmeasured: readonly DeliveryUnmeasured[];
}

/** The recipe's word over its cases. */
export function deliveryWord(verdicts: readonly DeliveryCaseVerdict[]): DeliveryWord {
  if (verdicts.some((v) => v !== 'intact' && v !== 'refused')) return 'fault';
  return verdicts.includes('refused') ? 'refused' : 'intact';
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = <T extends string>(map: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DELIVERY_COUNT_MAX;
const keysAre = (o: Obj, keys: readonly string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const cps = (s: string): number => Array.from(s).length;
const shortText = (v: unknown): v is string => typeof v === 'string' && cps(v) <= 2 * DELIVERY_CONTEXT;

function readDivergence(v: unknown): DeliveryDivergence | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !keysAre(v, ['turn', 'index', 'expected', 'received'])) return undefined;
  if (!isCount(v['turn']) || !isCount(v['index']) || !shortText(v['expected']) || !shortText(v['received'])) return undefined;
  return { turn: v['turn'], index: v['index'], expected: v['expected'], received: v['received'] };
}

/** Whether a verdict is one the rule could give for `n` turns and this divergence: with the send word known (a result's
 *  case), exactly the rule's; with it not known (a view's case, which does not carry it), any the rule could give for some
 *  send word. No divergence where every turn was equal or none arrived; one where a turn must have differed; `partial`
 *  either way. */
function verdictFits(verdict: DeliveryCaseVerdict, n: number, divergence: DeliveryDivergence | null, send: string | null): boolean {
  const possible: readonly DeliveryCaseVerdict[] = send === null
    ? (n === 0 ? ['refused', 'false-confirmation'] : n === 1 ? ['intact', 'altered', 'partial'] : ['duplicate', 'split', 'partial'])
    : send !== 'ok' ? [n === 0 ? 'refused' : 'partial']
      : n === 0 ? ['false-confirmation'] : n === 1 ? ['intact', 'altered'] : ['duplicate', 'split'];
  if (!possible.includes(verdict)) return false;
  if ((verdict === 'intact' || verdict === 'duplicate' || n === 0) && divergence !== null) return false;
  if ((verdict === 'altered' || verdict === 'split') && divergence === null) return false;
  return divergence === null || divergence.turn < n;
}

/** A case's side requests: exactly one count per route. */
function readSideRequests(v: unknown): DeliverySideRequests | null {
  if (!isObj(v) || !keysAre(v, DELIVERY_ROUTES)) return null;
  const out: Partial<Record<DeliveryRoute, number>> = {};
  for (const r of DELIVERY_ROUTES) { const n = v[r]; if (!isCount(n)) return null; out[r] = n; }
  return out as DeliverySideRequests;
}

const CASE_KEYS = ['id', 'verdict', 'send', 'sentChars', 'receivedChars', 'divergence', 'sideRequests', 'hook'];

function readCase(v: unknown): DeliveryCaseResult | null {
  if (!isObj(v) || !keysAre(v, CASE_KEYS)) return null;
  const { id, verdict, send, sentChars, receivedChars, hook } = v;
  if (!isDeliveryCaseId(id) || !has(DELIVERY_CASE_VERDICT_MAP, verdict) || typeof send !== 'string' || !DELIVERY_SEND_WORD.test(send)) return null;
  const sideRequests = readSideRequests(v['sideRequests']);
  if (!isCount(sentChars) || sideRequests === null || !has(DELIVERY_HOOK_WITNESS_MAP, hook)) return null;
  if (!Array.isArray(receivedChars) || receivedChars.length > DELIVERY_TURNS_MAX || !receivedChars.every(isCount)) return null;
  const divergence = readDivergence(v['divergence']);
  if (divergence === undefined) return null;
  // The verdict must be the rule's for the send word and the turn count it carries (equality aside, which the counts
  // cannot show): a verdict the rule could not give is not a result.
  if (!verdictFits(verdict, receivedChars.length, divergence, send)) return null;
  return { id, verdict, send, sentChars, receivedChars: [...receivedChars], divergence, sideRequests, hook };
}

/** A result's `unmeasured` list: known names, each once, in {@link DELIVERY_UNMEASURED} order. */
function readUnmeasured(v: unknown): DeliveryUnmeasured[] | null {
  if (!Array.isArray(v) || v.length > DELIVERY_UNMEASURED.length) return null;
  let after = -1;
  for (const x of v as unknown[]) {
    const at = has(DELIVERY_UNMEASURED_MAP, x) ? DELIVERY_UNMEASURED.indexOf(x) : -1;
    if (at <= after) return null;
    after = at;
  }
  return [...v] as DeliveryUnmeasured[];
}

/** A result's or a view's `release`: a release tag, or null; ABSENT (an older box) reads as null, unknown. */
const releaseOf = (o: Obj): string | null | undefined => {
  if (!Object.prototype.hasOwnProperty.call(o, 'release') || o['release'] === null) return null;
  return isReleaseTag(o['release']) ? o['release'] : undefined;
};

/** Every key of `o` is one of `required` or `optional`, and every `required` one is present. */
const keysWithin = (o: Obj, required: readonly string[], optional: readonly string[]): boolean =>
  required.every((k) => Object.prototype.hasOwnProperty.call(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));

/** THE ONE READER of a delivery capture's result, for `build` and the `part` asked: the recipe echoed, a version of its
 *  shape, the part echoed, the box's release (a tag or null; absent reads as null), the unmeasured list, at least one case, each a known id once and in `DELIVERY_CASE_IDS` order, each well formed and
 *  within the bounds, and the word the cases decide. `null`: not a delivery result for this build and part (another build,
 *  part or recipe, a field missing, mistyped or unnamed, no case, a case unknown, repeated or out of order, a bound
 *  passed, or a word the cases do not give). WHICH cases the part holds is not read here: a box on another recipe may
 *  split them otherwise, and that is the lane's currency question (`deliveryCapture.ts#deliveryResultCurrency`), never a
 *  malformed answer. */
export function readDeliveryCaptureResult(v: unknown, build: string, part: number): DeliveryCaptureResult | null {
  if (!isObj(v) || !keysWithin(v, ['recipe', 'version', 'build', 'part', 'word', 'cases', 'unmeasured'], ['release'])) return null;
  if (v['recipe'] !== 'delivery' || v['build'] !== build || !isClaudeVersion(build) || !has(DELIVERY_WORD_MAP, v['word'])) return null;
  if (!isDeliveryPart(part) || v['part'] !== part) return null;
  if (typeof v['version'] !== 'string' || !DELIVERY_VERSION_SHAPE.test(v['version'])) return null;
  // Every id is known and strictly after the one before, so no list longer than the recipe's cases is ever read whole.
  if (!Array.isArray(v['cases']) || v['cases'].length === 0) return null;
  const cases: DeliveryCaseResult[] = [];
  let after = -1;
  for (const raw of v['cases'] as unknown[]) {
    const c = readCase(raw);
    const at = c === null ? -1 : DELIVERY_CASE_IDS.indexOf(c.id);
    if (c === null || at <= after) return null;
    after = at;
    cases.push(c);
  }
  if (deliveryWord(cases.map((c) => c.verdict)) !== v['word']) return null;
  const release = releaseOf(v);
  const unmeasured = readUnmeasured(v['unmeasured']);
  if (release === undefined || unmeasured === null) return null;
  return { recipe: 'delivery', version: v['version'], build, part, word: v['word'], cases, release, unmeasured };
}

// ── what the console's build list reads (Desktop polish wave 178, the capture lane) ──────────────────────────────

/** The join over a build's parts: the parts' words, or `incomplete` while a part has no current result. A word of its own,
 *  never folded into `intact` or `fault` (`deliveryJoinWord` decides it; `deliveryLane.ts#deliveryWordOf` asks it of the rows). */
export type DeliveryJoinWord = DeliveryWord | 'incomplete';
export const DELIVERY_JOIN_WORD_MAP: Record<DeliveryJoinWord, true> = { intact: true, refused: true, fault: true, incomplete: true };

/** THE JOIN, once: each part's current word, by part, `null` for a part with none. Any `fault` is `fault`; else any part with
 *  none is `incomplete`; else any `refused` is `refused`; else `intact`. The lane's word and the view reader's check both ask it. */
export function deliveryJoinWord(words: readonly (DeliveryWord | null)[]): DeliveryJoinWord {
  if (words.includes('fault')) return 'fault';
  if (words.includes(null)) return 'incomplete';
  return words.includes('refused') ? 'refused' : 'intact';
}

/** Why a delivery try sent nothing: the trust lane's not-sent words, and one of the recipe's own. `recipe-not-run`: the box
 *  WAS reached and closed the connection on the delivery frame, so it does not run the recipe (an older box, or one without
 *  the driver), which a reader must tell from `no-test-box`, a box not reached. It is the delivery lane's word alone: build
 *  trust's vocabulary (`BUILD_CAPTURE_NOT_SENT_MAP`), its table's CHECK and the console's wording for it are untouched. */
export type DeliveryNotSent = BuildCaptureNotSent | 'recipe-not-run';
export const DELIVERY_NOT_SENT_MAP: Record<DeliveryNotSent, true> = { ...BUILD_CAPTURE_NOT_SENT_MAP, 'recipe-not-run': true };

/** A part with no current result, and why its last try sent nothing (null: it sent a job, or none was tried yet). */
export interface DeliveryUnmeasuredPart {
  readonly part: number;
  readonly notSent: DeliveryNotSent | null;
}

/** One case as the build list carries it: the verdict, the counts (the sent text's length and each turn's length) and the
 *  first divergence, as the stored result has them. The send word and the hook witness stay in the result. */
export interface DeliveryCaseView {
  readonly id: DeliveryCaseId;
  readonly verdict: DeliveryCaseVerdict;
  readonly sentChars: number;
  readonly receivedChars: readonly number[];
  readonly divergence: DeliveryDivergence | null;
}

/** One current part of a build: the recipe version it ran, the release of the box that ran it (null: unknown), when it was
 *  recorded, its word and its cases. */
export interface DeliveryPartView {
  readonly part: number;
  readonly version: string;
  readonly release: string | null;
  readonly at: number;
  readonly word: DeliveryWord;
  readonly cases: readonly DeliveryCaseView[];
}

/** One build's delivery standing: the join word and every current part it has a result for, by part. */
export interface DeliveryBuildView {
  readonly build: string;
  readonly word: DeliveryJoinWord;
  readonly parts: readonly DeliveryPartView[];
  /** Every part with no current result, by part, each with its last not-sent word: "no box runs the recipe"
   *  (`recipe-not-run`) is told from "the box was not reached" (`no-test-box`, `not-started`). */
  readonly unmeasured: readonly DeliveryUnmeasuredPart[];
}

/** A case's view, cut from a result's case. */
export const deliveryCaseViewOf = (c: DeliveryCaseResult): DeliveryCaseView =>
  ({ id: c.id, verdict: c.verdict, sentChars: c.sentChars, receivedChars: [...c.receivedChars], divergence: c.divergence });

function readCaseView(v: unknown): DeliveryCaseView | null {
  if (!isObj(v) || !keysAre(v, ['id', 'verdict', 'sentChars', 'receivedChars', 'divergence'])) return null;
  const { id, verdict, sentChars, receivedChars } = v;
  if (!isDeliveryCaseId(id) || !has(DELIVERY_CASE_VERDICT_MAP, verdict) || !isCount(sentChars)) return null;
  if (!Array.isArray(receivedChars) || receivedChars.length > DELIVERY_TURNS_MAX || !receivedChars.every(isCount)) return null;
  const divergence = readDivergence(v['divergence']);
  if (divergence === undefined) return null;
  // A verdict the rule could give for some send word, given the counts and the divergence (the view carries no send word).
  if (!verdictFits(verdict, receivedChars.length, divergence, null)) return null;
  return { id, verdict, sentChars, receivedChars: [...receivedChars], divergence };
}

/** A part's view: well formed, its cases each a known id once and in `DELIVERY_CASE_IDS` order, each verdict one the rule
 *  could give for its counts, and its word the one its cases decide (review 3882 A5). */
function readPartView(v: unknown): DeliveryPartView | null {
  if (!isObj(v) || !keysWithin(v, ['part', 'version', 'at', 'word', 'cases'], ['release'])) return null;
  const { part, version, at, word, cases } = v;
  const release = releaseOf(v);
  if (!isDeliveryPart(part) || typeof version !== 'string' || !DELIVERY_VERSION_SHAPE.test(version) || !isCount(at) || !has(DELIVERY_WORD_MAP, word) || release === undefined) return null;
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > DELIVERY_CASE_IDS.length) return null;
  const read: DeliveryCaseView[] = [];
  let after = -1;
  for (const raw of cases as unknown[]) {
    const c = readCaseView(raw);
    const at2 = c === null ? -1 : DELIVERY_CASE_IDS.indexOf(c.id);
    if (c === null || at2 <= after) return null;
    after = at2;
    read.push(c);
  }
  if (deliveryWord(read.map((c) => c.verdict)) !== word) return null;
  return { part, version, release, at, word, cases: read };
}

/** How many builds the build list's `deliveries` carries at most, newest first (review 3882 A5: a reader-side bound on
 *  every list). The lane's view (`deliveryLane.ts#deliveryViewsOf`) cuts to it, so the reader never refuses a whole answer
 *  because the table grew. */
export const DELIVERY_VIEW_BUILDS_MAX = 64;

/** THE ONE READER of `GET /api/testbox/builds`'s optional `deliveries` list (beside `claudeBuildTrust.ts#readClaudeBuildRecords`,
 *  which reads the list beside it): at most {@link DELIVERY_VIEW_BUILDS_MAX} builds, every build well formed once, each part
 *  once and in order and consistent with itself (its cases in order, each verdict one its counts allow, its word its cases'
 *  word), every part of the recipe listed once as measured or unmeasured, and the build's word the join of them, or `null`. ABSENT
 *  (`undefined`, a server older than the key) reads as no list at all, `[]`: the answer is still the build record's. */
export function readDeliveryViews(v: unknown): DeliveryBuildView[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > DELIVERY_VIEW_BUILDS_MAX) return null;
  const out: DeliveryBuildView[] = [];
  for (const x of v as unknown[]) {
    if (!isObj(x) || !keysAre(x, ['build', 'word', 'parts', 'unmeasured']) || !isClaudeVersion(x['build']) || !has(DELIVERY_JOIN_WORD_MAP, x['word'])) return null;
    if (!Array.isArray(x['parts']) || x['parts'].length > DELIVERY_PART_COUNT) return null;
    const parts: DeliveryPartView[] = [];
    let after = -1;
    for (const raw of x['parts'] as unknown[]) {
      const p = readPartView(raw);
      if (p === null || p.part <= after) return null;
      after = p.part;
      parts.push(p);
    }
    if (!Array.isArray(x['unmeasured'])) return null;
    const unmeasured: DeliveryUnmeasuredPart[] = [];
    let last = -1;
    for (const raw of x['unmeasured'] as unknown[]) {
      if (!isObj(raw) || !keysAre(raw, ['part', 'notSent']) || !isDeliveryPart(raw['part']) || raw['part'] <= last) return null;
      if (!(raw['notSent'] === null || has(DELIVERY_NOT_SENT_MAP, raw['notSent']))) return null;
      last = raw['part'];
      unmeasured.push({ part: raw['part'], notSent: raw['notSent'] });
    }
    if (out.some((b) => b.build === x['build'])) return null;
    // Every part of the recipe exactly once, measured or not, and the word the join of what is listed: a part both measured
    // and unmeasured, a missing part, or an `intact` or `refused` beside an unmeasured part is refused (call 1253).
    const listed = [...parts.map((p) => p.part), ...unmeasured.map((u) => u.part)].sort((a, b) => a - b);
    if (listed.length !== DELIVERY_PART_COUNT || listed.some((p, i) => p !== i)) return null;
    if (x['word'] !== deliveryJoinWord(listed.map((i) => parts.find((p) => p.part === i)?.word ?? null))) return null;
    out.push({ build: x['build'], word: x['word'], parts, unmeasured });
  }
  return out;
}
