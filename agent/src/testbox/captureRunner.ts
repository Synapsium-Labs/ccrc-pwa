// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, §2.3, §2.4). L4:
// it acts on what `capture.ts` decides and `shared/claudeBuildCapture.ts#replayCapture` judges. One capture: a scratch
// directory, the seeded config, the stand-in model, the build started through the launcher, the drive (each step's text
// typed, the recording polled until the step's events are in or its deadline passes), then the replay of the recording.
// Every bound it keeps is one of the timing contract's (`capture.ts#CAPTURE_TIMINGS`), handed in by the entry point
// (`main.ts#captureRunnerFor`), and `capture.ts#captureWorstCaseMs` is its worst case.
//
// A build that started but stalled FAILS, its output naming what was never recorded (spec §2.4): the lane must not keep
// a broken contract queued for ever. A capture that could not START (the stand-in or the launcher threw), and the box faults
// below, answer no verdict, so the lane tries the build again. The scratch directory and the tmux directory are the
// runner's own and are removed at the end.
//
// THE VERDICT CUT (review 3226, F1 and F2): a fault of the box is not a fault of the build. A `type` that throws while the
// build is gone is a build that exited mid-drive, a FAIL naming the events never recorded; while the build lives it is the
// launcher failing, and answers no verdict. A drive that stops unfinished with nothing recorded at all and no build alive
// is a box fault too (the build died before it could report), no verdict. A live build that records nothing still fails.
// The build's life is one of three words (review 3623): `alive`, `gone`, or `unknown` when the launcher cannot tell, and
// `unknown` is never read as `gone`: wherever the cut would turn on it, the capture answers no verdict.
//
// THE CLEANUP (F10): after `stop`, the runner waits, bounded, until the build is gone before it removes the directories,
// so nothing is still writing in them; the build's life is read from its own processes, never from its terminal server
// (review 3623). A removal's own failure is logged and never replaces the answer.
import { accessSync, constants, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readCaptureRecords, replayCapture, type CaptureRecord } from '../../../shared/claudeBuildCapture.js';
import type { CaptureRecipe } from '../../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../../shared/claudeBuildTrust.js';
import type { DeliveryCaptureResult } from '../../../shared/deliveryResult.js';
import {
  CAPTURE_SOCKET, CAPTURE_STEPS, CAPTURE_TMUX_SESSION, captureClaudeJson, captureEnv, capturePaths, captureSettings, stepDone,
} from './capture.js';
import type { StandIn } from './captureStub.js';
import { DELIVERY_PANE, deliveryStandInReply } from './captureDelivery.js';
import { runDeliveryDrive, type DeliveryDriver } from './captureDeliveryRun.js';
import type { StandInReply } from './capture.js';
import { tmuxName, tmuxTarget } from '../../../shared/tmux-target.js';
import { boundedExec, type Exec } from './exec.js';

/** What a launcher is handed: the build, where it starts, its WHOLE environment, and its own tmux server's names. */
export interface CaptureLaunchSpec {
  readonly binary: string;
  readonly cwd: string;
  readonly env: readonly (readonly [string, string])[];
  readonly socket: string;
  readonly session: string;
  /** The pane's size (default 200x50, build trust's); the delivery recipe asks for the fleet's (Desktop polish wave 178). */
  readonly pane?: { readonly cols: number; readonly rows: number };
  /** The tmux config file the private server starts with (default `/dev/null`, build trust's); the delivery recipe asks for
   *  the fleet's shipped `ccd/tmux.conf`. */
  readonly tmuxConf?: string;
}

/** Whether a started build lives: `unknown` when the launcher cannot tell, which is never read as `gone`. */
export type BuildLife = 'alive' | 'gone' | 'unknown';

/** A started build, as the drive sees it. */
export interface LaunchedBuild {
  /** Types `text`, then Enter. */
  type(text: string): Promise<void>;
  /** The build's life, read from the build's own processes, never from its terminal server (review 3623). */
  life(): Promise<BuildLife>;
  stop(): Promise<void>;
}

/** Starts a build: tmux in production, a pipe in the tests. A throw is a build that could not start. */
export interface CaptureLauncher { start(spec: CaptureLaunchSpec): Promise<LaunchedBuild> }

