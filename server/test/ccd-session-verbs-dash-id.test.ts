// server/test/ccd-session-verbs-dash-id.test.ts
//
// PATH-IDENTITY W1b, TASK 4 (path-identity spec §2.2, §2.4). ws-release, ws-archive, ws-restore, ws-hold and
// ws-rename take their identity pairs WHOLE. Before this task none of the five loops had a `--session` arm: the key and
// its value fell into the residue one token at a time, so the value was scanned again as a flag, and the server's
// `ws-release --session --actor --surface agent --actor sweep` bound the id `agent`, the sweeps' surface word. Each
// loop now has one identity arm, first in its `case`, that appends the key and its value to the residue together, or
// the lone key when no value follows, so each verb's exact-arity rule still refuses a duplicate, a wrong order and a
// lone key with today's words. Each post-loop id check is `_reg_id_ok`, which refuses a leading `-`.
//
// THE FIXTURES. Every ccd call goes through `h.sh` (through `run` below), so this file spawns no bash of its own and
// `ccd-workspaces.test.ts`'s containment scan holds nothing against it. A row whose id spells a flag is planted with
// node:fs (`plantRow`), never through ccd, which cannot mint one. The decoys `agent` and `pwa` are the surface words a
// redirect lands on. Each holds a workspace and a hold, so a redirected release, archive or hold shows on disk, and a
// redirected restore shows as a journal line or a reap lock that names it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { decOf, eventsOf, readJournal, refusalsOf } from './lifecycleHelpers.js';
import { DECOY_IDS, plantRow, reapLocks, regListing, type DashId } from './dashIdFixture.js';

let h: CcdHarness;

interface Ran { readonly code: number; readonly stdout: string; readonly stderr: string }
/** `h.sh` throws on a non-zero exit; this answers the exit code and both streams instead. */
const run = (snippet: string): Ran => {
  try { return { code: 0, stdout: h.sh(snippet), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};
/** One JSON answer, or the raw text when it is not one, so a mutant's prose reds the comparison instead of throwing. */
const docOf = (stdout: string): unknown => {
  try { return JSON.parse(stdout.trim()) as unknown; } catch { return stdout; }
};

// The stubs, each copied from `ccd-actor-flags.test.ts`'s constant of the same name: every irreversible step a verb
// would reach if a mutant let it past the id check is stubbed, and tmux is stubbed for the journal's `_lc_obs`.
const REL_STUBS = 'tmux() { return 1; };';
const HOLD_STUBS = 'tmux() { return 1; };';
const ARCHIVE_STUBS = `tmux() { return 1; }; _ws_unsupervise() { :; };
  _ws_idle_ok() { return 0; }; _ws_status() { echo idle; }; _ws_archive_manifest() { echo '{}'; };`;
const RESTORE_STUBS = `tmux() { return 1; }; flock() { return 0; };
  _ws_supervise() { :; }; _spawn() { :; };`;
const RENAME_STUBS = `tmux() { return 1; }; _ws_branch_valid() { return 0; };
    _ws_wt_branch() { echo ws/quiet-basin; return 0; };`;

const REAL = 'demo-quiet-basin';
const DECOY_HOLD = 'program:decoy wave:1/1';
const PLANTED_HOLD = 'program:planted wave:1/1';
const HOLD_REASON = 'program:x wave:1/4';
/** The ids whose flag spelling a decision-flag arm eats, which is what made the surface word the id. */
const REDIRECT_IDS: readonly DashId[] = ['--actor', '--surface', '--reason'];

/** The server's decision tail (`decFlags` in `server/src/ccdargv.ts`), typed here because this file imports nothing
 *  from `server/src`: `--surface <s> --actor <a>`, then `--reason <r>` when the decision carries one. */
const decTail = (surface: string, withReason: boolean): string =>
  `--surface ${surface} --actor 'probe:dash id'${withReason ? " --reason 'probe reason'" : ''}`;
/** Each decoy word as the declared surface, with and without a reason. */
const DECS: readonly { readonly surface: string; readonly reason: boolean }[] =
  DECOY_IDS.flatMap((surface) => [{ surface, reason: false }, { surface, reason: true }]);

/** A workspace row complete enough to reach each verb's body (the shape of `ccd-actor-flags.test.ts`'s
 *  `seedWorkspace`, its directory on disk included), planted with node:fs so that its id may spell a flag. */
const plantWorkspace = (id: string, hold: string | null): void => {
  const slug = id.replace(/^-+/, 'dash-');
  const workdir = path.join(h.home, 'worktrees', 'demo', slug);
  mkdirSync(workdir, { recursive: true });
  plantRow(h.home, id, {
    project: 'demo', workspace: slug, workdir, branch: `ws/${slug}`, wrapper: 'claude',
    ...(hold === null ? {} : { hold }),
  });
};

/** No decoy lost its hold or gained an archive stamp, and no journal line names one. */
const expectDecoysUntouched = (): void => {
  for (const d of DECOY_IDS) {
    expect.soft(h.reg(d, 'hold'), `${d}'s hold`).toBe(DECOY_HOLD);
    expect.soft(h.reg(d, 'archived'), `${d} was archived`).toBeNull();
  }
  expect(readJournal(h.home).filter((e) => (DECOY_IDS as readonly string[]).includes(String(e['id']))),
    'a journal line names a decoy').toEqual([]);
};

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-sessdash-');
  for (const d of DECOY_IDS) plantWorkspace(d, DECOY_HOLD);
  plantWorkspace('--actor', PLANTED_HOLD);
  plantWorkspace('--reason', null);
  plantWorkspace('--branch', null);
});
afterEach(() => { h.cleanup(); });

