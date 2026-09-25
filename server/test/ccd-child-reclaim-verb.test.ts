// `ws-reclaim` — the destructive verb for a CHILD (spec 2026-09-22 §5.5-§5.6).
// Every case builds a real child in a fixture HOME and runs the sourced
// function with the unit and pane calls RECORDED, never made. What is asserted
// is what is left on disk and in git afterwards — never what the verb says.
//
// The load-bearing pins (spec §9): `not-a-child` has no override on the fresh
// OR the resumed arm; the pause file is honoured INSIDE the verb; the WIP
// commit and the attic pins are read back from git refs; unsupervise runs on
// the resumed arm.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';
import { itLinux } from './platformFixtures.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, otherSnapshot, plantOther,
  wideDigitLocale, type Child,
} from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-verb-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${field}`);
const tombOf = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`), 'utf8')) as Record<string, unknown>;
const atticShas = (c: Child): string[] =>
  h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
    .split('\n').filter(Boolean).map((r) => r.split('/').pop()!);
const KILL = `tmux kill-session -t =cc-${CHILD_ID}`;
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));

/** Everything a refusal must leave standing. */
const intact = (c: Child): void => {
  expect(fs.existsSync(c.wt), 'the worktree survives').toBe(true);
  expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
  expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
  expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
};
const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
  expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
  const o = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(o['reclaimed'], 'a refusal never also reports a reclaim').toBeUndefined();
  return String(o['refused']);
};
/** A previous reclaim that died right after its pin phase wrote the tombstone
 *  and the breadcrumb — and before its tail unsupervised or killed anything. */
const interrupted = (c: Child, phase: string): void => {
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${CHILD_ID} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${CHILD_ID} "${c.wt}" "${c.main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${CHILD_ID} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN})" >/dev/null`
    + ` && _reg_set ${CHILD_ID} reaping reclaim:${phase}`);
  expect(h.reg(CHILD_ID, 'reaping')).toBe(`reclaim:${phase}`);
};
const resumeToken = (phase: string): string =>
  h.sh(`_ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** Point BOTH the registry row and the record the pin wrote at another
 *  project and/or workdir — so they agree, and the rung under test is the one
 *  that answers, not the agreement rung. */
const repoint = (project: string | undefined, workdir: string): void => {
  if (project !== undefined) fs.writeFileSync(reg('project'), project);
  fs.writeFileSync(reg('workdir'), workdir);
  h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify(project === undefined ? { workdir } : { project, workdir })}'`);
};
/** The journal row and the stdout document of a failure say ONE detail. */
const failedPairAgrees = (r: { stdout: string }): void => {
  const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
  const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'failed').pop()!;
  expect(row['refusal'], 'the journal names the failure the document names').toBe(doc.failed);
  expect(row['detail'], 'the journal and the document carry one detail').toBe(doc.detail);
};
/** Every entry under `dir` — path, type, mode, bytes — or `gone`. */
const treeOf = (dir: string): string[] | 'gone' => {
  if (!fs.existsSync(dir)) return 'gone';
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      if (n === '.git') continue;
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) { out.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
      else out.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
    }
  };
  walk(dir);
  return out;
};

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

describe('nested checkouts and artifacts', () => {
  it('pins and removes a nested worktree of this repository, and removes a proven-clean one of another', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const origin = path.join(h.home, 'origins', 'other.git');
    // Through the harness's git (HOME = the fixture HOME), never the vitest
    // process's own environment and its real git configuration.
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seedRepo = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seedRepo);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    h.git(h.home, 'clone', '-q', origin, path.join(c.wt, 'vendor', 'other'));
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went too').toBe('');
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('dirty.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the nested checkout’s uncommitted work is in the attic').toBeDefined();
    const tomb = tombOf() as { containment: { sameRepository: string[]; foreignProven: string[] } };
    expect(tomb.containment.sameRepository.some((p) => p.endsWith('/inner'))).toBe(true);
    expect(tomb.containment.foreignProven.some((p) => p.endsWith('/vendor/other'))).toBe(true);
  }, 90_000);

  it('a nested line with NO recorded head fails branch-moved — an empty head is never handed to the CAS', () => {
    // The pin never records one (it fails instead), but the tail reads the
    // TOMBSTONE, which is a file on disk: an empty head there is a line that
    // does not say which commit its branch may be deleted at.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const line = (tombOf()['children'] as string[]).find((l) => l.split('\t')[1] === 'ws/nested')!;
    expect(line, 'the CONTROL: the pin recorded the nested line').toBeDefined();
    const emptied = JSON.stringify({ children: [`${line.split('\t')[0]}\tws/nested\t`] });
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${emptied}'`);
    fs.rmSync(inner, { recursive: true, force: true });     // so the settle has no head to re-record
    const r = childReclaimVerb(h, resumeToken('children'));
    // `git update-ref -d <ref> ""` DELETES, unconditionally (measured, git
    // 2.43: rc 0, the branch gone) — an empty old value is no compare at all.
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch survives').toContain('ws/nested');
    expect(fs.existsSync(c.wt), 'the child’s tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-moved');
    expect(o.detail).toContain('ws/nested');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('a nested checkout swapped for a LINK to another worktree is never removed through it', () => {
    // git's record is matched by the RESOLVED path too (so a symlinked ancestor
    // cannot hide it), and a link standing at the nested path resolves to the
    // OTHER worktree's record: `worktree remove` handed that path would take
    // the other tree. So the nested leaf is re-judged before git is asked.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'uncommitted work of another session\n');
    fs.rmSync(inner, { recursive: true, force: true });
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'inner'), { recursive: true, force: true });
    fs.symlinkSync(other, inner);
    const before = otherSnapshot(h, c, other);
    const r = childReclaimVerb(h, tok);
    expect(otherSnapshot(h, c, other), '`other` was not removed through the link').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('symbolic link');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree survives').toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  for (const [label, pre] of [
    ['git’s list (the tail’s own identity rung reads it first)', 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'],
    ['the nested step’s own read of it', '_ws_reclaim_nested_record() { return 2; };'],
  ] as const) it(`a worktree list that could not be READ stops the tail before the child’s tree goes — never "no record": ${label}`, () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const r = childReclaimVerb(h, tok, { pre });
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree survives').toBe(true);
    expect(fs.existsSync(inner), 'the nested checkout survives').toBe(true);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('worktree list');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('never follows a temp root that is a symlink out of ~/.cc-tmp', () => {
    makeChild(h);
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the child’s');
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.symlinkSync(outside, path.join(h.home, '.cc-tmp', CHILD_ID));
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(outside, 'keep')), 'the target is never followed').toBe(true);
    // …and the LINK itself is collected: wave 1's `_child_tmpdir` rc 2 leaves
    // this leaf in place, and a recycled slug would meet it on every spawn.
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf symlink is unlinked').toThrow();
  }, 90_000);

  it('unlinks a temp-root leaf that is a regular FILE — the other shape wave 1 leaves behind', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-tmp', CHILD_ID), 'a file where the root should be');
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf file is unlinked').toThrow();
    expect(fs.existsSync(path.join(h.home, '.cc-tmp')), 'the root itself stays').toBe(true);
  }, 90_000);

  itLinux('removes a clips directory holding a mode-000 subdirectory — normalised, then removed', () => {
    makeChild(h);
    const locked = path.join(h.home, '.cc-clips', CHILD_ID, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'x'), 'x');
    fs.chmodSync(locked, 0o000);
    try {
      expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
      expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID))).toBe(false);
    } finally { if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755); }
  }, 90_000);
});

