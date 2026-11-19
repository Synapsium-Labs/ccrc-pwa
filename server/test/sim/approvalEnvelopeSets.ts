// The per-agent approval envelope's and the untrusted-build item's mutant sets (Overlord approvals PR 2, plan
// 2026-11-18-overlord-approvals.md Tasks 2.1 and 2.2; the floors rule is D-8217): `approvalEntryFor` and
// `paintedApprovalOf`, each run against every case of `../approvalEnvelopeCases.ts` over a mutated copy of
// server/src/coord/approvalEnvelope.ts, and `untrustedBuildItemOf` and `untrustedBuildItemsToSettle` against every case of
// `../untrustedBuildItemCases.ts` over a mutated copy of server/src/coord/untrustedBuildItem.ts. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_ENVELOPE_CASES, type ApprovalEnvelopeModule } from '../approvalEnvelopeCases.js';
import { UNTRUSTED_BUILD_ITEM_CASES, type UntrustedBuildItemModule } from '../untrustedBuildItemCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord');
const ENVELOPE_TS = path.join(SRC, 'approvalEnvelope.ts');
const ITEM_TS = path.join(SRC, 'untrustedBuildItem.ts');

const envelopeSuite = (mod: ApprovalEnvelopeModule): Record<string, SuiteCase> =>
  Object.fromEntries(APPROVAL_ENVELOPE_CASES.map((c) => [c.name, () => c.run(mod)]));
const itemSuite = (mod: UntrustedBuildItemModule): Record<string, SuiteCase> =>
  Object.fromEntries(UNTRUSTED_BUILD_ITEM_CASES.map((c) => [c.name, () => c.run(mod)]));

export const ENTRY_FOR_SET: MutantSet<ApprovalEnvelopeModule> = {
  modulePath: ENVELOPE_TS,
  mutants: [
    { id: 'EF-1 any menu is a permission prompt', old: ' || !approvalShapedMenu(dialog)) return null;', new: ') return null;' },
    { id: 'EF-2 the title is not read', old: "const raw = `${d.title}\\n${d.body ?? ''}`;", new: "const raw = `${d.body ?? ''}`;" },
    { id: 'EF-3 the body is not read', old: "const raw = `${d.title}\\n${d.body ?? ''}`;", new: 'const raw = `${d.title}`;' },
    { id: 'EF-4 whitespace is kept', old: "s.replace(/\\s+/g, '')", new: "s.replace(/\\s+/g, ' ')" },
    { id: 'EF-5 a long summary must be painted whole', old: "const head = n <= APPROVAL_MATCH_CHARS ? want : codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join('');", new: 'const head = want;' },
    { id: 'EF-6 the match is 50 characters', old: 'export const APPROVAL_MATCH_CHARS = 60;', new: 'export const APPROVAL_MATCH_CHARS = 50;' },
    { id: 'EF-7 a short summary matches as a substring', old: '  if (n < APPROVAL_MATCH_MIN_CHARS) return null;\n', new: '' },
    { id: 'EF-8 the short bound is 10', old: 'export const APPROVAL_MATCH_MIN_CHARS = 12;', new: 'export const APPROVAL_MATCH_MIN_CHARS = 10;' },
    { id: 'EF-9 no whole-command test', old: '  if (isWholeCommand(menu.lines, want)) return { exact: true, chars: n };\n', new: '' },
    { id: 'EF-10 a whole command on one line only', old: 'for (let j = i; j < lines.length && acc.length < want.length; j++) {', new: 'for (let j = i; j < i + 1; j++) {' },
    { id: 'EF-11 exactness is not ranked', old: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at]', new: '[m.chars, tool ? 1 : 0, at]' },
    { id: 'EF-12 length is not ranked', old: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at]', new: '[m.exact ? 1 : 0, tool ? 1 : 0, at]' },
    { id: 'EF-13 the tool is not ranked', old: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at]', new: '[m.exact ? 1 : 0, m.chars, at]' },
    { id: 'EF-14 the oldest wins', old: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at]', new: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, -at]' },
    { id: 'EF-15 recency ranks first', old: '[m.exact ? 1 : 0, m.chars, tool ? 1 : 0, at]', new: '[at, m.exact ? 1 : 0, m.chars, tool ? 1 : 0]' },
    { id: 'EF-16 the first match wins', old: 'if (best === null || atLeast(rank, bestRank))', new: 'if (best === null)' },
    { id: 'EF-17 an empty tool names every menu', old: "e.tool !== '' && menu.all.includes(squeeze(e.tool))", new: 'menu.all.includes(squeeze(e.tool))' },
    { id: 'EF-18 no menu is not checked', old: 'if (dialog === null || entries.length', new: 'if (entries.length' },
    { id: 'EF-19 no age bound', old: '    if (now - e.at > APPROVAL_ENTRY_MAX_AGE_MS) continue;\n', new: '' },
    { id: 'EF-20 the age bound excludes its edge', old: 'now - e.at > APPROVAL_ENTRY_MAX_AGE_MS', new: 'now - e.at >= APPROVAL_ENTRY_MAX_AGE_MS' },
    { id: 'EF-21 the age bound is 10 minutes', old: 'export const APPROVAL_ENTRY_MAX_AGE_MS = 15 * 60 * 1_000;', new: 'export const APPROVAL_ENTRY_MAX_AGE_MS = 10 * 60 * 1_000;' },
    { id: 'EF-22 lengths count UTF-16 units', old: 'const n = codePoints(want).length;', new: 'const n = want.length;' },
    { id: 'EF-23 the head is cut in UTF-16 units', old: "codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join('')", new: 'want.slice(0, APPROVAL_MATCH_CHARS)' },
  ],
  suite: envelopeSuite,
};

