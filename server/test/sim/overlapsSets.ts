// The overlaps deciders' mutant sets (Overlord W2, overlaps, plan w2-overlaps.md Task 1 Step 6 and Task 2 Step 7; the floors
// rule is D-8217's): each decider run against every case of `../overlapsCases.ts` that judges it, loaded over the mutated
// copy of server/src/coord/overlaps.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json. The plan's red checks: Task 1 Step 7 (O-1, G-3, G-4, G-5, G-1/G-2 and the step count, G-7/G-8) and
// Task 2 Step 8 (M-1, V-1, B-1, M-4, M-5, M-9, M-13 and M-12b, B-2). The time-budget case is slow and stays out of these sets.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_CASES, GOAL_CASES, MOVE_CASES, OVERLAP_CASES, VERDICT_CASES, type OverlapsCase, type OverlapsModule } from '../overlapsCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const OVERLAPS_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/overlaps.ts');
export const OVERLAP_SIGHTINGS_KEY = 'server/src/coord/overlaps.ts#overlapSightings';
export const GOAL_CONFLICT_SIGHTINGS_KEY = 'server/src/coord/overlaps.ts#goalConflictSightings';
export const PAIR_MOVES_KEY = 'server/src/coord/overlaps.ts#pairMoves';
export const RELAY_VERDICT_KEY = 'server/src/coord/overlaps.ts#relayConflictVerdict';
export const PAIR_BLOCKS_KEY = 'server/src/coord/overlaps.ts#pairBlocks';
export const BLOCKING_PAIRS_KEY = 'server/src/coord/overlaps.ts#blockingPairs';

const set = (cases: readonly OverlapsCase[], mutants: MutantSet<OverlapsModule>['mutants']): MutantSet<OverlapsModule> => ({
  modulePath: OVERLAPS_TS, mutants,
  suite: (m: OverlapsModule): Record<string, SuiteCase> => Object.fromEntries(cases.map((c) => [c.name, () => c.run(m)])),
});

// mergeEvidence is shared by the sighting deciders and pairMoves; its mutants are judged here, by the overlap cases.
export const OVERLAP_SIGHTINGS_SET = set(OVERLAP_CASES, [
  // The plan's red check: drop the "programme sets share a slug" rule.
  { id: 'O-1', old: 'if (s1.slugs.some((x) => s2.slugs.includes(x))) return;', new: '' },
  { id: 'O-2', old: 'if (s1.slugs.some((x) => s2.slugs.includes(x))) return;', new: 'if (s1.slugs.every((x) => s2.slugs.includes(x))) return;' },
  { id: 'O-3', old: "{ counts.unread++; return; }", new: "{ counts.unattributed++; return; }" },
  { id: 'O-4', old: "if (s1.kind === 'unattributed' || s2.kind === 'unattributed') { counts.unattributed++; return; }", new: "if (s1.kind === 'unattributed' || s2.kind === 'unattributed') { counts.unread++; return; }" },
  { id: 'O-5', old: 'if (s1.slugs.length === 0 || s2.slugs.length === 0) { counts.unattributed++; return; }', new: '' },
  { id: 'O-6', old: 'prs: distinctSorted([r.prA, r.prB], cmpNum),\n    }), now);', new: 'prs: distinctSorted([r.prA, r.prB], cmpNum),\n    }), 0);' },
  { id: 'O-7', old: 'pathsCut: r.pathsCut,', new: 'pathsCut: false,' },
  { id: 'O-8', old: 'paths: paths.slice(0, PAIR_PATHS_MAX),', new: 'paths,' },
  { id: 'O-9', old: '|| paths.length > PAIR_PATHS_MAX,', new: '|| paths.length >= PAIR_PATHS_MAX,' },
  { id: 'O-10', old: 'group.reduce((m, g) => Math.max(m, g.newestAt), group[0]!.newestAt)', new: 'group[0]!.newestAt' },
  { id: 'O-11', old: 'distinctSorted<PairSource>(parts.flatMap((p) => p.sources), cmpStr)', new: 'parts.flatMap((p) => p.sources)' },
  { id: 'O-12', old: 'claimIds: ids.slice(Math.max(0, ids.length - PAIR_PATHS_MAX)),', new: 'claimIds: ids,' },
  { id: 'O-13', old: '.sort((x, y) => cmpStr(x[0], y[0]))', new: '.sort(() => 0)' },
  { id: 'O-14', old: 'paths: distinctSorted([c.path, c.claimedPath], cmpStr), claimIds: [c.holderClaimId],', new: 'paths: [c.path], claimIds: [c.holderClaimId],' },
  { id: 'O-15', old: 'paths: distinctSorted([c.path, c.claimedPath], cmpStr), claimIds: [c.holderClaimId],', new: 'paths: distinctSorted([c.path, c.claimedPath], cmpStr), claimIds: [],' },
  { id: 'O-16', old: 'prs: distinctSorted([r.prA, r.prB], cmpNum),\n    }), now);', new: 'prs: distinctSorted([r.prA], cmpNum),\n    }), now);' },
  { id: 'O-17', old: "sources: ['claim-collision'],", new: "sources: ['radar']," },
  { id: 'O-18', old: 'pathsCut: parts.some((p) => p.pathsCut) ||', new: 'pathsCut:' },
  { id: 'O-19', old: 'prs: distinctSorted(parts.flatMap((p) => p.prs), cmpNum),', new: 'prs: parts.flatMap((p) => p.prs),' },
  { id: 'O-20', old: 'for (const c of collisions) {', new: 'for (const c of collisions.slice(1)) {' },
]);

