// Overlord W2, the decision model's arming, doors and lines (spec 2026-11-09 §3.7 H6, §7.6, §11.2; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Tasks 6 to 8). Ring: L1, context Coordination (C5): pure,
// no store, no clock, no I/O; time, ids and resolved addresses are arguments. The doors (`decisionModelRoutes.ts`, L4), the
// anchor-set lane (`decisionModelLane.ts`, L4) and the authority grammar (`overlordAuthority.ts`, L1) ask these and decide
// nothing themselves.
import { upperBound95 } from '../../../shared/binomialBound.js';
import {
  DECISION_ANCHOR_COUNT, DECISION_CANARY_MAX_SHARE, DECISION_CEILING_MAX, DECISION_CEILING_MIN, DECISION_DRIFT_MOVED,
  DECISION_HOST_KINDS, DECISION_LINE_CANDIDATES, DECISION_QUESTIONS, isDecisionRowId, readDecisionRowSide,
  type DecisionBand, type DecisionHeldCause, type DecisionHostKind, type DecisionModelView, type DecisionQuestionRow, type DecisionRowId,
  type DecisionRowSide, type DecisionRowState, type DecisionRowView,
} from '../../../shared/decisionModel.js';
import { SECRET_TAIL_MIN, isOneLine } from '../../../shared/ledgers.js';
import { utf8Bytes } from '../../../shared/utf8.js';
import { isLiteralHost, isPrivateAddress, type DecisionUsage } from './decisionModel.js';

/** Whether a row is a gate (fail closed while armed) or advice (fail open). */
export const isDecisionGate = (row: DecisionRowId): boolean => DECISION_QUESTIONS[row].direction === 'gate';

/**
 * Which way an arming move goes (question 5), from the move alone: the record carries no actor, as the W1 grammar rules.
 * Spend counts as widening. First match:
 *
 * | # | When | Answer |
 * |---|---|---|
 * | 1 | `to.ceiling` is above `from.ceiling` | widens |
 * | 2 | `from.mode` is `off` and `to.mode` is not | widens (new spend) |
 * | 3 | a gate, `from` armed or held, and `to.mode` is `shadow` or `off` | widens (the gate stops shutting) |
 * | 4 | a gate, `from.held`, and `to` armed and not held | widens |
 * | 5 | a gate armed on both sides, both not held, and `to.armedLine` differs from `from.armedLine` while its `line` is not
 *       strictly above `from.armedLine.line` | widens (not provably stricter; review 2262 F2) |
 * | 6 | otherwise | narrows |
 */
export function decisionRowDirection(gate: boolean, from: DecisionRowSide, to: DecisionRowSide): 'narrows' | 'widens' {
  // 1. More calls a day is more spend.
  if (to.ceiling > from.ceiling) return 'widens';
  // 2. A row that starts being asked is new spend.
  if (from.mode === 'off' && to.mode !== 'off') return 'widens';
  if (gate) {
    const fromShuts = from.mode === 'armed' || from.held;
    // 3. A gate that stops shutting.
    if (fromShuts && (to.mode === 'shadow' || to.mode === 'off')) return 'widens';
    // 4. A held gate let through again.
    if (from.held && to.mode === 'armed' && !to.held) return 'widens';
    // 5. An armed gate's line moved to one that is not strictly stricter.
    if (from.mode === 'armed' && to.mode === 'armed' && !from.held && !to.held) {
      const a = from.armedLine;
      const b = to.armedLine;
      const same = a !== null && b !== null && a.id === b.id && a.line === b.line;
      if (!same && (a === null || b === null || !(b.line > a.line))) return 'widens';
    }
  }
  // 6.
  return 'narrows';
}

// ── lines: counting and fixed-sequence admission (Task 8, question 17) ───────────────────────────────────────────────

/** One labelled case at its answer: what the model said and how sure (`p`), and what the label says it should have been. */
export interface LabelledAnswer {
  p: number;
  verdict: 'yes' | 'no' | 'unsure' | { option: string } | 'none';
  label: 'yes' | 'no' | { option: string } | 'none';
}

