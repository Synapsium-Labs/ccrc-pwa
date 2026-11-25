// The paste delivery recipe on the capture runner (Desktop polish wave 178): `captureRunner.ts`'s delivery branch and
// `captureDeliveryRun.ts`, against a FAKE build (`fixtures/fake-delivery-build.mjs`, never a real one), the real stand-in
// model and the recorder's own source. The product's send is the driver's (`server/test/delivery-drive.test.ts`); here a
// fake driver types each case's text into the fake build, so what is measured is the recipe: each case's window, the
// verdicts, the word, the cut between a fault of the box and a result, the bounds, and the clean-up on every path. The
// build-trust recipe is held unchanged beside it.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTestboxCaptureReply } from '../../shared/agent-protocol.js';
import { deliveryCaseText, deliveryExpected } from '../../shared/deliveryCapture.js';
import { DELIVERY_PART_COUNT, deliveryParts, readDeliveryCaptureResult } from '../../shared/deliveryResult.js';
import { captureBuildsDir, capturePaths, standInReply } from '../src/testbox/capture.js';
import { DELIVERY_PANE, DELIVERY_REPLY_TEXT, deliveryStandInReply } from '../src/testbox/captureDelivery.js';
import { nodeDeliveryDriver, readDriverAnswer, type DeliveryDriver, type DriverAnswer } from '../src/testbox/captureDeliveryRun.js';
import { recorderPath } from '../src/testbox/captureRecord.js';
import { CaptureRunner, tmuxLauncher, type CaptureLaunchSpec, type CaptureLauncher, type CaptureRunnerDeps } from '../src/testbox/captureRunner.js';
import { startStandIn } from '../src/testbox/captureStub.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DELIVERY_BUILD = path.join(HERE, 'fixtures', 'fake-delivery-build.mjs');
const TRUST_BUILD = path.join(HERE, 'fixtures', 'fake-claude-build.mjs');
const RECORDER = [process.execPath, '--experimental-strip-types', '--no-warnings', recorderPath()];
const NODE_DIR = path.dirname(process.execPath);
const GOOD = '2.1.100';
const DUPLICATES = '2.1.990';
const SPLITS = '2.1.989';
const TRUNCATES = '2.1.988';
const DIES = '2.1.987';
const SIDE = '2.1.986';
/** The settle and quiet bounds the runner is handed (`CaptureDeliveryDeps`); the driver's bound is the fake driver's own. */
const BOUNDS = { settleMs: 8_000, quietMs: 150 } as const;

/** The test launcher: the build as a child, stdin piped; the last one started is kept, for the fake driver to type into. */
function pipeLauncher(): { launcher: CaptureLauncher; child: () => ChildProcess; specs: CaptureLaunchSpec[] } {
  let last: ChildProcess | null = null;
  const specs: CaptureLaunchSpec[] = [];
  const launcher: CaptureLauncher = {
    async start(spec) {
      specs.push(spec);
      const child = spawn(process.execPath, [spec.binary], { cwd: spec.cwd, env: Object.fromEntries(spec.env), stdio: ['pipe', 'ignore', 'ignore'] });
      last = child;
      let exited = false;
      child.on('exit', () => { exited = true; });
      child.on('error', () => { exited = true; });
      return {
        type: async (text) => { child.stdin!.write(`${text}\n`); },
        life: async () => (exited ? 'gone' as const : 'alive' as const),
        stop: async () => { child.kill('SIGKILL'); },
      };
    },
  };
  return { launcher, child: () => last!, specs };
}

/** A fake driver: types the case's text (one JSON line) into the build, then answers what `answer` says. */
const typingDriver = (child: () => ChildProcess, answer: (id: string) => DriverAnswer = () => ({ kind: 'sent', send: 'ok' })): DeliveryDriver => ({
  async drive(input) {
    child().stdin!.write(`JSON:${JSON.stringify(deliveryCaseText(input.case))}\n`);
    return answer(input.case);
  },
});

function place(root: string, version: string, fixture = DELIVERY_BUILD): void {
  mkdirSync(captureBuildsDir(root), { recursive: true });
  const f = path.join(captureBuildsDir(root), version);
  copyFileSync(fixture, f);
  chmodSync(f, 0o755);
}

