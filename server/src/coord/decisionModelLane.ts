// Overlord W2, the decision model's anchor-set lane (spec 2026-11-09 §3.7 H6, Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 9, questions 4, 8 and 10). Ring: L4, context
// Coordination (C5): a `LANE_SCHEDULE` row run by `FleetWatcher.runLane`, never a timer of its own. It decides nothing: each
// branch is an answer of `decisionLines.ts` or `decisionModel.ts` (L1), and each write is the store's one writer (L3).
//
// ONE CALLER. Every ask goes through `decisionModelAsk.ts#gatherDecisions` with `fresh: true` and `kind: 'maintain'`, so it
// takes the same plan rows a serve ask does: an off row, a held gate, a private-state row on a hosted host, the egress screen
// (rebuilt labelled cases and canary states included), and the maintenance cap. The lane never calls the port itself.
//
// A PASS, per row that is not off, in four steps (each stops on its own, and the next goes on):
//   1. LINE KEY. An armed row whose line is no longer under today's host kind, origin, model and revision is held (`line-key`).
//   2. ANCHORS. The row's 20 anchors are asked; with all 20 answered, today's bands are written to `decision_days`, and a drift
//      from the baseline (the armed gate's own line's, else the current line's) holds an armed row (`drift`). A partial set is
//      never a baseline or a drift reading: one unanswered anchor writes nothing.
//   3. ADMISSION. Labelled cases are rebuilt through `DecisionStateReads` and asked; `admitLine` admits a line, written with
//      today's bands as its baseline. An armed gate is only OFFERED a newer line (the read shows it; the operator's tap takes
//      it). A gate whose armed line's own bound fails on today's answers is held (`bound`).
//   4. CANARY. A line whose canary is not complete is asked on: pair `i` is case `floor(i / 5)` with override `i % 5`, up to the
//      maintenance cap, and it resumes the next day where it stopped. An armed row whose line's canary is `unmet` is held.
// The lane writes nothing else and sends no mail. A throw in one row is logged and the next row goes on.
import {
  DECISION_CANARY_OVERRIDES, DECISION_QUESTIONS, DECISION_ROW_IDS,
  type DecisionBand, type DecisionCheck, type DecisionHeldCause, type DecisionRowId, type DecisionRowSide,
} from '../../../shared/decisionModel.js';
import type { TimePorts } from '../time/ports.js';
import { DECISION_ANCHORS } from './decisionAnchors.js';
import {
  admitLine, anchorDrift, armedAndFree, armedLineBoundFails, canaryCrossed, canaryVerdict, heldOnHostChange, isDecisionGate,
  lineUnderKey, type LabelledAnswer,
} from './decisionLines.js';
import { decisionDayOf, sameDecisionHost, type DecisionFields } from './decisionModel.js';
import { gatherDecisions, type DecisionAskDeps } from './decisionModelAsk.js';
import type { DecisionArmingStore, DecisionLineKey, DecisionLineRow, DecisionStateReads, LabelledCases } from './decisionModelPort.js';

/** What the composition root builds once (`index.ts`) and `Deps.decisions` carries. */
export interface DecisionDeps {
  ask: DecisionAskDeps;
  /** The label queue fills it (question 8); `index.ts` passes an empty source until then. */
  labels: LabelledCases;
  states: DecisionStateReads;
  /** The arming store over coord.db and the authority journal (`decisionModelStore.ts#decisionArmingStore`), which the doors
   *  use too. */
  store: DecisionArmingStore;
}
export interface DecisionLaneDeps extends DecisionDeps {
  time: TimePorts;
  log: (line: string) => void;
}

type Answered = Extract<DecisionCheck, { outcome: 'answered' }>;
/** A labelled case, rebuilt: its state and its label. */
interface Rebuilt { fields: DecisionFields; label: LabelledAnswer['label'] }

const keyOf = (store: DecisionArmingStore, row: DecisionRowId): DecisionLineKey | null => {
  const h = store.hostRead();
  return h.kind === 'host' ? { hostKind: h.host.kind, origin: h.host.origin, modelId: h.host.modelId, revision: DECISION_QUESTIONS[row].revision } : null;
};

/** One maintenance ask of one state, answered only when it is an answer under the pass's own host and model (a host that
 *  changed mid-pass makes the answer another key's), else null. */
