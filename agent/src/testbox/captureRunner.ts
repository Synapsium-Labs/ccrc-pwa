// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3, §2.4). L4:
// it acts on what `capture.ts` decides and `shared/claudeBuildCapture.ts#replayCapture` judges. One capture: a scratch
// directory, the seeded config, the stand-in model, the build started through the launcher, the drive (each step's text
// typed, the recording polled until the step's events are in or its deadline passes), then the replay of the recording.
//
// A build that started but stalled FAILS, its output naming what was never recorded (spec §2.4): the lane must not keep
// a broken contract queued for ever. A capture that could not START (the stand-in or the launcher threw), and the box faults
// below, answer no verdict, so the lane tries the build again. The scratch directory is the runner's own and is removed at
// the end.
//
// THE VERDICT CUT (review 3226, F1 and F2): a fault of the box is not a fault of the build. A `type` that throws while the
// build is gone is a build that exited mid-drive, a FAIL naming the events never recorded; while the build lives it is the
// launcher failing, and answers no verdict. A drive that stops unfinished with nothing recorded at all and no build alive
// is a box fault too (the build died before it could report), no verdict. A live build that records nothing still fails.
//
// THE CLEANUP (F10): after `stop`, the runner waits, bounded, until the build is gone before it removes the directory, so
// nothing is still writing in it; the removal's own failure is logged and never replaces the answer.
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readCaptureRecords, replayCapture, type CaptureRecord } from '../../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../../shared/claudeBuildTrust.js';
import {
  CAPTURE_SOCKET, CAPTURE_STEPS, CAPTURE_TMUX_SESSION, captureClaudeJson, captureEnv, capturePaths, captureSettings, stepDone,
} from './capture.js';
import type { StandIn } from './captureStub.js';
import { tmuxName, tmuxTarget } from '../../../shared/tmux-target.js';
import { boundedExec } from './exec.js';

/** What a launcher is handed: the build, where it starts, its WHOLE environment, and its own tmux server's names. */
export interface CaptureLaunchSpec {
  readonly binary: string;
  readonly cwd: string;
  readonly env: readonly (readonly [string, string])[];
  readonly socket: string;
  readonly session: string;
}

/** A started build, as the drive sees it. */
export interface LaunchedBuild {
  /** Types `text`, then Enter. */
  type(text: string): Promise<void>;
  alive(): Promise<boolean>;
  stop(): Promise<void>;
}

/** Starts a build: tmux in production, a pipe in the tests. A throw is a build that could not start. */
export interface CaptureLauncher { start(spec: CaptureLaunchSpec): Promise<LaunchedBuild> }

/** The capture's answer: the verdict, or none with why (nothing was judged). */
export interface CaptureRun { readonly result: BuildCaptureResult | null; readonly detail: string | null }