function runner(root: string, launcher: CaptureLauncher, driver: DeliveryDriver | null, over: Partial<CaptureRunnerDeps> = {}): CaptureRunner {
  return new CaptureRunner({
    root, tmuxBase: root, recorder: RECORDER, toolsPath: () => NODE_DIR, launcher,
    standIn: (reply) => startStandIn(reply === undefined ? {} : { reply }),
    stepTimeoutMs: 20_000, exitTimeoutMs: 10_000, pollMs: 50, stopWaitMs: 5000, standInCloseMs: 2000,
    ...(driver === null ? {} : { delivery: { driver, tmuxConf: null, ...BOUNDS } }), ...over,
  });
}

const freshRoot = (): string => realpathSync(mkTmp('ccrc-capdel-'));
const gone = (root: string, id: string, build: string): boolean => !existsSync(capturePaths(root, id, build, root).dir) && !existsSync(capturePaths(root, id, build, root).tmux);

describe('a delivery capture of a build that receives every prompt intact', () => {
  it('answers intact, every case once and equal, with no build-trust verdict, and removes its directories', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('ok', GOOD, 'delivery', 0);
    expect(r.detail).toBeNull();
    expect(r.result).toBeNull();
    expect(r.delivery?.word).toBe('intact');
    expect(r.delivery?.part).toBe(0);
    expect(r.delivery?.cases.map((c) => c.id)).toEqual(deliveryParts()[0]);
    expect(r.delivery?.cases.every((c) => c.verdict === 'intact' && c.hook === 'equal' && c.receivedChars.length === 1)).toBe(true);
    // What travels: the one reader reads the result back, for this build and part.
    expect(readDeliveryCaptureResult(JSON.parse(JSON.stringify(r.delivery)), GOOD, 0)).toEqual(r.delivery);
    expect(gone(root, 'ok', GOOD)).toBe(true);
  }, 120_000);

  it('each part is a capture of its own: only its cases, sent to a fresh build in a fresh directory (call 1148)', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const sent: string[][] = [];
    for (const part of [2, 1]) {
      const l = pipeLauncher();
      const mine: string[] = [];
      sent.push(mine);
      const r = await runner(root, l.launcher, typingDriver(l.child, (id) => { mine.push(id); return { kind: 'sent', send: 'ok' }; })).run(`p${part}`, GOOD, 'delivery', part);
      expect(r.delivery?.part).toBe(part);
      expect(r.delivery?.cases.map((c) => c.id)).toEqual(deliveryParts()[part]);
      expect(r.delivery?.word).toBe('intact');
      expect(gone(root, `p${part}`, GOOD)).toBe(true);
    }
    expect(sent).toEqual([deliveryParts()[2], deliveryParts()[1]]);
  }, 180_000);

  it('a part this box\'s recipe does not have answers no verdict, and nothing is sent', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const asked: string[] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child, (id) => { asked.push(id); return { kind: 'sent', send: 'ok' }; })).run('far', GOOD, 'delivery', DELIVERY_PART_COUNT);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/is not a part of this box's recipe/);
    expect(asked).toEqual([]);
    expect(gone(root, 'far', GOOD)).toBe(true);
  }, 120_000);

  it('asks the launcher for the fleet\'s pane and the stand-in for the delivery reply', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const replies: unknown[] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child), {
      standIn: (reply) => { replies.push(reply); return startStandIn(reply === undefined ? {} : { reply }); },
    }).run('pane', GOOD, 'delivery');
    expect(r.delivery?.word).toBe('intact');
    expect(l.specs[0]!.pane).toEqual(DELIVERY_PANE);
    expect(replies).toEqual([deliveryStandInReply]);
  }, 120_000);

  it('counts a side request apart from the turn', async () => {
    const root = freshRoot();
    place(root, SIDE);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('side', SIDE, 'delivery');
    expect(r.delivery?.word).toBe('intact');
    expect(r.delivery?.cases.every((c) => c.sideRequests >= 1)).toBe(true);
  }, 120_000);
});