describe('ws-release binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason die "bad session id", and agent\'s hold stands', () => {
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${REL_STUBS} cmd_ws_release --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
      }
    }
    expectDecoysUntouched();
    expect(h.reg('--actor', 'hold'), 'the planted --actor row').toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'release')).toEqual([]);
  });

  it('a planted dash-leading row is never acted on', () => {
    // `--actor.uuid` and its hold exist, so an id check that admitted a dash-leading id would release the planted row
    // instead of refusing: this is the case that reds when `_reg_id_ok` is not the check.
    const r = run(`${REL_STUBS} cmd_ws_release --session '--actor' ${decTail('agent', false)}`);
    expect(r.stdout).not.toContain('released --actor');
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe('ccd: bad session id');
    expect(h.reg('--actor', 'hold')).toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'release')).toEqual([]);
  });
});

describe('ws-archive binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason die "bad session id", and agent\'s hold stands', () => {
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${ARCHIVE_STUBS} cmd_ws_archive --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
      }
    }
    expectDecoysUntouched();
    expect(h.reg('--actor', 'archived'), 'the planted --actor row was archived').toBeNull();
    expect(eventsOf(h.home, 'archive')).toEqual([]);
  });
});

describe('ws-restore binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('ids --actor, --surface and --reason are refused bad-session-id through _lc_refuse, and no journal line names agent', () => {
    const asked: string[] = [];
    for (const id of REDIRECT_IDS) {
      for (const d of DECS) {
        const tail = decTail(d.surface, d.reason);
        const r = run(`${RESTORE_STUBS} cmd_ws_restore --session '${id}' ${tail}`);
        expect.soft(r.code, `--session ${id} ${tail}`).toBe(1);
        expect.soft(r.stderr.trim(), `--session ${id} ${tail}`).toBe('ccd: bad session id');
        asked.push(id);
      }
    }
    // Restore journals its refusal against the id it was asked about, as it did before this wave: every restore row
    // is a bad-session-id refusal naming the dash id, in the order asked, and none names a decoy.
    expect(refusalsOf(h.home)).toEqual(asked.map(() => ({ act: 'restore', token: 'bad-session-id' })));
    expect(eventsOf(h.home, 'restore').map((e) => String(e['id']))).toEqual(asked);
    expect(reapLocks(h.home), 'a reap lock was opened before the refusal').toEqual([]);
    expectDecoysUntouched();
  });
});

