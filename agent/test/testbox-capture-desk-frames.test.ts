// The service's refusal of a frames submission when the desk does not frame (Desktop polish wave 187), the delivery file's
// twin: refused at the frame, recording nothing, and a runner with the frames driver takes it to the desk.
import { describe, expect, it } from 'vitest';
import type { CaptureAnswer, CaptureRecipe, CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';
import { readTestboxFrame } from '../../shared/testbox.js';
import type { BuildFileFacts } from '../src/testbox/capture.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import { TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import type { SystemManager } from '../src/testbox/systemd.js';

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const BUILD = '2.1.100';
const HERE = (f: string): BuildFileFacts => ({ regular: true, link: false, links: 1, real: f });
const PASS: BuildCaptureResult = { build: BUILD, pass: true, cwd: true, output: 'verdict: pass (12 records)' };
const submit = (n: number, recipe?: 'frames', part = 1): CaptureSubmit => ({ t: 'capture.submit', captureId: ID(n), build: BUILD, ...(recipe === undefined ? {} : { recipe, part }) });

class Sink {
  readonly frames: CaptureAnswer[] = [];
  send(f: CaptureAnswer): void {
    const r = readTestboxFrame(JSON.stringify(f));
    if (!r.ok) throw new Error(`the desk sent a frame the reader refuses: ${r.reason}`);
    this.frames.push(f);
  }
}

/** A runner that answers at once; `frames` says whether it has the frames driver. */
class Runner implements CaptureRunnerLike {
  readonly asked: (CaptureRecipe | undefined)[] = [];
  constructor(private readonly answer: () => CaptureRun, readonly frames = true) {}
  async run(_id: string, _build: string, recipe?: CaptureRecipe): Promise<CaptureRun> { this.asked.push(recipe); return this.answer(); }
}

function desk(runner: CaptureRunnerLike, over: Partial<CaptureDeskDeps> = {}): CaptureDesk {
  return new CaptureDesk({ role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => [], realPath: (p) => p, tmuxBase: '/tmp', buildFacts: HERE, ...over });
}

describe('a box whose runner has no frames driver refuses the submission at the frame, and records nothing', () => {
  const SETTINGS: ServiceSettings = {
    root: '/srv/testbox', workers: 2, runTmpdir: '/tmp', toolsDir: '/srv/testbox/tools', envForward: [], runUserPrefix: 'ccrc-tb-',
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, registryKeepMs: 86_400_000,
  };
  const service = (captures: CaptureDesk): TestboxService => new TestboxService({
    settings: SETTINGS, rows: [], sys: {} as SystemManager, probe: async () => ({ ok: true }), mirror: {} as MirrorOps,
    now: () => Date.parse('2026-11-26T12:00:00Z'), chrome: '/x/chrome', release: 'v1.2.3', serviceVersion: '1.2.3', captures,
  });
  class Wire implements Conn {
    readonly frames: unknown[] = [];
    readonly refusals: string[] = [];
    send(f: unknown): void { this.frames.push(f); }
    refuse(reason: string): void { this.refusals.push(reason); }
  }
  it.each<[string, CaptureRunnerLike | null]>([
    ['a runner without the driver', new Runner(() => ({ result: PASS, detail: null }), false)],
    ['a runner with only the delivery driver', { run: async () => ({ result: PASS, detail: null }), delivers: true }],
    ['no runner at all', null],
  ])('%s: the connection is closed with the policy refusal and nothing is queued', async (_why, runner) => {
    const d = desk(runner ?? { run: async () => ({ result: PASS, detail: null }) }, runner === null ? { runner: null } : {});
    const svc = service(d);
    const wire = new Wire();
    svc.capture(submit(30, 'frames'), wire as unknown as Conn);
    expect(wire.refusals).toEqual(['frames is not a recipe this box runs']);
    expect(wire.frames).toEqual([]);
    await svc.idle();
    expect(svc.status()).toMatchObject({ queueDepth: 0, runs: { inProgress: 0 } });
  });
  it('a runner with the frames driver takes the submission to the desk', async () => {
    const runner = new Runner(() => ({ result: null, detail: 'x' }));
    const svc = service(desk(runner));
    const wire = new Wire();
    svc.capture(submit(31, 'frames'), wire as unknown as Conn);
    expect(wire.refusals).toEqual([]);
    await svc.idle();
    expect(runner.asked).toEqual(['frames']);
  });
});