describe('a delivery fault reads as a fault, never as a pass', () => {
  it('a prompt received twice: duplicate, the word fault', async () => {
    const root = freshRoot();
    place(root, DUPLICATES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('dup', DUPLICATES, 'delivery');
    expect(r.delivery?.word).toBe('fault');
    expect(r.delivery?.cases.every((c) => c.verdict === 'duplicate' && c.receivedChars.length === 2)).toBe(true);
    expect(gone(root, 'dup', DUPLICATES)).toBe(true);
  }, 120_000);

  it('a prompt split by lines: the multiline cases are splits with their first divergence, the one-line cases intact', async () => {
    const root = freshRoot();
    place(root, SPLITS);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('split', SPLITS, 'delivery');
    const wrong = r.delivery!.cases.filter((c) => (deliveryExpected(c.id).includes('\n') ? c.verdict !== 'split' : c.verdict !== 'intact')).map((c) => `${c.id} ${c.verdict} ${c.receivedChars.length}`);
    expect(wrong).toEqual([]);
    expect(r.delivery?.word).toBe('fault');
    for (const c of r.delivery!.cases) {
      const lines = deliveryExpected(c.id).split('\n');
      if (lines.length === 1) expect(c.verdict).toBe('intact');
      else {
        expect(c.verdict).toBe('split');
        expect(c.divergence).toMatchObject({ turn: 0, index: Array.from(lines[0]!).length });
      }
    }
  }, 120_000);

  it('a truncated prompt: the long cases are altered at code point 100, the short control intact', async () => {
    const root = freshRoot();
    place(root, TRUNCATES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('cut', TRUNCATES, 'delivery');
    const c0 = r.delivery!.cases.find((c) => c.id === 'c0')!;
    const c1 = r.delivery!.cases.find((c) => c.id === 'c1')!;
    expect(c0.verdict).toBe('intact');
    expect(c1).toMatchObject({ verdict: 'altered', receivedChars: [100], divergence: { index: 100 } });
    expect(r.delivery?.word).toBe('fault');
  }, 120_000);

  it('a send that answers ok with nothing received is a false confirmation; a refusal with nothing received is refused', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const silent: DeliveryDriver = { drive: async (input) => ({ kind: 'sent', send: input.case === 'c0' ? 'ok' : 'verify-failed' }) };
    const r = await runner(root, l.launcher, silent).run('silent', GOOD, 'delivery');
    expect(r.delivery?.cases[0]).toMatchObject({ id: 'c0', verdict: 'false-confirmation', receivedChars: [] });
    expect(r.delivery?.cases[1]).toMatchObject({ id: 'c1', verdict: 'refused', send: 'verify-failed' });
    expect(r.delivery?.word).toBe('fault');
  }, 120_000);
});

describe('a fault of the box is never a verdict, and the directories go on every path', () => {
  it('a driver that fails answers no verdict, naming the case', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const failing = typingDriver(l.child, (id) => (id === 'c1b' ? { kind: 'fault', detail: 'the driver could not start' } : { kind: 'sent', send: 'ok' }));
    const r = await runner(root, l.launcher, failing).run('fail', GOOD, 'delivery');
    expect(r).toMatchObject({ result: null, delivery: null });
    expect(r.detail).toMatch(/case c1b: the driver could not start/);
    expect(gone(root, 'fail', GOOD)).toBe(true);
  }, 120_000);

  it('a driver that does not answer within its bound is killed, and the capture answers no verdict, in bounded time', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const script = path.join(mkTmp('ccrc-capdel-hang-'), 'hang.mjs');
    writeFileSync(script, 'process.stdin.resume(); setInterval(() => {}, 1000);\n');
    const t0 = Date.now();
    const r = await runner(root, l.launcher, nodeDeliveryDriver(process.execPath, script, 1_000)).run('hang', GOOD, 'delivery');
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/case c0: the driver did not answer within 1000 ms/);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(gone(root, 'hang', GOOD)).toBe(true);
  }, 120_000);

  it('a build that dies during the cases answers no verdict', async () => {
    const root = freshRoot();
    place(root, DIES);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('dies', DIES, 'delivery');
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone before case c1/);
    expect(gone(root, 'dies', DIES)).toBe(true);
  }, 120_000);

  it('a build killed during the cases answers no verdict, and the directories go', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const killing = typingDriver(l.child, (id) => {
      if (id === 'c1b') l.child().kill('SIGKILL');
      return { kind: 'sent', send: 'ok' };
    });
    const r = await runner(root, l.launcher, killing).run('kill', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone before case c2a/);
    expect(gone(root, 'kill', GOOD)).toBe(true);
  }, 120_000);

  it('a build killed during a part\'s last case answers no verdict too: its last window is not judged', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const killing = typingDriver(l.child, (id) => {
      if (id === 'c2a') l.child().kill('SIGKILL');
      return { kind: 'sent', send: 'ok' };
    });
    const r = await runner(root, l.launcher, killing).run('killlast', GOOD, 'delivery', 0);
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/the build is gone after the last case/);
    expect(gone(root, 'killlast', GOOD)).toBe(true);
  }, 120_000);

  it('a build that never starts answers no verdict within the step bound', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const mute: CaptureLauncher = { start: async (spec) => ({ ...(await l.launcher.start({ ...spec, env: spec.env.filter(([k]) => k !== 'CLAUDE_CONFIG_DIR') })) }) };
    const r = await runner(root, mute, typingDriver(l.child), { stepTimeoutMs: 1500 }).run('mute', GOOD, 'delivery');
    expect(r.delivery).toBeNull();
    expect(r.detail).toMatch(/did not finish the step before the cases \(start\)/);
    expect(gone(root, 'mute', GOOD)).toBe(true);
  }, 120_000);

  it('a runner with no delivery driver wired says so (the box then refuses at the frame), and if asked answers no verdict and starts nothing', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    expect(runner(root, l.launcher, null).delivers).toBe(false);
    expect(runner(root, l.launcher, typingDriver(l.child)).delivers).toBe(true);
    const r = await runner(root, l.launcher, null).run('none', GOOD, 'delivery');
    expect(r).toEqual({ result: null, delivery: null, detail: 'no delivery driver is wired to this runner' });
    expect(l.specs).toEqual([]);
  });
});