/** The capture's answer: the verdict, or none with why (nothing was judged). A delivery capture's answer carries
 *  `delivery` (its result, or null) and never a build-trust `result`. */
export interface CaptureRun {
  readonly result: BuildCaptureResult | null;
  readonly detail: string | null;
  readonly delivery?: DeliveryCaptureResult | null;
}

/** What the delivery recipe needs beyond a build-trust capture (Desktop polish wave 178). Absent: the runner answers a
 *  delivery capture with no verdict. */
export interface CaptureDeliveryDeps {
  readonly driver: DeliveryDriver;
  /** The fleet's shipped tmux config (`ccd/tmux.conf` in the release tree), or null for none. */
  readonly tmuxConf: string | null;
  /** The settle and quiet bounds of one case: `CaptureTimings.deliverySettleMs` and `deliveryQuietMs`, from the one
   *  contract the runner is built from (`main.ts#captureRunnerFor`). */
  readonly settleMs: number;
  readonly quietMs: number;
}

export interface CaptureRunnerDeps {
  readonly root: string;
  /** The service's temporary directory, under which the capture's tmux directory goes (`capture.ts#captureTmuxDir`). */
  readonly tmuxBase: string;
  /** The command that runs the recorder, as argv (`capture.ts#captureSettings`): the node binary and the recorder's
   *  absolute path (`captureRecord.ts#recorderPath`). */
  readonly recorder: readonly string[];
  /** The box's tools directories, read when each capture starts (the tool sync may move them between captures). */
  readonly toolsPath: () => string | null;
  readonly launcher: CaptureLauncher;
  /** Starts the stand-in; `reply` is the delivery recipe's rule, and absent for build trust. */
  readonly standIn: (reply?: (body: unknown) => StandInReply) => Promise<StandIn>;
  /** The delivery recipe's driver, tmux config and bounds; absent, a delivery capture answers no verdict. */
  readonly delivery?: CaptureDeliveryDeps;
  /** How long one step may take to raise its events. */
  readonly stepTimeoutMs: number;
  /** How long the build may take to exit after the last step. */
  readonly exitTimeoutMs: number;
  readonly pollMs: number;
  /** How long to wait, after `stop`, for the build to be gone before the directory is removed. */
  readonly stopWaitMs: number;
  /** How long to wait for the stand-in model to close; a hung close is left behind, never waited on. */
  readonly standInCloseMs: number;
  /** Removes the scratch directory (default: `rmSync`, recursive and forced); a test makes it throw. */
  readonly remove?: (dir: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The clock every deadline is measured on (default `Date.now`); the deadline test runs the runner on a virtual one. */
  readonly now?: () => number;
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const removeDir = (dir: string): void => { rmSync(dir, { recursive: true, force: true }); };

/** The build's life; a launcher that throws cannot tell, so `unknown`, never `gone` (review 3623). */
async function lifeOf(l: LaunchedBuild): Promise<BuildLife> {
  try { return await l.life(); } catch { return 'unknown'; }
}

/** The no-verdict answer when the launcher cannot tell whether the build lives at a point the verdict turns on. */
const UNKNOWN_LIFE = 'the launcher cannot tell whether the build lives: a fault of the box, not a verdict';

export class CaptureRunner {
  constructor(private readonly d: CaptureRunnerDeps) {}

  /** The recording so far, read fresh; an absent file is an empty recording. */
  private recorded(file: string): { readonly records: CaptureRecord[]; readonly unreadable: number } {
    try { return readCaptureRecords(readFileSync(file, 'utf8')); } catch { return { records: [], unreadable: 0 }; }
  }

  /** Whether this runner runs the delivery recipe: its driver is wired. A box whose runner does not refuses a delivery
   *  submission at the frame, as a box that predates the recipe does (the capture owner's call 1148). */
  get delivers(): boolean { return this.d.delivery !== undefined; }

  async run(captureId: string, build: string, recipe: CaptureRecipe = 'build-trust', part = 0): Promise<CaptureRun> {
    const delivery = recipe === 'delivery' ? this.d.delivery : undefined;
    if (recipe === 'delivery' && delivery === undefined) return { result: null, delivery: null, detail: 'no delivery driver is wired to this runner' };
    const p = capturePaths(this.d.root, captureId, build, this.d.tmuxBase);
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }));
    const now = this.d.now ?? Date.now;
    let standIn: StandIn | null = null;
    let launched: LaunchedBuild | null = null;
    try {
      for (const dir of [p.dir, p.home, p.config, p.tmux, p.tmp, p.work, p.cdDir]) mkdirSync(dir, { recursive: true, mode: 0o700 });
      // The build reports the work folder's real path, so the trusted folder and the expected `cwd` are that path.
      const work = realpathSync(p.work);
      const cdDir = path.join(work, path.basename(p.cdDir));
      writeFileSync(path.join(p.config, 'settings.json'), JSON.stringify(captureSettings(this.d.recorder)));
      writeFileSync(path.join(p.config, '.claude.json'), JSON.stringify(captureClaudeJson(work)));
      const env = (port: number) => captureEnv(p, port, this.d.toolsPath());
      try {
        if (delivery === undefined) {
          standIn = await this.d.standIn();
          launched = await this.d.launcher.start({
            binary: p.buildFile, cwd: work, env: env(standIn.port), socket: CAPTURE_SOCKET, session: CAPTURE_TMUX_SESSION,
          });
        } else {
          standIn = await this.d.standIn(deliveryStandInReply);
          launched = await this.d.launcher.start({
            binary: p.buildFile, cwd: work, env: env(standIn.port), socket: CAPTURE_SOCKET, session: CAPTURE_TMUX_SESSION,
            pane: DELIVERY_PANE, ...(delivery.tmuxConf === null ? {} : { tmuxConf: delivery.tmuxConf }),
          });
        }
      } catch (e) {
        return { result: null, ...(delivery === undefined ? {} : { delivery: null }), detail: `the capture could not start: ${why(e)}` };
      }
      if (delivery !== undefined) {
        // The delivery recipe (Desktop polish wave 178): its own drive, its own result; the build-trust drive below is not
        // run, and nothing here reads or writes the build-trust verdict.
        const l = launched;
        const s = standIn;
        const pathVar = env(s.port).find(([k]) => k === 'PATH')?.[1] ?? '';
        const out = await runDeliveryDrive({
          launched: l, life: () => lifeOf(l), requests: s.requests, records: () => this.recorded(p.recording).records,
          input: { capture: p.dir, tmux: p.tmux }, place: { path: pathVar, tmpBase: this.d.tmuxBase }, build, part, driver: delivery.driver, settleMs: delivery.settleMs, quietMs: delivery.quietMs,
          stepTimeoutMs: this.d.stepTimeoutMs, exitTimeoutMs: this.d.exitTimeoutMs, pollMs: this.d.pollMs, sleep, now,
        });
        return { result: null, delivery: out.delivery, detail: out.detail };
      }
      let finished = true;
      let before = 0;
      drive: for (const step of CAPTURE_STEPS) {
        if (step.type !== null) {
          try {
            await launched.type(step.type);
          } catch (e) {
            // A build that is gone exited mid-drive (a fail, below); a live one means the launcher could not type; one the
            // launcher cannot read is never taken for gone.
            const life = await lifeOf(launched);
            if (life === 'alive') return { result: null, detail: `the launcher could not type into the build: ${why(e)}` };
            if (life === 'unknown') return { result: null, detail: `${UNKNOWN_LIFE} (the launcher could not type: ${why(e)})` };
            finished = false;
            break drive;
          }
        }
        const deadline = now() + this.d.stepTimeoutMs;
        for (;;) {
          const hooks = this.recorded(p.recording).records.slice(before).flatMap((r) => (r.kind === 'hook' ? [r.event] : []));
          if (stepDone(step, hooks)) break;
          if (now() >= deadline) { finished = false; break drive; }
          await sleep(this.d.pollMs);
        }
        // The next step counts the events recorded after this one's.
        before = this.recorded(p.recording).records.length;
      }
      if (finished) {
        const deadline = now() + this.d.exitTimeoutMs;
        for (;;) {
          const life = await lifeOf(launched);
          if (life === 'gone') break;
          if (life === 'unknown') return { result: null, detail: UNKNOWN_LIFE };
          if (now() >= deadline) { finished = false; break; }
          await sleep(this.d.pollMs);
        }
      }
      const { records, unreadable } = this.recorded(p.recording);
      if (!finished && records.length === 0 && unreadable === 0) {
        const life = await lifeOf(launched);
        if (life === 'gone') return { result: null, detail: 'the build exited before it recorded anything: a fault of the box, not a verdict' };
        if (life === 'unknown') return { result: null, detail: UNKNOWN_LIFE };
      }
      return { result: replayCapture({ records, unreadable, cdDir, finished }, build), detail: null };
    } catch (e) {
      return { result: null, ...(delivery === undefined ? {} : { delivery: null }), detail: `the capture could not be set up: ${why(e)}` };
    } finally {
      if (launched !== null) {
        await launched.stop().catch(() => undefined);
        // Nothing may still write in the directory when it goes: wait, bounded, for the build's processes to be gone.
        const until = now() + this.d.stopWaitMs;
        while (await lifeOf(launched) !== 'gone' && now() < until) await sleep(this.d.pollMs);
      }
      if (standIn !== null) {
        const s = standIn;
        await Promise.race([s.close().catch(() => undefined), sleep(this.d.standInCloseMs)]);
      }
      for (const dir of [p.dir, p.tmux]) {
        try { (this.d.remove ?? removeDir)(dir); } catch (e) { console.warn(`ccrc-testbox: capture directory not removed: ${why(e)}`); }
      }
    }
  }
}

