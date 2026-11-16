// Overlord W2, the decision-model port (spec 2026-11-09 §3.7 H6; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 2): plan a row's call, encode the request and read
// its answers. Ring: L1, context Coordination (C5): pure, no store, no clock (the day and the opaque ids are arguments), and
// it imports `shared/` only. The one caller (`decisionModelAsk.ts`, L4) asks these and decides nothing itself.
//
// FIRST MATCH, TOP TO BOTTOM (`planDecision`). A held gate, a private-state row on a `hosted` host and a row whose egress
// screen did not clear come before the record reuse, so none of them is ever served from an earlier record either.
//
// NOTHING FREE-FORM IS SENT (`encodeDecisionRequest`). The request is catalogue text, the row's typed fields and opaque ids
// the caller draws. A `quoted` field (text a session wrote, the Overlord's included) travels only under a key named
// `quoted`. A choice's options and a swapped pair's two texts sit under opaque ids, never a slug or a field's own name.
//
// `p` IS THE ANSWER NEAREST THE SIDE THAT GRANTS LESS (`readDecisionAnswers`, question 15): for a yes-or-no row asked in both
// orders, the lower of the two for `yes` and `unsure`, the higher for `no`; for a choice, the lower of the two orders'
// probabilities for the option named.
import {
  DECISION_BAND_CUTS, DECISION_FIELD_MAX_CHARS, DECISION_FLEET_DAILY_TOTAL, DECISION_QUESTIONS, DECISION_REQUEST_MAX_BYTES,
  DECISION_RESERVE_PER_REQUEST, DECISION_SHORTLIST_MAX,
  type DecisionBand, type DecisionCheck, type DecisionHostKind, type DecisionRowId, type DecisionRowSide,
  type DecisionVerdict,
} from '../../../shared/decisionModel.js';

/** A row's state, after the caller built it: each field's text, or a list of texts. */
export type DecisionFields = Readonly<Record<string, string | readonly string[]>>;

/** Today's counts for one row (`decisionModelStore.ts#decisionUsage`), or `measured: false`: never a bare null. */
export type DecisionUsage =
  | { measured: true; serve: number; maintain: number; reserved: number; ceiling: number; fleetTotal: number }
  | { measured: false };

/** What the hosted egress screen said, or `not-hosted` when the host is not `hosted` and no screen ran (question 9). */
export type DecisionEgressWord = 'clear' | 'hit' | 'no-list' | 'unreadable' | 'not-hosted';

export interface PlanInput {
  row: DecisionRowId;
  /** The anchor-set lane passes `maintain`. */
  kind: 'serve' | 'maintain';
  /** The lane passes true: never served from the record. */
  fresh: boolean;
  /** PR A: always DECISION_ROW_DEFAULT from its caller. */
  side: DecisionRowSide;
  host: { kind: DecisionHostKind; modelId: string; origin: string } | null;
  keySet: boolean;
  fields: DecisionFields;
  requestBytes: number;
  egress: DecisionEgressWord;
  /** A record under this row's key: revision, model, host kind, origin, state and line generation. */
  record: { id: number } | null;
  usage: DecisionUsage;
}

export type RowPlan =
  | { do: 'ask' }
  | { do: 'reuse'; recordId: number }
  | { do: 'skip'; outcome: 'disarmed' | 'unavailable' | 'not-asked' | 'over-size' | 'over-ceiling'; why: string | null };

const skip = (outcome: Extract<RowPlan, { do: 'skip' }>['outcome'], why: string | null = null): RowPlan => ({ do: 'skip', outcome, why });

const isEmpty = (v: string | readonly string[] | undefined): boolean =>
  v === undefined || (typeof v === 'string' ? v.length === 0 : v.length === 0);
const texts = (v: string | readonly string[]): readonly string[] => (typeof v === 'string' ? [v] : v);

/** Serving may use whatever maintenance left: `C − maintain` (question 10). */
export function serveCap(u: { ceiling: number; maintain: number }): number {
  return u.ceiling - u.maintain;
}
/** The anchor-set lane never takes more than half, and never what serving has used: `min(floor(C / 2), C − serve)`. */
export function maintainCap(u: { ceiling: number; serve: number }): number {
  return Math.min(Math.floor(u.ceiling / 2), u.ceiling - u.serve);
}