export const GOAL_CONFLICT_SIGHTINGS_SET = set(GOAL_CASES, [
  // The plan's red checks: the window test with an inclusive edge dropped (G-1, G-2); pathsOverlap as string equality
  // (G-3); sighting on one triple (G-4); the hot threshold at four programmes (G-5); the step count dropped (G-7, G-8).
  { id: 'G-1', old: 'r.createdAt >= now - windowMs', new: 'r.createdAt > now - windowMs' },
  { id: 'G-2', old: 'r.createdAt <= now', new: 'r.createdAt < now' },
  { id: 'G-2b', old: 'r.createdAt >= now - windowMs', new: 'r.createdAt >= now - windowMs - 1' },
  { id: 'G-3', old: 'if (pathsOverlap(p, e.path)) {', new: 'if (p === e.path) {' },
  { id: 'G-3b', old: 'if (pathsOverlap(x, y)) overlapping.add(x);', new: 'if (x === y) overlapping.add(x);' },
  { id: 'G-4', old: 'const t2 = second.get(key);', new: 'const t2 = second.get(key) ?? t1;' },
  { id: 'G-5', old: 'if (set.size >= HOT_PATH_PROGRAMMES) hot.add(p);', new: 'if (set.size >= HOT_PATH_PROGRAMMES + 1) hot.add(p);' },
  { id: 'G-6', old: 'if (set.size >= HOT_PATH_PROGRAMMES) hot.add(p);', new: 'if (set.size >= HOT_PATH_PROGRAMMES - 1) hot.add(p);' },
  { id: 'G-7', old: 'if (steps >= stepsMax) { cut = true; return false; }', new: '' },
  { id: 'G-8', old: '    steps++;\n    return true;', new: '    return true;' },
  { id: 'G-9', old: 'if (a.createdAt < b.createdAt) e.L.push(a);', new: 'if (a.createdAt <= b.createdAt) e.L.push(a);' },
  { id: 'G-10', old: 'else if (a.createdAt > b.createdAt) e.R.push(a);', new: 'else e.R.push(a);' },
  { id: 'G-11', old: '(a1) => a1.createdAt >= t1.r3.createdAt', new: '(a1) => a1.createdAt > t1.r3.createdAt' },
  { id: 'G-12', old: 'cmpTuple(ordered(t), ordered(best)) < 0) first.set(key, t);', new: 'cmpTuple(ordered(t), ordered(best)) > 0) first.set(key, t);' },
  { id: 'G-13', old: 't.r3.createdAt !== best.r3.createdAt ? t.r3.createdAt > best.r3.createdAt', new: 't.r3.createdAt !== best.r3.createdAt ? t.r3.createdAt < best.r3.createdAt' },
  { id: 'G-14', old: 'triples: GOAL_CONFLICT_TRIPLES_MIN,', new: 'triples: 1,' },
  { id: 'G-15', old: 'r.all.filter((q) => hot.has(q))', new: 'r.all.filter((q) => !hot.has(q))' },
  { id: 'G-16', old: 'if (r.program === null) { counts.unattributed++; continue; }', new: 'if (r.program === null) { continue; }' },
  { id: 'G-17', old: "byProject.set(r.project, [...(byProject.get(r.project) ?? []), r]);", new: "byProject.set('x', [...(byProject.get('x') ?? []), r]);" },
  { id: 'G-18', old: '.filter((p) => !hot.has(p))', new: '.filter(() => true)' },
  { id: 'G-19', old: 'for (const anc of ancestorsOf(p)) candidates.push(...(exact.get(anc) ?? []));', new: '' },
  { id: 'G-20', old: '...(under.get(p) ?? [])', new: '' },
  { id: 'G-21', old: 'if (nbSet[a3.idx]!.has(a1.idx)) { hit = a1; break; }\n          }\n          if (hit === null) continue;\n          const t: Triple = { r1: hit, r2: b, r3: a3 };\n          if (best === undefined || cmpTuple', new: 'if (true) { hit = a1; break; }\n          }\n          if (hit === null) continue;\n          const t: Triple = { r1: hit, r2: b, r3: a3 };\n          if (best === undefined || cmpTuple' },
  { id: 'G-22', old: 'const start = L.filter((a1) => a1.createdAt >= t1.r3.createdAt);', new: 'const start = L;' },
  { id: 'G-24', old: 'const nb = nbSet.map((s) => [...s].sort(cmpNum));', new: 'const nb = nbSet.map((s) => [...s].sort(() => 0));' },
  { id: 'G-25', old: 'pathsCut: sortedPaths.length > PAIR_PATHS_MAX,', new: 'pathsCut: false,' },
  { id: 'G-26', old: 'claimIds: distinctSorted(trio.map((r) => r.claimId), cmpNum).slice(-PAIR_PATHS_MAX),', new: 'claimIds: [],' },
  { id: 'G-27', old: "key: pairKey, kind: 'goal-conflict', a: p.a, b: p.b, newestAt: t2.r3.createdAt,", new: "key: pairKey, kind: 'goal-conflict', a: p.a, b: p.b, newestAt: t1.r3.createdAt," },
]);

