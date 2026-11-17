// The decision-model port's mutant sets (Overlord W2, plan w2-decision-model.md Task 2 Step 5; the floors rule is D-8217's):
// `planDecision`, `serveCap`, `maintainCap`, `isPrivateAddress`, `isLiteralHost`, `encodeDecisionRequest`,
// `decisionRequestGroups`, `readDecisionAnswers`, `bandOf`, `applyDecision` and `gateOutcome` (PR B, Task 8), each run against
// every case of `../decisionModelCases.ts` loaded over the mutated copy of server/src/coord/decisionModel.ts; and, in a second
// module, `decisionLines.ts`'s deciders (Tasks 6 to 8), each run against `ALL_DECISION_LINES_CASES` over a mutated copy of it.
// Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json. The plan's named mutants are
// DM-PLAN-1 to DM-PLAN-10, DM-ADDR-1 and -2, DM-READ-1 and -2 and DM-BAND-1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DECISION_LINES_CASES, ALL_DECISION_MODEL_CASES, type DecisionLinesModule, type DecisionModelModule } from '../decisionModelCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const DECISION_MODEL_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/decisionModel.ts');
const K = 'server/src/coord/decisionModel.ts#';

const suite = (m: DecisionModelModule): Record<string, SuiteCase> =>
  Object.fromEntries(ALL_DECISION_MODEL_CASES.map((c) => [c.name, () => c.run(m)]));
const DECISION_LINES_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/decisionLines.ts');
const L = 'server/src/coord/decisionLines.ts#';
const linesSuite = (m: DecisionLinesModule): Record<string, SuiteCase> =>
  Object.fromEntries(ALL_DECISION_LINES_CASES.map((c) => [c.name, () => c.run(m)]));
const linesSet = (mutants: MutantSet<DecisionLinesModule>['mutants']): MutantSet<DecisionLinesModule> =>
  ({ modulePath: DECISION_LINES_TS, mutants, suite: linesSuite });
const set = (mutants: MutantSet<DecisionModelModule>['mutants']): MutantSet<DecisionModelModule> =>
  ({ modulePath: DECISION_MODEL_TS, mutants, suite });

const ROW5 = "  if (q.privateState && host.kind === 'hosted') return skip('not-asked', 'private-state-hosted');";
const ROW10 = "  if (!input.fresh && input.record !== null) return { do: 'reuse', recordId: input.record.id };";

export const DECISION_PLAN_SET = set([
  // The plan's red checks (review 2262 F19): drop rows 1, 2, 5, 8 and 9; swap rows 5 and 10; reuse when fresh; drop row 11;
  // drop the reservation term from rows 12 to 14.
  { id: 'DM-PLAN-1 drop row 1', old: "  if (side.mode === 'off') return skip('disarmed');", new: '' },
  { id: 'DM-PLAN-2 drop row 2', old: "if (q.direction === 'gate' && side.mode === 'armed' && side.held) return skip('not-asked', 'held');", new: '' },
  { id: 'DM-PLAN-3 drop row 5', old: ROW5, new: '' },
  { id: 'DM-PLAN-4 drop row 8', old: "  if (host.kind === 'hosted' && input.egress === 'hit') return skip('not-asked', 'egress-hit');", new: '' },
  { id: 'DM-PLAN-5 drop row 9', old: "  if (host.kind === 'hosted' && input.egress === 'unreadable') return skip('not-asked', 'egress-unreadable');", new: '' },
  { id: 'DM-PLAN-6 swap rows 5 and 10', old: ROW5, new: `${ROW10}\n${ROW5}` },
  { id: 'DM-PLAN-7 reuse when fresh', old: 'if (!input.fresh && input.record !== null)', new: 'if (input.record !== null)' },
  { id: 'DM-PLAN-8 drop row 11', old: "  if (!usage.measured) return skip('over-ceiling');", new: "  if (!usage.measured) return { do: 'ask' };" },
  { id: 'DM-PLAN-9 drop the reservation term', old: '  const r = DECISION_RESERVE_PER_REQUEST;', new: '  const r = 0;' },
  { id: 'DM-PLAN-10 drop the reserved count', old: 'usage.serve + usage.reserved + r', new: 'usage.serve + r' },
  { id: 'DM-PLAN-11 drop row 3', old: "  if (host === null) return skip('unavailable', 'host-unset');", new: "  if (host === null) return { do: 'ask' };" },
  { id: 'DM-PLAN-12 drop row 4', old: "  if (!input.keySet) return skip('unavailable', 'no-key');", new: '' },
  { id: 'DM-PLAN-13 drop row 6', old: "return skip('not-asked', 'missing-field');", new: "return { do: 'ask' };" },
  { id: 'DM-PLAN-14 drop the request bytes', old: 'overField || input.requestBytes > DECISION_REQUEST_MAX_BYTES', new: 'overField' },
  { id: 'DM-PLAN-15 drop row 12', old: 'if (usage.fleetTotal + r > DECISION_FLEET_DAILY_TOTAL)', new: 'if (false)' },
  { id: 'DM-PLAN-16 drop row 14', old: "input.kind === 'maintain' && usage.maintain", new: 'false && usage.maintain' },
  { id: 'DM-PLAN-17 row 2 for advice rows too', old: "q.direction === 'gate' && side.mode === 'armed' && side.held", new: "side.mode === 'armed' && side.held" },
  { id: 'DM-PLAN-18 row 7 at >=', old: 'input.requestBytes > DECISION_REQUEST_MAX_BYTES', new: 'input.requestBytes >= DECISION_REQUEST_MAX_BYTES' },
  { id: 'DM-PLAN-19 row 13 at >=', old: 'usage.serve + usage.reserved + r > serveCap(usage)', new: 'usage.serve + usage.reserved + r >= serveCap(usage)' },
]);

export const DECISION_SERVE_CAP_SET = set([
  { id: 'DM-SERVE-1 the whole ceiling', old: '  return u.ceiling - u.maintain;', new: '  return u.ceiling;' },
]);

export const DECISION_MAINTAIN_CAP_SET = set([
  { id: 'DM-MAINT-1 no half', old: 'Math.min(Math.floor(u.ceiling / 2), u.ceiling - u.serve)', new: 'u.ceiling - u.serve' },
  { id: 'DM-MAINT-2 ignore serving', old: 'Math.min(Math.floor(u.ceiling / 2), u.ceiling - u.serve)', new: 'Math.floor(u.ceiling / 2)' },
  { id: 'DM-MAINT-3 round up', old: 'Math.floor(u.ceiling / 2)', new: 'Math.ceil(u.ceiling / 2)' },
]);

export const DECISION_ADDRESS_SET = set([
  // The plan's red checks: widen 172.16/12 to /8; ignore loopbackOnly.
  { id: 'DM-ADDR-1 widen 172.16/12 to /8', old: '(v4[0] === 172 && v4[1]! >= 16 && v4[1]! <= 31)', new: '(v4[0] === 172)' },
  { id: 'DM-ADDR-2 ignore loopbackOnly', old: '  if (v4[0] === 127) return true;\n  if (loopbackOnly) return false;', new: '  if (v4[0] === 127) return true;' },
  { id: 'DM-ADDR-3 ignore loopbackOnly on IPv6', old: '      if (loopbackOnly) return false;\n', new: '' },
  { id: 'DM-ADDR-4 no mapped form', old: 'v6[5] === 0xffff', new: 'false' },
  { id: 'DM-ADDR-5 fe80::/9', old: '(v6[0]! & 0xffc0) === 0xfe80', new: '(v6[0]! & 0xff80) === 0xfe80' },
  { id: 'DM-ADDR-6 fc00::/8', old: '(v6[0]! & 0xfe00) === 0xfc00', new: '(v6[0]! & 0xff00) === 0xfc00' },
  { id: 'DM-ADDR-7 a leading zero', old: "/^(?:0|[1-9][0-9]{0,2})$/", new: "/^[0-9]{1,3}$/" },
  { id: 'DM-ADDR-8 any ::x is loopback', old: '&& v6[7] === 1) return true;', new: ') return true;' },
]);

