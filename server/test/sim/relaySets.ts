// The relay's deciders' mutant sets (Overlord W2 relay plan, Tasks A1 to A3, and its §12 floors). The cases are
// `relayCases.ts`, shared with the relay suites; `mutation-floors.test.ts` runs each set against its textual mutants (D-8217's
// every-run floors), each at floor 1, so every mutant must be killed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MutantSet, SuiteCase } from './mutate.js';
import {
  citedNamesOfCases, parseNudgeBodyCases, parseRelayBodyCases, relayFactsOfCases, relayPriorityCases, relayVerdictCases,
  renderRelayBodyCases, type BodyModule, type CitedModule, type OverlapsModule, type RelayModule,
} from '../relayCases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BODY_KEY = 'server/src/coord/relayBody.ts';
const RELAY_KEY = 'server/src/coord/relay.ts';
const CITED_KEY = 'server/src/coord/citedNames.ts';
const OVERLAPS_KEY = 'server/src/coord/overlaps.ts';

const setOf = <M>(key: string, cases: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: path.join(ROOT, key), mutants, suite: cases });

// ------------------------------------------------------------------------------------------------------------- the bodies

const RELAY_BODY_SET = setOf<BodyModule>(BODY_KEY, parseRelayBodyCases, [
  { id: 'P1 a text at its cap is over it', old: 'if (v.length > max) return bad(\'over-bound\');', new: 'if (v.length >= max) return bad(\'over-bound\');' },
  { id: 'P2 an unknown key is read', old: "  if (Object.keys(raw).some((k) => !keys.includes(k))) return refuse('unknown-key', null);\n", new: '' },
  { id: 'P3 a re-relay may widen', old: "    if (obj.widens && move === 're-relay') return refuse('not-on-move', 'widens');\n", new: '' },
  { id: 'P4 a route needs no owner', old: "} else if (move !== 're-relay') return refuse('missing', 'owner');", new: '}' },
  { id: 'P5 the done test\'s word is lost', old: "return refuse('done-test', 'doneTest', doneTest.why);", new: "return refuse('done-test', 'doneTest');" },
  { id: 'P6 the caller\'s done test rides along', old: 'doneTest: doneTest.test, expectedPaths,', new: 'doneTest: obj.doneTest as DoneTest, expectedPaths,' },
  { id: 'P7 a path claims refuse is kept', old: "    if (path === null) return at('bad-path', 'expectedPaths.path');\n", new: '' },
  { id: 'P8 seventeen entries pass', old: 'if (v.length > RELAY_BOUNDS.entries) return bad', new: 'if (v.length > RELAY_BOUNDS.entries + 1) return bad' },
  { id: 'P9 an entry may repeat', old: "    if (out.includes(id.v)) return bad('repeated');\n", new: '' },
  { id: 'P10 thirty-three paths pass', old: "  if (v.length > REQUEST_BOUNDS.expectedPaths) return at('over-bound', 'expectedPaths');\n", new: '' },
  { id: 'P11 a path is measured in units, not bytes', old: 'if (utf8Bytes(v) > REQUEST_BOUNDS.pathBytes)', new: 'if (v.length > REQUEST_BOUNDS.pathBytes)' },
  { id: 'P12 a path may hold a line break', old: "  if (LINE_CONTROL.test(v)) return bad('control-character');\n", new: "  if (CONTROL.test(v)) return bad('control-character');\n" },
  { id: 'P13 a text may hold a control', old: "  if (CONTROL.test(v)) return bad('control-character');\n  return good(v);\n}\n\nconst readPositiveId", new: '  return good(v);\n}\n\nconst readPositiveId' },
  { id: 'P14 any value is an object', old: "  if (!isPlainObject(raw)) return refuse('not-an-object', null);\n", new: '' },
  { id: 'P15 a class instance is a plain object', old: 'return proto === Object.prototype || proto === null;', new: 'return true;' },
  { id: 'P16 a path may repeat', old: "    if (out.some((x) => x.project === project.v && x.path === path)) return at('repeated', 'expectedPaths');\n", new: '' },
  { id: 'P17 a slug is trimmed', old: "return shaped.ok && shaped.slug === v ? good(v) : bad('bad-slug');", new: "return shaped.ok ? good(shaped.slug) : bad('bad-slug');" },
  { id: 'P18 revision zero is refused', old: 'Number.isSafeInteger(v) && v >= 0 ?', new: 'Number.isSafeInteger(v) && v > 0 ?' },
  { id: 'P19 request id zero is an id', old: 'Number.isSafeInteger(v) && v > 0 ?', new: 'Number.isSafeInteger(v) && v >= 0 ?' },
  { id: 'P20 the path is not normalised', old: 'out.push({ project: project.v, path });', new: 'out.push({ project: project.v, path: raw.v });' },
  { id: 'P21 an empty text is accepted', old: "  if (v.length === 0) return bad('empty');\n", new: '' },
  { id: 'P22 the paths are read after the texts',
    old: "  let expectedPaths: readonly ExpectedPath[] | null = null;\n  if (Object.hasOwn(obj, 'expectedPaths')) {\n    const read = readPaths(obj.expectedPaths);\n    if (!read.ok) return refuse(read.why, read.field);\n    expectedPaths = read.v;\n  }\n  const texts = textsOf(obj);\n  if (!texts.ok) return texts;\n",
    new: "  const texts = textsOf(obj);\n  if (!texts.ok) return texts;\n  let expectedPaths: readonly ExpectedPath[] | null = null;\n  if (Object.hasOwn(obj, 'expectedPaths')) {\n    const read = readPaths(obj.expectedPaths);\n    if (!read.ok) return refuse(read.why, read.field);\n    expectedPaths = read.v;\n  }\n" },
]);

