// The box frames recipe's drive (Desktop polish wave 187): `captureFramesRun.ts` and the runner's frames branch, against
// a FAKE driver and a FAKE launched build with a scripted recording. The product's send, typing and screen read are the
// driver's (`server/test`); here what is measured is the recipe: the steps it asks in order, the reduced frame, the window's
// counts, the cut between a fault of the box and a result, and the hold released on every path.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaptureRecord } from '../../shared/claudeBuildCapture.js';
import type { DeliveryRoute } from '../../shared/deliveryResult.js';
import { FRAMES_HOLD_TEXT, FRAMES_REPLY_TEXT, framesDraftLines, framesRows } from '../../shared/framesCapture.js';
import { FRAME_BYTES_MAX, FRAMES_PARTS, framesPartOfId, readFramesCaptureResult } from '../../shared/framesResult.js';
import { capturePaths } from '../src/testbox/capture.js';
import type { DriverPlace } from '../src/testbox/captureDeliveryRun.js';
import {
  FRAMES_FRAME_OUTPUT_MAX, FRAMES_STEP_OUTPUT_MAX, framesFrameOf, nodeFramesDriver, readFramesDriverAnswer, runFramesDrive,
  type FramesDriveContext, type FramesDriver, type FramesDriverAnswer,
} from '../src/testbox/captureFramesRun.js';
import { CaptureRunner, FRAMES_NO_PART, type BuildLife, type CaptureFramesDeps, type CaptureLaunchSpec, type CaptureLauncher } from '../src/testbox/captureRunner.js';
import type { StandInReply } from '../src/testbox/capture.js';
import type { StandIn } from '../src/testbox/captureStub.js';
import { mkTmp } from './tmpHelpers.js';

const GOOD = '2.1.100';
const partOf = (id: string): number => {
  const p = framesPartOfId(id);
  if (p === null) throw new Error(`no part ${id}`);
  return p;
};
const never = (): boolean => false;

// ── the driver's answer ──────────────────────────────────────────────────────────────────────────────────────────

describe('the driver child\'s answer (readFramesDriverAnswer)', () => {
  it('reads each answer shape: a send, a typing step, a frame with and without a cursor, a frame that could not be read', () => {
    expect(readFramesDriverAnswer(0, '{"send":"ok"}\n')).toEqual({ kind: 'sent', send: 'ok' });
    expect(readFramesDriverAnswer(0, '{"send":"verify-failed"}')).toEqual({ kind: 'sent', send: 'verify-failed' });
    expect(readFramesDriverAnswer(0, '{"typed":true}')).toEqual({ kind: 'typed', typed: true });
    expect(readFramesDriverAnswer(0, '{"typed":false}')).toEqual({ kind: 'typed', typed: false });
    expect(readFramesDriverAnswer(0, '{"frame":"a\\nb","cursor":[3,4],"settled":true}')).toEqual({ kind: 'frame', frame: 'a\nb', cursor: [3, 4], settled: true });
    expect(readFramesDriverAnswer(0, '{"frame":"a","cursor":null,"settled":false}')).toEqual({ kind: 'frame', frame: 'a', cursor: null, settled: false });
    expect(readFramesDriverAnswer(0, '{"frame":null,"cursor":null,"settled":false}')).toEqual({ kind: 'frame', frame: null, cursor: null, settled: false });
  });

  it('a send word that is a fault of the box (not-alive) is a fault, at exit 0 too', () => {
    expect(readFramesDriverAnswer(0, '{"send":"not-alive"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/not-alive/) });
  });

  it('exit 3 with a fault line is a fault naming its reason and detail, never the send word', () => {
    const a = readFramesDriverAnswer(3, '{"fault":"tmux-call","send":"not-alive","detail":"the pane is gone"}');
    expect(a).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/^the driver exited 3: /) });
    const detail = a.kind === 'fault' ? a.detail : '';
    expect(detail).toContain('tmux-call');
    expect(detail).toContain('the pane is gone');
    expect(detail).not.toContain('not-alive');
    const long = readFramesDriverAnswer(3, JSON.stringify({ fault: 'tmux-call', detail: 'x'.repeat(500) }));
    expect(long.kind === 'fault' ? long.detail.length : 0).toBeLessThan(250);
    // Exit 3 with a good-looking answer is still a fault.
    expect(readFramesDriverAnswer(3, '{"send":"ok"}')).toMatchObject({ kind: 'fault' });
  });

  it('an answer with an extra or a missing key, a wrong type, a bad cursor or a refusal is a fault', () => {
    for (const bad of [
      '{"send":"ok","extra":1}', '{"typed":true,"extra":1}', '{"frame":"a","cursor":null,"settled":true,"extra":1}',
      '{"frame":"a","cursor":null}', '{"frame":"a","settled":true}', '{"send":"OK!"}', '{"send":7}', '{"typed":"yes"}',
      '{"frame":7,"cursor":null,"settled":true}', '{"frame":"a","cursor":[1],"settled":true}', '{"frame":"a","cursor":[-1,2],"settled":true}',
      '{"frame":"a","cursor":[1.5,2],"settled":true}', '{"frame":"a","cursor":null,"settled":"yes"}', '[]', '{}',
    ]) expect(readFramesDriverAnswer(0, bad), bad).toMatchObject({ kind: 'fault' });
    expect(readFramesDriverAnswer(2, '{"refused":"tmux-dir","detail":"x"}')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/refused tmux-dir/) });
    expect(readFramesDriverAnswer(1, '{"send":"driver-failed"}')).toMatchObject({ kind: 'fault' });
  });

  it('a line that is not JSON is a fault', () => {
    expect(readFramesDriverAnswer(0, 'not json')).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/no answer/) });
    expect(readFramesDriverAnswer(0, '')).toMatchObject({ kind: 'fault' });
  });
});