/** First match, top to bottom (the plan's table, rows 1 to 15). */
export function planDecision(input: PlanInput): RowPlan {
  const q = DECISION_QUESTIONS[input.row];
  const { side, host, usage } = input;
  // 1. An off row is never asked.
  if (side.mode === 'off') return skip('disarmed');
  // 2. A held gate cannot let anything through, so asking it would be spend for nothing (ruling F1).
  if (q.direction === 'gate' && side.mode === 'armed' && side.held) return skip('not-asked', 'held');
  // 3, 4.
  if (host === null) return skip('unavailable', 'host-unset');
  if (!input.keySet) return skip('unavailable', 'no-key');
  // 5. Index Q10: a private-state row is never asked of a hosted host.
  if (q.privateState && host.kind === 'hosted') return skip('not-asked', 'private-state-hosted');
  // 6. A required field missing, an empty programme.pick shortlist included.
  if (q.fields.some((f) => f.required && isEmpty(input.fields[f.name]))) return skip('not-asked', 'missing-field');
  // 7.
  const overField = Object.values(input.fields).some((v) => texts(v).some((t) => t.length > DECISION_FIELD_MAX_CHARS));
  if (overField || input.requestBytes > DECISION_REQUEST_MAX_BYTES) return skip('over-size');
  // 8, 9. The hosted egress screen (question 9): a hit, or a list that exists and cannot be read.
  if (host.kind === 'hosted' && input.egress === 'hit') return skip('not-asked', 'egress-hit');
  if (host.kind === 'hosted' && input.egress === 'unreadable') return skip('not-asked', 'egress-unreadable');
  // 10. Never asked twice under one key.
  if (!input.fresh && input.record !== null) return { do: 'reuse', recordId: input.record.id };
  // 11. A count that cannot be read plans over the ceiling (review 2262 F5).
  if (!usage.measured) return skip('over-ceiling');
  const r = DECISION_RESERVE_PER_REQUEST;
  // 12. The fleet's total today, reservations included.
  if (usage.fleetTotal + r > DECISION_FLEET_DAILY_TOTAL) return skip('over-ceiling');
  // 13, 14.
  if (input.kind === 'serve' && usage.serve + usage.reserved + r > serveCap(usage)) return skip('over-ceiling');
  if (input.kind === 'maintain' && usage.maintain + usage.reserved + r > maintainCap(usage)) return skip('over-ceiling');
  // 15.
  return { do: 'ask' };
}

/** The band of a probability: four fixed cuts (question 10). */
export function bandOf(p: number): DecisionBand {
  if (p < DECISION_BAND_CUTS[0]) return 'unlikely';
  if (p < DECISION_BAND_CUTS[1]) return 'doubtful';
  if (p < DECISION_BAND_CUTS[2]) return 'likely';
  return 'very-likely';
}

/** The UTC day of a wall time, `YYYY-MM-DD`: the key of a row's day counts. */
export function decisionDayOf(wallMs: number): string {
  return new Date(wallMs).toISOString().slice(0, 10);
}

/** The line generation a row is gathered under: an armed gate's own line, never a newer one (review 2262 F3); else the
 *  current line; 0 before any line. */
export function decisionLineGen(row: DecisionRowId, side: DecisionRowSide, current: { id: number } | null): number {
  if (DECISION_QUESTIONS[row].direction === 'gate' && side.mode === 'armed' && side.armedLine !== null) return side.armedLine.id;
  return current?.id ?? 0;
}

/** The egress word an answered check records: `not-hosted` when no screen ran, `skipped-no-list` when no list was ever
 *  uploaded (Q9). A hit and an unreadable list never reach an answer (plan rows 8 and 9), so they are not arguments. */
export function egressWordOf(egress: Exclude<DecisionEgressWord, 'hit' | 'unreadable'>): 'clear' | 'skipped-no-list' | 'not-hosted' {
  return egress === 'no-list' ? 'skipped-no-list' : egress;
}

