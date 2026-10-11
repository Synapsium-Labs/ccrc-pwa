// Child reclamation, the STUCK class (spec §5.6, §5.9). `containment-refuted` is ccd's word for a
// PROVEN refusal at the tail's removal-time re-ask: another session's tree or registry row lies at,
// inside or through the child, or the recorded path is not this workspace's worktree. The tail stopped
// with the session stopped and nothing further deleted, and every retry finds the same until a person
// moves that tree or row. The server reads it as its own class:
//   - the parse reads the word FIRST, whatever `crumb` says (pinned here as a consumer);
//   - ONE attention item per child, at once, carrying the journal row's detail and a conditional retry
//     clause (for a KEPT child, the kept reason in its place; for a HELD child, the hold's clause in its
//     place); ccd's detail as one bounded line; under a terminal refusal
//     and over every kept, kept-many and failing item, and never withheld for a held child;
//   - the chip's `deferred` (an unsettled word the PWA re-reads), with the same sentence — never
//     `refused`;
//   - a feed that does not repeat itself when a retry finds the same word.
// Fixture HOME only (`mkTmp`); the rig's ccd is scripted, never run.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_STATUS_SENTENCE, CHILD_RECLAIM_STUCK_TOKENS, CHILD_RECLAIM_TOKEN_KIND,
  childReclaimStatus, childReclaimTokenKind, isChildReclaimResume, isChildReclaimStuckToken, parseChildReclaimResult,
  reclaimChild,
  type ChildReclaimDeps, type ChildReclaimRequest, type ChildReclaimStatusInput,
} from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_KEPT_MANY_OVER, CHILD_RECLAIM_SKIP, CHILD_RECLAIM_STUCK_RETRY,
  childReclaimAttention, childReclaimAttentionWithKept, childReclaimFeedQuiet, childReclaimFirstSighting,
  CHILD_RECLAIM_STUCK_HELD, childReclaimDetailText,
  childReclaimKeptItems, childReclaimKeptList, childReclaimStuckHeld, childReclaimStuckKept, childReclaimStuckKeptClause,
  childReclaimStuckSentence, isChildReclaimPreLockToken,
  type ChildReclaimJournalRow, type ChildReclaimSweepVerdict,
} from '../src/childReclaimSweep.js';
import { refusalSentence } from '../src/wsaudit.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { CHILD_RECLAIM_KEPT_WORDS, LC_LINE_MAX, LC_REFUSAL_WORD, isLcRefusalToken } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const W = 'containment-refuted' as const;
const ID = 'demo-quiet-basin';
const RUN = 7;
const NOW = 1_790_000_000_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const LINE_AT = NOW - 60_000;
const DETAIL = 'registry row demo-twin lies inside /w/demo-quiet-basin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The latest reclaim line of the child's generation: a stuck failure a minute old, far short of the ceiling. */
const row = (over: Partial<ChildReclaimJournalRow> = {}): ChildReclaimJournalRow => ({
  sessionId: ID, outcome: 'failed', refusal: W, at: LINE_AT, failingSince: LINE_AT, detail: DETAIL, ...over,
});
const listOf = (rows: ChildReclaimJournalRow[], live: [string, number | null][] = [[ID, RUN]],
  stuckOf: (t: string) => boolean = isChildReclaimStuckToken) =>
  childReclaimAttention({ latest: rows, live: new Map(live), kindOf: childReclaimTokenKind, stuckOf,
    sentenceFor: refusalSentence, nowMs: NOW });