describe('a vanished worktree is reclaimed from what is left; a directory git does not record is refused (spec §5.5)', () => {
  it('pins the branch tip and its stashes, then removes branch, clips, temp root and row — the tombstone saying absent', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'stashed\n');
    h.git(c.wt, 'stash', 'push', '-m', 'kept');
    const stash = h.git(c.main, 'rev-parse', 'refs/stash');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
    fs.rmSync(c.wt, { recursive: true, force: true });
    // The CONTROL: git still RECORDS the vanished worktree (`prunable`), and
    // that record names the branch — the tail must clear it before its CAS.
    expect(h.git(c.main, 'worktree', 'list', '--porcelain')).toMatch(/^prunable /m);

    const r = childReclaimVerb(h, evalOf(h).token, { extra: "--surface agent --actor 'run:7 reclaim sweep'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; wip: string | null; attic: number };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.wip, 'no tree, so no WIP commit').toBeNull();

    const attic = atticShas(c);
    expect(attic, 'the branch tip is pinned').toContain(c.tip);
    expect(attic, 'the stash attributed to the branch is pinned').toContain(stash);
    expect(out.attic).toBe(attic.length);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s stale record was cleared').not.toMatch(/^prunable /m);
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID)), 'clips').toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);
    for (const field of ['uuid', 'child', 'reaping', 'workdir']) expect(h.reg(CHILD_ID, field), field).toBeNull();
    // Unsupervise and the ANCHORED kill run FIRST on this arm too (spec §5.6).
    expect(unsupervised()).toEqual([`unsupervise ${CHILD_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);

    const tomb = tombOf();
    expect(tomb['worktree']).toBe('absent');
    expect(tomb['tip'], 'the tip the branch was deleted at').toBe(c.tip);
    expect(tomb['wip']).toBeNull();
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  it('with git’s record already gone too, the registry’s branch is reclaimed and its tip is what is pinned', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    h.git(c.main, 'worktree', 'prune');                     // the fixture repository only
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the branch tip is pinned — no record is left to name it').toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('pins a DETACHED child’s last commit — reachable from git’s record alone — before the record is cleared', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.writeFileSync(path.join(c.wt, 'detached.txt'), 'on no branch');
    h.git(c.wt, 'add', 'detached.txt');
    h.git(c.wt, 'commit', '-m', 'detached work');
    const detached = h.git(c.wt, 'rev-parse', 'HEAD');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the detached commit is in the attic').toContain(detached);
    expect(h.git(c.main, 'cat-file', '-t', detached)).toBe('commit');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the registry’s branch went, at the tip it had').toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('a pin it cannot take stops the vanished arm before anything is touched — pin-failed, no breadcrumb', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const pre = `_ws_reclaim_stash_shas() { echo ${'d'.repeat(40)}; };`;
    const r = childReclaimVerb(h, evalOf(h, { pre }).token, { pre });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('pin-failed');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 60_000);

  it('the vanished arm’s pins run hook-free — a repository hook never sees an attic ref being written', () => {
    // `_ws_reclaim_pin_absent` runs under the SAME containment as the pin
    // phase (`_ws_reclaim_contained`): every `update-ref` fires
    // reference-transaction, a program the repository names.
    const c = makeChild(h);
    const hook = path.join(c.main, '.git', 'hooks', 'reference-transaction');
    fs.writeFileSync(hook, '#!/bin/sh\nin=$(cat)\ncase "$in" in *refs/ccrc/attic/*) echo ran >> "$HOME/attic-hook-runs" ;; esac\nexit 0\n',
      { mode: 0o755 });
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the CONTROL: attic refs WERE written').toContain(c.tip);
    expect(fs.existsSync(path.join(h.home, 'attic-hook-runs')), 'a repository hook ran inside the pin').toBe(false);
  }, 90_000);

  it('a unit STILL UP stops the vanished arm before the branch goes — the tail starts at the branch, unit first', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `_svc_is_active() { printf active; };` });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'nothing was deleted').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the vanished arm resumes from the branch').toBe('reclaim:branch');
    expect(tombOf()['worktree']).toBe('absent');
  }, 60_000);

  it('refuses no-worktree-record — TERMINAL, journaled — for a directory git does not record, and deletes nothing', () => {
    const c = makeChild(h);
    const admin = path.join(c.main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin), 'the CONTROL: git names the admin directory after the worktree basename').toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('no-worktree-record');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'no-worktree-record' });
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone').toBe(false);
  }, 60_000);
});

describe('the tail proves the tree is the child’s own at removal time, on EVERY arm — from the record the pin wrote (spec §5.5-§5.6)', () => {
  for (const phase of ['worktree', 'children'] as const) {
    it(`P1: a registry row re-pointed at ANOTHER worktree is never followed on a resume at \`${phase}\``, () => {
      // The review's probe P1. The row is a file on disk a resume re-reads
      // after an arbitrary gap; the tail takes the workdir from the RECORD the
      // pin wrote, and a row that no longer agrees with it stops the tail.
      const c = makeChild(h);
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const other = path.join(h.home, 'worktrees', 'demo', 'other');
      h.git(c.main, 'worktree', 'add', '--detach', other, 'main');
      fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session\n');
      const before = treeOf(other);
      fs.writeFileSync(reg('workdir'), other);
      const r = childReclaimVerb(h, tok);
      expect(treeOf(other), 'the other worktree was not removed').toEqual(before);
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'nor was the child’s').toBe(true);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain('disagree');
      failedPairAgrees(r);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe(`reclaim:${phase}`);
    }, 90_000);
  }

  it('a record that does not say it is THIS child’s stops the tail before anything is deleted', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '{"id":"demo-someone-else"}'`);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('tombstone-unwritable');
  }, 90_000);

  it('another registry row naming the same workdir stops a RESUMED tail (A10 re-asked), and an unlistable registry does too', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'), 'u-twin');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'), c.wt);
    let r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree the other row names survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('demo-twin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'));
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'));
    const regdir = path.join(h.home, '.cc-sessions');
    fs.chmodSync(regdir, 0o300);
    try {
      r = childReclaimVerb(h, tok);
    } finally { fs.chmodSync(regdir, 0o755); }
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'an unlistable registry proved nothing, and nothing went').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).detail).toContain('another registry row');
  }, 90_000);

  it('a tree that stands with NO record in git of it is not removed by a resumed tail', () => {
    // The ladder's `no-worktree-record`, re-asked on every arm: a directory
    // $main does not record is not provably one of its worktrees.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('no worktree record');
  }, 90_000);

  it('a workdir that is the project’s MAIN checkout, or the project directory itself, is never removed — both rungs', () => {
    // The ladder's two not-a-workspace rungs, re-asked by the tail. The record
    // and the row are re-pointed TOGETHER, so the agreement rung passes.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    // (a) the first stanza: the project is a LINKED worktree (`demo2`), and
    // the row names the repository's REAL main checkout — only git's first
    // stanza says what it is.
    const demo2 = path.join(h.home, 'projects', 'demo2');
    h.git(c.main, 'worktree', 'add', '-b', 'proj2-main', demo2);
    fs.writeFileSync(path.join(c.main, 'main-work.txt'), 'the project’s own uncommitted work\n');
    repoint('demo2', c.main);
    let r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.main, 'main-work.txt')), 'the main checkout survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('main checkout');
    // (b) the resolved path: the row names the project directory, a linked
    // worktree that is not the first stanza.
    fs.writeFileSync(path.join(demo2, 'proj-work.txt'), 'the project’s own uncommitted work\n');
    repoint('demo2', demo2);
    r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(demo2, 'proj-work.txt')), 'the project directory survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('project directory');
  }, 90_000);
});

describe('a nested checkout is PROVEN inside the child’s tree before it is removed — every component, and git’s record (spec §5.5)', () => {
  /** The review's probe P2b: a nested worktree at `wt/sub/inner`, a sibling
   *  worktree `other2` at `$HOME/x/inner` holding uncommitted work, and
   *  `wt/sub` swapped for a link to `$HOME/x` with the nested record pruned —
   *  so a string-prefix test passes and git resolves the path to `other2`. */
  const nestedBehindLink = (c: Child): { other2: string; swap: string } => {
    fs.mkdirSync(path.join(c.wt, 'sub'));
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', path.join(c.wt, 'sub', 'inner'));
    const x = path.join(h.home, 'x');
    fs.mkdirSync(x);
    const other2 = path.join(x, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other2', other2);
    fs.writeFileSync(path.join(other2, 'keep.txt'), 'another session\n');
    const sub = path.join(c.wt, 'sub');
    return { other2, swap: `rm -rf "${sub}"; command git -C "${c.main}" worktree prune; ln -s "${x}" "${sub}";` };
  };

  it('P2b, the fresh arm: a directory between the child and its nested checkout swapped for a link — nothing of the other worktree goes', () => {
    const c = makeChild(h);
    const { other2, swap } = nestedBehindLink(c);
    const before = treeOf(other2);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; ${swap} };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(treeOf(other2), 'the other worktree was not removed through the link').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/other2')).toContain('ws/other2');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands: the tail stopped').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('symbolic link');
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('P2b, a resume at the nested phase: the same swap, made while the act was down', () => {
    const c = makeChild(h);
    const { other2, swap } = nestedBehindLink(c);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    h.sh(swap);
    const before = treeOf(other2);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(other2), 'the other worktree was not removed through the link').toEqual(before);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('symbolic link');
  }, 90_000);

  it('a nested line whose path is NOT inside the child’s tree is never acted on — a clean sibling worktree survives', () => {
    // The record is a file on disk: a line naming a path outside the child's
    // resolved tree is not a nested checkout of this child, however its string
    // begins. Without the strict-descendant rung the walk finds nothing and
    // reads the path as "already gone", and git would clear — and, for a clean
    // tree, REMOVE — the worktree that line names.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sibling);
    const head = h.git(sibling, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${fs.realpathSync(sibling)}\tws/sibling\t${head}`] })}'`);
    const before = treeOf(sibling);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sibling), 'the sibling worktree survives').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('strictly inside');
  }, 90_000);

  it('a nested directory that stands but that git no longer records as a worktree is not removed as one', () => {
    // Its `.git` and git's admin entry both gone: the settle sees an ordinary
    // directory of the child (and pins its files into the child's WIP), and the
    // nested step — which would `worktree remove --force` the recorded path —
    // finds no record of it and stops. git's own "is not a working tree" stands
    // behind this rung; the rung is what says why.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.writeFileSync(path.join(inner, 'unpinned.txt'), 'written after the pin\n');
    fs.rmSync(path.join(inner, '.git'), { force: true });
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'inner'), { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(inner, 'unpinned.txt')), 'the unrecorded checkout survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('missing');
  }, 90_000);

  it('a nested branch another checkout still holds is KEPT — and recorded as kept, in the record and on the done row', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    // A second checkout of the same branch, outside the child (`-f`: git
    // allows it only when told to).
    h.git(c.main, 'worktree', 'add', '-f', path.join(h.home, 'elsewhere'), 'ws/nested');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the held branch was kept').toContain('ws/nested');
    expect((tombOf()['keptBranches'] as string[]).join('\n')).toContain('ws/nested');
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(String(done['detail']), 'the done row says what it kept').toContain('ws/nested');
  }, 90_000);
});

