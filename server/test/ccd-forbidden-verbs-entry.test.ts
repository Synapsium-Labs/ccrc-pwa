// D-8666 (the delegation broker's Rider): the installed direct entry (`ccd/ccd-entry.py#is_protected`) starts every verb of
// FORBIDDEN_CCD_VERBS it did not yet protect — `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`, `roll` and `claude`,
// each with any tail — under `bash -p`, so a case variant a caller reaches through an inherited `nocasematch` (exported in
// BASHOPTS) folds into none of them: `-p` drops the option and the body's dispatcher compares exactly. This file runs the
// REAL body behind the rendered launcher; `ccd-ws-lease-mark-reach.test.ts` holds the table that runs the shapes against both
// halves (these verbs are its `entry` class: the body does not refuse them when started another way), and its launcher rows
// are what pins the `-p` start of each verb.
//
// FIXTURE HOME ONLY: the launcher is a fixture install under the harness HOME, with a contained `tmux` and `systemctl`
// stubbed in the harness's own stub directory. The fixture plants the workspaces the variants name (review 2313 A4): a
// live one, an archived one, and one whose directory was removed by hand. Every variant row compares every file under
// HOME before and after, FIRST, and five rows claim it in their titles because on `main` they changed the fixture (measured,
// recorded in the plan's notes): `ws-rm` (twice) tore the live workspace down, `ws-reap` refused but wrote its lock and a
// lifecycle journal row, `ws-gc --prune` reclaimed the hand-removed one, and `ws-restore` removed the archived one's stamps. The other rows
// claim only the unknown verb, each for a reason: `ws-gc` without `--prune` writes nothing even when it runs, `ws-archive`
// stops at `status-unknown` in a fixture HOME (its session probe needs a user service bus, which the harness withholds on
// purpose), and `roll` and `claude` are no verb at all.
//
// `roll` and `claude` are no verb of the body yet (D-8667): their real-body rows here pass with either spelling, so they
// cannot go red until the body has those verbs. Their pin is the launcher rows in `ccd-ws-lease-mark-reach.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD, ghContainedEnv, installDirectEntry, stubContainedTool, type DirectEntry } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { spawnSyncGroup } from './spawnGroup.js';

let h: PrHarness;
let de: DirectEntry;
beforeEach(() => { h = makePrHarness('ccrc-forbidden-entry-'); });
afterEach(() => { h.cleanup(); });

/** Every variable Bash startup consumes, removed so a CONTROL is clean by construction. */
const STARTUP_KEYS = ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'CDPATH', 'GLOBIGNORE'];
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(inheritedEnv())) {
    if (k.startsWith('BASH_FUNC_') || STARTUP_KEYS.includes(k)) continue;
    env[k] = v;
  }
  return env;
};
interface Ran { code: number; stdout: string; stderr: string }
/** The installed direct entry, executed by the kernel — the agent's own `execFile` shape — in a process group of its own,
 *  so a timeout ends whatever the body started too (#896). */
const direct = (args: readonly string[], env: Record<string, string> = {}): Ran => {
  const bin = path.join(h.home, '.local', 'bin');
  const r = spawnSyncGroup(de.entry, [...args], {
    cwd: h.home, encoding: 'utf8', timeout: 120_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, ...env },
      { systemd: true, tmux: true }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** The body's dispatcher refusing a word that is no verb: its catch-all arm, exit 1. */
const UNKNOWN_VERB = 'usage: ccd {start|';
/** An inherited `nocasematch`, in a UTF-8 locale, where Bash folds beyond ASCII (U+0130 to `i`). */
const FOLDING = { BASHOPTS: 'nocasematch', LC_ALL: 'C.UTF-8' };
const DOTTED = 'ws-archİve';

/** Whether this box's Bash, under FOLDING's locale, folds `DOTTED` into `ws-archive` at all. Asked inside the test, through
 *  the harness's containment like every bash spawn in a ccd test file: where the locale is missing (or folds nothing), the
 *  non-ASCII row cannot test the fold, so it skips with that reason as its note, never passes. */
const bashFoldsDotted = (): boolean => spawnSyncGroup('bash',
  ['-c', 'shopt -s nocasematch; case "$1" in ws-archive) exit 0 ;; esac; exit 1', '_', DOTTED], {
    encoding: 'utf8', timeout: 30_000,
    env: ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home, LC_ALL: FOLDING.LC_ALL }, { systemd: true, tmux: true }),
  }).status === 0;