export const DECISION_ENCODE_SET = set([
  { id: 'DM-ENC-1 quoted sent bare', old: "(kind === 'quoted' ? { quoted: v } : v)", new: 'v' },
  { id: 'DM-ENC-2 the slug as the option id', old: '        const id = take();\n        options.set(id, slug);', new: '        const id = slug;\n        options.set(id, slug);' },
  { id: 'DM-ENC-3 no shortlist cap', old: 'if (slugs.length > DECISION_SHORTLIST_MAX)', new: 'if (false)' },
  { id: 'DM-ENC-4 no reversed order', old: "(order === 'a' ? ids : [...ids].reverse())", new: 'ids' },
  { id: 'DM-ENC-5 no swapped pair', old: "(order === 'a' ? named : [...named].reverse())", new: 'named' },
  { id: 'DM-ENC-6 the pair under its own names', old: '    if (swapped && i < 2) {', new: '    if (false) {' },
  { id: 'DM-ENC-7 no byte cap', old: '.length > DECISION_REQUEST_MAX_BYTES) return { refused', new: '.length > Infinity) return { refused' },
  { id: 'DM-ENC-8 no field cap', old: "if (overFieldCap(r, f)) return { refused: 'over-size', row: r };", new: "if (false) return { refused: 'over-size', row: r };" },
  { id: 'DM-ENC-9 no group check', old: "  if (rows.some((r) => !group.includes(r))) throw", new: '  if (false) throw' },
  { id: 'DM-ENC-10 one order only', old: "q.orders === 'both' ? (['a', 'b'] as const) : (['a'] as const)", new: "(['a'] as const)" },
  { id: 'DM-ENC-11 goals list unchecked', old: 'if (goals.length !== slugs.length)', new: 'if (false)' },
  // Review 2324 F6: a fact capped as a short server-made value; duplicate opaque ids; a required list holding an empty text.
  { id: 'DM-ENC-12 facts take the field cap', old: "?.kind === 'fact' ? DECISION_FACT_MAX_CHARS : DECISION_FIELD_MAX_CHARS", new: "?.kind === 'fact' ? DECISION_FIELD_MAX_CHARS : DECISION_FIELD_MAX_CHARS" },
  { id: 'DM-ENC-13 duplicate opaque ids', old: '  if (new Set(opaque).size !== opaque.length) throw', new: '  if (false) throw' },
  { id: 'DM-ENC-14 an empty text in a list', old: 'v.length === 0 || v.some((t) => t.length === 0)', new: 'v.length === 0' },
]);

export const DECISION_GROUP_SET = set([
  // Review 2324 F1: the screen, the key, the size and the send read one state. Grouping by the lead alone screens the lead's
  // fields again and sends another row's.
  { id: 'DM-GROUP-1 group by the lead alone', old: 'const key = `${DECISION_QUESTIONS[r].askedWith[0]!} ${stateHash}`;', new: 'const key = DECISION_QUESTIONS[r].askedWith[0]!;' },
  { id: 'DM-GROUP-2 group by the state alone', old: 'const key = `${DECISION_QUESTIONS[r].askedWith[0]!} ${stateHash}`;', new: 'const key = stateHash;' },
]);

export const DECISION_LITERAL_SET = set([
  // Review 2324 F2: a `local` host names a literal address.
  { id: 'DM-LIT-1 IPv4 only', old: "return hostname === 'localhost' || ipv4(hostname) !== null || ipv6(hostname) !== null;", new: "return hostname === 'localhost' || ipv4(hostname) !== null;" },
  { id: 'DM-LIT-2 any name', old: "return hostname === 'localhost' || ipv4(hostname) !== null || ipv6(hostname) !== null;", new: 'return hostname.length > 0;' },
  { id: 'DM-LIT-3 no localhost', old: "return hostname === 'localhost' || ipv4(hostname) !== null || ipv6(hostname) !== null;", new: 'return ipv4(hostname) !== null || ipv6(hostname) !== null;' },
]);

export const DECISION_READ_SET = set([
  // The plan's red checks: drop the model pin; take the higher p for a yes.
  { id: 'DM-READ-1 drop the model pin', old: "if (!isRecord(answer) || answer['model'] !== pinnedModel)", new: 'if (!isRecord(answer))' },
  { id: 'DM-READ-2 the higher p for a yes', old: "p = verdict === 'no' ? Math.max(...ps) : Math.min(...ps);", new: "p = verdict === 'yes' ? Math.max(...ps) : Math.min(...ps);" },
  { id: 'DM-READ-3 the higher p for a no', old: "p = verdict === 'no' ? Math.max(...ps) : Math.min(...ps);", new: 'p = Math.min(...ps);' },
  { id: 'DM-READ-4 disagreeing orders agree', old: 'const agree = orders.every((o) => o.said === orders[0]!.said);', new: 'const agree = true;' },
  { id: 'DM-READ-5 yes at over 0.5', old: "said = p >= 0.5 ? 'yes' : 'no';", new: "said = p > 0.5 ? 'yes' : 'no';" },
  { id: 'DM-READ-6 no range check', old: 'v >= 0 && v <= 1', new: 'true' },
  { id: 'DM-READ-7 any option', old: "(choice !== k.none && !k.options.has(choice))", new: 'false' },
  { id: 'DM-READ-8 the higher choice p', old: '      p = Math.min(...ps);\n    }', new: '      p = Math.max(...ps);\n    }' },
  { id: 'DM-READ-9 any type', old: "if (a['type'] !== 'noul') return { malformed: 'type' };", new: '' },
  { id: 'DM-READ-10 a none slug is none', old: "said = choice === k.none ? 'none' : `option:${k.options.get(choice)!}`;", new: "said = choice === k.none || k.options.get(choice) === 'none' ? 'none' : `option:${k.options.get(choice)!}`;" },
]);

export const DECISION_BAND_SET = set([
  // The plan's red check: `<=` for `<` at a band cut.
  { id: 'DM-BAND-1 <= at the first cut', old: 'if (p < DECISION_BAND_CUTS[0])', new: 'if (p <= DECISION_BAND_CUTS[0])' },
  { id: 'DM-BAND-2 <= at the second cut', old: 'if (p < DECISION_BAND_CUTS[1])', new: 'if (p <= DECISION_BAND_CUTS[1])' },
  { id: 'DM-BAND-3 <= at the third cut', old: 'if (p < DECISION_BAND_CUTS[2])', new: 'if (p <= DECISION_BAND_CUTS[2])' },
]);