export const PAINTED_SET: MutantSet<ApprovalEnvelopeModule> = {
  modulePath: ENVELOPE_TS,
  mutants: [
    { id: 'PA-1 no hook state is not checked', old: '  if (hs === null) return { ask: null, entry: null };\n', new: '' },
    { id: 'PA-2 hook state\'s own approval is not taken first', old: 'if (own !== null && dialog !== null && approvalShapedMenu(dialog) && matchOf(own.summary, menuTextOf(dialog)) !== null) {', new: 'if (own === undefined) {' },
    { id: 'PA-3 hook state\'s own approval for any menu', old: ' && approvalShapedMenu(dialog) && matchOf(own.summary', new: ' && matchOf(own.summary' },
    { id: 'PA-4 hook state\'s own approval unmatched', old: ' && matchOf(own.summary, menuTextOf(dialog)) !== null) {', new: ') {' },
    { id: 'PA-5 no menu is not checked', old: 'if (own !== null && dialog !== null && ', new: 'if (own !== null && ' },
    { id: 'PA-6 no same-call entry', old: "    if (hs.waitBy === 'subagent') {", new: '    if (hs.waitBy === undefined && hs.ask === undefined) {' },
    { id: 'PA-7 a same-call entry for the main thread too', old: "    if (hs.waitBy === 'subagent') {", new: '    if (hs.ask !== null) {' },
    { id: 'PA-8 the same call by summary only', old: 'e.tool === own.tool && e.summary === own.summary', new: 'e.summary === own.summary' },
    { id: 'PA-9 the oldest same call', old: '(same === null || e.at >= same.at)', new: '(same === null || e.at <= same.at)' },
    { id: 'PA-10 no subagent mark', old: ", thread: 'subagent' as const } },", new: ' } },' },
    { id: 'PA-11 the route is dropped', old: '...(entry.route === undefined ? {} : { route: entry.route }), ', new: '' },
    { id: 'PA-12 the entry is not reported', old: '  entry,\n});', new: '  entry: null,\n});' },
    { id: 'PA-13 the bound is 17', old: 'export const HOOK_APPROVALS_MAX = 16;', new: 'export const HOOK_APPROVALS_MAX = 17;' },
  ],
  suite: envelopeSuite,
};

export const ITEM_OF_SET: MutantSet<UntrustedBuildItemModule> = {
  modulePath: ITEM_TS,
  mutants: [
    { id: 'UB-1 THE KEY dropped: an open item raises again', old: ' || openBuilds.has(version)) return null;', new: ') return null;' },
    { id: 'UB-2 a read failure raises', old: ' || !BUILD_FACT_REASONS.has(reason)', new: '' },
    { id: 'UB-3 no build to key it by raises', old: 'if (!isClaudeVersion(version) || ', new: 'if (' },
    { id: 'UB-4 a failed capture is no fact', old: "['not-captured', 'capture-queued', 'capture-failed']", new: "['not-captured', 'capture-queued']" },
    { id: 'UB-5 the action carries no key', old: 'action: { verb: UNTRUSTED_BUILD_VERB, build: version },', new: 'action: null,' },
    { id: 'UB-6 another programme', old: 'export const UNTRUSTED_BUILD_ITEM_PROGRAMME = OVERLORD_PROJECT;', new: "export const UNTRUSTED_BUILD_ITEM_PROGRAMME = 'linear-sync';" },
    { id: 'UB-7 the item blocks', old: "neededBy: 'soon'", new: "neededBy: 'now'" },
    { id: 'UB-9 the step links nothing', old: '`Open ${UNTRUSTED_BUILD_SETTINGS_PATH} and find', new: '`Open Settings › Automation and find' },
    { id: 'UB-10 a waiting build is said to be captured on its own', old: "'A build waiting for its capture stays waiting while no test box can capture it: none is reachable, or the box has no '", new: "'A build still waiting is captured on its own. '" },
    { id: 'UB-8 any action is an untrusted-build item', old: 'return isUntrustedBuildAction(a) ? [{ id: i.id, build: a.build }] : [];', new: 'return a !== null ? [{ id: i.id, build: (a as { build: string }).build }] : [];' },
  ],
  suite: itemSuite,
};

export const ITEMS_TO_SETTLE_SET: MutantSet<UntrustedBuildItemModule> = {
  modulePath: ITEM_TS,
  mutants: [
    { id: 'ST-1 an unreadable record settles every item', old: 'if (records === null) return [];', new: 'if (records === null) return [...open];' },
    { id: 'ST-2 every item settles', old: "open.filter((i) => buildTrustOf(records, i.build).kind === 'trusted')", new: 'open.filter(() => true)' },
    { id: 'ST-3 the untrusted settle', old: "buildTrustOf(records, i.build).kind === 'trusted'", new: "buildTrustOf(records, i.build).kind !== 'trusted'" },
  ],
  suite: itemSuite,
};

export const APPROVAL_ENVELOPE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/approvalEnvelope.ts#approvalEntryFor': ENTRY_FOR_SET as MutantSet<never>,
  'server/src/coord/approvalEnvelope.ts#paintedApprovalOf': PAINTED_SET as MutantSet<never>,
  'server/src/coord/untrustedBuildItem.ts#untrustedBuildItemOf': ITEM_OF_SET as MutantSet<never>,
  'server/src/coord/untrustedBuildItem.ts#untrustedBuildItemsToSettle': ITEMS_TO_SETTLE_SET as MutantSet<never>,
};