describe('the windows the proofs are asked in — each rung stands for the one after the check before it (spec §5.5)', () => {
  for (const prune of [false, true]) {
    it(`N1: the workdir swapped for a link from INSIDE the settle is stopped at the removal step (git's record ${prune ? 'pruned' : 'standing'})`, () => {
      // `_ws_reclaim_owned` asked the leaf before the settle; the settle and the
      // nested steps run after it. The suite's function-override device reaches
      // that window: `_ws_reclaim_children_merge` runs inside the settle.
      const c = makeChild(h);
      interrupted(c, 'worktree');
      const tok = resumeToken('worktree');
      const other = path.join(h.home, 'other');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
      fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session’s uncommitted work\n');
      const before = treeOf(other);
      const pre = `_ws_reclaim_children_merge() { rm -rf "${c.wt}"; ${prune ? `command git -C "${c.main}" worktree prune;` : ''}`
        + ` ln -s "${other}" "${c.wt}"; printf '%s' "$1"; };`;
      const r = childReclaimVerb(h, tok, { pre });
      expect(treeOf(other), 'the other worktree was not removed through the link').toEqual(before);
      expect(h.git(c.main, 'branch', '--list', 'ws/other')).toContain('ws/other');
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain('symbolic link');
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the worktree step').toBe('reclaim:worktree');
    }, 90_000);
  }

  it('the child’s tree swapped for a link AFTER its resolved path was taken is stopped by the nested checkout’s own resolution', () => {
    // The component walk starts BELOW the resolved root and never re-asks the
    // root itself; a nested checkout that stands must then resolve (`pwd -P`)
    // to exactly its recorded path, which a swapped root cannot. git's record
    // and git's own validation stand behind this rung too.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const x = path.join(h.home, 'x');
    fs.mkdirSync(x);
    const other2 = path.join(x, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other2', other2);
    fs.writeFileSync(path.join(other2, 'keep.txt'), 'another session\n');
    const before = treeOf(other2);
    const aside = path.join(h.home, 'aside');
    const pre = `eval "$(declare -f _ws_reclaim_nested_proven | sed '1s/_ws_reclaim_nested_proven/_orig_np/')";`
      + ` _ws_reclaim_nested_proven() { [[ -L "${c.wt}" ]] || { mv "${c.wt}" "${aside}"; ln -s "${x}" "${c.wt}"; }; _orig_np "$@"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(treeOf(other2), 'the other worktree survives').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('not to itself');
  }, 90_000);

  it('N2: a resume at `children` whose child tree has VANISHED finishes — the nested records cleared by path, nothing outside the child touched', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sibling);
    fs.writeFileSync(path.join(sibling, 'dirty.txt'), 'another session\n');
    const before = treeOf(sibling);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sibling), 'the sibling worktree is untouched').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    const list = h.git(c.main, 'worktree', 'list', '--porcelain');
    expect(list, 'the nested checkout’s stale record was cleared').not.toContain(inner);
    expect(list, 'and the child’s own').not.toContain(`worktree ${c.wt}\n`);
    expect(list, 'the sibling’s record stands').toContain(sibling);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went, at its pinned head').toBe('');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(unsupervised(), 'unsupervise still ran first').toHaveLength(1);
  }, 90_000);
});

describe('a vanished child tree lets a nested line count as gone ONLY when that is proven — inside the tree, and nothing standing (spec §5.5)', () => {
  it('G1: a symlinked ANCESTOR re-pointed since the interrupt — the child’s tree and its nested checkout still stand at the resolved path, and nothing is removed', () => {
    // The literal workdir is absent (so the vanished-tree arm is taken), but
    // the nested lines name RESOLVED paths, under the old target, where the
    // tree still stands. Not inside the workdir's resolved root: refused.
    const real = path.join(h.home, 'wtreal');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(h.home, 'worktrees'));
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.unlinkSync(path.join(h.home, 'worktrees'));
    fs.mkdirSync(path.join(h.home, 'worktrees'));
    const realInner = path.join(real, 'demo', 'quiet-basin', 'inner');
    const before = treeOf(realInner);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(realInner), 'the standing nested checkout was not removed').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch survives').toContain('ws/nested');
    expect(fs.existsSync(path.join(real, 'demo', 'quiet-basin', 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('strictly inside');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);

  it('G2u: a record line naming a sibling worktree, the child’s tree gone — the sibling, its branch and its unique commit survive', () => {
    // The same line with the tree PRESENT is the "NOT inside the child’s tree"
    // case above (G2c); both are refused by the one proof.
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sib = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sib);
    fs.writeFileSync(path.join(sib, 'uniq.txt'), 'unique committed work\n');
    h.git(sib, 'add', 'uniq.txt'); h.git(sib, 'commit', '-m', 'uniq');
    const sha = h.git(sib, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${fs.realpathSync(sib)}\tws/sibling\t${sha}`] })}'`);
    const before = treeOf(sib);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sib), 'the sibling worktree survives').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(h.git(c.main, 'for-each-ref', '--contains', sha, '--format=%(refname)'), 'its unique commit is still reachable')
      .toContain('refs/heads/ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('strictly inside');
  }, 90_000);

  it('a checkout that REAPPEARS at a nested path while the tree is gone is refused, never removed as a stale record', () => {
    // Reached with the suite's function-override device: the proof's own call
    // is the moment a writer creates the path.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const pre = `eval "$(declare -f _ws_reclaim_nested_proven | sed '1s/_ws_reclaim_nested_proven/_orig_np/')";`
      + ` _ws_reclaim_nested_proven() { mkdir -p "${inner}"; echo late > "${inner}/keep.txt"; _orig_np "$@"; };`;
    const r = childReclaimVerb(h, tok, { pre });
    expect(fs.existsSync(path.join(inner, 'keep.txt')), 'what stands at the path survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('stands at');
  }, 90_000);
});