describe('the stuck set as the attention list consumes it (a consumer pin) (spec §5.9)', () => {
  it('is exactly containment-refuted: a journal-only word, never a ws-reclaim word, a pre-lock token or terminal', () => {
    expect([...CHILD_RECLAIM_STUCK_TOKENS]).toEqual([W]);
    for (const t of CHILD_RECLAIM_STUCK_TOKENS) {
      expect(isLcRefusalToken(t), t).toBe(true);
      expect(isChildReclaimStuckToken(t), t).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, t), t).toBe(false);
      expect(childReclaimTokenKind(t), t).toBeNull();
      expect(isChildReclaimPreLockToken(t), t).toBe(false);
    }
  });

  it('admits nothing else: not the resumable word, not the pre-breadcrumb words, not a near miss', () => {
    for (const t of ['worktree-remove-failed', 'probe-unmeasured', 'pin-failed', '', 'Containment-refuted', null]) {
      expect(isChildReclaimStuckToken(t), String(t)).toBe(false);
    }
    expect(isChildReclaimResume('stuck')).toBe(true);
  });
});

describe('parseChildReclaimResult reads the stuck word FIRST, whatever crumb says (a consumer pin) (spec §5.6)', () => {
  it.each([
    ['crumb true', { crumb: true }], ['crumb false', { crumb: false }], ['no crumb', {}], ['a non-boolean crumb', { crumb: 'yes' }],
  ] as const)('%s → stuck, with its token and detail', (_name, extra) => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: W, detail: DETAIL, ...extra }), '')).toEqual({
      kind: 'failed', resume: 'stuck', detail: `${W}: ${DETAIL}`, token: W });
  });

  it('an empty detail reads the bare word, as every failed word does', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: W, detail: '', crumb: true }), ''))
      .toEqual({ kind: 'failed', resume: 'stuck', detail: W, token: W });
  });

  it('control: worktree-remove-failed past the breadcrumb stays resumable', () => {
    expect(parseChildReclaimResult(ID, JSON.stringify({ failed: 'worktree-remove-failed', detail: 'd', crumb: true }), ''))
      .toMatchObject({ kind: 'failed', resume: 'resumable', token: 'worktree-remove-failed' });
  });
});

