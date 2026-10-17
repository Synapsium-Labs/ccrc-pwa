// D-5302 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 3; spec §9): an ask's push body
// comes from its hook envelope, never a scraped border glyph. 14 of 36 measured bodies were a lone box-drawing glyph,
// because both raise sites pushed `dialog.title || 'Claude has a question'` and the pane scrape's title was the
// border row. The envelopes below copy the shape `session-hook.sh` writes to `<id>.hookstate.json` (`HookAsk` in
// `shared/api.ts`); the ids and texts are neutral.
import { describe, it, expect } from 'vitest';
import type { HookAsk } from '../../shared/api.js';
import type { HookState } from '../src/hookstate.js';
import {
  askPushBody, ASK_PUSH_FALLBACK_BODY, withCoordinatorBody, answeredByBody, approvalRuledBody,
} from '../src/askbody.js';

const hookState = (ask: HookAsk | null, state: HookState['state'] = 'waiting'): HookState => ({
  state, updatedAt: 1, event: 'PreToolUse', ask, subagents: [], graphQueries: null, graphGateDenials: null,
} as unknown as HookState);

const question = (text: string, header?: string): HookAsk => ({
  questions: [{ question: text, ...(header !== undefined ? { header } : {}), multiSelect: false,
    options: [{ label: 'Red' }, { label: 'Blue' }] }],
});

describe('askPushBody (D-5302)', () => {
  it("a question envelope's first question text wins over any title", () => {
    expect(askPushBody(hookState(question('Which colour?', 'Colour')), { title: 'Something else' }))
      .toBe('Which colour?');
    expect(askPushBody(hookState(question('Which colour?')), { title: '│' })).toBe('Which colour?');
    expect(askPushBody(hookState({
      questions: [
        { question: 'First?', options: [{ label: 'A' }] },
        { question: 'Second?', options: [{ label: 'B' }] },
      ],
    }), { title: '│' })).toBe('First?');
  });

  it('an approval envelope gives `tool: summary`, through hookAskSummary', () => {
    expect(askPushBody(hookState({ approval: { tool: 'Bash', summary: 'rm -rf scratch' } }), { title: '│' }))
      .toBe('Bash: rm -rf scratch');
  });

  it('a title of only box-drawing and block characters and spaces gives the fallback', () => {
    for (const title of ['│', '─', '╭', '▌', ' │ ', '╭──────╮', '│ ▌ ─ ╭']) {
      expect(askPushBody(null, { title }), JSON.stringify(title)).toBe('Claude has a question');
    }
    expect(askPushBody(null, { title: '' })).toBe('Claude has a question');
    // Punctuation is not a letter or digit: a stripped `?` or ellipsis says nothing either.
    for (const title of ['│ ? │', '…', '─ : ─']) {
      expect(askPushBody(null, { title }), JSON.stringify(title)).toBe('Claude has a question');
    }
  });

  it('a title with a letter or digit is kept, its border glyphs trimmed', () => {
    expect(askPushBody(null, { title: 'Which colour?' })).toBe('Which colour?');
    expect(askPushBody(null, { title: '│ Pick one │' })).toBe('Pick one');
    expect(askPushBody(null, { title: '│ 3 │' })).toBe('3');
    expect(askPushBody(null, { title: '▌ Pick one ▐' })).toBe('Pick one');   // block elements are edges too
  });

  it('a null hookstate with a glyph title gives the fallback', () => {
    expect(askPushBody(null, { title: '│' })).toBe(ASK_PUSH_FALLBACK_BODY);
  });

  it('an envelope the hook no longer reports as waiting is not read: the title decides', () => {
    expect(askPushBody(hookState(question('Stale question?'), 'working'), { title: '│' })).toBe('Claude has a question');
    expect(askPushBody(hookState(question('Stale question?'), 'working'), { title: 'Which colour?' })).toBe('Which colour?');
  });

  it('an envelope with an empty question falls through to the header, then to the title', () => {
    expect(askPushBody(hookState(question('  ', 'Colour')), { title: '│' })).toBe('Colour');
    expect(askPushBody(hookState(question('', '')), { title: '│' })).toBe('Claude has a question');
    expect(askPushBody(hookState({ approval: { tool: '', summary: '' } }), { title: '│' })).toBe('Claude has a question');
  });

  it('the replacement bodies the coordinator lane uses name the parent', () => {
    expect(withCoordinatorBody('project-a-calm-mesa')).toBe('With coordinator project-a-calm-mesa');
    expect(answeredByBody('project-a-calm-mesa')).toBe('Answered by project-a-calm-mesa');
    expect(approvalRuledBody('project-a-calm-mesa', 'allow')).toBe('Allowed by project-a-calm-mesa');
    expect(approvalRuledBody('project-a-calm-mesa', 'deny')).toBe('Denied by project-a-calm-mesa');
  });
});