export const PAIR_MOVES_SET = set(MOVE_CASES, [
  // The plan's red checks: lapse at 23 hours (M-1); skip rule 2 for a ruled pair (M-4); drop rule 3 (M-5); drop rule 7's
  // "newer than ruledAt" (M-9); let rule 12 lapse a ruled episode (M-13), or one with an open run (M-15).
  { id: 'M-1', old: 'facts.now - row.lastSeenAt >= OVERLAP_LAPSE_HOURS * HOUR_MS', new: 'facts.now - row.lastSeenAt >= (OVERLAP_LAPSE_HOURS - 1) * HOUR_MS' },
  { id: 'M-2', old: 'facts.now - row.lastSeenAt >= OVERLAP_LAPSE_HOURS * HOUR_MS', new: 'facts.now - row.lastSeenAt > OVERLAP_LAPSE_HOURS * HOUR_MS' },
  { id: 'M-3', old: 'row !== undefined && facts.overlapSourcesRead', new: 'row !== undefined' },
  { id: 'M-4', old: "if (row !== undefined) close.push({ id: row.id, why: 'programme-ended' });", new: "if (row !== undefined && row.ruled === null) close.push({ id: row.id, why: 'programme-ended' });" },
  { id: 'M-5', old: 'if (!liveA || !liveB) {', new: 'if ((!liveA || !liveB) && row !== undefined) {' },
  { id: 'M-6', old: "if (liveA === 'unmeasured' || liveB === 'unmeasured') continue;", new: '' },
  { id: 'M-7', old: "if (sa === 'unmeasured' || sb === 'unmeasured') continue;", new: 'if (false) continue;' },
  { id: 'M-8', old: 'Math.max(newestEpisode.get(key) ?? 0, row?.episode ?? 0) + 1', new: 'Math.max(0, row?.episode ?? 0) + 1' },
  { id: 'M-9', old: "row.ruled !== 'unreadable' && sight.newestAt > row.ruled.at", new: "row.ruled !== 'unreadable'" },
  { id: 'M-9b', old: 'sight.newestAt > row.ruled.at', new: 'sight.newestAt >= row.ruled.at' },
  { id: 'M-10', old: 'if (sa !== row.goalsA || sb !== row.goalsB) {', new: 'if (sa !== row.goalsA && sb !== row.goalsB) {' },
  { id: 'M-10b', old: 'if (sa !== row.goalsA || sb !== row.goalsB) {', new: 'if (sa !== row.goalsA) {' },
  { id: 'M-11', old: 'open.push({ sighting: sight, episode: nextEpisode, goalsA: sa, goalsB: sb });\n        continue;', new: 'continue;' },
  { id: 'M-12', old: 'evidence: merged()!, goalsA: sa, goalsB: sb }', new: 'evidence: merged()! }' },
  { id: 'M-12b', old: "if (sa === 'unmeasured' || sb === 'unmeasured') {\n        refresh.push", new: 'if (false) {\n        refresh.push' },
  { id: 'M-13', old: 'row.ruled === null && facts.goalHistoryRead', new: 'facts.goalHistoryRead' },
  { id: 'M-14', old: 'facts.now - row.lastSeenAt >= GOAL_CONFLICT_WINDOW_DAYS * DAY_MS', new: 'facts.now - row.lastSeenAt > GOAL_CONFLICT_WINDOW_DAYS * DAY_MS' },
  { id: 'M-14b', old: 'facts.now - row.lastSeenAt >= GOAL_CONFLICT_WINDOW_DAYS * DAY_MS', new: 'facts.now - row.lastSeenAt >= (GOAL_CONFLICT_WINDOW_DAYS - 1) * DAY_MS' },
  { id: 'M-15', old: 'facts.openRun(parsed.a) === false && facts.openRun(parsed.b) === false', new: 'facts.openRun(parsed.a) !== true && facts.openRun(parsed.b) !== true' },
  { id: 'M-15b', old: 'facts.openRun(parsed.a) === false && facts.openRun(parsed.b) === false', new: 'facts.openRun(parsed.a) === false || facts.openRun(parsed.b) === false' },
  { id: 'M-15c', old: 'facts.openRun(parsed.a) === false && facts.openRun(parsed.b) === false', new: 'facts.openRun(parsed.a) === false' },
  { id: 'M-16', old: 'row.ruled === null && facts.goalHistoryRead', new: 'row.ruled === null' },
  { id: 'M-17', old: 'Math.max(row?.lastSeenAt ?? 0, sight?.newestAt ?? 0)', new: 'facts.now' },
  { id: 'M-17b', old: 'Math.max(row?.lastSeenAt ?? 0, sight?.newestAt ?? 0)', new: 'sight?.newestAt ?? 0' },
  { id: 'M-18', old: "if (parsed.kind === 'overlap') {", new: 'if (false) {' },
  { id: 'M-19', old: 'if (have === undefined || r.episode > have.episode)', new: 'if (have === undefined || r.episode < have.episode)' },
  { id: 'M-20', old: "row !== undefined && row.evidence !== 'unreadable'\n        ? mergeEvidence", new: 'false\n        ? mergeEvidence' },
  { id: 'M-21', old: 'if (row.ruled === null) {\n      const sa', new: 'if (row.ruled !== null) {\n      const sa' },
  { id: 'M-22', old: 'row.goalsA === null || row.goalsB === null', new: 'false' },
  { id: 'M-23', old: 'distinctSorted([...rowOf.keys(), ...sightOf.keys()], cmpStr)', new: '[...new Set([...rowOf.keys(), ...sightOf.keys()])]' },
  { id: 'M-24', old: 'open.push({ sighting: sight, episode: nextEpisode, goalsA: null, goalsB: null });', new: "open.push({ sighting: sight, episode: nextEpisode, goalsA: 'x', goalsB: null });" },
  { id: 'M-25', old: 'if (parsed === null) continue;\n    const nextEpisode', new: 'const nextEpisode' },
  { id: 'M-26', old: "refresh.push({ id: row.id, lastSeenAt: seenAt(), evidence: merged()! });                              // rule 10", new: '' },
  { id: 'M-27', old: 'if (sa === \'unmeasured\' || sb === \'unmeasured\' || row.goalsA === null', new: 'if (row.goalsA === null' },
]);

