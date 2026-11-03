// GET /api/projects answers from the watcher's listed tick and a cached project walk (desktop polish C4, D-6436).
//
// Every case runs over a fixture HOME of plain files (a projects root, a registry, linked worktrees as `.git` FILES)
// read through a wrapped `localIO` that logs every request in issue order, and can hold each one at a gate or delay
// it per path, so what the route asks the agent link for is the thing measured. No live fleet, no real ccd.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CcrcConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { listProjects } from '../src/lifecycle.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

interface Req { op: string; path: string }
interface Gate { pending: (() => void)[] }

/** A counting wrapper over `localIO`: every call is logged, counted in flight, and held at `gate` or delayed. */
const countingIO = (opts: { gate?: Gate; delayMs?: (p: string) => number } = {}) => {
  const requests: Req[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const io = { ...localIO } as Record<string, unknown>;
  for (const [op, fn] of Object.entries(localIO)) {
    if (typeof fn !== 'function') continue;
    io[op] = async (...args: unknown[]) => {
      const p = String(args[0]);
      requests.push({ op, path: p });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (opts.gate !== undefined) await new Promise<void>((go) => { opts.gate!.pending.push(go); });
        else if (opts.delayMs !== undefined) {
          const ms = opts.delayMs(p);
          await new Promise<void>((go) => { setTimeout(go, ms); });
        }
        return await (fn as (...a: unknown[]) => unknown).apply(localIO, args);
      } finally {
        inFlight -= 1;
      }
    };
  }
  return { io: io as unknown as FleetIO, requests, maxInFlight: () => maxInFlight, inFlightNow: () => inFlight };
};

/** One registry row as plain files. */
const plant = (cfg: CcrcConfig, id: string, project: string, workdir: string): void => {
  mkdirSync(cfg.registryDir, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project, workdir, uuid: `u-${id}`, started: '1', workspace: id, branch: `ws/${id}`,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(cfg.registryDir, `${id}.${k}`), v);
};

/** A directory, optionally a main checkout (`.git` a directory) or a linked worktree (`.git` a FILE). */
const dir = (p: string, git: 'none' | 'main' | 'linked' = 'none'): string => {
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, 'README'), 'x');
  if (git === 'main') mkdirSync(path.join(p, '.git'), { recursive: true });
  if (git === 'linked') writeFileSync(path.join(p, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
  return p;
};

/**
 * The recorded fixture (Step 1):
 * - `alpha`, a main checkout under the root, and a registry row on the same workdir under another name;
 * - two registry rows sharing a workdir outside the root, the first in record order named `zeta`;
 * - a linked worktree reached through both doors: `linked` under the root, and a registry row on it;
 * - a second linked worktree reached only through the registry;
 * - a registry-only project, `solo`;
 * - a plain directory, a dot directory and a plain file under the root.
 */
const projectsFixture = (prefix: string) => {
  const home = mkTmp(prefix);
  const deps = testDeps(home);
  const { cfg } = deps;
  const root = cfg.projectsRoot;
  const away = path.join(home, 'elsewhere');
  dir(path.join(root, 'alpha'), 'main');
  dir(path.join(root, 'plain'));
  dir(path.join(root, '.hidden'), 'main');
  dir(path.join(root, 'linked'), 'linked');
  writeFileSync(path.join(root, 'notes.txt'), 'not a project');
  dir(path.join(away, 'shared'));
  dir(path.join(away, 'linked-two'), 'linked');
  dir(path.join(away, 'solo'), 'main');
  plant(cfg, 'lane-a-r1', 'alpha-renamed', path.join(root, 'alpha'));
  plant(cfg, 'lane-a-r2', 'zeta', path.join(away, 'shared'));
  plant(cfg, 'lane-a-r3', 'beta', path.join(away, 'shared'));
  plant(cfg, 'lane-a-r4', 'linked', path.join(root, 'linked'));
  plant(cfg, 'lane-a-r5', 'linked-two', path.join(away, 'linked-two'));
  plant(cfg, 'lane-a-r6', 'solo', path.join(away, 'solo'));
  return { home, deps, cfg, root, away };
};

/** Today's answer for `projectsFixture`, recorded on the serial code (Step 1), workdirs relative to the HOME. */
const RECORDED = {
  registry: 'listed',
  projects: [
    { name: 'alpha', workdir: 'projects/alpha' },
    { name: 'plain', workdir: 'projects/plain' },
    { name: 'solo', workdir: 'elsewhere/solo' },
    { name: 'zeta', workdir: 'elsewhere/shared' },
  ],
} as const;

const relative = (home: string, r: { roots: string[]; projects: { name: string; workdir: string }[]; registry: string }) => ({
  registry: r.registry,
  projects: r.projects.map((p) => ({ name: p.name, workdir: path.relative(home, p.workdir) })),
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the recorded answer (Step 1, green on the serial code)', () => {
  it('listProjects over the fixture answers the recorded rows', async () => {
    const f = projectsFixture('ccrc-projects-recorded-');
    const got = await listProjects(countingIO().io, f.cfg);
    expect(got.roots).toEqual([f.root]);
    expect(relative(f.home, got)).toEqual(RECORDED);
  });
});
