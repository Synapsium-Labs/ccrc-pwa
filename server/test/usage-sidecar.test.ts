import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import {
  USAGE_FRESH_S, parseUsageSidecar, readUsageMeasured, readUsage, usageSidecarPath,
} from '../src/usage.js';

const NOW = 1_800_000_000;
const row = (over: Record<string, unknown> = {}): string => JSON.stringify({
  ts: NOW - 10, uuid: 'u', account: 'zeta', model: 'claude-opus-5', effort: 'high',
  ctxPct: 12, cost: 1.25, agent: null, ...over,
});

describe('parseUsageSidecar', () => {
  it('reads a fresh row and derives the class from model.id', () => {
    expect(parseUsageSidecar(row(), NOW)).toEqual({ kind: 'reading', usage: {
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 12, cost: 1.25, stale: false,
    } });
  });
  it.each([
    ['claude-fable-5-1', 'fable'], ['claude-sonnet-5', 'sonnet'], ['claude-haiku-4-5-20251001', 'haiku'], ['gpt-6-astra', null],
  ])('%s classifies as %s through familyClassOf, never a local list', (model, cls) => {
    const r = parseUsageSidecar(row({ model }), NOW);
    expect(r.kind === 'reading' && r.usage.class).toBe(cls);
  });
  it('flags stale past USAGE_FRESH_S and not at it', () => {
    expect(USAGE_FRESH_S).toBe(1800);
    const at = parseUsageSidecar(row({ ts: NOW - USAGE_FRESH_S }), NOW);
    const past = parseUsageSidecar(row({ ts: NOW - USAGE_FRESH_S - 1 }), NOW);
    expect(at.kind === 'reading' && at.usage.stale).toBe(false);
    expect(past.kind === 'reading' && past.usage.stale).toBe(true);
  });
  it('nulls ride through as nulls; strings where numbers belong are nulls too', () => {
    const r = parseUsageSidecar(row({ effort: null, cost: null, ctxPct: '12' }), NOW);
    expect(r).toEqual({ kind: 'reading', usage: {
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: null, ctxPct: null, cost: null, stale: false,
    } });
  });
  it.each([
    ['not json', '{'], ['an array', '[]'], ['no ts', row({ ts: undefined })], ['a string ts', row({ ts: '1' })],
  ])('%s is malformed, never a reading', (_l, content) => {
    expect(parseUsageSidecar(content, NOW)).toEqual({ kind: 'malformed' });
  });
});

describe('readUsageMeasured keeps absent, unreadable and malformed apart', () => {
  it('absent', async () => {
    const home = mkTmp('ccrc-usage-read-');
    expect(await readUsageMeasured(localIO, path.join(home, '.cc-sessions'), 'demo-a', NOW)).toEqual({ kind: 'absent' });
  });
  it('unreadable', async () => {
    const io = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) } as unknown as FleetIO;
    expect(await readUsageMeasured(io, '/reg', 'demo-a', NOW)).toEqual({ kind: 'unreadable' });
  });
  it('malformed, and a reading, from the real path', async () => {
    const home = mkTmp('ccrc-usage-read-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(path.join(reg, 'usage'), { recursive: true });
    expect(usageSidecarPath(reg, 'demo-a')).toBe(path.join(reg, 'usage', 'demo-a.json'));
    writeFileSync(usageSidecarPath(reg, 'demo-a'), '{');
    expect(await readUsageMeasured(localIO, reg, 'demo-a', NOW)).toEqual({ kind: 'malformed' });
    writeFileSync(usageSidecarPath(reg, 'demo-a'), row());
    const r = await readUsageMeasured(localIO, reg, 'demo-a', NOW);
    expect(r.kind).toBe('reading');
  });
  it('readUsage is the documented fold: every non-reading is null', async () => {
    const home = mkTmp('ccrc-usage-read-');
    expect(await readUsage(localIO, path.join(home, '.cc-sessions'), 'demo-a', NOW)).toBeNull();
  });
});
