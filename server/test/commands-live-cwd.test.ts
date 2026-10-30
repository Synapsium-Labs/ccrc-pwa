import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

// D-7511 (ARCH-05): the command list's live-state read, pinned through the route before `sessionCommands` takes its
// reader through a port. Which cwd the transcript ladder starts from is the one fact the live file decides here, so
// each row plants the same uuid's transcript under BOTH the registry workdir and the moved cwd, with different skills:
// the answer names which directory the route read.

const ID = 'claude-a-project-live';
const REGISTRY_WORKDIR = '/data/projects/project-live';
const MOVED_CWD = '/data/projects/project-live-worktree'; // the session moved into a worktree
const UUID = '6'.repeat(36);
const PID = 4242;

type LiveFile = { kind: 'moved' } | { kind: 'absent' } | { kind: 'torn' };

interface Fixture { home: string; liveFile: string }

function seed(live: LiveFile): Fixture {
  const home = mkTmp('ccrc-cmd-live-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-live', workdir: REGISTRY_WORKDIR, uuid: UUID, started: '1' })) {
    writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
  const cfgDir = path.join(home, '.claude-a');
  const plant = (dir: string, skill: string): void => {
    const tdir = path.join(cfgDir, 'projects', dir.replace(/[/._]/g, '-'));
    mkdirSync(tdir, { recursive: true });
    const listing = { attachment: { type: 'skill_listing', content: `- ${skill}: Planted under ${dir}.` } };
    writeFileSync(path.join(tdir, `${UUID}.jsonl`), JSON.stringify(listing) + '\n');
  };
  plant(REGISTRY_WORKDIR, 'registry-skill');
  plant(MOVED_CWD, 'worktree-skill');
  const sessions = path.join(cfgDir, 'sessions');
  mkdirSync(sessions, { recursive: true });
  const liveFile = path.join(sessions, `${PID}.json`);
  if (live.kind === 'moved') {
    writeFileSync(liveFile, JSON.stringify({
      pid: PID, sessionId: UUID, cwd: MOVED_CWD, name: 'project-live', status: 'idle', statusUpdatedAt: 1, version: '2.1.210',
    }));
  } else if (live.kind === 'torn') {
    writeFileSync(liveFile, '{"pid": 42'); // caught mid-write, and still so on the retry (D-5234)
  }
  return { home, liveFile };
}

/** A `localIO` that counts the measured reads of one path, so the torn row can say the file was read twice. */
function countReadsOf(file: string): { io: FleetIO; reads: () => number } {
  let reads = 0;
  const io = new Proxy(localIO, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (prop !== 'readFileMeasured' || typeof v !== 'function') return v;
      return (p: string, ...rest: unknown[]) => {
        if (p === file) reads += 1;
        return (v as (...a: unknown[]) => unknown).apply(target, [p, ...rest]);
      };
    },
  });
  return { io, reads: () => reads };
}

/** A fake tmux whose session is live with one pane at `PID`. */
const liveTmux: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
  return { ran: true, code: 0, stdout: '', stderr: '' };
};

async function skillsVia(fx: Fixture): Promise<{ skills: string[]; liveReads: number }> {
  const counted = countReadsOf(fx.liveFile);
  const cfg = loadConfig({ CCRC_HOME: fx.home });
  const app = await buildServer({ cfg, runCcd: ccdRunner(liveTmux, cfg), tmux: new Tmux(liveTmux), io: counted.io, queue: new KeyedQueue() });
  try {
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/commands` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { name: string }[] };
    return { skills: body.skills.map((s) => s.name), liveReads: counted.reads() };
  } finally {
    await app.close();
  }
}

describe('GET /api/sessions/:id/commands: the live cwd (D-7511)', () => {
  it('a live sessions/<pid>.json whose cwd moved into a worktree lists that worktree\'s skills', async () => {
    const out = await skillsVia(seed({ kind: 'moved' }));
    expect(out.skills).toEqual(['worktree-skill']);
    expect(out.liveReads).toBe(1);
  });

  it('with no live file the registry workdir is used', async () => {
    const out = await skillsVia(seed({ kind: 'absent' }));
    expect(out.skills).toEqual(['registry-skill']);
    expect(out.liveReads).toBe(1);
  });

  it('a torn live file, read twice (D-5234), falls back to the registry workdir the same way', async () => {
    const out = await skillsVia(seed({ kind: 'torn' }));
    expect(out.skills).toEqual(['registry-skill']);
    expect(out.liveReads).toBe(2);
  });
});