export const DECISION_APPLY_SET = set([
  { id: 'DM-APPLY-1 drop row 1', old: "  if (side.mode === 'off') return 'skipped';", new: '' },
  { id: 'DM-APPLY-2 drop row 2', old: "  if (gate && side.mode === 'armed' && side.held) return 'shut';", new: '' },
  { id: 'DM-APPLY-3 a shadow row is read', old: "if (side.mode === 'shadow' || (!gate && side.held)) return 'shadow';", new: "if (!gate && side.held) return 'shadow';" },
  { id: 'DM-APPLY-4 a held advice row is read', old: "if (side.mode === 'shadow' || (!gate && side.held)) return 'shadow';", new: "if (side.mode === 'shadow') return 'shadow';" },
  { id: 'DM-APPLY-5 a miss is skipped for a gate too', old: "if (check.outcome !== 'answered') return out;", new: "if (check.outcome !== 'answered') return 'skipped';" },
  { id: 'DM-APPLY-6 drop row 5 host kind', old: 'h === null || h.kind !== check.hostKind || h.origin', new: 'h === null || h.origin' },
  { id: 'DM-APPLY-7 drop row 5 origin', old: ' || h.origin !== check.origin', new: '' },
  { id: 'DM-APPLY-8 drop row 5 model', old: ' || h.modelId !== check.modelId) return out;', new: ') return out;' },
  { id: 'DM-APPLY-9 drop row 6 line id', old: 'used === null || used.id !== check.lineGen', new: 'used === null' },
  { id: 'DM-APPLY-10 a gate reads the current line', old: 'const used = gate ? side.armedLine : now.currentLine;', new: 'const used = now.currentLine;' },
  { id: 'DM-APPLY-11 a gate prefers a newer current line', old: 'const used = gate ? side.armedLine : now.currentLine;', new: 'const used = gate ? (now.currentLine ?? side.armedLine) : now.currentLine;' },
  { id: 'DM-APPLY-12 advice reads an armed line', old: 'const used = gate ? side.armedLine : now.currentLine;', new: 'const used = side.armedLine ?? now.currentLine;' },
  { id: 'DM-APPLY-13 drop row 7', old: "  if (check.verdict === 'unsure') return gate ? 'shut' : 'unsure';", new: '' },
  { id: 'DM-APPLY-14 the line is exclusive', old: 'const atLine = check.p >= used.line;', new: 'const atLine = check.p > used.line;' },
  { id: 'DM-APPLY-15 a yes is not read', old: "if (check.verdict === 'yes' && atLine) return 'clear-yes';", new: "if (atLine) return 'clear-yes';" },
  { id: 'DM-APPLY-16 a gate below the line is not shut', old: "return gate ? 'shut' : 'clear-no';", new: "return 'clear-no';" },
  { id: 'DM-APPLY-17 none below the line', old: "if (atLine && check.verdict === 'none') return 'none-picked';", new: "if (check.verdict === 'none') return 'none-picked';" },
  { id: 'DM-APPLY-18 a pick below the line', old: "if (atLine && typeof check.verdict === 'object') return", new: "if (typeof check.verdict === 'object') return" },
  { id: 'DM-APPLY-19 the wrong option', old: '{ pick: check.verdict.option }', new: "{ pick: 'programme-a' }" },
  { id: 'DM-APPLY-20 the row type is swapped', old: "now.row.type === 'yes-no'", new: "now.row.type !== 'yes-no'" },
  { id: 'DM-APPLY-21 another row\'s check is applied', old: "  if (check.row !== now.row.id) throw new Error(", new: "  if (false) throw new Error(" },
  { id: 'DM-APPLY-22 a gate is judged advice', old: "const gate = now.row.direction === 'gate';", new: 'const gate = false;' },
  { id: 'DM-APPLY-23 an unmatched choice is skipped', old: "  return gate ? 'shut' : 'unsure';\n}", new: "  return 'skipped';\n}" },
]);

export const DECISION_GATE_OUTCOME_SET = set([
  { id: 'DM-GATE-1 shadow goes to the operator', old: " || effect === 'shadow' ? codeVerdict", new: ' ? codeVerdict' },
  { id: 'DM-GATE-2 skipped goes to the operator', old: "effect === 'clear-yes' || effect === 'skipped' ||", new: "effect === 'clear-yes' ||" },
  { id: 'DM-GATE-3 clear-yes goes to the operator', old: "effect === 'clear-yes' || effect === 'skipped' ||", new: "effect === 'skipped' ||" },
  { id: 'DM-GATE-4 clear-no passes', old: " || effect === 'shadow' ? codeVerdict", new: " || effect === 'shadow' || effect === 'clear-no' ? codeVerdict" },
  { id: 'DM-GATE-5 shut passes', old: " || effect === 'shadow' ? codeVerdict", new: " || effect === 'shadow' || effect === 'shut' ? codeVerdict" },
  { id: 'DM-GATE-6 unsure passes', old: " || effect === 'shadow' ? codeVerdict", new: " || effect === 'shadow' || effect === 'unsure' ? codeVerdict" },
  { id: 'DM-GATE-7 a pick passes', old: " || effect === 'shadow' ? codeVerdict", new: " || effect === 'shadow' || typeof effect === 'object' ? codeVerdict" },
  { id: 'DM-GATE-8 none-picked passes', old: " || effect === 'shadow' ? codeVerdict", new: " || effect === 'shadow' || effect === 'none-picked' ? codeVerdict" },
  { id: 'DM-GATE-9 the operator never', old: ": 'to-operator';", new: ': codeVerdict;' },
]);

// ── decisionLines.ts (a module of its own) ───────────────────────────────────────────────────────────────────────────

const ROW1 = "  if (!isDecisionRowId(i.rowId)) return refuse('decision-row-unknown', 'not a decision-model row');";
const ARM_HEAD = 'DecisionLineFacts | null }): DecisionDoorMove | Refused {\n';
const OFF_HEAD = 'export function decideRowOff(i: { rowId: string; body: unknown }): DecisionDoorMove | Refused {\n';
const CEIL_HEAD = 'export function decideRowCeiling(i: { rowId: string; body: unknown }): DecisionDoorMove | Refused {\n';
const SIDE_ARM = "  const expected = readDecisionRowSide(body['expected']);\n  if (expected === null) return refuse('bad-request', 'expected is not a row side');\n  const named";
const SIDE_OFF = "  const expected = readDecisionRowSide(body['expected']);\n  if (expected === null) return refuse('bad-request', 'expected is not a row side');\n  return { ok: true, row: i.rowId, expected, to: { mode: 'off'";

export const DECISION_DIRECTION_SET = linesSet([
  // The plan's red checks: drop row 2; `>=` for `>` in row 5; drop row 4.
  { id: 'DL-DIR-1 drop row 2', old: "  if (from.mode === 'off' && to.mode !== 'off') return 'widens';", new: '' },
  { id: 'DL-DIR-2 >= for > in row 5', old: '!(b.line > a.line)', new: '!(b.line >= a.line)' },
  { id: 'DL-DIR-3 drop row 4', old: "    if (from.held && to.mode === 'armed' && !to.held) return 'widens';", new: '' },
  { id: 'DL-DIR-4 drop row 1', old: "  if (to.ceiling > from.ceiling) return 'widens';", new: '' },
  { id: 'DL-DIR-5 row 1 at >=', old: 'to.ceiling > from.ceiling', new: 'to.ceiling >= from.ceiling' },
  { id: 'DL-DIR-6 drop row 3', old: "    if (fromShuts && (to.mode === 'shadow' || to.mode === 'off')) return 'widens';", new: '' },
  { id: 'DL-DIR-7 row 3 ignores held', old: 'const fromShuts = from.mode === \'armed\' || from.held;', new: "const fromShuts = from.mode === 'armed';" },
  { id: 'DL-DIR-8 rows 3 to 5 for advice too', old: '  if (gate) {', new: '  if (true) {' },
  { id: 'DL-DIR-9 row 5 ignores held', old: '!from.held && !to.held) {\n      const a', new: 'true) {\n      const a' },
  { id: 'DL-DIR-10 row 5 ignores the id', old: 'a !== null && b !== null && a.id === b.id && a.line === b.line', new: 'a !== null && b !== null && a.line === b.line' },
  { id: 'DL-DIR-11 row 5 without a line is narrower', old: '(a === null || b === null || !(b.line > a.line))', new: '(a !== null && b !== null && !(b.line > a.line))' },
  { id: 'DL-DIR-12 row 4 for held to held', old: "from.held && to.mode === 'armed' && !to.held", new: "from.held && to.mode === 'armed'" },
  { id: 'DL-DIR-13 row 3 to off alone', old: "(to.mode === 'shadow' || to.mode === 'off')", new: "to.mode === 'off'" },
  { id: 'DL-DIR-14 row 2 to shadow alone', old: "from.mode === 'off' && to.mode !== 'off'", new: "from.mode === 'off' && to.mode === 'armed'" },
]);

export const DECISION_GATE_SET = linesSet([
  { id: 'DL-ISGATE-1 inverted', old: "DECISION_QUESTIONS[row].direction === 'gate'", new: "DECISION_QUESTIONS[row].direction !== 'gate'" },
  { id: 'DL-ISGATE-2 the first row', old: "DECISION_QUESTIONS[row].direction === 'gate'", new: "row === 'scope.widens'\n    && DECISION_QUESTIONS[row].direction === 'gate' || row === 'programme.any'" },
]);