/** What the production launcher acts through, for the tests: the bounded spawner and the signal call. */
export interface TmuxLauncherSeams {
  readonly spawner?: (env: Readonly<Record<string, string>>, boundMs: number) => Exec;
  /** `process.kill`; a negative pid names a process group. */
  readonly signal?: (pid: number, sig: NodeJS.Signals | 0) => void;
  /** Whether the capture's shell is an executable file (default {@link executableFile}). */
  readonly shellUsable?: (file: string) => boolean;
}

/** The life of a process group, from a probe with signal 0: `ESRCH` is gone, `EPERM` is a group that exists, and any
 *  other failure cannot tell. */
export function groupLife(signal: (pid: number, sig: 0) => void, pgid: number): BuildLife {
  try { signal(-pgid, 0); return 'alive'; } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    return code === 'ESRCH' ? 'gone' : code === 'EPERM' ? 'alive' : 'unknown';
  }
}

/** What starts the build in its pane: tmux runs a command given as two or more words directly, with no shell between it
 *  and the command (tmux's manual, "executed directly (without sh -c)"); a command of one word would go through the pane's
 *  default shell (review 3687 F1; that is now {@link CAPTURE_SHELL}, so the two words are what keeps a shell out). This
 *  fixed system program, then the build's absolute path, is two words: it replaces itself with the build, so no
 *  interpreter reads the build's name and the pane's process is the build. */
