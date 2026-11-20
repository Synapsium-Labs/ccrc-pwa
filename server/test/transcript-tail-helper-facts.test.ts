// Session helpers H1b (D-8862): the transcript tailer's SECOND output, `HelperFact[]` (spec §3.1, Table 12). The chat does
// not need an Agent launch result or a task notification's report; the Helpers section does. The facts ride beside the
// chat events, from the backlog's window and from every appended chunk, and `ChatEvent` and the chat wire do not change.
// Neutral fixture names and values.
//
// RED FIRST: committed before the code, against origin/main, where the tailer emits chat events only.
import { describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBacklog, TranscriptTailer } from '../src/transcript/tail.js';
import type { HelperFact } from '../src/transcript/parse.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const TS = '2026-11-20T09:32:17.244Z';
const AT = Date.parse(TS);
const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: TS, type: 'user', message: { role: 'user', content: text } })}\n`;
const launchLine = (agentId: string): string => `${JSON.stringify({
  uuid: `l-${agentId}`, parentUuid: null, isSidechain: false, timestamp: TS, type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'launched' }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'd', resolvedModel: 'model-a', prompt: 'p' },
})}\n`;
const noticeLine = (agentId: string): string => `${JSON.stringify({
  uuid: `n-${agentId}`, parentUuid: null, isSidechain: false, timestamp: TS, type: 'user', origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n<summary>done</summary>\n<result>r</result>\n</task-notification>` },
})}\n`;

const tmpFile = (): string => path.join(mkTmp('ccrc-tail-helpers-'), 'transcript.jsonl');

const nextHelpers = (t: TranscriptTailer, timeoutMs = 3000): Promise<HelperFact[]> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for helper facts')), timeoutMs);
    t.once('helpers', (facts) => { clearTimeout(timer); resolve(facts); });
  });

describe('readBacklog: the helper facts of its window', () => {
  it('a launch result and a notification in the window come back beside the events, in file order', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'hi') + launchLine('a1') + noticeLine('a1') + userLine('u2', 'bye'));
    const r = await readBacklog(localIO, file, 50);
    expect(r.helpers?.map((f) => [f.source, f.id, f.status, f.at])).toEqual([
      ['launch', 'a1', 'async_launched', AT],
      ['notification', 'a1', 'completed', AT],
    ]);
  });

  it('the facts are not cut to the last N events: a fact older than the event window is still read (it costs no read)', async () => {
    const file = tmpFile();
    writeFileSync(file, launchLine('a1') + userLine('u1', 'one') + userLine('u2', 'two') + userLine('u3', 'three'));
    const r = await readBacklog(localIO, file, 2);
    expect(r.events).toHaveLength(2);
    expect(r.helpers?.map((f) => f.id)).toEqual(['a1']);
  });

  it('a window with no fact carries no `helpers` member: a backlog read is byte for byte what it was', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'hi'));
    const r = await readBacklog(localIO, file, 50);
    expect('helpers' in r).toBe(false);
  });
});

describe('TranscriptTailer: a second output, `helpers`', () => {
  it('an appended launch result is emitted as a helper fact, and the chat events are emitted as before', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u0', 'start'));
    const t = new TranscriptTailer(localIO, file, Buffer.byteLength(userLine('u0', 'start')));
    const events: unknown[] = [];
    t.on('events', (e) => { events.push(...e); });
    t.start();
    try {
      const got = nextHelpers(t);
      await new Promise((r) => setTimeout(r, 50));
      appendFileSync(file, launchLine('a7') + userLine('u1', 'after'));
      const facts = await got;
      expect(facts.map((f) => [f.source, f.id, f.model])).toEqual([['launch', 'a7', 'model-a']]);
      await new Promise((r) => setTimeout(r, 50));
      expect(events.length).toBeGreaterThan(0);
    } finally { t.stop(); }
  });

  it('a chunk with no helper fact emits no `helpers` event', async () => {
    const file = tmpFile();
    writeFileSync(file, '');
    const t = new TranscriptTailer(localIO, file, 0);
    let helperEvents = 0;
    t.on('helpers', () => { helperEvents++; });
    const gotEvents = new Promise<void>((resolve) => t.once('events', () => resolve()));
    t.start();
    try {
      await new Promise((r) => setTimeout(r, 50));
      appendFileSync(file, userLine('u1', 'plain'));
      await gotEvents;
      expect(helperEvents).toBe(0);
    } finally { t.stop(); }
  });

  it('a notification split across two chunks is emitted once its line closes', async () => {
    const file = tmpFile();
    writeFileSync(file, '');
    const t = new TranscriptTailer(localIO, file, 0);
    t.start();
    try {
      const got = nextHelpers(t);
      const whole = noticeLine('a9');
      await new Promise((r) => setTimeout(r, 50));
      appendFileSync(file, whole.slice(0, 40));
      await new Promise((r) => setTimeout(r, 300));
      appendFileSync(file, whole.slice(40));
      expect((await got).map((f) => [f.source, f.id, f.status])).toEqual([['notification', 'a9', 'completed']]);
    } finally { t.stop(); }
  });
});