/** Every entry under HOME by its relative path: a file by its bytes' digest, a link by its target, a directory as such. */
const snapshot = (): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const rel = path.relative(h.home, p);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out.set(rel, `link ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) { out.set(rel, 'dir'); walk(p); } else out.set(rel, createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    }
  };
  walk(h.home);
  return out;
};

const LIVE = 'demo-still-river';   // ws-add's id for project demo, slug still-river
const ARCHIVED = 'demo-dry-creek';
const GONE = 'demo-quiet-mesa';

/** The workspaces the variants name, planted in the fixture HOME: a live worktree with its registry row, an archived one,
 *  and one whose directory was removed by hand (stale git metadata and a dead registry row, `ws-gc --prune`'s two arms). */
const plant = (): void => {
  const main = h.makeRepo('demo');
  h.git(main, 'commit', '--allow-empty', '-m', 'base');
  // The live one through ws-add itself, so its row carries everything ws-archive reads (its wrapper among them).
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-river cmd_ws_add demo`);
  for (const [id, slug] of [[ARCHIVED, 'dry-creek'], [GONE, 'quiet-mesa']] as const) {
    const wt = path.join(h.home, 'worktrees', 'demo', slug);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    h.git(main, 'worktree', 'add', '-b', `ws/${slug}`, wt);
    h.sh(`_reg_set ${id} uuid u; _reg_set ${id} project demo; _reg_set ${id} workspace ${slug}
      _reg_set ${id} branch ws/${slug}; _reg_set ${id} workdir ${wt}`);
  }
  h.sh(`_reg_set ${ARCHIVED} archived 1787000000; _reg_set ${ARCHIVED} archivedreason merged:#42`);
  fs.rmSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'), { recursive: true, force: true });
  // A service manager that reports every unit inactive and a tmux with no session, so a variant that reached its verb
  // on `main` could act on its workspace; here no variant reaches one.
  stubContainedTool(h.home, 'systemctl', '#!/bin/sh\ncase "$*" in *is-active*) echo inactive; exit 3 ;; esac\nexit 0\n');
  stubContainedTool(h.home, 'tmux', '#!/bin/sh\ncase "$1" in has-session|list-panes) exit 1 ;; esac\nexit 0\n');
};

/** A case variant of each verb, with the tail it would act on, and whether its row claims the fixture comparison: true only
 *  where the variant changed the planted fixture on `main` (see the header). */
const VARIANTS: ReadonlyArray<readonly [verb: string, argv: readonly string[], claimsFixture: boolean]> = [
  ['ws-rm', ['WS-RM', LIVE], true],
  ['ws-rm', ['Ws-Rm', '--reason', 'r', LIVE], true],
  ['ws-reap', ['WS-REAP', '--expect', 'a'.repeat(64), '--session', ARCHIVED], true],
  ['ws-gc', ['WS-GC'], false],
  ['ws-gc', ['Ws-Gc', '--prune'], true],
  ['ws-archive', ['WS-ARCHIVE', '--session', LIVE], false],
  ['ws-restore', ['WS-RESTORE', '--session', ARCHIVED], true],
  ['roll', ['ROLL', '--to', '1.2.3'], false],
  ['claude', ['Claude', 'mem'], false],
];

/** One variant's run: the fixture is compared FIRST, so a variant that acted on its workspace reds on that, before the
 *  exit status or the unknown-verb line is read. */
const refusedUnknown = (argv: readonly string[]): void => {
  de = installDirectEntry(h.home);
  plant();
  expect(direct(['version']).code, 'CONTROL: the body runs through the launcher').toBe(0);
  const before = snapshot();
  const r = direct(argv, FOLDING);
  const after = snapshot();
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k)).sort();
  expect(changed, `${argv.join(' ')} changed the fixture: ${r.stderr.slice(0, 200)}`).toEqual([]);
  expect(r.code, `${argv.join(' ')}: ${r.stderr.slice(0, 300)}`).toBe(1);
  expect(r.stderr, `${argv.join(' ')} reached a verb`).toContain(UNKNOWN_VERB);
};

describe('the forbidden verbs through the installed direct entry, on the real body (D-8666)', () => {
  for (const [verb, argv, claimsFixture] of VARIANTS) {
    const what = claimsFixture ? ', and leaves the planted fixture as it was' : '';
    it(`${argv.join(' ')} under an inherited nocasematch reaches no verb (${verb})${what}`, () => refusedUnknown(argv), 60_000);
  }

  it(`${DOTTED} --session ${LIVE} (U+0130) under an inherited nocasematch reaches no verb (ws-archive); skipped, with its`
    + ` reason, where this box's Bash does not fold U+0130 under LC_ALL=${FOLDING.LC_ALL}`, (ctx) => {
    if (!bashFoldsDotted()) {
      ctx.skip(`this box's Bash does not fold U+0130 under LC_ALL=${FOLDING.LC_ALL} (the locale is missing or folds nothing)`);
    }
    refusedUnknown([DOTTED, '--session', LIVE]);
  }, 60_000);

  it('the exact spellings still reach their verbs through the launcher', () => {
    de = installDirectEntry(h.home);
    for (const [verb, usage] of [['ws-rm', 'usage: ccd ws-rm'], ['ws-reap', 'usage: ccd ws-reap'],
      ['ws-archive', 'usage: ccd ws-archive'], ['ws-restore', 'usage: ccd ws-restore']] as const) {
      const r = direct([verb]);
      expect(r.code, `${verb}: ${r.stderr.slice(0, 300)}`).not.toBe(0);
      expect(r.stderr, `${verb} did not reach its own verb`).toContain(usage);
      expect(r.stderr, verb).not.toContain(UNKNOWN_VERB);
    }
    // D-8667: no `roll` or `claude` verb exists in the body yet, so the exact spelling is the dispatcher's unknown verb too.
    for (const verb of ['roll', 'claude']) expect(direct([verb]).stderr, verb).toContain(UNKNOWN_VERB);
  }, 60_000);

  it('ws-gc without --prune still lists through the launcher (exit 0, its own output)', () => {
    de = installDirectEntry(h.home);
    for (const argv of [['ws-gc'], ['ws-gc', '--fast']]) {
      const r = direct(argv);
      expect(r.code, `${argv.join(' ')}: ${r.stderr.slice(0, 300)}`).toBe(0);
      expect(r.stderr, argv.join(' ')).not.toContain(UNKNOWN_VERB);
    }
  }, 60_000);
});