describe('the production driver (nodeFramesDriver)', () => {
  const place = (dir: string): DriverPlace => ({ path: '/opt/tools/bin:/usr/bin', tmpBase: dir });

  it('is given the capture\'s directories and the step word on stdin, in an environment built from empty', async () => {
    const dir = mkTmp('ccrc-capfr-echo-');
    const script = path.join(dir, 'echo.cjs');
    writeFileSync(script, "let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => { require('node:fs').writeFileSync(require('node:path').join(process.env.TMPDIR, 'seen.json'), JSON.stringify({ input: JSON.parse(s), env: process.env })); process.stdout.write('{\"typed\":true}'); });\n");
    const a = await nodeFramesDriver(process.execPath, script, 10_000, 10_000, 1_000).step('type:rows-3@220x50', { capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x' }, place(dir), false, false);
    expect(a).toEqual({ kind: 'typed', typed: true });
    const got = JSON.parse(readFileSync(path.join(dir, 'seen.json'), 'utf8')) as { input: unknown; env: Record<string, string> };
    expect(got.input).toEqual({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', frames: 'type:rows-3@220x50' });
    expect(Object.keys(got.env).filter((k) => k !== 'PATH' && k !== 'LANG' && k !== 'TMPDIR')).toEqual([]);
    expect(got.env['PATH']).toBe('/opt/tools/bin:/usr/bin');
    expect(got.env['TMPDIR']).toBe(dir);
  });

  it('a frame step that says more than its cap is recorded over the cap, never cut; any other step that does is a fault', async () => {
    const dir = mkTmp('ccrc-capfr-big-');
    const script = path.join(dir, 'big.cjs');
    writeFileSync(script, `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('x'.repeat(${FRAMES_FRAME_OUTPUT_MAX + 1024})); });\n`);
    const d = nodeFramesDriver(process.execPath, script, 10_000, 10_000, 1_000);
    const input = { capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x' };
    expect(await d.step('frame', input, place(dir), false, true)).toEqual({ kind: 'frame', frame: null, cursor: null, settled: false, overCap: true });
    expect(FRAMES_STEP_OUTPUT_MAX).toBeLessThan(FRAMES_FRAME_OUTPUT_MAX);
    expect(await d.step('held', input, place(dir), false, false)).toMatchObject({ kind: 'fault', detail: 'the driver said too much' });
  }, 30_000);

  it('a person step is held to the person\'s bound and any other to the step\'s', async () => {
    const dir = mkTmp('ccrc-capfr-hang-');
    const script = path.join(dir, 'hang.cjs');
    writeFileSync(script, 'process.stdin.resume(); setInterval(() => {}, 1000);\n');
    const d = nodeFramesDriver(process.execPath, script, 300, 700, 200);
    const input = { capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x' };
    expect(await d.step('stash', input, place(dir), false, false)).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/within 300 ms/) });
    expect(await d.step('person:person@220x50', input, place(dir), true, false)).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/within 700 ms/) });
  }, 30_000);
});

