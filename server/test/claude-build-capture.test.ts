// The build capture runner's replay suite (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3):
// `shared/claudeBuildCapture.ts#replayCapture` checks a recording against the grammar tables and answers the verdict the
// record stores. A passing recording is built here from the tables' own required fields, then broken one rule at a time.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_EVENTS, HOOK_COMMON_RULES, HOOK_EVENT_RULES, STATUSLINE_RULES, STATUS_FILE_RULES, readCaptureRecords, replayCapture,
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
const goodRecords = (): CaptureRecord[] => [...CAPTURE_EVENTS.map((e) => hook(e, e === 'PermissionRequest' ? { cwd: CD } : {})), statusline()];
const rec = (records: readonly CaptureRecord[], over: Partial<CaptureRecording> = {}): CaptureRecording => ({ records, unreadable: 0, cdDir: CD, finished: true, ...over });
const outputOf = (r: ReturnType<typeof replayCapture>): string[] => r.output.split('\n');

describe('replayCapture: a full recording', () => {
  it('passes, and proves the cwd fact', () => {
    const r = replayCapture(rec(goodRecords()), BUILD);
    expect(r).toMatchObject({ build: BUILD, pass: true, cwd: true });
    expect(outputOf(r).at(-1)).toBe(`verdict: pass (${goodRecords().length} records)`);
  });
  it('a PermissionRequest cwd that is not the drive\'s cd directory: still a pass, the cwd not proved', () => {
    const records = goodRecords().map((r) => (r.kind === 'hook' && r.event === 'PermissionRequest' ? hook('PermissionRequest', { cwd: '/elsewhere' }) : r));
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
