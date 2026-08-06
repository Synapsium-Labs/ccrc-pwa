import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NotifyLog } from '../src/notifylog.js';

const dir = async () => mkdtemp(path.join(tmpdir(), 'notifylog-'));

describe('NotifyLog', () => {
  it('persists epoch and seq as ONE atomic JSON value', async () => {
    const p = path.join(await dir(), 'n.json');
    const log = new NotifyLog(p);
    await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: 't', body: 'b' });
    await log.flush();
    const raw = JSON.parse(await readFile(p, 'utf8')) as { epoch: string; seq: number };
    // ONE object. A seq without its counter's lifetime is meaningless: written
    // separately, a death between the two writes forges a valid-looking pair
    // and silently drops real notifications.
    expect(Object.keys(raw).sort()).toEqual(['epoch', 'seq']);
    expect(raw.seq).toBe(1);
  });

  it('keeps its epoch across a reload, so a client seq stays trustworthy', async () => {
    const p = path.join(await dir(), 'n.json');
    const a = new NotifyLog(p); await a.load();
    a.record({ kind: 'ask', sessionId: 'cc-a', title: 't', body: 'b' });
    await a.flush();
    const b = new NotifyLog(p); await b.load();
    expect(b.epoch).toBe(a.epoch);
    expect(b.seq).toBe(1);
  });

  it('mints a NEW epoch when the file is missing, unreadable or malformed', async () => {
    const d = await dir();
    const a = new NotifyLog(path.join(d, 'a.json')); await a.load();
    const p = path.join(d, 'b.json');
    await writeFile(p, '{ this is not json');
    const b = new NotifyLog(p); await b.load();
    expect(b.epoch).not.toBe(a.epoch);
    expect(b.seq).toBe(0);
  });

  it('returns the events strictly after the client seq', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: '1', body: '' });
    log.record({ kind: 'done', sessionId: 'cc-b', title: '2', body: '' });
    const r = log.catchUp(log.epoch, 1);
    expect(r).toMatchObject({ resync: false });
    expect(r.events.map((e) => e.title)).toEqual(['2']);
  });

  it('demands a resync when the epoch differs — the seq means nothing', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: '1', body: '' });
    expect(log.catchUp('some-other-epoch', 0)).toMatchObject({ resync: true, events: [] });
  });

  it('demands a resync when the client seq predates the ring', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json'), 3); await log.load();
    for (let i = 0; i < 5; i++) log.record({ kind: 'done', sessionId: 'cc-a', title: String(i), body: '' });
    // seq 1 was evicted, so "everything after 1" cannot be proven complete.
    expect(log.catchUp(log.epoch, 1)).toMatchObject({ resync: true });
    expect(log.catchUp(log.epoch, 3)).toMatchObject({ resync: false });
  });

  it('demands a resync for a client that has never seen an epoch', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    expect(log.catchUp(null, 0)).toMatchObject({ resync: true });
  });

  it('demands a resync when the client seq is AHEAD of the server, under a matching epoch', async () => {
    // Reachable via a swallowed write (or, pre-serialization, a torn flush)
    // that lands the store on an older seq than a client already holds. A
    // confident `resync: false, events: []` here would be a wrong "nothing
    // happened", and every event the server records afterward at or below
    // that watermark would be silently dropped forever — the exact failure
    // the epoch exists to prevent.
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: '1', body: '' });
    expect(log.catchUp(log.epoch, 5)).toMatchObject({ resync: true, events: [] });
  });

  it('serializes concurrent flushes: the persisted file always matches the LAST call, never a torn or stale-but-valid one', async () => {
    const p = path.join(await dir(), 'n.json');
    const log = new NotifyLog(p); await log.load();
    // `pushOne` fires flush() void-dispatched, once per event, so several can
    // be in flight against the SAME tmp path in one tick — this is what that
    // looks like from the outside.
    const flushes: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      log.record({ kind: 'done', sessionId: 'cc-a', title: String(i), body: '' });
      flushes.push(log.flush());
    }
    await Promise.all(flushes);
    const raw = JSON.parse(await readFile(p, 'utf8')) as { epoch: string; seq: number };
    expect(raw.seq).toBe(5);
    expect(raw.epoch).toBe(log.epoch);
  });
});