// ── the frame ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a frame as the result carries it (framesFrameOf)', () => {
  const part = partOf('rows-3@220x50');
  const pane = FRAMES_PARTS[part]!.pane;
  const OURS = framesRows(3).join('\n');
  const bytesOf = (s: string): number => Buffer.byteLength(s, 'utf8');

  it('a drawn frame is reduced: its rows kept, its replaced counts present, its cursor as read', () => {
    const f = framesFrameOf(`${OURS}\nhello world`, false, [3, 4], true, part, [], never);
    expect(f).toEqual({ outcome: 'drawn', refusal: null, rows: 4, width: Math.max(...framesRows(3).map((r) => r.length), 'hello world'.length), bytes: bytesOf(`${OURS}\nhello world`), cursor: [3, 4], replaced: { cwd: 0, path: 0, model: 0, account: 0 }, text: `${OURS}\nhello world` });
  });

  it('an unsettled frame is kept as unsettled, its text reduced the same', () => {
    expect(framesFrameOf(OURS, false, null, false, part, [], never)).toMatchObject({ outcome: 'unsettled', refusal: null, text: OURS, replaced: { cwd: 0, path: 0, model: 0, account: 0 }, cursor: null });
  });

  it('one row over the pane is over-cap with its measured sizes and no text', () => {
    const raw = Array.from({ length: pane.rows + 1 }, () => 'x').join('\n');
    expect(framesFrameOf(raw, false, [0, 0], true, part, [], never)).toEqual({ outcome: 'over-cap', refusal: null, rows: pane.rows + 1, width: 1, bytes: bytesOf(raw), cursor: [0, 0], replaced: null, text: null });
    // At exactly the pane's rows it is inside the cap.
    expect(framesFrameOf(Array.from({ length: pane.rows }, () => 'x').join('\n'), false, null, true, part, [], never).outcome).toBe('drawn');
  });

  it('a row one column too wide is over-cap too', () => {
    const raw = 'y'.repeat(pane.cols + 1);
    expect(framesFrameOf(raw, false, null, true, part, [], never)).toMatchObject({ outcome: 'over-cap', rows: 1, width: pane.cols + 1, text: null, replaced: null });
  });

  it('bytes over FRAME_BYTES_MAX are over-cap with the measured sizes, inside the pane\'s rows and columns', () => {
    const line = `${'\x1b[0m'.repeat(400)}a`;
    const raw = Array.from({ length: pane.rows }, () => line).join('\n');
    expect(bytesOf(raw)).toBeGreaterThan(FRAME_BYTES_MAX);
    expect(framesFrameOf(raw, false, null, true, part, [], never)).toEqual({ outcome: 'over-cap', refusal: null, rows: pane.rows, width: 1, bytes: bytesOf(raw), cursor: null, replaced: null, text: null });
  });

  it('the over-cap flag from the driver is over-cap with no text, whatever raw text came with it', () => {
    const cap = { outcome: 'over-cap', refusal: null, rows: 0, width: 0, bytes: FRAMES_FRAME_OUTPUT_MAX, replaced: null, text: null };
    expect(framesFrameOf(null, true, null, false, part, [], never)).toEqual({ ...cap, cursor: null });
    expect(framesFrameOf(OURS, true, [1, 1], true, part, [], never)).toEqual({ ...cap, cursor: [1, 1] });
    expect(framesFrameOf(null, false, null, false, part, [], never)).toMatchObject({ outcome: 'over-cap', text: null });
  });

  it('a frame naming one of the capture\'s private strings has that row replaced, and the count says so', () => {
    const raw = `${OURS}\nrunning on scratch-host-name now\nhello world`;
    const f = framesFrameOf(raw, false, null, true, part, ['scratch-host-name', ''], never);
    expect(f.outcome).toBe('drawn');
    expect(f.text).not.toContain('scratch-host-name');
    expect(f.text).toContain('‹working directory›');
    expect(f.replaced).toEqual({ cwd: 1, path: 0, model: 0, account: 0 });
    // The replaced row keeps its width.
    expect(f.text!.split('\n')[3]!.length).toBe('running on scratch-host-name now'.length);
  });

  it('a frame the committed scan hits is refused as a private name, with its measured sizes and no text', () => {
    const raw = `${OURS}\nsome FORBIDDEN word`;
    const f = framesFrameOf(raw, false, [0, 1], true, part, [], (t) => t.includes('FORBIDDEN'));
    expect(f).toEqual({ outcome: 'refused', refusal: 'private-name', rows: 4, width: 'some FORBIDDEN word'.length > framesRows(3)[0]!.length ? 'some FORBIDDEN word'.length : framesRows(3)[0]!.length, bytes: bytesOf(raw), cursor: [0, 1], replaced: null, text: null });
  });

  it('a text that is not a frame by the shape rule (a control character) is refused as not-a-frame', () => {
    expect(framesFrameOf('a\x07b', false, null, true, part, [], never)).toMatchObject({ outcome: 'refused', refusal: 'not-a-frame', text: null, replaced: null });
  });

  it('a cursor outside the pane is null, and one on its last cell is kept', () => {
    expect(framesFrameOf(OURS, false, [pane.cols, 0], true, part, [], never).cursor).toBeNull();
    expect(framesFrameOf(OURS, false, [0, pane.rows], true, part, [], never).cursor).toBeNull();
    expect(framesFrameOf(OURS, false, [pane.cols - 1, pane.rows - 1], true, part, [], never).cursor).toEqual([pane.cols - 1, pane.rows - 1]);
  });
});

// ── the drive on a scripted build ────────────────────────────────────────────────────────────────────────────────

interface Helpers {
  request(route: DeliveryRoute, text?: string): void;
  other(): void;
}

interface Script {
  /** A driver answer for the step with this word (its index in the asked order), or undefined for the default. */
  readonly answer?: (word: string, k: number) => FramesDriverAnswer | undefined;
  /** What a step does to the stand-in's window, before its answer. */
  readonly during?: (word: string, h: Helpers) => void;
  /** The build's life at the n-th read (0-based); default alive. */
  readonly life?: (n: number) => BuildLife;
  readonly frame?: string;
  readonly settled?: boolean;
  readonly scan?: (t: string) => boolean;
  readonly privates?: readonly string[];
  /** A request that arrives during the build's model switch, before the case's first step. */
  readonly preRequest?: boolean;
}

