// D-8406, D-8686, D-8687, D-8688, D-8693: a lane's model state as the session's model picker reads it through
// `GET /api/models/:lane`. Ring L3, context C1 (Fleet Registry & Accounts). Never rejects.
//
// THE OP FIRST (D-8687). `io.models(lane, 'show')` runs `ccrc models <lane> show` on the fleet's box (the agent's
// `models` op, or the local arm in local mode), and `readShowAnswer` reads its one JSON object: the class labels
// (`describe`'s `labels`, which `laneClassModels` built on that box) and the lane's advance state (`LaneAdvanceRead`).
// Concurrent reads of one lane on one io share one op; there is no cache, so `no-store` still means "as the files are".
//
// THE FILES UNDER THE GRANT AS THE FALLBACK (D-8688, retired by R3b). When nothing ran (`unsupported`: an agent that
// predates the op; `refused`, `not-started`, `busy`), and when `show` refused on the catalogue or on the registry's
// parse WITH the catalogue (the coordinator's ruling of 2026-11-16: a lane must never become unreadable where the file
// read answers), `readLaneModelFiles` reads the registry and catalogue (`registryFileName`, `catalogueFileName` under
// `~/.ccrc/models`) through the fleet's `read` op (the agent admits exactly these two names, `isLaneModelsReadName`)
// and hands every judgement to the models kernel. Its answer carries no `advance`.
//
// The two non-readings stay two (`LaneModelsRead`): `absent` is a lane with no class registry, `unreadable` one whose
// registry exists and could not be read or parsed, or an op that RAN and gave no usable answer (`timeout`,
// `too-large`, `lost`, a stdout off the grammar), which never falls back: it may have run a verb whose state is unknown.
// Nothing here names a model.
import path from 'node:path';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import { ADVANCE_VERSION, AdvanceInvalid, lastMoveOf, parseAdvance } from '../../shared/model-advance.mjs';
import {
  CLASSES, MODELS_DIR_NAME, catalogueFileName, laneClassModels, parseCatalogue, parseRegistry, registryFileName,
  type Catalogue, type LaneAdvanceRead, type LaneClassAdvance, type LaneClassModel, type LaneModelsRead, type ModelClass,
  type Registry,
} from '../../shared/models.js';
import type { FleetIO } from './io.js';

/** `show` refusals that fall back to the files (ruling of 2026-11-16): the op path reads the catalogue before the
 *  registry and refuses on it, and parses the registry WITH the catalogue, where the files path does neither. */
const FALLBACK_REFUSALS: readonly string[] = ['catalogue-unreadable', 'catalogue-invalid', 'registry-invalid'];

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

export async function readLaneModels(io: FleetIO, ccrcDir: string, lane: string): Promise<LaneModelsRead> {
  let asked: ModelsAsked;
  try { asked = await showOnce(io, lane); } catch { asked = { kind: 'lost' }; }
  switch (asked.kind) {
    case 'unsupported': case 'refused': case 'not-started': case 'busy':
      return readLaneModelFiles(io, ccrcDir, lane);
    case 'timeout': case 'too-large': case 'lost':
      return { kind: 'unreadable' };
    case 'exited': {
      const read = readShowAnswer(lane, asked.code, asked.stdout);
      return read === 'fallback' ? readLaneModelFiles(io, ccrcDir, lane) : read;
    }
  }
}

/** The files under the D-8406 grant: the body `readLaneModels` had before the op, unchanged. */
async function readLaneModelFiles(io: FleetIO, ccrcDir: string, lane: string): Promise<LaneModelsRead> {
  const dir = path.join(ccrcDir, MODELS_DIR_NAME);
  const [reg, cat] = await Promise.all([
    io.readFileMeasured(path.join(dir, registryFileName(lane))),
    io.readFileMeasured(path.join(dir, catalogueFileName(lane))),
  ]);
  if (!reg.ok) return { kind: reg.reason === 'absent' ? 'absent' : 'unreadable' };
  let registry: Registry;
  // No catalogue handed to `parseRegistry`: with one, an effort level the classed model does not list refuses the
  // whole file, and a label read must not fail for an effort fact (the parser's own header says the same).
  try { registry = parseRegistry(JSON.parse(reg.content)); } catch { return { kind: 'unreadable' }; }
  let catalogue: Catalogue | null = null;
  if (cat.ok) {
    try { catalogue = parseCatalogue(JSON.parse(cat.content)); } catch { catalogue = null; }
  }
  return { kind: 'read', classes: laneClassModels(registry, catalogue) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** THE ONE reader of `show`'s JSON in TypeScript. `'fallback'` is one of the three `show` refusals the files path
 *  reads past (FALLBACK_REFUSALS); every other answer off the grammar is `unreadable`, and a half view is never
 *  returned. */
function readShowAnswer(lane: string, code: number, stdout: string): LaneModelsRead | 'fallback' {
  if (code !== 0 && code !== 1 && code !== 2) return { kind: 'unreadable' };
  // exactly one JSON object, with at most one trailing newline
  const body = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  if (body === '' || body.includes('\n')) return { kind: 'unreadable' };
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { kind: 'unreadable' }; }
  if (!isObj(raw)) return { kind: 'unreadable' };
  if (raw.ok === false) {
    if (raw.error === 'no-such-account') return { kind: 'absent' };
    return typeof raw.error === 'string' && FALLBACK_REFUSALS.includes(raw.error) ? 'fallback' : { kind: 'unreadable' };
  }
  if (raw.ok !== true || raw.op !== 'show' || raw.id !== lane) return { kind: 'unreadable' };
  if (raw.registry === null) return { kind: 'absent' };
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

/** One class's row, built from the fields `LaneClassModel` declares, in this one place (R1's `efforts`: a string
 *  array copied, or null, an absent key read as null). `null` is a row off the grammar. */
function classRow(raw: unknown): LaneClassModel | null {
  if (!isObj(raw) || !isStrOrNull(raw.model) || !isStrOrNull(raw.label)) return null;
  const e = raw.efforts;
  if (e !== undefined && e !== null && !(Array.isArray(e) && e.every((x) => typeof x === 'string'))) return null;
  return { model: raw.model, label: raw.label, efforts: Array.isArray(e) ? [...e] : null };
}

/** `show`'s `advance` key (D-5228): five states never folded; `null` is "off the grammar", and the caller then
 *  answers `unreadable` for the whole read. */
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
      return null;
  }
}
