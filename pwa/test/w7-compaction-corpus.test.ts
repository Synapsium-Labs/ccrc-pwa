// `MessageBubble.tsx#foldsAway` over the PWA's own Markdown corpus, pinned before C7i (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 7; ARCH-64). `COMPACTION_RE` decides the fold for a
// user- and an assistant-kind row; a `system` row folds on a body. The PWA package reads no server fixture
// (`accounts-pool.test.ts`'s note): the server-side row is `server/test/w7-compaction-parity.test.ts`, over the
// server's transcript fixtures, which imports `foldsAway` by path.
import { describe, it, expect } from 'vitest';
import { foldsAway, type MessageEvent } from '../src/session/MessageBubble';
import { CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, languageCases, type CorpusCase } from './markdownCorpus';

const CASES: readonly CorpusCase[] = [...CHAT_CORPUS, RECAP_CASE, ...languageCases([...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS])];
const event = (kind: 'user' | 'assistant' | 'system', text: string): MessageEvent =>
  (kind === 'system' ? { kind, uuid: 'u-1', ts: '2026-10-27T00:00:00.000Z', text } : { kind, uuid: 'u-1', ts: '2026-10-27T00:00:00.000Z', text });

describe('foldsAway over the PWA corpus (every verdict, by kind)', () => {
  it('a user or assistant row folds exactly when it is the recap; every other case renders', () => {
    for (const kind of ['user', 'assistant'] as const) {
      const folds = CASES.filter((c) => foldsAway(event(kind, c.text))).map((c) => c.name);
      expect(folds, kind).toEqual(['recap-opened']);
    }
    expect(CASES.length).toBeGreaterThan(40);
  });

  it('a system row folds on a body (a newline), whatever its words; a one-line label does not', () => {
    const folds = CASES.filter((c) => foldsAway(event('system', c.text))).map((c) => c.name);
    expect(folds).toEqual(CASES.filter((c) => c.text.includes('\n')).map((c) => c.name));
    expect(foldsAway(event('system', 'Conversation compacted'))).toBe(false);
  });

  it('the recap phrase folds only at the start (after an optional bracketed tag), never quoted mid-text', () => {
    const recap = 'This session is being continued from a previous conversation that ran out of context.';
    expect([
      foldsAway(event('user', recap)),
      foldsAway(event('user', `  [summary] ${recap}`)),
      foldsAway(event('assistant', `As the note says: ${recap}`)),
      foldsAway(event('assistant', recap.toLowerCase())),
    ]).toEqual([true, true, false, false]);
  });
});
