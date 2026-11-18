// The portfolio's mutant sets (Overlord W1, portfolio, plan w1-portfolio.md Task 1 Step 6; the floors rule is D-8217's):
// `portfolioOrder`, `itemWaitMs` and `portfolioFor`, each run against every case of `../portfolioCases.ts` loaded over the
// mutated copy of server/src/coord/portfolio.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json. The plan's red checks are P-ORDER-1, P-WAIT-1, P-WAIT-2 and P-FOR-1 to P-FOR-4.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PORTFOLIO_CASES, type PortfolioModule } from '../portfolioCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const PORTFOLIO_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/portfolio.ts');
export const PORTFOLIO_ORDER_KEY = 'server/src/coord/portfolio.ts#portfolioOrder';
export const PORTFOLIO_ITEM_WAIT_KEY = 'server/src/coord/portfolio.ts#itemWaitMs';
export const PORTFOLIO_FOR_KEY = 'server/src/coord/portfolio.ts#portfolioFor';

const suite = (m: PortfolioModule): Record<string, SuiteCase> =>
  Object.fromEntries(ALL_PORTFOLIO_CASES.map((c) => [c.name, () => c.run(m)]));

const set = (mutants: MutantSet<PortfolioModule>['mutants']): MutantSet<PortfolioModule> => ({ modulePath: PORTFOLIO_TS, mutants, suite });

export const PORTFOLIO_ORDER_SET = set([
  // The plan's red check: unranked programmes before ranked `standard` ones.
  { id: 'P-ORDER-1', old: 'out.push(...unranked.map((p) => p.slug));', new: 'out.splice(out.length - ranked.length, 0, ...unranked.map((p) => p.slug));' },
  { id: 'P-ORDER-2', old: 'a.r.position - b.r.position', new: 'b.r.position - a.r.position' },
  { id: 'P-ORDER-3', old: 'a.createdAt - b.createdAt ||', new: 'b.createdAt - a.createdAt ||' },
  { id: 'P-ORDER-4', old: 'cmp(a.slug, b.slug)', new: 'cmp(b.slug, a.slug)' },
  { id: 'P-ORDER-5', old: 'for (const cls of SERVICE_CLASSES)', new: 'for (const cls of [...SERVICE_CLASSES].reverse())' },
  { id: 'P-ORDER-6', old: 'row !== undefined && row.cls !== null ?', new: 'row !== undefined ?' },
]);

export const PORTFOLIO_ITEM_WAIT_SET = set([
  // The plan's red checks: count `checking` time as operator wait; drop the 28-day clip.
  { id: 'P-WAIT-1', old: "const toOpen = ITEM_TRANSITIONS[e.act].to === 'open';", new: "const toOpen = ITEM_TRANSITIONS[e.act].to === 'open' || ITEM_TRANSITIONS[e.act].to === 'checking';" },
  { id: 'P-WAIT-2', old: 'const lo = Math.max(from, shownAt);', new: 'const lo = shownAt;' },
  { id: 'P-WAIT-3', old: 'const lo = Math.max(from, shownAt);', new: 'const lo = from;' },
  { id: 'P-WAIT-4', old: "if (!isItemAct(e.act) && !isItemNonMove(e.act)) return 'unmeasured';", new: "if (false) return 'unmeasured';" },
  { id: 'P-WAIT-5', old: 'if (shownAt === null) return 0;', new: 'if (shownAt === null) return to - from;' },
  { id: 'P-WAIT-6', old: 'if (openSince !== null) total += clipped(openSince, to, lo, to);', new: '' },
  { id: 'P-WAIT-7', old: 'else if (openSince === null && toOpen) openSince = e.at;', new: 'else if (false) openSince = e.at;' },
]);

