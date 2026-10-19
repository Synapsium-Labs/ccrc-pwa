// D-5517, D-5751 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A1): the lane's kind on the wire.
//
// `RosterWire` gains four optional, non-secret fields — `provider`, `kind`, `telemetry` and `managed` — each derived
// ONCE, from the parsed roster entry, by `rosterKindOf` (`shared/roster.ts`). The roster has no method field, so an
// Anthropic lane's kind is read from `exec.secretsFile`: present is `token`, absent is `sign-in`. An entry that does
// not say which provider it is carries no provider and no kind: absence is never defaulted to `anthropic`, so an
// older roster mirror read by a newer PWA shows no kind chip rather than a wrong one.
//
// The closed-union half ("no new field can carry a secret") is a compile-time fact and lives in the bypass fixture
// `test/types/bypasses/b8-roster-wire-open-string.ts`, asserted field by field by `ccdargv-brand.test.ts` (D-5751).
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AccountsResponse, RosterWire } from '../../shared/api.js';
import { parseRoster, rosterKindOf } from '../../shared/roster.js';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const entry = (id: string, hue: string, exec: Record<string, unknown>, telemetry = 'none'): Record<string, unknown> => ({
  id, label: id, configDirSuffix: `.claude-${id}`, exec, homeAble: false, hue, telemetry,
});

/** One lane of every shape the wire distinguishes. Neutral ids only (public repository). */
const ROSTER = {
  version: 1,
  accounts: [
    { ...entry('lane-a', 'cyan', { kind: 'upstream' }, 'anthropic'), homeAble: true },
    entry('lane-b', 'violet', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/lane-b-oauth.env' }, 'anthropic'),
    entry('lane-c', 'blue', {
      kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.local/share/ccrc/codex/lane-c',
    }, 'codex'),
    entry('lane-d', 'magenta', { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-d.env' }),
    entry('lane-e', 'amber', {
      kind: 'generated', provider: 'compatible', baseUrl: 'https://compatible.example.invalid', secretsFile: '.cc-secrets/lane-e.env',
    }),
    entry('lane-f', 'green', { kind: 'external' }),
    entry('lane-g', 'cyan', { kind: 'external', provider: 'openai' }),
  ],
};

const parsed = (): ReturnType<typeof parseRoster> => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { return parseRoster(ROSTER); } finally { warn.mockRestore(); }
};
const byId = (id: string) => {
  const a = parsed().accounts.find((x) => x.id === id);
  if (a === undefined) throw new Error(`fixture has no ${id}`);
  return a;
};

describe('rosterKindOf: the lane kind, derived once from the parsed entry (D-5517)', () => {
  it("a codex lane, an openrouter lane and a compatible lane each carry the provider and kind the spec's §4.1 names", () => {
    // §4.1's chips: `chatgpt · codex`, `openrouter · key`, `compatible · key`.
    expect(rosterKindOf(byId('lane-c'))).toEqual({ provider: 'openai', kind: 'codex', telemetry: 'codex', managed: true });
    expect(rosterKindOf(byId('lane-d'))).toEqual({ provider: 'openrouter', kind: 'key', telemetry: 'none' });
    expect(rosterKindOf(byId('lane-e'))).toEqual({ provider: 'compatible', kind: 'key', telemetry: 'none' });
  });

  it('an Anthropic lane with `exec.secretsFile` is token, and one without it is sign-in', () => {
    expect(rosterKindOf(byId('lane-b'))).toEqual({ provider: 'anthropic', kind: 'token', telemetry: 'anthropic' });
    // The upstream binary is `anthropic` by construction (`ExecSpec`'s header), and names no secrets file here.
    expect(rosterKindOf(byId('lane-a'))).toEqual({ provider: 'anthropic', kind: 'sign-in', telemetry: 'anthropic' });
  });

  it('an entry with no provider carries no provider or kind: absence is not anthropic', () => {
    const k = rosterKindOf(byId('lane-f'));
    expect(k).toEqual({ telemetry: 'none' });
    expect('provider' in k, 'an undeclared external lane must not grow a provider').toBe(false);
    expect('kind' in k).toBe(false);
    expect('managed' in k).toBe(false);
  });

  it('an OpenAI lane ccrc does not own is a codex lane that says so: managed is false, not absent', () => {
    expect(rosterKindOf(byId('lane-g'))).toEqual({ provider: 'openai', kind: 'codex', telemetry: 'none', managed: false });
  });

  it('managed rides OpenAI lanes only', () => {
    for (const id of ['lane-a', 'lane-b', 'lane-d', 'lane-e', 'lane-f']) {
      expect('managed' in rosterKindOf(byId(id)), id).toBe(false);
    }
  });
});

describe('GET /api/accounts carries the kind on every roster entry (D-5517)', () => {
  it('the handler spreads rosterKindOf onto each RosterWire, and still ships no launch detail', async () => {
    const home = mkTmp('ccrc-roster-kind-');
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    const base = testDeps(home);
    seedRoster(home, ROSTER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await buildServer({ ...base, cfg: loadConfig({ CCRC_HOME: home }) });
    let roster: RosterWire[];
    try {
      const res = await app.inject({ method: 'GET', url: '/api/accounts' });
      expect(res.statusCode).toBe(200);
      roster = (res.json() as AccountsResponse).roster;
    } finally {
      await app.close();
      warn.mockRestore();
    }
    const kinds = Object.fromEntries(roster.map((r) => [r.id, [r.provider, r.kind, r.telemetry, r.managed]]));
    expect(kinds).toEqual({
      'lane-a': ['anthropic', 'sign-in', 'anthropic', undefined],
      'lane-b': ['anthropic', 'token', 'anthropic', undefined],
      'lane-c': ['openai', 'codex', 'codex', true],
      'lane-d': ['openrouter', 'key', 'none', undefined],
      'lane-e': ['compatible', 'key', 'none', undefined],
      'lane-f': [undefined, undefined, 'none', undefined],
      'lane-g': ['openai', 'codex', 'none', false],
    });
    for (const r of roster) {
      expect(Object.keys(r), r.id).not.toContain('exec');
      expect(Object.keys(r), r.id).not.toContain('configDirSuffix');
      expect(Object.keys(r), r.id).not.toContain('secretsFile');
    }
  });
});
