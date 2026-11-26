// The one driver's box frames form (`server/src/inject/deliveryDrive.ts`, Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 4.2): its input refusals before any tmux call, every step's
// keys (the product's own, or the recipe's two named shapes), the frame read and its cursor, the halt at the first call
// that could not complete, and the answer line. Driven by a fake Runner: no tmux, no Claude Code.
import { describe, expect, it } from 'vitest';
import { captureTmuxDirName } from '../../shared/claudeBuildCapture.js';
import { FRAMES_PERSON, FRAMES_TURN_ONE, framesDraftLines, framesStepWord, readFramesStepWord } from '../../shared/framesCapture.js';
import { FRAMES_PARTS, framesPartOfId } from '../../shared/framesResult.js';
import { renderMailNudge } from '../src/coord/envelope.js';
import { DRIVE_FAULT_EXIT, driveFramesStep, framesDriveAnswer, readFramesDriveInput, type FramesDriveInput } from '../src/inject/deliveryDrive.js';
import type { Runner } from '../src/exec.js';

const ID = '0123456789abcdef0123456789abcdef';
const CAPTURE = `/box/captures/${ID}`;
const BASE = '/tmp';
const TMUX = `${BASE}/${captureTmuxDirName(ID)}`;
const allDirs = (): boolean => true;
const part = (id: string): number => framesPartOfId(id)!;

const RULE = '─'.repeat(40);
const EMPTY = [RULE, '❯ ', RULE].join('\n') + '\n';

/** A fake tmux: records each call, answers capture-pane with `pane()` and the cursor with `3 7`. */
function fakeRunner(pane: () => string = () => EMPTY, failOn?: (args: readonly string[]) => boolean): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (failOn?.(args)) return { ran: false, reason: 'timeout', detail: 'tmux did not answer', code: 1, stdout: '', stderr: '' };
    if (args.includes('capture-pane')) return { ran: true, code: 0, stdout: pane(), stderr: '', killed: false, signal: null };
    if (args.includes('display-message')) return { ran: true, code: 0, stdout: '3 7\n', stderr: '', killed: false, signal: null };
    return { ran: true, code: 0, stdout: '', stderr: '', killed: false, signal: null };
  };
  return { run, calls };
}
const keys = (calls: string[][]): string[] => calls.filter((c) => c.includes('send-keys')).map((c) => (c.includes('-l') ? `lit:${c[c.length - 1]}` : `key:${c[c.length - 1]}`));
const input = (w: string): FramesDriveInput => ({ capture: CAPTURE, tmux: TMUX, step: readFramesStepWord(w)! });
const noSleep = async (): Promise<void> => {};

describe('readFramesDriveInput: refused before any tmux call', () => {
  const ok = { capture: CAPTURE, tmux: TMUX, frames: 'frame' };
  it('takes the capture\'s directories and a step word', () => {
    expect(readFramesDriveInput(ok, allDirs, BASE, allDirs)).toEqual({ ok: true, input: { capture: CAPTURE, tmux: TMUX, step: { kind: 'frame' } } });
  });
  it.each<[string, unknown, string]>([
    ['a field it does not name', { ...ok, text: 'x' }, 'bad-input'],
    ['the case form\'s key beside it', { ...ok, case: 'c0' }, 'bad-input'],
    ['free text as the step', { ...ok, frames: 'type:echo hi' }, 'step'],
    ['a part not on the list', { ...ok, frames: 'type:rows-25@220x30' }, 'step'],
    ['a turn past two', { ...ok, frames: 'turn:3' }, 'step'],
    ['another capture\'s tmux directory', { ...ok, tmux: `/tmp/${captureTmuxDirName('f'.repeat(32))}` }, 'tmux-dir'],
    ['a scratch directory outside captures/', { ...ok, capture: `/box/runs/${ID}` }, 'capture-dir'],
  ])('refuses %s', (_why, raw, refusal) => {
    expect(readFramesDriveInput(raw, allDirs, BASE, allDirs)).toMatchObject({ ok: false, refusal });
  });
  it('the step grammar reads back every word it writes', () => {
    for (const [i] of FRAMES_PARTS.entries()) for (const s of [{ kind: 'type', part: i }, { kind: 'person', part: i }] as const) {
      expect(readFramesStepWord(framesStepWord(s))).toEqual(s);
    }
  });
});

