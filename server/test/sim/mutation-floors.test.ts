// Mutation floors for deciders (Overlord W1a, D-8217): each decider's textual mutants run against its exhaustive test or
// seeded scenario, and its score may only rise. A new L1 decider adds one entry to MUTANT_SETS and one floor.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { mergeBaseText } from '../mergeBase.js';
import { COORD_BLOCKED_INVARIANTS, coordBlockedDay, type CoordBlockedModule } from './coordBlockedDay.js';
import { floorsFallen, rewriteRelativeImports, runMutants, type MutantSet, type SuiteCase } from './mutate.js';
import { FACE_MUTANT_SETS } from './faceSets.js';
import { MAIL_PACE_MUTANT_SETS } from './mailPaceSets.js';
import { LAUNCH_PROFILE_MUTANT_SETS } from './launchProfileSets.js';
import { COMPACTION_MUTANT_SETS } from './compactionSets.js';
import { RENEWAL_MUTANT_SETS } from './renewalDeciderSets.js';
import { GENERATION_START_MUTANT_SETS } from './generationStartSets.js';
import { PROBE_MUTANT_SETS } from './probeSets.js';
import { simulate } from './run.js';
import {
  CARD_BLOCK_KEY, CARD_BLOCK_SET, CARD_NEVER_EMPTY_KEY, CARD_NEVER_EMPTY_SET, CARD_ONE_LINE_KEY, CARD_ONE_LINE_SET, CARD_TRIM_KEY,
  CARD_TRIM_SET,
} from './cardMutants.js';
import { counterSuite, type Counter } from '../continuityCompactionsCases.js';

interface CompactionsModule { compactionsSince: Counter }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const FLOORS = JSON.parse(readFileSync(path.join(HERE, 'mutation-floors.json'), 'utf8')) as Record<string, number>;
const KEY = 'server/src/coord/stall.ts#stallCoordBlockedStep';
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);

const COORD_BLOCKED_SET: MutantSet<CoordBlockedModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/stall.ts'),
  mutants: [
    { id: 'M1', old: 'if (now - oldest.since < COORD_BLOCKED_HELD_MS) return 0;', new: 'if (now - oldest.since < COORD_BLOCKED_OLD_MS) return 0;' },
    { id: 'M2', old: 'Math.max(prev.rung, stallCoordRungNow(si, oldest, now))', new: 'stallCoordRungNow(si, oldest, now)' },
    { id: 'M3', old: 'input.episode ?? { since: oldest.since, rung: 0 }', new: '{ since: oldest.since, rung: 0 }' },
    { id: 'M4', old: 'if (oldest === undefined) return closed;', new: 'if (oldest === undefined) return { verdict: VERDICT_NONE, episode: input.episode };' },
    // M5 and M6 came from review run 1796: the decider hands back no episode, and the push comes one sweep late.
    { id: 'M5', old: "rung: 2, key: prev.since, to: 'operator' },\n    episode,", new: "rung: 2, key: prev.since, to: 'operator' },\n    episode: null," },
    { id: 'M6', old: 'if (now - oldest.since < COORD_BLOCKED_HELD_MS) return 0;', new: 'if (now - oldest.since <= COORD_BLOCKED_HELD_MS) return 0;' },
  ],
  suite(mod) {
    const cases: Record<string, SuiteCase> = {};
    for (const seed of SEEDS) {
      cases[`seed ${seed}`] = async () => {
        const r = await simulate(coordBlockedDay(mod), seed, COORD_BLOCKED_INVARIANTS);
        if (r.violations.length > 0) throw new Error(`${r.violations[0]!.invariant}: ${r.violations[0]!.message}`);
      };
    }
    return cases;
  },
};

// Overlord W1a, context readings: the compaction counter, against the very cases its suite asserts.
const COMPACTIONS_KEY = 'server/src/continuity/compactions.ts#compactionsSince';
const COMPACTIONS_SET: MutantSet<CompactionsModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/compactions.ts'),
  mutants: [
    { id: 'C1 pair across triggers', old: 'return pre.trigger === post.trigger\n    && ', new: 'return ' },
    { id: 'C2 window <= to <', old: 'post.at - pre.at <= COMPACTION_PAIR_MS', new: 'post.at - pre.at < COMPACTION_PAIR_MS' },
    { id: 'C3 count posts only', old: 'return pres.length + posts.length - matched;', new: 'return posts.length;' },
    { id: 'C4 transcripts ignored', old: '(pre.transcript === null || post.transcript === null || pre.transcript === post.transcript)', new: 'true' },
    { id: 'C5 since exclusive', old: 'l.at >= sinceMs && ', new: 'l.at > sinceMs && ' },
    { id: 'C6 a post before its pre pairs', old: 'post.at >= pre.at && ', new: '' },
    { id: 'C7 every scope counted', old: " && l.scope === 'main'", new: '' },
    { id: 'C8 a refused line counted as a pre', old: "kept.filter((l) => l.phase === 'pre')", new: "kept.filter((l) => l.phase !== 'post')" },
    { id: 'C9 first-found pairing, not maximum', old: 'if (preOf[i] === -1 || augment(preOf[i]!, seen))', new: 'if (preOf[i] === -1)' },
  ],
  suite: (mod) => counterSuite(mod.compactionsSince),
};