function scripted(id: string, o: Script = {}) {
  const part = partOf(id);
  const p = FRAMES_PARTS[part]!;
  const clock = { now: 0 };
  const requests: unknown[] = [];
  const routes: DeliveryRoute[] = [];
  const others: number[] = [];
  const records: CaptureRecord[] = [];
  const hook = (event: string): void => { records.push({ kind: 'hook', event, payload: {}, status: null }); };
  const asked: { word: string; person: boolean; frame: boolean }[] = [];
  const order: string[] = [];
  let released = 0;
  let lives = 0;
  const body = (text: string): unknown => ({ tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: text }] });
  const h: Helpers = {
    request: (route, text = 'a turn') => { requests.push(body(text)); routes.push(route); },
    other: () => { others.push(requests.length); },
  };
  const frameText = o.frame ?? framesDraftLines(p.case, p.pane).slice(0, 3).join('\n');
  const driver: FramesDriver = {
    async step(word, _input, _place, person, frame) {
      const k = asked.length;
      asked.push({ word, person, frame });
      order.push(`driver:${word}`);
      o.during?.(word, h);
      const a = o.answer?.(word, k);
      if (a !== undefined) return a;
      if (word.startsWith('turn:') || word.startsWith('send:')) { h.request('messages', word); hook('UserPromptSubmit'); hook('Stop'); return { kind: 'sent', send: 'ok' }; }
      if (word === 'held') { h.request('messages', FRAMES_HOLD_TEXT); hook('UserPromptSubmit'); return { kind: 'sent', send: 'ok' }; }
      if (word.startsWith('queued:')) return { kind: 'sent', send: 'ok' };
      if (word === 'frame') return { kind: 'frame', frame: frameText, cursor: [0, 0], settled: o.settled ?? true };
      return { kind: 'typed', typed: true };
    },
  };
  const ctx: FramesDriveContext = {
    launched: {
      type: async (text) => {
        if (text.startsWith('/model')) { hook('PreModelSwitch'); hook('PostModelSwitch'); if (o.preRequest === true) h.request('messages', 'before the case'); }
        if (text === '/exit') { order.push('type:/exit'); hook('SessionEnd'); }
      },
      life: async () => 'alive', stop: async () => undefined,
    },
    life: async () => o.life?.(lives++) ?? 'alive',
    requests, routes, others, records: () => records, input: { capture: '/c', tmux: '/t' }, place: { path: '', tmpBase: '' },
    build: GOOD, part, driver, settleMs: 200, quietMs: 40, release: null, unmeasured: [], privates: o.privates ?? [], scan: o.scan ?? never,
    releaseHold: () => { released++; order.push('release'); },
    stepTimeoutMs: 1000, exitTimeoutMs: 100, pollMs: 10,
    sleep: async (ms) => { clock.now += ms; if (records.length === 0) hook('SessionStart'); },
    now: () => clock.now,
  };
  return { ctx, asked, order, part, released: () => released };
}

