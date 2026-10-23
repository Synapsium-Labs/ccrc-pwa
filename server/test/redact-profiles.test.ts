// D-5867 (Task C1l PR 1; ARCH-66 (#801); spec 2026-10-19 K7's TS half): `shared/redact.mjs` is the one rule table, with
// explicit profiles. This file pins its shape: every profile lists its rule ids, no rule is unlisted, the two profiles
// share no rule (the URL-userinfo rule is two ids because the egress rule masks to the last `@` and the docs rule
// stops at the first), `redact` is idempotent per profile, and the module is browser-safe. The byte pins are
// `redact.test.ts`'s (the egress corpus, the docs corpus, the cross-profile rows) and `docs-parity.test.ts`'s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from './scan/parse.js';
import { DOCS_REDACT_RULES } from '../../shared/docs.js';
import { credentialMaskSource } from '../../shared/api.js';
import { PROFILES, RULE_IDS, docsRuleRows, redact } from '../../shared/redact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(here, '..', '..', 'shared', 'redact.mjs');
const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') };
const CORPUS: { input: string; output: string }[] =
  JSON.parse(readFileSync(path.join(here, 'fixtures/approvals/redact-corpus.json'), 'utf8'));
const FIXTURE: { docs: [string, string, string][] } =
  JSON.parse(readFileSync(path.join(here, 'fixtures/redact/profiles.json'), 'utf8'));

describe('shared/redact.mjs: profiles list their rule ids explicitly (D-5867)', () => {
  it('the egress profile is these rule ids, in this order', () => {
    expect([...PROFILES.egress]).toEqual([
      'json-pair', 'yaml-secret', 'jwt', 'secret-assigns', 'program-flags', 'header', 'bearer', 'secret-word',
      'url-userinfo-quoted', 'url-userinfo', 'user-quoted', 'user-flag', 'proxy-userinfo', 'cert-pass',
      'user-empty-pass', 'p-flag', 'p-quoted', 'secret-flag', 'single-dash-secret', 'camel-secret-flag', 'rdp-pass',
      'pass-arg', 'slack-hook', 'telegram-bot', 'known-token', 'token-segments',
    ]);
  });
  it('the docs profile is these rule ids, in this order', () => {
    expect([...PROFILES.docs]).toEqual(['docs-url-userinfo', 'docs-query-token', 'docs-gh-token', 'docs-authorization']);
  });
  it('a profile is a plain list: it inherits nothing', () => {
    for (const ids of Object.values(PROFILES)) {
      expect(Array.isArray(ids)).toBe(true);
      expect(Object.isFrozen(ids)).toBe(true);
      expect(new Set(ids).size, 'a profile lists a rule once').toBe(ids.length);
    }
  });
  it('no rule id is unlisted, and every listed id is a rule', () => {
    const listed = new Set(Object.values(PROFILES).flat());
    expect([...RULE_IDS].filter((id) => !listed.has(id))).toEqual([]);
    expect([...listed].filter((id) => !RULE_IDS.includes(id))).toEqual([]);
    expect(new Set(RULE_IDS).size, 'a rule id is unique').toBe(RULE_IDS.length);
  });
  it('the egress and docs profiles share no rule: the URL-userinfo rule is two ids', () => {
    const egress = new Set(PROFILES.egress);
    expect(PROFILES.docs.filter((id) => egress.has(id))).toEqual([]);
    expect(PROFILES.egress).toContain('url-userinfo');
    expect(PROFILES.docs).toContain('docs-url-userinfo');
  });
  it('DOCS_REDACT_RULES is the docs profile\'s rows, in order', () => {
    expect(docsRuleRows()).toEqual(DOCS_REDACT_RULES);
    expect(DOCS_REDACT_RULES.length).toBe(PROFILES.docs.length);
  });
});

describe('redact(profile, text): the entry point (D-5867)', () => {
  it('is idempotent per profile', () => {
    for (const r of CORPUS) expect(redact('egress', redact('egress', r.input, SHAPES), SHAPES), r.input).toBe(r.output);
    for (const [, input] of FIXTURE.docs) {
      const once = redact('docs', input);
      expect(redact('docs', once), input).toBe(once);
    }
  });
  it('the egress profile reads the generic sk- and JWT shapes from the caller (their one home is shared/api.ts)', () => {
    expect(() => redact('egress', 'x')).toThrow(/shapes/);
    expect(redact('docs', 'x')).toBe('x');
  });
  it('an unknown profile throws', () => {
    expect(() => redact('history-index' as never, 'x')).toThrow(/profile/);
  });
});

describe('shared/redact.mjs is browser-safe: the PWA bundles shared/docs.ts, which imports it (D-5867)', () => {
  const code = (): string => readFileSync(MODULE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  it('imports nothing: no import edge of any kind, no require call', () => {
    const p = parseFile(MODULE);
    expect(p.imports, 'import edges').toEqual([]);
    expect(p.calls.filter((c) => c.name === 'require'), 'require calls').toEqual([]);
  });
  it('the redactor is browser-safe: names no host global (process, Buffer, node:, require)', () => {
    const src = code();
    expect(/\bprocess\b/.test(src), 'process').toBe(false);
    expect(/\bBuffer\b/.test(src), 'Buffer').toBe(false);
    expect(/node:/.test(src), 'node:').toBe(false);
    expect(/\brequire\b/.test(src), 'require').toBe(false);
  });
  it('the redactor is browser-safe: importing it runs nothing but the table', async () => {
    const mod = await import('../../shared/redact.mjs');
    expect(Object.keys(mod).sort()).toEqual(['EGRESS_MASK', 'PROFILES', 'RULE_IDS', 'docsRuleRows', 'redact']);
  });
});