const NUDGE_BODY_SET = setOf<BodyModule>(BODY_KEY, parseNudgeBodyCases, [
  { id: 'NB1 a nudge takes the relay\'s keys', old: 'const shaped = shapeOf(raw, NUDGE_KEYS);', new: 'const shaped = shapeOf(raw, RELAY_KEYS);' },
  { id: 'NB2 a nudge cites no entry', old: "const NUDGE_KEYS = ['requestId', 'revision', 'part', 'why', 'entries'] as const;", new: "const NUDGE_KEYS = ['requestId', 'revision', 'part', 'why'] as const;" },
  { id: 'NB3 the entries are dropped', old: 'part: texts.part, why: texts.why, entries: entries.v };', new: 'part: texts.part, why: texts.why, entries: [] };' },
  { id: 'NB4 the why may pass its cap', old: 'const why = readText(o.why, RELAY_BOUNDS.whyChars);', new: 'const why = readText(o.why, RELAY_BOUNDS.partChars);' },
  { id: 'NB5 the part is read after the entries',
    old: "  const texts = textsOf(obj);\n  if (!texts.ok) return texts;\n  const entries = entriesOf(obj);\n  if (!entries.ok) return refuse(entries.why, 'entries');\n  const body: NudgeBody",
    new: "  const entries = entriesOf(obj);\n  if (!entries.ok) return refuse(entries.why, 'entries');\n  const texts = textsOf(obj);\n  if (!texts.ok) return texts;\n  const body: NudgeBody" },
]);

// ------------------------------------------------------------------------------------------------------------ the verdict