describe('the drive of a part', () => {
  it('a rows-3 part: types its draft, then reads the frame; the result is one the one reader accepts, word framed', async () => {
    const s = scripted('rows-3@220x50');
    const run = await runFramesDrive(s.ctx);
    expect(run.detail).toBeNull();
    expect(s.asked).toEqual([{ word: 'type:rows-3@220x50', person: false, frame: false }, { word: 'frame', person: false, frame: true }]);
    const r = run.frames!;
    expect(r.word).toBe('framed');
    expect(r.frame).toMatchObject({ outcome: 'drawn', rows: 3, cursor: [0, 0] });
    expect(r).toMatchObject({ recipe: 'frames', build: GOOD, part: s.part, case: 'rows-3', pane: { cols: 220, rows: 50 }, release: null, unmeasured: [], sends: [], turns: 0, sideRequests: 0 });
    expect(readFramesCaptureResult(JSON.parse(JSON.stringify(r)), GOOD, s.part)).toEqual(r);
    expect(s.released()).toBe(1);
  });

  it('a -turns part asks turn 1 and turn 2 first, records two sends and counts two turns', async () => {
    const s = scripted('rows-3-turns@220x50');
    const run = await runFramesDrive(s.ctx);
    expect(run.detail).toBeNull();
    expect(s.asked.map((a) => a.word)).toEqual(['turn:1', 'turn:2', 'type:rows-3-turns@220x50', 'frame']);
    expect(run.frames!.sends).toEqual([{ step: 'turn-1', send: 'ok' }, { step: 'turn-2', send: 'ok' }]);
    expect(run.frames).toMatchObject({ turns: 2, sideRequests: 0, word: 'framed' });
    expect(readFramesCaptureResult(JSON.parse(JSON.stringify(run.frames)), GOOD, s.part)).not.toBeNull();
  });

  it('the person part is asked as the person, and only that step', async () => {
    const s = scripted('person@220x50');
    const run = await runFramesDrive(s.ctx);
    expect(run.detail).toBeNull();
    expect(s.asked).toEqual([{ word: 'person:person@220x50', person: true, frame: false }, { word: 'frame', person: false, frame: true }]);
    expect(run.frames!.word).toBe('framed');
    const t = scripted('person-turns@220x50');
    await runFramesDrive(t.ctx);
    expect(t.asked.filter((a) => a.person).map((a) => a.word)).toEqual(['person:person-turns@220x50']);
  });

  it('a submitted part sends the draft and records that send', async () => {
    const s = scripted('submitted@220x50');
    const run = await runFramesDrive(s.ctx);
    expect(s.asked.map((a) => a.word)).toEqual(['send:submitted@220x50', 'frame']);
    expect(run.frames!.sends).toEqual([{ step: 'send', send: 'ok' }]);
    expect(run.frames!.turns).toBe(1);
  });

  it('the queued part holds a turn, queues a message and reads the frame; the hold is released once, after the frame and before /exit', async () => {
    const s = scripted('queued@220x50');
    const run = await runFramesDrive(s.ctx);
    expect(run.detail).toBeNull();
    expect(s.asked.map((a) => a.word)).toEqual(['held', 'queued:queued@220x50', 'frame']);
    expect(s.order).toEqual(['driver:held', 'driver:queued:queued@220x50', 'driver:frame', 'release', 'type:/exit']);
    expect(s.released()).toBe(1);
    expect(run.frames!.sends).toEqual([{ step: 'held', send: 'ok' }, { step: 'send', send: 'ok' }]);
    expect(readFramesCaptureResult(JSON.parse(JSON.stringify(run.frames)), GOOD, s.part)).not.toBeNull();
  });

  it('every part of the list can be driven on a scripted build to a result the one reader accepts', async () => {
    for (let i = 0; i < FRAMES_PARTS.length; i++) {
      const p = FRAMES_PARTS[i]!;
      const s = scripted(`${p.case}@${p.pane.cols}x${p.pane.rows}`, { frame: framesRows(3).join('\n') });
      const run = await runFramesDrive(s.ctx);
      expect(run.detail, `part ${i}`).toBeNull();
      expect(readFramesCaptureResult(JSON.parse(JSON.stringify(run.frames)), GOOD, i), `part ${i}`).not.toBeNull();
      expect(s.released(), `part ${i}`).toBe(1);
    }
  });

  it('a part this recipe does not have answers no result and drives nothing', async () => {
    const s = scripted('rows-3@220x50');
    const run = await runFramesDrive({ ...s.ctx, part: FRAMES_PARTS.length });
    expect(run).toEqual({ frames: null, detail: expect.stringMatching(/is not a part of this box's frames recipe/) });
    expect(s.asked).toEqual([]);
  });

  it('the steps before the case that never finish answer no result, naming the step', async () => {
    const s = scripted('rows-3@220x50');
    const run = await runFramesDrive({ ...s.ctx, records: () => [], sleep: async (ms) => { void ms; }, now: (() => { let n = 0; return () => (n += 600); })() });
    expect(run.frames).toBeNull();
    expect(run.detail).toMatch(/did not finish the step before the case \(start\)/);
    expect(s.asked).toEqual([]);
  });
});

describe('what the frame says about the result', () => {
  it('an unsettled frame is a gap, with its text kept', async () => {
    const run = await runFramesDrive(scripted('rows-3@220x50', { settled: false }).ctx);
    expect(run.frames).toMatchObject({ word: 'gaps', frame: { outcome: 'unsettled' } });
    expect(run.frames!.frame.text).not.toBeNull();
  });

  it('a frame the scan hits is a gap with no text; the result still reads back', async () => {
    const s = scripted('rows-3@220x50', { frame: 'a FORBIDDEN row', scan: (t) => t.includes('FORBIDDEN') });
    const run = await runFramesDrive(s.ctx);
    expect(run.frames).toMatchObject({ word: 'gaps', frame: { outcome: 'refused', refusal: 'private-name', text: null } });
    expect(readFramesCaptureResult(JSON.parse(JSON.stringify(run.frames)), GOOD, s.part)).not.toBeNull();
  });

  it('a frame over the driver\'s cap is a gap with no text', async () => {
    const run = await runFramesDrive(scripted('rows-3@220x50', { answer: (w) => (w === 'frame' ? { kind: 'frame', frame: null, cursor: null, settled: false, overCap: true } : undefined) }).ctx);
    expect(run.frames).toMatchObject({ word: 'gaps', frame: { outcome: 'over-cap', text: null } });
  });

  it('the frame is reduced with the privates the drive is given', async () => {
    const s = scripted('rows-3@220x50', { frame: `${framesRows(3).join('\n')}\non scratch-host-name`, privates: ['scratch-host-name'] });
    const run = await runFramesDrive(s.ctx);
    expect(run.frames!.frame.replaced).toEqual({ cwd: 1, path: 0, model: 0, account: 0 });
    expect(run.frames!.frame.text).not.toContain('scratch-host-name');
  });
});

describe('the window counts the case\'s requests', () => {
  it('counts turns and side requests since the case\'s first step; a count_tokens request is a side request, an unscripted route is one too, and a request before the case is nobody\'s', async () => {
    const s = scripted('rows-3@220x50', {
      preRequest: true,
      during: (w, h) => {
        if (w !== 'frame') return;
        h.request('messages', 'a turn');
        h.request('count_tokens', 'counted');
        h.other();
      },
    });
    const run = await runFramesDrive(s.ctx);
    expect(run.detail).toBeNull();
    expect(run.frames).toMatchObject({ turns: 1, sideRequests: 2 });
  });

  it('a window with only side requests has no turns', async () => {
    const s = scripted('rows-3@220x50', { during: (w, h) => { if (w === 'frame') { h.request('count_tokens'); h.request('count_tokens'); } } });
    expect((await runFramesDrive(s.ctx)).frames).toMatchObject({ turns: 0, sideRequests: 2 });
  });
});

describe('a fault of the box is never a result, and the hold is released on every path', () => {
  it('a driver fault at any step answers no result with a detail naming the step, and stops there', async () => {
    const words = ['turn:1', 'turn:2', 'type:rows-3-turns@220x50', 'frame'];
    for (const [k, w] of words.entries()) {
      const s = scripted('rows-3-turns@220x50', { answer: (word) => (word === w ? { kind: 'fault', detail: 'the driver could not start' } : undefined) });
      const run = await runFramesDrive(s.ctx);
      expect(run.frames, w).toBeNull();
      expect(run.detail, w).toMatch(/^the (turn|type|frame) step: the driver could not start: a fault of the box, not a result$/);
      expect(s.asked, w).toHaveLength(k + 1);
      expect(s.released(), w).toBe(1);
    }
  });

  it('a typing step tmux refused (typed false) answers no result', async () => {
    const s = scripted('rows-3@220x50', { answer: (w) => (w.startsWith('type:') ? { kind: 'typed', typed: false } : undefined) });
    const run = await runFramesDrive(s.ctx);
    expect(run.frames).toBeNull();
    expect(run.detail).toMatch(/tmux refused a key of the type step/);
    expect(s.asked.map((a) => a.word)).toEqual(['type:rows-3@220x50']);
    expect(s.released()).toBe(1);
  });

  it('a frame that could not be read, with no over-cap word, answers no result', async () => {
    const s = scripted('rows-3@220x50', { answer: (w) => (w === 'frame' ? { kind: 'frame', frame: null, cursor: null, settled: false } : undefined) });
    const run = await runFramesDrive(s.ctx);
    expect(run.frames).toBeNull();
    expect(run.detail).toMatch(/the screen could not be read/);
    expect(s.released()).toBe(1);
  });

  it('an answer off the step\'s shape answers no result', async () => {
    const cases: [string, (w: string) => FramesDriverAnswer | undefined, RegExp][] = [
      ['rows-3@220x50', (w) => (w.startsWith('type:') ? { kind: 'sent', send: 'ok' } : undefined), /the type step answered off its shape/],
      ['rows-3-turns@220x50', (w) => (w === 'turn:1' ? { kind: 'typed', typed: true } : undefined), /the turn step answered off its shape/],
      ['rows-3@220x50', (w) => (w === 'frame' ? { kind: 'typed', typed: true } : undefined), /the frame step answered off its shape/],
    ];
    for (const [id, answer, re] of cases) {
      const s = scripted(id, { answer });
      const run = await runFramesDrive(s.ctx);
      expect(run.frames).toBeNull();
      expect(run.detail).toMatch(re);
      expect(s.released()).toBe(1);
    }
  });

  it('a build gone or of unknown life before a step answers no result, and asks that step nothing', async () => {
    for (const [word, label] of [['gone', 'gone'], ['unknown', 'of unknown life']] as const) {
      const s = scripted('rows-3@220x50', { life: (n) => (n === 1 ? word : 'alive') });
      const run = await runFramesDrive(s.ctx);
      expect(run.frames).toBeNull();
      expect(run.detail).toMatch(new RegExp(`the build is ${label} before the frame step`));
      expect(s.asked.map((a) => a.word)).toEqual(['type:rows-3@220x50']);
      expect(s.released()).toBe(1);
    }
    const first = scripted('rows-3@220x50', { life: () => 'gone' });
    const run = await runFramesDrive(first.ctx);
    expect(run.detail).toMatch(/the build is gone before the type step/);
    expect(first.asked).toEqual([]);
    expect(first.released()).toBe(1);
  });

  it('a build gone or of unknown life after the frame answers no result: its last window is not judged', async () => {
    for (const [word, label] of [['gone', 'gone'], ['unknown', 'of unknown life']] as const) {
      const s = scripted('rows-3@220x50', { life: (n) => (n === 2 ? word : 'alive') });
      const run = await runFramesDrive(s.ctx);
      expect(run.frames).toBeNull();
      expect(run.detail).toMatch(new RegExp(`the build is ${label} after the frame`));
      expect(s.asked).toHaveLength(2);
      expect(s.released()).toBe(1);
    }
  });

  it('the hold is released before /exit even when the frame step faults', async () => {
    const s = scripted('queued@220x50', { answer: (w) => (w === 'frame' ? { kind: 'fault', detail: 'boom' } : undefined) });
    const run = await runFramesDrive(s.ctx);
    expect(run.frames).toBeNull();
    expect(s.order).toEqual(['driver:held', 'driver:queued:queued@220x50', 'driver:frame', 'release']);
  });
});

// ── the runner's frames branch ───────────────────────────────────────────────────────────────────────────────────

describe('the runner\'s frames branch', () => {
  const NO_RECORDER = ['node', '/srv/box/recorder.js'];
  // Each case runs the real runner on real clocks.
  const LONG = 60_000;
  const freshRoot = (): string => realpathSync(mkTmp('ccrc-capfr-'));
  const gone = (root: string, id: string): boolean => !existsSync(capturePaths(root, id, GOOD, root).dir) && !existsSync(capturePaths(root, id, GOOD, root).tmux);

  /** A launcher whose build raises its events into the capture's recording, as the real recorder would. */
  function fakeLauncher() {
    const specs: CaptureLaunchSpec[] = [];
    let alive = true;
    const launcher: CaptureLauncher = {
      async start(spec) {
        specs.push(spec);
        const file = new Map(spec.env).get('CCRC_CAPTURE_RECORDING')!;
        mkdirSync(path.dirname(file), { recursive: true });
        const hook = (event: string): void => { appendFileSync(file, `${JSON.stringify({ kind: 'hook', event, payload: {}, status: null })}\n`); };
        // The build raises SessionStart after it started, as the drive counts events from the step's own beginning.
        setTimeout(() => { try { hook('SessionStart'); } catch { /* the capture's directory is gone */ } }, 30);
        return {
          type: async (text) => { if (text.startsWith('/model')) { hook('PreModelSwitch'); hook('PostModelSwitch'); } if (text === '/exit') { hook('SessionEnd'); alive = false; } },
          life: async () => (alive ? 'alive' as const : 'gone' as const),
          stop: async () => { alive = false; },
        };
      },
    };
    return { launcher, specs };
  }

  function standIns() {
    const replies: (((body: unknown) => StandInReply) | undefined)[] = [];
    let released = 0;
    const standIn = async (reply?: (body: unknown) => StandInReply): Promise<StandIn> => {
      replies.push(reply);
      return { port: 4567, requests: [], routes: [], close: async () => undefined, release: () => { released++; } };
    };
    return { standIn, replies, released: () => released };
  }

  const framesDeps = (driver: FramesDriver, over: Partial<CaptureFramesDeps> = {}): CaptureFramesDeps => ({
    driver, tmuxConf: null, release: null, settleMs: 200, quietMs: 40, holdMs: 777, privates: ['box-private-name'], scan: never, ...over,
  });

  function runner(root: string, l: CaptureLauncher, s: ReturnType<typeof standIns>, frames?: CaptureFramesDeps): CaptureRunner {
    return new CaptureRunner({
      root, tmuxBase: root, recorder: NO_RECORDER, toolsPath: () => null, launcher: l, standIn: s.standIn,
      stepTimeoutMs: 5_000, exitTimeoutMs: 2_000, pollMs: 10, stopWaitMs: 1_000, standInCloseMs: 500, ...(frames === undefined ? {} : { frames }),
    });
  }

  const typingDriver: FramesDriver = { step: async (word) => (word === 'frame' ? { kind: 'frame', frame: framesRows(3).join('\n'), cursor: null, settled: true } : { kind: 'typed', typed: true }) };

  it('a runner with no frames deps says so, answers no result with a detail, and starts nothing', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const s = standIns();
    const r = runner(root, l.launcher, s);
    expect(r.frames).toBe(false);
    expect(await r.run('none', GOOD, 'frames', 0)).toEqual({ result: null, frames: null, detail: 'no frames driver is wired to this runner' });
    expect(l.specs).toEqual([]);
    expect(s.replies).toEqual([]);
  }, LONG);

  it('a frames capture with no part, or a part the list does not have, runs nothing and answers no result', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const s = standIns();
    const asked: string[] = [];
    const r = runner(root, l.launcher, s, framesDeps({ step: async (w) => { asked.push(w); return { kind: 'typed', typed: true }; } }));
    expect(r.frames).toBe(true);
    expect(await r.run('nopart', GOOD, 'frames')).toEqual({ result: null, frames: null, detail: FRAMES_NO_PART });
    expect(await r.run('far', GOOD, 'frames', FRAMES_PARTS.length)).toEqual({ result: null, frames: null, detail: FRAMES_NO_PART });
    expect(l.specs).toEqual([]);
    expect(asked).toEqual([]);
  }, LONG);

  it('a wired capture launches at the part\'s own pane with the frames stand-in rule, answers a result the reader accepts, and removes its directories', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const s = standIns();
    const part = partOf('rows-3@220x40');
    expect(FRAMES_PARTS[part]!.pane).toEqual({ cols: 220, rows: 40 });
    const r = await runner(root, l.launcher, s, framesDeps(typingDriver)).run('wired', GOOD, 'frames', part);
    expect(r.detail).toBeNull();
    expect(r.result).toBeNull();
    expect(r.frames).toMatchObject({ word: 'framed', part, pane: { cols: 220, rows: 40 }, unmeasured: ['fleet-tmux-config'], release: null });
    expect(readFramesCaptureResult(JSON.parse(JSON.stringify(r.frames)), GOOD, part)).toEqual(r.frames);
    expect(l.specs).toHaveLength(1);
    expect(l.specs[0]!.pane).toEqual(FRAMES_PARTS[part]!.pane);
    expect(Object.keys(l.specs[0]!)).not.toContain('tmuxConf');
    // The stand-in is started with the frames rule: the marked turn is held for the contract's hold, any other is not.
    const rule = s.replies[0]!;
    expect(rule({ messages: [{ role: 'user', content: FRAMES_HOLD_TEXT }] })).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT, holdMs: 777 });
    expect(rule({ messages: [{ role: 'user', content: 'hi' }] })).toEqual({ kind: 'text', text: FRAMES_REPLY_TEXT });
    expect(s.released()).toBe(1);
    expect(gone(root, 'wired')).toBe(true);
  }, LONG);

  it('a pane started with the fleet\'s config says nothing is unmeasured, and the config is the launcher\'s', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const part = partOf('rows-3@220x50');
    const r = await runner(root, l.launcher, standIns(), framesDeps(typingDriver, { tmuxConf: '/tree/ccd/tmux.conf', release: 'v1.2.3' })).run('conf', GOOD, 'frames', part);
    expect(r.frames).toMatchObject({ unmeasured: [], release: 'v1.2.3' });
    expect(l.specs[0]!.tmuxConf).toBe('/tree/ccd/tmux.conf');
  }, LONG);

  it('the privates handed to the drive hold the box\'s, the capture\'s scratch directories and the stand-in\'s address', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const part = partOf('rows-3@220x50');
    let seen = '';
    const driver: FramesDriver = {
      async step(word, input) {
        seen = JSON.stringify(input);
        if (word !== 'frame') return { kind: 'typed', typed: true };
        const frame = [...framesRows(3), `on box-private-name`, `in ${input.capture}`, `in ${input.tmux}`, 'to 127.0.0.1:4567', 'to 127.0.0.1:9999'].join('\n');
        return { kind: 'frame', frame, cursor: null, settled: true };
      },
    };
    const r = await runner(root, l.launcher, standIns(), framesDeps(driver)).run('priv', GOOD, 'frames', part);
    expect(seen).toContain('priv');
    expect(r.detail).toBeNull();
    const f = r.frames!.frame;
    expect(f.outcome).toBe('drawn');
    // The box's string, the capture's directory, its tmux directory and the stand-in's address are each replaced by rule 3;
    // another loopback port is no private of this capture.
    expect(f.replaced).toEqual({ cwd: 4, path: 0, model: 0, account: 0 });
    for (const bad of ['box-private-name', capturePaths(root, 'priv', GOOD, root).dir, capturePaths(root, 'priv', GOOD, root).tmux, '127.0.0.1:4567']) expect(f.text).not.toContain(bad);
    expect(f.text).toContain('127.0.0.1:9999');
  }, LONG);

  it('a driver fault answers no result and the directories still go', async () => {
    const root = freshRoot();
    const l = fakeLauncher();
    const s = standIns();
    const r = await runner(root, l.launcher, s, framesDeps({ step: async () => ({ kind: 'fault', detail: 'the driver could not start' }) })).run('fault', GOOD, 'frames', partOf('queued@220x50'));
    expect(r).toMatchObject({ result: null, frames: null, detail: expect.stringMatching(/a fault of the box, not a result/) });
    expect(s.released()).toBe(1);
    expect(gone(root, 'fault')).toBe(true);
  }, LONG);

  it('a launcher that cannot start answers no result and a detail', async () => {
    const root = freshRoot();
    const r = await runner(root, { start: async () => { throw new Error('no tmux'); } }, standIns(), framesDeps(typingDriver)).run('nostart', GOOD, 'frames', 0);
    expect(r).toEqual({ result: null, frames: null, detail: 'the capture could not start: no tmux' });
    expect(gone(root, 'nostart')).toBe(true);
  }, LONG);
});