/** Every text of a row's state, for the hosted egress screen (§3.8: "every text field"). */
export function decisionTexts(fields: DecisionFields): readonly string[] {
  return Object.values(fields).flatMap((v) => texts(v));
}

/** What a record keeps inline (question 7): a non-private row's quoted and fact fields; null for a private-state row, which
 *  keeps refs only. */
export function decisionInlineOf(row: DecisionRowId, fields: DecisionFields): DecisionFields | null {
  const q = DECISION_QUESTIONS[row];
  if (q.privateState) return null;
  const out: Record<string, string | readonly string[]> = {};
  for (const d of q.fields) {
    const v = fields[d.name];
    if (d.kind !== 'ref' && v !== undefined) out[d.name] = v;
  }
  return out;
}

/** Whether the adapter `modelFor` built is the host the call planned with (question 1, review 2262 F9). */
export function sameDecisionHost(model: { kind: DecisionHostKind; origin: string }, host: { kind: DecisionHostKind; origin: string }): boolean {
  return model.kind === host.kind && model.origin === host.origin;
}

// ── addresses ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ipv4 = (s: string): number[] | null => {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
};

/** Eight 16-bit groups, `::` and a trailing dotted IPv4 understood; null for anything else. */
const ipv6 = (s: string): number[] | null => {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return null;
  let head = s;
  let tail4: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = ipv4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    tail4 = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    head = s.slice(0, lastColon + 1);
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1);
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const group = (h: string): number[] | null => {
    if (h === '') return [];
    const out: number[] = [];
    for (const g of h.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const left = group(halves[0]!);
  const right = halves.length === 2 ? group(halves[1]!) : [];
  if (left === null || right === null) return null;
  const known = left.length + right.length + tail4.length;
  if (halves.length === 1) return known === 8 ? [...left, ...tail4] : null;
  if (known > 7) return null;
  return [...left, ...Array<number>(8 - known).fill(0), ...right, ...tail4];
};

/** Loopback: 127.0.0.0/8, ::1. Private: 10/8, 172.16/12, 192.168/16, fc00::/7, fe80::/10. With `loopbackOnly`, loopback
 *  alone. An IPv4-mapped IPv6 address is read as its IPv4 address. Anything unparseable, a name included, is false. */
export function isPrivateAddress(address: string, loopbackOnly: boolean): boolean {
  let v4 = ipv4(address);
  if (v4 === null) {
    const v6 = ipv6(address);
    if (v6 === null) return false;
    const mapped = v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff;
    if (mapped) v4 = [v6[6]! >> 8, v6[6]! & 0xff, v6[7]! >> 8, v6[7]! & 0xff];
    else {
      if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true;
      if (loopbackOnly) return false;
      return (v6[0]! & 0xfe00) === 0xfc00 || (v6[0]! & 0xffc0) === 0xfe80;
    }
  }
  if (v4[0] === 127) return true;
  if (loopbackOnly) return false;
  return v4[0] === 10 || (v4[0] === 172 && v4[1]! >= 16 && v4[1]! <= 31) || (v4[0] === 192 && v4[1] === 168);
}

// ── the request ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The wire request (question 2, as read from the published reference): the model, the state, and the questions keyed by
 *  an opaque id. Declared here, where the encoder makes it; the port (`decisionModelPort.ts`) carries it. */
export interface DecisionWireRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, { type: 'noul' | 'choice'; instructions: string; criteria?: unknown }>;
}

/** One question key of a request: its row, its order, and for a choice the opaque option ids mapped back to programme
 *  slugs, with the opaque id of its `none` option apart (so a slug can never read as `none`). A yes-or-no key has no
 *  options and `none: null`. */
export interface DecisionQuestionKey {
  readonly row: DecisionRowId;
  readonly order: 'a' | 'b';
  readonly options: ReadonlyMap<string, string>;
  readonly none: string | null;
}

export type DecisionEncoded =
  | { body: DecisionWireRequest; keys: ReadonlyMap<string, DecisionQuestionKey> }
  | { refused: 'over-size' | 'missing-field'; row: DecisionRowId };

const NO_OPTIONS: ReadonlyMap<string, string> = new Map();

