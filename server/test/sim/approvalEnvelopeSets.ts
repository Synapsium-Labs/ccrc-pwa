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
    { id: 'EF-2 the title is not read', old: 'return { all: squeeze(`${d.title}\\n${text}`), blocks: commandBlocksOf(lines) };', new: 'return { all: squeeze(text), blocks: commandBlocksOf(lines) };' },
    { id: 'EF-3 the body is not read', old: 'const lines = (d.body ?? \'\').split(\'\\n\');', new: 'const lines = [\'\'];' },
    { id: 'EF-4 whitespace is kept', old: 's.replace(/\\s+/g, \'\')', new: 's.replace(/\\s+/g, \' \')' },
    { id: 'EF-5 a long summary must be painted whole', old: 'const head = n <= APPROVAL_MATCH_CHARS ? want : codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join(\'\');', new: 'const head = want;' },
    { id: 'EF-6 the match is 50 characters', old: 'export const APPROVAL_MATCH_CHARS = 60;', new: 'export const APPROVAL_MATCH_CHARS = 50;' },
    { id: 'EF-7 a short summary matches as a substring', old: '  if (n < APPROVAL_MATCH_MIN_CHARS) return null;\n', new: '' },
    { id: 'EF-8 the short bound is 10', old: 'export const APPROVAL_MATCH_MIN_CHARS = 12;', new: 'export const APPROVAL_MATCH_MIN_CHARS = 10;' },
    { id: 'EF-9 no command-block test', old: '  if (want !== \'\' && menu.blocks.includes(want)) return { exact: true, chars: n };\n', new: '' },
    { id: 'EF-10 an empty summary is a command block', old: 'want !== \'\' && menu.blocks.includes(want)', new: 'menu.blocks.includes(want)' },
    { id: 'EF-11 no 2.1.299 shape (review 2800 F2)', old: '  if (rules.length >= 2) return', new: '  if (rules.length >= 99) return' },
    { id: 'EF-12 the 2.1.299 gutter kept in the block', old: 'lines.slice(rules[0]! + 1, rules[1]).map((l) => l.replace(GUTTER, \'\')).join(\'\')', new: 'lines.slice(rules[0]! + 1, rules[1]).join(\'\')' },
    { id: 'EF-13 the 2.1.299 description inside the block', old: 'lines.slice(rules[0]! + 1, rules[1])', new: 'lines.slice(rules[0]! - 1, rules[1])' },
    { id: 'EF-14 the gutter kept in the text', old: 'const text = lines.map((l) => l.replace(GUTTER, \'\')).join(\'\\n\');', new: 'const text = lines.join(\'\\n\');' },
    { id: 'EF-15 another rule character', old: '/^\\s*╌+\\s*$/', new: '/^\\s*─+\\s*$/' },
    { id: 'EF-16 one space is deep', old: '/^\\s{2,}\\S/', new: '/^\\s{1,}\\S/' },
    { id: 'EF-17 a blank row ends the block (review 2800 F4)', old: '(isDeep(lines[start - 1]!) || lines[start - 1]!.trim() === \'\')', new: 'isDeep(lines[start - 1]!)' },
    { id: 'EF-18 the trimmed first row is never taken', old: '  if (start === 1 && isDeep(lines[1]!)) start = 0;\n', new: '' },
    { id: 'EF-19 the first row is always taken', old: 'if (start === 1 && isDeep(lines[1]!)) start = 0;', new: 'if (start === 1) start = 0;' },
    { id: 'EF-20 the description is never set aside', old: 'return [squeeze(rows.join(\'\')), squeeze(rows.slice(0, -1).join(\'\'))];', new: 'return [squeeze(rows.join(\'\'))];' },
    { id: 'EF-21 the whole run is never the block', old: 'return [squeeze(rows.join(\'\')), squeeze(rows.slice(0, -1).join(\'\'))];', new: 'return [squeeze(rows.slice(0, -1).join(\'\'))];' },
    { id: 'EF-22 a full 60-character match is not ranked first', old: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0, m.chars]', new: '[m.exact ? 1 : 0, m.chars]' },
    { id: 'EF-23 exactness is not ranked', old: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0, m.chars]', new: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.chars]' },
    { id: 'EF-24 length is not ranked', old: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0, m.chars]', new: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0, m.exact ? 1 : 0]' },
    { id: 'EF-25 a full match needs more than 60', old: '[m.chars >= APPROVAL_MATCH_CHARS ? 1 : 0,', new: '[m.chars > APPROVAL_MATCH_CHARS ? 1 : 0,' },
    { id: 'EF-26 the tool is not ranked', old: 'const rank = [...strengthOf(m), e.tool !== \'\' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, e.at];', new: 'const rank = [...strengthOf(m), e.at];' },
    { id: 'EF-27 the oldest wins', old: 'const rank = [...strengthOf(m), e.tool !== \'\' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, e.at];', new: 'const rank = [...strengthOf(m), e.tool !== \'\' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, -e.at];' },
    { id: 'EF-28 recency ranks first', old: 'const rank = [...strengthOf(m), e.tool !== \'\' && menu.all.includes(squeeze(e.tool)) ? 1 : 0, e.at];', new: 'const rank = [e.at, ...strengthOf(m), e.tool !== \'\' && menu.all.includes(squeeze(e.tool)) ? 1 : 0];' },
    { id: 'EF-29 the first match wins', old: 'if (best === null || compare(rank, best.rank) >= 0)', new: 'if (best === null)' },
    { id: 'EF-30 an empty tool names every menu', old: 'e.tool !== \'\' && menu.all.includes(squeeze(e.tool))', new: 'menu.all.includes(squeeze(e.tool))' },
    { id: 'EF-31 no menu is not checked', old: 'if (dialog === null || !approvalShapedMenu(dialog)) return null;', new: 'if (!approvalShapedMenu(dialog!)) return null;' },
    { id: 'EF-32 no ambiguous tie (review 2800 F1)', old: 'const isAmbiguous = (b: Best): boolean => isHeadTier(b.match) && b.agents.size > 1;', new: 'const isAmbiguous = (b: Best): boolean => false;' },
    { id: 'EF-33 an ambiguous tie at every tier', old: 'isHeadTier(b.match) && b.agents.size > 1', new: 'b.agents.size > 1' },
    { id: 'EF-34 an ambiguous tie within one agent', old: 'b.agents.size > 1', new: 'b.agents.size > 0' },
    { id: 'EF-35 a weaker match ties', old: 'live.filter((c) => compare(strengthOf(c.match), top) === 0)', new: 'live' },
    { id: 'EF-36 the head tier counts an exact match', old: 'm.chars >= APPROVAL_MATCH_CHARS && !m.exact', new: 'm.chars >= APPROVAL_MATCH_CHARS' },
    { id: 'EF-37 the head tier under 60', old: 'm.chars >= APPROVAL_MATCH_CHARS && !m.exact', new: 'm.chars >= 0 && !m.exact' },
    { id: 'EF-38 no age bound', old: 'now - e.at <= APPROVAL_ENTRY_MAX_AGE_MS && ', new: '' },
    { id: 'EF-39 the age bound excludes its edge', old: 'now - e.at <= APPROVAL_ENTRY_MAX_AGE_MS', new: 'now - e.at < APPROVAL_ENTRY_MAX_AGE_MS' },
    { id: 'EF-40 the age bound leaves the hook\'s wait out', old: 'APPROVAL_HOOK_WAIT_S * 1_000 + APPROVAL_MENU_ANSWER_MS;', new: 'APPROVAL_MENU_ANSWER_MS;' },
    { id: 'EF-41 the answer window is 10 minutes', old: 'export const APPROVAL_MENU_ANSWER_MS = 15 * 60 * 1_000;', new: 'export const APPROVAL_MENU_ANSWER_MS = 10 * 60 * 1_000;' },
    { id: 'EF-42 no bound ahead', old: ' && e.at - now <= APPROVAL_ENTRY_MAX_AHEAD_MS', new: '' },
    { id: 'EF-43 the bound ahead excludes its edge', old: 'e.at - now <= APPROVAL_ENTRY_MAX_AHEAD_MS', new: 'e.at - now < APPROVAL_ENTRY_MAX_AHEAD_MS' },
    { id: 'EF-44 the bound ahead is two minutes', old: 'export const APPROVAL_ENTRY_MAX_AHEAD_MS = 60 * 1_000;', new: 'export const APPROVAL_ENTRY_MAX_AHEAD_MS = 120 * 1_000;' },
    { id: 'EF-45 lengths count UTF-16 units', old: 'const n = codePoints(want).length;', new: 'const n = want.length;' },
    { id: 'EF-46 the head is cut in UTF-16 units', old: 'codePoints(want).slice(0, APPROVAL_MATCH_CHARS).join(\'\')', new: 'want.slice(0, APPROVAL_MATCH_CHARS)' },
  ],
  suite: envelopeSuite,
};