export const RELAY_VERDICT_SET = set(VERDICT_CASES, [
  // The plan's red check: an unreadable ruling passes (V-1).
  { id: 'V-1', old: "ruled === 'unreadable' || !Object.hasOwn(GOAL_CONFLICT_CHOICES, ruled.choice)) return refuse('ruling-unreadable');", new: "ruled === 'unreadable' || !Object.hasOwn(GOAL_CONFLICT_CHOICES, ruled.choice)) continue;" },
  { id: 'V-2', old: ' || !Object.hasOwn(GOAL_CONFLICT_CHOICES, ruled.choice)', new: '' },
  { id: 'V-3', old: "if (ruled === null) return refuse('unruled');", new: 'if (ruled === null) continue;' },
  { id: 'V-4', old: 'if (waits !== targetSide) continue;', new: '' },
  { id: 'V-5', old: "const other = targetSide === 'a' ? pair.b : pair.a;", new: "const other = targetSide === 'a' ? pair.a : pair.b;" },
  { id: 'V-6', old: 'if (landed === true) continue;', new: "if (landed !== false) continue;" },
  { id: 'V-7', old: "refuse(landed === false ? 'waits-for-landing' : 'landing-unmeasured')", new: "refuse(landed === false ? 'landing-unmeasured' : 'waits-for-landing')" },
  { id: 'V-8', old: 'landedSince(other, ruled.at)', new: 'landedSince(other, 0)' },
  { id: 'V-9', old: 'key: pair.key, episode: pair.episode, why })', new: 'key: pair.key, episode: 0, why })' },
  { id: 'V-10', old: 'for (const pair of blockingPairs(standing, relay)) {', new: 'for (const pair of standing) {' },
  { id: 'V-11', old: "const targetSide = relay.target === pair.a ? 'a' : 'b';", new: "const targetSide = relay.target === pair.a ? 'b' : 'a';" },
  { id: 'V-12', old: "if (waits !== targetSide) continue;", new: "if (waits === targetSide) continue;" },
  { id: 'V-13', old: "ok: false, word: 'goal-conflict-open', key: pair.key,", new: "ok: false, word: 'goal-conflict-open', key: 'x',", },
  { id: 'V-14', old: "    return refuse(landed === false", new: "    if (landed === 'unmeasured') continue;\n    return refuse(landed === false" },
]);

