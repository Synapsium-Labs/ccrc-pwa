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
    expect(rows.filter((r) => r.endsWith('folds=true'))).toEqual([
      'compactCardFixtures.summary (the recap) user marker=true folds=true',
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true',
    ]);
    // Where the marker and the PWA's verdict disagree today: the rows C7h's flag decides.
    expect(rows.filter((r) => /marker=true folds=false|marker=false folds=true/.test(r))).toEqual([
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=false',
      'compactCardFixtures.user (the recap, typed by a person) user marker=false folds=true',
    ]);
    expect(rows).toEqual([
      'transcript-sample.jsonl:3 user marker=false folds=false',
      'transcript-sample.jsonl:6 assistant marker=false folds=false',
      'compactCardFixtures.summary (the recap) user marker=true folds=true',
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=false',
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

  it('every event foldsAway folds carries the flag; the one other flagged row is the marker whose words the pattern does not match (D-7361)', async () => {
    const { foldsAway } = await bubble();
    const rows = events().map(({ source, marker, e }) => `${source} ${e.kind} marker=${marker} folds=${foldsAway(e)} flag=${e.compaction === true}`);
    expect(rows.length).toBe(6);
    expect(rows.filter((r) => r.includes('folds=true') && !r.endsWith('flag=true'))).toEqual([]);
    expect(rows.filter((r) => r.endsWith('flag=true') && !r.includes('folds=true'))).toEqual([
      'compactCardFixtures.summary (a summary in other words) user marker=true folds=false flag=true',
    ]);
    // The flag is `true` or absent, never `false`.
    expect(events().filter(({ e }) => 'compaction' in e && e.compaction !== true)).toEqual([]);
  });

  it('the skew row: an old PWA ignores the key, so its verdict with the flag equals its verdict without it', async () => {
    const { foldsAway } = await bubble();
    const all = events();
    expect(all.some(({ e }) => e.compaction === true)).toBe(true);
    for (const { source, e } of all) {
      const { compaction: _ignored, ...withoutFlag } = e;
      expect(foldsAway(e), source).toBe(foldsAway(withoutFlag));
    }
  });
});