export const DECISION_LINE_COUNTS_SET = linesSet([
  { id: 'DL-LC-1 the line is exclusive', old: 'if (c.p < t) continue;', new: 'if (c.p <= t) continue;' },
  { id: 'DL-LC-2 an unsure counts as a yes', old: "if (c.verdict !== 'yes') continue;", new: "if (c.verdict === 'no') continue;" },
  { id: 'DL-LC-3 a none label is an error for a yes', old: "if (c.label === 'no') errors++;", new: "if (c.label !== 'yes') errors++;" },
  { id: 'DL-LC-4 a none or unsure answer counts on a choice', old: "if (typeof c.verdict !== 'object') continue;", new: "if (c.verdict === 'unsure') continue;" },
  { id: 'DL-LC-5 a none label is no error on a choice', old: "if (typeof c.label !== 'object' || c.label.option !== c.verdict.option) errors++;", new: "if (typeof c.label === 'object' && c.label.option !== c.verdict.option) errors++;" },
  { id: 'DL-LC-6 another option is no error', old: "if (typeof c.label !== 'object' || c.label.option !== c.verdict.option) errors++;", new: "if (typeof c.label !== 'object') errors++;" },
  { id: 'DL-LC-7 the kinds swapped', old: "if (row.type === 'yes-no') {", new: "if (row.type !== 'yes-no') {" },
  { id: 'DL-LC-8 every error counts', old: "if (c.label === 'no') errors++;", new: 'errors++;' },
  { id: 'DL-LC-9 a no answer is a yes', old: "if (c.verdict !== 'yes') continue;", new: "if (c.verdict === 'unsure') continue;" },
]);

export const DECISION_ADMIT_SET = linesSet([
  // A mutant that skips past a failure must die (the plan's red check).
  { id: 'DL-ADMIT-1 skip past a failure', old: 'if (bound > row.target) break;', new: 'if (bound > row.target) continue;' },
  { id: 'DL-ADMIT-2 a bound at the target fails', old: 'if (bound > row.target) break;', new: 'if (bound >= row.target) break;' },
  { id: 'DL-ADMIT-3 loosest first', old: 'for (const t of DECISION_LINE_CANDIDATES) {', new: 'for (const t of [...DECISION_LINE_CANDIDATES].reverse()) {' },
  { id: 'DL-ADMIT-4 the first that passed', old: '    last = { admitted: true, line: t, labelled: n, errors, bound };', new: '    last = last ?? { admitted: true, line: t, labelled: n, errors, bound };' },
  { id: 'DL-ADMIT-5 triedFirst is not the strictest', old: 'triedFirst: DECISION_LINE_CANDIDATES[0]', new: 'triedFirst: DECISION_LINE_CANDIDATES[1]' },
  { id: 'DL-ADMIT-6 labelled is every case', old: 'labelled: n, errors, bound };\n  }', new: 'labelled: cases.length, errors, bound };\n  }' },
  { id: 'DL-ADMIT-7 no errors in the bound', old: 'const bound = upperBound95(errors, n)', new: 'const bound = upperBound95(0, n)' },
  { id: 'DL-ADMIT-8 the bound over the wrong n', old: 'const bound = upperBound95(errors, n)', new: 'const bound = upperBound95(errors, cases.length)' },
  { id: 'DL-ADMIT-9 errors reported as 0', old: 'labelled: n, errors, bound };\n  }', new: 'labelled: n, errors: 0, bound };\n  }' },
  { id: 'DL-ADMIT-10 the target is the gate\'s', old: 'if (bound > row.target) break;', new: 'if (bound > 0.05) break;' },
]);

export const DECISION_CANARY_CROSSED_SET = linesSet([
  { id: 'DL-CC-1 no: the plain mark is not read', old: "case 'no': return isClearYes(plain, plainP, line) && !isClearYes(perturbed, perturbedP, line);", new: "case 'no': return !isClearYes(perturbed, perturbedP, line);" },
  { id: 'DL-CC-2 no: the perturbed mark is not read', old: "case 'no': return isClearYes(plain, plainP, line) && !isClearYes(perturbed, perturbedP, line);", new: "case 'no': return isClearYes(plain, plainP, line);" },
  { id: 'DL-CC-3 yes: the plain answer is not read', old: "case 'yes': return !isClearYes(plain, plainP, line) && isClearYes(perturbed, perturbedP, line);", new: "case 'yes': return isClearYes(perturbed, perturbedP, line);" },
  { id: 'DL-CC-4 yes: the perturbed answer is not read', old: "case 'yes': return !isClearYes(plain, plainP, line) && isClearYes(perturbed, perturbedP, line);", new: "case 'yes': return !isClearYes(plain, plainP, line);" },
  { id: 'DL-CC-5 a clear yes needs more than the line', old: "verdict === 'yes' && p >= line;", new: "verdict === 'yes' && p > line;" },
  { id: 'DL-CC-6 a clear yes needs no yes', old: "verdict === 'yes' && p >= line;", new: 'p >= line;' },
  { id: 'DL-CC-7 an option: any pair crosses', old: '(was !== null || now !== null) && was !== now', new: '(was !== null || now !== null)' },
  { id: 'DL-CC-8 an option: only a lost option', old: '(was !== null || now !== null) && was !== now', new: 'was !== null && was !== now' },
  { id: 'DL-CC-9 an option: only a gained option', old: '(was !== null || now !== null) && was !== now', new: 'now !== null && was !== now' },
  { id: 'DL-CC-10 an option under the line is named', old: "p >= line && typeof verdict === 'object' ? verdict.option : null", new: "typeof verdict === 'object' ? verdict.option : null" },
  { id: 'DL-CC-11 an option over the line is none too', old: "p >= line && typeof verdict === 'object' ? verdict.option : null", new: "p >= line && typeof verdict === 'object' ? verdict.option : verdict === 'none' ? 'none' : null" },
  { id: 'DL-CC-12 an option at the line only', old: "p >= line && typeof verdict === 'object'", new: "p > line && typeof verdict === 'object'" },
]);

export const DECISION_CANARY_VERDICT_SET = linesSet([
  { id: 'DL-CV-1 expected 0 is read', old: "if (expected === 0 || asked === 0) return 'not-run';", new: "if (asked === 0) return 'not-run';" },
  { id: 'DL-CV-2 asked 0 is incomplete', old: "if (expected === 0 || asked === 0) return 'not-run';", new: "if (expected === 0) return 'not-run';" },
  { id: 'DL-CV-3 a full set is incomplete', old: 'if (asked < expected)', new: 'if (asked <= expected)' },
  { id: 'DL-CV-4 5% itself is unmet', old: 'crossed <= DECISION_CANARY_MAX_SHARE * expected', new: 'crossed < DECISION_CANARY_MAX_SHARE * expected' },
  { id: 'DL-CV-5 over 5% is held', old: 'crossed <= DECISION_CANARY_MAX_SHARE * expected', new: 'crossed <= DECISION_CANARY_MAX_SHARE * expected + 1' },
  { id: 'DL-CV-6 held and unmet swapped', old: "? 'held' : 'unmet'", new: "? 'unmet' : 'held'" },
  { id: 'DL-CV-7 a partial set is not run', old: "if (asked < expected) return 'incomplete';", new: "if (asked < expected) return 'not-run';" },
  { id: 'DL-CV-8 a partial set is read', old: "  if (asked < expected) return 'incomplete';\n", new: '' },
  { id: 'DL-CV-9 5% of the asked', old: 'crossed <= DECISION_CANARY_MAX_SHARE * expected', new: 'crossed <= DECISION_CANARY_MAX_SHARE * asked * 2' },
]);

