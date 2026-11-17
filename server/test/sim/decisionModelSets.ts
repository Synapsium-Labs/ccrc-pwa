// The decision-model port's mutant sets (Overlord W2, plan w2-decision-model.md Task 2 Step 5; the floors rule is D-8217's):
// `planDecision`, `serveCap`, `maintainCap`, `isPrivateAddress`, `isLiteralHost`, `encodeDecisionRequest`,
// `decisionRequestGroups`, `readDecisionAnswers` and `bandOf`,
// each run against every case of `../decisionModelCases.ts` loaded over the mutated copy of server/src/coord/decisionModel.ts.
// Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json. The plan's named mutants are
// DM-PLAN-1 to DM-PLAN-10, DM-ADDR-1 and -2, DM-READ-1 and -2 and DM-BAND-1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DECISION_MODEL_CASES, type DecisionModelModule } from '../decisionModelCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const DECISION_MODEL_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/decisionModel.ts');
const K = 'server/src/coord/decisionModel.ts#';

const suite = (m: DecisionModelModule): Record<string, SuiteCase> =>
  Object.fromEntries(ALL_DECISION_MODEL_CASES.map((c) => [c.name, () => c.run(m)]));
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
};
