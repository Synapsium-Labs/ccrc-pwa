import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readHookState, HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'claude2-MekWarLive';
const UUID = '1'.repeat(36);
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms, no relation to real time

const seed = (dir: string, id: string, body: unknown): void => {
  mkdirSync(dir, { recursive: true });
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  writeFileSync(path.join(dir, `${id}.hookstate.json`), text);
};

/** A complete, valid hookstate body — the writer's own shape. */
const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, state: 'working', event: 'UserPromptSubmit', sessionId: UUID, pid: 1234,
  updatedAt: NOW, ask: null, subagents: [],
  ...overrides,
});

describe('readHookState', () => {
  it('missing file → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('fresh + matching round-trips every field, including subagents', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({
      state: 'waiting',
      ask: {
        questions: [{
          question: 'Which?', header: 'Pick', multiSelect: true,
          options: [{ label: 'A', description: 'a' }, { label: 'B' }],
        }],
      },
      subagents: [{ name: 'reviewer', startedAt: NOW - 1000 }],
      interrupted: true,
    }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out).toEqual({
      state: 'waiting',
      updatedAt: NOW,
      ask: {
        questions: [{
          question: 'Which?', header: 'Pick', multiSelect: true,
          options: [{ label: 'A', description: 'a' }, { label: 'B' }],
        }],
      },
      subagents: [{ name: 'reviewer', startedAt: NOW - 1000 }],
      interrupted: true,
    });
  });

  it('the approval ask variant round-trips too', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'ls -la' } } }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.ask).toEqual({ approval: { tool: 'Bash', summary: 'ls -la' } });
  });

  it('subagents absent (e.g. a file from before the field existed) defaults to []', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['subagents'];
    seed(reg, ID, body);
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.subagents).toEqual([]);
  });

  it('interrupted absent → false', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'done' }));
    const out = await readHookState(localIO, reg, ID, UUID, NOW);
    expect(out?.interrupted).toBe(false);
  });

  it('stale by 31 minutes → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS - 60_000 }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('exactly at the freshness boundary is still fresh (not stale)', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: NOW - HOOKSTATE_FRESH_MS }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).not.toBeNull();
  });

  it('sessionId !== currentUuid → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ sessionId: '2'.repeat(36) }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('currentUuid null (registry has no uuid on record) → null, even against an empty sessionId', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ sessionId: '' }));
    expect(await readHookState(localIO, reg, ID, null, NOW)).toBeNull();
  });

  it("v:2 → null", async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ v: 2 }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it("state:'blocked' (a state this build does not know) → null", async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'blocked' }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('truncated JSON → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, '{"v":1,"state":"working"');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('valid JSON that is not an object (e.g. a bare string) → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, '"just a string"');
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('oversize payload (> 65536 bytes) → null, and never reaches JSON.parse', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    // Not even valid JSON — proves the length gate runs BEFORE parsing.
    seed(reg, ID, 'x'.repeat(70_000));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('updatedAt missing → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    const body = base();
    delete body['updatedAt'];
    seed(reg, ID, body);
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('updatedAt non-number → null', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ updatedAt: 'yesterday' }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('a malformed ask (neither questions nor approval shape) fails the WHOLE read, not just ask', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ state: 'waiting', ask: { nonsense: true } }));
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });

  it('a malformed subagents entry fails the whole read, not a partial list', async () => {
    const reg = mkTmp('ccrc-hookstate-');
    seed(reg, ID, base({ subagents: [{ name: 'reviewer' }] })); // missing startedAt
    expect(await readHookState(localIO, reg, ID, UUID, NOW)).toBeNull();
  });
});
