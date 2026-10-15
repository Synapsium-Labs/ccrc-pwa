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