/** The request for one `askedWith` group, from catalogue text and typed fields only. Opaque ids come from the caller's
 *  `Entropy`; running out of them, or rows from two groups, is the caller's bug and throws. The routing rows' state is
 *  `request`, and `candidates` (the shortlist's slugs) with `goals` (each one's text, in the same order): each candidate
 *  goes under an opaque option id carrying its goals as `quoted`. A both-order yes-or-no row's first two fields go under
 *  opaque labels, which its two questions name in swapped order. */
export function encodeDecisionRequest(rows: readonly DecisionRowId[], fields: ReadonlyMap<DecisionRowId, DecisionFields>,
  modelId: string, opaque: readonly string[]): DecisionEncoded {
  const lead = rows[0];
  if (lead === undefined) throw new Error('encodeDecisionRequest: no rows');
  const group = DECISION_QUESTIONS[lead].askedWith;
  if (rows.some((r) => !group.includes(r))) throw new Error('encodeDecisionRequest: rows of more than one askedWith group');
  let next = 0;
  const take = (): string => {
    const id = opaque[next++];
    if (id === undefined) throw new Error('encodeDecisionRequest: opaque ids ran out');
    return id;
  };
  for (const r of rows) {
    const f = fields.get(r) ?? {};
    if (DECISION_QUESTIONS[r].fields.some((d) => d.required && isEmpty(f[d.name]))) return { refused: 'missing-field', row: r };
    if (Object.values(f).some((v) => texts(v).some((t) => t.length > DECISION_FIELD_MAX_CHARS))) return { refused: 'over-size', row: r };
  }
  const q0 = DECISION_QUESTIONS[lead];
  const f0 = fields.get(lead) ?? {};
  const state: Record<string, unknown> = {};
  const encode = (kind: 'ref' | 'fact' | 'quoted', v: string | readonly string[]): unknown => (kind === 'quoted' ? { quoted: v } : v);
  const swapped = q0.type === 'yes-no' && q0.orders === 'both';
  const labels: string[] = [];
  const options = new Map<string, string>();
  let none: string | null = null;
  for (const [i, d] of q0.fields.entries()) {
    const v = f0[d.name];
    if (v === undefined) continue;
    if (d.name === 'goals' && 'candidates' in f0) continue;
    if (d.name === 'candidates') {
      const slugs = texts(v);
      const goals = f0['goals'] === undefined ? [] : texts(f0['goals']);
      if (goals.length !== slugs.length) return { refused: 'missing-field', row: lead };
      if (slugs.length > DECISION_SHORTLIST_MAX) return { refused: 'over-size', row: lead };
      const entries: Record<string, unknown> = {};
      for (const [j, slug] of slugs.entries()) {
        const id = take();
        options.set(id, slug);
        entries[id] = { quoted: goals[j] };
      }
      none = take();
      state['candidates'] = entries;
      continue;
    }
    if (swapped && i < 2) {
      const label = take();
      labels.push(label);
      state[label] = encode(d.kind, v);
      continue;
    }
    state[d.name] = encode(d.kind, v);
  }
  const questions: DecisionWireRequest['questions'] = {};
  const keys = new Map<string, DecisionQuestionKey>();
  for (const r of rows) {
    const q = DECISION_QUESTIONS[r];
    for (const order of q.orders === 'both' ? (['a', 'b'] as const) : (['a'] as const)) {
      const key = take();
      if (q.type === 'choice') {
        if (none === null) return { refused: 'missing-field', row: r };
        const ids = [...options.keys()];
        const criteria = Object.fromEntries((order === 'a' ? ids : [...ids].reverse()).map((id) => [id, `The programme under ${id}.`]));
        criteria[none] = 'None of the listed programmes.';
        questions[key] = { type: 'choice', instructions: q.instructions, criteria };
        keys.set(key, { row: r, order, options, none });
        continue;
      }
      let instructions = q.instructions;
      if (swapped && labels.length === 2) {
        const named = [`The ${q.fields[0]!.name} is under ${labels[0]}.`, `The ${q.fields[1]!.name} is under ${labels[1]}.`];
        instructions = `${(order === 'a' ? named : [...named].reverse()).join(' ')} ${q.instructions}`;
      }
      questions[key] = { type: 'noul', instructions, criteria: { true: q.criteria!.true, false: q.criteria!.false } };
      keys.set(key, { row: r, order, options: NO_OPTIONS, none: null });
    }
  }
  const body: DecisionWireRequest = { model: modelId, state, questions };
  if (new TextEncoder().encode(JSON.stringify(body)).length > DECISION_REQUEST_MAX_BYTES) return { refused: 'over-size', row: lead };
  return { body, keys };
}