/**
 * `n` and the errors among them at line `t` (question 17's table, ruling F10). A yes-or-no row, gate or advice: `n` is the
 * cases whose answer is a clear yes at `t` (the verdict `yes`, `p` at or over `t`), and an error is the label `no`; an
 * `unsure` and a `no` answer are not in `n`. A choice row: `n` is the cases whose answer names an option, not `none`, not
 * `unsure`, with `p` at or over `t`, and an error is a label that is another option, or `none`. The label queue counts with
 * this too, so it is exported.
 */
export function lineCounts(row: DecisionQuestionRow, cases: readonly LabelledAnswer[], t: number): { n: number; errors: number } {
  let n = 0;
  let errors = 0;
  for (const c of cases) {
    if (c.p < t) continue;
    if (row.type === 'yes-no') {
      if (c.verdict !== 'yes') continue;
      n++;
      if (c.label === 'no') errors++;
    } else {
      if (typeof c.verdict !== 'object') continue;
      n++;
      if (typeof c.label !== 'object' || c.label.option !== c.verdict.option) errors++;
    }
  }
  return { n, errors };
}

/**
 * Fixed-sequence admission (ruling F10): the candidate lines strictest first, each against the row's target by the one-sided
 * 95% bound on its error rate. It stops at the first candidate whose bound is over the target, and admits the last that passed,
 * so no later candidate is tried and the bound needs no correction. When the strictest fails, nothing is admitted and
 * `triedFirst` says which line that was.
 */
export function admitLine(row: DecisionQuestionRow, cases: readonly LabelledAnswer[]):
  { admitted: true; line: number; labelled: number; errors: number; bound: number } | { admitted: false; triedFirst: number } {
  let last: { admitted: true; line: number; labelled: number; errors: number; bound: number } | null = null;
  for (const t of DECISION_LINE_CANDIDATES) {
    const { n, errors } = lineCounts(row, cases, t);
    const bound = upperBound95(errors, n);
    if (bound > row.target) break;
    last = { admitted: true, line: t, labelled: n, errors, bound };
  }
  return last ?? { admitted: false, triedFirst: DECISION_LINE_CANDIDATES[0] };
}

// ── the canary (question 18, ruling F11) ──────────────────────────────────────────────────────────────────────────────

type CanaryVerdictWord = LabelledAnswer['verdict'];
/** A clear yes at the line. */
const isClearYes = (verdict: CanaryVerdictWord, p: number, line: number): boolean => verdict === 'yes' && p >= line;
/** The option an answer names at the line, `none` for a `none`, null for no mark: an `unsure`, a yes or no, or a `p` under the line. */
const namedAtLine = (verdict: CanaryVerdictWord, p: number, line: number): string | null =>
  p >= line && typeof verdict === 'object' ? verdict.option : null;

/**
 * Whether one perturbed answer crosses (question 18): its effect at the line moves toward the row's `attackerWants` from the
 * same case's plain answer. For `no`: the plain answer marks (a clear yes at the line) and the perturbed one does not. For
 * `yes`: the plain answer is not a clear yes and the perturbed one is. For `an-option`: a pick is the effect at the line, so
 * it crosses when the two answers differ and at least one of them names an option there; a perturbed `none` or `unsure` (or
 * a `p` under the line) that loses a named option crosses, and so does a gained option. Two answers neither of which names an
 * option at the line are both no pick, and the move between them is away from an option, not toward one.
 */
export function canaryCrossed(row: DecisionQuestionRow, line: number, plain: CanaryVerdictWord, plainP: number,
  perturbed: CanaryVerdictWord, perturbedP: number): boolean {
  switch (row.attackerWants) {
    case 'no': return isClearYes(plain, plainP, line) && !isClearYes(perturbed, perturbedP, line);
    case 'yes': return !isClearYes(plain, plainP, line) && isClearYes(perturbed, perturbedP, line);
    case 'an-option': {
      const was = namedAtLine(plain, plainP, line);
      const now = namedAtLine(perturbed, perturbedP, line);
      return (was !== null || now !== null) && was !== now;
    }
  }
}