export const PAIR_BLOCKS_SET = set(BLOCK_CASES, [
  // The plan's red checks: empty expectedPaths do not block (B-1); a one-triple goal conflict passes (B-2).
  { id: 'B-1', old: 'if (relay.expectedPaths.length === 0) return true;', new: 'if (relay.expectedPaths.length === 0) return false;' },
  { id: 'B-2', old: "if (ev !== 'unreadable' && ev.triples < GOAL_CONFLICT_TRIPLES_MIN) return false;", new: '' },
  { id: 'B-2b', old: "ev.triples < GOAL_CONFLICT_TRIPLES_MIN) return false;", new: "ev.triples <= GOAL_CONFLICT_TRIPLES_MIN) return false;" },
  { id: 'B-2c', old: "if (ev !== 'unreadable' && ev.triples < GOAL_CONFLICT_TRIPLES_MIN) return false;", new: "if (ev === 'unreadable' || ev.triples < GOAL_CONFLICT_TRIPLES_MIN) return false;" },
  { id: 'B-3', old: 'if (relay.target !== pair.a && relay.target !== pair.b) return false;', new: '' },
  { id: 'B-3b', old: 'if (relay.target !== pair.a && relay.target !== pair.b) return false;', new: 'if (relay.target !== pair.a) return false;' },
  { id: 'B-4', old: "if (pair.kind !== 'goal-conflict') return false;", new: '' },
  { id: 'B-5', old: "if (ev === 'unreadable' || ev.pathsCut) return true;", new: "if (ev === 'unreadable' || false) return true;" },
  { id: 'B-5b', old: "if (ev === 'unreadable' || ev.pathsCut) return true;", new: "if (ev !== 'unreadable' && ev.pathsCut) return true;" },
  { id: 'B-6', old: 'relay.expectedPaths.some((x) => ev.paths.some((y) => pathsOverlap(x, y)))', new: 'relay.expectedPaths.some((x) => ev.paths.some((y) => x === y))' },
  { id: 'B-7', old: 'relay.expectedPaths.some((x) => ev.paths.some((y) => pathsOverlap(x, y)))', new: 'relay.expectedPaths.every((x) => ev.paths.some((y) => pathsOverlap(x, y)))' },
]);

