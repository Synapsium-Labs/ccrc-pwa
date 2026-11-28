// The relay door's and the nudge door's body grammar (Overlord W2 relay plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-relay.md`, Task A1; Table 3, RL9, RL14, RL15). Ring L1, context C5
// (Coordination). Pure: no I/O, no clock. Its first callers are the relay door (Task A4) and the nudge door (Task A5); nothing
// calls it at this tip (`relay-callers.test.ts`).
//
// A CLOSED SET OF REFUSALS. A body is refused with one word of `RELAY_BODY_WHY_MAP` and the field it was read at, a name from
// the body's own key list, never a key or a value the caller sent. A done test the done tests' parser refuses carries that
// parser's own word beside `done-test` (RL14). The door answers every refusal `bad-request` (Table 3: a part over its cap
// "fails the door's body shape like any malformed body").
//
// REBUILT AS A LITERAL. An accepted body is a new object, built field by field from what was read, typed `RelayBody` or
// `NudgeBody`: a field added to the type is a compile error at the literal until this file computes it, and nothing the caller
// sent rides along. The done test is `parseDoneTest`'s rebuilt value and each expected path its normalised form.
//
// TEXT IS DATA. The part and the why are bounded and may hold no control character but a line break or a tab, and no
// line-separator or bidirectional-format character, so nothing in them can move a terminal's cursor or reorder what a reader
// sees. Rendering them as data is `relay.ts#renderRelayBody`'s job.
import { shapeProgramSlug } from '../../../shared/api.js';
import type { DoneTest } from '../../../shared/doneTests.js';
import {
  RELAY_BOUNDS, REQUEST_BOUNDS, isRelayMove, type ExpectedPath, type RelayMove,
} from '../../../shared/overlordRequests.js';
import { normalizeClaimPath } from './claims.js';
import { parseDoneTest, type DoneTestRefusal } from './doneTests.js';

/** The relay door's body (Table 3), as accepted. `owner` is null only on a `re-relay` that names none (the row's owner stands);
 *  `expectedPaths` is null when absent (the row's stand). */
export interface RelayBody {
  readonly move: RelayMove; readonly requestId: number; readonly revision: number; readonly owner: string | null;
  readonly doneTest: DoneTest; readonly expectedPaths: readonly ExpectedPath[] | null;
  readonly part: string; readonly why: string; readonly widens: boolean; readonly entries: readonly number[];
}
/** The nudge door's body (§4): no done test, no owner, no paths and no widening. */
export interface NudgeBody {
  readonly requestId: number; readonly revision: number; readonly part: string; readonly why: string;
  readonly entries: readonly number[];
}

/** Why a body was refused: one word, never text the caller sent. */
const RELAY_BODY_WHY_MAP = {
  'not-an-object': 'the body is not a plain JSON object',
  'unknown-key': 'a key the body does not name',
  missing: 'a field the body requires is absent',
  'wrong-type': 'a field has the wrong type',
  'over-bound': 'a field passes its bound',
  empty: 'a text that must hold something is empty',
  'bad-slug': 'the owner is not a programme slug',
  'bad-path': 'an expected path that claim paths refuse: absolute, empty, or with a dot segment',
  'control-character': 'a text holds a control, line-separator or bidirectional-format character',
  repeated: 'an expected path or a cited entry named twice',
  'not-on-move': 'a field this move may not carry',
  'done-test': 'the done tests parser refused the done test; its word is beside it',
} as const;
export type RelayBodyWhy = keyof typeof RELAY_BODY_WHY_MAP;
export const RELAY_BODY_WHYS = Object.keys(RELAY_BODY_WHY_MAP) as RelayBodyWhy[];
export const isRelayBodyWhy = (v: unknown): v is RelayBodyWhy => typeof v === 'string' && Object.hasOwn(RELAY_BODY_WHY_MAP, v);

/** The relay's keys, in Table 3's order: the only keys a relay body may carry, and the only field names a refusal names. */
const RELAY_KEYS = ['move', 'requestId', 'revision', 'owner', 'doneTest', 'expectedPaths', 'part', 'why', 'widens', 'entries'] as const;
/** The nudge's keys (§4). */
const NUDGE_KEYS = ['requestId', 'revision', 'part', 'why', 'entries'] as const;
/** A field a refusal names: a key of either body, or one of an expected path's two. */
export type RelayBodyField = (typeof RELAY_KEYS)[number] | 'expectedPaths.project' | 'expectedPaths.path';

export type BodyRefusal = {
  readonly ok: false; readonly why: RelayBodyWhy; readonly field: RelayBodyField | null;
  /** The done tests parser's own word, exactly when `why` is `done-test`. */
  readonly doneTest: DoneTestRefusal | null;
};
export type RelayBodyParse = { readonly ok: true; readonly body: RelayBody } | BodyRefusal;
export type NudgeBodyParse = { readonly ok: true; readonly body: NudgeBody } | BodyRefusal;