describe('a nested branch on a line counted as gone is deleted only when it is provably the line’s, and never unpinned (spec §5.5)', () => {
  /** A commit no ref but `ws/parked` holds, made after the pin phase — so no
   *  pin the act took before its interrupt can cover it. */
  const parkedCommit = (c: Child, at: string, record: boolean): string => {
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/parked', at);
    fs.writeFileSync(path.join(at, 'p.txt'), 'parked\n');
    h.git(at, 'add', 'p.txt'); h.git(at, 'commit', '-q', '-m', 'parked unique');
    const sha = h.git(at, 'rev-parse', 'HEAD');
    if (!record) h.git(c.main, 'worktree', 'remove', at);
    return sha;
  };
  const containing = (c: Child, sha: string): string => h.git(c.main, 'for-each-ref', '--contains', sha, '--format=%(refname)');

  it('S3-gone: a wrong line naming an absent path inside the vanished tree, which git records no checkout at, keeps the unheld branch it names', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sha = parkedCommit(c, path.join(h.home, 'parkwt'), false);
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    // Reachability FIRST, so a red names the loss the probe measured (the
    // commit reachable from nothing), not only a branch that went.
    expect(containing(c, sha), 'its unique commit is still reachable').not.toBe('');
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'the branch no record ties to that path was kept').toContain('ws/parked');
    expect(containing(c, sha), 'and reachable from the branch itself').toContain('refs/heads/ws/parked');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect((tombOf()['keptBranches'] as string[]).join('; ')).toContain('ws/parked (git records no checkout of it at');
  }, 90_000);

  it('a line counted as gone whose branch IS git’s record there has its head pinned in the attic before the branch is deleted', () => {
    // The same wrong-line class with git's record standing: every proof
    // passes, and the head was never pinned — the tree's settle re-pin never
    // ran, and the checkout appeared after the pin phase.
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost, true);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(containing(c, sha), 'the deleted branch’s commit is pinned, not lost')
      .toContain(`refs/ccrc/attic/${CHILD_ID}/${sha}`);
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'the branch went, at its pinned head').toBe('');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('a gone line whose git record names ANOTHER branch deletes nothing — the branch the line names stands', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    parkedCommit(c, ghost, true);
    h.git(c.main, 'branch', 'ws/bystander', c.tip);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/bystander\t${c.tip}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(h.git(c.main, 'branch', '--list', 'ws/bystander'), 'the line’s branch stands').toContain('ws/bystander');
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'and the recorded one').toContain('ws/parked');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain("is on 'ws/parked', not 'ws/bystander'");
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);

  it('a gone line naming $main’s own line (origin/HEAD’s branch, with the main checkout elsewhere) keeps that branch', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    h.git(c.main, 'worktree', 'add', '-q', ghost, 'main');
    const sha = h.git(ghost, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tmain\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(h.git(c.main, 'branch', '--list', 'main'), 'the main line stands').toContain('main');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((tombOf()['keptBranches'] as string[]).join('; ')).toContain('main (the main line of');
  }, 90_000);

  it('a gone line’s head that cannot be pinned fails the tail pin-failed — the branch stands, and nothing further is deleted', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost, true);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    // The tree is gone, so no settle runs: this is the only pin the resume takes.
    const r = childReclaimVerb(h, tok, { pre: '_ws_reclaim_attic_extra() { return 1; };' });
    expect(containing(c, sha), 'the unpinned head is still the branch’s').toContain('refs/heads/ws/parked');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'nothing further: the child’s own branch stands').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'and its registry row').not.toBeNull();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain('a branch is never deleted unpinned');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
    failedPairAgrees(r);
  }, 90_000);
});

