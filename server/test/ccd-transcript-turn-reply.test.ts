// `turn_reply` (ccd/lib/transcript.jq; Overlord W1 chat, PR B, plan w1-chat.md Task 5 step 1): the reply of the turn a
// transcript tail window ends in. The session hook's `Stop` arm runs it over the last REPLY_READ_MAX_BYTES of the
// transcript (`tail -c` into `jq -Rsc`, the shape below) and reports `{entryUuid, text}`, or nothing.
//
// The rule, in the cases: the window's first line may be cut, so a line that does not parse is stepped over; the turn is
// everything after the newest top-level main-thread user row that is a real prompt (the module's own `prompt`, shared with the
// continuation reader: not a tool result, not meta, not a compact summary, not a slash command's echo); the reply is the
// text blocks of the main-thread assistant rows after it, in order, joined by one blank line; thinking, tool input and tool
// output are never in it; `entryUuid` is the LAST main-thread assistant row's uuid; a turn with no text, and a window that
// holds no prompt (so its text may belong to an earlier turn), answer nothing.
//
// Fixture transcripts are written under the run's temp root; the module is run on every jq this machine has (the list the
// continuation parity test uses, and `CCRC_TEST_JQ`). No live box, no live HOME.
import { describe, it, expect } from 'vitest';
import { accessSync, constants, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { REPLY_READ_MAX_BYTES } from '../../shared/operatorMessages.js';

const LIB = path.resolve(__dirname, '../../ccd/lib');
const PROG = 'include "transcript"; turn_reply(.)';
const dir = mkTmp('ccd-turn-reply-');

const BASH = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
function jqBinaries(): string[] {
  const onPath = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
  const listed = (process.env.CCRC_TEST_JQ ?? '').split(':').filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [onPath, '/usr/bin/jq', '/usr/local/bin/jq', '/opt/homebrew/bin/jq', ...listed]) {
    if (c === '' || !existsSync(c)) continue;
    try { accessSync(c, constants.X_OK); } catch { continue; }
    const real = realpathSync(c);
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(c);
  }
  return out;
}

type Rec = Record<string, unknown>;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (n: number, content: unknown, extra: Rec = {}): Rec => ({ type: 'user', uuid: U(n), message: { role: 'user', content }, ...extra });
const asst = (n: number, content: unknown, extra: Rec = {}): Rec =>
  ({ type: 'assistant', uuid: U(n), message: { role: 'assistant', stop_reason: 'end_turn', content }, ...extra });
const text = (t: string): Rec => ({ type: 'text', text: t });
const toolUse = (id: string, input: Rec): Rec => ({ type: 'tool_use', id, name: 'Bash', input });
const toolResult = (n: number, id: string, out: string): Rec =>
  user(n, [{ type: 'tool_result', tool_use_id: id, content: out }]);
const jsonl = (rows: Array<Rec | string>): string => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

let seq = 0;
/** `tail -c <bytes>` of the transcript into `jq -Rsc`, the hook's own shape; the answer's lines, parsed. */
function reply(jq: string, transcript: string, bytes = REPLY_READ_MAX_BYTES): Array<{ entryUuid: string; text: string }> {
  const f = path.join(dir, `t${seq++}.jsonl`);
  writeFileSync(f, transcript, 'utf8');
  const r = spawnSyncGroup(BASH, ['-c', 'tail -c "$3" -- "$2" | "$1" -L "$L" -Rsc "$P"', '_', jq, f, String(bytes)],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, L: LIB, P: PROG } });
  expect(r.status, r.stderr).toBe(0);
  return String(r.stdout).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { entryUuid: string; text: string });
}