export const PAINTED_SET: MutantSet<ApprovalEnvelopeModule> = {
  modulePath: ENVELOPE_TS,
  mutants: [
    { id: 'PA-1 no hook state is not checked', old: '  if (hs === null) return NO_ENVELOPE;\n', new: '' },
    { id: 'PA-2 hook state\'s own approval never competes', old: '  if (own === null) return fromEntries();', new: '  if (true) return fromEntries();' },
    { id: 'PA-3 hook state\'s own approval for any menu', old: 'if (dialog === null || !approvalShapedMenu(dialog)) return kept;', new: 'if (dialog === null) return kept;' },
    { id: 'PA-4 no menu is not checked', old: 'if (dialog === null || !approvalShapedMenu(dialog)) return kept;', new: 'if (!approvalShapedMenu(dialog!)) return kept;' },
    { id: 'PA-5 hook state\'s own approval always matches', old: 'const ownMatch = matchOf(own.summary, menu);', new: 'const ownMatch = { exact: true, chars: 999 };' },
    { id: 'PA-6 hook state\'s own approval wins whatever the entry', old: '  if (order < 0) return fromEntries();\n', new: '' },
    { id: 'PA-7 a tie goes to the entry', old: 'if (order < 0) return fromEntries();', new: 'if (order <= 0) return fromEntries();' },
    { id: 'PA-8 no same-call entry', old: 'const same = hs.waitBy !== \'subagent\' ? undefined', new: 'const same = true ? undefined' },
    { id: 'PA-9 a same-call entry for the main thread too', old: 'const same = hs.waitBy !== \'subagent\' ? undefined', new: 'const same = false ? undefined' },
    { id: 'PA-10 the same call by any stamp', old: 'e.at === hs.updatedAt && ', new: '' },
    { id: 'PA-11 the same call by summary only', old: 'e.tool === own.tool && ', new: '' },
    { id: 'PA-12 the same call by tool only', old: 'e.summary === own.summary && ', new: '' },
    { id: 'PA-13 the same call of any age', old: ' && isLive(e, now));', new: ');' },
    { id: 'PA-14 no subagent mark', old: ', thread: \'subagent\' as const } },', new: ' } },' },
    { id: 'PA-15 the route is dropped', old: '...(entry.route === undefined ? {} : { route: entry.route }), ', new: '' },
    { id: 'PA-16 the entry is not reported', old: '  entry,\n});', new: '  entry: null,\n});' },
    { id: 'PA-17 the bound is 17', old: 'export const HOOK_APPROVALS_MAX = 16;', new: 'export const HOOK_APPROVALS_MAX = 17;' },
    { id: 'PA-18 an own ask\'s tie is never ambiguous (review 2800 F1)', old: 'if (best !== null && order === 0 && isHeadTier(ownMatch) && [...best.agents].some((a) => a !== (same?.agentId ?? \'\'))) return NO_ENVELOPE;', new: 'if (false) return NO_ENVELOPE;' },
    { id: 'PA-19 an own ask\'s tie is ambiguous at every tier', old: 'order === 0 && isHeadTier(ownMatch) && ', new: 'order === 0 && ' },
    { id: 'PA-20 an own ask\'s tie is ambiguous with its own agent', old: '[...best.agents].some((a) => a !== (same?.agentId ?? \'\'))', new: '[...best.agents].some(() => true)' },
    { id: 'PA-21 a stronger own ask is ambiguous', old: 'if (best !== null && order === 0 && isHeadTier', new: 'if (best !== null && isHeadTier' },
    { id: 'PA-22 an ambiguous tie of entries is shown', old: '(best === null ? kept : isAmbiguous(best) ? NO_ENVELOPE : entryAsk(best.entry))', new: '(best === null ? kept : entryAsk(best.entry))' },
    { id: 'PA-23 an unmatched own approval always stands (review 2800 F5)', old: 'return entries.some((e) => isLive(e, now) && e.agentId !== (same?.agentId ?? \'\')) ? NO_ENVELOPE : kept;', new: 'return kept;' },
    { id: 'PA-24 an unmatched own approval never stands', old: 'return entries.some((e) => isLive(e, now) && e.agentId !== (same?.agentId ?? \'\')) ? NO_ENVELOPE : kept;', new: 'return NO_ENVELOPE;' },
    { id: 'PA-25 a stale entry competes with an unmatched own approval', old: 'entries.some((e) => isLive(e, now) && e.agentId', new: 'entries.some((e) => e.agentId' },
    { id: 'PA-26 its own entry counts as another agent\'s', old: 'e.agentId !== (same?.agentId ?? \'\')) ? NO_ENVELOPE', new: 'e.agentId !== \'\') ? NO_ENVELOPE' },
    { id: 'PA-27 an unmatched own approval hides a matching entry', old: '    if (best !== null) return fromEntries();\n', new: '' },
  ],
  suite: envelopeSuite,
};

