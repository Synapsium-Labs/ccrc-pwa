// server/test/ccd-ws-add-dash-id.test.ts
//
// ws-add never binds a project that the server's own flags spelled
// (path-identity spec §2.2, §2.4).
//
// The coordinator's dispatch composes
// ['ws-add', '--no-rc', ...child, ...route, <project>, ...dec].
// The project is positional and comes before the dec. ws-add's strip loop
// scans every token as a possible flag, so a project spelled like a dec flag
// used to bind the surface word that follows it:
//   - a project of --actor:   actor=--surface, project=agent, then a second --actor;
//   - a project of --surface: surface=--surface, project=agent.
// Either one created a row for project `agent`. Atomic consumption cannot fix a
// positional verb, because a token spelled like the key is the key. So ws-add
// gets two rules instead:
//   - a second --actor is refused, in either spelling and any mix of them;
//   - a --surface value that begins with "-" is refused, in both spellings.
// A project of -x or --reason is refused by _ws_project_valid's dash line
// (path-identity spec §2.4). The --reason case below pins that rule through
// the composed argv.
//
// Every argv the server can send is COMPOSED by CCD_ARGV.wsAddWorker. Shapes
// the server never composes (a second --actor, a dash-leading surface) are
// typed, and labelled as such.
//
// CONTAINMENT: every ccd call goes through h.sh, the harness's contained
// runner. This file starts no shell of its own, so ccd-workspaces.test.ts's
// spawn scan finds nothing to check in it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD_ARGV, type ActorFlags } from '../src/ccdargv.js';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { decOf, eventsOf, measOf } from './lifecycleHelpers.js';
import { DECOY_IDS, regListing } from './dashIdFixture.js';

/** `agent`: the surface word every unattended lane's dec carries, so the project a redirect lands on. */
const [DECOY] = DECOY_IDS;

/** The dispatch path's dec shape (`sweepDec`): a surface and an actor, and reason null.
 *  ws-add's loop has no --reason arm, so a dec with a reason is never sent here. */
const DISPATCH_DEC: ActorFlags = { surface: DECOY, actor: 'run:1 dispatch', reason: null };

const USAGE = 'usage: ccd ws-add';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-ws-add-dash-');
  h.makeRepo(DECOY);
  h.makeRepo('demo');
});
afterEach(() => { h.cleanup(); });

/** One word for bash: single-quoted, with each embedded quote closed, escaped and reopened. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

interface Ran { readonly code: number; readonly stdout: string; readonly stderr: string }

/** cmd_ws_add with `args`, under WS_ADD's stubs, through the contained h.sh. It reports
 *  the exit code and both streams instead of throwing, which every refusal below needs. */
