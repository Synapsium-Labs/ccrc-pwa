// The PWA's compaction verdict over the server's transcript rows (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 7; ARCH-64). The PWA decides the fold itself
// (`pwa/src/session/MessageBubble.tsx#foldsAway`, over `COMPACTION_RE`). This test records that verdict for every user-
// and assistant-kind event `parseTranscriptLine` yields over the server's transcript fixtures and the compaction
// fixtures' transcript lines, beside each line's own `isCompactSummary` marker (Claude Code's). C7h (D-7186) ships the
// marker and the pattern as `ChatEvent`'s optional `compaction` flag; the second describe holds the flag to the verdict.
//
// `MessageBubble.tsx` is imported by path (the `ask-pairing-table.test.ts` precedent; Step 0 confirmed it resolves under
// the server's vitest with its React, `@ccrc/ui` and CSS imports), and typed here: the server does not depend on the PWA.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatEvent } from '../../shared/api.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import { tl } from './compactCardFixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
type MessageEvent = Extract<ChatEvent, { kind: 'user' | 'assistant' | 'system' }>;
const bubble = async (): Promise<{ foldsAway: (e: MessageEvent) => boolean }> =>
  await import(path.join(ROOT, 'pwa/src/session/MessageBubble.tsx')) as { foldsAway: (e: MessageEvent) => boolean };

const RECAP = 'This session is being continued from a previous conversation that ran out of context. The summary follows.';

/** Every transcript line the rows read: the two fixture files, then the compaction fixtures' lines. */
const LINES: ReadonlyArray<{ source: string; line: string }> = [
  ...['transcript-sample.jsonl', 'transcript-ask-2col.jsonl'].flatMap((f) =>
    readFileSync(path.join(HERE, 'fixtures', f), 'utf8').split('\n').filter((l) => l.trim() !== '').map((line, i) => ({ source: `${f}:${i + 1}`, line }))),
  { source: 'compactCardFixtures.summary (the recap)', line: tl.summary(RECAP) },
  { source: 'compactCardFixtures.summary (a summary in other words)', line: tl.summary('Summary of the work so far: the census landed.') },
  { source: 'compactCardFixtures.user (the recap, typed by a person)', line: tl.user(RECAP) },
  { source: 'compactCardFixtures.user (the recap quoted mid-text)', line: tl.user(`Earlier it said: ${RECAP}`) },
];

describe('foldsAway over the server transcript rows (the PWA verdict beside the line\'s own marker)', () => {
  it('records every user- and assistant-kind event: kind, isCompactSummary, foldsAway', async () => {
    const { foldsAway } = await bubble();
    const rows: string[] = [];
    for (const { source, line } of LINES) {
      const marker = (JSON.parse(line) as { isCompactSummary?: unknown }).isCompactSummary === true;
      for (const e of parseTranscriptLine(line)) {
        if (e.kind !== 'user' && e.kind !== 'assistant') continue;
        rows.push(`${source} ${e.kind} marker=${marker} folds=${foldsAway(e)}`);
      }
    }
    console.log(`w7-compaction-parity: ${rows.length} rows\n${rows.map((r) => `  ${r}`).join('\n')}`);
    // C7i (D-7187) folds on the flag, so the marker-only summary now folds (D-7361's named row; it rendered as text
    // before C7i, `folds=false`).
    expect(rows.filter((r) => r.endsWith('folds=true'))).toEqual([
      'compactCardFixtures.summary (the recap) user marker=true folds=true',
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=true',
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true',
    ]);
    // Where the marker and the PWA's verdict disagree: only the recap a person typed, which the flag's pattern half
    // folds as the PWA did before C7i.
    expect(rows.filter((r) => /marker=true folds=false|marker=false folds=true/.test(r))).toEqual([
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true',
    ]);
    expect(rows).toEqual([
      'transcript-sample.jsonl:3 user marker=false folds=false',
      'transcript-sample.jsonl:6 assistant marker=false folds=false',
      'compactCardFixtures.summary (the recap) user marker=true folds=true',
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=true',
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true',
      'compactCardFixtures.user (the recap quoted mid-text) user marker=false folds=false',
    ]);
  });
});