describe('the stuck attention item (spec §5.9)', () => {
  it('one item AT ONCE, with ccd’s word, the row’s detail and the conditional retry clause', () => {
    expect(listOf([row()])).toEqual([{ kind: 'stuck', sessionId: ID, runId: RUN, token: W,
      sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, null), at: LINE_AT }]);
    const s = listOf([row()])[0]!.sentence;
    expect(s).toContain(LC_REFUSAL_WORD[W]);
    expect(s).toContain(DETAIL);
    expect(s).toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('the retry clause is conditional, and names the long backoff and the breadcrumb', () => {
    expect(CHILD_RECLAIM_STUCK_RETRY).toBe('While automatic reclamation runs, ccrc retries it on its long backoff; '
      + 'the box resumes from its breadcrumb once the tree or row is fixed.');
  });

  it.each(CHILD_RECLAIM_KEPT_WORDS)('a child kept for %s: the retry clause gives way to the kept clause, which names the reason and promises no retry (spec §5.9)', (why) => {
    const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, null);
    const kept = childReclaimStuckSentence(W, DETAIL, refusalSentence, why);
    expect(plain.endsWith(` ${CHILD_RECLAIM_STUCK_RETRY}`)).toBe(true);
    expect(kept).toBe(`${plain.slice(0, -CHILD_RECLAIM_STUCK_RETRY.length)}${childReclaimStuckKeptClause(why)}`);
    expect(childReclaimStuckKept(plain, why)).toBe(kept);
    expect(childReclaimStuckKeptClause(why)).toContain(CHILD_RECLAIM_SKIP[why].sentence);
    expect(childReclaimStuckKeptClause(why)).not.toMatch(/retr/i);
    expect(kept).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('the hold clause replaces the retry clause for a held child: no retry while the hold stands, the backoff once it lifts (spec §5.9)', () => {
    expect(CHILD_RECLAIM_STUCK_HELD).toBe('This workspace carries a hold, so ccrc does not retry it while the hold stands; '
      + 'its long backoff resumes once the hold lifts.');
    const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, null);
    const held = childReclaimStuckHeld(plain);
    expect(held).toBe(`${plain.slice(0, -CHILD_RECLAIM_STUCK_RETRY.length)}${CHILD_RECLAIM_STUCK_HELD}`);
    expect(held).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(held).toContain(DETAIL);
    // A sentence that does not end with the retry clause (a kept one) is returned as it is.
    const kept = childReclaimStuckSentence(W, DETAIL, refusalSentence, 'coordinating');
    expect(childReclaimStuckHeld(kept)).toBe(kept);
  });

  it('ccd’s detail reaches the sentence as one bounded line: no control or bidi character, at most LC_LINE_MAX characters and one ellipsis (spec §5.9)', () => {
    // Any session on the fleet box can append a journal line, so its detail is untrusted text.
    const nonText = (t: string): boolean => [...t].some((c) => {
      const n = c.codePointAt(0)!;
      return n < 0x20 || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029
        || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
    });
    const big = `${'x'.repeat(4_000)}${String.fromCharCode(0x0a, 0x202e)}${'y'.repeat(5_998)}`;
    expect(big).toHaveLength(10_000);
    expect(nonText(big)).toBe(true);
    const s = childReclaimStuckSentence(W, big, refusalSentence, null);
    expect(nonText(s)).toBe(false);
    expect(s).toContain(childReclaimDetailText(big));
    const lead = 'What ccd found in the way: ';
    expect(s).toContain(lead);
    expect(s.endsWith(` ${CHILD_RECLAIM_STUCK_RETRY}`)).toBe(true);
    const part = s.slice(s.indexOf(lead) + lead.length, s.length - ` ${CHILD_RECLAIM_STUCK_RETRY}`.length);
    expect(part.length).toBeLessThanOrEqual(LC_LINE_MAX + 1);
    expect(part.startsWith('x'.repeat(100))).toBe(true);
    // The attention item, which the chip shares, says the same bounded line.
    expect(listOf([row({ detail: big })])[0]!.sentence).toBe(s);
  });

  it.each([null, '', String.fromCharCode(0x0a, 0x202e, 0x20)])('with no detail, or none left once made one line (%j), it says the record was cut and points to the feed', (detail) => {
    const s = listOf([row({ detail })])[0]!.sentence;
    expect(s).toMatch(/record was cut/);
    expect(s).toMatch(/“child reclaim failed” row/);
    expect(s).not.toMatch(/null|undefined/);
    expect(s).toContain(CHILD_RECLAIM_STUCK_RETRY);
  });

  it('past the ceiling it is still stuck, never failing: excluded from the failing-past-ceiling list', () => {
    expect(listOf([row({ failingSince: NOW - C - 1 })]).map((a) => a.kind)).toEqual(['stuck']);
  });

  it('a line ccd could not place (no at) is still listed, at null: it needs no clock', () => {
    expect(listOf([row({ at: null, failingSince: null })])).toMatchObject([{ kind: 'stuck', at: null }]);
  });

  it('a row that left the registry lists nothing', () => {
    expect(listOf([row()], [['demo-other', 9]])).toEqual([]);
  });

  it('a REFUSED line carrying the word is not stuck: ccd journals it only through _lc_fail', () => {
    expect(listOf([row({ outcome: 'refused' })])).toEqual([]);
  });

  it('terminal outranks stuck: a terminal refusal stays terminal under a classifier that calls every word stuck', () => {
    expect(listOf([row({ outcome: 'refused', refusal: 'not-a-child' })], [[ID, RUN]], () => true).map((a) => a.kind))
      .toEqual(['terminal']);
  });

  it('control: another failure word past the ceiling is still failing', () => {
    expect(listOf([row({ refusal: 'worktree-remove-failed', failingSince: NOW - C })]).map((a) => a.kind))
      .toEqual(['failing']);
  });
});

describe('precedence: stuck outranks kept, kept-many and failing, and held never withholds it (spec §5.9)', () => {
  it('a kept verdict gives a stuck child no kept item, and the list shows the stuck item alone', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    expect(kept).toEqual([]);
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => a.kind)).toEqual(['stuck']);
  });

  it('a stuck child is never a kept-many member: one past the collapse, minus the stuck one, stays single', () => {
    const ids = Array.from({ length: CHILD_RECLAIM_KEPT_MANY_OVER + 1 }, (_, k) => `demo-kept-${k + 1}`);
    const verdicts = new Map<string, ChildReclaimSweepVerdict>(
      ids.map((id) => [id, { eligible: false, why: 'coordinating', runId: RUN }]));
    const live = new Map<string, number | null>(ids.map((id) => [id, RUN]));
    // Guards the guard: without the stuck line the same children DO collapse.
    expect(childReclaimKeptList(childReclaimKeptItems({ verdicts, live, mirrorArms: [] })).map((a) => a.kind))
      .toEqual(['kept-many']);
    const arms = listOf([row({ sessionId: ids[0]! })], ids.map((id) => [id, RUN]));
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    expect(kept.map((a) => a.sessionId)).toEqual(ids.slice(1));
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => a.kind))
      .toEqual(['stuck', ...ids.slice(1).map(() => 'kept')]);
  });

  it('a held verdict withholds a failing item but never a stuck one', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([
      [ID, { eligible: false, why: 'held' }], ['demo-b', { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN], ['demo-b', 8]]);
    const arms = listOf([row(), row({ sessionId: 'demo-b', refusal: 'worktree-remove-failed', failingSince: NOW - C })],
      [[ID, RUN], ['demo-b', 8]]);
    expect(arms.map((a) => `${a.kind}:${a.sessionId}`)).toEqual([`stuck:${ID}`, 'failing:demo-b']);
    const kept = childReclaimKeptItems({ verdicts, live, mirrorArms: arms });
    // A `kept-many` line has no `sessionId` of its own; none is expected here, and one would read `kept-many:`.
    expect(childReclaimAttentionWithKept(arms, kept, verdicts).map((a) => `${a.kind}:${'sessionId' in a ? a.sessionId : ''}`))
      .toEqual([`stuck:${ID}`]);
  });

  it('a KEPT child: its stuck item drops the retry clause and names the kept reason, under its own run only (spec §5.9)', () => {
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const banner = (verdicts: Map<string, ChildReclaimSweepVerdict>) =>
      childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts);
    const own = banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN }]]));
    expect(own).toEqual([{ ...arms[0]!, sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, 'coordinating') }]);
    expect(own[0]!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(own[0]!.sentence).toContain(CHILD_RECLAIM_SKIP.coordinating.sentence);
    // A kept verdict judged under ANOTHER run's marker is a recycled slug's (spec §5.9): it says nothing of this item.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'coordinating', runId: RUN + 1 }]])))
      .toEqual(arms);
    // `held` drops the retry clause too, for the hold's (spec §5.9), with no run to match: a held
    // verdict carries none.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]])))
      .toEqual([{ ...arms[0]!, sentence: childReclaimStuckHeld(arms[0]!.sentence) }]);
    // A doubt word keeps the retry clause: the sweep reads that child again on its next pass.
    expect(banner(new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'identity-unmeasured' }]])))
      .toEqual(arms);
  });

  it('a HELD child: its stuck item stays listed and drops the retry clause for the hold’s, with no run to match (spec §5.9)', () => {
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    const out = childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts);
    expect(out).toEqual([{ ...arms[0]!,
      sentence: childReclaimStuckHeld(childReclaimStuckSentence(W, DETAIL, refusalSentence, null)) }]);
    expect(out[0]!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(out[0]!.sentence).toContain(CHILD_RECLAIM_STUCK_HELD);
    expect(out[0]!.sentence).toContain(DETAIL);
  });
});

