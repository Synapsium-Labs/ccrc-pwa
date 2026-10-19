import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');
const T = Date.parse('2026-10-14T12:00:00Z') / 1000;
const U1 = 'deadbeef-0000-4000-8000-000000000001';
const U2 = 'deadbeef-0000-4000-8000-000000000002';
let h: CcdHarness;
type Reading = {
  transcripts?: 'absent'; reading?: 'measured' | 'partial';
  killed_background_tasks?: number; transcript_uuids_with_kills?: number;
  transcripts_read?: number; unreadable_transcripts?: number;
  malformed_rows?: number; unmeasured_notifications?: number;
};
beforeEach(() => {
  h = makeCcdHarness('ccrc-measure-pressure-');
  fs.writeFileSync(path.join(h.home, 'journal.json'), '');
  fs.mkdirSync(path.join(h.home, 'xdg'));
});
afterEach(() => { h.cleanup(); });
const iso = (t: number): string => new Date(t * 1000).toISOString();
const escapeText = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const note = (task: string, status = 'killed', reason = 'stopped because the system is running low on memory'): string =>
  `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>toolu_fixture</tool-use-id>\n<output-file>/tmp/fixture.output</output-file>\n<status>${status}</status>\n<summary>${escapeText(`Background command "watch <x> & y" was ${reason}`)}</summary>\n<note>Fixture explanation; the scanner does not parse this wording.</note>\n</task-notification>`;
// Event-style envelope: one task id, an event element, a summary and NO status element.
const eventNote = (task: string, events: string[] = ['fixture stream line']): string =>
  `<task-notification>\n<task-id>${task}</task-id>\n<summary>${escapeText('Monitor "watch <x> & y" reported an event')}</summary>\n${events.map((e) => `<event>${escapeText(e)}</event>`).join('\n')}\n</task-notification>`;
// Batched envelope: several task ids, ONE status.
const PRESSURE = 'Background command "watch <x> & y" was stopped because the system is running low on memory';
const WORKFLOW = 'Background workflow "ship <it>" (run wf_abc123) didn\'t finish before the previous session ended';
const batched = (status: string, tasks: string[], summary: string = WORKFLOW): string =>
  `<task-notification>\n${tasks.map((t) => `<task-id>${t}</task-id>`).join('\n')}\n<status>${status}</status>\n<summary>${escapeText(summary)}</summary>\n</task-notification>`;
const reminder = (text = 'Fixture reminder; the scanner never reads it.'): string => `<system-reminder>\n${text}\n</system-reminder>`;
const row = (text: string, t: number = T): string => JSON.stringify({
  type: 'user', timestamp: iso(t), message: { role: 'user', content: text },
});
const transcript = (uuid: string, lines: string[], root = '.claude', project = '-project-a'): string => {
  const dir = path.join(h.home, root, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  // Discovery uses mtime before row timestamps; do not depend on the runner's clock.
  fs.utimesSync(file, T + 86400, T + 86400);
  return file;
};
const read = (extra: string[] = []): Reading => {
  const out = execFileSync('python3', ['-I', TOOL, '--home', h.home, '--stage', '6',
    '--journal', path.join(h.home, 'journal.json'), '--json', ...extra], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...inheritedEnv(), HOME: h.home, TZ: 'UTC', XDG_RUNTIME_DIR: path.join(h.home, 'xdg') },
  });
  const result = JSON.parse(out) as { stage6: { direct_pressure_kills?: Reading; reap_class_oom: unknown; inert_scopes: unknown } };
  expect(result.stage6.reap_class_oom).toBeDefined();
  expect(result.stage6.inert_scopes).toBeDefined();
  expect(result.stage6.direct_pressure_kills, 'the direct metric is composed into stage 6').toBeDefined();
  return result.stage6.direct_pressure_kills!;
};
const clean = (kills: number, uuids: number, files: number): Reading => ({
  reading: 'measured', killed_background_tasks: kills, transcript_uuids_with_kills: uuids,
  transcripts_read: files, unreadable_transcripts: 0, malformed_rows: 0, unmeasured_notifications: 0,
});

