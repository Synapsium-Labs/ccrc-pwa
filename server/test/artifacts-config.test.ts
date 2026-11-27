// Native Docs HTML artifacts X5, plan Task A1.2: the config decision and the site rule (spec section 2.3). Every placeholder
// host is built from a label generated per run, so no case names a registrable host someone could own; every other host is
// under a reserved name (`.test`, `.invalid`).
//
// The site-rule and config cases live in ONE table, `fixtures/artifact-site-rule.json`, which `ccrc-expose-artifacts.test.ts`
// runs against the bash mirror in `ccd/ccrc` too: the server and the shell refuse and accept exactly the same things. Only
// the hostile-values case and the `loadConfig` cases stay as code here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactConfig, siteRuleProblem, type ArtifactConfig } from '../src/artifacts/policy.js';
import { ARTIFACT_PUBLIC_SUFFIXES } from '../../shared/artifacts.js';
import { loadConfig } from '../src/config.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const genLabel = (): string => 't' + randomBytes(6).toString('hex');

const CONSOLE_PORT = 7788;

const here = path.dirname(fileURLToPath(import.meta.url));

interface SiteCheck { console: string; host: string; accepted: boolean; detailHas?: string[]; detailLacks?: string[] }
interface SiteCase { case: string; checks: SiteCheck[] }
interface ConfigEnv { origin?: string; content?: string; port?: string; exposeMode?: string }
interface ConfigCheck {
  console: string; consolePort: number; env: ConfigEnv; state: 'on' | 'off';
  why?: string; detailHas?: string[]; detailLacks?: string[]; hosts?: { artifact: string; content: string };
}
interface ConfigCase { describe?: string; case: string; checks: ConfigCheck[] }
interface Table { about: string; acceptList: string[]; siteCases: SiteCase[]; configCases: ConfigCase[] }

const table = JSON.parse(readFileSync(path.join(here, 'fixtures', 'artifact-site-rule.json'), 'utf8')) as Table;

/** One check with its placeholders filled: `{a}` to `{d}` are labels drawn fresh for this check (one label per token within
 *  it), `{A}` is `{a}` in upper case. The JSON text is substituted whole, then parsed back. */
function fresh<T>(check: T): T {
  const labels: Record<string, string> = { a: genLabel(), b: genLabel(), c: genLabel(), d: genLabel() };
  const text = JSON.stringify(check).replace(/\{([a-dA-D])\}/g,
    (_m: string, k: string): string => (k === k.toLowerCase() ? labels[k]! : labels[k.toLowerCase()]!.toUpperCase()));
  return JSON.parse(text) as T;
}

/** Narrow an answer to its `off` arm, failing the case when it is `on`. */
function off(c: ArtifactConfig): Extract<ArtifactConfig, { state: 'off' }> {
  if (c.state !== 'off') throw new Error(`expected off, got on: ${JSON.stringify(c)}`);
  return c;
}

function runSiteCheck(raw: SiteCheck): void {
  const k = fresh(raw);
  const msg = JSON.stringify(k);
  const p = siteRuleProblem(k.console, k.host);
  if (k.accepted) expect(p, msg).toBeNull();
  else expect(p, msg).not.toBeNull();
  for (const w of k.detailHas ?? []) expect(p, msg).toContain(w);
  for (const w of k.detailLacks ?? []) expect(p, msg).not.toContain(w);
}

function runConfigCheck(raw: ConfigCheck): void {
  const k = fresh(raw);
  const msg = JSON.stringify(k);
  const c = artifactConfig(k.env, k.console, k.consolePort);
  expect(c.state, msg).toBe(k.state);
  if (c.state === 'on') {
    if (k.hosts) {
      expect(c, msg).toEqual({
        state: 'on', artifactOrigin: k.env.origin, contentOrigin: k.env.content, port: Number(k.env.port),
        artifactHost: k.hosts.artifact, contentHost: k.hosts.content,
      });
    }
    return;
  }
  expect(c.why, msg).toBe(k.why);
  for (const w of k.detailHas ?? []) expect(c.detail, msg).toContain(w);
  for (const w of k.detailLacks ?? []) expect(c.detail, msg).not.toContain(w);
}

describe('siteRuleProblem (spec 2.3 table)', () => {
  it("the table's accept list is ARTIFACT_PUBLIC_SUFFIXES", () => {
    expect([...ARTIFACT_PUBLIC_SUFFIXES]).toEqual(table.acceptList);
  });

  for (const sc of table.siteCases) {
    it(sc.case, () => {
      for (const check of sc.checks) runSiteCheck(check);
    });
  }
});

