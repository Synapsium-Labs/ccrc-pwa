// Single-definition scanners, area: the artifact tier against the walls tier (see ./helpers.ts for the doctrine and
// the shared walkers). Native Docs HTML artifacts, spec 2026-11-19 section 6.3, plan MX5.36.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ccrcRoot, rel, sources } from './helpers.js';

describe('single-definition: no shared policy between tiers', () => {
  const MOCKUP_IDENT = /\bMOCKUP_[A-Z0-9_]+/;
  /** A module specifier in any import form (`from '…'`, a bare `import '…'`, a dynamic `import('…')`) ending in
   *  `shared/artifacts`, with or without `.js`. */
  const ARTIFACTS_SPEC = /(?:\bfrom|\bimport)\s*\(?\s*['"][^'"]*shared\/artifacts(?:\.js)?['"]/;
  /** The same, for any module under the walls tier's `docs/mockup/` folder. */
  const MOCKUP_SPEC = /(?:\bfrom|\bimport)\s*\(?\s*['"][^'"]*docs\/mockup\/[^'"]*['"]/;

  it('CONTROL: the matchers fire on planted text', () => {
    expect(MOCKUP_IDENT.test("import { MOCKUP_CSP } from '../x';")).toBe(true);
    expect(MOCKUP_IDENT.test('const a = MOCKUP_SANDBOX_STATIC;')).toBe(true);
    expect(MOCKUP_IDENT.test('const a = ARTIFACT_CSP;')).toBe(false);
    expect(ARTIFACTS_SPEC.test("import { X } from '../../../../shared/artifacts';")).toBe(true);
    expect(ARTIFACTS_SPEC.test("export { X } from '../../../../shared/artifacts.js';")).toBe(true);
    expect(ARTIFACTS_SPEC.test("import '../../../../shared/artifacts.js';")).toBe(true);
    expect(ARTIFACTS_SPEC.test("const m = await import('../../../../shared/artifacts.js');")).toBe(true);
    expect(ARTIFACTS_SPEC.test("import { X } from '../../../../shared/docs';")).toBe(false);
    expect(MOCKUP_SPEC.test("import { mockupCsp } from '../../../pwa/src/docs/mockup/policy';")).toBe(true);
    expect(MOCKUP_SPEC.test("import { isMockupOrigin } from '../docs/mockup/origins.js';")).toBe(true);
    expect(MOCKUP_SPEC.test("import { isExactHttpsOrigin } from '../../../shared/httpsOrigin.js';")).toBe(false);
  });

  const artifactTier = (): string[] => {
    const dir = path.join(ccrcRoot, 'server', 'src', 'artifacts');
    return [...(existsSync(dir) ? sources(dir) : []), path.join(ccrcRoot, 'shared', 'artifacts.ts')];
  };

  it('no artifact-tier file names a MOCKUP_ identifier', () => {
    const holders = artifactTier().filter((f) => MOCKUP_IDENT.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });

  it('no artifact-tier file imports a module of the walls tier (docs/mockup/)', () => {
    const holders = artifactTier().filter((f) => MOCKUP_SPEC.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });

  it('no module of the walls tier imports shared/artifacts', () => {
    const dir = path.join(ccrcRoot, 'pwa', 'src', 'docs', 'mockup');
    const files = sources(dir);
    expect(files.map(rel)).toContain('pwa/src/docs/mockup/policy.ts');
    const holders = files.filter((f) => ARTIFACTS_SPEC.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });
});