for (const jq of jqBinaries()) {
  const version = spawnSync(jq, ['--version'], { encoding: 'utf8' }).stdout.trim() || 'unknown';
  describe(`turn_reply on ${version} (${jq})`, () => {
    const one = (rows: Array<Rec | string>, bytes?: number): { entryUuid: string; text: string } | undefined => {
      const got = reply(jq, jsonl(rows), bytes);
      expect(got.length, 'at most one answer').toBeLessThanOrEqual(1);
      return got[0];
    };

    it('a turn of one text entry answers its text, keyed by that entry', () => {
      expect(one([user(1, 'hello'), asst(2, [text('the answer')])])).toEqual({ entryUuid: U(2), text: 'the answer' });
    });

    it('text, a tool call and more text: the two texts joined by exactly one blank line, keyed by the last entry', () => {
      const got = one([
        user(1, 'do it'),
        asst(2, [text('first part')]),
        asst(3, [toolUse('t1', { command: 'ls' })], { message: { role: 'assistant', stop_reason: 'tool_use', content: [toolUse('t1', { command: 'ls' })] } }),
        toolResult(4, 't1', 'a.txt'),
        asst(5, [text('second part')]),
      ]);
      expect(got).toEqual({ entryUuid: U(5), text: 'first part\n\nsecond part' });
    });

    it('several text blocks in one entry join the same way, and a plain-string content is text', () => {
      expect(one([user(1, 'q'), asst(2, [text('a'), text('b')]), asst(3, 'c')])).toEqual({ entryUuid: U(3), text: 'a\n\nb\n\nc' });
    });

    it('thinking blocks, tool input and tool output are never part of the reply', () => {
      const got = one([
        user(1, 'go'),
        asst(2, [{ type: 'thinking', thinking: 'SECRET-THOUGHT', signature: 'sig' }, text('visible one')]),
        asst(3, [toolUse('t1', { command: 'echo SECRET-INPUT' })]),
        toolResult(4, 't1', 'SECRET-OUTPUT'),
        asst(5, [{ type: 'redacted_thinking', data: 'SECRET-REDACTED' }, text('visible two')]),
      ]);
      expect(got?.text).toBe('visible one\n\nvisible two');
      expect(JSON.stringify(got)).not.toContain('SECRET');
    });

    it('a turn with no text block answers nothing, even when it has thinking and a tool call', () => {
      expect(one([user(1, 'go'), asst(2, [{ type: 'thinking', thinking: 'hmm' }]), asst(3, [toolUse('t1', {})]), toolResult(4, 't1', 'out')])).toBeUndefined();
      expect(one([user(1, 'go')]), 'a prompt and no assistant row').toBeUndefined();
    });

    it('a text block that is only whitespace is not text', () => {
      expect(one([user(1, 'go'), asst(2, [text(' \n\t ')])])).toBeUndefined();
      expect(one([user(1, 'go'), asst(2, [text('real')]), asst(3, [text('\n\n')])])).toEqual({ entryUuid: U(3), text: 'real' });
    });

    it('a sidechain entry, assistant or user, is left out and never keys the reply or opens a turn', () => {
      const got = one([
        user(1, 'go'),
        asst(2, [text('main text')]),
        asst(3, [text('SIDE-TEXT')], { isSidechain: true }),
        user(4, 'a subagent prompt', { isSidechain: true }),
        asst(5, [text('SIDE-TWO')], { isSidechain: true }),
      ]);
      expect(got).toEqual({ entryUuid: U(2), text: 'main text' });
    });

    it('an API error row is Claude Code\'s notice, not the reply: its text is left out beside real text, and it never keys the reply', () => {
      const got = one([
        user(1, 'go'),
        asst(2, [text('real words')]),
        asst(3, [text('API Error: ERROR-NOTICE overloaded')], { isApiErrorMessage: true }),
      ]);
      expect(got).toEqual({ entryUuid: U(2), text: 'real words' });
      expect(JSON.stringify(got)).not.toContain('ERROR-NOTICE');
      // An error row between two real ones leaves both and keys the later real one.
      expect(one([user(1, 'go'), asst(2, [text('one')]), asst(3, [text('ERROR-NOTICE')], { isApiErrorMessage: true }), asst(4, [text('two')])]))
        .toEqual({ entryUuid: U(4), text: 'one\n\ntwo' });
      // `isApiErrorMessage: false` is an ordinary row.
      expect(one([user(1, 'go'), asst(2, [text('fine')], { isApiErrorMessage: false })])).toEqual({ entryUuid: U(2), text: 'fine' });
    });

    it('a turn whose assistant rows are all API error rows answers nothing', () => {
      expect(one([user(1, 'go'), asst(2, [text('ERROR-NOTICE one')], { isApiErrorMessage: true }), asst(3, [text('ERROR-NOTICE two')], { isApiErrorMessage: true })])).toBeUndefined();
    });

    it('a turn made only of sidechain text answers nothing', () => {
      expect(one([user(1, 'go'), asst(2, [text('SIDE')], { isSidechain: true })])).toBeUndefined();
    });

    it('the previous turn\'s text is never taken: a new prompt with no reply yet answers nothing', () => {
      expect(one([user(1, 'first'), asst(2, [text('OLD-ANSWER')]), user(3, 'second'), asst(4, [{ type: 'thinking', thinking: 'x' }])])).toBeUndefined();
      expect(one([user(1, 'first'), asst(2, [text('OLD-ANSWER')]), user(3, 'second')])).toBeUndefined();
    });

    it('the newest prompt starts the turn: an older turn\'s text is not joined to it', () => {
      expect(one([user(1, 'first'), asst(2, [text('OLD')]), user(3, 'second'), asst(4, [text('NEW')])])).toEqual({ entryUuid: U(4), text: 'NEW' });
    });

    it('the key is the last assistant entry\'s uuid, whether or not that entry has text', () => {
      expect(one([user(1, 'go'), asst(2, [text('says it')]), asst(3, [toolUse('t1', {})])])).toEqual({ entryUuid: U(3), text: 'says it' });
    });

    it('rows that are not prompts leave the turn open: a tool result, a meta row, a command echo, a reminder, an interruption notice', () => {
      const got = one([
        user(1, 'the prompt'),
        asst(2, [text('part one')]),
        toolResult(3, 't1', 'out'),
        user(4, 'meta text', { isMeta: true }),
        user(5, '<local-command-stdout>ok</local-command-stdout>'),
        user(6, '<system-reminder>remember</system-reminder>'),
        user(7, '[Request interrupted by user]'),
        user(8, 'a summary of earlier work', { isCompactSummary: true }),
        asst(9, [text('part two')]),
      ]);
      expect(got).toEqual({ entryUuid: U(9), text: 'part one\n\npart two' });
    });

    it('records that are neither user nor assistant (attachments, system rows, queue operations) are stepped over', () => {
      const got = one([
        user(1, 'go'),
        { type: 'attachment', uuid: U(2), attachment: { type: 'queued_command', prompt: 'ATT' } },
        asst(3, [text('answer')]),
        { type: 'system', subtype: 'turn_duration', uuid: U(4) },
        { type: 'queue-operation', operation: 'enqueue', content: 'QUEUED' },
      ]);
      expect(got).toEqual({ entryUuid: U(3), text: 'answer' });
    });

    it('a window that holds no prompt answers nothing rather than taking text that may belong to an earlier turn', () => {
      expect(one([asst(2, [text('tail of a long turn')]), toolResult(3, 't1', 'out'), asst(4, [text('more')])])).toBeUndefined();
    });

    it('a window whose first line is cut reads the turn inside it', () => {
      const whole = jsonl([user(1, 'go'), asst(2, [text('part one')]), asst(3, [text('part two')])]);
      const cut = whole.slice(whole.indexOf('{"role"') + 3);   // the first row's head is gone
      expect(cut.startsWith('{')).toBe(false);
      expect(reply(jq, cut)).toEqual([]);   // the prompt was in the cut line: no prompt left, nothing is taken
      expect(one([`${jsonl([user(0, 'old')]).slice(20).trim()}`, user(1, 'go'), asst(2, [text('part one')]), asst(3, [text('part two')])]))
        .toEqual({ entryUuid: U(3), text: 'part one\n\npart two' });
    });

    it('a line that does not parse, and a line that parses to something that is not an object, is stepped over', () => {
      expect(one([user(1, 'go'), 'not json at all', asst(2, [text('kept')]), '"a string"', '[1,2]', '', '{"type":"assistant","uuid":', asst(3, [text('also kept')])]))
        .toEqual({ entryUuid: U(3), text: 'kept\n\nalso kept' });
    });

    it('text keeps its characters: quotes, newlines, a non-BMP character and a combining mark survive', () => {
      const t = 'say "hi"\n\nline two\ttab é 😀 é';
      expect(one([user(1, 'go'), asst(2, [text(t)])])?.text).toBe(t);
    });

    it('a tail of exactly the bound, read through `tail -c`, reads the turn inside it (the first line cut mid-row)', () => {
      const pad = (n: number): Rec => asst(n, [{ type: 'thinking', thinking: 'p'.repeat(60_000) }]);
      const rows: Rec[] = [user(1, 'old prompt'), asst(2, [text('OLD-ANSWER')])];
      for (let i = 0; i < 80; i += 1) rows.push(pad(100 + i));   // ~4.8 MB of earlier turn
      rows.push(user(300, 'the prompt'), asst(301, [text('part one')]), asst(302, [toolUse('t1', {})]), toolResult(303, 't1', 'out'), asst(304, [text('part two')]));
      const body = jsonl(rows);
      expect(Buffer.byteLength(body)).toBeGreaterThan(REPLY_READ_MAX_BYTES);
      expect(reply(jq, body, REPLY_READ_MAX_BYTES)).toEqual([{ entryUuid: U(304), text: 'part one\n\npart two' }]);
      // The same turn when the window is cut so close that the prompt itself is gone: nothing, never the old turn.
      expect(reply(jq, body, Buffer.byteLength(jsonl(rows.slice(-3))) - 10)).toEqual([]);
    });

    describe('reply_report: the body, and the cut at a code point', () => {
      const MAX = 20;
      const report = (t: string, max = MAX): Rec | undefined => {
        const f = path.join(dir, `r${seq++}.jsonl`);
        writeFileSync(f, jsonl([user(1, 'go'), asst(2, [text(t)])]), 'utf8');
        const r = spawnSyncGroup(BASH, ['-c', '"$1" -L "$L" -Rsc --arg id lane-a-project-a --arg u "$U" --argjson t 111 --argjson a 222 --argjson m "$M" "$P" < "$2"',
          '_', jq, f], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, L: LIB, U: U(9), M: String(max), P: 'include "transcript"; reply_report(.; $id; $u; $t; $a; $m)' } });
        expect(r.status, r.stderr).toBe(0);
        const line = String(r.stdout).trim();
        return line === '' ? undefined : (JSON.parse(line) as Rec);
      };

      it('carries the six fields and the two ids, in the report door\'s shape', () => {
        expect(report('short')).toEqual({ kind: 'reply', entryUuid: U(2), turnAt: 111, text: 'short', truncated: false, fromId: 'lane-a-project-a', fromUuid: U(9), at: 222 });
      });

      it('answers nothing for a turn with no text', () => {
        const f = path.join(dir, `r${seq++}.jsonl`);
        writeFileSync(f, jsonl([user(1, 'go')]), 'utf8');
        const r = spawnSyncGroup(BASH, ['-c', '"$1" -L "$L" -Rsc --arg id i --arg u u --argjson t 1 --argjson a 2 --argjson m 20 "$P" < "$2"', '_', jq, f],
          { encoding: 'utf8', timeout: 60_000, env: { ...process.env, L: LIB, P: 'include "transcript"; reply_report(.; $id; $u; $t; $a; $m)' } });
        expect(r.status, r.stderr).toBe(0);
        expect(String(r.stdout)).toBe('');
      });

      it('a text of exactly the bound is whole; one byte more is cut and says so', () => {
        expect(report('a'.repeat(MAX))).toMatchObject({ text: 'a'.repeat(MAX), truncated: false });
        expect(report('a'.repeat(MAX + 1))).toMatchObject({ text: 'a'.repeat(MAX), truncated: true });
      });

      it('never cuts mid-character: a 2-, 3- and 4-byte character straddling the bound is dropped whole', () => {
        for (const ch of ['é', '€', '😀']) {
          const bytes = Buffer.byteLength(ch);
          const t = 'a'.repeat(MAX - bytes + 1) + ch + 'tail';   // the character ends one byte past the bound
          const got = report(t) as { text: string; truncated: boolean };
          expect(got.truncated, ch).toBe(true);
          expect(got.text, ch).toBe('a'.repeat(MAX - bytes + 1));
          expect(Buffer.byteLength(got.text), ch).toBeLessThanOrEqual(MAX);
          const fits = 'a'.repeat(MAX - bytes) + ch + 'tail';   // the character ends exactly on the bound
          expect(report(fits), ch).toMatchObject({ text: 'a'.repeat(MAX - bytes) + ch, truncated: true });
        }
      });

      it('counts bytes, not characters: a text of 20 two-byte characters is cut to 10', () => {
        expect(report('é'.repeat(MAX))).toMatchObject({ text: 'é'.repeat(MAX / 2), truncated: true });
        expect(report('é'.repeat(MAX / 2))).toMatchObject({ text: 'é'.repeat(MAX / 2), truncated: false });
      });
    });
  });
}
