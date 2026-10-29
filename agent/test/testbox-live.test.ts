// D-7406, D-7431 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.3's three checks). The live
// suite: the same checks `testbox-service.test.ts` makes against the fake system manager, made against the box's REAL
// static units through the real system manager. It SKIPS unless `CCRC_TESTBOX_LIVE=1` is set AND the box's installed
// marker `/etc/ccrc-testbox/installed` exists (D-7431): only TB13 runs it, as the service user on the box, after the
// installer (TB7) has put a fixture repository row `project-a` in the table whose `probe` package lists the command
// head `node probe.mjs` and whose mirror holds `refs/ccrc-test/<run-id>/head` for each of the four run ids this suite
// names, space-separated, in `CCRC_TESTBOX_LIVE_RUNS` (each a probe tree: `probe/probe.mjs`, `probe/package.json`,
// `probe/package-lock.json`). Nothing here runs anywhere else: no CI leg sets the variable, and no fleet host has the
// marker.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunLog, RunSubmit, RunSummary } from '../../shared/testbox.js';
import { readTestboxConfig } from '../src/testbox/config.js';
import { releaseOf, serviceFor } from '../src/testbox/main.js';
import type { Conn } from '../src/testbox/service.js';

const INSTALLED = '/etc/ccrc-testbox/installed';
const LIVE = process.env.CCRC_TESTBOX_LIVE === '1' && existsSync(INSTALLED);
const RUNS = (process.env.CCRC_TESTBOX_LIVE_RUNS ?? '').split(/\s+/).filter((r) => r !== '');
const runAt = (i: number): string => {
  const id = RUNS[i];
  if (id === undefined) throw new Error('CCRC_TESTBOX_LIVE_RUNS names fewer than four run ids');
  return id;
};

class Sink implements Conn {
  readonly frames: (RunLog | RunSummary)[] = [];
  refusals: string[] = [];
  private wake: (() => void) | null = null;
  send(f: RunLog | RunSummary): void { this.frames.push(f); this.wake?.(); }
  refuse(r: string): void { this.refusals.push(r); this.wake?.(); }
  async summary(id: string): Promise<RunSummary> {
    for (;;) {
      const s = this.frames.find((f): f is RunSummary => f.t === 'run.summary' && f.runId === id);
      if (s !== undefined) return s;
      if (this.refusals.length > 0) throw new Error(this.refusals.join('; '));
      await new Promise<void>((r) => { this.wake = r; });
    }
  }
  out(id: string): string {
    return this.frames.filter((f): f is RunLog => f.t === 'run.log' && f.runId === id && f.stream === 'stdout')
      .sort((a, b) => a.offset - b.offset).map((f) => Buffer.from(f.bytes, 'base64').toString('utf8')).join('');
  }
}

describe.skipIf(!LIVE)('live: spec §2.3\'s checks against the box\'s real units (D-7431)', () => {
  const release = releaseOf(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'agent', 'src', 'testbox', 'main.js'));
  const submit = (mode: string, session: string): RunSubmit => ({
    t: 'run.submit', runId: '', repository: 'project-a', package: 'probe', branch: null, refs: ['head'], outputs: [],
    argv: ['node', 'probe.mjs', mode], forward: {}, ci: false, workers: 1, session,
  });
  const run = async (mode: string, session: string, runId: string) => {
    const cfg = await readTestboxConfig(release);
    const svc = serviceFor(cfg, release);
    await svc.start();
    const sink = new Sink();
    svc.submit({ ...submit(mode, session), runId }, sink);
    const s = await sink.summary(runId);
    await svc.idle();
    return { s, out: sink.out(runId), cfg, svc };
  };

  it('the env and /proc checks: the run sees the allowlist only, an empty HOME, and its own processes only', async () => {
    const { s, out } = await run('env-proc', 'session-a', runAt(0));
    expect(s.exit).toBe(0);
    const env = JSON.parse(/^ENV (.*)$/m.exec(out)![1]!) as string[];
    expect(env).toEqual(['CCRC_CHROME', 'HOME', 'LANG', 'PATH', 'TERM', 'TMPDIR', 'VITEST_MAX_FORKS', 'VITEST_MAX_THREADS', 'VITEST_MAX_WORKERS']);
    expect(JSON.parse(/^HOME (.*)$/m.exec(out)![1]!)).toEqual([]);
    const uids = JSON.parse(/^PROC_UIDS (.*)$/m.exec(out)![1]!) as number[];
    expect(new Set(uids).size).toBe(1);
  }, 600_000);

  it('the install check: the upstream registry, a public address, the token file and a pristine install are each out of reach', async () => {
    const { s, out } = await run('reach', 'session-a', runAt(1));
    expect(s.exit).toBe(0);
    expect(JSON.parse(/^REACHED (.*)$/m.exec(out)![1]!)).toEqual([]);
  }, 600_000);

  it('the carry-over check: /dev/shm, .git/hooks, .git/config, a read-only directory and a sibling of runs/<k>/run leave nothing for the next run', async () => {
    const first = await run('carry', 'session-a', runAt(2));
    expect(first.s.exit).toBe(0);
    expect(first.out).toMatch(/sibling refused/);
    expect(existsSync(path.join(first.cfg.root, 'runs', '1', 'run'))).toBe(false);
    const second = await run('look', 'session-b', runAt(3));
    expect(second.out).toContain('SEEN []');
    expect(os.platform()).toBe('linux');
  }, 600_000);
});