/**
 * What a line's canary says: `not-run` for none asked (or none expected), `incomplete` below the full set, then `held` at
 * most `DECISION_CANARY_MAX_SHARE` of the full set crossed, else `unmet` (295 expected: 14 held, 15 unmet).
 */
export function canaryVerdict(asked: number, crossed: number, expected: number): 'not-run' | 'incomplete' | 'held' | 'unmet' {
  if (expected === 0 || asked === 0) return 'not-run';
  if (asked < expected) return 'incomplete';
  return crossed <= DECISION_CANARY_MAX_SHARE * expected ? 'held' : 'unmet';
}

// ── drift (question 10) ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the anchor set drifted from the line's baseline: at least `DECISION_DRIFT_MOVED` of its positions in another band. A
 * set that is not `DECISION_ANCHOR_COUNT` on both sides cannot be shown not to have drifted, so it counts as drift: a gate
 * is held, which narrows, and the operator sees why.
 */
export function anchorDrift(baseline: readonly DecisionBand[], today: readonly DecisionBand[]): boolean {
  if (baseline.length !== DECISION_ANCHOR_COUNT || today.length !== DECISION_ANCHOR_COUNT) return true;
  let moved = 0;
  for (const [i, b] of baseline.entries()) if (today[i] !== b) moved++;
  return moved >= DECISION_DRIFT_MOVED;
}

// ── the operator's doors (Task 7) ────────────────────────────────────────────────────────────────────────────────────

/** A door decider's refusal words: each is `shared/refusal.ts#DECISION_MODEL_REFUSALS`'s (or `bad-request`, the doors' own). */
export type DecisionDoorRefusal = 'decision-row-unknown' | 'bad-request' | 'key-unset' | 'private-state-host' | 'line-not-admitted'
  | 'canary-unmet' | 'bad-ceiling' | 'bad-endpoint' | 'key-required';
type Refused = { ok: false; refusal: DecisionDoorRefusal; detail: string };
const refuse = (refusal: DecisionDoorRefusal, detail: string): Refused => ({ ok: false, refusal, detail });

/** The facts of one line, as the door reads them: `underToday` is whether it stands under today's host kind, origin, model and
 *  the row's revision. */
export interface DecisionLineFacts {
  id: number;
  line: number;
  underToday: boolean;
  canaryAsked: number;
  canaryExpected: number;
  canaryCrossed: number;
}
/** A move a door asks the store to make: from `expected` to `to`. A null `heldCause` is no cause: the row is not held, or (when
 *  `to.held`) keeps the cause it has. */
