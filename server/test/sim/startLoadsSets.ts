// `startLoadsOf`'s oracle and mutant set (Overlord W1 sandbox, Task 5: w1-sandbox.md). Its cases are written ONCE here, as
// suite cases over a module: `continuity-start-loads-route.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type StartLoadsModule = typeof import('../../src/continuity/startLoads.js');

const D = 'a'.repeat(64);
/** A well-formed body, as the hook sends it. */
export const goodLoads = (over: Record<string, unknown> = {}, loaded: Record<string, unknown> = {}): Record<string, unknown> => ({
  fromId: 'lane-a-project-a', fromUuid: '11111111-2222-3333-4444-555555555555', reportId: 'r-0001-abcd', profileRole: 'overlord',
  profileDigest: D, launchRc: 'off', claudeVersion: '2.1.325', permissionMode: 'bypassPermissions', cwdInWorkspace: true,
  reportedAt: 1000,
  loaded: { instructions: [{ type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: 'b'.repeat(64) }], hooks: ['c'.repeat(64)],
    skills: ['ccrc-overlord'], agents: ['Explore'], tools: ['Agent', 'mcp__door__read'], toolServers: ['door'], ...loaded },
  ...over,
});

export function startLoadsCases(m: StartLoadsModule): Record<string, SuiteCase> {
  const field = (b: unknown): string | null => { const v = m.startLoadsOf(b); return v.ok ? null : v.field; };
  return {
    'a good body narrows whole, and unmeasured stays a word': () => {
      const v = m.startLoadsOf(goodLoads({}, { agents: 'unmeasured' }));
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.report.loaded.agents).toBe('unmeasured');
      expect(v.report.loaded.tools).toStrictEqual(['Agent', 'mcp__door__read']);
      expect(v.report.carriedFrom).toBeNull();
    },
    'each malformed field is refused, naming it': () => {
      expect(field(goodLoads({ reportId: 'x' }))).toBe('reportId');
      expect(field(goodLoads({ profileDigest: 'A'.repeat(64) }))).toBe('profileDigest');
      expect(field(goodLoads({ profileDigest: 'a'.repeat(63) }))).toBe('profileDigest');
      expect(field(goodLoads({ claudeVersion: 'v2 beta' }))).toBe('claudeVersion');
      expect(field(goodLoads({ launchRc: 'maybe' }))).toBe('launchRc');
      expect(field(goodLoads({ cwdInWorkspace: 'yes' }))).toBe('cwdInWorkspace');
      expect(field(goodLoads({ reportedAt: -1 }))).toBe('reportedAt');
      expect(field(goodLoads({ carriedFrom: 'bad id!' }))).toBe('carriedFrom');
      expect(field(goodLoads({ loaded: [] }))).toBe('loaded');
    },
    'a malformed known kind and an over-long list are refused; a hook digest of the wrong shape too': () => {
      expect(field(goodLoads({}, { skills: 'none' }))).toBe('loaded.skills');
      expect(field(goodLoads({}, { skills: Array.from({ length: 201 }, (_, i) => `s${i}`) }))).toBe('loaded.skills');
      expect(field(goodLoads({}, { hooks: ['not-a-digest'] }))).toBe('loaded.hooks');
      expect(field(goodLoads({}, { instructions: [{ type: 'Project', name: 'a/b', inWorkspace: true, sha256: D }] }))).toBe('loaded.instructions');
    },
    'an unknown kind is ignored and the rest kept; a known kind left out reads unmeasured': () => {
      const body = goodLoads({}, { deferredTools: ['x'], newKind: 7 });
      delete (body['loaded'] as Record<string, unknown>)['toolServers'];
      const v = m.startLoadsOf(body);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(Object.keys(v.report.loaded).sort()).toStrictEqual(['agents', 'hooks', 'instructions', 'skills', 'toolServers', 'tools']);
      expect(v.report.loaded.toolServers).toBe('unmeasured');
    },
    'the body hash leaves reportedAt out, and changes with what was loaded': () => {
      const a = m.startLoadsOf(goodLoads());
      const b = m.startLoadsOf(goodLoads({ reportedAt: 2000 }));
      const c = m.startLoadsOf(goodLoads({}, { skills: ['ccrc-overlord', 'other'] }));
      if (!a.ok || !b.ok || !c.ok) throw new Error('premise');
      expect(b.report.bodySha256).toBe(a.report.bodySha256);
      expect(c.report.bodySha256).not.toBe(a.report.bodySha256);
    },
  };
}

/** `startLoadsOf`'s mutants: accept each malformed field, and refuse an unknown kind. */
const START_LOADS_SET: MutantSet<StartLoadsModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/startLoads.ts'),
  mutants: [
    { id: 'L1', old: 'const DIGEST_RE = /^[0-9a-f]{64}$/;', new: 'const DIGEST_RE = /^[0-9a-fA-F]{63,64}$/;' },
    { id: 'L2', old: "if (!matches(REPORT_ID_RE)(b['reportId'])) return { ok: false, field: 'reportId' };", new: '' },
    { id: 'L3', old: 'if (!Array.isArray(v) || v.length > START_LOADS_MAX_LIST) return undefined;', new: 'if (!Array.isArray(v)) return undefined;' },
    { id: 'L4', old: "if (v === undefined) return { ok: false, field: `loaded.${k}` };", new: "if (v === undefined) { loaded[k] = UNMEASURED; continue; }" },
    { id: 'L5', old: "  if (claudeVersion === undefined) return { ok: false, field: 'claudeVersion' };\n", new: '' },
    { id: 'L6', old: '  for (const k of START_LOAD_KINDS) {\n    const v =', new: '  for (const k of [...START_LOAD_KINDS, ...Object.keys(raw).filter((x) => !(START_LOAD_KINDS as readonly string[]).includes(x))] as StartLoadKind[]) {\n    const v =' },
    { id: 'L7', old: "const v = Object.hasOwn(raw, k) ? kindOf(k, raw[k]) : UNMEASURED;", new: "const v = Object.hasOwn(raw, k) ? kindOf(k, raw[k]) : [];" },
    { id: 'L8', old: "  if (launchRc === undefined) return { ok: false, field: 'launchRc' };\n", new: '' },
  ],
  suite: startLoadsCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const START_LOADS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/startLoads.ts#startLoadsOf': START_LOADS_SET as MutantSet<never>,
};