export const DECISION_DRIFT_SET = linesSet([
  { id: 'DL-DRIFT-1 4 moved holds', old: 'return moved >= DECISION_DRIFT_MOVED;', new: 'return moved > DECISION_DRIFT_MOVED;' },
  { id: 'DL-DRIFT-2 3 moved fires', old: 'return moved >= DECISION_DRIFT_MOVED;', new: 'return moved >= DECISION_DRIFT_MOVED - 1;' },
  { id: 'DL-DRIFT-3 any length is compared', old: '  if (baseline.length !== DECISION_ANCHOR_COUNT || today.length !== DECISION_ANCHOR_COUNT) return true;\n', new: '' },
  { id: 'DL-DRIFT-4 only the baseline length is read', old: ' || today.length !== DECISION_ANCHOR_COUNT) return true;', new: ') return true;' },
  { id: 'DL-DRIFT-5 only today\'s length is read', old: 'if (baseline.length !== DECISION_ANCHOR_COUNT || today.length', new: 'if (today.length' },
  { id: 'DL-DRIFT-6 the equal positions are counted', old: 'if (today[i] !== b) moved++;', new: 'if (today[i] === b) moved++;' },
  { id: 'DL-DRIFT-7 a short set is no drift', old: 'today.length !== DECISION_ANCHOR_COUNT) return true;', new: 'today.length !== DECISION_ANCHOR_COUNT) return false;' },
]);

export const DECISION_ARM_SET = linesSet([
  { id: 'DL-ARM-1 drop row 1', old: ARM_HEAD + ROW1, new: ARM_HEAD.trimEnd() + '\n' },
  { id: 'DL-ARM-2 drop the mode check', old: "  if (mode !== 'shadow' && mode !== 'armed') return refuse('bad-request', 'mode is shadow or armed');\n", new: '' },
  { id: 'DL-ARM-3 drop the line check', old: "  if (has(body, 'line') && !isPositiveId(body['line'])) return refuse('bad-request', 'line is a positive integer');\n", new: '' },
  { id: 'DL-ARM-4 drop the expected check', old: SIDE_ARM, new: "  const expected = readDecisionRowSide(body['expected'])!;\n  const named" },
  { id: 'DL-ARM-5 drop the exact keys', old: "!keysOf(body, ['mode', 'expected'], ['line'])", new: "false" },
  { id: 'DL-ARM-6 an extra key is read', old: "keysOf(body, ['mode', 'expected'], ['line'])", new: "keysOf(body, ['mode', 'expected'], ['line', 'extra'])" },
  { id: 'DL-ARM-7 drop row 3 key', old: "if (i.host === null || !i.keySet) return", new: "if (i.host === null) return" },
  { id: 'DL-ARM-8 row 4 refuses a zero-retention host', old: "i.host.kind === 'hosted') return refuse('private-state-host'", new: "i.host.kind !== 'local') return refuse('private-state-host'" },
  { id: 'DL-ARM-9 drop row 4', old: "  if (q.privateState && i.host.kind === 'hosted') return refuse('private-state-host', 'a private-state row is never asked of a hosted host');\n", new: '' },
  { id: 'DL-ARM-10 drop the named-line check', old: '(named !== null && named !== i.currentLine?.id)', new: 'false' },
  { id: 'DL-ARM-11 drop the under-today check', old: 'if (line === null || !line.underToday)', new: 'if (line === null)' },
  { id: 'DL-ARM-12 drop the completeness term of row 6', old: "canaryVerdict(line.canaryAsked, line.canaryCrossed, line.canaryExpected) !== 'held'", new: "canaryVerdict(line.canaryAsked, line.canaryCrossed, line.canaryExpected) === 'unmet'" },
  { id: 'DL-ARM-13 drop row 6', old: "    if (canaryVerdict(line.canaryAsked, line.canaryCrossed, line.canaryExpected) !== 'held') return refuse('canary-unmet', 'the line\\'s canary has not held');\n", new: '' },
  { id: 'DL-ARM-14 an armed gate loses its line', old: "(gate && expected.mode === 'armed' && expected.armedLine !== null ? expected.armedLine.id : (i.currentLine?.id ?? null))", new: '(i.currentLine?.id ?? null)' },
  { id: 'DL-ARM-15 advice takes an armed line', old: 'const armedLine = gate && line !== null ?', new: 'const armedLine = line !== null ?' },
  { id: 'DL-ARM-16 the move keeps held', old: "to: { mode, ceiling: expected.ceiling, armedLine, held: false }", new: 'to: { mode, ceiling: expected.ceiling, armedLine, held: expected.held }' },
  { id: 'DL-ARM-17 the move resets the ceiling', old: "to: { mode, ceiling: expected.ceiling, armedLine, held: false }", new: 'to: { mode, ceiling: 600, armedLine, held: false }' },
  { id: 'DL-ARM-18 the named line is ignored', old: 'const target = named ?? (', new: 'const target = (' },
  { id: 'DL-ARM-19 everything is a gate', old: 'const gate = isDecisionGate(row);', new: 'const gate = true;' },
  { id: 'DL-ARM-20 a gate in shadow takes a line', old: 'let line: DecisionLineFacts | null = null;\n  if (mode === \'armed\') {', new: 'let line: DecisionLineFacts | null = i.currentLine;\n  if (mode === \'armed\') {' },
  { id: 'DL-ARM-21 the line value from the side', old: 'const armedLine = gate && line !== null ? { id: line.id, line: line.line } : null;', new: 'const armedLine = gate && line !== null ? { id: line.id, line: expected.armedLine?.line ?? line.line } : null;' },
  { id: 'DL-ARM-22 a heldCause is set', old: 'armedLine, held: false }, heldCause: null };', new: "armedLine, held: false }, heldCause: 'drift' };" },
]);

export const DECISION_OFF_SET = linesSet([
  { id: 'DL-OFF-1 drop row 1', old: OFF_HEAD + ROW1, new: OFF_HEAD.trimEnd() + '\n' },
  { id: 'DL-OFF-2 drop the exact keys', old: "!keysOf(body, ['expected']))", new: 'false)' },
  { id: 'DL-OFF-3 drop the expected check', old: SIDE_OFF, new: "  const expected = readDecisionRowSide(body['expected'])!;\n  return { ok: true, row: i.rowId, expected, to: { mode: 'off'" },
  { id: 'DL-OFF-4 the armed line is kept', old: "to: { mode: 'off', ceiling: expected.ceiling, armedLine: null, held: false }", new: "to: { mode: 'off', ceiling: expected.ceiling, armedLine: expected.armedLine, held: false }" },
  { id: 'DL-OFF-5 held is kept', old: "to: { mode: 'off', ceiling: expected.ceiling, armedLine: null, held: false }", new: "to: { mode: 'off', ceiling: expected.ceiling, armedLine: null, held: expected.held }" },
  { id: 'DL-OFF-6 the ceiling is reset', old: "to: { mode: 'off', ceiling: expected.ceiling, armedLine: null, held: false }", new: "to: { mode: 'off', ceiling: 600, armedLine: null, held: false }" },
  { id: 'DL-OFF-7 the move is to shadow', old: "to: { mode: 'off', ceiling", new: "to: { mode: 'shadow', ceiling" },
]);

export const DECISION_OFF_FALLBACK_SET = linesSet([
  { id: 'DL-FB-1 advice is held too', old: "if (!isDecisionGate(row) || expected.mode !== 'armed') return 'refuse';", new: "if (expected.mode !== 'armed') return 'refuse';" },
  { id: 'DL-FB-2 a gate not armed is held', old: "if (!isDecisionGate(row) || expected.mode !== 'armed') return 'refuse';", new: "if (!isDecisionGate(row)) return 'refuse';" },
  { id: 'DL-FB-3 only rolled-back is read', old: "if (error !== 'authority-rolled-back' && error !== 'authority-unmeasured') return 'refuse';", new: "if (error !== 'authority-rolled-back') return 'refuse';" },
  { id: 'DL-FB-4 only unmeasured is read', old: "if (error !== 'authority-rolled-back' && error !== 'authority-unmeasured') return 'refuse';", new: "if (error !== 'authority-unmeasured') return 'refuse';" },
  { id: 'DL-FB-5 any error is read', old: "if (error !== 'authority-rolled-back' && error !== 'authority-unmeasured') return 'refuse';\n", new: '' },
  { id: 'DL-FB-6 a held gate is held again', old: "expected.held ? 'already-held' : 'hold'", new: "'hold'" },
  { id: 'DL-FB-7 an armed gate is already held', old: "expected.held ? 'already-held' : 'hold'", new: "'already-held'" },
]);