describe('the steps\' keys', () => {
  it('type: the send\'s own line loop, each line one literal, M-Enter between, no Enter', async () => {
    const { run, calls } = fakeRunner();
    const p = part('rows-3@220x50');
    expect(await driveFramesStep(input(`type:rows-3@220x50`), run, noSleep)).toEqual({ kind: 'typed', typed: true });
    const lines = framesDraftLines(FRAMES_PARTS[p]!.case, FRAMES_PARTS[p]!.pane);
    expect(keys(calls)).toEqual([`lit:${lines[0]}`, 'key:M-Enter', `lit:${lines[1]}`, 'key:M-Enter', `lit:${lines[2]}`]);
  });
  it('the cap draft is built at the part\'s own pane: 20 rows at 50, 15 at 40', async () => {
    for (const [id, n] of [['cap@220x50', 20], ['cap@220x40', 15]] as const) {
      const { run, calls } = fakeRunner();
      await driveFramesStep(input(`type:${id}`), run, noSleep);
      expect(keys(calls).filter((k) => k.startsWith('lit:'))).toHaveLength(n);
    }
  });
  it('person: plain bursts of eight characters and the Enter-free newline, never M-Enter and never Enter', async () => {
    const { run, calls } = fakeRunner();
    await driveFramesStep(input('person:person@220x50'), run, noSleep);
    const k = keys(calls);
    expect(k.filter((x) => x === `key:${FRAMES_PERSON.newline}`)).toHaveLength(179);
    expect(k.some((x) => x === 'key:M-Enter' || x === 'key:Enter')).toBe(false);
    expect(k.filter((x) => x.startsWith('lit:')).every((x) => x.length - 4 <= FRAMES_PERSON.burst)).toBe(true);
    expect(k.filter((x) => x.startsWith('lit:')).map((x) => x.slice(4)).join('')).toBe(framesDraftLines('person', FRAMES_PARTS[0]!.pane).join(''));
  });
  it('keys: Up three times; then PageUp once', async () => {
    const a = fakeRunner(); await driveFramesStep(input('keys:up-3@220x50'), a.run, noSleep);
    expect(keys(a.calls)).toEqual(['key:Up', 'key:Up', 'key:Up']);
    const b = fakeRunner(); await driveFramesStep(input('keys:up-3-pageup@220x40'), b.run, noSleep);
    expect(keys(b.calls)).toEqual(['key:Up', 'key:Up', 'key:Up', 'key:PageUp']);
  });
  it('stash: the send\'s own stash key, once', async () => {
    const { run, calls } = fakeRunner();
    expect(await driveFramesStep(input('stash'), run, noSleep)).toEqual({ kind: 'typed', typed: true });
    expect(keys(calls)).toEqual(['key:C-s']);
  });
  it('turn 1 sends the short turn and turn 2 the product\'s own mail notice, through the send', async () => {
    const a = fakeRunner(); await driveFramesStep(input('turn:1'), a.run, noSleep);
    expect(keys(a.calls)[0]).toBe(`lit:${FRAMES_TURN_ONE}`);
    const b = fakeRunner(); await driveFramesStep(input('turn:2'), b.run, noSleep);
    expect(keys(b.calls)[0]).toBe(`lit:${renderMailNudge('lane-a-project-a')}`);
  });
});

describe('the frame', () => {
  it('reads until two reads agree, with the cursor', async () => {
    const panes = ['a\n', 'b\n', 'b\n'];
    let i = 0;
    const { run } = fakeRunner(() => panes[Math.min(i++, panes.length - 1)]!);
    expect(await driveFramesStep(input('frame'), run, noSleep)).toEqual({ kind: 'frame', frame: 'b\n', cursor: [3, 7], settled: true });
  });
  it('a frame that never settles within the bound is kept, marked unsettled', async () => {
    let i = 0;
    let t = 0;
    const { run } = fakeRunner(() => `${i++}\n`);
    const out = await driveFramesStep(input('frame'), run, async () => { t += 500; }, () => t);
    expect(out).toMatchObject({ kind: 'frame', settled: false });
  });
});

describe('a fault of the box', () => {
  it('a call that could not complete halts the step: no later key, and a fault answered on the fault exit', async () => {
    let n = 0;
    const { run, calls } = fakeRunner(undefined, (args) => args.includes('-l') && ++n === 2);
    const out = await driveFramesStep(input('type:rows-3@220x50'), run, noSleep);
    expect(out.kind).toBe('fault');
    expect(keys(calls).filter((k) => k.startsWith('lit:'))).toHaveLength(2);
    expect(framesDriveAnswer(out).code).toBe(DRIVE_FAULT_EXIT);
  });
  it('the answer lines', () => {
    expect(framesDriveAnswer({ kind: 'sent', send: 'ok' })).toEqual({ code: 0, line: '{"send":"ok"}' });
    expect(framesDriveAnswer({ kind: 'typed', typed: false })).toEqual({ code: 0, line: '{"typed":false}' });
    expect(JSON.parse(framesDriveAnswer({ kind: 'frame', frame: 'x\n', cursor: null, settled: true }).line)).toEqual({ frame: 'x\n', cursor: null, settled: true });
  });
});
