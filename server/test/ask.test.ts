// Which AskUserQuestion is on screen right now. The transcript is append-only and
// survives restarts, so "has no tool_result" is necessary but nowhere near
// sufficient — an ask abandoned by a kill stays resultless forever.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readPendingAsk, alignAsk } from '../src/transcript/ask.js';
import type { AskQuestion } from '../../shared/api.js';

const ASK = (id: string, question = 'Which colour?') => JSON.stringify({
  type: 'assistant', uuid: 'a1', timestamp: '2026-07-26T15:00:00Z',
  message: { id: 'msg_1', role: 'assistant', content: [{
    type: 'tool_use', id, name: 'AskUserQuestion',
    input: { questions: [{
      question, header: 'Colour', multiSelect: false,
      options: [
        { label: 'Red', description: 'Warm, high-energy.', preview: '┌──┐\n│  │\n└──┘' },
        { label: 'Green', description: 'Natural, calm.' },
      ],
    }] },
  }] },
});
const RESULT = (id: string) => JSON.stringify({
  type: 'user', uuid: 'u1', timestamp: '2026-07-26T15:01:00Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] },
});
const LINE = (type: string) => JSON.stringify({ type, uuid: 'x', timestamp: '2026-07-26T15:00:30Z' });
const USER_TEXT = JSON.stringify({
  type: 'user', uuid: 'u9', timestamp: '2026-07-26T15:02:00Z',
  message: { role: 'user', content: 'something else entirely' },
});

const fileWith = (lines: string[]): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-ask-'));
  const f = path.join(dir, 't.jsonl');
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
};

describe('readPendingAsk', () => {
  it('returns the question when the ask is unanswered and last', async () => {
    const qs = await readPendingAsk(localIO, fileWith([ASK('t1')]));
    expect(qs).toHaveLength(1);
    expect(qs![0]!.question).toBe('Which colour?');
    expect(qs![0]!.header).toBe('Colour');
    expect(qs![0]!.options[0]).toEqual({
      label: 'Red', description: 'Warm, high-energy.', preview: '┌──┐\n│  │\n└──┘',
    });
  });

  it('returns null once the ask has been answered', async () => {
    expect(await readPendingAsk(localIO, fileWith([ASK('t1'), RESULT('t1')]))).toBeNull();
  });

  it('returns null when the tool_result rides a non-conversational line', async () => {
    // Gate 1 with gate 2 held silent: nothing of type user/assistant follows the
    // ask, so the answered-set is the only thing keeping this menu off screen.
    const RESULT_ON_ATTACHMENT = JSON.stringify({
      type: 'attachment', uuid: 'x1', timestamp: '2026-07-26T15:01:00Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'answered' }] },
    });
    expect(await readPendingAsk(localIO, fileWith([ASK('t1'), RESULT_ON_ATTACHMENT]))).toBeNull();
  });

  it('ignores non-conversational lines after the ask', async () => {
    const qs = await readPendingAsk(localIO, fileWith([
      ASK('t1'), LINE('attachment'), LINE('mode'), LINE('ai-title'), LINE('worktree-state'),
    ]));
    expect(qs).toHaveLength(1);
  });

  it('treats an ask abandoned by a restart as gone, not pending', async () => {
    // No tool_result anywhere — but the conversation moved on, so the menu is not
    // on screen. This is a real shape: session killed while the menu was up.
    expect(await readPendingAsk(localIO, fileWith([ASK('t1'), USER_TEXT]))).toBeNull();
  });

  it('parses an input larger than the chat stream’s 4000-char cap', async () => {
    const big = JSON.parse(ASK('t1')) as Record<string, never>;
    // Pad a preview past TOOL_INPUT_MAX; the dialog must not read the truncated
    // chat event, so this has to survive whole.
    const q = (big as never as { message: { content: { input: { questions: Array<{ options: Array<{ preview?: string }> }> } }[] } })
      .message.content[0]!.input.questions[0]!;
    q.options[0]!.preview = 'x'.repeat(6000);
    const qs = await readPendingAsk(localIO, fileWith([JSON.stringify(big)]));
    expect(qs![0]!.options[0]!.preview).toHaveLength(6000);
  });

  it('returns null for a malformed input, a non-ask tool, and a missing file', async () => {
    const bad = JSON.stringify({
      type: 'assistant', uuid: 'a1', timestamp: 't',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { nope: 1 } }] },
    });
    expect(await readPendingAsk(localIO, fileWith([bad]))).toBeNull();
    expect(await readPendingAsk(localIO, fileWith([LINE('system')]))).toBeNull();
    expect(await readPendingAsk(localIO, '/nope/missing.jsonl')).toBeNull();
  });

  it('degrades instead of throwing on null nodes', async () => {
    // `null` is valid JSON, so the try/catch around JSON.parse never sees these.
    // The poll loop that calls this has no catch and the server installs no
    // unhandledRejection handler — one TypeError here kills every session stream.
    const nullQuestion = JSON.stringify({
      type: 'assistant', uuid: 'a1', timestamp: 't',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [null] } }] },
    });
    const nullOption = JSON.stringify({
      type: 'assistant', uuid: 'a1', timestamp: 't',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which colour?', options: [null] }] } }] },
    });
    expect(await readPendingAsk(localIO, fileWith([nullQuestion]))).toBeNull();
    expect(await readPendingAsk(localIO, fileWith([nullOption]))).toBeNull();
    // A bare null line is skipped like any other noise — the ask after it still reads.
    expect(await readPendingAsk(localIO, fileWith(['null', ASK('t1')]))).toHaveLength(1);
  });
});