async function askState(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey, fields: DecisionFields): Promise<Answered | null> {
  const [c] = await gatherDecisions(deps.ask, { rows: [row], fields: new Map([[row, fields]]), refs: new Map(), kind: 'maintain', fresh: true });
  if (c === undefined || c.outcome !== 'answered') return null;
  return sameDecisionHost({ kind: c.hostKind, origin: c.origin }, { kind: key.hostKind, origin: key.origin }) && c.modelId === key.modelId ? c : null;
}

/** Hold a row when `when` says its side, read now, should be: the store's one writer, in a `tx()`, as the server. */
function holdIf(deps: DecisionLaneDeps, row: DecisionRowId, cause: DecisionHeldCause, when: (side: DecisionRowSide) => boolean): void {
  const side = deps.store.rowSide(row);
  if (!when(side)) return;
  const moved = deps.store.move({
    row, expected: side, to: { ...side, held: true }, heldCause: cause, actor: 'server', at: deps.time.clock.wall(),
    opKey: `dm-${deps.time.entropy.hex(16)}`,
  });
  if (!moved.ok) deps.log(`ccrc-server: decision anchors: ${row} was not held (${cause}): ${moved.error}`);
}

/** Step 1. A gate's line is its `armedLine`; an advice row's is its current line under today's key. No host reads as not
 *  under today's key. */
function lineKeyStep(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey | null): void {
  const side = deps.store.rowSide(row);
  const line = isDecisionGate(row)
    ? (side.armedLine === null ? null : deps.store.lineById(side.armedLine.id))
    : (key === null ? null : deps.store.currentLine(row, key));
  const under = lineUnderKey(line, key);
  holdIf(deps, row, 'line-key', (s) => heldOnHostChange(s, under));
}

/** Step 2. Today's 20 bands, or null when any anchor went unanswered (nothing is written then). */
async function anchorsStep(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey): Promise<readonly DecisionBand[] | null> {
  const bands: DecisionBand[] = [];
  for (const a of DECISION_ANCHORS[row]) {
    const answered = await askState(deps, row, key, a.fields);
    if (answered === null) return null;
    bands.push(answered.band);
  }
  const side = deps.store.rowSide(row);
  const armedRow = isDecisionGate(row) && side.mode === 'armed' && side.armedLine !== null ? deps.store.lineById(side.armedLine.id) : null;
  const baseline = (armedRow ?? deps.store.currentLine(row, key))?.baseline ?? null;
  const drift = baseline !== null && anchorDrift(baseline, bands);
  deps.store.recordAnchorRun(row, decisionDayOf(deps.time.clock.wall()), bands, drift);
  if (drift) holdIf(deps, row, 'drift', armedAndFree);
  return bands;
}

/** The row's labelled cases with their states rebuilt, the unresolvable ones left out and counted in one log line. */
function rebuiltCases(deps: DecisionLaneDeps, row: DecisionRowId): readonly Rebuilt[] {
  const cases = deps.labels.casesFor(row, DECISION_QUESTIONS[row].revision);
  const out: Rebuilt[] = [];
  for (const c of cases) {
    const fields = deps.states.fieldsOf(row, c.refs, c.inline);
    if (fields !== 'unresolvable') out.push({ fields, label: c.label });
  }
  if (out.length < cases.length) deps.log(`ccrc-server: decision anchors: ${row}: ${cases.length - out.length} labelled case(s) unresolvable, left out`);
  return out;
}

/** Step 3. Re-asks every labelled case when there is no current line under today's key or its canary set no longer matches the
 *  cases, admits a line when `admitLine` does, and holds an armed gate whose own line's bound fails on today's answers. */
async function admissionStep(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey, bands: readonly DecisionBand[],
  cases: readonly Rebuilt[], plain: Map<number, Answered>): Promise<void> {
  const q = DECISION_QUESTIONS[row];
  const expected = cases.length * DECISION_CANARY_OVERRIDES.length;
  const current = deps.store.currentLine(row, key);
  if (cases.length === 0 || (current !== null && current.canaryExpected === expected)) return;
  const answers: LabelledAnswer[] = [];
  for (const [i, c] of cases.entries()) {
    const a = await askState(deps, row, key, c.fields);
    if (a === null) return;
    plain.set(i, a);
    answers.push({ p: a.p, verdict: a.verdict, label: c.label });
  }
  const admitted = admitLine(q, answers);
  if (admitted.admitted) {
    deps.store.admitLine({ row, revision: key.revision, hostKind: key.hostKind, origin: key.origin, modelId: key.modelId,
      line: admitted.line, labelled: admitted.labelled, errors: admitted.errors, bound: admitted.bound, canaryExpected: expected,
      baseline: bands, admittedAt: deps.time.clock.wall() });
  }
  holdIf(deps, row, 'bound', (s) => armedLineBoundFails(q, s, answers));
}