describe('ws-hold binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('an id of --reason dies "bad session id", and the planted --reason row is not held', () => {
    for (const d of DECOY_IDS) {
      const snippet = `${HOLD_STUBS} cmd_ws_hold --session '--reason' --reason '${HOLD_REASON}' ${decTail(d, false)}`;
      const r = run(snippet);
      expect.soft(r.code, snippet).toBe(1);
      expect.soft(r.stderr.trim(), snippet).toBe('ccd: bad session id');
    }
    expect(h.reg('--reason', 'hold'), 'the planted --reason row was held').toBeNull();
    expect(eventsOf(h.home, 'hold')).toEqual([]);
    expectDecoysUntouched();
  });

  // EXTRA PIN. The --reason row above stays green when ws-hold's arm is deleted, because the residue is the same
  // either way and `_reg_id_ok` refuses the literal id. These ids are what the arm changes: without it they refuse on
  // arity, with the usage line; with it the pair reaches the id check.
  it('ids --actor and --surface die "bad session id" too, and no decoy is held anew', () => {
    for (const id of ['--actor', '--surface'] as const) {
      for (const d of DECOY_IDS) {
        const snippet = `${HOLD_STUBS} cmd_ws_hold --session '${id}' --reason '${HOLD_REASON}' ${decTail(d, false)}`;
        const r = run(snippet);
        expect.soft(r.code, snippet).toBe(1);
        expect.soft(r.stderr.trim(), snippet).toBe('ccd: bad session id');
      }
    }
    expect(h.reg('--actor', 'hold'), 'the planted --actor row').toBe(PLANTED_HOLD);
    expect(eventsOf(h.home, 'hold')).toEqual([]);
    expectDecoysUntouched();
  });

  // EXTRA PIN. The server composes `--session <id> --reason <reason>` and then its decision flags. A reason that
  // spells `--surface` used to be eaten as the surface value by the `--surface` arm, so the hold landed with the reason
  // `agent`. The `--reason` arm now keeps the pair whole.
  it('a hold reason the server spells as a flag is held verbatim, under the surface it declared', () => {
    plantWorkspace(REAL, null);
    const r = run(`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason '--surface' ${decTail('agent', false)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`held ${REAL}: --surface`);
    expect(h.reg(REAL, 'hold')).toBe('--surface');
    expect(eventsOf(h.home, 'hold').map((e) => decOf(e)['surface'])).toEqual(['agent']);
  });
});

describe('ws-rename binds its identity pair whole (path-identity spec §2.2, §2.4)', () => {
  it('an id of --branch answers {"refused":"bad-args"} "bad session id: --branch" at exit 0, and the planted row is untouched', () => {
    const before = regListing(h.home);
    for (const d of DECS) {
      const tail = decTail(d.surface, d.reason);
      const r = run(`${RENAME_STUBS} cmd_ws_rename --session '--branch' --branch ws/renamed ${tail}`);
      expect.soft(r.code, tail).toBe(0);
      expect.soft(docOf(r.stdout), tail)
        .toEqual({ refused: 'bad-args', detail: 'bad session id: --branch', paths: [] });
    }
    expect(regListing(h.home)).toEqual(before);
    expect(h.reg('--branch', 'branch')).toBe('ws/dash-branch');
  });

  // EXTRA PIN, for ws-hold's reason: the --branch row stays green when ws-rename's arm is deleted. These ids are the
  // ones the arm changes, from the usage line to the id check's own answer.
  it('ids --actor, --surface and --reason answer "bad session id: <id>", never the usage line', () => {
    for (const id of REDIRECT_IDS) {
      const r = run(`${RENAME_STUBS} cmd_ws_rename --session '${id}' --branch ws/renamed ${decTail('agent', true)}`);
      expect.soft(r.code, id).toBe(0);
      expect.soft(docOf(r.stdout), id).toEqual({ refused: 'bad-args', detail: `bad session id: ${id}`, paths: [] });
    }
  });

  // EXTRA PIN, for the arm's `--branch` half: both cases above stay green when the arm is narrowed to `--session)`.
  // The naming sweep's branch name is derived from model output. A branch value that spells a flag used to lose to a
  // dec arm, and the surface word became the NEW name (`--branch --actor --surface agent …` asked for `agent`). Taken
  // whole, the value reaches `_ws_branch_valid`, stubbed here to refuse every name, so the detail shows which was asked.
  it('a --branch value spelled as a flag is taken whole, never replaced by the surface word', () => {
    plantWorkspace(REAL, null);
    for (const value of REDIRECT_IDS) {
      const r = run(`${RENAME_STUBS} _ws_branch_valid() { return 1; }; `
        + `cmd_ws_rename --session ${REAL} --branch '${value}' ${decTail('agent', true)}`);
      expect.soft(r.code, value).toBe(0);
      expect.soft(docOf(r.stdout), value)
        .toEqual({ refused: 'bad-branch', detail: `invalid branch name: ${value}`, paths: [] });
    }
    expect(h.reg(REAL, 'branch'), 'the branch field is untouched').toBe('ws/demo-quiet-basin');
  });
});

describe('the identity arms narrow nothing else (path-identity spec §2.4)', () => {
  it('prose may lead with a dash', () => {
    plantWorkspace(REAL, HOLD_REASON);
    const rel = run(`${REL_STUBS} cmd_ws_release --session ${REAL} --actor '-device' --reason '--tidy'`);
    expect(rel.code, rel.stderr).toBe(0);
    expect(rel.stdout).toBe(`released ${REAL}`);
    const dec = decOf(eventsOf(h.home, 'release')[0] ?? {});
    expect(dec['actor']).toBe('-device');
    expect(dec['reason']).toBe('--tidy');
    const held = run(`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason '--program:x wave:1/4'`);
    expect(held.code, held.stderr).toBe(0);
    expect(held.stdout).toBe(`held ${REAL}: --program:x wave:1/4`);
    expect(h.reg(REAL, 'hold')).toBe('--program:x wave:1/4');
  });

  it("order and duplicates still refuse with today's words", () => {
    plantWorkspace(REAL, null);
    const USAGE_REL = 'ccd: usage: ccd ws-release --session <id>';
    const USAGE_HOLD = 'ccd: usage: ccd ws-hold --session <id> --reason <text>';
    const rows: readonly (readonly [string, string])[] = [
      [`${REL_STUBS} cmd_ws_release --session ${REAL} --session demo-quiet-other`, USAGE_REL],
      [`${REL_STUBS} cmd_ws_release --session`, USAGE_REL],
      [`${REL_STUBS} cmd_ws_release --surface pwa --session`, USAGE_REL],
      // The dec ladder still runs before arity: a blank --actor ahead of a lone trailing key names the actor.
      [`${REL_STUBS} cmd_ws_release --actor '' --session`, 'ccd: --actor must be non-blank'],
      [`${HOLD_STUBS} cmd_ws_hold --reason '${HOLD_REASON}' --session ${REAL}`, USAGE_HOLD],
      [`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason a --reason b`, USAGE_HOLD],
      [`${HOLD_STUBS} cmd_ws_hold --session ${REAL} --reason`, USAGE_HOLD],
    ];
    for (const [snippet, said] of rows) {
      const r = run(snippet);
      expect.soft(r.code, snippet).toBe(1);
      expect.soft(r.stderr.trim(), snippet).toBe(said);
    }
    const ren = run(`${RENAME_STUBS} cmd_ws_rename --session ${REAL} --session demo-quiet-other --branch ws/renamed`);
    expect(ren.code).toBe(0);
    expect(docOf(ren.stdout))
      .toEqual({ refused: 'bad-args', detail: 'usage: ccd ws-rename --session <id> --branch <name>', paths: [] });
    expect(h.reg(REAL, 'hold')).toBeNull();
  });
});