export const CAPTURE_START = '/usr/bin/env';

/** The shell the build sees as `SHELL` (programme call 1047): one fixed, absolute system shell its tool step can use, set
 *  as the capture's own tmux server's default shell, which tmux hands the pane as `SHELL` whatever the caller's environment
 *  or the service user's entry says (measured: with neither, the pane sees the service user's login-refusing shell). The
 *  pane still starts with no shell between tmux and the build. */
export const CAPTURE_SHELL = '/bin/bash';

/** Whether `file` is an executable regular file (L3, read at each start). */
export function executableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The characters a build's path may hold (review 3765 F5): letters, digits, `.`, `_`, `/` and `-`. That is the set the
 *  fleet's copy accepts for the box root (`ccd/testbox-build-copy`, which refuses any other root before it reaches the box)
 *  together with a build version's digits and dots, so every build the copy can place passes; and nothing in it is read
 *  specially by tmux's argument parser or by a shell, so the path stays one path to the build whatever reads it. No `=`
 *  either, which the start program would read as a variable to set. */
const CAPTURE_PATH_CHARS = /^[A-Za-z0-9._/-]+$/;

/** The pane's command, built in this one place: {@link CAPTURE_START}, then `binary` as a word of its own. A pane can never
 *  start the fixed program alone (alone, it would print the pane's whole environment into what the capture records), and
 *  never a path tmux could read as anything but that one path, so this throws, before any tmux call, unless `binary` is a
 *  string naming an absolute path in {@link CAPTURE_PATH_CHARS}: an empty, missing, blank or relative path is refused, and
 *  so is one holding any other character. The throw is a fault of the box, never a verdict. */
