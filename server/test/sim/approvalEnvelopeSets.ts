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
    { id: 'EF-2 the title is not read', old: '`${dialog.title}\\n${dialog.body ?? \'\'}`', new: '`${dialog.body ?? \'\'}`' },
    { id: 'EF-3 the body is not read', old: '`${dialog.title}\\n${dialog.body ?? \'\'}`', new: '`${dialog.title}`' },
    { id: 'EF-4 whitespace is kept', old: "s.replace(/\\s+/g, '')", new: "s.replace(/\\s+/g, ' ')" },
    { id: 'EF-5 the whole summary must be painted', old: 'squeeze(e.summary).slice(0, APPROVAL_MATCH_CHARS)', new: 'squeeze(e.summary)' },
    { id: 'EF-6 the match is 50 characters', old: 'export const APPROVAL_MATCH_CHARS = 60;', new: 'export const APPROVAL_MATCH_CHARS = 50;' },
    { id: 'EF-7 an empty summary matches', old: "if (want === '' || !text.includes(want)) continue;", new: 'if (!text.includes(want)) continue;' },
    { id: 'EF-8 the tool is not preferred', old: '(tool && !bestTool) || ', new: '' },
    { id: 'EF-9 the oldest wins', old: 'e.at >= best.at', new: 'e.at <= best.at' },
    { id: 'EF-10 the first match wins', old: 'if (best === null || (tool && !bestTool) || (tool === bestTool && e.at >= best.at))', new: 'if (best === null)' },
    { id: 'EF-11 an empty tool names every menu', old: "const tool = e.tool !== '' && text.includes(squeeze(e.tool));", new: 'const tool = text.includes(squeeze(e.tool));' },
    { id: 'EF-12 no menu is not checked', old: 'if (dialog === null || entries.length', new: 'if (entries.length' },
  ],
  suite: envelopeSuite,
};

export const PAINTED_SET: MutantSet<ApprovalEnvelopeModule> = {
  modulePath: ENVELOPE_TS,
  mutants: [
    { id: 'PA-1 no hook state is not checked', old: '  if (hs === null) return { ask: null, entry: null };\n', new: '' },
    { id: 'PA-2 hook state\'s own ask wins over the painted entry', old: 'if (entry === null) return { ask: hs.ask, entry: null };', new: 'if (entry === null || hs.ask !== null) return { ask: hs.ask, entry: null };' },
    { id: 'PA-3 no subagent mark', old: ", thread: 'subagent' as const,", new: ',' },
    { id: 'PA-4 the route is dropped', old: '...(entry.route === undefined ? {} : { route: entry.route }), ', new: '' },
    { id: 'PA-5 the entry is not reported', old: 'return { ask: { approval }, entry };', new: 'return { ask: { approval }, entry: null };' },
    { id: 'PA-6 the bound is 17', old: 'export const HOOK_APPROVALS_MAX = 16;', new: 'export const HOOK_APPROVALS_MAX = 17;' },
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
