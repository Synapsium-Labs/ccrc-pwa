// D-8406, D-8686, D-8687, D-8693, R3b: a lane's model state as the session's model picker and the Models sheet read it
// through `GET /api/models/:lane`. Ring L3, context C1 (Fleet Registry & Accounts). Never rejects.
//
// THE OP ALONE (R3b). `io.models(lane, 'show')` runs `ccrc models <lane> show` on the fleet's box (the agent's `models`
// op, or the local arm in local mode), and `readShowAnswer` reads its one JSON object: the class labels (`describe`'s
// `labels`, which `laneClassModels` built on that box) and the lane's advance state (`LaneAdvanceRead`). Nothing here
// reads a model file: the file-read grant (D-8406) and the files fallback (D-8688) are retired, and the agent refuses
// every file under `~/.ccrc/models`.
// Concurrent reads of one lane on one io share one op; there is no cache, so `no-store` still means "as the files are".
// The ONE exception is the read that follows an act (`{ fresh: true }`, the POST's): it starts a `show` of its own and
// never joins one already running, because a joined show may have read the lane before the act wrote (the local arm has no
// gate, and `show` takes no lane lock). Same op, same `readShowAnswer`, no second reader.
//
// EVERY OUTCOME KEEPS ITS OWN ARM (`LaneModelsRead`; the coordinator's rulings for R3b, 2026-11-18). When nothing ran,
// the seam's word is the answer: `unsupported` (an agent that predates the op, or the bare local io), `not-started`,
// `refused` (with the builder's `why`) and `busy` (transient: the next read asks again). An op that RAN and gave no usable
// answer (`timeout`, `too-large`, `lost`, a stdout off the grammar) is `unreadable`: it may have run a verb whose state
// is unknown. A `show` refusal the retired files path used to answer past (`CARRIED_CODES`), and `ccrc` dying before
// the lane, is `unreadable` WITH the box's reason, so the sheet can name it; the argv-grammar words stay `unreadable`
// with no code (D-8693). `absent` is a lane with no class registry, with the reason `show` gave (`laneKind`), or, with
// no `laneKind`, a lane the fleet box's roster does not have (`no-such-account`). Nothing here
// names a model.
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import { ADVANCE_VERSION, AdvanceInvalid, lastMoveOf, parseAdvance } from '../../shared/model-advance.mjs';
import {
  CLASSES, type LaneAdvanceRead, type LaneClassAdvance, type LaneClassModel, type LaneModelsRead, type LaneUnreadableCode,
  type ModelClass,
} from '../../shared/models.js';
import type { FleetIO } from './io.js';

/** `show` refusals carried as `unreadable`'s `code` (R3b; D-8693 named them): the op path reads the catalogue before the
 *  registry and refuses on it, and parses the registry WITH the catalogue; it reads the fleet box's roster first
 *  (`readRoster`'s three words); and `ccd/ccrc`'s `_models_answer` refuses `no-answer` when its node half answered
 *  nothing usable. Keyed on `LaneUnreadableCode`, so the type and this table cannot disagree; `no-output` is not a
 *  word `show` prints (it is an empty stdout at exit 1) and is decided before this table is asked. */
const CARRIED_CODES: Readonly<Record<Exclude<LaneUnreadableCode, 'no-output'>, true>> = {
  'catalogue-unreadable': true, 'catalogue-invalid': true, 'registry-invalid': true, 'roster-absent': true,
  'roster-unreadable': true, 'roster-invalid': true, 'no-answer': true,
};
const isCarriedCode = (v: unknown): v is LaneUnreadableCode => typeof v === 'string' && Object.hasOwn(CARRIED_CODES, v);

/** One `show` per (io, lane) in flight; the entry goes when it settles, so the next read asks again. */
const inFlightShows = new WeakMap<FleetIO, Map<string, Promise<ModelsAsked>>>();

function showOnce(io: FleetIO, lane: string): Promise<ModelsAsked> {
  let byLane = inFlightShows.get(io);
  if (byLane === undefined) { byLane = new Map(); inFlightShows.set(io, byLane); }
  const joined = byLane.get(lane);
  if (joined !== undefined) return joined;
  const asked = io.models(lane, 'show').finally(() => { byLane.delete(lane); });
  byLane.set(lane, asked);
  return asked;
}

/** `fresh`: begin a `show` of this read's own, never joining one in flight (the read an act asks for after it ends, F2).
 *  A fresh `show` is not entered in the in-flight map either: a plain read that began after the act could share it, but
 *  the map stays the plain reads' alone.
 *
 *  WHY ITS OWN SHOW, NOT AN INVALIDATED MAP (review 2523 F3). Dropping the lane's in-flight entry when an act ends would
 *  serve the same purpose, but this is simpler and holds on both arms: the local arm has no gate, so a joined show may have
 *  read the lane before the act wrote. On the agent arm (the live setting) a GET's `show` still running when this one starts
 *  makes the agent's one models gate answer `busy`, so this read is `busy` and the 200 carries no classes (the sheet then
 *  offers no act, and says the box was busy); the sheet reads the lane again after every act, and that read recovers it. */