describe('"gone" is PROVEN — a path that could not be looked at is never read as absent (spec §5.5)', () => {
  // `artifacts` too: no step (3)-(5) proof runs there, so the removal-time
  // identity check (`_ws_reclaim_owned`) is the only rung before the row goes.
  for (const phase of ['children', 'worktree', 'branch', 'artifacts']) {
    it(`S1d: the child’s parent directory made unsearchable on a resume at \`${phase}\` stops the tail — both trees, both records, both branches stand`, () => {
      const c = makeChild(h);
      const inner = path.join(c.wt, 'inner');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
      fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const demo = path.join(h.home, 'worktrees', 'demo');
      const nestedGit = fs.readFileSync(path.join(inner, '.git'), 'utf8');
      let r: { code: number; stdout: string; stderr: string };
      fs.chmodSync(demo, 0o000);
      try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(demo, 0o755); }
      expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
      expect(fs.readFileSync(path.join(inner, '.git'), 'utf8'), 'still a checkout').toBe(nestedGit);
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
      const list = h.git(c.main, 'worktree', 'list', '--porcelain');
      expect(list, 'the nested record stands').toContain(`branch refs/heads/ws/nested`);
      expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'uuid'), 'the registry row stands').not.toBeNull();
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`${demo} cannot be searched`);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe(`reclaim:${phase}`);
      // Not a wedge: once the directory can be searched, the same act finishes.
      // (Not asked at `branch` or `artifacts`: a tree still standing there is no
      // state the tail leaves — step (4) removed it.)
      if (phase === 'branch' || phase === 'artifacts') return;
      const again = childReclaimVerb(h, resumeToken(phase));
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(JSON.parse(again.stdout).reclaimed).toBe(CHILD_ID);
    }, 90_000);
  }

  it('a nested checkout whose own parent turns unsearchable after the settle is never counted as gone', () => {
    const c = makeChild(h);
    const sub = path.join(c.wt, 'sub');
    fs.mkdirSync(sub);
    const inner = path.join(sub, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const pre = `eval "$(declare -f _ws_reclaim_children_merge | sed '1s/_ws_reclaim_children_merge/_orig_cm/')";`
      + ` _ws_reclaim_children_merge() { chmod 000 "${sub}"; _orig_cm "$@"; };`;
    let r: { code: number; stdout: string; stderr: string };
    try { r = childReclaimVerb(h, tok, { pre }); } finally { fs.chmodSync(sub, 0o755); }
    expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'its record stands').toContain('branch refs/heads/ws/nested');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`${fs.realpathSync(sub)} cannot be searched`);
  }, 90_000);

  it('the fresh ladder: a workdir under an unsearchable directory is unmeasured, never the vanished arm', () => {
    makeChild(h);
    const demo = path.join(h.home, 'worktrees', 'demo');
    let a: { verdict: string; token: string; detail: string };
    fs.chmodSync(demo, 0o000);
    try { a = evalOf(h, { childOf: String(CHILD_RUN) }); } finally { fs.chmodSync(demo, 0o755); }
    expect(a.verdict).toBe('unmeasured');
    expect(a.detail).toContain(`${demo} cannot be searched`);
  }, 90_000);

  it('`_ws_reclaim_absent` answers 0 only for ENOENT under a directory it can search, 1 for anything standing, 2 for a look that failed', () => {
    const d = path.join(h.home, 'absent-probe');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'file'), 'x');
    fs.symlinkSync(path.join(d, 'nowhere'), path.join(d, 'dangling'));
    const locked = path.join(d, 'locked');
    fs.mkdirSync(locked);
    const ask = (p: string): string => h.sh(`_ws_reclaim_absent '${p}'; printf '%s' "$?"`);
    expect(ask(path.join(d, 'missing')), 'ENOENT').toBe('0');
    expect(ask(path.join(d, 'missing', 'deeper')), 'ENOENT of the first missing component').toBe('0');
    expect(ask(path.join(d, 'file')), 'a file stands').toBe('1');
    expect(ask(path.join(d, 'dangling')), 'a dangling link stands').toBe('1');
    expect(ask(path.join(d, 'file', 'below')), 'a parent that is a file is no directory to look in').toBe('2');
    // A searchable parent and a stat that fails for another reason than
    // ENOENT: `[[ -e ]]` is false here exactly as it is on ENOENT.
    expect(ask(path.join(d, 'n'.repeat(300))), 'ENAMETOOLONG is not absence').toBe('2');
    fs.chmodSync(locked, 0o000);
    try { expect(ask(path.join(locked, 'inner')), 'EACCES is not absence').toBe('2'); } finally { fs.chmodSync(locked, 0o755); }
  }, 30_000);

  for (const phase of ['children', 'worktree']) {
    it(`the child’s parent turning unsearchable AFTER the removal-time identity check, on a resume at \`${phase}\`, stops the tail at that step`, () => {
      // `_ws_reclaim_owned` asks before the settle; this makes the directory
      // unsearchable inside the settle, so the step's own proof is the rung.
      const c = makeChild(h);
      const inner = path.join(c.wt, 'inner');
      if (phase === 'children') {
        h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
        fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
      }
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const demo = path.join(h.home, 'worktrees', 'demo');
      const pre = `eval "$(declare -f _ws_reclaim_children_merge | sed '1s/_ws_reclaim_children_merge/_orig_cm/')";`
        + ` _ws_reclaim_children_merge() { chmod 000 "${demo}"; _orig_cm "$@"; };`;
      let r: { code: number; stdout: string; stderr: string };
      try { r = childReclaimVerb(h, tok, { pre }); } finally { fs.chmodSync(demo, 0o755); }
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      if (phase === 'children') {
        expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
        expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
      }
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`${demo} cannot be searched`);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that stopped').toBe(`reclaim:${phase}`);
    }, 90_000);
  }

  it('a residue root that cannot be searched is unmeasured — null, never a measured 0', () => {
    const c = makeChild(h);
    const root = path.join(h.home, 'residue');
    fs.mkdirSync(root);
    const tok = evalOf(h).token;
    let r: { code: number; stdout: string; stderr: string };
    fs.chmodSync(root, 0o000);
    try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(root, 0o755); }
    expect(fs.existsSync(c.wt), 'the reclaim itself ran').toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).residueBytes).toBeNull();
  }, 90_000);
});

