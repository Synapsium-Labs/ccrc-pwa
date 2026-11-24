// The backlog's seam (desktop polish wave 171): where the backlog's window of events begins and ends, in BYTES. Every
// fixture is synthetic and written to its own temp file.
import { appendFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBacklog } from '../src/transcript/tail.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import { localIO } from '../src/io.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import type { ChatEvent } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const tmpFile = (): string => path.join(mkTmp('ccrc-seam-'), 'transcript.jsonl');

const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'user', message: { role: 'user', content: text } })}\n`;

/** One assistant record of `n` tool calls: `n` events (one per call, named `<uuid> call <i>`), all with the record's uuid. */
const multiLine = (uuid: string, n: number): string =>
  `${JSON.stringify({
    uuid, parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'assistant',
    message: { role: 'assistant', content: Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `t${i}`, name: `${uuid} call ${i}`, input: {} })) },
  })}\n`;

const textOf = (e: ChatEvent): string =>
  e.kind === 'tool_use' ? e.name : 'text' in e && typeof e.text === 'string' ? e.text : `${e.kind}`;

describe('the backlog seam: fixtures', () => {
  it('a multi-event record parses to one event per tool call', () => {
    expect(parseTranscriptLine(multiLine('m1', 3).trimEnd()).map(textOf)).toEqual(['m1 call 0', 'm1 call 1', 'm1 call 2']);
  });
});

describe('the backlog seam: a record start', () => {
  it('a multi-event record at the boundary is emitted whole: the backlog exceeds lastN by the rest of that record', async () => {
    const file = tmpFile();
    const one = userLine('u1', 'one');
    writeFileSync(file, one + multiLine('m1', 3) + userLine('u2', 'two'));
    const b = await readBacklog(localIO, file, 3);
    expect(b.events.map(textOf)).toEqual(['m1 call 0', 'm1 call 1', 'm1 call 2', 'two']);
    expect(b.offset).toBe(statSync(file).size);
  });

  it('a record boundary exactly at lastN adds nothing', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one') + multiLine('m1', 2) + userLine('u2', 'two'));
    const b = await readBacklog(localIO, file, 3);
    expect(b.events.map(textOf)).toEqual(['m1 call 0', 'm1 call 1', 'two']);
  });

  it('an unterminated last line is not a record: not parsed, and the offset is held at the end of the last whole record', async () => {
    const file = tmpFile();
    const whole = userLine('u1', 'one');
    writeFileSync(file, whole + userLine('u2', 'two').trimEnd());
    const b = await readBacklog(localIO, file, 50);
    expect(b.events.map(textOf)).toEqual(['one']);
    expect(b.offset).toBe(Buffer.byteLength(whole));
  });

  it('a window read that succeeds with fewer bytes than it asked for is unreadable, never a short window', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one') + userLine('u2', 'two'));
    const size = statSync(file).size;
    const io = { ...localIO, readFileFromBytesMeasured: async (p: string, o: number, n: number) => {
      const r = await localIO.readFileFromBytesMeasured(p, o, n);
      return r.ok ? { ...r, bytes: r.bytes.slice(1) } : r;
    } };
    expect(await readBacklog(io, file, 50)).toEqual({ events: [], offset: size, missing: false, measured: false, scanEnd: size });
  });

  it('a file that is one unterminated line answers no event at offset 0', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one').trimEnd());
    const b = await readBacklog(localIO, file, 50);
    expect(b.events).toEqual([]);
    expect(b.offset).toBe(0);
  });

  it('multibyte text across a read boundary decodes whole', async () => {
    const file = tmpFile();
    // A padding record that puts a 4-byte character's first byte one byte before the 256 KiB mark.
    const head = userLine('pad', 'p');
    const word = '\u{1F600}';
    const before = `${JSON.stringify({ uuid: 'mb', parentUuid: null, isSidechain: false, timestamp: '2026-11-24T10:00:00.000Z', type: 'user', message: { role: 'user', content: '' } })}`;
    const prefixLen = Buffer.byteLength(head) + Buffer.byteLength(before.slice(0, before.indexOf('"content":"') + '"content":"'.length));
    const fill = 'x'.repeat(READ_FROM_MAX_BYTES - 1 - prefixLen);
    const text = `${fill}${word}tail`;
    writeFileSync(file, head + userLine('mb', text));
    appendFileSync(file, userLine('u3', 'three'));
    expect(Buffer.from(head + userLine('mb', text)).indexOf(Buffer.from(word))).toBe(READ_FROM_MAX_BYTES - 1);
    const b = await readBacklog(localIO, file, 50);
    expect(b.events.map(textOf)).toEqual(['p', text, 'three']);
  });
});