export const DECISION_CEILING_SET = linesSet([
  { id: 'DL-CEIL-1 drop row 1', old: CEIL_HEAD + ROW1, new: CEIL_HEAD.trimEnd() + '\n' },
  { id: 'DL-CEIL-2 the move clears held', old: 'to: { ...expected, ceiling }', new: 'to: { ...expected, ceiling, held: false }' },
  { id: 'DL-CEIL-3 the move sets held', old: 'to: { ...expected, ceiling }', new: 'to: { ...expected, ceiling, held: true }' },
  { id: 'DL-CEIL-4 the move drops the armed line', old: 'to: { ...expected, ceiling }', new: 'to: { ...expected, ceiling, armedLine: null }' },
  { id: 'DL-CEIL-5 the move arms', old: 'to: { ...expected, ceiling }', new: "to: { ...expected, ceiling, mode: 'armed' }" },
  { id: 'DL-CEIL-6 drop the bounds', old: 'if (ceiling < DECISION_CEILING_MIN || ceiling > DECISION_CEILING_MAX) {', new: 'if (false) {' },
  { id: 'DL-CEIL-7 the minimum is exclusive', old: 'ceiling < DECISION_CEILING_MIN ||', new: 'ceiling <= DECISION_CEILING_MIN ||' },
  { id: 'DL-CEIL-8 the maximum is exclusive', old: '|| ceiling > DECISION_CEILING_MAX', new: '|| ceiling >= DECISION_CEILING_MAX' },
  { id: 'DL-CEIL-9 a fraction is a ceiling', old: "typeof ceiling !== 'number' || !Number.isSafeInteger(ceiling) || expected === null", new: "typeof ceiling !== 'number' || expected === null" },
  { id: 'DL-CEIL-10 drop the exact keys', old: "!keysOf(body, ['ceiling', 'expected']))", new: 'false)' },
  { id: 'DL-CEIL-11 a bad body is a bad ceiling', old: "|| expected === null) return refuse('bad-request', 'ceiling is an integer and expected a row side');", new: "|| expected === null) return refuse('bad-ceiling', 'ceiling is an integer and expected a row side');" },
]);

export const DECISION_KEY_HOSTNAME_SET = linesSet([
  { id: 'DL-KH-1 brackets kept', old: "host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host", new: 'host' },
  { id: 'DL-KH-2 an empty host', old: "    if (host === '') return null;\n", new: '' },
  { id: 'DL-KH-3 a body that is not an object', old: "if (!isObj(body) || typeof body['endpoint'] !== 'string') return null;", new: "if (typeof body['endpoint'] !== 'string') return null;" },
  { id: 'DL-KH-4 a parse error is a host', old: '  } catch {\n    return null;\n  }\n}\n\n/** The authority', new: "  } catch {\n    return 'unparsed';\n  }\n}\n\n/** The authority" },
]);

export const DECISION_KEY_DOOR_SET = linesSet([
  { id: 'DL-KEY-1 drop the exact keys', old: "!keysOf(body, ['kind', 'endpoint', 'modelId'], ['key'])", new: 'false' },
  { id: 'DL-KEY-2 a key is not a field', old: "keysOf(body, ['kind', 'endpoint', 'modelId'], ['key'])", new: "keysOf(body, ['kind', 'endpoint', 'modelId'])" },
  { id: 'DL-KEY-3 any kind', old: "|| !(DECISION_HOST_KINDS as readonly string[]).includes(kind)", new: '' },
  { id: 'DL-KEY-4 any endpoint type', old: " || typeof endpoint !== 'string') return refuse('bad-request'", new: ") return refuse('bad-request'" },
  { id: 'DL-KEY-5 an empty model id', old: 'modelId.length < 1 ||', new: '' },
  { id: 'DL-KEY-6 a long model id', old: 'modelId.length > 200', new: 'modelId.length > 201' },
  { id: 'DL-KEY-7 an empty key', old: 'key.length < 1 ||', new: '' },
  { id: 'DL-KEY-8 a long key', old: 'key.length > 4096', new: 'key.length > 4097' },
  { id: 'DL-KEY-9 a key over lines', old: '/[\\r\\n\\u2028\\u2029]/', new: '/[\\u2028\\u2029]/' },
  { id: 'DL-KEY-10 a key over unicode line breaks', old: '/[\\r\\n\\u2028\\u2029]/', new: '/[\\r\\n]/' },
  { id: 'DL-KEY-11 a key that is no string', old: "typeof key !== 'string' ||", new: '' },
  { id: 'DL-KEY-12 any scheme', old: "  if (url.protocol !== 'https:' && url.protocol !== 'http:') return refuse('bad-endpoint', 'the endpoint is https or http');\n", new: '' },
  { id: 'DL-KEY-13 userinfo as an empty name', old: "authorityOf(endpoint).includes('@') || ", new: '' },
  { id: 'DL-KEY-14 a bare query or fragment', old: "endpoint.includes('?') || endpoint.includes('#')", new: "url.search !== '' || url.hash !== ''" },
  { id: 'DL-KEY-15 a fragment', old: " || endpoint.includes('#')", new: '' },
  { id: 'DL-KEY-16 a query', old: "endpoint.includes('?') || ", new: '' },
  { id: 'DL-KEY-17 a zero-retention host over http', old: "if (hostKind !== 'local' && url.protocol", new: "if (hostKind === 'hosted' && url.protocol" },
  { id: 'DL-KEY-18 a hosted host over http', old: "if (hostKind !== 'local' && url.protocol", new: "if (hostKind === 'zero-retention' && url.protocol" },
  { id: 'DL-KEY-19 row 4: a name for a local host', old: 'if (host === null || !isLiteralHost(host)) return', new: 'if (host === null) return' },
  { id: 'DL-KEY-20 row 4: a public address', old: 'if (i.addresses.length === 0 || !i.addresses.every((a) => isPrivateAddress(a, false))) return', new: 'if (i.addresses.length === 0) return' },
  { id: 'DL-KEY-21 row 4: no address', old: 'if (i.addresses.length === 0 || !i.addresses.every((a) => isPrivateAddress(a, false))) return', new: 'if (!i.addresses.every((a) => isPrivateAddress(a, false))) return' },
  { id: 'DL-KEY-22 row 4: only loopback', old: 'isPrivateAddress(a, false)', new: 'isPrivateAddress(a, true)' },
  { id: 'DL-KEY-23 row 4: one private address is enough', old: 'i.addresses.every((a) => isPrivateAddress(a, false))', new: 'i.addresses.some((a) => isPrivateAddress(a, false))' },
  { id: 'DL-KEY-24 row 4: for hosted too', old: "  if (hostKind === 'local') {\n    const host", new: "  if (true) {\n    const host" },
  { id: 'DL-KEY-25 drop row 5', old: "  if (url.protocol === 'http:' && !i.addresses.every((a) => isPrivateAddress(a, true))) return refuse('bad-endpoint', 'a key goes over http only to a loopback address');\n", new: '' },
  { id: 'DL-KEY-26 row 5: private is enough', old: 'isPrivateAddress(a, true)', new: 'isPrivateAddress(a, false)' },
  { id: 'DL-KEY-27 row 5: one loopback address is enough', old: 'i.addresses.every((a) => isPrivateAddress(a, true))', new: 'i.addresses.some((a) => isPrivateAddress(a, true))' },
  { id: 'DL-KEY-28 drop row 6', old: "  if (i.stored !== null && i.stored.origin !== origin && given === null) return refuse('key-required', 'a new endpoint origin needs the key again');\n", new: '' },
  { id: 'DL-KEY-29 row 6 refuses a given key', old: 'i.stored.origin !== origin && given === null)', new: 'i.stored.origin !== origin)' },
  { id: 'DL-KEY-30 row 6 on any change', old: 'i.stored.origin !== origin && given === null)', new: '(i.stored.origin !== origin || i.stored.modelId !== modelId) && given === null)' },
  { id: 'DL-KEY-31 drop row 7', old: "  if (given === null && (i.stored === null || !i.stored.keySet)) return refuse('key-unset', 'no key is stored');\n", new: '' },
  { id: 'DL-KEY-32 row 7 ignores the stored flag', old: 'given === null && (i.stored === null || !i.stored.keySet)', new: 'given === null && i.stored === null' },
  { id: 'DL-KEY-33 the origin is the URL', old: 'const origin = url.origin;', new: 'const origin = url.href;' },
  { id: 'DL-KEY-34 hostChanged ignores the kind', old: 'i.stored.kind !== hostKind || ', new: '' },
  { id: 'DL-KEY-35 hostChanged ignores the model', old: ' || i.stored.modelId !== modelId;', new: ';' },
  { id: 'DL-KEY-36 hostChanged ignores the origin', old: 'i.stored.origin !== origin || i.stored.modelId', new: 'i.stored.modelId' },
  { id: 'DL-KEY-37 keyChanged is always', old: 'keyChanged: given !== null }', new: 'keyChanged: true }' },
  { id: 'DL-KEY-38 the key is dropped from the answer', old: 'modelId, key: given, hostChanged', new: 'modelId, key: null, hostChanged' },
  { id: 'DL-KEY-39 the key text in a refusal', old: "return refuse('bad-endpoint', 'a local endpoint names an address literal or localhost');", new: "return refuse('bad-endpoint', `a local endpoint names an address literal or localhost, key ${key}`);" },
  { id: 'DL-KEY-40 a model change alone is not a host change', old: 'i.stored.modelId !== modelId', new: 'false' },
]);