// ── the answer ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DecisionAnswer { readonly verdict: DecisionVerdict; readonly p: number; readonly band: DecisionBand }
export type DecisionRead = ReadonlyMap<DecisionRowId, DecisionAnswer> | { malformed: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isProbability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Read every order of every row against the pinned model. A resolved model other than the pinned one, a missing key, a type
 *  that does not match the row, an option that was not offered or a probability outside 0 to 1 is `malformed`. */
export function readDecisionAnswers(keys: ReadonlyMap<string, DecisionQuestionKey>, pinnedModel: string,
  answer: unknown): DecisionRead {
  if (!isRecord(answer) || answer['model'] !== pinnedModel) return { malformed: 'model' };
  const answers = answer['answers'];
  if (!isRecord(answers)) return { malformed: 'answers' };
  const perRow = new Map<DecisionRowId, { said: string; p: number }[]>();
  for (const [key, k] of keys) {
    const a = answers[key];
    if (!isRecord(a)) return { malformed: 'missing' };
    const type = DECISION_QUESTIONS[k.row].type;
    let said: string;
    let p: unknown;
    if (type === 'yes-no') {
      if (a['type'] !== 'noul') return { malformed: 'type' };
      p = a['noul'];
      if (!isProbability(p)) return { malformed: 'probability' };
      said = p >= 0.5 ? 'yes' : 'no';
    } else {
      if (a['type'] !== 'choice') return { malformed: 'type' };
      const choice = a['choice'];
      if (typeof choice !== 'string' || (choice !== k.none && !k.options.has(choice))) return { malformed: 'option' };
      const probs = a['probabilities'];
      p = isRecord(probs) && probs[choice] !== undefined ? probs[choice] : a['confidence'];
      if (!isProbability(p)) return { malformed: 'probability' };
      said = choice === k.none ? 'none' : `option:${k.options.get(choice)!}`;
    }
    const list = perRow.get(k.row) ?? [];
    list.push({ said, p: p as number });
    perRow.set(k.row, list);
  }
  const out = new Map<DecisionRowId, DecisionAnswer>();
  for (const [row, orders] of perRow) {
    const ps = orders.map((o) => o.p);
    const agree = orders.every((o) => o.said === orders[0]!.said);
    let verdict: DecisionVerdict;
    let p: number;
    if (DECISION_QUESTIONS[row].type === 'yes-no') {
      verdict = !agree ? 'unsure' : orders[0]!.said === 'yes' ? 'yes' : 'no';
      p = verdict === 'no' ? Math.max(...ps) : Math.min(...ps);
    } else {
      const said = orders[0]!.said;
      verdict = !agree ? 'unsure' : said === 'none' ? 'none' : { option: said.slice('option:'.length) };
      p = Math.min(...ps);
    }
    out.set(row, { verdict, p, band: bandOf(p) });
  }
  return out;
}

// ── the check ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A row that made no answer: a skip, a refused request, or a failed call, with the attempts it made and its time. */
export function decisionMissCheck(row: DecisionRowId, outcome: Exclude<DecisionCheck['outcome'], 'answered'>,
  why: string | null, ms: number, attempts: number): DecisionCheck {
  return { row, outcome, why, ms, attempts };
}

/** What a failed call answers, kept word for word: the port already said why. */
export function decisionCallMiss(row: DecisionRowId, call:
  | { outcome: 'unavailable'; why: string; ms: number; attempts: number }
  | { outcome: 'auth-failed' | 'refused' | 'over-size'; ms: number; attempts: number }
  | { outcome: 'malformed'; why: string; ms: number; attempts: number }): DecisionCheck {
  return decisionMissCheck(row, call.outcome, 'why' in call ? call.why : null, call.ms, call.attempts);
}