export interface CaptureRunnerDeps {
  readonly root: string;
  /** The command that runs the recorder, as argv (`capture.ts#captureSettings`): the node binary and the recorder's
   *  absolute path (`captureRecord.ts#recorderPath`). */
  readonly recorder: readonly string[];
  readonly toolsPath: string | null;
  readonly launcher: CaptureLauncher;
  readonly standIn: () => Promise<StandIn>;
  /** How long one step may take to raise its events. */
  readonly stepTimeoutMs: number;
  /** How long the build may take to exit after the last step. */
  readonly exitTimeoutMs: number;
  readonly pollMs: number;
  /** How long to wait, after `stop`, for the build to be gone before the directory is removed (default 5000). */
  readonly stopWaitMs?: number;
  /** Removes the scratch directory (default: `rmSync`, recursive and forced); a test makes it throw. */
  readonly remove?: (dir: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const STOP_WAIT_MS = 5000;
const removeDir = (dir: string): void => { rmSync(dir, { recursive: true, force: true }); };

/** Whether the build lives; a launcher that cannot say reads as gone. */
async function aliveOf(l: LaunchedBuild): Promise<boolean> {
  try { return await l.alive(); } catch { return false; }
}

export class CaptureRunner {
  constructor(private readonly d: CaptureRunnerDeps) {}

  /** The recording so far, read fresh; an absent file is an empty recording. */
  private recorded(file: string): { readonly records: CaptureRecord[]; readonly unreadable: number } {
    try { return readCaptureRecords(readFileSync(file, 'utf8')); } catch { return { records: [], unreadable: 0 }; }
  }

  async run(captureId: string, build: string): Promise<CaptureRun> {
    const p = capturePaths(this.d.root, captureId, build);
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
    let standIn: StandIn | null = null;
    let launched: LaunchedBuild | null = null;
    try {
      for (const dir of [p.dir, p.home, p.config, p.tmux, p.tmp, p.work, p.cdDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
      // The build reports the work folder's real path, so the trusted folder and the expected `cwd` are that path.
      const work = realpathSync(p.work);
      const cdDir = path.join(work, path.basename(p.cdDir));
      writeFileSync(path.join(p.config, 'settings.json'), JSON.stringify(captureSettings(this.d.recorder)));
      writeFileSync(path.join(p.config, '.claude.json'), JSON.stringify(captureClaudeJson(work)));
      try {
        standIn = await this.d.standIn();
        launched = await this.d.launcher.start({
          binary: p.buildFile, cwd: work, env: captureEnv(p, standIn.port, this.d.toolsPath), socket: CAPTURE_SOCKET, session: CAPTURE_TMUX_SESSION,
        });
      } catch (e) {
        return { result: null, detail: `the capture could not start: ${why(e)}` };
      }
      let finished = true;
      let before = 0;
      drive: for (const step of CAPTURE_STEPS) {
        if (step.type !== null) {
          try {
            await launched.type(step.type);
          } catch (e) {
            // A build that is gone exited mid-drive (a fail, below); a live one means the launcher could not type.
            if (await aliveOf(launched)) return { result: null, detail: `the launcher could not type into the build: ${why(e)}` };
            finished = false;
            break drive;
          }
        }
        const deadline = Date.now() + this.d.stepTimeoutMs;
        for (;;) {
          const hooks = this.recorded(p.recording).records.slice(before).flatMap((r) => (r.kind === 'hook' ? [r.event] : []));
          if (stepDone(step, hooks)) break;
          if (Date.now() >= deadline) { finished = false; break drive; }
          await sleep(this.d.pollMs);
        }
        // The next step counts the events recorded after this one's.
        before = this.recorded(p.recording).records.length;
      }
      if (finished) {
        const deadline = Date.now() + this.d.exitTimeoutMs;
        while (await launched.alive()) {
          if (Date.now() >= deadline) { finished = false; break; }
          await sleep(this.d.pollMs);
        }
      }
      const { records, unreadable } = this.recorded(p.recording);
      if (!finished && records.length === 0 && unreadable === 0 && !(await aliveOf(launched))) {
        return { result: null, detail: 'the build exited before it recorded anything: a fault of the box, not a verdict' };
      }
      return { result: replayCapture({ records, unreadable, cdDir, finished }, build), detail: null };
    } catch (e) {
      return { result: null, detail: `the capture could not be set up: ${why(e)}` };
    } finally {
      if (launched !== null) {
        await launched.stop().catch(() => undefined);
        // Nothing may still write in the directory when it goes: wait, bounded, for the build to be gone.
        const until = Date.now() + (this.d.stopWaitMs ?? STOP_WAIT_MS);
        while (await aliveOf(launched) && Date.now() < until) await sleep(this.d.pollMs);
      }
      if (standIn !== null) await standIn.close().catch(() => undefined);
      try { (this.d.remove ?? removeDir)(p.dir); } catch (e) { console.warn(`ccrc-testbox: capture directory not removed: ${why(e)}`); }
    }
  }
}

/** The production launcher: the build in its own tmux server (`-L <socket>`, `TMUX_TMPDIR` from the spec's environment, never
 *  the fleet's), every call through the bounded spawner with the spec's environment as the WHOLE child environment. */
export function tmuxLauncher(tmux: string, boundMs = 15_000): CaptureLauncher {
  return {
    async start(spec) {
      const exec = boundedExec(Object.fromEntries(spec.env), boundMs);
      const base = ['-L', spec.socket];
      const call = async (args: readonly string[]): Promise<{ readonly status: number; readonly stderr: string }> => {
        const r = await exec(tmux, [...base, ...args]);
        return { status: r.killed ? 124 : r.status, stderr: r.stderr };
      };
      // The session is created and addressed in ccrc's one spelling (`shared/tmux-target.ts`): its name, then the anchored
      // target, so no `-t` can prefix-match another session even on this private server.
      const made = await call(['-f', '/dev/null', 'new-session', '-d', '-s', tmuxName(spec.session), '-x', '200', '-y', '50', '-c', spec.cwd, spec.binary]);
      if (made.status !== 0) {
        // No half-started private server is left behind.
        await call(['kill-server']).catch(() => undefined);
        throw new Error(`tmux new-session exited ${made.status}: ${made.stderr.trim()}`);
      }
      let stopped = false;
      return {
        async type(text) {
          const t = await call(['send-keys', '-t', tmuxTarget(spec.session), '-l', '--', text]);
          if (t.status !== 0) throw new Error(`tmux send-keys exited ${t.status}`);
          const e = await call(['send-keys', '-t', tmuxTarget(spec.session), 'Enter']);
          if (e.status !== 0) throw new Error(`tmux send-keys exited ${e.status}`);
        },
        alive: async () => (await call(['has-session', '-t', tmuxTarget(spec.session)])).status === 0,
        stop: async () => { if (stopped) return; stopped = true; await call(['kill-server']).catch(() => undefined); },
      };
    },
  };
}
