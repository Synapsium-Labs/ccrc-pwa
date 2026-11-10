// D-6094 (fleet-capacity W1-3): `workerReadingFor` (`src/turnverdict.ts`), the read behind the stale-run predicate's
// port. Over a real registry row and live file and a fake tmux: a stopped, archived, hibernated or pane-less worker is
// `gone`; a worker with background work, subagents or a turn marker whose `bg` or `crons` is not exactly 0 is `busy`
// (tool children hold the memory); a quiet one is `idle`; anything that could not be read is `unmeasured`.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { workerReadingFor, type TurnReadDeps } from '../src/turnverdict.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import type { Tmux } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'project-a-quiet-basin';
const UUID = `u-${ID}`;
const WRAPPER = 'claude-a';
const PANE = 4242;
const T = 1_800_000_000_000;
const MIN = 60_000;

const MARK: Record<string, unknown> = {
  v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: T, turnAt: T - MIN, stopAt: T,
  bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0,
};

interface Opts { extra?: Record<string, string>; verdict?: 'live' | 'gone' | 'unknown'; mark?: Record<string, unknown> | null; status?: string }

async function box(o: Opts = {}): Promise<{ deps: TurnReadDeps; rec: SessionRecord }> {
  const home = mkTmp('ccrc-worker-reading-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: WRAPPER, project: 'project-a', workdir: `/w/${ID}`, uuid: UUID, started: '1',
    workspace: ID, branch: `ws/${ID}`, base: 'origin/main', ...(o.extra ?? {}),
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  if (o.mark !== null) writeFileSync(path.join(reg, `${ID}.turn.json`), `${JSON.stringify({ ...MARK, ...(o.mark ?? {}) })}\n`);
  const sdir = path.join(home, `.${WRAPPER}`, 'sessions');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(path.join(sdir, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: UUID, status: o.status ?? 'idle', startedAt: T - 60 * MIN, statusUpdatedAt: T }));
  const base = testDeps(home);
  const read = await readSessionRecord(base.io, base.cfg, ID);
  if (read.kind !== 'found') throw new Error(`fixture: row not found (${read.kind})`);
  return {
    rec: read.record,
    deps: {
      io: base.io, cfg: base.cfg,
      tmux: { sessionVerdict: async () => ({ verdict: o.verdict ?? 'live' }), panePid: async () => PANE } as unknown as Tmux,
      pendingDialogs: () => undefined, statuslines: () => undefined,
    },
  };
}

describe('workerReadingFor (D-6094)', () => {
  it('a quiet, awake worker with an idle marker reads idle', async () => {
    const b = await box();
    expect(await workerReadingFor(b.deps, b.rec)).toBe('idle');
  });

  it('a stopped, archived or hibernated row reads gone, before any pane read', async () => {
    for (const extra of [{ stopped: '1700000000 pane' }, { archived: '1700000000' }, { hibernated: '1700000000' }]) {
      const b = await box({ extra });
      expect(await workerReadingFor(b.deps, b.rec)).toBe('gone');
    }
  });

  it('a pane tmux proved gone reads gone; one tmux could not answer for is unmeasured', async () => {
    const gone = await box({ verdict: 'gone' });
    expect(await workerReadingFor(gone.deps, gone.rec)).toBe('gone');
    const unknown = await box({ verdict: 'unknown' });
    expect(await workerReadingFor(unknown.deps, unknown.rec)).toBe('unmeasured');
  });

  it('a busy live file reads busy', async () => {
    const b = await box({ status: 'busy' });
    expect(await workerReadingFor(b.deps, b.rec)).toBe('busy');
  });

  it('an idle worker whose marker lists background work (bg not exactly 0) or a cron is counted busy', async () => {
    for (const mark of [{ bg: 1, bgKinds: 'shell', bgIds: 'b1' }, { bg: -1 }, { crons: 1 }]) {
      const b = await box({ mark });
      expect(await workerReadingFor(b.deps, b.rec)).toBe('busy');
    }
  });

  it('a marker that cannot be read is unmeasured, never idle', async () => {
    const b = await box({ mark: null });
    expect(await workerReadingFor(b.deps, b.rec)).toBe('unmeasured');
  });
});
