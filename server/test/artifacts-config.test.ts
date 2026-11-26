// Native Docs HTML artifacts X5, plan Task A1.2: the config decision and the site rule (spec section 2.3). Every placeholder
// host is built from a label generated per run, so no case names a registrable host someone could own; every other host is
// under a reserved name (`.test`, `.invalid`).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { artifactConfig, siteRuleProblem, type ArtifactConfig } from '../src/artifacts/policy.js';
import { loadConfig } from '../src/config.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const genLabel = (): string => 't' + randomBytes(6).toString('hex');

const CONSOLE_PORT = 7788;

/** Narrow an answer to its `off` arm, failing the case when it is `on`. */
function off(c: ArtifactConfig): Extract<ArtifactConfig, { state: 'off' }> {
  if (c.state !== 'off') throw new Error(`expected off, got on: ${JSON.stringify(c)}`);
  return c;
}

describe('siteRuleProblem (spec 2.3 table)', () => {
  it('config: the five rows of the table give their verdicts', () => {
    const dk = '.duckdns.org';
    // Row 1: two names under a measured public suffix are different sites.
    expect(siteRuleProblem(genLabel() + dk, genLabel() + dk)).toBeNull();
    // Row 2: nip.io is not in the accept list, so it fails shut.
    expect(siteRuleProblem(genLabel() + '.nip.io', genLabel() + '.nip.io')).not.toBeNull();
    // Row 3: the same registrable site.
    expect(siteRuleProblem('ccrc.example.test', 'art.example.test')).not.toBeNull();
    // Row 4: no common label at all.
    expect(siteRuleProblem('ccrc.example.test', 'art.example.invalid')).toBeNull();
    // Row 5: co.uk is not listed, so it fails shut.
    expect(siteRuleProblem(genLabel() + '.co.uk', genLabel() + '.co.uk')).not.toBeNull();
  });

  it('config: nip.io refused', () => {
    const p = siteRuleProblem(genLabel() + '.nip.io', genLabel() + '.nip.io');
    expect(p).toContain('nip.io');
  });

  it('config: `ccrc.example.test` with `art.example.test` refused', () => {
    const p = siteRuleProblem('ccrc.example.test', 'art.example.test');
    expect(p).toContain('example.test');
  });

  it('a host that equals the console host is refused, and so is one below it', () => {
    const d = genLabel() + '.duckdns.org';
    expect(siteRuleProblem(d, d)).not.toBeNull();
    expect(siteRuleProblem(d, 'x.' + d)).not.toBeNull();
    expect(siteRuleProblem('x.' + d, d)).not.toBeNull();
  });

  it('config: an accept-list host above the console is refused', () => {
    const d = genLabel() + '.duckdns.org';
    expect(siteRuleProblem(d, 'duckdns.org')).not.toBeNull();
  });

  it('lower-cases both hosts and drops one trailing dot', () => {
    const l = genLabel();
    expect(siteRuleProblem(l.toUpperCase() + '.example.test', l + '.example.test.')).not.toBeNull();
    expect(siteRuleProblem(genLabel() + '.DuckDNS.org.', genLabel() + '.duckdns.org')).toBeNull();
  });

  it('a single shared label (a top-level domain) is accepted', () => {
    expect(siteRuleProblem('ccrc.example.test', 'art.other.test')).toBeNull();
  });
});