describe('the chip (spec §5.9): deferred, with the stuck item’s sentence, never refused', () => {
  type Ev = NonNullable<ChildReclaimStatusInput['event']>;
  const ev = (over: Partial<Ev> = {}): Ev =>
    ({ act: 'reclaim', outcome: 'failed', refusal: W, at: LINE_AT, detail: DETAIL, ...over });
  const marked: ChildReclaimStatusInput['row'] = { kind: 'row', child: { kind: 'child', runId: RUN } };
  const base = (over: Partial<ChildReclaimStatusInput> = {}): ChildReclaimStatusInput => ({
    run: { id: RUN, state: 'done', sessionId: ID }, event: ev(), row: marked, sessionHasOpenRun: false,
    reviewedRunNotTerminal: false, fleetPaused: false, deferredSince: null, verdict: { kind: 'eligible' },
    sweepFailing: false, journalFailingSince: null, ...over,
  });

  it.each([DETAIL, null])('detail %j: deferred, with the attention item’s own sentence, at the line’s time', (detail) => {
    expect(childReclaimStatus(base({ event: ev({ detail }) }))).toEqual({
      word: 'deferred', sentence: listOf([row({ detail })])[0]!.sentence, at: LINE_AT });
  });

  it('outranks every non-ordinary verdict (a kept word, held, a doubt word) and never reads refused', () => {
    for (const why of ['coordinating', 'held', 'identity-unmeasured'] as const) {
      const plain = childReclaimStuckSentence(W, DETAIL, refusalSentence, why === 'coordinating' ? why : null);
      expect(childReclaimStatus(base({ verdict: { kind: 'skip', why } })), why).toEqual({
        word: 'deferred', sentence: why === 'held' ? childReclaimStuckHeld(plain) : plain, at: LINE_AT });
    }
  });

  it('a kept verdict: the kept variant, never a retry, and the switch leaves it as it leaves every kept answer (spec §5.9)', () => {
    for (const why of CHILD_RECLAIM_KEPT_WORDS) {
      const s = childReclaimStatus(base({ verdict: { kind: 'skip', why } }));
      expect(s, why).toEqual({ word: 'deferred', sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, why), at: LINE_AT });
      expect(s!.sentence, why).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
      expect(childReclaimStatus(base({ verdict: { kind: 'skip', why }, fleetPaused: true })), why).toEqual(s);
    }
  });

  it('a HELD verdict on the chip: the hold’s clause, never a retry, the banner’s own sentence, and the switch turns it to paused (spec §5.9)', () => {
    const held = { kind: 'skip', why: 'held' } as const;
    const s = childReclaimStatus(base({ verdict: held }));
    expect(s).toEqual({ word: 'deferred',
      sentence: childReclaimStuckHeld(childReclaimStuckSentence(W, DETAIL, refusalSentence, null)), at: LINE_AT });
    expect(s!.sentence).not.toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(s!.sentence).toContain(CHILD_RECLAIM_STUCK_HELD);
    const verdicts = new Map<string, ChildReclaimSweepVerdict>([[ID, { eligible: false, why: 'held' }]]);
    const live = new Map<string, number | null>([[ID, RUN]]);
    const arms = listOf([row()]);
    expect(childReclaimAttentionWithKept(arms, childReclaimKeptItems({ verdicts, live, mirrorArms: arms }), verdicts)[0]!.sentence)
      .toBe(s!.sentence);
    // The hold's own deferred answer is switched (`waiting`), and so is this one: it says the sweep acts once the hold lifts.
    expect(childReclaimStatus(base({ verdict: held, fleetPaused: true })))
      .toEqual({ word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null });
  });

  it('past the ceiling too: the stuck sentence, never the failing one', () => {
    expect(childReclaimStatus(base({ journalFailingSince: NOW - C }))).toMatchObject({
      word: 'deferred', sentence: childReclaimStuckSentence(W, DETAIL, refusalSentence, null) });
  });

  it('the fleet-wide switch turns it to paused, as it does every deferred', () => {
    expect(childReclaimStatus(base({ fleetPaused: true })))
      .toEqual({ word: 'paused', sentence: CHILD_RECLAIM_STATUS_SENTENCE.fleetPaused, at: null });
  });

  it('a child that no longer stands as this run’s says nothing of its own', () => {
    expect(childReclaimStatus(base({ row: { kind: 'absent' } }))).toBeNull();
  });

  it('the PWA re-reads a deferred chip: deferred is unsettled there and refused is not (no PWA edit)', () => {
    const line = readFileSync(path.join(root, 'pwa/src/fleet/runWords.ts'), 'utf8')
      .split('\n').find((l) => l.startsWith('const CHILD_RECLAIM_UNSETTLED'));
    expect(line, 'CHILD_RECLAIM_UNSETTLED moved: re-point this pin by content').toBeDefined();
    expect(line).toContain("'deferred'");
    expect(line).not.toContain("'refused'");
  });
});