// #2726: the peer bound's decider (plan docs/superpowers/plans/2026-11-10-overlord/w1a-invited-replies.md, Task 6). Its
// suite is the decider's own cases, run over the loaded module; every mutant must be killed.
type PeerBoundModule = typeof import('../../src/coord/peerBound.js');
const PEER_KEY = 'server/src/coord/peerBound.ts#peerMailVerdict';
const PEER_SET: MutantSet<PeerBoundModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/peerBound.ts'),
  mutants: [
    { id: 'P1', old: 'if (f.outstanding >= PEER_MAIL_MAX_OUTSTANDING) {', new: 'if (f.outstanding > PEER_MAIL_MAX_OUTSTANDING) {' },
    { id: 'P2', old: 'if (f.hourAts.length >= PEER_MAIL_HOURLY) {', new: 'if (f.hourAts.length > PEER_MAIL_HOURLY) {' },
    { id: 'P3', old: 'f.hourAts[f.hourAts.length - PEER_MAIL_HOURLY]!', new: 'f.hourAts[0]!' },
    { id: 'P4', old: 'if (inv.invited) return', new: 'if (inv.invited && !f.duplicate) return' },
    { id: 'P5', old: 'if (f.duplicate) {', new: 'if (f.duplicate && f.outstanding < PEER_MAIL_MAX_OUTSTANDING) {' },
    { id: 'C1', old: 'if (inv === null) return', new: 'if (inv === null && f.kind !== \'answer\') return' },
    { id: 'C2', old: "if (f.kind !== 'answer') return", new: 'if (false) return' },
    { id: 'C3', old: 'if (inv.invitee !== f.fromId) return', new: 'if (false) return' },
    { id: 'C4', old: 'if (inv.inviter !== f.toId) return', new: 'if (false) return' },
    { id: 'C5', old: 'if (inv.answered) return', new: 'if (false) return' },
    // Review 1907 F1: only an unasked mail invites, and never one to oneself.
    { id: 'C6', old: 'if (inv.inviter === inv.invitee) return', new: 'if (false) return' },
    { id: 'C7', old: 'if (inv.isReply) return', new: 'if (false) return' },
    { id: 'R1', old: "retry: { on: 'ack', toId: f.toId }", new: "retry: { on: 'ack', toId: f.fromId }" },
    { id: 'H1', old: 'const hint = inv.why !== null ? notInvited', new: 'const hint = inv.why === null ? notInvited' },
  ],
  suite(mod) {
    const NOW = 1_800_000_000_000;
    const HOUR = 3_600_000;
    const INVITE = { mailId: 41, inviter: 'demo-calm-ridge', invitee: 'demo-quiet-mesa', isReply: false, answered: false };
    type Facts = Parameters<PeerBoundModule['peerMailVerdict']>[0];
    const f = (over: Partial<Facts> = {}): Facts => ({ fromId: 'demo-quiet-mesa', toId: 'demo-calm-ridge',
      kind: 'question', inReplyTo: null, invitation: null, duplicate: false, outstanding: 0, hourAts: [], now: NOW, ...over });
    const ats = (n: number): number[] => Array.from({ length: n }, (_, i) => NOW - HOUR + 1_000 * (i + 1));
    const v = (over: Partial<Facts> = {}) => mod.peerMailVerdict(f(over)) as Record<string, unknown>;
    const reply = (over: Partial<Facts> = {}): Partial<Facts> => ({ kind: 'answer', inReplyTo: 7, invitation: INVITE,
      duplicate: true, outstanding: 3, hourAts: ats(12), ...over });
    const notInvited = (over: Partial<Facts>): void => { expect(v(reply({ duplicate: false, ...over }))['verdict']).toBe('peer-quota'); };
    return {
      bounded: () => { expect(v()).toEqual({ verdict: 'bounded' }); },
      'pair edge': () => { expect(v({ outstanding: 2 })['verdict']).toBe('bounded'); expect(v({ outstanding: 3 })['verdict']).toBe('peer-quota'); },
      'hour edge': () => { expect(v({ hourAts: ats(11) })['verdict']).toBe('bounded'); expect(v({ hourAts: ats(12) })['verdict']).toBe('peer-quota'); },
      'duplicate before the pair': () => { expect(v({ duplicate: true, outstanding: 3 })['verdict']).toBe('duplicate'); },
      'invited before every arm': () => { expect(v(reply())).toEqual({ verdict: 'invited', answersMail: 41 }); },
      'no delivery': () => { notInvited({ invitation: null }); },
      'not an answer': () => { notInvited({ kind: 'status' }); },
      'not to the sender': () => { notInvited({ invitation: { ...INVITE, invitee: 'demo-b' } }); },
      'not from the recipient': () => { notInvited({ invitation: { ...INVITE, inviter: 'demo-b' } }); },
      'already answered': () => { notInvited({ invitation: { ...INVITE, answered: true } }); },
      'a mail to oneself': () => { notInvited({ fromId: 'demo-calm-ridge', invitation: { ...INVITE, invitee: 'demo-calm-ridge' } }); },
      'an invited reply': () => { notInvited({ invitation: { ...INVITE, isReply: true } }); },
      'pair retry names the recipient': () => { expect(v({ outstanding: 3 })['retry']).toEqual({ on: 'ack', toId: 'demo-calm-ridge' }); },
      'hour retry at the 12th newest': () => {
        const h = ats(13);
        expect(v({ hourAts: h })['retry']).toEqual({ on: 'time', at: h[1]! + HOUR });
      },
      'the hint without inReplyTo, the reason with one': () => {
        expect(String(v({ outstanding: 3 })['detail'])).toContain('is outside this bound');
        expect(String(v({ outstanding: 3, kind: 'answer', inReplyTo: 7 })['detail'])).toContain('not an invited reply');
      },
    };
  },
};