export interface LaneModelsReadOpts { readonly fresh?: boolean }

/** `_ccrcDir` is unread since R3b, which retired the files fallback; it stays in the signature only because callers in a
 *  test file an open pull request holds still pass it (D-8757), and goes once that pull request has landed (the plan
 *  ticket `ccrcdir-param-drop`). */
export async function readLaneModels(io: FleetIO, _ccrcDir: string, lane: string, opts: LaneModelsReadOpts = {}): Promise<LaneModelsRead> {
  let asked: ModelsAsked;
  try { asked = await (opts.fresh === true ? io.models(lane, 'show') : showOnce(io, lane)); } catch { asked = { kind: 'lost' }; }
  switch (asked.kind) {
    case 'unsupported': case 'not-started': case 'busy':
      return { kind: asked.kind };
    case 'refused':
      return { kind: 'refused', why: asked.why };
    case 'timeout': case 'too-large': case 'lost':
      return { kind: 'unreadable' };
    case 'exited':
      return readShowAnswer(lane, asked.code, asked.stdout);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** THE ONE reader of `show`'s JSON in TypeScript. Every answer off the grammar is `unreadable`, and a half view is never
 *  returned. A refusal in `CARRIED_CODES` is `unreadable` with its code, and so is `ccrc` dying before the lane
 *  (`_ccrc_die`: exit 1, nothing on stdout, since `show` prints its body unconditionally), as `no-output`. The exit code
 *  must agree with the body: an answer at 0, a refusal at 1 or 2. */
function readShowAnswer(lane: string, code: number, stdout: string): LaneModelsRead {
  if (code !== 0 && code !== 1 && code !== 2) return { kind: 'unreadable' };
  if (stdout === '' && code === 1) return { kind: 'unreadable', code: 'no-output' };
  // exactly one JSON object, with at most one trailing newline
  const body = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  if (body === '' || body.includes('\n')) return { kind: 'unreadable' };
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { kind: 'unreadable' }; }
  if (!isObj(raw)) return { kind: 'unreadable' };
  if ((raw.ok === false) !== (code !== 0)) return { kind: 'unreadable' };
  if (raw.ok === false) {
    if (raw.error === 'no-such-account') return { kind: 'absent' };
    return isCarriedCode(raw.error) ? { kind: 'unreadable', code: raw.error } : { kind: 'unreadable' };
  }
  if (raw.ok !== true || raw.op !== 'show' || raw.id !== lane) return { kind: 'unreadable' };
  // F1: `show` says why there is no registry (`anthropic`), and the answer keeps it, so a surface can tell an Anthropic
  // lane (its classes are the client's own) from one never initialised. Every `show` body has carried that boolean since
  // the registry's first plan, so one without it is off the grammar and `unreadable` (follow-up
  // transient-beside-kept-answer): an `absent` with no lane kind then has one cause only, `no-such-account` above.
  if (raw.registry === null) {
    if (raw.anthropic === true) return readAnthropicShow(raw);
    if (raw.anthropic === false) return { kind: 'absent', laneKind: 'never-made' };
    return { kind: 'unreadable' };
  }
  const reg = raw.registry;
  if (!isObj(reg) || !isObj(reg.classes) || !isObj(raw.labels)) return { kind: 'unreadable' };
  const pins = reg.classes;
  const labels = raw.labels;
  const classes = {} as Record<ModelClass, LaneClassModel>;
  for (const c of CLASSES) {
    if (!isStrOrNull(pins[c])) return { kind: 'unreadable' };
    const row = classRow(labels[c]);
    if (row === null || row.model !== pins[c]) return { kind: 'unreadable' };
    classes[c] = row;
  }
  const advance = readAdvanceReport(raw.advance);
  if (advance === null) return { kind: 'unreadable' };
  return { kind: 'read', classes, advance };
}

/** An Anthropic lane's `show` (no registry; model-class Anthropic arm A4.1): three answers for its aliases file, never one.
 *  No `aliases` key (an older op), `{state: 'absent'}`, or a parsed file beside no labels (an op older than A4.1) is
 *  `absent`, as before; `unreadable` and `invalid` are the lane's
 *  `unreadable`, the existing arm; and a parsed aliases file (no `state` key) is a lane READ, whose classes are the op's
 *  `labels` (built from that file) beside the advance report. A parsed file whose labels or advance are off the grammar is
 *  `unreadable` too: a half view is never returned. */
function readAnthropicShow(raw: Record<string, unknown>): LaneModelsRead {
  const aliases = raw.aliases;
  if (aliases === undefined) return { kind: 'absent', laneKind: 'anthropic' };
  if (!isObj(aliases)) return { kind: 'unreadable' };
  if (aliases.state !== undefined) {
    return aliases.state === 'absent' ? { kind: 'absent', laneKind: 'anthropic' } : { kind: 'unreadable' };
  }
  // An op from before Task A4.1 prints the parsed aliases file the hourly refresh wrote, but `labels: null` for a lane with no
  // registry: that lane reads as it always did, so a server rolled out before the fleet box never turns it unreadable.
  if (raw.labels === null || raw.labels === undefined) return { kind: 'absent', laneKind: 'anthropic' };
  if (!isObj(raw.labels)) return { kind: 'unreadable' };
  const classes = {} as Record<ModelClass, LaneClassModel>;
  for (const c of CLASSES) {
    const row = classRow(raw.labels[c]);
    if (row === null) return { kind: 'unreadable' };
    classes[c] = row;
  }
  const advance = readAdvanceReport(raw.advance);
  if (advance === null) return { kind: 'unreadable' };
  return { kind: 'read', classes, advance };
}

/** One class's row, built from the fields `LaneClassModel` declares, in this one place (R1's `efforts`: a string
 *  array copied, or null, an absent key read as null). `null` is a row off the grammar. The optional fields an Anthropic
 *  lane's row carries (A4.1) are each copied when well formed and left out when absent; a MALFORMED one is dropped to
 *  absent and the row is kept, since an optional field a newer op adds must never cost the lane its whole read. */
function classRow(raw: unknown): LaneClassModel | null {
  if (!isObj(raw) || !isStrOrNull(raw.model) || !isStrOrNull(raw.label)) return null;
  const e = raw.efforts;
  if (e !== undefined && e !== null && !(Array.isArray(e) && e.every((x) => typeof x === 'string'))) return null;
  const row: { -readonly [K in keyof LaneClassModel]: LaneClassModel[K] } = {
    model: raw.model, label: raw.label, efforts: Array.isArray(e) ? [...e] : null,
  };
  if (raw.takesNoEffort === true) row.takesNoEffort = true;
  if (raw.source === 'cache' || raw.source === 'use' || raw.source === null) row.source = raw.source;
  if (isStrOrNull(raw.cacheTarget)) row.cacheTarget = raw.cacheTarget;
  if (isStrOrNull(raw.seenId)) row.seenId = raw.seenId;
  if (raw.unobserved === true) row.unobserved = true;
  const u = raw.unlaunchable;
  if (isObj(u) && typeof u.needs === 'string' && isStrOrNull(u.laneVersion)) row.unlaunchable = { needs: u.needs, laneVersion: u.laneVersion };
  if (typeof raw.aliasId === 'string') row.aliasId = raw.aliasId;
  const o = raw.orphanedEffort;
  if (o === null) row.orphanedEffort = null;
  else if (isObj(o) && typeof o.id === 'string' && typeof o.level === 'string') row.orphanedEffort = { id: o.id, level: o.level };
  return row;
}

/** `show`'s `advance` key (D-5228): five states never folded; `null` is "off the grammar", and the caller then
 *  answers `unreadable` for the whole read. A state WORD this reader does not know is `invalid` with no detail, and the
 *  lane's classes are kept (R3b, the operator's ruling of 2026-11-17): it costs the advance record only. */
function readAdvanceReport(raw: unknown): LaneAdvanceRead | null {
  const none = { detail: null, pending: null, classes: null } as const;
  if (raw === undefined) return { state: 'unreported', ...none };
  if (!isObj(raw)) return null;
  switch (raw.state) {
    case 'absent':
      return { state: 'absent', ...none };
    case 'unreadable': case 'invalid':
      return { state: raw.state, detail: typeof raw.detail === 'string' ? raw.detail : null, pending: null, classes: null };
    case 'ok': {
      if (!Object.hasOwn(raw, 'pending')) return { state: 'unreported', ...none };
      let adv: ReturnType<typeof parseAdvance>;
      try {
        adv = parseAdvance({ v: ADVANCE_VERSION, classes: raw.classes, pending: raw.pending });
      } catch (e) {
        if (e instanceof AdvanceInvalid) return null;
        throw e;
      }
      const classes = {} as Record<ModelClass, LaneClassAdvance>;
      for (const c of CLASSES) {
        const a = adv.classes[c];
        classes[c] = { family: a.family, hold: a.hold, previous: a.previous, revertable: a.previous !== null, lastMove: lastMoveOf(a) };
      }
      return { state: 'ok', detail: null, pending: adv.pending, classes };
    }
    default:
      return typeof raw.state === 'string' ? { state: 'invalid', ...none } : null;
  }
}