describe('direct background-shell pressure kills, not pane-scope OOM stops', () => {
  it('recognises the verified killed-summary shape, not ordinary completion or an operator stop', () => {
    transcript(U1, [row(note('b1')), row(note('b2', 'completed', 'completed')),
      row(note('b3', 'killed', 'stopped'))]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it.each([false, true])('deduplicates UUID/task pairs across repeated notifications and copies (all=%s)', (all) => {
    transcript(U1, [row(note('same')), row(note('same')), row(note('other'))]);
    transcript(U1, [row(note('same'))], '.claude-copy', '-project-b');
    transcript(U2, [row(note('same'))]);
    expect(read(all ? ['--all-copies'] : [])).toEqual(clean(3, 2, all ? 3 : 2));
  });

  it('the existing largest-copy trade is visible; all-copies recovers a divergent shorter copy', () => {
    transcript(U1, [row('x'.repeat(2000))]);
    transcript(U1, [row(note('only-shorter'))], '.claude-copy', '-project-b');
    expect(read()).toEqual(clean(0, 0, 1));
    expect(read(['--all-copies'])).toEqual(clean(1, 1, 2));
  });

  it('since is inclusive, until exclusive; a task started earlier can be killed in the window', () => {
    transcript(U1, [row(note('before'), T - 1), row(note('edge'), T),
      row(note('inside'), T + 1), row(note('until'), T + 86400)]);
    expect(read(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00']))
      .toEqual(clean(2, 1, 1));
  });

  it('ignores quoted prose, assistant text and tool-result text; string/text user content both work', () => {
    const text = note('quoted');
    transcript(U1, [row(`An example, not a notification: ${text}`),
      JSON.stringify({ type: 'assistant', timestamp: iso(T), message: { role: 'assistant', content: [{ type: 'text', text }] } }),
      JSON.stringify({ type: 'user', timestamp: iso(T), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: text }] } }),
      JSON.stringify({ type: 'user', timestamp: iso(T), message: { role: 'user', content: [{ type: 'text', text: note('real') }] } })]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it('JSON escaping is decoded before classification; metadata is not a guessed applicability gate', () => {
    const json = row(note('escaped')).replaceAll('<', '\\u003c');
    transcript(U1, [json, JSON.stringify({ type: 'user', isMeta: true, timestamp: iso(T),
      message: { role: 'user', content: note('meta') } })]);
    expect(read()).toEqual(clean(2, 1, 1));
  });

  it('a low-memory phrase in a note or description is not the verified summary suffix', () => {
    transcript(U1, [row(note('not-pressure', 'killed', 'stopped')
      .replace('Fixture explanation;', 'stopped because the system is running low on memory;')),
      row(note('not-killed', 'completed')),
      row(note('described', 'killed', 'stopped').replace('watch &lt;x&gt; &amp; y',
        'stopped because the system is running low on memory'))]);
    expect(read()).toEqual(clean(0, 0, 1));
  });

  it('a well-formed stopped workflow notification is a known non-pressure status, so the reading stays measured', () => {
    const stopped = '<task-notification>\n<task-id>wf1</task-id>\n<status>stopped</status>\n<summary>'
      + escapeText('Background workflow "ship <it>" (run wf_abc123) didn\'t finish before the previous session ended')
      + '</summary>\n</task-notification>';
    transcript(U1, [row(stopped), row(note('real'))]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it('an unknown status other than the known non-pressure ones stays unmeasured', () => {
    transcript(U1, [row(note('odd', 'exploded')), row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unmeasured_notifications: 1 });
  });

  it('no discovered transcripts is absent, not a clean zero', () => {
    expect(read()).toEqual({ transcripts: 'absent' });
  });

  it('a discovered file that cannot be opened is partial, with the readable count still explicit', () => {
    transcript(U1, [row(note('good'))]);
    const dir = path.join(h.home, '.claude', 'projects', '-project-a', `${U2}.jsonl`);
    fs.mkdirSync(dir); // EISDIR is deterministic even as root; chmod is not.
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unreadable_transcripts: 1 });
  });

  it('malformed JSON, missing timestamp and ambiguous notification fields remain unmeasured', () => {
    const noTime = JSON.stringify({ type: 'user', message: { role: 'user', content: note('no-time') } });
    transcript(U1, ['not-json', noTime, row(note('duplicate').replace('<status>killed</status>',
      '<status>killed</status>\n<status>completed</status>')), row(note('good'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1, unmeasured_notifications: 2 });
  });
});

describe('well-formed notifications that are not pressure kills read as non-events (D-4322)', () => {
  it('shape (a): a single-task event envelope with no status is a known non-event', () => {
    transcript(U1, [row(eventNote('ev1')), row(eventNote('ev2', ['two\nlines with x < y'])),
      row(eventNote('ev3').replace('fixture stream line', 'raw <b> and </b> text'))]);
    expect(read()).toEqual(clean(0, 0, 1));
  });

  it('shape (b): whole trailing system-reminder blocks after the closing tag do not spoil the envelope', () => {
    transcript(U1, [row(`${eventNote('ev1')}\n\n${reminder()}`),
      row(`${eventNote('ev2')}\n${reminder('first')}\n\n${reminder('second')}\n`),
      row(`${note('done', 'completed', 'completed')}\n${reminder()}`)]);
    expect(read()).toEqual(clean(0, 0, 1));
  });

  it('shape (c): a batched envelope with one known non-killed status is a known non-event', () => {
    transcript(U1, [row(batched('stopped', ['b1', 'b2'])), row(batched('completed', ['b3', 'b4', 'b5']))]);
    expect(read()).toEqual(clean(0, 0, 1));
  });

  it('the kill rule is unchanged: a verified single-task killed envelope with trailing reminders is exactly one kill', () => {
    transcript(U1, [row(`${note('k1')}\n\n${reminder()}\n${reminder('again')}`)]);
    expect(read()).toEqual(clean(1, 1, 1));
  });

  it('a batched killed envelope is unmeasured, never a kill (the kill rule is still exactly one task id)', () => {
    transcript(U1, [row(batched('killed', ['k1', 'k2'], PRESSURE)), row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unmeasured_notifications: 1 });
  });

  it.each([
    ['two event elements', eventNote('ev1', ['one', 'two'])],
    ['an event element and a status that is not a known non-killed one', eventNote('ev1').replace('<summary>', '<status>exploded</status>\n<summary>')],
    ['an event element, a task id twice and no status', eventNote('ev1').replace('<summary>', '<task-id>ev2</task-id>\n<summary>')],
    ['no task id', eventNote('ev1').replace('<task-id>ev1</task-id>\n', '')],
    ['an event element that is never closed', eventNote('ev1').replace('</event>', '')],
    ['no event element and no status', eventNote('ev1').replace(/<event>.*<\/event>\n/, '')],
    ['two statuses', batched('stopped', ['b1', 'b2']).replace('<summary>', '<status>completed</status>\n<summary>')],
  ])('stays unmeasured: %s', (_name, text) => {
    transcript(U1, [row(text), row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unmeasured_notifications: 1 });
  });

  it.each([
    ['plain text', `${eventNote('ev1')}\nthis is not a reminder`],
    ['a reminder with text after it', `${eventNote('ev1')}\n${reminder()} and more`],
    ['an unterminated reminder', `${eventNote('ev1')}\n<system-reminder>\nnever closed`],
    ['text between two reminders', `${eventNote('ev1')}\n${reminder('first')}\nbetween\n${reminder('second')}`],
  ])('trailing text that is not a whole system-reminder block fails the envelope: %s', (_name, text) => {
    transcript(U1, [row(text)]);
    expect(read()).toEqual({ ...clean(0, 0, 1), reading: 'partial', unmeasured_notifications: 1 });
  });
});

describe('the scanner pins its own branches (D-4322 minors)', () => {
  it('the window check runs before the envelope check: an out-of-window malformed envelope is no unmeasured count, an in-window one is', () => {
    const malformed = '<task-notification>\n<task-id>never-closed</task-id>';
    transcript(U1, [row(malformed, T - 100), row(malformed, T + 86400), row(note('inside'), T + 1)]);
    expect(read(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00'])).toEqual(clean(1, 1, 1));
    transcript(U2, [row(malformed, T + 1)]);
    expect(read(['--since', '2026-10-14 12:00:00', '--until', '2026-10-15 12:00:00']))
      .toEqual({ ...clean(1, 1, 2), reading: 'partial', unmeasured_notifications: 1 });
  });

  it.each([
    ['no summary element', note('k1').replace(/<summary>.*<\/summary>\n/, '')],
    ['two summary elements, the first the verified pressure reason', note('k1').replace('</summary>', `</summary>\n<summary>${escapeText('Background command "z" was stopped')}</summary>`)],
    ['two summary elements, both the verified pressure reason', note('k1').replace('</summary>', `</summary>\n<summary>${escapeText(PRESSURE)}</summary>`)],
  ])('a killed envelope with %s is unmeasured, never an IndexError and never the first summary winning', (_name, text) => {
    transcript(U1, [row(text), row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', unmeasured_notifications: 1 });
  });

  it.each([
    ['an object', { at: iso(T) }],
    ['a number', 1760443200],
    ['an array', [iso(T)]],
    ['a boolean', true],
  ])('a notification row whose timestamp is %s is a malformed row, not a crash of the instrument', (_name, stamp) => {
    const odd = JSON.stringify({ type: 'user', timestamp: stamp, message: { role: 'user', content: note('odd-time') } });
    transcript(U1, [odd, row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1 });
  });

  it('one row carrying two notification texts and an unreadable timestamp is one malformed row', () => {
    const odd = JSON.stringify({ type: 'user', timestamp: { at: 1 }, message: { role: 'user',
      content: [{ type: 'text', text: note('a') }, { type: 'text', text: note('b') }] } });
    transcript(U1, [odd, row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1 });
  });

  it('a JSON line nested deep enough to raise RecursionError is a malformed row, not a crash of the instrument', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(100_000);
    transcript(U1, [deep, row(note('real'))]);
    expect(read()).toEqual({ ...clean(1, 1, 1), reading: 'partial', malformed_rows: 1 });
  });

  // A real file cannot be made to fail MID-read from a fixture HOME (EISDIR and chmod fail at open; the
  // loop reads bytes, so it has no decode failure). The instrument opens a transcript with the builtin
  // `open` looked up in its own module, so this harness imports the module and shadows that one name with
  // a reader that yields real lines of the fixture file and then raises EIO. No instrument change.
  const TORN = [
    'import importlib.util, json, sys',
    'tool, home, torn, keep = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])',
    'spec = importlib.util.spec_from_file_location("measure_continuity", tool)',
    'mc = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mc)',
    'real_open = open',
    'class Torn:',
    '    def __init__(self, fh): self.fh = fh',
    '    def __enter__(self): return self',
    '    def __exit__(self, *exc):',
    '        self.fh.close()',
    '        return False',
    '    def __iter__(self):',
    '        for n, raw in enumerate(self.fh):',
    '            if n >= keep: raise OSError(5, "Input/output error")',
    '            yield raw',
    'def fake_open(path, *args, **kw):',
    '    fh = real_open(path, *args, **kw)',
    '    return Torn(fh) if str(path).endswith(torn + ".jsonl") else fh',
    'mc.open = fake_open',
    'print(json.dumps(mc.s6_pressure_kills({"home": home, "since": None, "until": None, "all_copies": False})))',
  ].join('\n');
  const readTorn = (uuid: string, keep: number): Reading => JSON.parse(execFileSync('python3',
    ['-I', '-c', TORN, TOOL, h.home, uuid, String(keep)], {
      encoding: 'utf8', timeout: 30_000, env: { ...inheritedEnv(), HOME: h.home, TZ: 'UTC' },
    })) as Reading;

  it('hits from a file are admitted only after it reads to its end: a read that fails mid-file admits none of them', () => {
    transcript(U1, [row(note('lost-1')), row(note('lost-2')), row(note('lost-3'))]);
    transcript(U2, [row(note('kept'))]);
    expect(readTorn(U1, 2)).toEqual({ ...clean(1, 1, 1), reading: 'partial', unreadable_transcripts: 1 });
  });

  it('the torn-read harness reads a whole file when it does not tear (control)', () => {
    transcript(U1, [row(note('one')), row(note('two'))]);
    transcript(U2, [row(note('kept'))]);
    expect(readTorn(U1, 99)).toEqual(clean(3, 2, 2));
  });
});