const MUTANT_SETS: Record<string, MutantSet<never>> = {
  [KEY]: COORD_BLOCKED_SET as MutantSet<never>,
  [PEER_KEY]: PEER_SET as MutantSet<never>,
  [CARD_TRIM_KEY]: CARD_TRIM_SET as MutantSet<never>,
  [CARD_NEVER_EMPTY_KEY]: CARD_NEVER_EMPTY_SET as MutantSet<never>,
  [CARD_ONE_LINE_KEY]: CARD_ONE_LINE_SET as MutantSet<never>,
  [CARD_BLOCK_KEY]: CARD_BLOCK_SET as MutantSet<never>,
  [COMPACTIONS_KEY]: COMPACTIONS_SET as MutantSet<never>,
  ...RENEWAL_MUTANT_SETS,
  ...GENERATION_START_MUTANT_SETS,
  ...MAIL_PACE_MUTANT_SETS,
  ...FACE_MUTANT_SETS,
  ...LAUNCH_PROFILE_MUTANT_SETS,
  ...COMPACTION_MUTANT_SETS,
  ...PROBE_MUTANT_SETS,
};

it('rewriteRelativeImports makes ./ and ../ absolute and leaves bare specifiers', () => {
  const out = rewriteRelativeImports(`import { a } from '../x.js';\nimport b from 'node:fs';\n`, '/r/src/coord');
  expect(out).toContain(`from '${path.resolve('/r/src/x.js')}'`);
  expect(out).toContain(`from 'node:fs'`);
});
it('BASELINE: an unmutated copy loaded the same way runs and passes every suite case', async () => {
  const r = await runMutants({ ...MUTANT_SETS[KEY]!, mutants: [] });
  expect([r.results, r.baselineCases]).toEqual([[], 32]);
}, 60_000);
it('a baseline whose case fails unmutated is a failure, never a run of kills', async () => {
  const broken = { ...MUTANT_SETS[KEY]!, suite: () => ({ broken: () => { throw new Error('unmutated'); } }) };
  await expect(runMutants(broken)).rejects.toThrow(/baseline failed: broken: Error: unmutated/);
}, 60_000);
it('a baseline that ran no case is a failure, never a pass', async () => {
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [], suite: () => ({}) })).rejects.toThrow(/baseline/);
}, 60_000);
it('a mutant whose old text is absent is invalid, and the run throws', async () => {
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'x', old: 'no such text', new: '' }] }))
    .rejects.toThrow(/invalid: x/);
}, 60_000);
it('a mutant that does not compile is invalid, never killed', async () => {
  const old = 'if (oldest === undefined) return closed;';
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'syntax', old, new: 'if (' }] }))
    .rejects.toThrow(/invalid: syntax/);
}, 60_000);
it.each(Object.keys(MUTANT_SETS))('%s: every mutant is killed, and the score is at least its floor', async (key) => {
  const r = await runMutants(MUTANT_SETS[key]!);
  expect(r.results.filter((x) => x.status !== 'killed')).toEqual([]);
  expect(r.score).toBeGreaterThanOrEqual(FLOORS[key]!);
}, 120_000);
it('the floors and the mutant sets name the same deciders', () => {
  expect(Object.keys(FLOORS).sort()).toEqual(Object.keys(MUTANT_SETS).sort());
});
it('CONTROL: floorsFallen names a lowered floor and a removed one, and nothing else', () => {
  expect(floorsFallen({ a: 1, b: 0.5, c: 0.5 }, { a: 0.75, b: 0.75 })).toEqual(['a', 'c']);
});
it('no floor falls below its value at the merge-base with origin/main', () => {
  const base = mergeBaseText(ROOT, 'server/test/sim/mutation-floors.json');
  if (base === null) { console.warn('mutation-floors: no floors file at the merge-base with origin/main, skipped'); return; }
  expect(floorsFallen(JSON.parse(base) as Record<string, number>, FLOORS)).toEqual([]);
});
