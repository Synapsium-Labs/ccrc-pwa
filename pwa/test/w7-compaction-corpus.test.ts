// `MessageBubble.tsx#foldsAway` over the PWA's own Markdown corpus, pinned before C7i (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 7; ARCH-64). `COMPACTION_RE` decides the fold for a
// user- and an assistant-kind row; a `system` row folds on a body. The PWA package reads no server fixture
// (`accounts-pool.test.ts`'s note): the server-side row is `server/test/w7-compaction-parity.test.ts`, over the
// server's transcript fixtures, which imports `foldsAway` by path.
import { describe, it, expect } from 'vitest';
import { foldsAway, type MessageEvent } from '../src/session/MessageBubble';
import {
  CHAT_ALIAS_TAGS, CHAT_CORPUS, CHAT_UNREGISTERED_TAGS, RECAP_CASE, RECAP_PLACEMENTS, languageCases, type CorpusCase,
} from './markdownCorpus';

const CASES: readonly CorpusCase[] = [...CHAT_CORPUS, RECAP_CASE, ...languageCases([...CHAT_ALIAS_TAGS, ...CHAT_UNREGISTERED_TAGS])];
// C7i (D-7187): a user- or assistant-kind input carries the server's `compaction` flag where the server sets it (the
// corpus case's own `compaction`, which `server/test/w7-compaction-parity.test.ts` holds to the server's parser).
const event = (kind: 'user' | 'assistant' | 'system', text: string, compaction?: true): MessageEvent =>
  (kind === 'system'
    ? { kind, uuid: 'u-1', ts: '2026-10-27T00:00:00.000Z', text }
    : { kind, uuid: 'u-1', ts: '2026-10-27T00:00:00.000Z', text, ...(compaction === true ? { compaction } : {}) });

describe('foldsAway over the PWA corpus (every verdict, by kind)', () => {
  it('a user or assistant row folds exactly when it is the recap; every other case renders', () => {
    for (const kind of ['user', 'assistant'] as const) {
      const folds = CASES.filter((c) => foldsAway(event(kind, c.text, c.compaction))).map((c) => c.name);
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
    expect(RECAP_PLACEMENTS.map((p) => foldsAway(event(p.kind, p.text, p.compaction)))).toEqual([true, true, false, false]);
  });
});

// D-7361 (C7i's named behaviour row): Claude Code's `isCompactSummary` marker on a summary whose words are not the
// recap sentence. The server flags it (D-7186's marker half); before C7i the PWA's own pattern left it as text, and
// after C7i it folds like every other flagged recap, user- and assistant-kind both.
describe('a marker-only summary folds on the flag (D-7361)', () => {
  const MARKER_ONLY = 'Summary of the work so far: the census landed.';
  it('a flagged row folds whatever its words; the same words unflagged render', () => {
    expect([
      foldsAway(event('user', MARKER_ONLY, true)),
      foldsAway(event('assistant', MARKER_ONLY, true)),
      foldsAway(event('user', MARKER_ONLY)),
      foldsAway(event('assistant', MARKER_ONLY)),
    ]).toEqual([true, true, false, false]);
  });
});
