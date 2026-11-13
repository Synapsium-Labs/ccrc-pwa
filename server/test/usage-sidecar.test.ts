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
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 12, ctxTokens: null, ctxWindow: null, cost: 1.25, cacheExpiresAt: null,
      stale: false,
    } });
  });
  // D-8267: the prompt cache's expiry (`prompt_cache.expires_at`, epoch seconds), the idle-compaction prediction's input.
  it('carries cacheExpiresAt in the sidecar\'s own unit, and a row without one (an older hook) reads null', () => {
    const r = parseUsageSidecar(row({ cacheExpiresAt: NOW + 3000 }), NOW);
    expect(r.kind === 'reading' && r.usage.cacheExpiresAt).toBe(NOW + 3000);
    const none = parseUsageSidecar(row(), NOW);
    expect(none.kind === 'reading' && none.usage.cacheExpiresAt).toBeNull();
    const str = parseUsageSidecar(row({ cacheExpiresAt: String(NOW + 3000) }), NOW);
    expect(str.kind === 'reading' && str.usage.cacheExpiresAt).toBeNull();
  });
  // Overlord W0-18: the context's token count and the window's size, the renewal triggers' inputs. A row written before
  // the statusline carried them reads null for both, and a string or a negative is no reading either, never a 0.
  it('reads ctxTokens and ctxWindow, and a row without them (an older statusline) reads null for both', () => {
    const r = parseUsageSidecar(row({ ctxTokens: 71_000, ctxWindow: 1_000_000 }), NOW);
    expect(r.kind === 'reading' && [r.usage.ctxTokens, r.usage.ctxWindow]).toEqual([71_000, 1_000_000]);
    const old = parseUsageSidecar(row(), NOW);
    expect(old).toEqual({ kind: 'reading', usage: {
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: 'high', ctxPct: 12, ctxTokens: null, ctxWindow: null,
      cost: 1.25, cacheExpiresAt: null, stale: false,
    } });
  });
  it.each([
    ['a string', '71000', '1000000'],
    ['a negative', -1, -1_000_000],
    ['an explicit null', null, null],
  ] as const)('%s is no reading: ctxTokens and ctxWindow read null', (_label, tokens, window) => {
    const r = parseUsageSidecar(row({ ctxTokens: tokens, ctxWindow: window }), NOW);
    expect(r.kind === 'reading' && [r.usage.ctxTokens, r.usage.ctxWindow]).toEqual([null, null]);
  });
  // Review 1927 I2: Claude Code sends total_input_tokens 0 before the conversation's first API response, so a zero is
  // a missing sample, never a small context; a zero window would make a ratio NaN or Infinity.
  it.each([
    ['ctxTokens', { ctxTokens: 0, ctxWindow: 200_000 }, [null, 200_000]],
    ['ctxWindow', { ctxTokens: 50_000, ctxWindow: 0 }, [50_000, null]],
  ] as const)('a %s of zero is no reading: null, never 0', (_f, fields, want) => {
    const r = parseUsageSidecar(row(fields), NOW);
    expect(r.kind === 'reading' && [r.usage.ctxTokens, r.usage.ctxWindow]).toEqual(want);
  });
  it('CONTROL: one token and a one-token window are readings', () => {
    const r = parseUsageSidecar(row({ ctxTokens: 1, ctxWindow: 1 }), NOW);
    expect(r.kind === 'reading' && [r.usage.ctxTokens, r.usage.ctxWindow]).toEqual([1, 1]);
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
      ts: NOW - 10, model: 'claude-opus-5', class: 'opus', effort: null, ctxPct: null, ctxTokens: null, ctxWindow: null,
      cost: null, cacheExpiresAt: null, stale: false,
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