const V9 = "  if (f.cited.changed) return refuse('said-not-operator', 'changed');";
const V10 = "  if (!f.pairs.ok) return refuse('unavailable', 'pairs-unreadable');";
const VERDICT_SET = setOf<RelayModule>(RELAY_KEY, relayVerdictCases, [
  { id: 'V1 an absent request is unavailable', old: "if (r.kind === 'absent') return refuse('not-found', 'request');", new: "if (r.kind === 'absent') return refuse('unavailable', 'request');" },
  { id: 'V2 the operator\'s hold is not read', old: "    if (OPERATOR_HAS_IT_WORDS.includes(why)) return refuse('operator-has-it', why);", new: '' },
  { id: 'V3 a stale revision is not the operator\'s', old: "['stale-revision', 'taken', 'not-answered']", new: "['taken', 'not-answered']" },
  { id: 'V4 a vanished row is a bad transition', old: "    if (why === 'not-found') return refuse('not-found', 'request');", new: '' },
  { id: 'V5 outside a transaction is a bad transition', old: "    if (why === 'not-in-transaction') return refuse('unavailable', 'not-in-transaction');", new: '' },
  { id: 'V6 a parent is relayed', old: "if (r.hasChildren) return refuse('bad-transition', 'has-children');", new: '' },
  { id: 'V7 a re-relay needs no counter', old: "if (!r.counterSinceRelay) return refuse('bad-transition', 'no-counter-to-answer');", new: '' },
  { id: 'V8 a re-relay must name its owner', old: 'if (b.owner !== null && b.owner !== r.owner)', new: 'if (b.owner !== r.owner)' },
  { id: 'V9 a re-relay may widen', old: "    if (b.widens) return refuse('bad-transition', 're-relay-widens');\n", new: '' },
  { id: 'V10 a route needs a counter', old: "if (b.move === 're-relay') {", new: "if (b.move === 'route') {" },
  { id: 'V11 the row\'s missing owner is not read', old: 'if (owner === null || f.owner === null)', new: 'if (f.owner === null)' },
  { id: 'V12 an unread liveness is live', old: "if (f.owner.live === 'unmeasured') return refuse('unavailable', 'programme-unmeasured');", new: '' },
  { id: 'V13 a dead programme is live', old: "if (!f.owner.live) return refuse('not-found', 'programme');", new: '' },
  { id: 'V14 an unread coordinator is one', old: "if (coordinator.kind === 'unmeasured') return refuse('unavailable', 'coordinator-unmeasured');", new: '' },
  { id: 'V15 no coordinator is one', old: "if (coordinator.kind === 'none') return refuse('unknown-recipient', 'no-coordinator');", new: '' },
  { id: 'V16 a re-relay spends the route\'s key', old: "if (b.move !== 're-relay') {", new: 'if (true) {' },
  { id: 'V17 a taken key is free', old: "    if (f.key.kind === 'taken') return refuse('act-key-taken', `act:${f.key.actId}`);\n", new: '' },
  { id: 'V18 an unread key is free', old: "    if (f.key.kind === 'not-read') return refuse('unavailable', 'key-unread');\n", new: '' },
  { id: 'V19 a changed text passes', old: V9, new: '' },
  { id: 'V20 a failed pairs read is no pairs', old: V10, new: "  if (!f.pairs.ok) return { kind: 'go', effect: null, ruled: null };" },
  { id: 'V21 the body\'s paths are ignored', old: 'relayFactsOf(owner, b.expectedPaths ?? r.expectedPaths)', new: 'relayFactsOf(owner, r.expectedPaths)' },
  { id: 'V22 the row\'s paths are ignored', old: 'relayFactsOf(owner, b.expectedPaths ?? r.expectedPaths)', new: 'relayFactsOf(owner, b.expectedPaths ?? [])' },
  { id: 'V23 a goal conflict passes', old: 'if (!conflict.ok) {', new: 'if (false) {' },
  { id: 'V24 an unread cited message is read', old: 'if (f.cited.missing || f.cited.unmeasured) {', new: 'if (f.cited.missing) {' },
  { id: 'V25 a re-relay is held', old: "return b.move === 're-relay' ? refuse('unavailable', 'quote-unchecked') : hold('quote-unchecked');", new: "return hold('quote-unchecked');" },
  { id: 'V26 an Overlord request widens', old: "    if (r.origin !== 'operator') return hold('unnamed-widening');", new: '' },
  { id: 'V27 unread names do not name it', old: "    if (f.names.owner === 'unmeasured') return hold('quote-unchecked');", new: '' },
  { id: 'V28 unnamed words widen', old: "    if (!f.names.owner) return hold('unnamed-widening');", new: '' },
  { id: 'V29 the gate is not read', old: "    if (f.widensGate === 'to-operator') return hold('widening-unclear');", new: '' },
  { id: 'V30 a widening carries no effect', old: 'effect: b.widens ? WIDEN : null', new: 'effect: null' },
  { id: 'V31 every relay is a widening', old: "if (b.widens) {\n    if (r.origin", new: "if (true) {\n    if (r.origin" },
  { id: 'V32 the pairs are read before the cited text', old: `${V9}${' '.repeat(45)}// 9\n${V10}`, new: `${V10}${' '.repeat(45)}// 9\n${V9}` },
  { id: 'V33 the owner is always side a', old: "const ownerSide = relay.target === pair.a ? 'a' : 'b';", new: "const ownerSide = 'a';" },
  { id: 'V34 the other is always b', old: "other: ownerSide === 'a' ? pair.b : pair.a", new: 'other: pair.b' },
  { id: 'V35 the ruled pair is dropped', old: 'ruled: ruledPairOf(f.pairs.standing, relay)', new: 'ruled: null' },
  { id: 'V36 a dead programme reads as no request', old: "refuse('not-found', 'programme')", new: "refuse('not-found', 'request')" },
]);