export const DECISION_STEP_UP_SET = linesSet([
  { id: 'DL-SU-1 arm does not ask', old: "    case 'arm':\n    case 'key-put': return true;", new: "    case 'arm': return false;\n    case 'key-put': return true;" },
  { id: 'DL-SU-2 key-put does not ask', old: "    case 'arm':\n    case 'key-put': return true;", new: "    case 'arm': return true;\n    case 'key-put': return false;" },
  { id: 'DL-SU-3 key-delete asks', old: "case 'key-delete': return false;", new: "case 'key-delete': return true;" },
  { id: 'DL-SU-4 a narrowing asks', old: "decisionRowDirection(gate, from, to) === 'widens'", new: "decisionRowDirection(gate, from, to) !== 'widens'" },
  { id: 'DL-SU-5 off and ceiling always ask', old: "return decisionRowDirection(gate, from, to) === 'widens';", new: 'return true;' },
  { id: 'DL-SU-6 off and ceiling never ask', old: "return decisionRowDirection(gate, from, to) === 'widens';", new: 'return false;' },
  { id: 'DL-SU-7 the gate flag is ignored', old: 'decisionRowDirection(gate, from, to) ===', new: 'decisionRowDirection(true, from, to) ===' },
]);

export const DECISION_HELD_HOST_SET = linesSet([
  { id: 'DL-HHC-1 an off row is held', old: "return side.mode === 'armed' && !side.held && !lineUnderKey;", new: "return side.mode !== 'armed' ? false : !lineUnderKey;" },
  { id: 'DL-HHC-2 a held row is held again', old: "return side.mode === 'armed' && !side.held && !lineUnderKey;", new: "return side.mode === 'armed' && !lineUnderKey;" },
  { id: 'DL-HHC-3 a line under the key is held', old: "return side.mode === 'armed' && !side.held && !lineUnderKey;", new: "return side.mode === 'armed' && !side.held && lineUnderKey;" },
  { id: 'DL-HHC-4 a shadow row is held', old: "return side.mode === 'armed' && !side.held && !lineUnderKey;", new: "return side.mode !== 'off' && !side.held && !lineUnderKey;" },
  { id: 'DL-HHC-5 the line is not read', old: "return side.mode === 'armed' && !side.held && !lineUnderKey;", new: "return side.mode === 'armed' && !side.held;" },
]);

export const DECISION_HELD_KEY_SET = linesSet([
  { id: 'DL-HKR-1 advice is held too', old: "return gate && side.mode === 'armed' && !side.held;", new: "return side.mode === 'armed' && !side.held;" },
  { id: 'DL-HKR-2 a held gate is held again', old: "return gate && side.mode === 'armed' && !side.held;", new: "return gate && side.mode === 'armed';" },
  { id: 'DL-HKR-3 a gate in shadow is held', old: "return gate && side.mode === 'armed' && !side.held;", new: "return gate && side.mode !== 'off' && !side.held;" },
  { id: 'DL-HKR-4 no gate is held', old: "return gate && side.mode === 'armed' && !side.held;", new: "return false;" },
]);

export const DECISION_VIEW_SET = linesSet([
  { id: 'DL-VIEW-1 an equal line is offered', old: 'current.id > a.id', new: 'current.id >= a.id' },
  { id: 'DL-VIEW-2 an older line is offered', old: 'current.id > a.id', new: 'current.id !== a.id' },
  { id: 'DL-VIEW-3 advice is offered a line', old: "q.direction === 'gate' && state.mode === 'armed'", new: "state.mode === 'armed'" },
  { id: 'DL-VIEW-4 a gate not armed is offered a line', old: "state.mode === 'armed' && a !== null && current", new: "a !== null && current" },
  { id: 'DL-VIEW-5 no offer at all', old: 'const offered = q.direction', new: 'const offered = null as { id: number; line: number } | null; void q.direction' },
  { id: 'DL-VIEW-6 the offer carries the armed line', old: '? { id: current.id, line: current.line } : null;', new: '? { id: current.id, line: a!.line } : null;' },
  { id: 'DL-VIEW-7 the total leaves out the reservations', old: 'total: usage.serve + usage.maintain + usage.reserved }', new: 'total: usage.serve + usage.maintain }' },
  { id: 'DL-VIEW-8 the total leaves out maintenance', old: 'total: usage.serve + usage.maintain + usage.reserved }', new: 'total: usage.serve + usage.reserved }' },
  { id: 'DL-VIEW-9 the total counts serve twice', old: 'total: usage.serve + usage.maintain + usage.reserved }', new: 'total: usage.serve * 2 + usage.maintain + usage.reserved }' },
  { id: 'DL-VIEW-10 maintenance reads serve', old: 'maintenance: usage.maintain,', new: 'maintenance: usage.serve,' },
  { id: 'DL-VIEW-11 the hold cause is dropped', old: 'heldWhy: state.heldCause,', new: 'heldWhy: null,' },
  { id: 'DL-VIEW-12 the direction is inverted', old: 'direction: q.direction, privateState: q.privateState,', new: "direction: q.direction === 'gate' ? 'advice' : 'gate', privateState: q.privateState," },
  { id: 'DL-VIEW-13 private state is dropped', old: 'privateState: q.privateState,', new: 'privateState: false,' },
  { id: 'DL-VIEW-14 a line shows as not admitted', old: 'line: current.line, admitted: true,', new: 'line: current.line, admitted: false,' },
  { id: 'DL-VIEW-15 the fleet total is dropped', old: 'fleetToday: i.fleetToday, fleetCap: i.fleetCap, host: i.host, key: i.key,', new: 'fleetToday: 0, fleetCap: i.fleetCap, host: i.host, key: i.key,' },
  { id: 'DL-VIEW-16 the key is dropped', old: 'fleetCap: i.fleetCap, host: i.host, key: i.key,', new: 'fleetCap: i.fleetCap, host: i.host, key: null,' },
  { id: 'DL-VIEW-17 the host is dropped', old: 'fleetCap: i.fleetCap, host: i.host, key: i.key,', new: 'fleetCap: i.fleetCap, host: null, key: i.key,' },
  { id: 'DL-VIEW-18 the canary crossed reads asked', old: 'canaryCrossed: current.canaryCrossed }', new: 'canaryCrossed: current.canaryAsked }' },
]);

