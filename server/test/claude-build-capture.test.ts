// The build capture runner's replay suite (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3):
// `shared/claudeBuildCapture.ts#replayCapture` checks a recording against the grammar tables and answers the verdict the
// record stores. A passing recording is built here from the tables' own required fields, then broken one rule at a time.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_EVENTS, CAPTURE_WRITE_COMMAND, HOOK_COMMON_RULES, HOOK_EVENT_RULES, STATUSLINE_RULES, STATUS_FILE_RULES, readCaptureRecords, replayCapture,
  type CaptureFieldRule, type CaptureRecord, type CaptureRecording,
} from '../../shared/claudeBuildCapture.js';
import { BUILD_CAPTURE_OUTPUT_MAX } from '../../shared/claudeBuildTrust.js';
import { isHookEvent } from '../../shared/hook-events.js';

const BUILD = '2.1.320';
const CD = '/scratch/capture/work/sub';

/** A sample value of each kind a rule names. */
const SAMPLE: Record<CaptureFieldRule['type'], unknown> = { string: 's', number: 1, boolean: true, object: {}, present: 'x' };
/** An object built from the required rules (dotted paths nest), so it is exactly what the grammar needs and no more. */
function built(rules: readonly CaptureFieldRule[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const r of rules.filter((x) => x.required)) {
    const parts = r.path.split('.');
    let cur = o;
    parts.slice(0, -1).forEach((k) => { const n = cur[k]; cur = (typeof n === 'object' && n !== null ? n : (cur[k] = {})) as Record<string, unknown>; });
    const last = parts[parts.length - 1]!;
    if (!(last in cur)) cur[last] = SAMPLE[r.type];
  }
  return o;
}
const status = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...built(STATUS_FILE_RULES), version: BUILD, ...over });
const hook = (event: string, over: Record<string, unknown> = {}): CaptureRecord => ({
  kind: 'hook', event, payload: { ...built([...HOOK_COMMON_RULES, ...(isHookEvent(event) ? HOOK_EVENT_RULES[event] : [])]), hook_event_name: event, ...over }, status: status(),
});
const statusline = (): CaptureRecord => ({ kind: 'statusline', payload: built(STATUSLINE_RULES), status: status() });
/** The drive's write, as the build's tool call carries it (spec Table 1, step 2). */
const WRITE = { tool_name: 'Bash', tool_input: { command: CAPTURE_WRITE_COMMAND } };
/** The write's permission prompt, as the recorder records it: raised in the `cd` directory, answered `allow`. */
const writeAsked = (over: Record<string, unknown> = {}, answer: string | null = 'allow'): CaptureRecord =>
  ({ ...hook('PermissionRequest', { ...WRITE, cwd: CD, ...over }), ...(answer === null ? {} : { answer }) });
/** Every event once, in the drive's order (the write's prompt before its PostToolUse), and one statusline. */
const goodRecords = (): CaptureRecord[] => [
  ...CAPTURE_EVENTS.filter((e) => e !== 'PostToolUse').flatMap((e) => (e === 'PermissionRequest' ? [writeAsked(), hook('PostToolUse', WRITE)] : [hook(e)])),
  statusline(),
];
const rec = (records: readonly CaptureRecord[], over: Partial<CaptureRecording> = {}): CaptureRecording => ({ records, unreadable: 0, cdDir: CD, finished: true, ...over });
const outputOf = (r: ReturnType<typeof replayCapture>): string[] => r.output.split('\n');