// ---------------------------------------------------------------------------------------------------------- the rendering

const RENDER_SET = setOf<RelayModule>(RELAY_KEY, renderRelayBodyCases, [
  { id: 'R1 a widening is rendered when none is carried', old: 'if (r.widens !== null) tail.push', new: 'if (r.widens === null) tail.push' },
  { id: 'R2 no paths says nothing', old: "${r.expectedPaths.length === 0 ? ' none' : ''}", new: '' },
  { id: 'R3 the paths are dropped', old: "return [...head, ...shown, ...tail].join('\\n');", new: "return [...head, ...tail].join('\\n');" },
  { id: 'R4 the ids run together', old: "`messages ${ids.join(', ')}`", new: "`messages ${ids.join(',')}`" },
  { id: 'R5 the owner\'s side is not named', old: "t.replaceAll(`{${r.ownerSide}}`, 'this programme')", new: 't' },
  { id: 'R6 a string is not quoted', old: 'const quoted = (s: string): string =>\n  JSON.stringify(s)', new: 'const quoted = (s: string): string =>\n  String(s)' },
  { id: 'R7 the paths are never cut', old: 'if (used + bytes(`\\n${line}`) + more > room) {', new: 'if (false) {' },
  { id: 'R8 the part is not fenced', old: "untrustedBlock(r.part, PART_CAP_BYTES, 'on the act row', OVERLORD_PART_PREFACE)", new: 'r.part' },
  { id: 'R9 a long part is cut', old: 'const PART_CAP_BYTES = RELAY_BOUNDS.partChars * 3;', new: 'const PART_CAP_BYTES = RELAY_BOUNDS.partChars * 2;' },
  { id: 'R10 any done test word is rendered', old: "(DONE_PREDICATES as readonly unknown[]).includes(p) ? String(p) : 'unreadable'", new: 'String(p)' },
  { id: 'R11 the other programme is named by nothing', old: 'const other = `programme #${idText(r.otherProgrammeId)}`;', new: "const other = 'programme';" },
  { id: 'R12 an unknown choice is read', old: "  if (!isGoalConflictChoice(r.choice)) return 'unreadable';\n", new: '' },
  { id: 'R13 a nudge renders the relay\'s labels', old: "  if (r.kind === 'nudge') return [...head, ...tail].join('\\n');\n", new: '' },
  { id: 'R14 the part comes first', old: "return [...head, ...shown, ...tail].join('\\n');", new: "return [...tail, ...head, ...shown].join('\\n');" },
]);