describe('the build-trust recipe is unchanged beside it', () => {
  it('a build-trust capture asks the launcher with no pane and no config, the stand-in with no reply rule, and still passes', async () => {
    const root = freshRoot();
    place(root, GOOD, TRUST_BUILD);
    const l = pipeLauncher();
    const asked: unknown[][] = [];
    const r = await runner(root, l.launcher, typingDriver(l.child), {
      standIn: (...args) => { asked.push(args); return startStandIn(); },
    }).run('trust', GOOD);
    expect(r.result).toMatchObject({ build: GOOD, pass: true, cwd: true });
    expect(r).not.toHaveProperty('delivery');
    expect(asked).toEqual([[]]);
    expect(Object.keys(l.specs[0]!).sort()).toEqual(['binary', 'cwd', 'env', 'session', 'socket']);
  }, 120_000);

  it('the stand-in\'s default rule is still build trust\'s, and the delivery rule is never it', () => {
    const body = { tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'ccrc capture step one' }] };
    expect(standInReply(body)).toMatchObject({ kind: 'tool', name: 'Bash' });
    expect(deliveryStandInReply(body)).toEqual({ kind: 'text', text: DELIVERY_REPLY_TEXT });
  });

  it('the tmux launcher\'s creating call is build trust\'s own for a spec with no pane and no config, and the fleet\'s for a delivery spec', async () => {
    const calls: string[][] = [];
    const launcher = tmuxLauncher('tmux', 5000, {
      spawner: () => async (_file, args) => { calls.push([...args]); return { status: 0, stdout: args.includes('new-session') ? '4242\n' : '', stderr: '', killed: false }; },
      signal: () => undefined, shellUsable: () => true,
    });
    const spec = { binary: '/srv/box/captures/builds/2.1.100', cwd: '/w', env: [['PATH', '/usr/bin']] as const, socket: 'ccrc-capture', session: 'capture' };
    await launcher.start(spec);
    expect(calls[0]!.slice(0, 4)).toEqual(['-L', 'ccrc-capture', '-f', '/dev/null']);
    expect(calls[0]!.slice(calls[0]!.indexOf('-x'), calls[0]!.indexOf('-c'))).toEqual(['-x', '200', '-y', '50']);
    await launcher.start({ ...spec, pane: DELIVERY_PANE, tmuxConf: '/tree/ccd/tmux.conf' });
    const made = calls.find((c, i) => i > 0 && c.includes('new-session'))!;
    expect(made.slice(0, 4)).toEqual(['-L', 'ccrc-capture', '-f', '/tree/ccd/tmux.conf']);
    expect(made.slice(made.indexOf('-x'), made.indexOf('-c'))).toEqual(['-x', '220', '-y', '50']);
  });
});

