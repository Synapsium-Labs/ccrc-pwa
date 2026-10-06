// `ws-expire` — the destructive verb for an ARCHIVED workspace, seven days after its archive (workspace lifecycle
// spec 2026-09-24 §5.3). Every case builds a real archived workspace in a fixture HOME and runs the sourced function
// with the unit and pane calls RECORDED, never made. What is asserted is what is left on disk and in git afterwards —
// read back from refs and files, never from the verb's word.
//
// The load-bearing pins: nothing git knows is lost (every commit, stash and operation head reachable from the attic
// after the worktree and branch are gone and the repository is garbage-collected); ignored and secret-shaped files and
// the clips are RECORDED (paths, and sizes where the record has them) before they go; transcripts are untouched; the
// token binds the archive epoch, so a return and a re-archive refuse `state-changed`; a crash at every phase resumes
// through the `expire:` breadcrumb and re-asserts the epoch first; ws-reap refuses that breadcrumb (`expire-in-progress`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, CFG_DIR, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';
import { childIndex, gcNow, hasCommit, hookRuns, plantRepoPrograms, plantTmux, tmuxSessions } from './childReclaimFixture.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, NOW, OLD, archiveAt, expireEvalOf, expireVerb, holdCwd, makeArchived, type Archived,
} from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-verb-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);
const tombOf = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`), 'utf8')) as Record<string, unknown>;
const atticRefs = (a: Archived): string[] =>
  h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
/** Every commit the attic KEEPS: reachable from any ref under `refs/ccrc/attic/<id>/`. */
const atticReach = (a: Archived): string[] => {
  const refs = atticRefs(a);
  return refs.length ? h.git(a.main, 'rev-list', ...refs).split('\n').filter(Boolean) : [];
};
const KILL = `tmux kill-session -t =cc-${EXP_ID}:`;
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));
/** Everything a refusal must leave standing. */
const intact = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'the worktree survives').toBe(true);
  expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch survives').toContain(EXP_BRANCH);
  expect(h.reg(EXP_ID, 'uuid'), 'the registry row survives').not.toBeNull();
  expect(h.reg(EXP_ID, 'archived'), 'the archive survives').not.toBeNull();
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
  expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
};
const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
  expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
  const o = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(o['expired'], 'a refusal never also reports an expiry').toBeUndefined();
  return String(o['refused']);
};
/** The transcript Claude Code keeps for this session's CURRENT uuid, outside the worktree (`_transcript_path`). */
const plantTranscript = (a: Archived): string => {
  const cfg = path.join(h.home, CFG_DIR[h.reg(EXP_ID, 'wrapper')!]!);
  const munged = fs.realpathSync(a.wt).replace(/[./_]/g, '-');
  const file = path.join(cfg, 'projects', munged, `${h.reg(EXP_ID, 'uuid')}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"type":"user","message":"the whole conversation"}\n');
  return file;
};
/** A previous expiry that died right after its pin phase wrote the tombstone and the breadcrumb — before its tail
 *  unsupervised or deleted anything — then, for a later phase, the deletions the tail had already made. */
const interrupted = (a: Archived, phase: 'children' | 'worktree' | 'branch' | 'artifacts'): void => {
  h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
    + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
    + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
    + ` && _reg_set ${EXP_ID} reaping expire:${phase}`);
  if (phase === 'branch' || phase === 'artifacts') h.git(a.main, 'worktree', 'remove', '--force', a.wt);
  if (phase === 'artifacts') h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
  expect(h.reg(EXP_ID, 'reaping')).toBe(`expire:${phase}`);
};
const resumeToken = (phase: string): string =>
  h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** Everything an expiry must have removed, and everything it must have kept. */
const expired = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'worktree').toBe(false);
  expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'branch').toBe('');
  for (const field of ['uuid', 'archived', 'reaping', 'workdir']) expect(h.reg(EXP_ID, field), field).toBeNull();
  expect(fs.existsSync(path.join(h.home, '.cc-clips', EXP_ID)), 'clips').toBe(false);
  expect(atticReach(a), 'the branch tip is kept in the attic').toContain(a.tip);
};

