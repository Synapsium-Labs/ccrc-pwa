// `ws-reclaim` — the destructive verb for a CHILD (spec 2026-09-22 §5.5-§5.6).
// Every case builds a real child in a fixture HOME and runs the sourced
// function with the unit and pane calls RECORDED, never made. What is asserted
// is what is left on disk and in git afterwards — never what the verb says.
//
// The load-bearing pins (spec §9): `not-a-child` has no override on the fresh
// OR the resumed arm; the pause file is honoured INSIDE the verb; the WIP
// commit and the attic pins are read back from git refs; unsupervise runs on
// the resumed arm.
//
// Split (task 1b, wave 4) so each file fits the 600s foreground ceiling; the
// shared fixtures live in `childReclaimVerbHelpers.ts`. This file (part 1 of
// 3) keeps the fresh/resumed reclaim, the refusal ladder, containment via a
// LINK or an OTHER ROW, the workdir-leaf re-judge, failures after the act
// started, the Darwin `.svcfailed` arm, tmux presence and the settle (a late
// write between the pin phase and the kill, plain or in a nested checkout) —
// continued by `ccd-child-reclaim-verb-tail.test.ts` and `-reflogs.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { decOf, eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';
import { itLinux } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, TMUX_FAULTS, childReclaimVerb, evalOf,
  childIndex, hookRuns, makeChild, otherSnapshot, plantOther, plantRepoPrograms, plantTmux,
  tmuxSessions, wideDigitLocale, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-verb-'); });
afterEach(() => { h.cleanup(); });
const { reg, tombOf, atticShas, KILL, unsupervised, intact, refusedWith, interrupted, resumeToken, repoint, failedPairAgrees, treeOf } = verbHelpers(() => h);