export const BLOCKING_PAIRS_SET = set(BLOCK_CASES, [
  { id: 'BP-1', old: '.sort((x, y) => cmpStr(x.key, y.key) || x.episode - y.episode)', new: '.sort(() => 0)' },
  { id: 'BP-2', old: '.sort((x, y) => cmpStr(x.key, y.key) || x.episode - y.episode)', new: '.sort((x, y) => cmpStr(x.key, y.key))' },
  { id: 'BP-3', old: 'standing.filter((p) => pairBlocks(p, relay))', new: 'standing.filter((p) => !pairBlocks(p, relay))' },
  { id: 'BP-4', old: 'standing.filter((p) => pairBlocks(p, relay))', new: '[...standing]' },
  { id: 'BP-5', old: 'standing.filter((p) => pairBlocks(p, relay))', new: 'standing.filter((p) => pairBlocks(p, relay)).slice(1)' },
]);

export const OVERLAPS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [OVERLAP_SIGHTINGS_KEY]: OVERLAP_SIGHTINGS_SET as MutantSet<never>,
  [GOAL_CONFLICT_SIGHTINGS_KEY]: GOAL_CONFLICT_SIGHTINGS_SET as MutantSet<never>,
  [PAIR_MOVES_KEY]: PAIR_MOVES_SET as MutantSet<never>,
  [RELAY_VERDICT_KEY]: RELAY_VERDICT_SET as MutantSet<never>,
  [PAIR_BLOCKS_KEY]: PAIR_BLOCKS_SET as MutantSet<never>,
  [BLOCKING_PAIRS_KEY]: BLOCKING_PAIRS_SET as MutantSet<never>,
};