describe('a fresh expiry', () => {
  it('pins, then removes the unit, worktree, branch, clips and registry row — and records what it dropped', () => {
    const a = makeArchived(h);
    fs.writeFileSync(path.join(a.wt, '.gitignore'), 'build/\n*.log\n');
    fs.appendFileSync(path.join(a.wt, 'f1.txt'), 'edited, never committed\n');
    fs.writeFileSync(path.join(a.wt, 'notes.txt'), 'untracked work');
    fs.mkdirSync(path.join(a.wt, 'build'));
    fs.writeFileSync(path.join(a.wt, 'build', 'out.bin'), 'x'.repeat(1234));
    fs.writeFileSync(path.join(a.wt, 'debug.log'), 'y'.repeat(77));
    fs.writeFileSync(path.join(a.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(h.home, '.cc-clips', EXP_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', EXP_ID, 'shot.png'), 'png-bytes');
    const transcript = plantTranscript(a);

    const r = expireVerb(h, expireEvalOf(h).token, { extra: "--surface agent --actor 'expiry sweep'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { expired: string; archivedAt: number; wip: string; attic: number; secretsDropped: number };
    expect(out.expired).toBe(EXP_ID);
    expect(out.archivedAt).toBe(OLD);
    expect(out.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(out.secretsDropped).toBe(1);
    expired(a);

    // The work is in the attic, read back from git; the secret never reached a commit.
    expect(atticReach(a)).toContain(out.wip);
    const tree = h.git(a.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n');
    expect(tree).toEqual(expect.arrayContaining(['notes.txt', 'f1.txt', '.gitignore']));
    expect(tree).not.toContain('.env');
    expect(tree, 'an ignored file is recorded, never committed').not.toContain('build/out.bin');
    expect(h.git(a.main, 'log', '-1', '--format=%s', out.wip)).toBe(`ccrc: WIP pinned at expiry of ${EXP_ID} (archived at ${OLD})`);

    // Unsupervise, then the ANCHORED kill — both, in that order.
    expect(unsupervised()).toEqual([`unsupervise ${EXP_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);

    // THE RECORD: its kind, its binding, the ignored files with their sizes, the secret dropped, the clips by name,
    // the transcript by path — and the transcript itself, untouched.
    const tomb = tombOf();
    expect(tomb['mode']).toBe('expire');
    expect(tomb['archivedAt']).toBe(OLD);
    expect(tomb['childOf'], 'an expiry binds the archive, never a run').toBeUndefined();
    expect(tomb['ignored']).toEqual(expect.arrayContaining([
      { path: 'build/', bytes: expect.any(Number), sensitive: false },
      { path: 'debug.log', bytes: 77, sensitive: false },
    ]));
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['clips']).toEqual([{ name: 'shot.png', bytes: 9 }]);
    expect(tomb['transcript']).toBe(transcript);
    expect(fs.readFileSync(transcript, 'utf8'), 'the transcript is kept, byte for byte').toContain('the whole conversation');

    const events = eventsOf(h.home, 'expire');
    const intent = events.find((e) => e['outcome'] === 'intent')!;
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(intent['tx'], 'one intent/done pair').toBe(done['tx']);
    expect(intent['verb']).toBe('ws-expire');
    expect(measOf(intent)['archivedAt']).toBe(String(OLD));
    expect(measOf(done)['archivedAt']).toBe(String(OLD));
    expect(measOf(done)['wip']).toBe(out.wip);
    expect(eventsOf(h.home, 'reclaim'), 'an expiry never journals as a reclaim').toEqual([]);
  }, 120_000);

  it('NOTHING GIT KNOWS IS LOST: every commit, stash and operation head is reachable from the attic after a gc', () => {
    const a = makeArchived(h);
    fs.appendFileSync(path.join(a.wt, 'f1.txt'), 'stashed edit\n');
    h.git(a.wt, 'stash', 'push', '-m', 'stashed before the archive');
    const stash = h.git(a.wt, 'rev-parse', 'refs/stash');
    // An operation head nobody finished, and a commit reachable only from it and the reflog.
    const orphan = h.git(a.wt, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'only an operation head names this');
    fs.writeFileSync(h.git(a.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'ORIG_HEAD'), `${orphan}\n`);
    const commits = h.git(a.main, 'rev-list', `refs/heads/${EXP_BRANCH}`).split('\n');
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expired(a);
    gcNow(h, a.main);
    for (const sha of [...commits, stash, orphan]) {
      expect(hasCommit(h, a.main, sha), `${sha} survives the gc`).toBe(true);
      expect(atticReach(a), `${sha} is reachable from the attic`).toContain(sha);
    }
  }, 120_000);

  it('a VANISHED worktree is expired from what is left: the branch tip pinned, the tombstone says absent', () => {
    const a = makeArchived(h);
    fs.rmSync(a.wt, { recursive: true, force: true });
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expired(a);
    expect(tombOf()['worktree']).toBe('absent');
  }, 120_000);
});

describe('a refusal destroys nothing, and every one is journaled as an expiry', () => {
  it('refuses state-changed on a wrong token and on a tree that moved after the audit', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    fs.writeFileSync(path.join(a.wt, 'late.txt'), 'typed after the audit');
    expect(refusedWith(expireVerb(h, tok))).toBe('state-changed');
    intact(a);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'expire', token: 'state-changed' });
  }, 90_000);

  it('A RETURN AND A RE-ARCHIVE START A NEW WEEK: the old token refuses state-changed, and so does a young re-archive', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    // Brought back (every spawn path clears the whole archive), then archived again — older than a week still.
    h.sh(`_ws_unarchive ${EXP_ID}`);
    archiveAt(h, OLD + 3600);
    expect(refusedWith(expireVerb(h, tok)), 'the token bound the first archive').toBe('state-changed');
    // ...and archived again an hour ago: a new week, whatever token is offered.
    archiveAt(h, NOW - 3600);
    expect(refusedWith(expireVerb(h, tok))).toBe('not-expired');
    intact(a);
  }, 90_000);

  it('refuses every rung the ladder refuses — not-archived, child, paused, held, live — reading each itself', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(expireVerb(h, tok)), 'the switch lands AFTER the token was minted').toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'program:x wave:1/2');
    expect(refusedWith(expireVerb(h, tok))).toBe('held');
    fs.rmSync(reg('hold'));
    expect(refusedWith(expireVerb(h, tok, { pre: '_svc_is_active() { printf active; };' }))).toBe('live');
    fs.writeFileSync(reg('child'), '7\n');
    expect(refusedWith(expireVerb(h, tok))).toBe('child');
    fs.rmSync(reg('child'));
    fs.rmSync(reg('archived'));
    expect(refusedWith(expireVerb(h, tok))).toBe('not-archived');
    archiveAt(h, OLD);
    expect(fs.existsSync(a.wt)).toBe(true);
    for (const t of ['paused', 'held', 'live', 'child', 'not-archived']) {
      expect(refusalsOf(h.home), t).toContainEqual({ act: 'expire', token: t });
    }
  }, 120_000);

  it('refuses in-use when a process stands in the worktree at the instant of deletion — a token minted before it arrived', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    const sleeper = holdCwd(a.wt);
    try {
      expect(refusedWith(expireVerb(h, tok))).toBe('in-use');
      intact(a);
      expect(refusalsOf(h.home)).toContainEqual({ act: 'expire', token: 'in-use' });
      expect(h.reg(EXP_ID, 'reaping'), 'a refusal leaves no breadcrumb').toBeNull();
    } finally { sleeper.stop(); }
  }, 90_000);

  it('refuses in-progress while another ccd process holds the reap lock', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    const r = h.run(`exec 9>>"$HOME/.cc-sessions/.reap-${EXP_ID}.lock"; flock -n 9;`
      + ` ${EXP_STUBS} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`);
    expect(refusedWith(r)).toBe('in-progress');
    intact(a);
  }, 60_000);

  it('has no --defer-expired: the flag is a usage error and nothing is touched — attached, live and tree-busy are never skipped', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireEvalOf(h).token, { extra: '--defer-expired' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage: ccd ws-expire --expect <token> --session <id>');
    intact(a);
  }, 60_000);
});

describe('a crash at each phase resumes through the `expire:` breadcrumb — and re-asserts the archive first', () => {
  for (const phase of ['children', 'worktree', 'branch', 'artifacts'] as const) {
    it(`resumes at ${phase}: the tail finishes, unsupervising and killing first, and the record says it resumed`, () => {
      const a = makeArchived(h);
      interrupted(a, phase);
      const r = expireVerb(h, resumeToken(phase));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
      expired(a);
      expect(unsupervised(), 'the resumed arm unsupervises too').toHaveLength(1);
      const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
      expect(measOf(done)['resumed']).toBe(phase);
    }, 120_000);
  }

  it('re-asserts the epoch: archived again since the expiry began refuses state-changed; not archived, not-archived', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    archiveAt(h, OLD + 60);
    expect(refusedWith(expireVerb(h, tok))).toBe('state-changed');
    fs.rmSync(reg('archived'));
    expect(refusedWith(expireVerb(h, tok))).toBe('not-archived');
    archiveAt(h, OLD);
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands').toBe('expire:children');
  }, 120_000);

  // P3 (fix round 1). `_ws_expire_archived` runs BEFORE the epoch comparison and re-asserts the age, so a YOUNG
  // re-archive answers `not-expired` and only an OLD one reaches `state-changed`. Pins existing behaviour.
  it('re-asserts the age before the epoch: archived again YOUNG since the expiry began refuses not-expired', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    archiveAt(h, NOW - 3600);
    expect(refusedWith(expireVerb(h, tok))).toBe('not-expired');
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands').toBe('expire:children');
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
  }, 120_000);

  it('re-asserts the rest of what authorised it — the child marker, the switch, the hold — and a stale resume token', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(reg('child'), '7\n');
    expect(refusedWith(expireVerb(h, tok))).toBe('child');
    fs.rmSync(reg('child'));
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(expireVerb(h, tok))).toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'x');
    expect(refusedWith(expireVerb(h, tok))).toBe('held');
    fs.rmSync(reg('hold'));
    expect(refusedWith(expireVerb(h, resumeToken('children'))), 'a token for another phase').toBe('state-changed');
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 120_000);

  // RULING (D), CARRIED TO THE RESUME: at `children` the teardown has not begun — the tail has stopped nothing — so a
  // pane or a unit standing there is somebody's, and is refused `live`, never killed. From `worktree` on, the
  // interrupted run had already stopped both, and the tail's unsupervise-and-kill runs as a reclaim's — but at
  // `worktree` the tree may still STAND (the breadcrumb is written before the tail removes it), so the one question
  // asked there is the cwd probe, `in-use` (3964); the pane and the unit are never asked.
  it('at `children`, a pane or a unit that stands refuses live — nothing is stopped, nothing deleted', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    expect(refusedWith(expireVerb(h, tok)), 'a detached pane').toBe('live');
    plantTmux(h, { sessions: [] });
    expect(refusedWith(expireVerb(h, tok, { pre: '_svc_is_active() { printf active; };' })), 'a running unit').toBe('live');
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:children');
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
  }, 120_000);

  it('the resume’s live refusal never claims "no terminal attached" — its probe never asked for clients', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`], clients: { [`cc-${EXP_ID}`]: '/dev/pts/3' } });
    const r = expireVerb(h, tok);
    expect(refusedWith(r), 'a pane with a terminal attached').toBe('live');
    const detail = (JSON.parse(r.stdout) as { detail: string }).detail;
    expect(detail).toContain(`cc-${EXP_ID} is up`);
    expect(detail, 'true of a pane with a client too').not.toContain('no terminal attached');
  }, 120_000);

  // AMENDMENT 3 (3962), CARRIED TO THE RESUME: a process of the box with its cwd in the worktree is asked about again at
  // `children`, where nothing has been deleted — and the breadcrumb stands for the retry once it has left.
  it('at `children`, a process with its working directory in the worktree refuses in-use — nothing stopped, nothing deleted', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    const sleeper = holdCwd(a.wt);
    try {
      const r = expireVerb(h, tok);
      expect(refusedWith(r)).toBe('in-use');
      expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain(`process ${sleeper.pid} `);
      expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
      expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:children');
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
      expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
    } finally { sleeper.stop(); }
    const again = expireVerb(h, tok);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expired(a);
  }, 120_000);

  // THE VANISHED-WORKTREE ARM'S FIRST BREADCRUMB IS `expire:branch`, written before the tail has stopped anything (the
  // arm skips `children`). A crash between that breadcrumb and the tail's unsupervise leaves a resume at `branch` with
  // nothing stopped — the same moment `children` is for a present worktree — so ruling (D) asks presence there too.
  // The crash is made the way it happens: the real verb runs, and dies where `_ws_unsupervise` would have run.
  const vanishedThenCrash = (): Archived => {
    const a = makeArchived(h);
    fs.rmSync(a.wt, { recursive: true, force: true });
    const r = expireVerb(h, expireEvalOf(h).token, { pre: '_ws_unsupervise() { exit 9; };' });
    expect(r.code, 'the crash').toBe(9);
    expect(h.reg(EXP_ID, 'reaping'), 'the vanished arm entered at the branch').toBe('expire:branch');
    expect(tombOf()['worktree']).toBe('absent');
    return a;
  };

  it('at `branch` on the VANISHED-worktree arm, a pane or a unit that stands refuses live — nothing is stopped', () => {
    const a = vanishedThenCrash();
    const tok = resumeToken('branch');
    expect(tok, 'the resume token is minted while nothing runs').toMatch(/^[0-9a-f]{64}$/);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    expect(refusedWith(expireVerb(h, tok)), 'a detached pane').toBe('live');
    plantTmux(h, { sessions: [] });
    expect(refusedWith(expireVerb(h, tok, { pre: '_svc_is_active() { printf active; };' })), 'a running unit').toBe('live');
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch survives').toContain(EXP_BRANCH);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:branch');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`)), 'the tombstone stands').toBe(true);
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
  }, 120_000);

  it('the CONTROL: at `branch` with the worktree PRESENT in the tombstone, the tail had already stopped both — a pane that stands is its to kill', () => {
    const a = makeArchived(h);
    interrupted(a, 'branch');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const r = expireVerb(h, resumeToken('branch'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(tmuxSessions(h), 'the tail killed the pane').toEqual([]);
    expired(a);
  }, 120_000);

  it('an expiry’s reflog-keep commit says expiry, where a reclaim’s says reclaim', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const ref = `refs/ccrc/attic/${EXP_ID}/reflogs`;
    expect(h.git(a.main, 'log', '-1', '--format=%s', ref)).toBe(`ccrc: reflog commits kept at expiry of ${EXP_ID}`);
  }, 120_000);

  it('the CONTROL: at `worktree` the pane and the unit are still the tail’s to kill — only the cwd probe is asked (3964)', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    // BOTH halves are planted (review 288, F1): a pane, and a unit that answers `active` until the tail's own
    // unsupervise has run. A resume that asked the unit at `worktree` would refuse `live`; the tail stops it, and its
    // re-measure then reads it stopped.
    const r = expireVerb(h, resumeToken('worktree'), {
      pre: '_svc_is_active() { if grep -q "^unsupervise" "$HOME/ccd-calls" 2>/dev/null; then printf inactive; else printf active; fi; };',
    });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(tmuxSessions(h), 'the tail killed the pane').toEqual([]);
    expired(a);
  }, 120_000);

  // 3964. The tail writes `expire:worktree` BEFORE it removes the tree, so a crash in that window (or a
  // `worktree-remove-failed`) leaves a resume at `worktree` with the tree standing. A shell that cd'd in since would
  // lose its uncommitted edits to `git worktree remove --force`: the resume asks the cwd probe, and nothing else.
  it('at `worktree`, a process with its working directory in the standing tree refuses in-use — nothing stopped, nothing deleted (3964)', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const tok = resumeToken('worktree');
    const sleeper = holdCwd(a.wt);
    try {
      const r = expireVerb(h, tok);
      expect(refusedWith(r)).toBe('in-use');
      expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain(`process ${sleeper.pid} `);
      expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
      expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:worktree');
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
      expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
    } finally { sleeper.stop(); }
    const again = expireVerb(h, tok);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expired(a);
  }, 120_000);

  it('at `worktree`, a cwd probe that cannot be answered is unmeasured (exit 1, probe-unmeasured) — nothing is deleted (3964)', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const tok = resumeToken('worktree');
    const r = expireVerb(h, tok, { pre: 'CCD_OS=linux; _ws_expire_proc_root() { printf %s "$HOME/no-such-proc"; };' });
    expect(r.code, 'an unmeasured probe is a failure to measure, not a refusal').toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ failed: 'probe-unmeasured' });
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:worktree');
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
  }, 120_000);
});

describe('a refusal reads the archived tree CONTAINED — through the verb’s own fork', () => {
  it('no hook or fsmonitor of the repository runs inside a refused ws-expire, and its index is untouched', () => {
    // The ladder runs the whole of its git reads (a wrong token refuses only at rung 10, after every one) against a
    // tree nothing has proved nobody is in: uncontained, `git status` rewrites the stale index under `index.lock` and
    // fires post-index-change. The audit wraps the fork again; THIS path has the fork's own wrapper alone.
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const before = childIndex(h, a);
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    expect(hookRuns(h), 'a repository-configured hook or fsmonitor ran inside a refused ws-expire').toEqual([]);
    const after = childIndex(h, a);
    expect(after.bytes, 'a refused ws-expire rewrote the index').toBe(before.bytes);
    expect(after.mtimeMs, 'a refused ws-expire touched the index').toBe(before.mtimeMs);
    intact(a);
    // The CONTROL, after the subject: the same fixture runs the programs and rewrites the index for an uncontained read.
    h.sh(`git -C "${a.wt}" status --porcelain >/dev/null`);
    expect(hookRuns(h), 'the CONTROL: an uncontained status runs the repository’s programs')
      .toEqual(expect.arrayContaining(['post-index-change', 'fsmonitor']));
    expect(childIndex(h, a).bytes, 'the CONTROL: an uncontained status rewrites the stale index').not.toBe(before.bytes);
  }, 90_000);
});

describe('a failure after the act started is the expiry’s own — journaled, and resumed from an `expire:` breadcrumb', () => {
  it('a registry purge that fails leaves `expire:artifacts`, a failed document and an `expire` failed row — and the next attempt finishes', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireEvalOf(h).token, { pre: '_reg_purge() { return 1; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(doc.failed).toBe('purge-refused');
    expect(doc.detail).toContain('the expiry completed');
    expect(h.reg(EXP_ID, 'reaping'), 'an expiry\'s breadcrumb, never a reclaim\'s').toBe('expire:artifacts');
    const failed = eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'failed');
    expect(failed.map((e) => [e['verb'], e['refusal']])).toEqual([['ws-expire', 'purge-refused']]);
    expect(eventsOf(h.home, 'reclaim'), 'never journaled as a reclaim').toEqual([]);
    const again = expireVerb(h, resumeToken('artifacts'));
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expired(a);
  }, 120_000);
});

describe('the flavour fork: no verb finishes another verb’s interrupted work', () => {
  it('ws-reap refuses an `expire:` breadcrumb — expire-in-progress, before it reads anything', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const r = h.run(`${EXP_STUBS} cmd_ws_reap --expect ${'f'.repeat(64)} --session ${EXP_ID}`);
    expect(refusedWith(r)).toBe('expire-in-progress');
    expect(fs.existsSync(a.wt)).toBe(true);
    expect(h.reg(EXP_ID, 'reaping')).toBe('expire:worktree');
  }, 90_000);

  it('ws-expire refuses a `reclaim:` breadcrumb (reclaim-in-progress) and a ws-reap one (reap-in-progress)', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('reaping'), 'reclaim:worktree');
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('reclaim-in-progress');
    fs.writeFileSync(reg('reaping'), 'worktree');
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('reap-in-progress');
    intact(a);
  }, 90_000);

  it('a breadcrumb that stands but cannot be read is a failure to measure: exit 1, probe-unmeasured, nothing touched', () => {
    const a = makeArchived(h);
    fs.mkdirSync(reg('reaping'));
    const r = expireVerb(h, 'f'.repeat(64));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ failed: 'probe-unmeasured' });
    intact(a);
  }, 60_000);
});