describe('the driver child', () => {
  it('reads the one answer line: ok and a refusal word are the send\'s, anything else a fault', () => {
    expect(readDriverAnswer(0, '{"send":"ok"}\n')).toEqual({ kind: 'sent', send: 'ok' });
    expect(readDriverAnswer(0, '{"send":"verify-failed"}')).toEqual({ kind: 'sent', send: 'verify-failed' });
    expect(readDriverAnswer(2, '{"refused":"tmux-dir","detail":"x"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/refused tmux-dir/) });
    expect(readDriverAnswer(1, '{"send":"driver-failed","detail":"boom"}')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, 'not json')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, '{"send":"OK!"}')).toMatchObject({ kind: 'fault' });
    expect(readDriverAnswer(0, '{"send":"ok","extra":1}')).toMatchObject({ kind: 'fault' });
  });

  it('is given the capture\'s directories and a case id on stdin, never text, in an environment built from empty', async () => {
    const dir = mkTmp('ccrc-capdel-echo-');
    const seen = path.join(dir, 'seen.json');
    const script = path.join(dir, 'echo.cjs');
    writeFileSync(script, `let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => { require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ input: JSON.parse(s), env: process.env })); process.stdout.write('{"send":"ok"}'); });\n`);
    const a = await nodeDeliveryDriver(process.execPath, script, 10_000).drive({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c3' }, { path: '/opt/tools/bin:/usr/bin', tmpBase: '/srv/svc-tmp' });
    expect(a).toEqual({ kind: 'sent', send: 'ok' });
    const got = JSON.parse(readFileSync(seen, 'utf8')) as { input: unknown; env: Record<string, string> };
    expect(got.input).toEqual({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c3' });
    expect(Object.keys(got.env).filter((k) => k !== 'PATH' && k !== 'LANG' && k !== 'TMPDIR')).toEqual([]);
    expect(got.env['PATH']).toBe('/opt/tools/bin:/usr/bin');
    // The runner's tmux base is the child's temporary directory, the one parent the driver accepts (wave 178 departure).
    expect(got.env['TMPDIR']).toBe('/srv/svc-tmp');
  });
});

describe('the op\'s reader reads a delivery reply only as one', () => {
  it('a delivery reply with its result reads back; the same reply read as build trust carries no delivery', async () => {
    const root = freshRoot();
    place(root, GOOD);
    const l = pipeLauncher();
    const r = await runner(root, l.launcher, typingDriver(l.child)).run('wire', GOOD, 'delivery', 0);
    const reply = { outcome: 'answered', refusal: null, result: null, detail: null, delivery: JSON.parse(JSON.stringify(r.delivery)) };
    expect(readTestboxCaptureReply(reply, GOOD, 'delivery', 0)?.delivery?.word).toBe('intact');
    expect(readTestboxCaptureReply(reply, GOOD, 'delivery', 1)).toBeNull();
    expect(readTestboxCaptureReply({ ...reply, delivery: { ...reply.delivery, word: 'fault' } }, GOOD, 'delivery', 0)).toBeNull();
    expect(readTestboxCaptureReply({ outcome: 'answered', refusal: null, result: null, detail: null }, GOOD, 'delivery', 0)).toBeNull();
    expect(readTestboxCaptureReply(reply, GOOD)?.delivery).toBeUndefined();
  }, 120_000);
});
