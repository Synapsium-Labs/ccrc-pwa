// `deploy/measure-continuity.py`'s stage-7 row (session-continuity spec §9;
// wave 3): restarts that revert an operator's `/model`. The instrument is
// READ-ONLY and reads swap.log, so two things are pinned, as for stage 4: the
// row counts what its name says on a hand-built log, and each regex is bound to
// a line the REAL `_operator_choice_keep` wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s7-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number>>;
const run = (extra: string[] = [], env: Record<string, string> = {}): Row => {
  const out = execFileSync('python3', [TOOL, '--home', h.home, '--stage', '7', ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  return (JSON.parse(out) as { stage7: { operator_choice: Row } }).stage7.operator_choice;
};

describe('stage 7 counts what its row says (TZ=UTC, hand-built log)', () => {
  it('a /model outside the vocabulary or refused is a revert; the writes, the /effort skips and the unmeasured stops are reported beside it', () => {
    const log = path.join(h.home, 'hand-built-swap.log');
    fs.writeFileSync(log, [
      '2026-10-05 10:00:00 route s1: class fable -> opus [actor=operator-session] (its own /model, kept across a restart)',
      '2026-10-05 10:01:00 route s2: effort ∅ -> high [actor=operator-session] (its own /effort, kept across a restart)',
      '2026-10-05 10:02:00 route s3: class <12 bytes, unrecognised> -> sonnet [actor=operator-session] (its own /model, kept across a restart)',
      '2026-10-05 10:03:00 route s4: class opus -> fable [actor=operator] (from the PWA)',                      // not this row's writer
      '2026-10-05 10:04:00 operator-choice s5: /model gpt-5.6-sol is outside the class vocabulary — the record is unchanged',
      '2026-10-05 10:05:00 operator-choice s6: /model sonnet refused by the route record\'s own checks — the record is unchanged',
      '2026-10-05 10:06:00 operator-choice s7: /effort high refused by the route record\'s own checks — the record is unchanged',
      '2026-10-05 10:07:00 operator-choice s9: unmeasured (its transcript is not a readable regular file)',
      '2026-10-04 09:00:00 operator-choice s8: /model (15 bytes, not one token) is outside the class vocabulary — the record is unchanged',   // before --since
      '2026-10-04 09:01:00 operator-choice s8: unmeasured (no python3)',                                        // before --since
    ].join('\n') + '\n');
    const r = run(['--swap-log', log, '--since', '2026-10-05'], { TZ: 'UTC' });
    expect(r.restarts_that_reverted_an_operator_model).toBe(2);
    expect(r.operator_choices_written_by_field).toEqual({ class: 2, effort: 1 });
    expect(r.operator_values_outside_the_vocabulary_by_kind).toEqual({ model: 1 });
    expect(r.operator_choices_refused_by_kind).toEqual({ effort: 1, model: 1 });
    expect(r.stops_that_could_not_read_the_transcript, 'reported, never folded into the revert row').toBe(1);
    expect(run(['--swap-log', path.join(h.home, 'nope.log')])).toEqual({ swap_log: 'absent' });
  });
});

describe('each regex is bound to the line the real _operator_choice_keep writes', () => {
  const ID = 'claude-demo';
  const at = Math.floor(Date.now() / 1000) - 600;
  const transcript = (name: string, args: string, ackText: string): void => {
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const row = (content: string, u: string): string => JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', uuid: u,
      timestamp: new Date(at * 1000).toISOString(), message: { role: 'user', content } });
    fs.writeFileSync(p, [row(`<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`, 'c'),
      row(`<local-command-stdout>${ackText}</local-command-stdout>`, 'k')].join('\n') + '\n');
  };
  const field = (f: string, v: string): void => {
    const p = path.join(h.home, '.cc-sessions', `${ID}.${f}`);
    fs.writeFileSync(p, v); fs.utimesSync(p, at - 86400, at - 86400);
  };

  it('a write, a value outside the vocabulary, a refusal and an unmeasured stop all parse', () => {
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} workdir "$HOME/projects/demo"; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000
          _reg_set ${ID} typed "$(( $(date +%s) - 172800 )) since"`);
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    field('class', 'fable');
    transcript('model', 'opus', 'Set model to `Opus 5.5` for this session only');
    h.sh(`_operator_choice_keep ${ID}`);
    transcript('model', 'gpt-5.6-sol', 'Set model to `gpt-5.6-sol` for this session only');
    h.sh(`_operator_choice_keep ${ID}`);
    field('class', 'haiku');
    transcript('effort', 'high', 'Set effort level to high (this session only)');
    h.sh(`_operator_choice_keep ${ID}`);
    const p = h.sh(`_transcript_path ${ID}`);
    fs.rmSync(p); fs.mkdirSync(p);
    h.sh(`_operator_choice_keep ${ID}`);
    const r = run();
    expect(r.operator_choices_written_by_field).toEqual({ class: 1 });
    expect(r.operator_values_outside_the_vocabulary_by_kind).toEqual({ model: 1 });
    expect(r.operator_choices_refused_by_kind).toEqual({ effort: 1 });
    expect(r.restarts_that_reverted_an_operator_model).toBe(1);
    expect(r.stops_that_could_not_read_the_transcript).toBe(1);
  });
});