// D-7186 (Task C7h): the flag the parser sets, beside the verdict today's PWA reaches without it.
describe('the compaction flag beside foldsAway (D-7186)', () => {
  const events = (): Array<{ source: string; marker: boolean; e: Extract<ChatEvent, { kind: 'user' | 'assistant' }> }> =>
    LINES.flatMap(({ source, line }) => {
      const marker = (JSON.parse(line) as { isCompactSummary?: unknown }).isCompactSummary === true;
      return parseTranscriptLine(line).flatMap((e) => (e.kind === 'user' || e.kind === 'assistant' ? [{ source, marker, e }] : []));
    });

  it('every event foldsAway folds carries the flag, and every flagged event folds: the marker-only row now folds too (D-7361)', async () => {
    const { foldsAway } = await bubble();
    const rows = events().map(({ source, marker, e }) => `${source} ${e.kind} marker=${marker} folds=${foldsAway(e)} flag=${e.compaction === true}`);
    expect(rows.length).toBe(6);
    expect(rows.filter((r) => r.includes('folds=true') && !r.endsWith('flag=true'))).toEqual([]);
    // D-7361: before C7i this list held the one named exception, the marker-only summary
    // ('compactCardFixtures.summary (a summary in other words) user marker=true folds=false flag=true').
    expect(rows.filter((r) => r.endsWith('flag=true') && !r.includes('folds=true'))).toEqual([]);
    expect(rows.filter((r) => r.endsWith('flag=true'))).toEqual([
      'compactCardFixtures.summary (the recap) user marker=true folds=true flag=true',
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=true flag=true',
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true flag=true',
    ]);
    // The flag is `true` or absent, never `false`.
    expect(events().filter(({ e }) => 'compaction' in e && e.compaction !== true)).toEqual([]);
  });

  // C7i (D-7187), the other direction: this PWA against a server older than C7h, whose events carry no flag. No user-
  // or assistant-kind event folds, the recap included (its cost: the recap renders as text, named in the PR body).
  it('the skew row: this PWA over the same events with the flag stripped folds none of them', async () => {
    const { foldsAway } = await bubble();
    const all = events();
    expect(all.some(({ e }) => e.compaction === true)).toBe(true);
    const folded = all.filter(({ e }) => { const { compaction: _ignored, ...withoutFlag } = e; return foldsAway(withoutFlag); });
    expect(folded.map(({ source }) => source)).toEqual([]);
  });

  // C7i (D-7187) moves the PWA's verdict onto the flag, so the old PWA this row is about is no longer in the tree: it
  // is the shipped client's verdict before C7i, frozen here byte for byte (its pattern, over a user- or assistant-kind
  // text), and the first assertion holds the frozen copy to the verdict C7a recorded for that client.
  const OLD_PWA_RECAP = /^\s*(?:\[[^\]]*]\s*)?This session is being continued from a previous conversation/;
  const oldPwaFoldsAway = (e: { kind: 'user' | 'assistant'; text: string }): boolean => OLD_PWA_RECAP.test(e.text);

  it('the skew row: an old PWA ignores the key, so its verdict with the flag equals its verdict without it', () => {
    const all = events();
    expect(all.filter(({ e }) => oldPwaFoldsAway(e)).map(({ source, e }) => `${source} ${e.kind}`)).toEqual([
      'compactCardFixtures.summary (the recap) user',
      'compactCardFixtures.user (the recap, typed by a person) user',
    ]);
    expect(all.some(({ e }) => e.compaction === true)).toBe(true);
    for (const { source, e } of all) {
      const { compaction: _ignored, ...withoutFlag } = e;
      expect(oldPwaFoldsAway(e), source).toBe(oldPwaFoldsAway(withoutFlag));
    }
  });
});

// C7i (D-7187), Step 1: the PWA's own fold inputs carry the flag, and this row proves the flag on each is the server's.
// `pwa/test/markdownCorpus.ts` is imported by path, as `MessageBubble.tsx` is above: every corpus case and every recap
// placement is parsed as the user and the assistant record Claude Code writes, and the parser's flag must equal the
// case's own `compaction`, so no PWA input claims a flag the server would not send, or drops one it would.
describe('the PWA corpus inputs carry the server\'s compaction flag (D-7187)', () => {
  interface Case { readonly name: string; readonly text: string; readonly compaction?: true }
  interface Placement { readonly kind: 'user' | 'assistant'; readonly text: string; readonly compaction?: true }
  interface Corpus {
    CHAT_CORPUS: readonly Case[]; RECAP_CASE: Case; RECAP_PLACEMENTS: readonly Placement[];
    CHAT_ALIAS_TAGS: readonly string[]; CHAT_UNREGISTERED_TAGS: readonly string[]; languageCases: (tags: readonly string[]) => Case[];
  }
  const corpus = async (): Promise<Corpus> => await import(path.join(ROOT, 'pwa/test/markdownCorpus.ts')) as Corpus;
  const line = (kind: 'user' | 'assistant', text: string): string => (kind === 'user'
    ? tl.user(text)
    : JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  const flagOf = (kind: 'user' | 'assistant', text: string): boolean[] =>
    parseTranscriptLine(line(kind, text)).flatMap((e) => (e.kind === kind ? [e.compaction === true] : []));

  it('every corpus case, as a user and an assistant record: the server flags exactly the cases marked compaction', async () => {
    const c = await corpus();
    const cases = [...c.CHAT_CORPUS, c.RECAP_CASE, ...c.languageCases([...c.CHAT_ALIAS_TAGS, ...c.CHAT_UNREGISTERED_TAGS])];
    expect(cases.length).toBeGreaterThan(40);
    // A case yields one event of its kind, or none for an empty text (the `empty` case), never two.
    for (const kind of ['user', 'assistant'] as const) {
      const off = cases.filter((k) => flagOf(kind, k.text).some((f) => f !== (k.compaction === true))).map((k) => k.name);
      expect(off, kind).toEqual([]);
      expect(cases.filter((k) => flagOf(kind, k.text).length !== 1).map((k) => k.name), kind).toEqual(['empty']);
    }
    expect(cases.filter((k) => k.compaction === true).map((k) => k.name)).toEqual(['recap-opened']);
  });

  it('every recap placement: the server flags exactly the placements marked compaction', async () => {
    const { RECAP_PLACEMENTS } = await corpus();
    expect(RECAP_PLACEMENTS.map((p) => flagOf(p.kind, p.text))).toEqual(RECAP_PLACEMENTS.map((p) => [p.compaction === true]));
    expect(RECAP_PLACEMENTS.map((p) => p.compaction === true)).toEqual([true, true, false, false]);
  });
});