export type DecisionDoorMove = { ok: true; row: DecisionRowId; expected: DecisionRowSide; to: DecisionRowSide; heldCause: DecisionHeldCause | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** The body's keys are all in `allowed` and every one of `required` is present. */
const keysOf = (o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => has(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));
const isPositiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/**
 * `POST /api/decision-model/rows/:id/arm` (plan Task 7, first match after the account gate): to `shadow` or `armed`.
 *
 * | # | When | Answer |
 * |---|---|---|
 * | 1 | `:id` is not a catalogue row | `decision-row-unknown` |
 * | 2 | the body is not exactly `mode`, `expected` and an optional `line`; `mode` is not `shadow` or `armed`; `line` is not a positive safe integer; `expected` is not a side | `bad-request` |
 * | 3 | no host, or no key | `key-unset` |
 * | 4 | the row is `privateState` and the host is `hosted` | `private-state-host` |
 * | 5 | `armed`, and no line is named, none is current, `line` is not the current one, or the target is not under today | `line-not-admitted` |
 * | 6 | `armed`, and the target line's canary is not `held` (not run, partial, or over 5%) | `canary-unmet` |
 * | 7 | otherwise | the move to `{ mode, ceiling: expected.ceiling, armedLine: gate and armed ? the line : null, held: false }` |
 *
 * The target line of an `armed` move is `line`, else an armed gate's own `armedLine` (ruling F4: it keeps its line), else the
 * current line. Resuming a held row is this same call with the stored mode.
 */
export function decideRowArm(i: { rowId: string; body: unknown; host: { kind: DecisionHostKind } | null; keySet: boolean;
  currentLine: DecisionLineFacts | null; lineById: (id: number) => DecisionLineFacts | null }): DecisionDoorMove | Refused {
  if (!isDecisionRowId(i.rowId)) return refuse('decision-row-unknown', 'not a decision-model row');
  const row = i.rowId;
  const body = i.body;
  if (!isObj(body) || !keysOf(body, ['mode', 'expected'], ['line'])) return refuse('bad-request', 'the body is mode, expected and an optional line');
  const mode = body['mode'];
  if (mode !== 'shadow' && mode !== 'armed') return refuse('bad-request', 'mode is shadow or armed');
  if (has(body, 'line') && !isPositiveId(body['line'])) return refuse('bad-request', 'line is a positive integer');
  const expected = readDecisionRowSide(body['expected']);
  if (expected === null) return refuse('bad-request', 'expected is not a row side');
  const named = has(body, 'line') ? (body['line'] as number) : null;
  if (i.host === null || !i.keySet) return refuse('key-unset', 'the host and its key are set first');
  const q = DECISION_QUESTIONS[row];
  if (q.privateState && i.host.kind === 'hosted') return refuse('private-state-host', 'a private-state row is never asked of a hosted host');
  const gate = isDecisionGate(row);
  let line: DecisionLineFacts | null = null;
  if (mode === 'armed') {
    const target = named ?? (gate && expected.mode === 'armed' && expected.armedLine !== null ? expected.armedLine.id : (i.currentLine?.id ?? null));
    if (target === null || (named !== null && named !== i.currentLine?.id)) return refuse('line-not-admitted', 'no admitted line to arm on');
    line = i.lineById(target);
    if (line === null || !line.underToday) return refuse('line-not-admitted', 'the line does not stand under today\'s host and model');
    if (canaryVerdict(line.canaryAsked, line.canaryCrossed, line.canaryExpected) !== 'held') return refuse('canary-unmet', 'the line\'s canary has not held');
  }
  const armedLine = gate && line !== null ? { id: line.id, line: line.line } : null;
  return { ok: true, row, expected, to: { mode, ceiling: expected.ceiling, armedLine, held: false }, heldCause: null };
}

/** `POST /api/decision-model/rows/:id/off`: `decision-row-unknown`, then `bad-request` (not exactly `{ expected }`), then the move
 *  to `off` with the ceiling kept. */
export function decideRowOff(i: { rowId: string; body: unknown }): DecisionDoorMove | Refused {
  if (!isDecisionRowId(i.rowId)) return refuse('decision-row-unknown', 'not a decision-model row');
  const body = i.body;
  if (!isObj(body) || !keysOf(body, ['expected'])) return refuse('bad-request', 'the body is expected');
  const expected = readDecisionRowSide(body['expected']);
  if (expected === null) return refuse('bad-request', 'expected is not a row side');
  return { ok: true, row: i.rowId, expected, to: { mode: 'off', ceiling: expected.ceiling, armedLine: null, held: false }, heldCause: null };
}

/**
 * What the off door does when the journal refused the move (ruling F1). A gate that is armed and whose off the journal refused
 * as `authority-rolled-back` or `authority-unmeasured` is held instead (a narrowing, cause `off-refused`), or is already held,
 * and nothing is written. Anything else is refused.
 */
export function offFallback(row: DecisionRowId, expected: DecisionRowSide, error: string): 'hold' | 'already-held' | 'refuse' {
  if (!isDecisionGate(row) || expected.mode !== 'armed') return 'refuse';
  if (error !== 'authority-rolled-back' && error !== 'authority-unmeasured') return 'refuse';
  return expected.held ? 'already-held' : 'hold';
}

/**
 * `POST /api/decision-model/rows/:id/ceiling` (ruling F4): `decision-row-unknown`; `bad-request` (not exactly `{ ceiling,
 * expected }`, a ceiling that is no safe integer); `bad-ceiling` (outside `DECISION_CEILING_MIN` to `DECISION_CEILING_MAX`); then
 * the move that changes the ceiling alone. It never runs the arm door's rows 3 to 6, never clears `held` (the store keeps a held
 * row's cause) and never changes the mode or the armed line.
 */
export function decideRowCeiling(i: { rowId: string; body: unknown }): DecisionDoorMove | Refused {
  if (!isDecisionRowId(i.rowId)) return refuse('decision-row-unknown', 'not a decision-model row');
  const body = i.body;
  if (!isObj(body) || !keysOf(body, ['ceiling', 'expected'])) return refuse('bad-request', 'the body is ceiling and expected');
  const ceiling = body['ceiling'];
  const expected = readDecisionRowSide(body['expected']);
  if (typeof ceiling !== 'number' || !Number.isSafeInteger(ceiling) || expected === null) return refuse('bad-request', 'ceiling is an integer and expected a row side');
  if (ceiling < DECISION_CEILING_MIN || ceiling > DECISION_CEILING_MAX) {
    return refuse('bad-ceiling', `the ceiling is ${DECISION_CEILING_MIN} to ${DECISION_CEILING_MAX}`);
  }
  return { ok: true, row: i.rowId, expected, to: { ...expected, ceiling }, heldCause: null };
}

/** The endpoint's hostname, brackets stripped, for the door to resolve; null when the body has no endpoint that parses. */
export function keyDoorHostname(body: unknown): string | null {
  if (!isObj(body) || typeof body['endpoint'] !== 'string') return null;
  try {
    const host = new URL(body['endpoint']).hostname;
    if (host === '') return null;
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  } catch {
    return null;
  }
}

/** A key's characters: what an HTTP header value carries (review 2418 F9), so no NUL and none above U+00FF. */
const KEY_CHARS = /^[\u0001-\u00ff]+$/;

/** The authority part of a URL text, between `//` and the first `/`, `?` or `#`: where userinfo would sit. */
const authorityOf = (endpoint: string): string => /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(endpoint)?.[1] ?? '';

/**
 * `PUT /api/decision-model/key` (ruling F8; the door resolves the host name first and passes every address). First match:
 *
 * | # | When | Answer |
 * |---|---|---|
 * | 1 | the body is not exactly `kind`, `endpoint`, `modelId` and an optional `key`; `kind` is no host kind; `modelId` is not 1 to 200 characters on one line; `key` is not one line of at most 4096 characters with no NUL and none above U+00FF (a header value: review 2418 F9), or is under the masker's 20-byte floor (`SECRET_TAIL_MIN`), so the masker would not catch it | `bad-request` |
 * | 2 | `endpoint` does not parse, is not `https:` or `http:`, or carries userinfo, a query (an empty `?` too) or a fragment | `bad-endpoint` |
 * | 3 | `hosted` or `zero-retention`, and not `https:` | `bad-endpoint` |
 * | 4 | `local`, and the host is not an address literal or `localhost`, or no address resolved, or one is not loopback or private | `bad-endpoint` |
 * | 5 | `http:`, and one address is not loopback | `bad-endpoint` (a key leaves over `http:` only to loopback) |
 * | 6 | a host is stored, the new origin differs, and there is no `key` | `key-required` |
 * | 7 | no `key`, and none is stored | `key-unset` |
 * | 8 | otherwise | apply |
 *
 * The key's text is never in a refusal's `detail`.
 */
export function decideKeyDoor(i: { body: unknown; addresses: readonly string[]; stored: { kind: DecisionHostKind; origin: string;
  modelId: string; keySet: boolean } | null }): { ok: true; kind: DecisionHostKind; endpoint: string; origin: string; modelId: string;
  key: string | null; hostChanged: boolean; keyChanged: boolean } | Refused {
  const body = i.body;
  if (!isObj(body) || !keysOf(body, ['kind', 'endpoint', 'modelId'], ['key'])) return refuse('bad-request', 'the body is kind, endpoint, modelId and an optional key');
  const { kind, endpoint, modelId } = body;
  const key = has(body, 'key') ? body['key'] : null;
  if (typeof kind !== 'string' || !(DECISION_HOST_KINDS as readonly string[]).includes(kind) || typeof endpoint !== 'string') return refuse('bad-request', 'kind is a host kind and endpoint a string');
  if (typeof modelId !== 'string' || modelId.length < 1 || modelId.length > 200 || !isOneLine(modelId)) return refuse('bad-request', 'modelId is 1 to 200 characters on one line');
  if (has(body, 'key') && (typeof key !== 'string' || key.length > 4096 || !KEY_CHARS.test(key) || !isOneLine(key))) {
    return refuse('bad-request', 'the key is one line of at most 4096 characters, with no NUL and no character above U+00FF');
  }
  if (typeof key === 'string' && utf8Bytes(key) < SECRET_TAIL_MIN) return refuse('bad-request', `the key is at least ${SECRET_TAIL_MIN} bytes, so the egress masker catches it`);
  const hostKind = kind as DecisionHostKind;
  let url: URL;
  try { url = new URL(endpoint); } catch { return refuse('bad-endpoint', 'the endpoint is not a URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return refuse('bad-endpoint', 'the endpoint is https or http');
  if (authorityOf(endpoint).includes('@') || url.username !== '' || url.password !== '') return refuse('bad-endpoint', 'the endpoint carries userinfo');
  if (endpoint.includes('?') || endpoint.includes('#')) return refuse('bad-endpoint', 'the endpoint carries a query or a fragment');
  if (hostKind !== 'local' && url.protocol !== 'https:') return refuse('bad-endpoint', 'this host kind is reached over https');
  if (hostKind === 'local') {
    const host = keyDoorHostname(body);
    if (host === null || !isLiteralHost(host)) return refuse('bad-endpoint', 'a local endpoint names an address literal or localhost');
    if (i.addresses.length === 0 || !i.addresses.every((a) => isPrivateAddress(a, false))) return refuse('bad-endpoint', 'a local endpoint is a loopback or private address');
  }
  if (url.protocol === 'http:' && !i.addresses.every((a) => isPrivateAddress(a, true))) return refuse('bad-endpoint', 'a key goes over http only to a loopback address');
  const origin = url.origin;
  const given = typeof key === 'string' ? key : null;
  if (i.stored !== null && i.stored.origin !== origin && given === null) return refuse('key-required', 'a new endpoint origin needs the key again');
  if (given === null && (i.stored === null || !i.stored.keySet)) return refuse('key-unset', 'no key is stored');
  const hostChanged = i.stored === null || i.stored.kind !== hostKind || i.stored.origin !== origin || i.stored.modelId !== modelId;
  return { ok: true, kind: hostKind, endpoint, origin, modelId, key: given, hostChanged, keyChanged: given !== null };
}

/**
 * Whether a door asks the step-up (the coordinator's ruling, spec 7.5: a widening asks, a narrowing never does). Arming and
 * putting a key always ask; removing a key never does; switching off and moving the ceiling ask exactly when the move widens.
 * Every door asks it here, the one rule (review 2418 F9); the three that need no row ask before the body is read.
 */
export function decisionStepUp(door: 'arm' | 'key-put' | 'key-delete'): boolean;
export function decisionStepUp(door: 'off' | 'ceiling', gate: boolean, from: DecisionRowSide, to: DecisionRowSide): boolean;
export function decisionStepUp(door: 'arm' | 'off' | 'ceiling' | 'key-put' | 'key-delete', gate?: boolean, from?: DecisionRowSide,
  to?: DecisionRowSide): boolean {
  switch (door) {
    case 'arm':
    case 'key-put': return true;
    case 'key-delete': return false;
    case 'off':
    case 'ceiling': return decisionRowDirection(gate === true, from!, to!) === 'widens';
  }
}

// ── holds the key doors and the lane make (Tasks 7 and 9) ────────────────────────────────────────────────────────────

/** Whether a host change (the key door) or the lane's line-key check holds a row (question 4, `line-key`): an armed row not
 *  already held whose line is not under the new key. A gate's line is its `armedLine`; an advice row's is its current line. */
export function heldOnHostChange(side: DecisionRowSide, lineUnderKey: boolean): boolean {
  return side.mode === 'armed' && !side.held && !lineUnderKey;
}

/** Whether removing the key holds a row (`no-key`, question 11): every armed gate not already held. With no key every row
 *  answers `unavailable`; a gate is held so that a key set again does not re-open it without the operator. */
export function heldOnKeyRemoval(gate: boolean, side: DecisionRowSide): boolean {
  return gate && side.mode === 'armed' && !side.held;
}

// ── the operator's read (Task 7, the W2 Settings plan's SQ2) ─────────────────────────────────────────────────────────

/** A stored line as the read needs it (the store's `DecisionLineRow`, declared here by shape so L1 imports no L3 type). */
export interface DecisionLineSeen {
  readonly id: number; readonly line: number; readonly labelled: number; readonly errors: number; readonly bound: number;
  readonly canaryAsked: number; readonly canaryExpected: number; readonly canaryCrossed: number;
}

/** The read, from each row's stored state, today's counts and its current line (null with no host or no line). An armed gate
 *  is offered its current line when that is newer than the line it was armed on (question 4): the read shows it, and only
 *  the operator's arm takes it. Never any part of the key, a price or a model's answer. */
export function decisionModelViewOf(i: {
  rows: readonly { row: DecisionRowId; state: DecisionRowState; usage: Extract<DecisionUsage, { measured: true }>; current: DecisionLineSeen | null }[];
  fleetToday: number; fleetCap: number;
  host: DecisionModelView['host']; key: DecisionModelView['key'];
}): DecisionModelView {
  return {
    rows: i.rows.map(({ row, state, usage, current }): DecisionRowView => {
      const q = DECISION_QUESTIONS[row];
      const a = state.armedLine;
      const offered = q.direction === 'gate' && state.mode === 'armed' && a !== null && current !== null && current.id > a.id
        ? { id: current.id, line: current.line } : null;
      return {
        id: row, side: { mode: state.mode, ceiling: state.ceiling, armedLine: a, held: state.held }, heldWhy: state.heldCause,
        direction: q.direction, privateState: q.privateState,
        today: { serve: usage.serve, maintenance: usage.maintain, reserved: usage.reserved, total: usage.serve + usage.maintain + usage.reserved },
        line: current === null ? null : { id: current.id, line: current.line, admitted: true, labelled: current.labelled, errors: current.errors,
          bound: current.bound, canaryAsked: current.canaryAsked, canaryExpected: current.canaryExpected, canaryCrossed: current.canaryCrossed },
        offered,
      };
    }),
    fleetToday: i.fleetToday, fleetCap: i.fleetCap, host: i.host, key: i.key,
  };
}

// ── the lane's holds (Task 9) ────────────────────────────────────────────────────────────────────────────────────────

/** An armed row that is not held: the only rows the lane's drift and canary checks hold. */
export function armedAndFree(side: DecisionRowSide): boolean {
  return side.mode === 'armed' && !side.held;
}

/** Whether a stored line is under a key (host kind, origin, model and the row's revision); no line, or no key (no host), is
 *  not under it. */
export function lineUnderKey(line: { hostKind: DecisionHostKind; origin: string; modelId: string; revision: string } | null,
  key: { hostKind: DecisionHostKind; origin: string; modelId: string; revision: string } | null): boolean {
  return line !== null && key !== null && line.hostKind === key.hostKind && line.origin === key.origin && line.modelId === key.modelId
    && line.revision === key.revision;
}

/** Whether an armed, free gate's own line no longer holds on today's labelled answers (question 4, `bound`): the one-sided bound
 *  at its armed line is over the row's target. Never for advice, a held row or a gate with no armed line. */
export function armedLineBoundFails(row: DecisionQuestionRow, side: DecisionRowSide, answers: readonly LabelledAnswer[]): boolean {
  if (row.direction !== 'gate' || !armedAndFree(side) || side.armedLine === null) return false;
  const { n, errors } = lineCounts(row, answers, side.armedLine.line);
  return upperBound95(errors, n) > row.target;
}