describe('the lane wires the one classifier (watch.ts wires, never decides)', () => {
  it('injects isChildReclaimStuckToken into the mirror arms, at the one call', () => {
    const calls = readFileSync(path.join(root, 'server/src/watch.ts'), 'utf8').match(/childReclaimAttention\(\{[^}]*\}\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('stuckOf: isChildReclaimStuckToken');
  });
});

/** The pre-crumb suite's rig: a closed minting run and a registry row, a scripted ccd, and the feed. */
const TOK = 'a'.repeat(64);
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'reclaim-v1', 'actor-flags-v1'] };
const rig = async (verbStdout: string) => {
  const home = mkTmp('ccrc-child-reclaim-stuck-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
    viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const audit = JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict: 'reclaimable', detail: '', token: TOK });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-audit') return { code: 0, stdout: audit, stderr: '' };
    if (args[0] === 'ws-reclaim') return { code: 1, stdout: verbStdout, stderr: '' };
    return { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: CAPS,
    presence: { isVisible: () => false }, notifyLog };
  // Close's request: `licenceGeneration` none, so the executor's generation re-read is skipped.
  const req: ChildReclaimRequest = { sessionId: ID, runId, trigger: 'close' as const, deferExpired: false,
    deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' } };
  const bodies = () => coord.feedEvents(50).filter((e) => e.sessionId === ID).map((e) => e.body);
  return { deps, req, bodies };
};