describe('a fresh reclaim', () => {
  it('pins, then removes pane, unit, worktree, branch, clips, temp root and registry row — and keeps the record', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'notes.txt'), 'uncommitted work');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out', 'manifest.json'), '{}');
    const residue = path.join(h.home, 'residue', c.wt.replaceAll('/', '-'));
    fs.mkdirSync(residue, { recursive: true });
    fs.writeFileSync(path.join(residue, 'scratch.txt'), 'scratch the harness kept outside TMPDIR');
    const residueBytes = Number(h.sh(`_plat_bytes "${residue}"`));

    const r = childReclaimVerb(h, evalOf(h).token, { extra: "--surface agent --actor 'run:7 reclaim close'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; childOf: number; wip: string; attic: number; residueBytes: number };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.childOf).toBe(CHILD_RUN);
    expect(out.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(out.residueBytes, 'measured').toBe(residueBytes);
    expect((out as unknown as { secretsDropped: unknown }).secretsDropped, 'the answer counts what was dropped, as the record names it')
      .toBe(1);

    expect(fs.existsSync(c.wt), 'worktree').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    for (const field of ['uuid', 'child', 'reaping', 'workdir']) expect(h.reg(CHILD_ID, field), field).toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID)), 'clips').toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);
    expect(fs.existsSync(path.join(residue, 'scratch.txt')), 'the residue is MEASURED, never deleted').toBe(true);

    // The work is in the attic, read back from git — not from the verb's word.
    expect(atticShas(c)).toContain(out.wip);
    const tree = h.git(c.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n');
    expect(tree).toContain('notes.txt');
    expect(tree).not.toContain('.env');
    expect(out.attic).toBe(atticShas(c).length);

    // Unsupervise, then the ANCHORED kill — both, in that order.
    expect(unsupervised()).toEqual([`unsupervise ${CHILD_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);
    expect(h.calls().indexOf(unsupervised()[0]!)).toBeLessThan(h.calls().indexOf(KILL));

    const tomb = tombOf();
    expect(tomb['mode']).toBe('reclaim');
    expect(tomb['wip']).toBe(out.wip);
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['residueBytes']).toBe(residueBytes);

    const events = eventsOf(h.home, 'reclaim');
    const intent = events.find((e) => e['outcome'] === 'intent')!;
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(intent['tx'], 'one intent/done pair').toBe(done['tx']);
    expect(measOf(done)['childOf']).toBe(String(CHILD_RUN));
    expect(measOf(done)['wip']).toBe(out.wip);
    expect(measOf(done)['residueBytes']).toBe(String(residueBytes));
    // `resumed` is the PHASE a resumed act started at (L0's one meaning for it);
    // a fresh act resumed nothing, and the encoder omits an empty value.
    expect(measOf(intent)['resumed'], 'a fresh reclaim resumed nothing').toBeUndefined();
    expect(measOf(done)['resumed'], 'a fresh reclaim resumed nothing').toBeUndefined();
    expect(decOf(intent)['actor']).toBe('run:7 reclaim close');
  }, 90_000);

  it('reclaims a clean child with no WIP commit, deleting the branch at the tip it had', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token);
    const out = JSON.parse(r.stdout) as { wip: string | null };
    expect(out.wip).toBeNull();
    expect(atticShas(c)).toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
  }, 90_000);
});

describe('a refusal destroys nothing, and every one is journaled', () => {
  it('refuses not-a-child when --child-of names another run — whatever else the argv carries', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { childOf: 8,
      extra: "--defer-expired --surface agent --actor 'run:8 reclaim sweep' --reason override" });
    expect(refusedWith(r)).toBe('not-a-child');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'not-a-child' });
  }, 60_000);

  it('refuses paused when the kill-switch lands AFTER the token was minted — the verb reads it itself', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('paused');
    intact(c);
  }, 60_000);

  it('refuses held, and state-changed on a wrong token or on a tree that moved after the audit', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    fs.writeFileSync(path.join(c.wt, 'late.txt'), 'typed after the audit');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('state-changed');
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    // The ladder refuses `held` before it ever compares a token.
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('held');
    intact(c);
  }, 90_000);

  it('a refusal reads the LIVE child contained: no hook or fsmonitor of the repository runs, and its index is untouched', () => {
    // The ladder runs the whole of its git reads (a wrong token refuses only
    // at rung 10, after every one) against a tree whose session may be alive:
    // uncontained, `git status` rewrites the stale index under `index.lock`
    // and fires post-index-change — a write the refusal says it never makes.
    const c = makeChild(h);
    plantRepoPrograms(h, c);
    const before = childIndex(h, c);
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    expect(hookRuns(h), 'a repository-configured hook or fsmonitor ran inside a refused ws-reclaim').toEqual([]);
    const after = childIndex(h, c);
    expect(after.bytes, 'a refused ws-reclaim rewrote the child’s index').toBe(before.bytes);
    expect(after.mtimeMs, 'a refused ws-reclaim touched the child’s index').toBe(before.mtimeMs);
    intact(c);
    // The CONTROL, after the subject: the same fixture runs the programs and
    // rewrites the index for an uncontained read.
    h.sh(`git -C "${c.wt}" status --porcelain >/dev/null`);
    expect(hookRuns(h), 'the CONTROL: an uncontained status runs the repository’s programs')
      .toEqual(expect.arrayContaining(['post-index-change', 'fsmonitor']));
    expect(childIndex(h, c).bytes, 'the CONTROL: an uncontained status rewrites the stale index').not.toBe(before.bytes);
  }, 60_000);

  it('--defer-expired is a fingerprint input: a token minted without it cannot be spent with it', () => {
    const c = makeChild(h);
    expect(refusedWith(childReclaimVerb(h, evalOf(h).token, { extra: '--defer-expired' }))).toBe('state-changed');
    intact(c);
    expect(JSON.parse(childReclaimVerb(h, evalOf(h, { defer: 1 }).token, { extra: '--defer-expired' }).stdout).reclaimed)
      .toBe(CHILD_ID);
  }, 90_000);

  it('refuses in-progress while another process holds the shared reap lock', () => {
    const c = makeChild(h);
    const lock = path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `exec 9>>"${lock}"; flock -n 9;` });
    expect(refusedWith(r)).toBe('in-progress');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'in-progress' });
  }, 60_000);

  it('refuses reap-in-progress on a ws-reap breadcrumb — a reclaim never finishes another verb’s work', () => {
    const c = makeChild(h);
    h.sh(`_reg_set ${CHILD_ID} reaping worktree`);
    expect(refusedWith(childReclaimVerb(h, evalOf(h).token))).toBe('reap-in-progress');
    intact(c);
  }, 60_000);

  it('dies on a malformed argv BEFORE the lock, touching nothing', () => {
    const c = makeChild(h);
    const tok = 'a'.repeat(64);
    for (const [argv, said] of [
      [`--expect x --child-of 7 --session ${CHILD_ID}`, 'bad token'],
      [`--expect ${tok} --child-of 0 --session ${CHILD_ID}`, 'bad run id'],
      [`--expect ${tok} --child-of 07 --session ${CHILD_ID}`, 'bad run id'],
      [`--expect ${tok} --child-of 7 --session ../x`, 'bad session id'],
      [`--expect ${tok} --session ${CHILD_ID}`, 'usage: ccd ws-reclaim --expect <token> --child-of <runId> --session <id>'],
      [`--expect ${tok} --child-of 7 --session ${CHILD_ID} extra`, 'usage: ccd ws-reclaim'],
      [`--actor`, 'usage: ccd ws-reclaim'],
      [`--expect ${tok} --child-of 7 --session ${CHILD_ID} --actor ' '`, '--actor must be non-blank'],
    ] as const) {
      const r = h.run(`${CHILD_STUBS} ${CHILD_ENV} cmd_ws_reclaim ${argv}`);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toContain(said);
    }
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `.reap-${CHILD_ID}.lock`)), 'the lock was never opened').toBe(false);
    intact(c);
  }, 60_000);

  it('dies "bad run id" on a --child-of only a locale-widened range admits — the parse is `_child_runid_valid`', (ctx) => {
    const c = makeChild(h);
    const loc = wideDigitLocale(h);
    if (loc === '') { ctx.skip(); return; }
    const r = h.run(`${CHILD_STUBS} LC_ALL=${loc}; ${CHILD_ENV} cmd_ws_reclaim --expect ${'a'.repeat(64)} --child-of '1²' --session ${CHILD_ID}`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stderr).toContain('bad run id');
    intact(c);
  }, 60_000);

  it('a probe that could not RUN inside the lock is a FAILURE, never a refusal — exit 1, `probe-unmeasured`, nothing touched', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    const r = childReclaimVerb(h, tok, { pre: '_ws_reclaim_stash_shas() { return 1; };' });
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(o['failed']).toBe('probe-unmeasured');
    expect(o['refused'], 'not one of the fourteen tokens, and no refusal').toBeUndefined();
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    intact(c);
  }, 60_000);

  it('a breadcrumb that EXISTS but cannot be read is unmeasured — never a fresh start over an interrupted act', () => {
    // `_reg_get` answers nothing for a breadcrumb it cannot read (a directory,
    // a link, a mode-000 file), and nothing is exactly what a FRESH act reads:
    // the ladder would run again over a half-torn-down child, the pin would
    // rewrite its tombstone, and whichever verb left the breadcrumb would never
    // be asked. So its presence is asked on its own, and a presence with no
    // readable phase is a probe that could not run.
    const c = makeChild(h);
    const tok = evalOf(h).token;
    fs.mkdirSync(reg('reaping'));
    const r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone was written').toBe(false);
    intact(c);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('probe-unmeasured');
  }, 60_000);
});

describe('the verb never acts on a tree it cannot prove is the child’s own — a LINK, or a path ANOTHER ROW names (spec §5.5)', () => {
  // End to end: the ladder answers these (its own suite); here the VERB runs
  // over them and what is on disk afterwards is read. `other` is a DIRTY
  // sibling worktree of the child's own repository, and a reclaim that
  // followed the link would commit its work into a WIP and remove its tree.
  for (const [label, dropRecord] of [['the child’s record present', false], ['the child’s record REMOVED', true]] as const) {
    it(`refuses a workdir that is a symbolic link to another worktree, ${label} — and \`other\` is byte-unchanged`, () => {
      const c = makeChild(h);
      const other = plantOther(h, c);
      if (dropRecord) fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
      const before = otherSnapshot(h, c, other);
      // The ladder mints no token here; a verb whose ladder did would be
      // handed one, so the refusal below is the ladder's, not a mismatch.
      const r = childReclaimVerb(h, evalOf(h).token || 'f'.repeat(64));
      // What is on disk FIRST: a reclaim that went through the link shows here.
      expect(otherSnapshot(h, c, other), '`other` was neither removed nor committed into').toEqual(before);
      expect(refusedWith(r)).toBe('containment-unproven');
      expect(String(before['subjects'])).not.toContain('ccrc: WIP pinned');
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch survives').toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
      expect(fs.lstatSync(c.wt).isSymbolicLink(), 'the link is left where it was').toBe(true);
    }, 90_000);
  }

  it('refuses when ANOTHER registry row names the same workdir — and that session’s tree survives byte for byte', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'), 'u-twin');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'), c.wt);
    fs.writeFileSync(path.join(c.wt, 'twin-work.txt'), 'the other session’s uncommitted work\n');
    const before = treeOf(c.wt);
    const r = childReclaimVerb(h, evalOf(h).token || 'f'.repeat(64));
    expect(treeOf(c.wt), 'the tree the other row names was not removed').toEqual(before);
    expect(refusedWith(r)).toBe('containment-unproven');
    expect(h.git(c.wt, 'rev-parse', 'HEAD'), 'nothing was committed into it').toBe(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
    expect(h.reg('demo-twin', 'workdir'), 'the other row survives').toBe(c.wt);
    expect(h.reg(CHILD_ID, 'uuid')).not.toBeNull();
  }, 90_000);

  // A ROW ROOTED INSIDE THE CHILD (the review's two measured shapes). The token
  // is minted BEFORE the other session's row appears — an audit, then a session
  // started inside the child — so the token is valid and the refusal is the
  // verb's own ladder asking again, never a token mismatch.
  const nestedShapes = {
    'a nested worktree `inner` on another branch': (c: Child): string => {
      const inner = path.join(c.wt, 'inner');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/other-live', inner);
      fs.writeFileSync(path.join(inner, 'live.txt'), 'another session’s uncommitted work\n');
      return inner;
    },
    'a plain subdirectory `<child>/server`': (c: Child): string => {
      const sub = path.join(c.wt, 'server');
      fs.mkdirSync(sub);
      return sub;
    },
  } as const;
  for (const [label, plant] of Object.entries(nestedShapes)) {
    it(`refuses when ANOTHER registry row is rooted inside the child — ${label} — and nothing is pinned or deleted`, () => {
      const c = makeChild(h);
      const root = plant(c);
      const tok = evalOf(h).token;
      expect(tok, 'the audit minted a token before the other row existed').toMatch(/^[0-9a-f]{64}$/);
      fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.uuid'), 'u-nested');
      fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.workdir'), root);
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, tok);
      // What is on disk FIRST: a reclaim that went ahead shows here.
      expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
      expect(atticShas(c), 'nothing was pinned').toEqual([]);
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone').toBe(false);
      expect(refusedWith(r)).toBe('containment-unproven');
      expect(JSON.parse(r.stdout).detail, 'the detail names the session to end or purge').toContain('demo-nested');
      intact(c);
      expect(h.reg('demo-nested', 'workdir'), 'the other row survives').toBe(root);
      expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'containment-unproven' });
    }, 90_000);
  }
});