export const DECISION_ARMED_FREE_SET = linesSet([
  { id: 'DL-AF-1 a held row is free', old: "return side.mode === 'armed' && !side.held;\n}\n\n/** Whether a stored line is under", new: "return side.mode === 'armed';\n}\n\n/** Whether a stored line is under" },
  { id: 'DL-AF-2 a shadow row is free', old: "return side.mode === 'armed' && !side.held;\n}\n\n/** Whether a stored line is under", new: "return side.mode !== 'off' && !side.held;\n}\n\n/** Whether a stored line is under" },
  { id: 'DL-AF-3 only a held armed row is free', old: "return side.mode === 'armed' && !side.held;\n}\n\n/** Whether a stored line is under", new: "return side.mode === 'armed' && side.held;\n}\n\n/** Whether a stored line is under" },
]);

export const DECISION_LINE_UNDER_KEY_SET = linesSet([
  { id: 'DL-LUK-1 no line is under a key', old: 'return line !== null && key !== null &&', new: 'return key !== null &&' },
  { id: 'DL-LUK-2 no key holds every line', old: 'return line !== null && key !== null &&', new: 'return line !== null &&' },
  { id: 'DL-LUK-3 the kind is not read', old: 'line.hostKind === key.hostKind && line.origin', new: 'line.origin' },
  { id: 'DL-LUK-4 the origin is not read', old: 'line.origin === key.origin && line.modelId', new: 'line.modelId' },
  { id: 'DL-LUK-5 the model is not read', old: 'line.modelId === key.modelId\n    && line.revision', new: 'line.revision' },
  { id: 'DL-LUK-6 the revision is not read', old: '\n    && line.revision === key.revision;', new: ';' },
  { id: 'DL-LUK-7 any one field is enough', old: 'line.hostKind === key.hostKind && line.origin === key.origin && line.modelId === key.modelId\n    && line.revision === key.revision', new: 'line.hostKind === key.hostKind || line.origin === key.origin || line.modelId === key.modelId\n    || line.revision === key.revision' },
]);

export const DECISION_BOUND_FAILS_SET = linesSet([
  { id: 'DL-BF-1 advice is checked', old: "if (row.direction !== 'gate' || !armedAndFree(side)", new: 'if (!armedAndFree(side)' },
  { id: 'DL-BF-2 a held gate is checked', old: '|| !armedAndFree(side) || side.armedLine === null) return false;', new: '|| side.mode !== \'armed\' || side.armedLine === null) return false;' },
  { id: 'DL-BF-3 a gate not armed is checked', old: '|| !armedAndFree(side) || side.armedLine === null) return false;', new: '|| side.held || side.armedLine === null) return false;' },
  { id: 'DL-BF-4 the armed line is not required', old: "|| !armedAndFree(side) || side.armedLine === null) return false;\n  const { n, errors } = lineCounts(row, answers, side.armedLine.line);", new: "|| !armedAndFree(side)) return false;\n  const { n, errors } = lineCounts(row, answers, side.armedLine?.line ?? 0.5);" },
  { id: 'DL-BF-5 the bound at the target passes', old: 'return upperBound95(errors, n) > row.target;', new: 'return upperBound95(errors, n) >= row.target;' },
  { id: 'DL-BF-6 a bound under the target fails', old: 'return upperBound95(errors, n) > row.target;', new: 'return upperBound95(errors, n) < row.target;' },
  { id: 'DL-BF-7 no errors in the bound', old: 'return upperBound95(errors, n) > row.target;', new: 'return upperBound95(0, n) > row.target;' },
  { id: 'DL-BF-8 the strictest line is counted', old: 'lineCounts(row, answers, side.armedLine.line)', new: 'lineCounts(row, answers, 0.95)' },
  { id: 'DL-BF-9 the loosest line is counted', old: 'lineCounts(row, answers, side.armedLine.line)', new: 'lineCounts(row, answers, 0.5)' },
  { id: 'DL-BF-10 the gate\'s target is fixed', old: 'return upperBound95(errors, n) > row.target;', new: 'return upperBound95(errors, n) > 0.1;' },
  { id: 'DL-BF-11 the bound over every answer', old: 'return upperBound95(errors, n) > row.target;', new: 'return upperBound95(errors, answers.length) > row.target;' },
]);

export const DECISION_MODEL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${K}planDecision`]: DECISION_PLAN_SET as MutantSet<never>,
  [`${K}serveCap`]: DECISION_SERVE_CAP_SET as MutantSet<never>,
  [`${K}maintainCap`]: DECISION_MAINTAIN_CAP_SET as MutantSet<never>,
  [`${K}isPrivateAddress`]: DECISION_ADDRESS_SET as MutantSet<never>,
  [`${K}encodeDecisionRequest`]: DECISION_ENCODE_SET as MutantSet<never>,
  [`${K}decisionRequestGroups`]: DECISION_GROUP_SET as MutantSet<never>,
  [`${K}isLiteralHost`]: DECISION_LITERAL_SET as MutantSet<never>,
  [`${K}readDecisionAnswers`]: DECISION_READ_SET as MutantSet<never>,
  [`${K}bandOf`]: DECISION_BAND_SET as MutantSet<never>,
  [`${K}applyDecision`]: DECISION_APPLY_SET as MutantSet<never>,
  [`${K}gateOutcome`]: DECISION_GATE_OUTCOME_SET as MutantSet<never>,
  [`${L}isDecisionGate`]: DECISION_GATE_SET as MutantSet<never>,
  [`${L}decisionRowDirection`]: DECISION_DIRECTION_SET as MutantSet<never>,
  [`${L}lineCounts`]: DECISION_LINE_COUNTS_SET as MutantSet<never>,
  [`${L}admitLine`]: DECISION_ADMIT_SET as MutantSet<never>,
  [`${L}canaryCrossed`]: DECISION_CANARY_CROSSED_SET as MutantSet<never>,
  [`${L}canaryVerdict`]: DECISION_CANARY_VERDICT_SET as MutantSet<never>,
  [`${L}anchorDrift`]: DECISION_DRIFT_SET as MutantSet<never>,
  [`${L}decideRowArm`]: DECISION_ARM_SET as MutantSet<never>,
  [`${L}heldOnHostChange`]: DECISION_HELD_HOST_SET as MutantSet<never>,
  [`${L}heldOnKeyRemoval`]: DECISION_HELD_KEY_SET as MutantSet<never>,
  [`${L}decisionModelViewOf`]: DECISION_VIEW_SET as MutantSet<never>,
  [`${L}armedAndFree`]: DECISION_ARMED_FREE_SET as MutantSet<never>,
  [`${L}lineUnderKey`]: DECISION_LINE_UNDER_KEY_SET as MutantSet<never>,
  [`${L}armedLineBoundFails`]: DECISION_BOUND_FAILS_SET as MutantSet<never>,
  [`${L}decideRowOff`]: DECISION_OFF_SET as MutantSet<never>,
  [`${L}offFallback`]: DECISION_OFF_FALLBACK_SET as MutantSet<never>,
  [`${L}decideRowCeiling`]: DECISION_CEILING_SET as MutantSet<never>,
  [`${L}keyDoorHostname`]: DECISION_KEY_HOSTNAME_SET as MutantSet<never>,
  [`${L}decideKeyDoor`]: DECISION_KEY_DOOR_SET as MutantSet<never>,
  [`${L}decisionStepUp`]: DECISION_STEP_UP_SET as MutantSet<never>,
};