describe('artifactConfig', () => {
  const consoleOrigin = 'https://ccrc.example.test';

  // Cases without a `describe` are tests of this block; the others are grouped, in order of first appearance, under a
  // nested describe of the title they carry.
  const nested = new Set<string>();
  for (const cc of table.configCases) {
    if (cc.describe === undefined) {
      it(cc.case, () => {
        for (const check of cc.checks) runConfigCheck(check);
      });
    } else if (!nested.has(cc.describe)) {
      nested.add(cc.describe);
      const title = cc.describe;
      describe(title, () => {
        for (const inner of table.configCases.filter((x: ConfigCase): boolean => x.describe === title)) {
          it(inner.case, () => {
            for (const check of inner.checks) runConfigCheck(check);
          });
        }
      });
    }
  }

  it('never throws on hostile values, and a hostile console origin never turns the tier on', () => {
    const good = { origin: 'https://art.example.invalid', content: 'https://c.example.invalid', port: '7790' };
    for (const v of ['', ' ', '\u0000', 'https://', 'https://:', 'https://a:b:c', '://', 'http://127.0.0.1:99999', 'x'.repeat(5000)]) {
      expect(() => artifactConfig({ origin: v, content: v, port: v }, v, 0)).not.toThrow();
      expect(() => artifactConfig({ origin: v, content: 'https://c.example.invalid', port: '7790' }, consoleOrigin, CONSOLE_PORT)).not.toThrow();
      expect(() => artifactConfig(good, v, CONSOLE_PORT)).not.toThrow();
      expect(artifactConfig(good, v, CONSOLE_PORT).state, `console origin ${JSON.stringify(v.slice(0, 20))}`).toBe('off');
    }
  });
});

describe('loadConfig carries the artifact decision', () => {
  const home = mkTmp('artcfg-');
  seedRoster(home);
  const ROSTER = path.join(home, '.ccrc', 'accounts.json');
  const base = { CCRC_HOME: home, CCRC_ACCOUNTS: ROSTER };

  afterEach(() => vi.restoreAllMocks());

  const artifactWarns = (spy: ReturnType<typeof vi.spyOn>): string[] =>
    spy.mock.calls.map((a: readonly unknown[]) => String(a[0])).filter((l: string) => l.startsWith('ccrc-server: artifact tier off'));

  it('all three valid keys give cfg.artifact on, and no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({
      ...base, CCRC_ORIGIN: 'https://ccrc.example.test',
      CCRC_ARTIFACT_ORIGIN: 'https://art.example.invalid', CCRC_ARTIFACT_CONTENT_ORIGIN: 'https://content.example.invalid',
      CCRC_ARTIFACT_PORT: '7790',
    });
    expect(cfg.artifact.state).toBe('on');
    expect(artifactWarns(warn)).toEqual([]);
  });

  it('the default console origin is the loopback one, and the loopback pair is on', () => {
    const cfg = loadConfig({
      ...base,
      CCRC_ARTIFACT_ORIGIN: 'http://127.0.0.1:7790', CCRC_ARTIFACT_CONTENT_ORIGIN: 'http://127.0.0.1:7791',
      CCRC_ARTIFACT_PORT: '7792',
    });
    expect(cfg.origin).toBe('http://localhost:7788');
    expect(cfg.artifact.state).toBe('on');
  });

  it('two keys give exactly one warning line starting `ccrc-server: artifact tier off`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({
      ...base, CCRC_ORIGIN: 'https://ccrc.example.test',
      CCRC_ARTIFACT_ORIGIN: 'https://art.example.invalid', CCRC_ARTIFACT_CONTENT_ORIGIN: 'https://content.example.invalid',
    });
    expect(off(cfg.artifact).why).toBe('partial');
    const lines = artifactWarns(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('CCRC_ARTIFACT_PORT');
  });

  it('an invalid set warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({
      ...base, CCRC_ORIGIN: 'https://ccrc.example.test',
      CCRC_ARTIFACT_ORIGIN: 'http://art.example.invalid', CCRC_ARTIFACT_CONTENT_ORIGIN: 'https://content.example.invalid',
      CCRC_ARTIFACT_PORT: '7790',
    });
    expect(off(cfg.artifact).why).toBe('invalid');
    expect(artifactWarns(warn)).toHaveLength(1);
  });

  it('no keys gives off/unset and no artifact warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({ ...base });
    expect(off(cfg.artifact).why).toBe('unset');
    expect(artifactWarns(warn)).toEqual([]);
  });

  it('CCRC_EXPOSE_MODE=ip gives off/by-address and no artifact warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({
      ...base, CCRC_EXPOSE_MODE: 'ip',
      CCRC_ARTIFACT_ORIGIN: 'http://127.0.0.1:7790', CCRC_ARTIFACT_CONTENT_ORIGIN: 'http://127.0.0.1:7791',
      CCRC_ARTIFACT_PORT: '7792',
    });
    expect(off(cfg.artifact).why).toBe('by-address');
    expect(artifactWarns(warn)).toEqual([]);
  });

  it('the decision reads the resolved console port', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig({
      ...base, CCRC_PORT: '7790',
      CCRC_ARTIFACT_ORIGIN: 'http://127.0.0.1:7791', CCRC_ARTIFACT_CONTENT_ORIGIN: 'http://127.0.0.1:7792',
      CCRC_ARTIFACT_PORT: '7790',
    });
    expect(off(cfg.artifact).why).toBe('invalid');
  });
});