describe('the resumed arm', () => {
  it('finishes an interrupted reclaim, and runs unsupervise and the anchored kill FIRST even though the dead run never did', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    expect(unsupervised(), 'the interrupted run died before its tail').toEqual([]);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(unsupervised(), 'a resumed reclaim that skipped this would leave a Restart=always unit with no row').toHaveLength(1);
    expect(h.calls()).toContain(KILL);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    const pair = eventsOf(h.home, 'reclaim');
    expect(measOf(pair.find((e) => e['outcome'] === 'intent')!)['resumed'], 'ONE meaning on both rows').toBe('worktree');
    expect(measOf(pair.find((e) => e['outcome'] === 'done')!)['resumed']).toBe('worktree');
  }, 90_000);

  it('does not let a crash launder a refusal — marker gone, marker unequal, or paused, the resume refuses', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    expect(refusedWith(childReclaimVerb(h, tok, { childOf: 8 }))).toBe('not-a-child');
    fs.rmSync(reg('child'));
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('not-a-child');
    expect(fs.existsSync(c.wt), 'nothing further was destroyed').toBe(true);
    expect(unsupervised()).toEqual([]);
  }, 90_000);

  it('fails reaping-phase-unknown on a reclaim breadcrumb it never writes, and deletes nothing', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:bogus`);
    const r = childReclaimVerb(h, resumeToken('bogus'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('reaping-phase-unknown');
    expect(fs.existsSync(c.wt)).toBe(true);
  }, 60_000);

  it('makes ws-reap refuse reclaim-in-progress on a reclaim breadcrumb — the mirror', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const r = h.run(`${CHILD_STUBS} cmd_ws_reap --expect ${'a'.repeat(64)} --session ${CHILD_ID}`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).refused).toBe('reclaim-in-progress');
    expect(fs.existsSync(c.wt)).toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
  }, 60_000);
});

describe('the tail re-judges the workdir LEAF at removal time, on every arm (spec §5.5)', () => {
  it('(c1) a LIVE link planted at resume phase `worktree` fails at the first rung that meets it, and removes nothing', () => {
    // The tail's own identity rungs meet it first (`_ws_reclaim_owned`'s leaf
    // test, re-asked on every arm before the settle); the settle re-pin's leaf
    // test stands behind them.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    const other = plantOther(h, c);
    const before = otherSnapshot(h, c, other);
    const r = childReclaimVerb(h, tok);
    expect(otherSnapshot(h, c, other), '`other` was neither removed nor committed into').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('symbolic link');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:worktree');
    expect(h.reg(CHILD_ID, 'uuid')).not.toBeNull();
  }, 90_000);

  for (const [label, dropRecord] of [['git’s record of it standing', false], ['git’s record of it gone', true]] as const) {
    it(`(c2) a DANGLING link planted at resume phase \`worktree\`, ${label}, reaches the removal step and fails worktree-remove-failed — nothing removed`, () => {
      // The settle is skipped here (no directory stands at the path), so the
      // tail's identity rungs (`_ws_reclaim_owned`, asked on every arm) are what
      // stands between this link and the rest of the tail.
      const c = makeChild(h);
      interrupted(c, 'worktree');
      const tok = resumeToken('worktree');
      fs.rmSync(c.wt, { recursive: true, force: true });
      if (dropRecord) h.git(c.main, 'worktree', 'prune');         // the fixture repository only
      fs.symlinkSync(path.join(h.home, 'nowhere'), c.wt);
      const r = childReclaimVerb(h, tok);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain('symbolic link');
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the worktree step').toBe('reclaim:worktree');
      expect(fs.lstatSync(c.wt).isSymbolicLink(), 'the link is left where it was').toBe(true);
    }, 90_000);
  }

  it('the workdir is held to one plain absolute spelling — a trailing slash cannot walk past the leaf test', () => {
    // `lstat("<link>/")` follows the link, so `-L` on that spelling is false and
    // a dangling link reads as nothing at all. The ladder refuses such a row;
    // the RESUMED arm has no ladder, so the tail asks it on every arm.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.symlinkSync(path.join(h.home, 'nowhere'), c.wt);
    // The row AND the record spell it so — they agree, so the agreement rung
    // passes and the spelling rung is the one that answers.
    repoint(undefined, `${c.wt}/`);
    const r = childReclaimVerb(h, tok);
    // The walk past the leaf test shows HERE first: the breadcrumb advances.
    expect(h.reg(CHILD_ID, 'reaping'), 'the tail did not walk past the removal step').toBe('reclaim:worktree');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('plain absolute path');
    expect(h.reg(CHILD_ID, 'uuid')).not.toBeNull();
  }, 90_000);
});