/** The detail the door answers beside `bad-request`: `done-test:<its word>`, `<why>:<field>`, or the why alone. */
export function relayBodyDetail(r: BodyRefusal): string {
  if (r.why === 'done-test') return `done-test:${r.doneTest ?? 'unknown'}`;
  return r.field === null ? r.why : `${r.why}:${r.field}`;
}

// ------------------------------------------------------------------------------------------------------------- the readers

/** A field's value, or why it cannot be one. Each reader is total over `unknown`. */
type Read<T> = { readonly ok: true; readonly v: T } | { readonly ok: false; readonly why: RelayBodyWhy };
const bad = (why: RelayBodyWhy): { readonly ok: false; readonly why: RelayBodyWhy } => ({ ok: false, why });
const good = <T>(v: T): { readonly ok: true; readonly v: T } => ({ ok: true, v });

/** A plain object: `{}` or a parsed JSON object, never an array, a class instance or a null. */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** C0 and C1 controls but the tab and the line break; the line and paragraph separators; the bidirectional embeddings,
 *  overrides and isolates. A part or a why may span lines. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
/** The same, with no exception: a project or a path is one line, so a tab or a line break in one refuses too. */
const LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F\u{2028}\u{2029}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** A text of 1 to `max` UTF-16 units (the request record's measure) with no control character. */
function readText(v: unknown, max: number): Read<string> {
  if (typeof v !== 'string') return bad('wrong-type');
  if (v.length === 0) return bad('empty');
  if (v.length > max) return bad('over-bound');
  if (CONTROL.test(v)) return bad('control-character');
  return good(v);
}

const readPositiveId = (v: unknown): Read<number> =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? good(v) : bad('wrong-type'));
const readRevision = (v: unknown): Read<number> =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? good(v) : bad('wrong-type'));

/** A programme slug exactly as the programme ingress shapes it: no trimming here, so ` a` is refused, never read as `a`. */
function readSlug(v: unknown): Read<string> {
  if (typeof v !== 'string') return bad('wrong-type');
  if (v === '') return bad('empty');
  const shaped = shapeProgramSlug(v);
  return shaped.ok && shaped.slug === v ? good(v) : bad('bad-slug');
}

/** The cited entries (RL9): at most `RELAY_BOUNDS.entries` distinct positive ids. */
function readEntries(v: unknown): Read<readonly number[]> {
  if (!Array.isArray(v)) return bad('wrong-type');
  if (v.length > RELAY_BOUNDS.entries) return bad('over-bound');
  const out: number[] = [];
  for (const e of v) {
    const id = readPositiveId(e);
    if (!id.ok) return id;
    if (out.includes(id.v)) return bad('repeated');
    out.push(id.v);
  }
  return good(out);
}

type PathRead = { readonly ok: true; readonly v: readonly ExpectedPath[] }
  | { readonly ok: false; readonly why: RelayBodyWhy; readonly field: RelayBodyField };

/** The expected paths (RQ3, RQ16): at most `REQUEST_BOUNDS.expectedPaths` entries of exactly `{ project, path }`, each string
 *  at most `REQUEST_BOUNDS.pathBytes` UTF-8 bytes with no control character, the path normalised as a claim path, no two
 *  alike once normalised. */
function readPaths(v: unknown): PathRead {
  const at = (why: RelayBodyWhy, field: RelayBodyField): PathRead => ({ ok: false, why, field });
  if (!Array.isArray(v)) return at('wrong-type', 'expectedPaths');
  if (v.length > REQUEST_BOUNDS.expectedPaths) return at('over-bound', 'expectedPaths');
  const out: ExpectedPath[] = [];
  for (const e of v) {
    if (!isPlainObject(e)) return at('wrong-type', 'expectedPaths');
    if (Object.keys(e).some((k) => k !== 'project' && k !== 'path')) return at('unknown-key', 'expectedPaths');
    if (!Object.hasOwn(e, 'project')) return at('missing', 'expectedPaths.project');
    if (!Object.hasOwn(e, 'path')) return at('missing', 'expectedPaths.path');
    const project = readPathText(e.project);
    if (!project.ok) return at(project.why, 'expectedPaths.project');
    const raw = readPathText(e.path);
    if (!raw.ok) return at(raw.why, 'expectedPaths.path');
    const path = normalizeClaimPath(raw.v);
    if (path === null) return at('bad-path', 'expectedPaths.path');
    if (out.some((x) => x.project === project.v && x.path === path)) return at('repeated', 'expectedPaths');
    out.push({ project: project.v, path });
  }
  return { ok: true, v: out };
}

function readPathText(v: unknown): Read<string> {
  if (typeof v !== 'string') return bad('wrong-type');
  if (v === '') return bad('empty');
  if (utf8Bytes(v) > REQUEST_BOUNDS.pathBytes) return bad('over-bound');
  if (LINE_CONTROL.test(v)) return bad('control-character');
  return good(v);
}

// ------------------------------------------------------------------------------------------------------------- the parsers

const refuse = (why: RelayBodyWhy, field: RelayBodyField | null, doneTest: DoneTestRefusal | null = null): BodyRefusal =>
  ({ ok: false, why, field, doneTest });