describe('replayCapture: a full recording', () => {
  it('passes, and proves the cwd fact', () => {
    const r = replayCapture(rec(goodRecords()), BUILD);
    expect(r).toMatchObject({ build: BUILD, pass: true, cwd: true });
    expect(outputOf(r).at(-1)).toBe(`verdict: pass (${goodRecords().length} records)`);
  });
  it('a PermissionRequest cwd that is not the drive\'s cd directory: still a pass, the cwd not proved', () => {
    const records = goodRecords().map((r) => (r.kind === 'hook' && r.event === 'PermissionRequest' ? writeAsked({ cwd: '/elsewhere' }) : r));
    const r = replayCapture(rec(records), BUILD);
    expect(r).toMatchObject({ pass: true, cwd: false });
    expect(r.output).toContain('cwd: not proved');
  });
  it('optional fields of the right kind are allowed, and of the wrong kind are named', () => {
    const ok = goodRecords().map((r) => (r.kind === 'hook' && r.event === 'SessionEnd' ? hook('SessionEnd', { reason: 'exit' }) : r));
    expect(replayCapture(rec(ok), BUILD).pass).toBe(true);
    const bad = goodRecords().map((r) => (r.kind === 'hook' && r.event === 'SessionEnd' ? hook('SessionEnd', { reason: 4 }) : r));
    const r = replayCapture(rec(bad), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('SessionEnd: reason: not a string');
  });
});

describe('replayCapture: the cwd fact is the write\'s own prompt (review 3226 F5)', () => {
  const withPrompts = (...prompts: CaptureRecord[]): CaptureRecord[] =>
    goodRecords().flatMap((r) => (r.kind === 'hook' && r.event === 'PermissionRequest' ? prompts : [r]));
  it('the cd\'s prompt naming the cd directory does not prove it when the write\'s prompt names another', () => {
    const cdAsked = hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'cd sub' }, cwd: CD });
    const r = replayCapture(rec(withPrompts(cdAsked, writeAsked({ cwd: '/scratch/capture/work' }))), BUILD);
    expect(r).toMatchObject({ pass: true, cwd: false });
  });
  it('a prompt of another tool naming the cd directory does not prove it', () => {
    const r = replayCapture(rec(withPrompts(writeAsked({ cwd: '/elsewhere' }), hook('PermissionRequest', { tool_name: 'Write', tool_input: { command: CAPTURE_WRITE_COMMAND }, cwd: CD }))), BUILD);
    expect(r).toMatchObject({ pass: true, cwd: false });
  });
  it('the write\'s prompt naming the cd directory proves it, whatever other prompts say', () => {
    const cdAsked = hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'cd sub' }, cwd: '/scratch/capture/work' });
    expect(replayCapture(rec(withPrompts(cdAsked, writeAsked())), BUILD)).toMatchObject({ pass: true, cwd: true });
  });
});

describe('replayCapture: the build ran the write after the hook answered allow (spec §2.6, review 3226 F7)', () => {
  const swap = (event: string, to: CaptureRecord | null): CaptureRecord[] =>
    goodRecords().flatMap((r) => (r.kind === 'hook' && r.event === event ? (to === null ? [] : [to]) : [r]));
  it('the write raised no permission prompt (only another command did): fail naming it', () => {
    const r = replayCapture(rec(swap('PermissionRequest', hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'cd sub' }, cwd: CD }))), BUILD);
    expect(r).toMatchObject({ pass: false, cwd: false });
    expect(r.output).toContain('approval: the write raised no permission prompt');
  });
  it('the write\'s prompt carries no recorded answer: fail naming it', () => {
    const r = replayCapture(rec(swap('PermissionRequest', writeAsked({}, null))), BUILD);
    expect(r).toMatchObject({ pass: false, cwd: false });
    expect(r.output).toContain('approval: the hook\'s allow answer to the write\'s prompt was not recorded');
  });
  it('an answer other than allow: fail', () => {
    const r = replayCapture(rec(swap('PermissionRequest', writeAsked({}, 'deny'))), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('approval: the hook\'s allow answer to the write\'s prompt was not recorded');
  });
  it('the only PostToolUse is of another command: fail, the write never ran', () => {
    const r = replayCapture(rec(swap('PostToolUse', hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'cd sub' } }))), BUILD);
    expect(r).toMatchObject({ pass: false, cwd: false });
    expect(r.output).toContain('approval: the write never ran after the hook answered allow');
  });
  it('the write\'s PostToolUse recorded BEFORE its prompt does not count: fail', () => {
    const good = goodRecords();
    const asked = good.findIndex((r) => r.kind === 'hook' && r.event === 'PermissionRequest');
    const ran = good.findIndex((r) => r.kind === 'hook' && r.event === 'PostToolUse');
    const records = [...good];
    [records[asked], records[ran]] = [good[ran]!, good[asked]!];
    expect(ran).toBeGreaterThan(asked);
    const r = replayCapture(rec(records), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('approval: the write never ran after the hook answered allow');
  });
});