describe('failures after the act started', () => {
  it('pin-failed destroys nothing, writes no breadcrumb, and stops before the unit is touched', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_ws_wip_commit() { RECLAIM_WIP_WHY="the disk is full"; return 1; };' });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping')).toBeNull();
    intact(c);
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
  }, 60_000);

  it('a unit that is STILL UP after unsupervise stops the tail before its first deletion (unit-still-active)', () => {
    // `_ws_unsupervise` answers 0 whatever systemd did, so the tail re-measures.
    // `active` is a Restart=always unit that would respawn against a purged
    // row; an EMPTY answer is a manager that did not answer — unmeasured, and
    // refused the same way.
    for (const answer of ['active', '']) {
      const c = makeChild(h);
      const r = childReclaimVerb(h, evalOf(h).token, { pre: `_svc_is_active() { printf '${answer}'; };` });
      expect(r.code, answer).toBe(1);
      expect(JSON.parse(r.stdout).failed, answer).toBe('unit-still-active');
      failedPairAgrees(r);
      expect(fs.existsSync(c.wt), 'nothing was deleted').toBe(true);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:children');
      expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'failed']);
      h.cleanup(); h = makePrHarness('ccrc-child-reclaim-verb-');
    }
  }, 120_000);

  it('a purge that cannot run leaves the breadcrumb at the artifacts step, for the resume', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: '_reg_purge() { return 2; };' });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('purge-mechanism-absent');
    failedPairAgrees(r);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:artifacts');
  }, 90_000);

  it('refuses to delete a branch that moved after it was pinned (branch-moved), or that another worktree now holds (branch-elsewhere)', () => {
    const c = makeChild(h);
    interrupted(c, 'branch');
    let r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed, 'the worktree still stands on it').toBe('branch-elsewhere');
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.git(c.main, 'branch', '-f', CHILD_BRANCH, 'main');
    r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('branch-moved');
    failedPairAgrees(r);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
  }, 90_000);

  it('a branch that stands with NO recorded tip is kept — an empty value is never handed to the CAS', () => {
    const c = makeChild(h);
    interrupted(c, 'branch');
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '{"tip":""}'`);
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-moved');
    expect(o.detail).toContain('no tip');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:branch');
  }, 90_000);

  it('a stale tombstone the fresh arm could not overwrite is never read as this act’s record — tombstone-unwritable, nothing destroyed', (ctx) => {
    // A recycled slug can leave an earlier child's tombstone at this path. A
    // write that failed would leave THAT one standing, non-empty, and a tail
    // that trusted it would delete by another act's record. So the fresh arm
    // proves the file it just wrote is this row's (its `uuid`).
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    const c = makeChild(h);
    const dir = path.join(h.home, '.cc-sessions', '.reaped');
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, `${CHILD_ID}.json`);
    fs.writeFileSync(stale, JSON.stringify({ id: CHILD_ID, uuid: 'an-earlier-child', branch: CHILD_BRANCH,
      tip: c.tip, mode: 'reclaim', children: [], wip: null }));
    fs.chmodSync(stale, 0o444);
    try {
      const r = childReclaimVerb(h, evalOf(h).token);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(JSON.parse(r.stdout).failed).toBe('tombstone-unwritable');
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
      intact(c);
    } finally { fs.chmodSync(stale, 0o644); }
  }, 60_000);
});

describe('on Darwin, a `.svcfailed` stamp reads as stopped only when launchd says the job is not loaded (spec §5.6)', () => {
  // `_svc_is_active` answers `failed` from `$REG/<id>.svcfailed` BEFORE it asks
  // launchd, and neither a re-enable nor a swap's start clears that stamp, so a
  // running job can carry a stale one. When the unsupervise's bootout also
  // failed, the tail would read `failed` as stopped and delete under a job that
  // can restart the pane. So on Darwin the tail asks `launchctl print` itself,
  // and only its exit 113 ("Could not find service") lets a stamped `failed`
  // pass. The Darwin arm is forced on ANY host the way `macos-platform.test.ts`
  // forces it — `CCD_OS=darwin` assigned after the source, in the same payload —
  // so these rows run on the Linux box and on the macOS leg alike. The REAL
  // `_svc_is_active` is put back over `CHILD_STUBS`' `inactive` (read from a
  // subshell source of ccd), so it is the stamp that answers `failed`; and
  // `_svc_launchctl`, ccd's one door to launchctl, records and answers.
  const LABEL = `gui/${process.getuid?.() ?? 0}/app.ccrc.session.${CHILD_ID}`;
  const darwin = (print: { out: string; rc: number }): string =>
    `CCD_OS=darwin; eval "$(source '${CCD}' >/dev/null 2>&1; declare -f _svc_is_active)";`
    + ` _svc_launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; [[ "$1" == print ]] || return 0;`
    + ` printf '%s\\n' '${print.out}'; return ${print.rc}; };`;
  const stamp = (): void => { fs.writeFileSync(reg('svcfailed'), '1700000000\n'); };

  it.each([
    ['launchd shows the job `state = running`', { out: 'state = running', rc: 0 }],
    ['launchctl could not be asked (exit 1: no binary, or the sandbox guard)', { out: '', rc: 1 }],
  ] as const)('a stamp, and %s → `unit-still-active`, and nothing is deleted', (_what, print) => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    stamp();
    const r = childReclaimVerb(h, tok, { pre: darwin(print) });
    expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'its files survive').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:children');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('unit-still-active');
    // Bound to THIS block's sentence, not a bare `exit N`, which the pane
    // re-measure's detail ("after the kill (exit N)") could also satisfy.
    expect(o.detail).toContain('from its stamp');
    expect(o.detail).toContain(`(print exit ${print.rc})`);
    failedPairAgrees(r);
    expect(h.calls(), 'launchd was asked by the label ccd spells').toContain(`launchctl print ${LABEL}`);
  }, 90_000);

  it('the control: a stamp, and launchd answers exit 113 (not loaded) → the child is reclaimed', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    stamp();
    const r = childReclaimVerb(h, tok, { pre: darwin({ out: 'Could not find service', rc: 113 }) });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the worktree is gone').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch is gone').toBe('');
    expect(h.calls()).toContain(`launchctl print ${LABEL}`);
  }, 90_000);

  // THE GATE IS DARWIN'S ONLY: on Linux `failed` is systemd's own answer (a
  // start-limited unit, which is stopped), so the tail passes it as before and
  // never consults launchctl. `itLinux`, stated: this row is ABOUT the Linux
  // arm, and forcing `CCD_OS=linux` on the macOS leg would send every `_plat_*`
  // helper the whole verb calls down its GNU arm on a BSD userland.
  itLinux('the Linux arm: `_svc_is_active` answers `failed` → reclaimed as before, and launchctl is never asked', () => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    stamp();
    const r = childReclaimVerb(h, tok, {
      pre: `_svc_is_active() { printf failed; }; _svc_launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 1; };`,
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the worktree is gone').toBe(false);
    expect(h.calls().filter((l) => l.startsWith('launchctl')), 'launchctl was never asked').toEqual([]);
  }, 90_000);
});

describe('tmux presence is read through `_session_probe`, ANCHORED — at rung 5 and after the tail’s kill (spec §5.5-§5.6)', () => {
  // `can't find session` is the one answer that is gone. Every "could not be
  // asked" stops the verb before anything is deleted: at rung 5 as the
  // `probe-unmeasured` failure, and in the tail — where `KillMode=process`
  // means stopping the unit never stopped the pane — as `unit-still-active`.
  const PROBE = `tmux has-session -t =cc-${CHILD_ID}:`;
  /** Everything a stopped tail must leave standing: the tree, the branch, the
   *  row, and the breadcrumb for the retry. Read off disk FIRST. */
  const tailStopped = (c: Child): void => {
    expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'its files survive').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:children');
  };

  it.each(Object.entries(TMUX_FAULTS))('rung 5: %s → `probe-unmeasured` at exit 1, and nothing is touched', (_what, fault) => {
    const c = makeChild(h);
    const tok = evalOf(h).token;
    plantTmux(h, { fault });
    const r = childReclaimVerb(h, tok);
    intact(c);
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(o['failed']).toBe('probe-unmeasured');
    expect(String(o['detail'])).toContain(fault);
    expect(o['reclaimed']).toBeUndefined();
  }, 60_000);

  it.each(Object.entries(TMUX_FAULTS))('the tail: %s after the kill → `unit-still-active`, and nothing further is deleted', (_what, fault) => {
    // The ladder saw no session; tmux breaks between the ladder and the tail,
    // so this attempt's own kill does not exit 0 either — `no server running`
    // here is NOT the exit-empty exception.
    const c = makeChild(h);
    plantTmux(h, { faultAtTail: fault });
    const r = childReclaimVerb(h, evalOf(h).token);
    tailStopped(c);
    expect(r.code, r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('unit-still-active');
    expect(o.detail).toContain(fault);
    failedPairAgrees(r);
    expect(h.calls(), 'the kill was attempted').toContain(KILL);
    expect(h.calls().lastIndexOf(PROBE), 'the pane was re-measured after it').toBeGreaterThan(h.calls().indexOf(KILL));
  }, 60_000);

  it('the tail, RESUMED: `no server running` with no rc-0 kill of this attempt’s own still stops', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    plantTmux(h, { fault: TMUX_FAULTS['no server running'] });
    const r = childReclaimVerb(h, resumeToken('children'));
    tailStopped(c);
    expect(r.code, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
  }, 60_000);

  it('the tail: a pane still LIVE after a kill that exited 0 stops it too', () => {
    const c = makeChild(h);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`], killNoop: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    tailStopped(c);
    expect(r.code, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
  }, 60_000);

  // THE EXCEPTION IS NARROW: an rc-0 kill excuses `no server running` and
  // nothing else. Another session keeps the server up, so this is not
  // exit-empty; tmux becomes unaskable right after the kill succeeded. Only
  // tmux's own `no server running` words pass — never a refused connection,
  // and never a missing socket, which PROBE_SUBSTRATE would also call absent.
  it.each([['permission denied', TMUX_FAULTS['permission denied']], ['no socket', TMUX_FAULTS['no socket']]])(
    'the tail: an rc-0 kill, then %s → `unit-still-active`, and nothing further is deleted', (_what, fault) => {
      const c = makeChild(h);
      plantTmux(h, { sessions: [`cc-${CHILD_ID}`, 'cc-demo-other'], faultAfterKill: fault });
      const r = childReclaimVerb(h, evalOf(h).token);
      tailStopped(c);
      expect(tmuxSessions(h), 'the kill itself exited 0 — it took the child’s pane').toEqual(['cc-demo-other']);
      expect(r.code, r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('unit-still-active');
      expect(o.detail).toContain(fault);
      expect(o.detail).toContain('(exit 0)');
    }, 60_000);

  // The re-measure is step (1) of the tail, so it guards EVERY arm: the
  // vanished-worktree arm (which enters at the branch) and a resume at any
  // phase past the first, not only the fresh `children` entry.
  const stoppedAt = (c: Child, phase: string, worktree: boolean): void => {
    expect(fs.existsSync(c.wt), worktree ? 'the worktree survives' : 'the worktree was already gone').toBe(worktree);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at its phase').toBe(`reclaim:${phase}`);
  };
  const PANE = {
    'tmux could not be asked': { faultAtTail: TMUX_FAULTS['permission denied'] },
    'the pane still live': { sessions: [`cc-${CHILD_ID}`], killNoop: true },
  } as const;

  it.each(Object.entries(PANE))('the VANISHED arm: %s after the kill stops it before the branch goes', (_what, tmux) => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const tok = evalOf(h).token;
    plantTmux(h, tmux);
    const r = childReclaimVerb(h, tok);
    stoppedAt(c, 'branch', false);
    expect(tombOf()['worktree']).toBe('absent');
    expect(r.code, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
  }, 60_000);

  for (const phase of ['worktree', 'branch'] as const) {
    it.each(Object.entries(PANE))(`a RESUME at \`${phase}\`: %s after the kill stops it, and nothing further is deleted`, (_what, tmux) => {
      const c = makeChild(h);
      interrupted(c, phase);
      // A resume runs no rung 5, so the fault can stand from the start.
      plantTmux(h, 'faultAtTail' in tmux ? { fault: tmux.faultAtTail } : tmux);
      const r = childReclaimVerb(h, resumeToken(phase));
      stoppedAt(c, phase, true);
      expect(r.code, r.stderr).toBe(1);
      expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
      expect(h.calls(), 'the resumed tail killed first').toContain(KILL);
    }, 60_000);
  }

  it('the CONTROL: `can’t find session` after the kill reclaims — and the pane WAS re-measured', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.calls().lastIndexOf(PROBE), 'the re-measure follows the kill').toBeGreaterThan(h.calls().indexOf(KILL));
  }, 90_000);

  it('the CONTROL: this attempt’s rc-0 kill of the LAST session, then `no server running`, passes the tail — tmux’s exit-empty', () => {
    const c = makeChild(h);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(tmuxSessions(h), 'the kill took the pane').toEqual([]);
    expect(fs.readFileSync(path.join(h.home, 'tmux-fault'), 'utf8'), 'and the server exited empty')
      .toContain('no server running');
  }, 90_000);

  it('the CONTROL: an attached prefix-SIBLING `cc-<id>x` neither blocks the reclaim nor is killed', () => {
    const c = makeChild(h);
    const sib = `cc-${CHILD_ID}x`;
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`, sib], clients: { [sib]: '/dev/pts/9' } });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(tmuxSessions(h), 'the child’s pane went, the sibling stands').toEqual([sib]);
  }, 90_000);
});

describe('the settle', () => {
  it('pins what the session wrote between the pin phase and the kill, before any tree is touched', () => {
    const c = makeChild(h);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; echo last-words > "${c.wt}/late.txt"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { wip: string };
    expect(h.git(c.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n')).toContain('late.txt');
    expect(atticShas(c)).toContain(out.wip);
    expect(tombOf()['wip']).toBe(out.wip);
    expect(tombOf()['tip'], 'the tombstone names the tip the branch was deleted at — its own: the WIP commit moves no ref')
      .toBe(c.tip);
  }, 90_000);

  it('pins a NESTED checkout’s late write, and deletes its branch at its own head — the WIP commit moves no ref', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; echo late > "${inner}/late.txt"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went').toBe('');
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('late.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the late write into the nested checkout is in the attic').toBeDefined();
    expect(h.git(c.main, 'log', '-1', '--format=%P', nestedWip!), 'the WIP commit sits on the nested HEAD').toBe(nestedTip);
    const nestedLine = (tombOf()['children'] as string[]).find((l) => l.split('\t')[1] === 'ws/nested');
    expect(nestedLine?.split('\t')[2], 'the record names the head the branch was deleted at').toBe(nestedTip);
  }, 90_000);
});

// AN ALTERNATE ROW RESOLVED ONLY BY AN ABSENT-SUFFIX PROJECTION (R31, D-3731).
// Another session entered `<child>/server` through an ancestor alias
// (`$HOME/alias -> <child>`), and its row keeps that spelling. Once the alias
// is removed the spelling resolves only as text projected below a
// proven-absent `alias` — namespace presentation, not evidence of where that
// session's cwd remains (its process can still hold `<child>/server`). Every
// destructive seam answers it UNMEASURED and leaves every byte where it was;
// liveness is fixture state only, never an input to placement. These cases sit
// at the top level so their exact titles anchor the mutation table's
// selectors.
const ALT = 'demo-alias-live';
const HEX64 = /^[0-9a-f]{64}$/;

interface AliasRow {
  /** The alternate row's raw `.workdir` spelling, `$HOME/alias/server`. */
  raw: string;
  pointAt(target: 'child' | 'outside'): void;
  removeAlias(): void;
  /** Re-point the alias at a COMPLETE directory outside the child — the pre-existing re-point class, never a
   *  recovery (review 212, F3). */
  repointAlias(): void;
  writeRow(): void;
  dropRow(): void;
  /** Everything a refusal must leave standing: the child's tree and branch history, the alternate row's bytes,
   *  the modelled tmux files, the unit and pane ACTIONS (the read-only probes excluded), the tombstone,
   *  breadcrumb and attic, and the reclaim journal. */
  snapshot(): Record<string, unknown>;
}

/** A TEST-LOCAL builder, not a production helper. Plants `<child>/server` holding another session's work at
 *  once — so a token minted afterwards already fingerprints it — and `$HOME/outside/server`; the alias and the
 *  row are the levers. */
const aliasRow = (hh: PrHarness, c: Child): AliasRow => {
  const server = path.join(c.wt, 'server');
  fs.mkdirSync(server, { recursive: true });
  fs.writeFileSync(path.join(server, 'live.txt'), 'another session’s uncommitted work\n');
  const outside = path.join(hh.home, 'outside');
  fs.mkdirSync(path.join(outside, 'server'), { recursive: true });
  const alias = path.join(hh.home, 'alias');
  const rowFile = (field: string): string => path.join(hh.home, '.cc-sessions', `${ALT}.${field}`);
  const bytes = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null);
  const self: AliasRow = {
    raw: `${alias}/server`,
    pointAt: (target) => {
      if (fs.existsSync(alias) || fs.lstatSync(alias, { throwIfNoEntry: false })) fs.unlinkSync(alias);
      fs.symlinkSync(target === 'child' ? c.wt : outside, alias);
    },
    removeAlias: () => { fs.unlinkSync(alias); },
    repointAlias: () => { self.pointAt('outside'); },
    writeRow: () => {
      fs.writeFileSync(rowFile('uuid'), `u-${ALT}`);
      fs.writeFileSync(rowFile('workdir'), self.raw);
    },
    dropRow: () => { fs.rmSync(rowFile('uuid'), { force: true }); fs.rmSync(rowFile('workdir'), { force: true }); },
    snapshot: () => ({
      tree: treeOf(c.wt),
      branch: hh.run(`git -C "${c.main}" log --format='%H %s' refs/heads/${CHILD_BRANCH} --`).stdout,
      row: { uuid: bytes(rowFile('uuid')), workdir: bytes(rowFile('workdir')) },
      tmux: fs.readdirSync(hh.home).filter((n) => n.startsWith('tmux-')).sort()
        .map((n) => `${n}=${fs.readFileSync(path.join(hh.home, n), 'utf8')}`),
      actions: hh.calls().filter((l) => !/^tmux (has-session|list-clients|list-panes) /.test(l)),
      tomb: fs.existsSync(path.join(hh.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)),
      breadcrumb: hh.reg(CHILD_ID, 'reaping'),
      attic: hh.run(`git -C "${c.main}" for-each-ref --format='%(refname)' refs/ccrc/attic/`).stdout,
      journal: eventsOf(hh.home, 'reclaim'),
    }),
  };
  return self;
};

/** The verb's locked recomputation refused: exit 1, `probe-unmeasured` — never `state-changed`, never a
 *  terminal refusal — naming the alternate row by id, never by its spelling. Soft, so a case running several
 *  harnesses reports each one. */
const lockedUnmeasured = (v: { code: number; stdout: string; stderr: string }, raw: string): void => {
  expect.soft(v.code, v.stdout + v.stderr).toBe(1);
  const o = JSON.parse(v.stdout || '{}') as { failed?: string; refused?: string; detail?: string };
  expect.soft(o.refused, 'a retry, never a terminal refusal').toBeUndefined();
  expect.soft(o.failed).toBe('probe-unmeasured');
  expect.soft(o.detail).toContain(`registry row(s) ${ALT} `);
  expect.soft(`${o.detail}${v.stderr}`, 'the row is named by its id; its spelling is never printed').not.toContain(raw);
};

it('locked recomputation rejects an old token after alias removal', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  const tok = evalOf(h).token;
  expect(tok, 'the CONTROL: the audit minted a token before the alternate row existed').toMatch(HEX64);
  a.pointAt('child');
  a.writeRow();
  const standing = evalOf(h);
  expect(standing.verdict, `the CONTROL: through the standing alias the row is rooted inside — ${standing.detail}`)
    .toBe('containment-unproven');
  a.removeAlias();
  const before = a.snapshot();
  expect(before['tomb'] || before['breadcrumb'] !== null || before['attic'] !== '', 'the CONTROL: nothing started').toBe(false);
  const v = childReclaimVerb(h, tok);
  // What is on disk FIRST: a reclaim that went ahead shows here.
  expect(a.snapshot(), 'no WIP, attic, tombstone or breadcrumb; no unsupervise or kill; the tree, branch and row stand')
    .toEqual(before);
  lockedUnmeasured(v, a.raw);
  expect(v.stdout).not.toContain('state-changed');
}, 90_000);

it('fresh final ownership remeasures alternate projection', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  a.pointAt('outside');
  a.writeRow();
  const tok = evalOf(h).token;
  expect(tok, 'the CONTROL: a complete row outside the child is non-blocking, so the ladder passes').toMatch(HEX64);
  // The tail's first act (`_ws_unsupervise`, recorded) is the seam: after the locked ladder accepted the
  // complete row and the pin ran, before `_ws_reclaim_owned`. There the alias is removed, so the same row is
  // now only a projection, and final ownership is the only re-proof left.
  const preHookMarker = path.join(h.home, 'pre-hook-ran');
  const pre = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls";'
    + ` : > "${preHookMarker}"; rm -f -- "$HOME/alias"; };`;
  const before = a.snapshot();
  const v = childReclaimVerb(h, tok, { pre });
  expect(fs.existsSync(preHookMarker)).toBe(true); // MUTATION_FRESH_PREHOOK
  expect(fs.existsSync(path.join(h.home, 'alias')), 'the CONTROL: the alias was removed at the seam').toBe(false);
  // What is on disk FIRST.
  const after = a.snapshot();
  expect(after['tree'], `final ownership removed the tree — ${v.stdout}`).toEqual(before['tree']);
  expect(after['branch'], 'the child’s branch and its history stand').toEqual(before['branch']);
  expect(after['row'], 'the competing row stands, byte for byte').toEqual(before['row']);
  const tomb = tombOf();
  const attic = atticShas(c);
  expect(attic, 'the pins the tombstone names remain').toContain(String(tomb['tip']));
  if (tomb['wip'] !== null) expect(attic).toContain(String(tomb['wip']));
  expect(v.code, v.stdout + v.stderr).toBe(1);
  const o = JSON.parse(v.stdout) as { failed: string; detail: string };
  expect(o.failed).toBe('worktree-remove-failed');
  expect(o.detail).toContain(`registry row(s) ${ALT} `);
  expect(o.detail + v.stderr, 'the row is named by its id; its spelling is never printed').not.toContain(a.raw);
  failedPairAgrees(v);
  expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb the fresh arm wrote stays').toBe('reclaim:children');
}, 90_000);

it('resumed final ownership remeasures alternate projection', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  interrupted(c, 'worktree');
  expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree'); // MUTATION_RESUMED_PHASE
  const tok = resumeToken('worktree');
  expect(tok, 'the CONTROL: the resume token was minted before the row').toMatch(HEX64);
  a.pointAt('child');
  a.writeRow();
  a.removeAlias();
  const before = a.snapshot();
  const v = childReclaimVerb(h, tok);
  // What is on disk FIRST: this arm has no fresh ladder in front of it, so `_ws_reclaim_owned` is its only
  // cross-row re-proof.
  const after = a.snapshot();
  expect(after['tree'], `the resumed tail removed the tree — ${v.stdout}`).toEqual(before['tree']);
  expect(after['branch'], 'the child’s branch stands — no later phase ran').toEqual(before['branch']);
  expect(after['row'], 'the competing row stands, byte for byte').toEqual(before['row']);
  expect(after['attic'], 'the pins stand').toEqual(before['attic']);
  expect(h.reg(CHILD_ID, 'uuid'), 'the child’s own row stands — no later phase ran').not.toBeNull();
  expect(v.code, v.stdout + v.stderr).toBe(1);
  const o = JSON.parse(v.stdout) as { failed: string; detail: string };
  expect(o.failed).toBe('worktree-remove-failed');
  expect(o.detail).toContain(`registry row(s) ${ALT} `);
  expect(o.detail + v.stderr).not.toContain(a.raw);
  failedPairAgrees(v);
  expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
}, 90_000);

it('defer-expired does not bypass ambiguous alternate ownership', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  const deferred = evalOf(h, { defer: 1 }).token;
  expect(deferred, 'the CONTROL: a deferred token, minted before the row appeared').toMatch(HEX64);
  a.pointAt('child');
  a.writeRow();
  a.removeAlias();
  // The deferred evaluation answers the ambiguous row as every other does.
  const answer = evalOf(h, { defer: 1 });
  expect(answer.verdict, answer.detail).toBe('unmeasured');
  expect(answer.token).toBe('');
  expect(answer.detail).toContain(`registry row(s) ${ALT} `);
  // And the deferred token is rejected by the locked recomputation: the flag changes the fingerprint only.
  const before = a.snapshot();
  const v = childReclaimVerb(h, deferred, { extra: '--defer-expired' });
  expect(a.snapshot(), 'nothing reached the pin or the removal').toEqual(before);
  lockedUnmeasured(v, a.raw);
}, 90_000);

/** One liveness state of the alternate session, modelled as FIXTURE state only — production placement is
 *  handed no liveness. The token is minted before the row exists; the row, its alias removed, is identical in
 *  every state. */
const livenessCase = (hh: PrHarness, plant: () => void, defer: 0 | 1): {
  a: AliasRow; tok: string; answer: ReturnType<typeof evalOf>;
} => {
  const c = makeChild(hh);
  const a = aliasRow(hh, c);
  const tok = evalOf(hh, { defer }).token;
  expect(tok, 'the CONTROL: the token was minted before the alternate row existed').toMatch(HEX64);
  a.pointAt('child');
  a.writeRow();
  a.removeAlias();
  plant();
  return { a, tok, answer: evalOf(hh, { defer }) };
};
/** After the verb: the same preserved state, the same unmeasured placement answer at the same seam. */
const livenessSettles = (hh: PrHarness, a: AliasRow, tok: string, answer: ReturnType<typeof evalOf>, defer: 0 | 1): void => {
  const before = a.snapshot();
  const v = childReclaimVerb(hh, tok, defer ? { extra: '--defer-expired' } : {});
  expect.soft(a.snapshot(), 'the tree, branch, competing row, tmux model and unit/pane actions stand').toEqual(before);
  lockedUnmeasured(v, a.raw);
  expect.soft(answer.token).toBe('');
  expect.soft(answer.detail, 'the placement seam answered, not rung 5').toContain(`registry row(s) ${ALT} `);
};

it('liveness independent: live alternate projection refuses', () => {
  const { a, tok, answer } = livenessCase(h, () => plantTmux(h, { sessions: [`cc-${ALT}`] }), 0);
  expect(answer.verdict).toBe('unmeasured') // MUTATION_LIVE_AUTHORITY
  livenessSettles(h, a, tok, answer, 0);
  expect(tmuxSessions(h), 'the alternate session is still up').toContain(`cc-${ALT}`);
}, 90_000);

it('liveness independent: gone alternate projection refuses', () => {
  const { a, tok, answer } = livenessCase(h, () => plantTmux(h, { sessions: ['cc-unrelated'] }), 0);
  expect(answer.verdict).toBe('unmeasured') // MUTATION_GONE_AUTHORITY
  livenessSettles(h, a, tok, answer, 0);
  expect(tmuxSessions(h), 'the CONTROL: no session of the alternate row was modelled').not.toContain(`cc-${ALT}`);
}, 90_000);

it('liveness independent: unknown alternate projection refuses', () => {
  // tmux cannot be asked AT ALL here — every call fails — so the child's own rung 5 would answer first and the
  // case would measure rung 5, not placement. `--defer-expired` skips rungs 5 and 6 and nothing else, so the
  // alternate row's placement is the rung that answers. One harness per subcase, so each reports on its own.
  const subs: PrHarness[] = [];
  const fresh = (): PrHarness => { const hh = makePrHarness('ccrc-child-reclaim-unknown-'); subs.push(hh); return hh; };
  try {
    {
      const hh = fresh();
      const { a, tok, answer } = livenessCase(hh, () => plantTmux(hh, { fault: TMUX_FAULTS['permission denied'] }), 1);
      expect(answer.verdict).toBe('unmeasured') // MUTATION_UNKNOWN_AUTHORITY
      livenessSettles(hh, a, tok, answer, 1);
    }
    {
      const hh = fresh();
      const { a, tok, answer } = livenessCase(hh, () => plantTmux(hh, { fault: TMUX_FAULTS['no server running'] }), 1);
      expect(answer.verdict).toBe('unmeasured') // MUTATION_UNKNOWN_AUTHORITY
      livenessSettles(hh, a, tok, answer, 1);
    }
    {
      const hh = fresh();
      const { a, tok, answer } = livenessCase(hh, () => plantTmux(hh, { fault: TMUX_FAULTS['no socket'] }), 1);
      expect(answer.verdict).toBe('unmeasured') // MUTATION_UNKNOWN_AUTHORITY
      livenessSettles(hh, a, tok, answer, 1);
    }
  } finally { for (const hh of subs) hh.cleanup(); }
}, 240_000);

it('complete existing outside alternate row is non-blocking', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  a.pointAt('outside');
  a.writeRow();
  const answer = evalOf(h);
  expect(answer.verdict, answer.detail).toBe('reclaimable');
  const v = childReclaimVerb(h, answer.token);
  expect(v.code, v.stdout + v.stderr).toBe(0);
  expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
  expect(fs.existsSync(c.wt), 'the child was reclaimed').toBe(false);
  expect(h.reg(ALT, 'workdir'), 'the outside row stands').toBe(a.raw);
  expect(fs.existsSync(path.join(h.home, 'outside', 'server')), 'and so does the tree it names').toBe(true);
}, 90_000);

it('complete existing inside alternate row is containment-unproven', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  const tok = evalOf(h).token;
  expect(tok).toMatch(HEX64);
  a.pointAt('child');
  a.writeRow();
  const answer = evalOf(h);
  expect(answer.verdict, answer.detail).toBe('containment-unproven');
  expect(answer.detail).toContain(`registry row(s) ${ALT} rooted inside`);
  // The terminal refusal is journaled, as every refusal is; everything else stands.
  const sansJournal = (o: Record<string, unknown>): Record<string, unknown> => { const r = { ...o }; delete r['journal']; return r; };
  const before = sansJournal(a.snapshot());
  const v = childReclaimVerb(h, tok);
  expect(sansJournal(a.snapshot()), 'nothing was pinned or removed').toEqual(before);
  expect(refusedWith(v)).toBe('containment-unproven');
}, 90_000);

it('literal containment outranks incomplete physical basis', () => {
  // A row LITERALLY at or below the child is terminal whatever its resolution says: one below a missing
  // directory (a projection), one spelled through it with a `..` that cannot be placed, and — once the child's
  // tree is gone — one naming the child's own path, itself now only a projection.
  const c = makeChild(h);
  const tok = evalOf(h).token;
  expect(tok).toMatch(HEX64);
  const other = (id: string, workdir: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  };
  const drop = (id: string): void => {
    for (const f of ['uuid', 'workdir']) fs.rmSync(path.join(h.home, '.cc-sessions', `${id}.${f}`), { force: true });
  };
  other('demo-lit-nested', `${c.wt}/gone/x`);
  const nested = evalOf(h);
  expect(nested.verdict, nested.detail).toBe('containment-unproven');
  expect(nested.detail).toContain('registry row(s) demo-lit-nested rooted inside');
  const before = treeOf(c.wt);
  expect(refusedWith(childReclaimVerb(h, tok)), 'the verb refuses it terminally too').toBe('containment-unproven');
  expect(treeOf(c.wt)).toEqual(before);
  drop('demo-lit-nested');
  other('demo-lit-through', `${c.wt}/gone/../x`);
  const through = evalOf(h);
  expect(through.verdict, through.detail).toBe('containment-unproven');
  expect(through.detail).toContain(`registry row(s) demo-lit-through spell their workdir through ${c.wt}`);
  drop('demo-lit-through');
  fs.rmSync(c.wt, { recursive: true, force: true });
  other('demo-lit-same', c.wt);
  const same = evalOf(h);
  expect(same.verdict, same.detail).toBe('containment-unproven');
  expect(same.detail).toContain(`is also named by registry row(s) demo-lit-same`);
}, 90_000);

it('vanished subject remains reclaimable under R19', () => {
  // The subject's OWN missing worktree is not an alternate row: R19 reclaims it from its branch on. A complete
  // row outside it stands beside it, so the subject's own resolution is asked and compared.
  const c = makeChild(h);
  fs.mkdirSync(path.join(h.home, 'outside', 'server'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-outside.uuid'), 'u-demo-outside');
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-outside.workdir'), path.join(h.home, 'outside', 'server'));
  fs.rmSync(c.wt, { recursive: true, force: true });
  const answer = evalOf(h);
  expect(answer.verdict, answer.detail).toBe('reclaimable');
  const v = childReclaimVerb(h, answer.token);
  expect(v.code, v.stdout + v.stderr).toBe(0);
  expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
  expect(tombOf()['worktree'], 'the existing absent-worktree path').toBe('absent');
  expect(atticShas(c), 'the branch tip is pinned').toContain(c.tip);
  expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
  expect(h.reg('demo-outside', 'workdir'), 'the outside row stands').toBe(path.join(h.home, 'outside', 'server'));
}, 90_000);

it('a re-pointed alias resolves complete outside and reclaims: the pre-existing re-point class, not a recovery', () => {
  // WHAT THIS PINS IS A KNOWN HOLE, NOT A REMEDY (review 212, F3; D-3735). A session that entered `<alias>/server`
  // while the alias led into the child keeps that cwd when the alias is re-pointed outside; the spelling then
  // resolves `complete` and outside, so the reclaim removes the tree under it — its WIP pin commits `live.txt` to
  // the attic first. `complete` places the spelling as it reads now, not the session. Pre-existing (the base
  // behaves the same), left to a follow-up programme; a fix there turns this case red on purpose. The recovery is
  // the next case: purging the row.
  const c = makeChild(h);
  const a = aliasRow(h, c);
  a.pointAt('child');
  a.writeRow();
  a.removeAlias();
  const ambiguous = evalOf(h);
  expect(ambiguous.verdict, ambiguous.detail).toBe('unmeasured');
  expect(ambiguous.token).toBe('');
  a.repointAlias();
  const repointed = evalOf(h);
  expect(repointed.verdict, repointed.detail).toBe('reclaimable');
  const v = childReclaimVerb(h, repointed.token);
  expect(v.code, v.stdout + v.stderr).toBe(0);
  expect(fs.existsSync(c.wt), 'the child was reclaimed').toBe(false);
  expect(h.reg(ALT, 'workdir'), 'the re-pointed row stands').toBe(a.raw);
}, 90_000);

it('removing the ambiguous alternate row restores ordinary behavior', () => {
  const c = makeChild(h);
  const a = aliasRow(h, c);
  a.pointAt('child');
  a.writeRow();
  a.removeAlias();
  const ambiguous = evalOf(h);
  expect(ambiguous.verdict, ambiguous.detail).toBe('unmeasured');
  a.dropRow();
  const ordinary = evalOf(h);
  expect(ordinary.verdict, ordinary.detail).toBe('reclaimable');
  const v = childReclaimVerb(h, ordinary.token);
  expect(v.code, v.stdout + v.stderr).toBe(0);
  expect(fs.existsSync(c.wt), 'the child was reclaimed').toBe(false);
}, 90_000);