/** The object and its keys, before any field: a body that is not a plain object, or that carries a key outside `keys`, is
 *  refused without naming the key. */
function shapeOf(raw: unknown, keys: readonly string[]):
  BodyRefusal | { readonly ok: true; readonly obj: Readonly<Record<string, unknown>> } {
  if (!isPlainObject(raw)) return refuse('not-an-object', null);
  if (Object.keys(raw).some((k) => !keys.includes(k))) return refuse('unknown-key', null);
  return { ok: true, obj: raw };
}

/** The part and the why, which both bodies carry, in Table 3's order. */
function textsOf(o: Readonly<Record<string, unknown>>):
  BodyRefusal | { readonly ok: true; readonly part: string; readonly why: string } {
  if (!Object.hasOwn(o, 'part')) return refuse('missing', 'part');
  const part = readText(o.part, RELAY_BOUNDS.partChars);
  if (!part.ok) return refuse(part.why, 'part');
  if (!Object.hasOwn(o, 'why')) return refuse('missing', 'why');
  const why = readText(o.why, RELAY_BOUNDS.whyChars);
  if (!why.ok) return refuse(why.why, 'why');
  return { ok: true, part: part.v, why: why.v };
}

/** The relay door's body (Table 3), first refusal in Table 3's order: the object, its keys, then each field. */
export function parseRelayBody(raw: unknown): RelayBodyParse {
  const shaped = shapeOf(raw, RELAY_KEYS);
  if (!shaped.ok) return shaped;
  const obj = shaped.obj;
  if (!Object.hasOwn(obj, 'move')) return refuse('missing', 'move');
  if (!isRelayMove(obj.move)) return refuse('wrong-type', 'move');
  const move = obj.move;
  if (!Object.hasOwn(obj, 'requestId')) return refuse('missing', 'requestId');
  const requestId = readPositiveId(obj.requestId);
  if (!requestId.ok) return refuse(requestId.why, 'requestId');
  if (!Object.hasOwn(obj, 'revision')) return refuse('missing', 'revision');
  const revision = readRevision(obj.revision);
  if (!revision.ok) return refuse(revision.why, 'revision');
  let owner: string | null = null;
  if (Object.hasOwn(obj, 'owner')) {
    const read = readSlug(obj.owner);
    if (!read.ok) return refuse(read.why, 'owner');
    owner = read.v;
  } else if (move !== 're-relay') return refuse('missing', 'owner');
  if (!Object.hasOwn(obj, 'doneTest')) return refuse('missing', 'doneTest');
  const doneTest = parseDoneTest(obj.doneTest);
  if (!doneTest.ok) return refuse('done-test', 'doneTest', doneTest.why);
  let expectedPaths: readonly ExpectedPath[] | null = null;
  if (Object.hasOwn(obj, 'expectedPaths')) {
    const read = readPaths(obj.expectedPaths);
    if (!read.ok) return refuse(read.why, read.field);
    expectedPaths = read.v;
  }
  const texts = textsOf(obj);
  if (!texts.ok) return texts;
  let widens = false;
  if (Object.hasOwn(obj, 'widens')) {
    if (typeof obj.widens !== 'boolean') return refuse('wrong-type', 'widens');
    if (obj.widens && move === 're-relay') return refuse('not-on-move', 'widens');
    widens = obj.widens;
  }
  const entries = entriesOf(obj);
  if (!entries.ok) return refuse(entries.why, 'entries');
  const body: RelayBody = {
    move, requestId: requestId.v, revision: revision.v, owner, doneTest: doneTest.test, expectedPaths,
    part: texts.part, why: texts.why, widens, entries: entries.v,
  };
  return { ok: true, body };
}

/** The nudge door's body (§4), first refusal in its order: the object, its keys, then each field. */
export function parseNudgeBody(raw: unknown): NudgeBodyParse {
  const shaped = shapeOf(raw, NUDGE_KEYS);
  if (!shaped.ok) return shaped;
  const obj = shaped.obj;
  if (!Object.hasOwn(obj, 'requestId')) return refuse('missing', 'requestId');
  const requestId = readPositiveId(obj.requestId);
  if (!requestId.ok) return refuse(requestId.why, 'requestId');
  if (!Object.hasOwn(obj, 'revision')) return refuse('missing', 'revision');
  const revision = readRevision(obj.revision);
  if (!revision.ok) return refuse(revision.why, 'revision');
  const texts = textsOf(obj);
  if (!texts.ok) return texts;
  const entries = entriesOf(obj);
  if (!entries.ok) return refuse(entries.why, 'entries');
  const body: NudgeBody = { requestId: requestId.v, revision: revision.v, part: texts.part, why: texts.why, entries: entries.v };
  return { ok: true, body };
}

/** `entries`, optional: absent is none. */
function entriesOf(o: Readonly<Record<string, unknown>>): Read<readonly number[]> {
  return Object.hasOwn(o, 'entries') ? readEntries(o.entries) : good([]);
}