describe('the feed (spec §5.9)', () => {
  const STDOUT = JSON.stringify({ failed: W, detail: DETAIL, crumb: true });

  it('childReclaimFeedQuiet reads a listed stuck item like a failing one: its word, for that child only', () => {
    const entry = childReclaimFirstSighting(NOW, NOW - 3_600_000, RUN, { kind: 'absent' });
    expect(childReclaimFeedQuiet(entry, listOf([row()]), ID)).toEqual({ deferWhy: null, failureToken: W });
    expect(childReclaimFeedQuiet(entry, listOf([row()]), 'demo-other')).toEqual({ deferWhy: null, failureToken: null });
  });

  it('the failed row names what ccd found and says the stuck clause, never "resumes where it stopped"', async () => {
    const s = await rig(STDOUT);
    expect(await reclaimChild(s.deps, s.req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: W });
    expect(s.bodies()).toHaveLength(1);
    expect(s.bodies()[0]).toContain(`${W}: ${DETAIL}`);
    expect(s.bodies()[0]).toContain(CHILD_RECLAIM_STUCK_RETRY);
    expect(s.bodies()[0]).not.toContain('resumes where it stopped');
    expect(s.bodies()[0]).not.toContain('retried from the start');
  });

  it('a retry that finds the same word while the child is listed stuck writes no new row', async () => {
    const s = await rig(STDOUT);
    const entry = childReclaimFirstSighting(NOW, NOW - 3_600_000, RUN, { kind: 'absent' });
    const req = { ...s.req, feedQuiet: childReclaimFeedQuiet(entry, listOf([row()]), ID) };
    expect(await reclaimChild(s.deps, req)).toMatchObject({ kind: 'failed', resume: 'stuck', token: W });
    expect(s.bodies()).toEqual([]);
  });
});