const wsAdd = (args: readonly string[], slug = 'quiet-mesa'): Ran => {
  const snippet = `${WS_ADD} cmd_ws_add ${args.map(shq).join(' ')}`;
  try { return { code: 0, stdout: h.sh(snippet, { CCD_WS_SLUG: slug }), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The argv the coordinator's dispatch COMPOSES for `project`, without the verb word
 *  (h.sh calls the verb as cmd_ws_add). */
const composed = (project: string, dec: ActorFlags = DISPATCH_DEC): readonly string[] => {
  const argv = CCD_ARGV.wsAddWorker(project, dec);
  expect(argv[0]).toBe('ws-add');
  return argv.slice(1);
};

/** The $REG listing after one source of ccd, so a refusal is compared against a settled tree. */
const settle = (): string[] => { h.sh(':'); return regListing(h.home); };

/** A refusal leaves the box as it found it: $REG unchanged, no row, no worktree, no create line. */
const nothingCreated = (before: readonly string[], project: string): void => {
  expect(regListing(h.home), 'the refusal changed $REG').toEqual(before);
  expect(regListing(h.home).filter((n) => n.endsWith('.uuid')), 'a registry row was created').toEqual([]);
  expect(fs.existsSync(path.join(h.home, 'worktrees', project)), `a worktree under worktrees/${project}`).toBe(false);
  expect(fs.existsSync(path.join(h.home, 'worktrees', DECOY)), 'a worktree for the decoy project').toBe(false);
  expect(eventsOf(h.home, 'create'), 'a create line was journaled').toEqual([]);
};

describe("ws-add never binds a project the server's flags spelled (path-identity spec §2.2, §2.4)", () => {
  it('project --actor is refused, and no agent-* row is created', () => {
    const before = settle();
    const r = wsAdd(composed('--actor'));
    expect(r.code, 'the composed argv for project --actor was not refused').not.toBe(0);
    expect(r.stderr).toContain(USAGE);
    expect(regListing(h.home).filter((n) => n.startsWith(`${DECOY}-`)), 'the redirect created a row for the decoy').toEqual([]);
    nothingCreated(before, '--actor');
  });

  it('project --surface is refused, and no row is created', () => {
    const before = settle();
    const r = wsAdd(composed('--surface'));
    expect(r.code, 'the composed argv for project --surface was not refused').not.toBe(0);
    expect(r.stderr).toContain(USAGE);
    nothingCreated(before, '--surface');
  });

  it('projects --child, --route and --no-rc are refused with their own words', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['--child', '--child needs a run id (a positive integer), got: --surface'],
      ['--route', "bad --route '--surface' (want <field>=<value>)"],
      ['--no-rc', USAGE],
    ];
    for (const [project, said] of cases) {
      const before = settle();
      const r = wsAdd(composed(project));
      expect(r.code, `project ${project} was not refused`).not.toBe(0);
      expect(r.stderr, `project ${project}`).toContain(said);
      nothingCreated(before, project);
    }
  });

  it('project --reason with a planted projects/--reason repo is refused "invalid project"', () => {
    // A real repo at projects/--reason, so the only thing that stands between this
    // argv and a row named --reason-quiet-mesa is _ws_project_valid's dash line.
    h.makeRepo('--reason');
    const before = settle();
    const r = wsAdd(composed('--reason'));
    expect(r.code, 'project --reason was not refused').not.toBe(0);
    expect(r.stderr).toContain("invalid project '--reason'");
    expect(r.stderr).toContain('no LEADING dot or dash');
    nothingCreated(before, '--reason');
  });

  it('a second --actor is refused in every spelling mix', () => {
    // Typed: the server never sends two --actor flags. Its own redirect shape is the
    // first case above. Every mix of the two spellings is refused here.
    const mixes: readonly (readonly string[])[] = [
      ['--no-rc', '--actor', 'a', '--actor', 'b', 'demo'],
      ['--no-rc', '--actor=a', '--actor', 'b', 'demo'],
      ['--no-rc', '--actor', 'a', '--actor=b', 'demo'],
    ];
    for (const args of mixes) {
      const before = settle();
      const r = wsAdd(args);
      expect(r.code, `${args.join(' ')} was not refused`).not.toBe(0);
      expect(r.stderr, args.join(' ')).toContain(USAGE);
      nothingCreated(before, 'demo');
    }
  });

  it('a dash-leading --surface value is refused in both spellings', () => {
    // Typed: StopSurface cannot spell a dash-leading word, so no builder composes this.
    for (const args of [['--no-rc', '--surface', '-x', 'demo'], ['--no-rc', '--surface=-x', 'demo']] as const) {
      const before = settle();
      const r = wsAdd(args);
      expect(r.code, `${args.join(' ')} was not refused`).not.toBe(0);
      expect(r.stderr, args.join(' ')).toContain(USAGE);
      nothingCreated(before, 'demo');
    }
  });

  it("the dispatch path's argv for a real project still creates the workspace, its dec journaled", () => {
    const r = wsAdd(composed('demo'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^workspace demo-quiet-mesa /);
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the workspace was never created').not.toBeNull();
    expect(h.reg('demo-quiet-mesa', 'rc'), '--no-rc still means what it meant').toBe('off');
    const created = eventsOf(h.home, 'create');
    expect(created, 'ws-add wrote no create line').toHaveLength(1);
    expect(decOf(created[0]!)).toEqual({ surface: DECOY, actor: 'run:1 dispatch' });
    expect(measOf(created[0]!)['project']).toBe('demo');
    expect(regListing(h.home).filter((n) => n.startsWith(`${DECOY}-`))).toEqual([]);
  });

  it('prose may lead with a dash: an --actor value beginning with "-" still creates the workspace, in both spellings', () => {
    // Narrowing guard (path-identity spec §2.4): only the identity is checked. Actor prose keeps its domain.
    const r1 = wsAdd(composed('demo', { surface: DECOY, actor: '-device', reason: null }));
    expect(r1.code, r1.stderr).toBe(0);
    const r2 = wsAdd(['--no-rc', 'demo', '--actor=--tidy'], 'quiet-lake');
    expect(r2.code, r2.stderr).toBe(0);
    const created = eventsOf(h.home, 'create');
    expect(created).toHaveLength(2);
    expect(decOf(created[0]!)['actor']).toBe('-device');
    expect(decOf(created[1]!)['actor']).toBe('--tidy');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    expect(h.reg('demo-quiet-lake', 'uuid')).not.toBeNull();
  });
});