describe('replayCapture: what a pass needs', () => {
  it.each(CAPTURE_EVENTS.map((e) => [e]))('%s never recorded: fail naming it', (e) => {
    const r = replayCapture(rec(goodRecords().filter((x) => !(x.kind === 'hook' && x.event === e))), BUILD);
    expect(r).toMatchObject({ pass: false, cwd: false });
    expect(r.output).toContain(`event ${e}: never recorded`);
    expect(outputOf(r).at(-1)).toBe('verdict: fail');
  });

  const bad = (rule: CaptureFieldRule, how: 'missing' | 'mistyped'): { value: unknown; words: string } | null => {
    if (how === 'missing') return { value: undefined, words: `${rule.path}: missing` };
    if (rule.type === 'present') return null;
    const wrong = rule.type === 'string' ? 7 : 'x';
    return { value: wrong, words: `${rule.path}: not ${rule.type === 'object' ? 'an object' : `a ${rule.type}`}` };
  };
  const cases = [
    ...HOOK_COMMON_RULES.map((r) => ['*', r] as const),
    ...Object.entries(HOOK_EVENT_RULES).flatMap(([e, rs]) => rs.map((r) => [e, r] as const)),
  ].filter(([, r]) => r.required);
  for (const [ev, rule] of cases) {
    for (const how of ['missing', 'mistyped'] as const) {
      const b = bad(rule, how);
      if (b === null) continue;
      const events = ev === '*' ? ['SessionStart'] : [ev];
      for (const e of events) {
        it(`${e}: required ${rule.path} ${how}: fail naming it`, () => {
          const records = goodRecords().map((r) => {
            if (!(r.kind === 'hook' && r.event === e)) return r;
            const payload = { ...(r.payload as Record<string, unknown>) };
            if (b.value === undefined) delete payload[rule.path]; else payload[rule.path] = b.value;
            return { ...r, payload };
          });
          const r = replayCapture(rec(records), BUILD);
          expect(r.pass).toBe(false);
          // Mistyping hook_event_name is a type break AND a name mismatch; the type break is the one asserted.
          expect(r.output).toContain(b.words);
        });
      }
    }
  }
  it('a hook_event_name that names another event: fail', () => {
    const r = replayCapture(rec(goodRecords().map((x) => (x.kind === 'hook' && x.event === 'Stop' ? hook('Stop', { hook_event_name: 'SessionEnd' }) : x))), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('Stop: hook_event_name does not name Stop');
  });
  it('a nested required statusline field missing: fail naming its path', () => {
    const records = goodRecords().map((x) => (x.kind === 'statusline' ? { ...x, payload: { ...(x.payload as object), workspace: {} } } : x));
    expect(replayCapture(rec(records), BUILD).output).toContain('statusline: workspace.current_dir: missing');
  });
  it('a status file copy missing a required field: fail naming it', () => {
    const records = goodRecords().map((x) => (x.kind === 'statusline' ? { ...x, status: { ...status(), pid: 'x' } } : x));
    const r = replayCapture(rec(records), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('statusline status file: pid: not a number');
  });
  it('no statusline record: fail', () => {
    const r = replayCapture(rec(goodRecords().filter((x) => x.kind !== 'statusline')), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('statusline: never recorded');
  });
  it('no status file copy anywhere: fail', () => {
    const r = replayCapture(rec(goodRecords().map((x) => ({ ...x, status: null }))), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('status file: never recorded');
  });
  it('status copies naming another version only: fail naming the build', () => {
    const r = replayCapture(rec(goodRecords().map((x) => ({ ...x, status: status({ version: '2.1.319' }) }))), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain(`status file: no copy names version ${BUILD}`);
  });
  it('unreadable lines: fail, counted', () => {
    const r = replayCapture(rec(goodRecords(), { unreadable: 2 }), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('recording: 2 unreadable line(s)');
  });
  it('a drive that did not finish: fail', () => {
    const r = replayCapture(rec(goodRecords(), { finished: false }), BUILD);
    expect(r).toMatchObject({ pass: false, cwd: false });
    expect(r.output).toContain('drive: did not finish every step');
  });
  it('an event ccrc does not install: fail', () => {
    const r = replayCapture(rec([...goodRecords(), { kind: 'hook', event: 'Mystery', payload: {}, status: null }]), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toContain('Mystery: not an event ccrc installs');
  });
  it('an output over the bound keeps its tail, and the verdict line stays last', () => {
    const records = [...goodRecords(), ...Array.from({ length: 400 }, (_, i) => hook('Stop', { session_id: i }))];
    const r = replayCapture(rec(records), BUILD);
    expect(r.pass).toBe(false);
    expect(r.output).toHaveLength(BUILD_CAPTURE_OUTPUT_MAX);
    expect(outputOf(r).at(-1)).toBe('verdict: fail');
  });
});

describe('readCaptureRecords: the recording file\'s one reader', () => {
  const H = { kind: 'hook', event: 'Stop', payload: { a: 1 }, status: null };
  const S = { kind: 'statusline', payload: {}, status: { version: BUILD } };
  it('reads good lines and counts every bad one', () => {
    const text = [
      JSON.stringify(H), '', 'not json', '[1]', '"s"', JSON.stringify({ ...H, extra: 1 }), JSON.stringify({ kind: 'hook', payload: {}, status: null }),
      JSON.stringify({ kind: 'other', payload: {}, status: null }), JSON.stringify(S), JSON.stringify({ kind: 'hook', event: 4, payload: {}, status: null }),
    ].join('\n');
    expect(readCaptureRecords(text)).toEqual({ records: [H, S], unreadable: 7 });
  });
  it('a hook line may carry the recorder\'s answer (a string); any other answer, or one on a statusline, is not a record', () => {
    const A = { ...H, event: 'PermissionRequest', answer: 'allow' };
    const text = [JSON.stringify(A), JSON.stringify({ ...A, answer: 1 }), JSON.stringify({ ...S, answer: 'allow' })].join('\n');
    expect(readCaptureRecords(text)).toEqual({ records: [A], unreadable: 2 });
  });
  it('a line with no status key is not a record', () => {
    expect(readCaptureRecords(JSON.stringify({ kind: 'statusline', payload: {} }))).toEqual({ records: [], unreadable: 1 });
  });
  it('an empty file is no record and no bad line', () => { expect(readCaptureRecords('')).toEqual({ records: [], unreadable: 0 }); });
});

describe('the grammar names every hook event ccrc installs', () => {
  it('CAPTURE_EVENTS is install-session-hooks.sh\'s EVENTS_JSON plus PreToolUse, as sets', () => {
    const text = readFileSync(new URL('../../ccd/install-session-hooks.sh', import.meta.url), 'utf8');
    const m = /^EVENTS_JSON='(\[.*\])'$/m.exec(text);
    expect(m, 'the installer\'s EVENTS_JSON line').not.toBeNull();
    const installed = JSON.parse(m![1]!) as string[];
    expect([...new Set([...installed, 'PreToolUse'])].sort()).toEqual([...CAPTURE_EVENTS].sort());
    expect(Object.keys(HOOK_EVENT_RULES).sort()).toEqual([...CAPTURE_EVENTS].sort());
  });
});
