import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBacklog, TranscriptTailer } from '../src/transcript/tail.js';
import type { ChatEvent } from '../../shared/api.js';

const userLine = (uuid: string, text: string): string =>
  JSON.stringify({
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp: '2026-07-20T21:00:00.000Z',
    type: 'user',
    message: { role: 'user', content: text },
  }) + '\n';

const tmpFile = (): string => path.join(mkdtempSync(path.join(tmpdir(), 'ccrc-tail-')), 'transcript.jsonl');

const onceEvents = (t: TranscriptTailer, timeoutMs = 3000): Promise<{ events: ChatEvent[]; offset: number }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for events')), timeoutMs);
    t.once('events', (events, offset) => {
      clearTimeout(timer);
      resolve({ events, offset });
    });
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('readBacklog', () => {
  it('parses the whole file, returns last N events and end-of-file offset', async () => {
    const file = tmpFile();
    let body = '';
    for (let i = 1; i <= 6; i++) body += userLine(`u${i}`, `message ${i}`);
    writeFileSync(file, body);

    const { events, offset } = await readBacklog(file, 2);
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.kind === 'user' ? e.uuid : '?'))).toEqual(['u5', 'u6']);
    expect(offset).toBe(statSync(file).size);
  });

  it('missing file returns empty events and offset 0', async () => {
    const out = await readBacklog(path.join(tmpdir(), 'ccrc-definitely-missing', 'x.jsonl'), 50);
    expect(out).toEqual({ events: [], offset: 0 });
  });
});

describe('TranscriptTailer', () => {
  it('started at end-of-file, emits exactly the appended entry events', { timeout: 10_000 }, async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one') + userLine('u2', 'two'));
    const tailer = new TranscriptTailer(file, statSync(file).size);
    tailer.start();
    try {
      const waiter = onceEvents(tailer);
      appendFileSync(file, userLine('u3', 'three'));
      const { events, offset } = await waiter;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'user', uuid: 'u3', text: 'three' });
      expect(offset).toBe(statSync(file).size);
    } finally {
      tailer.stop();
    }
  });

  it('holds a partial line until the closing newline arrives', { timeout: 10_000 }, async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one'));
    const tailer = new TranscriptTailer(file, statSync(file).size);
    const seen: ChatEvent[][] = [];
    tailer.on('events', (events) => seen.push(events));
    tailer.start();
    try {
      const full = userLine('u2', 'two');
      const cut = Math.floor(full.length / 2);
      appendFileSync(file, full.slice(0, cut));
      await sleep(1800); // longer than the 1500 ms poll — the tailer has definitely seen the partial
      expect(seen).toEqual([]);

      const waiter = onceEvents(tailer);
      appendFileSync(file, full.slice(cut));
      const { events } = await waiter;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'user', uuid: 'u2', text: 'two' });
      expect(seen).toHaveLength(1);
    } finally {
      tailer.stop();
    }
  });
});