const PRIORITY_SET = setOf<RelayModule>(RELAY_KEY, relayPriorityCases, [
  { id: 'Q1 a missing owner is place 0', old: "  if (at < 0) return { cls: 'unmeasured' };\n", new: '' },
  { id: 'Q2 the place counts from 0', old: 'place: at + 1', new: 'place: at' },
  { id: 'Q3 an unranked owner is background', old: 'ranks.get(owner) ?? UNRANKED_CLASS', new: "ranks.get(owner) ?? 'background'" },
  { id: 'Q4 the order is one short', old: 'of: order.length };', new: 'of: order.length - 1 };' },
]);

// --------------------------------------------------------------------------------------------------------------- the names

const CITED_SET = setOf<CitedModule>(CITED_KEY, citedNamesOfCases, [
  { id: 'C1 a short name matches', old: "  if (folded.join('').length < CITED_NAME_MIN_CHARS) return [];\n", new: '' },
  { id: 'C2 four characters is short', old: 'export const CITED_NAME_MIN_CHARS = 4;', new: 'export const CITED_NAME_MIN_CHARS = 5;' },
  { id: 'C3 overlord matches', old: "  if (folded.join('-') === NEVER_NAMED) return [];\n", new: '' },
  { id: 'C4 no name spans whitespace', old: "return folded.length > 1 ? [exact, entryOf(name, 'words', CITED_NAMES_KEY)] : [exact];", new: 'return [exact];' },
  { id: 'C5 no name spans a quote marker', old: "for (const id of pairHits(lines[i - 1], lines[i], '', entries, CITED_NAMES_KEY)) note(id);", new: '{}' },
  { id: 'C6 the matcher keeps the last text', old: "    hitsAt('', entries, CITED_NAMES_KEY);", new: '' },
  { id: 'C7 a name repeated is named twice', old: 'return names.filter((n, i) => named.has(n) && names.indexOf(n) === i);', new: 'return names.filter((n) => named.has(n));' },
  { id: 'C8 no text is read but the first', old: '    for (const text of texts) {', new: '    for (const text of texts.slice(0, 1)) {' },
]);

const FACTS_SET = setOf<OverlapsModule>(OVERLAPS_KEY, relayFactsOfCases, [
  { id: 'F1 a shared path is kept twice', old: 'for (const p of paths) if (!expectedPaths.includes(p.path)) expectedPaths.push(p.path);', new: 'for (const p of paths) expectedPaths.push(p.path);' },
  { id: 'F2 the paths are lost', old: '  return { target, expectedPaths };', new: '  return { target, expectedPaths: [] };' },
  { id: 'F3 the order is reversed', old: 'expectedPaths.push(p.path);\n  return { target', new: 'expectedPaths.unshift(p.path);\n  return { target' },
]);

/** One entry per decider, keyed `<path>#<function>`; `mutation-floors.test.ts` spreads it into `MUTANT_SETS`. */
export const RELAY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${BODY_KEY}#parseRelayBody`]: RELAY_BODY_SET as MutantSet<never>,
  [`${BODY_KEY}#parseNudgeBody`]: NUDGE_BODY_SET as MutantSet<never>,
  [`${RELAY_KEY}#relayVerdict`]: VERDICT_SET as MutantSet<never>,
  [`${RELAY_KEY}#renderRelayBody`]: RENDER_SET as MutantSet<never>,
  [`${RELAY_KEY}#relayPriority`]: PRIORITY_SET as MutantSet<never>,
  [`${CITED_KEY}#citedNamesOf`]: CITED_SET as MutantSet<never>,
  [`${OVERLAPS_KEY}#relayFactsOf`]: FACTS_SET as MutantSet<never>,
};