describe('the residue probe’s DEFAULT root is the BOX’s own TMPDIR, never a bare /tmp (macOS scan, mail 2375)', () => {
  it('derives ${TMPDIR:-/tmp}/claude-<uid> — the same derivation ccd-tmp-sweep uses — with no override set', () => {
    // Every other case in this file drives `_ws_reclaim_residue` through
    // `CCD_RECLAIM_RESIDUE_ROOT` (`CHILD_ENV`, the fixture's own override for
    // exactly this reason: the real default must never be read in a test). This
    // is the one case that reads the DEFAULT, so it plants under a fixture
    // TMPDIR rather than the real `/tmp` — never against the live box.
    const c = makeChild(h);
    const uid = h.sh('id -u');
    const boxTmp = path.join(h.home, 'box-tmp');
    fs.mkdirSync(boxTmp, { recursive: true });
    const residue = path.join(boxTmp, `claude-${uid}`, c.wt.replaceAll('/', '-'));
    fs.mkdirSync(residue, { recursive: true });
    fs.writeFileSync(path.join(residue, 'scratch.txt'), 'scratch under the box TMPDIR, not /tmp');
    const expected = Number(h.sh(`_plat_bytes "${residue}"`));
    expect(expected).toBeGreaterThan(0);
    const out = Number(h.sh(`_ws_reclaim_residue "${c.wt}"`, { TMPDIR: boxTmp }));
    expect(out, 'measured under $TMPDIR/claude-<uid>, never a bare /tmp/claude-<uid>').toBe(expected);
  });
});