export const PORTFOLIO_FOR_SET = set([
  // The plan's red checks: answer 0 for an empty cycle series; count a review run as a wave; count a parent's answer;
  // count a released ask that is not live up to now. P-FOR-20 to P-FOR-27 are the fix round's (review 2130, F3 and F4), and
  // P-FOR-28 to P-FOR-33 portfolio B's (its F10).
  { id: 'P-FOR-1', old: 'series.length === 0 ? { n: 0, medianMs: null, p85Ms: null }', new: 'series.length === 0 ? { n: 0, medianMs: 0, p85Ms: 0 }' },
  { id: 'P-FOR-3', old: 'if (a.answeredBy !== ASK_OPERATOR_PRINCIPAL) return null;', new: 'if (false) return null;' },
  { id: 'P-FOR-4', old: 'if (a.live === true) return clipped', new: 'if (true) return clipped' },
  { id: 'P-FOR-5', old: "if (a.state === 'stale' || a.releasedAt === null) return null;", new: 'if (a.releasedAt === null) return null;' },
  { id: 'P-FOR-6', old: 'return ranked && runs.some(', new: 'return runs.some(' },
  { id: 'P-FOR-7', old: 'r.closedAt !== null && r.closedAt >= now - WINDOW_MS)', new: 'r.closedAt !== null)' },
  { id: 'P-FOR-8', old: "w.bucket === 'failed' && w.rep.closeDetail === NEVER_STARTED_DETAIL", new: "w.bucket === 'failed'" },
  { id: 'P-FOR-10', old: 'return shownAt !== null && shownAt <= now;', new: 'return true;' },
  { id: 'P-FOR-11', old: 'asks: asks.filter((a) => a.live === true).length', new: 'asks: asks.length' },
  { id: 'P-FOR-13', old: '...(rank !== undefined && readable === null ? { rankUnreadable: true as const } : {}),', new: '' },
  { id: 'P-FOR-14', old: 'now - Math.min(...started)', new: 'now - Math.max(...started)' },
  { id: 'P-FOR-15', old: 'r.reviews !== null && doneRunIds.has(r.reviews)', new: 'r.reviews !== null' },
  { id: 'P-FOR-16', old: 'closedSince(w, now - WEEK_MS)', new: 'closedSince(w, now - WINDOW_MS)' },
  { id: 'P-FOR-17', old: 'clipped(a.releasedAt, a.answeredAt, from, to)', new: 'a.answeredAt - a.releasedAt' },
  { id: 'P-FOR-18', old: "if (a.state === 'released' || a.state === 'declined') {", new: "if (a.state === 'released') {" },
  // answering-or-unknown-ask-is-unmeasured, one mutant per arm; asks-unmeasured-is-windowed; the inclusive window edges.
  { id: 'P-FOR-20', old: "return a.answeredAt === null ? 'unmeasured' :", new: 'return a.answeredAt === null ? null :' },
  { id: 'P-FOR-21', old: "  // not know reached the operator, and no signal shows its end.\n  return 'unmeasured';", new: "  // not know reached the operator.\n  if (a.state === 'answering') return null;\n  return 'unmeasured';" },
  { id: 'P-FOR-22', old: "  // not know reached the operator, and no signal shows its end.\n  return 'unmeasured';", new: "  // not know reached the operator.\n  if (a.state !== 'answering') return null;\n  return 'unmeasured';" },
  { id: 'P-FOR-23', old: "if (a.live !== 'unmeasured' && a.releasedAt < from) return null;", new: '' },
  { id: 'P-FOR-24', old: "a.live !== 'unmeasured' && a.releasedAt < from", new: 'a.releasedAt < from' },
  { id: 'P-FOR-25', old: 'a.releasedAt < from) return null;', new: 'a.releasedAt <= from) return null;' },
  { id: 'P-FOR-26', old: 'w.rep.closedAt >= t', new: 'w.rep.closedAt > t' },
  { id: 'P-FOR-27', old: 'r.closedAt >= now - WINDOW_MS', new: 'r.closedAt > now - WINDOW_MS' },
  // Portfolio B, review 2130 F10: durations never negative, and a rebuilt wave never aged or timed from its stand-in.
  { id: 'P-FOR-29', old: 'Math.max(0, now - Math.min(...started))', new: '(now - Math.min(...started))' },
  { id: 'P-FOR-30', old: 'const started = open.filter((w) => !rebuiltWave(w))', new: 'const started = open' },
  { id: 'P-FOR-32', old: 'oldestOpenUnmeasured: open.filter(rebuiltWave).length,', new: 'oldestOpenUnmeasured: 0,' },
  // W2's measures (forecasts B, Task 8): the shown row, F9's own reading, the spend read's unmeasured counts and dedupe.
  { id: 'P-FOR-W1', old: "if (f.kind === 'unforecastable') return { kind: 'unforecastable', reason: f.reason, sealedAt: seal.sealedAt };", new: '' },
  { id: 'P-FOR-W2', old: "row.state === 'measured' && row.cost !== null) add(row.class, row.cost); else runsUnmeasured += 1;", new: "row.cost !== null) add(row.class, row.cost); else runsUnmeasured += 1;" },
  { id: 'P-FOR-W3', old: 'add(row.class, row.cost); else runsUnmeasured += 1;', new: 'add(row.class, row.cost); else add(null, 0);' },
  { id: 'P-FOR-W4', old: 'if (counted.has(l.sessionId)) continue;', new: '' },
  { id: 'P-FOR-W5', old: "!l.reading.stale && l.reading.cost", new: 'l.reading.cost' },
  { id: 'P-FOR-W6', old: 'if (fresh === null) { runsUnmeasured += 1; continue; }', new: 'if (fresh === null) continue;' },
  { id: 'P-FOR-W7', old: 'if (!openSpend.has(l.runId)) continue;', new: 'if (!ids.has(l.runId)) continue;' },
  { id: 'P-FOR-W8', old: 'r.dispatchedAt !== null && !liveIds', new: '!liveIds' },
  { id: 'P-FOR-W9', old: '&& !liveIds.has(r.id)) runsUnmeasured += 1;', new: '&& false) runsUnmeasured += 1;' },
  { id: 'P-FOR-W10', old: '...(health === undefined ? {} : { health: { word: health.word, evidence: health.evidence, at: health.at } }),', new: '' },
  { id: 'P-FOR-W11', old: 'const forecast = forecastEntry(seals[seals.length - 1]);', new: 'const forecast = forecastEntry(seals[0]);' },
  { id: 'P-FOR-W12', old: "if (!SPEND_KINDS.includes(r.kind) || isOpenRun(r)) continue;", new: 'if (isOpenRun(r)) continue;' },
  // Clearing shipped (#3002): the entry's flag and the critical path's walk read it.
  { id: 'P-FOR-W13', old: 'clearingShipped: EDGE_CLEARING_SHIPPED },', new: 'clearingShipped: false },' },
  { id: 'P-FOR-W14', old: '      EDGE_CLEARING_SHIPPED),', new: '      false),' },
]);

export const PORTFOLIO_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PORTFOLIO_ORDER_KEY]: PORTFOLIO_ORDER_SET as MutantSet<never>,
  [PORTFOLIO_ITEM_WAIT_KEY]: PORTFOLIO_ITEM_WAIT_SET as MutantSet<never>,
  [PORTFOLIO_FOR_KEY]: PORTFOLIO_FOR_SET as MutantSet<never>,
};