export const ITEM_OF_SET: MutantSet<UntrustedBuildItemModule> = {
  modulePath: ITEM_TS,
  mutants: [
    { id: 'UB-1 THE KEY dropped: an open item raises again', old: ' || openBuilds.has(version)) return null;', new: ') return null;' },
    { id: 'UB-2 a build ccrc still handles raises', old: ' || !captureGivenUp(row)', new: '' },
    { id: 'UB-3 no build to key it by raises', old: 'if (!isClaudeVersion(version) || ', new: 'if (' },
    { id: 'UB-4 a build being captured again raises', old: ' || !captureGivenUp(row)', new: " || captureStandingOf(row).kind === 'trusted'" },
    { id: 'UB-5 the action carries no key', old: 'action: { verb: UNTRUSTED_BUILD_VERB, build: version },', new: 'action: null,' },
    { id: 'UB-6 another programme', old: 'export const UNTRUSTED_BUILD_ITEM_PROGRAMME = OVERLORD_PROJECT;', new: "export const UNTRUSTED_BUILD_ITEM_PROGRAMME = 'linear-sync';" },
    { id: 'UB-7 the item blocks', old: "neededBy: 'soon'", new: "neededBy: 'now'" },
    { id: 'UB-9 the step links nothing', old: '`Open ${UNTRUSTED_BUILD_SETTINGS_PATH} and find', new: '`Open Settings › Automation and find' },
    { id: 'UB-10 the operator\'s act is not named', old: "'Once the cause is fixed (the test box, the replay tests, or ccrc\\'s readers for this build), choose Capture again. '", new: "'Once the cause is fixed, ccrc captures it again. '" },
    { id: 'UB-11 the count is not said', old: 'failed its capture ${times(row.fails)}, and ccrc', new: 'failed its capture, and ccrc' },
    { id: 'RA-1 a build no session runs raises', old: 'const input = givenUpToTell(r, versions) ?', new: 'const input = captureGivenUp(r) ?' },
    { id: 'RA-2 a pass raises nothing missing', old: 'return input === null ? [] : [input];', new: 'return [];' },
    { id: 'UB-8 any action is an untrusted-build item', old: 'return isUntrustedBuildAction(a) ? [{ id: i.id, build: a.build }] : [];', new: 'return a !== null ? [{ id: i.id, build: (a as { build: string }).build }] : [];' },
  ],
  suite: itemSuite,
};