describe('the tail never deletes, and the pin never writes, what is not provably the child’s own (spec §5.5; the final review’s probes)', () => {
  const tombKept = (): string => ((tombOf()['keptBranches'] as string[] | undefined) ?? []).join('; ');
  const done = (): Record<string, unknown> => {
    const rows = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'done');
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  it('P1: a child drifted onto `main` (its main checkout elsewhere) keeps `main`, records it, and deletes only its own branch', () => {
    const c = makeChild(h);
    expect(h.git(c.main, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD'), 'the fixture names the main line').toBe('refs/remotes/origin/main');
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    h.git(c.wt, 'checkout', '-q', 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'uncommitted\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, e.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed?: string; wip: string };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was deleted or written').toBe(mainTip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s own branch was left').toBe('');
    expect(atticShas(c)).toContain(c.tip);
    expect(atticShas(c)).toContain(out.wip);
    expect(h.git(c.main, 'log', '-1', '--format=%P', out.wip)).toBe(mainTip);
    expect(h.git(c.main, 'show', `${out.wip}:wip.txt`)).toBe('uncommitted');
    expect(tombOf()['branch']).toBe(CHILD_BRANCH);
    expect(tombKept()).toContain(`main (checked out at ${c.wt} in place of ${CHILD_BRANCH})`);
    expect(String(done()['detail'])).toContain('kept branch(es): main (');
  }, 90_000);

  it('P1, vanished: a record left on `main` keeps `main` — the registry’s branch is the one deleted', () => {
    const c = makeChild(h);
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    h.git(c.wt, 'checkout', '-q', 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, e.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was deleted').toBe(mainTip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(tombKept()).toContain(`main (git's record of ${c.wt} named it in place of ${CHILD_BRANCH})`);
  }, 90_000);

  it('the ladder refuses branch-elsewhere — terminal, nothing touched — when the child’s own branch is the main line, or that cannot be told', () => {
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/remotes/origin/${CHILD_BRANCH}`, c.tip);
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${CHILD_BRANCH}`);
    const line = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(line.verdict).toBe('branch-elsewhere');
    expect(line.detail).toContain(`${CHILD_BRANCH} is the main line of`);
    h.git(c.main, 'symbolic-ref', '-d', 'refs/remotes/origin/HEAD');
    const unset = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(unset.verdict, 'an unset origin/HEAD proves nothing — never 1, never a delete').toBe('branch-elsewhere');
    expect(unset.detail).toContain('could not be told');
    expect(refusedWith(childReclaimVerb(h, line.token || '0'.repeat(64)))).toBe('branch-elsewhere');
    intact(c);
  }, 90_000);

  it('the VANISHED arm’s ladder refuses branch-elsewhere the same way — the main line, or an unset origin/HEAD', () => {
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/remotes/origin/${CHILD_BRANCH}`, c.tip);
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${CHILD_BRANCH}`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const line = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(line.verdict, line.detail).toBe('branch-elsewhere');
    expect(line.detail).toContain(`${CHILD_BRANCH} is the main line of`);
    h.git(c.main, 'symbolic-ref', '-d', 'refs/remotes/origin/HEAD');
    const unset = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(unset.verdict, unset.detail).toBe('branch-elsewhere');
    expect(unset.detail).toContain('could not be told');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('branch-elsewhere');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch was deleted').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row was purged').not.toBeNull();
  }, 90_000);

  it('the tail keeps the branch when it becomes unprovable between the pin and step (5) — a breadcrumb, never a delete', () => {
    const c = makeChild(h);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; git -C "${c.main}" symbolic-ref -d refs/remotes/origin/HEAD; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(r.code).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string; detail: string }).failed).toBe('branch-elsewhere');
    expect(r.stdout).toContain('could not be told');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch was deleted').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:branch');
  }, 90_000);

  it('P4: a COPY of another worktree inside the child refuses containment-unproven, and the other session’s branch and index are untouched', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/other', other);
    const otherTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/other');
    fs.cpSync(other, path.join(c.wt, 'copy'), { recursive: true });
    fs.writeFileSync(path.join(c.wt, 'copy', 'dirty.txt'), 'x\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('containment-unproven');
    expect(e.detail).toContain(`${path.join(c.wt, 'copy')}`);
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('containment-unproven');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/ws/other'), 'another session’s branch was written').toBe(otherTip);
    expect(h.git(other, 'status', '--porcelain'), 'another session’s index was changed').toBe('');
    intact(c);
  }, 90_000);

  it('P8: a child whose `.git` names a DETACHED sibling’s admin directory refuses containment-unproven, and the sibling is untouched', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '--detach', other, 'main');
    const otherHead = h.git(other, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(c.wt, '.git'), fs.readFileSync(path.join(other, '.git')));
    fs.writeFileSync(path.join(c.wt, 'child-work.txt'), 'x\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('containment-unproven');
    expect(e.detail).toContain('another checkout');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('containment-unproven');
    expect(h.git(other, 'rev-parse', 'HEAD'), 'the sibling’s HEAD moved').toBe(otherHead);
    expect(h.git(other, 'status', '--porcelain'), 'the sibling’s index was changed').toBe('');
  }, 90_000);

  it('P5: a registered nested worktree ON `main` is pinned without writing `main`, and `main` is kept', () => {
    const c = makeChild(h);
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    const nest = path.join(c.wt, 'nest');
    h.git(c.main, 'worktree', 'add', '-q', nest, 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.writeFileSync(path.join(nest, 'nwip.txt'), 'nested uncommitted\n');
    const r = childReclaimVerb(h, evalOf(h, { childOf: String(CHILD_RUN) }).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was written').toBe(mainTip);
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('nwip.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the nested work is not in the attic').toBeDefined();
    expect(tombKept()).toContain('main (the main line of');
  }, 90_000);

  it('P2: a stale index.lock defers tree-busy on the fresh arm, and --defer-expired reclaims through it — never pin-failed for good', () => {
    const c = makeChild(h);
    const lock = `${h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index')}.lock`;
    fs.writeFileSync(lock, '');
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'w\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('tree-busy');
    expect(e.detail).toContain('index lock');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('tree-busy');
    intact(c);
    const d = evalOf(h, { childOf: String(CHILD_RUN), defer: 1 });
    expect(d.verdict, d.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, d.token, { extra: '--defer-expired' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { wip: string };
    expect(h.git(c.main, 'show', `${out.wip}:wip.txt`)).toBe('w');
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('P3: an index.lock the pane kill leaves behind does not fail the settle — the reclaim completes', () => {
    const c = makeChild(h);
    const lock = `${h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index')}.lock`;
    const pre = `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; [[ "$1" == kill-session ]] && : > "${lock}"; return 1; };`;
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'w\n');
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.calls()).toContain(KILL);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.reg(CHILD_ID, 'uuid')).toBeNull();
  }, 90_000);
});