describe('alignAsk', () => {
  const q = (question: string, ...labels: string[]): AskQuestion =>
    ({ question, multiSelect: false, options: labels.map((label) => ({ label })) });
  const rows = (...labels: string[]) => labels.map((label) => ({ label }));

  it('matches head-anchored and ignores the TUI’s own trailing rows', () => {
    // A 3-option ask scrapes as 5 rows in one-column layout.
    const picked = alignAsk(
      rows('Red', 'Green', 'Blue', 'Type something.', 'Chat about this'),
      [q('Which colour?', 'Red', 'Green', 'Blue')],
    );
    expect(picked?.question).toBe('Which colour?');
  });

  it('matches when the pane truncated a long label', () => {
    // leftCol cuts at a run of two spaces or the two-column gutter.
    const picked = alignAsk(
      rows('Stage-then-send + chips', 'Cosmetic only'),
      [q('How far?', 'Stage-then-send + chips (Recommended)', 'Cosmetic only')],
    );
    expect(picked?.question).toBe('How far?');
  });

  it('requires every position to match for a small question', () => {
    // Two options, one coincidental label — the old "half" rule accepted this.
    expect(alignAsk(rows('Red', 'Purple'), [q('Which colour?', 'Red', 'Green')])).toBeNull();
  });

  it('tolerates one mismatch only from four options up', () => {
    expect(alignAsk(rows('A', 'B', 'C', 'Z'), [q('Pick', 'A', 'B', 'C', 'D')])?.question).toBe('Pick');
    expect(alignAsk(rows('A', 'B', 'Z'), [q('Pick', 'A', 'B', 'C')])).toBeNull();
  });

  it('refuses when two questions align — there is no ordering signal', () => {
    // A multi-question call gets ONE tool_result, after the LAST answer, so all
    // of them look pending at once.
    expect(alignAsk(rows('Yes', 'No'), [q('First?', 'Yes', 'No'), q('Second?', 'Yes', 'No')]))
      .toBeNull();
  });

  it('returns null when nothing aligns', () => {
    expect(alignAsk(rows('Restart', 'Cancel'), [q('Which colour?', 'Red', 'Green')])).toBeNull();
  });
});