describe('artifactConfig', () => {
  const consoleOrigin = 'https://ccrc.example.test';

  it('an https tier with valid names is on, with the exact host fields', () => {
    const c = artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '7790' },
      consoleOrigin, CONSOLE_PORT);
    expect(c).toEqual({
      state: 'on', artifactOrigin: 'https://art.example.invalid', contentOrigin: 'https://content.example.invalid',
      port: 7790, artifactHost: 'art.example.invalid', contentHost: 'content.example.invalid',
    });
  });

  it('an https origin that states a port carries it in the host field', () => {
    const c = artifactConfig(
      { origin: 'https://art.example.invalid:8443', content: 'https://content.example.invalid', port: '7790' },
      consoleOrigin, CONSOLE_PORT);
    expect(c.state).toBe('on');
    if (c.state === 'on') expect(c.artifactHost).toBe('art.example.invalid:8443');
  });

  it('an origin that writes the default port :443 is off/invalid (a browser\'s Host never carries it)', () => {
    const r = off(artifactConfig(
      { origin: 'https://art.example.invalid:443', content: 'https://content.example.invalid', port: '7790' },
      consoleOrigin, CONSOLE_PORT));
    expect(r.why).toBe('invalid');
    expect(r.detail).toContain('CCRC_ARTIFACT_ORIGIN');
    expect(r.detail).toContain(':443');
  });

  it('config: a host a browser reads as an address is refused (the URL standard rewrites it)', () => {
    // Each of these passes the host grammar, but a browser reads it as IPv4 and rewrites it before use.
    for (const bad of ['https://10.0.0.01', 'https://10.1', 'https://art.0x7f', 'https://art.example.123']) {
      const r = off(artifactConfig({ origin: bad, content: 'https://content.example.invalid', port: '7790' }, consoleOrigin, CONSOLE_PORT));
      expect(r.why, bad).toBe('invalid');
      expect(r.detail, bad).toContain('CCRC_ARTIFACT_ORIGIN');
    }
  });

  it('config: a console reached by address is off/by-address', () => {
    const r = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '7790' }, 'https://10.0.0.1', CONSOLE_PORT));
    expect(r.why).toBe('by-address');
  });

  it('config: a port written with a leading zero is refused, so two spellings never make one origin', () => {
    const pairs: [string, string][] = [
      ['https://art.example.invalid', 'https://art.example.invalid:0443'],
      ['https://art.example.invalid:8443', 'https://art.example.invalid:08443'],
    ];
    for (const [origin, content] of pairs) {
      const r = off(artifactConfig({ origin, content, port: '7790' }, consoleOrigin, CONSOLE_PORT));
      expect(r.why, content).toBe('invalid');
      expect(r.detail, content).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    }
    expect(off(artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '07790' }, consoleOrigin, CONSOLE_PORT)).why)
      .toBe('invalid');
  });

  it('a duckdns pair under the accept list is on', () => {
    const c = artifactConfig(
      { origin: `https://${genLabel()}.duckdns.org`, content: `https://${genLabel()}.duckdns.org`, port: '7790' },
      `https://${genLabel()}.duckdns.org`, CONSOLE_PORT);
    expect(c.state).toBe('on');
  });

  it('a nip.io pair is off/invalid and the detail names the key and the shared site', () => {
    const c = off(artifactConfig(
      { origin: `https://${genLabel()}.nip.io`, content: `https://${genLabel()}.nip.io`, port: '7790' },
      `https://${genLabel()}.nip.io`, CONSOLE_PORT));
    expect(c.why).toBe('invalid');
    expect(c.detail).toContain('CCRC_ARTIFACT_ORIGIN');
    expect(c.detail).toContain('nip.io');
  });

  it('config: `ccrc.example.test` with `art.example.test` refused', () => {
    const c = off(artifactConfig(
      { origin: 'https://art.example.test', content: 'https://content.example.invalid', port: '7790' },
      consoleOrigin, CONSOLE_PORT));
    expect(c.why).toBe('invalid');
    expect(c.detail).toContain('CCRC_ARTIFACT_ORIGIN');
  });

  it('the content origin goes through the site rule too', () => {
    const c = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.test', port: '7790' },
      consoleOrigin, CONSOLE_PORT));
    expect(c.why).toBe('invalid');
    expect(c.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
  });

  it('config: an accept-list host above the console is refused', () => {
    const d = genLabel() + '.duckdns.org';
    const c = off(artifactConfig(
      { origin: 'https://duckdns.org', content: `https://${genLabel()}.duckdns.org`, port: '7790' },
      `https://${d}`, CONSOLE_PORT));
    expect(c.why).toBe('invalid');
  });

  it('a host equal to the console host or below it is refused', () => {
    const d = genLabel() + '.duckdns.org';
    const eq = off(artifactConfig(
      { origin: `https://${d}:8443`, content: `https://${genLabel()}.duckdns.org`, port: '7790' }, `https://${d}`, CONSOLE_PORT));
    expect(eq.why).toBe('invalid');
    const below = off(artifactConfig(
      { origin: `https://x.${d}`, content: `https://${genLabel()}.duckdns.org`, port: '7790' }, `https://${d}`, CONSOLE_PORT));
    expect(below.why).toBe('invalid');
  });

  it('no keys is off/unset', () => {
    expect(off(artifactConfig({}, consoleOrigin, CONSOLE_PORT)).why).toBe('unset');
  });

  it('empty strings count as absent: all empty is off/unset', () => {
    expect(off(artifactConfig({ origin: '', content: '', port: '' }, consoleOrigin, CONSOLE_PORT)).why).toBe('unset');
  });

  it('config: two of three is `off/partial`', () => {
    const o = 'https://art.example.invalid';
    const c = 'https://content.example.invalid';
    const pairs: Array<[Parameters<typeof artifactConfig>[0], string]> = [
      [{ origin: o, content: c }, 'CCRC_ARTIFACT_PORT'],
      [{ origin: o, port: '7790' }, 'CCRC_ARTIFACT_CONTENT_ORIGIN'],
      [{ content: c, port: '7790' }, 'CCRC_ARTIFACT_ORIGIN'],
    ];
    for (const [env, missing] of pairs) {
      const r = off(artifactConfig(env, consoleOrigin, CONSOLE_PORT));
      expect(r.why).toBe('partial');
      expect(r.detail).toContain(missing);
    }
  });

  it('one of three is off/partial, naming both missing keys', () => {
    const r = off(artifactConfig({ origin: 'https://art.example.invalid' }, consoleOrigin, CONSOLE_PORT));
    expect(r.why).toBe('partial');
    expect(r.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    expect(r.detail).toContain('CCRC_ARTIFACT_PORT');
  });

  it('a bare empty string counts as missing', () => {
    const r = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '' },
      consoleOrigin, CONSOLE_PORT));
    expect(r.why).toBe('partial');
    expect(r.detail).toContain('CCRC_ARTIFACT_PORT');
  });

  describe('off/invalid names the key', () => {
    const good = { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '7790' };
    const cases: Array<[string, Parameters<typeof artifactConfig>[0], string]> = [
      ['an http origin on a non-loopback host', { ...good, origin: 'http://art.example.invalid' }, 'CCRC_ARTIFACT_ORIGIN'],
      ['an http content origin on a non-loopback host', { ...good, content: 'http://content.example.invalid' }, 'CCRC_ARTIFACT_CONTENT_ORIGIN'],
      ['a trailing slash', { ...good, origin: 'https://art.example.invalid/' }, 'CCRC_ARTIFACT_ORIGIN'],
      ['a path', { ...good, content: 'https://content.example.invalid/x' }, 'CCRC_ARTIFACT_CONTENT_ORIGIN'],
      ['an upper-case host', { ...good, origin: 'https://ART.example.invalid' }, 'CCRC_ARTIFACT_ORIGIN'],
      ['equal artifact and content origins', { ...good, content: good.origin }, 'CCRC_ARTIFACT_CONTENT_ORIGIN'],
      ['an artifact origin equal to the console origin', { ...good, origin: 'https://ccrc.example.test' }, 'CCRC_ARTIFACT_ORIGIN'],
      ['a content origin equal to the console origin', { ...good, content: 'https://ccrc.example.test' }, 'CCRC_ARTIFACT_CONTENT_ORIGIN'],
      ['a port equal to the console port', { ...good, port: String(CONSOLE_PORT) }, 'CCRC_ARTIFACT_PORT'],
      ['a non-numeric port', { ...good, port: 'seven' }, 'CCRC_ARTIFACT_PORT'],
      ['a port with a sign', { ...good, port: '+7790' }, 'CCRC_ARTIFACT_PORT'],
      ['a port of zero', { ...good, port: '0' }, 'CCRC_ARTIFACT_PORT'],
      ['a port past 65535', { ...good, port: '65536' }, 'CCRC_ARTIFACT_PORT'],
    ];
    for (const [title, env, key] of cases) {
      it(title, () => {
        const r = off(artifactConfig(env, consoleOrigin, CONSOLE_PORT));
        expect(r.why).toBe('invalid');
        expect(r.detail).toContain(key);
      });
    }

    it('a console origin that is neither https nor loopback names CCRC_ORIGIN', () => {
      const r = off(artifactConfig(good, 'http://ccrc.example.test', CONSOLE_PORT));
      expect(r.why).toBe('invalid');
      expect(r.detail).toContain('CCRC_ORIGIN');
    });
  });

  describe('loopback (development and the browser suite)', () => {
    const lo = 'http://localhost:7788';

    it('console localhost with two 127.0.0.1 origins is on, host fields with their ports', () => {
      const c = artifactConfig(
        { origin: 'http://127.0.0.1:7790', content: 'http://127.0.0.1:7791', port: '7792' }, lo, 7788);
      expect(c).toEqual({
        state: 'on', artifactOrigin: 'http://127.0.0.1:7790', contentOrigin: 'http://127.0.0.1:7791', port: 7792,
        artifactHost: '127.0.0.1:7790', contentHost: '127.0.0.1:7791',
      });
    });

    it('an artifact origin on localhost is the same site and off/invalid', () => {
      const r = off(artifactConfig(
        { origin: 'http://localhost:7790', content: 'http://127.0.0.1:7791', port: '7792' }, lo, 7788));
      expect(r.why).toBe('invalid');
      expect(r.detail).toContain('CCRC_ARTIFACT_ORIGIN');
    });

    it('any other http origin beside a loopback console is off/invalid', () => {
      const r = off(artifactConfig(
        { origin: 'http://127.0.0.1:7790', content: 'http://art.example.invalid', port: '7792' }, lo, 7788));
      expect(r.why).toBe('invalid');
      expect(r.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    });

    it('an https origin beside a loopback console is off/invalid (loopback is for development only)', () => {
      const r = off(artifactConfig(
        { origin: 'http://127.0.0.1:7790', content: 'https://content.example.invalid', port: '7792' }, lo, 7788));
      expect(r.why).toBe('invalid');
      expect(r.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    });

    it('a loopback origin on the console port, or with a leading-zero port, is off/invalid', () => {
      const own = off(artifactConfig({ origin: 'http://127.0.0.1:7788', content: 'http://127.0.0.1:7791', port: '7792' }, lo, 7788));
      expect(own.why).toBe('invalid');
      expect(own.detail).toContain('CCRC_ARTIFACT_ORIGIN');
      const zero = off(artifactConfig({ origin: 'http://127.0.0.1:7790', content: 'http://127.0.0.1:07790', port: '7792' }, lo, 7788));
      expect(zero.why).toBe('invalid');
      expect(zero.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    });

    it('a loopback origin with a trailing slash, a path or no port is off/invalid', () => {
      for (const bad of ['http://127.0.0.1:7790/', 'http://127.0.0.1:7790/x', 'http://127.0.0.1']) {
        const r = off(artifactConfig({ origin: bad, content: 'http://127.0.0.1:7791', port: '7792' }, lo, 7788));
        expect(r.why).toBe('invalid');
      }
    });

    it('equal loopback origins are off/invalid', () => {
      const r = off(artifactConfig(
        { origin: 'http://127.0.0.1:7790', content: 'http://127.0.0.1:7790', port: '7792' }, lo, 7788));
      expect(r.why).toBe('invalid');
      expect(r.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    });

    it('an http://127.0.0.1 artifact origin beside an https console is off/invalid', () => {
      const r = off(artifactConfig(
        { origin: 'http://127.0.0.1:7790', content: 'http://127.0.0.1:7791', port: '7792' }, consoleOrigin, CONSOLE_PORT));
      expect(r.why).toBe('invalid');
    });

  });

  it('exposeMode ip is off/by-address with no keys and with all three', () => {
    expect(off(artifactConfig({ exposeMode: 'ip' }, consoleOrigin, CONSOLE_PORT)).why).toBe('by-address');
    const all = artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '7790', exposeMode: 'ip' },
      consoleOrigin, CONSOLE_PORT);
    expect(off(all).why).toBe('by-address');
  });

  it('exposeMode ip with a partial set is by-address too (an address has no second site)', () => {
    expect(off(artifactConfig({ origin: 'https://art.example.invalid', exposeMode: 'ip' }, consoleOrigin, CONSOLE_PORT)).why)
      .toBe('by-address');
  });

  it('never throws on hostile values', () => {
    for (const v of ['', ' ', '\u0000', 'https://', 'https://:', 'https://a:b:c', '://', 'http://127.0.0.1:99999', 'x'.repeat(5000)]) {
      expect(() => artifactConfig({ origin: v, content: v, port: v }, v, 0)).not.toThrow();
      expect(() => artifactConfig({ origin: v, content: 'https://c.example.invalid', port: '7790' }, consoleOrigin, CONSOLE_PORT)).not.toThrow();
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