export const ITEMS_TO_SETTLE_SET: MutantSet<UntrustedBuildItemModule> = {
  modulePath: ITEM_TS,
  mutants: [
    { id: 'ST-1 an unreadable record settles every item', old: 'if (records === null) return [];', new: "if (records === null) return open.map((i) => ({ ...i, note: '' }));" },
    { id: 'ST-2 every item settles', old: '    if (row !== undefined && captureGivenUp(row)) return [];\n', new: '' },
    { id: 'ST-3 only a captured build settles (the old rule)', old: 'if (row !== undefined && captureGivenUp(row)) return [];', new: "if (row === undefined || captureStandingOf(row).kind !== 'trusted') return [];" },
    { id: 'ST-4 one note for both', old: 'note: captured ? UNTRUSTED_BUILD_SETTLED_NOTES.captured : UNTRUSTED_BUILD_SETTLED_NOTES.handled', new: 'note: UNTRUSTED_BUILD_SETTLED_NOTES.captured' },
    { id: 'ST-5 an unrecorded build is given up', old: 'if (row !== undefined && captureGivenUp(row)) return [];', new: 'if (row === undefined || captureGivenUp(row)) return [];' },
  ],
  suite: itemSuite,
};

export const APPROVAL_ENVELOPE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/approvalEnvelope.ts#approvalEntryFor': ENTRY_FOR_SET as MutantSet<never>,
  'server/src/coord/approvalEnvelope.ts#paintedApprovalOf': PAINTED_SET as MutantSet<never>,
  'server/src/coord/untrustedBuildItem.ts#untrustedBuildItemOf': ITEM_OF_SET as MutantSet<never>,
  'server/src/coord/untrustedBuildItem.ts#untrustedBuildItemsToSettle': ITEMS_TO_SETTLE_SET as MutantSet<never>,
};