/** The state with each override appended to every attacker field (to each element of a list field). */
function perturbed(row: DecisionRowId, fields: DecisionFields, override: string): DecisionFields {
  const out: Record<string, string | readonly string[]> = { ...fields };
  for (const name of DECISION_QUESTIONS[row].attackerFields) {
    const v = fields[name];
    if (v !== undefined) out[name] = typeof v === 'string' ? `${v}\n${override}` : v.map((t) => `${t}\n${override}`);
  }
  return out;
}

/** One line's canary, on from where it stopped: pair `i` is case `floor(i / 5)` under override `i % 5`. Each answered pair is
 *  recorded, so a stop (the cap, an unanswered ask) leaves the count it reached. */
async function canaryLine(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey, line: DecisionLineRow,
  cases: readonly Rebuilt[], plain: Map<number, Answered>): Promise<void> {
  const q = DECISION_QUESTIONS[row];
  let asked = line.canaryAsked;
  let crossed = line.canaryCrossed;
  const open = (): boolean => asked < line.canaryExpected && ['not-run', 'incomplete'].includes(canaryVerdict(asked, crossed, line.canaryExpected));
  while (open()) {
    const idx = Math.floor(asked / DECISION_CANARY_OVERRIDES.length);
    const c = cases[idx];
    if (c === undefined) return;
    let base = plain.get(idx) ?? null;
    if (base === null) {
      base = await askState(deps, row, key, c.fields);
      if (base === null) return;
      plain.set(idx, base);
    }
    const moved = await askState(deps, row, key, perturbed(row, c.fields, DECISION_CANARY_OVERRIDES[asked % DECISION_CANARY_OVERRIDES.length]!));
    if (moved === null) return;
    if (canaryCrossed(q, line.line, base.verdict, base.p, moved.verdict, moved.p)) crossed++;
    asked++;
    deps.store.recordCanary(line.id, asked, crossed);
  }
}

/** Step 4. The current line under today's key, and an armed gate's own line when it is another; then an armed row whose line's
 *  canary is `unmet` is held. */
async function canaryStep(deps: DecisionLaneDeps, row: DecisionRowId, key: DecisionLineKey, cases: readonly Rebuilt[],
  plain: Map<number, Answered>): Promise<void> {
  const side = deps.store.rowSide(row);
  const gate = isDecisionGate(row);
  const armedId = gate && side.mode === 'armed' ? (side.armedLine?.id ?? null) : null;
  const ids = new Set<number>();
  const current = deps.store.currentLine(row, key);
  if (current !== null) ids.add(current.id);
  if (armedId !== null) ids.add(armedId);
  for (const id of ids) {
    const line = deps.store.lineById(id);
    if (line !== null && lineUnderKey(line, key)) await canaryLine(deps, row, key, line, cases, plain);
  }
  const usedId = armedId ?? current?.id ?? null;
  const used = usedId === null ? null : deps.store.lineById(usedId);
  if (used !== null && canaryVerdict(used.canaryAsked, used.canaryCrossed, used.canaryExpected) === 'unmet') holdIf(deps, row, 'canary', armedAndFree);
}

async function passRow(deps: DecisionLaneDeps, row: DecisionRowId): Promise<void> {
  const key = keyOf(deps.store, row);
  lineKeyStep(deps, row, key);
  if (key === null) return;
  const bands = await anchorsStep(deps, row, key);
  const cases = rebuiltCases(deps, row);
  const plain = new Map<number, Answered>();
  if (bands !== null) await admissionStep(deps, row, key, bands, cases, plain);
  await canaryStep(deps, row, key, cases, plain);
}

/** One daily pass over every row that is not off. A throw in one row is logged and the lane goes on to the next. */
export async function runDecisionAnchorLane(deps: DecisionLaneDeps): Promise<void> {
  for (const row of DECISION_ROW_IDS) {
    if (deps.store.rowSide(row).mode === 'off') continue;
    try {
      await passRow(deps, row);
    } catch (err) {
      deps.log(`ccrc-server: decision anchors: ${row}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