export function capturePaneCommand(binary: unknown): readonly [string, string] {
  if (typeof binary !== 'string' || !path.isAbsolute(binary) || !CAPTURE_PATH_CHARS.test(binary)) {
    throw new Error('the build\'s path is missing, not absolute, or holds a character other than a letter, a digit, ., _, / or -: it cannot be started without a shell as one path');
  }
  return [CAPTURE_START, binary];
}

/** The production launcher: the build in its own tmux server (`-L <socket>`, `TMUX_TMPDIR` from the spec's environment, never
 *  the fleet's), every call through the bounded spawner with the spec's environment as the WHOLE child environment, each
 *  within `boundMs` (the timing contract's `tmuxCallMs`). The build is started with no shell between tmux and it
 *  ({@link CAPTURE_START}), so the pane's process IS the build, and tmux makes it the leader of a process group of its own;
 *  the creation prints that process, and the build's life is read from its group (review 3623), never from the terminal
 *  server. A path that cannot be started so is refused before any tmux call. */
export function tmuxLauncher(tmux: string, boundMs = 15_000, seams: TmuxLauncherSeams = {}): CaptureLauncher {
  const signal = seams.signal ?? ((pid: number, sig: NodeJS.Signals | 0) => { process.kill(pid, sig); });
  return {
    async start(spec) {
      const command = capturePaneCommand(spec.binary);
      if (!(seams.shellUsable ?? executableFile)(CAPTURE_SHELL)) throw new Error(`the capture's shell ${CAPTURE_SHELL} is not an executable file on this box`);
      const exec = (seams.spawner ?? boundedExec)(Object.fromEntries(spec.env), boundMs);
      const base = ['-L', spec.socket];
      const call = async (args: readonly string[]): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> => {
        const r = await exec(tmux, [...base, ...args]);
        return { status: r.killed ? 124 : r.status, stdout: r.stdout, stderr: r.stderr };
      };
      // The session is created and addressed in ccrc's one spelling (`shared/tmux-target.ts`): its name, then the anchored
      // target, so no `-t` can prefix-match another session even on this private server.
      const made = await call([
        // The server's default shell is set first, in the same call, so the pane sees it as `SHELL` (call 1047).
        '-f', spec.tmuxConf ?? '/dev/null', 'set-option', '-g', 'default-shell', CAPTURE_SHELL, ';',
        'new-session', '-d', '-P', '-F', '#{pane_pid}', '-s', tmuxName(spec.session), '-x', String(spec.pane?.cols ?? 200), '-y', String(spec.pane?.rows ?? 50),
        '-c', spec.cwd, ...command,
      ]);
      const pid = made.status === 0 && /^[1-9][0-9]*$/.test(made.stdout.trim()) ? Number(made.stdout.trim()) : null;
      if (pid === null || pid <= 1) {
        // No half-started private server is left behind.
        await call(['kill-server']).catch(() => undefined);
        throw new Error(made.status !== 0 ? `tmux new-session exited ${made.status}: ${made.stderr.trim()}` : 'tmux new-session named no process for the build');
      }
      let stopped = false;
      return {
        async type(text) {
          const t = await call(['send-keys', '-t', tmuxTarget(spec.session), '-l', '--', text]);
          if (t.status !== 0) throw new Error(`tmux send-keys exited ${t.status}`);
          const e = await call(['send-keys', '-t', tmuxTarget(spec.session), 'Enter']);
          if (e.status !== 0) throw new Error(`tmux send-keys exited ${e.status}`);
        },
        life: async () => groupLife(signal, pid),
        stop: async () => {
          if (stopped) return;
          stopped = true;
          await call(['kill-server']).catch(() => undefined);
          // The server's end hangs the pane up; the build's group is also told to end, in case it does not take a hangup.
          try { signal(-pid, 'SIGTERM'); } catch { /* already gone, or not ours to tell: the stop wait reads its life */ }
        },
      };
    },
  };
}
