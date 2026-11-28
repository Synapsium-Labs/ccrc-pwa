// Native Docs HTML artifacts X5, wave A5's first items (D-9161, the coordinator's ruling of 2026-11-27 on the A2 review's carry):
// an artifact or content origin whose name the console's answer mask would alter (it has a credential's shape) turns the tier off
// as `invalid`, naming the key. Before this, every mint drew its token eight times against the mask and answered `unmeasured`
// with nothing saying why, while the availability read said the tier was on. Every host is under a reserved name (`.test`,
// `.invalid`); the shaped labels are built at run time.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { artifactConfig, type ArtifactConfig } from '../src/artifacts/policy.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { matchesShape } from '../src/accounts/shapes.js';
import { loadConfig } from '../src/config.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const CONSOLE = 'https://ccrc.example.test';
const CONSOLE_PORT = 7788;
/** A label the generic credential shape matches: `sk-` and eight or more token characters, built per run. */
const shapedLabel = (): string => 'sk-' + randomBytes(6).toString('hex');
/** A label one character short of that shape: `sk-` and seven characters. */
const nearMissLabel = (): string => 'sk-' + randomBytes(4).toString('hex').slice(0, 7);
/** The shape-only answer mask, as the server's own wiring asks it. */
const masks = (v: string): boolean => SHAPE_ONLY_MASKER.maskText(v) !== v;

function off(c: ArtifactConfig): Extract<ArtifactConfig, { state: 'off' }> {
  if (c.state !== 'off') throw new Error(`expected off, got on: ${JSON.stringify(c)}`);
  return c;
}

describe('config: a name the answer mask would alter turns the tier off (D-9161)', () => {
  it('CONTROL: the shape-only mask alters the shaped label and leaves the near miss alone, as the shape half loadConfig asks does', () => {
    const shaped = `https://${shapedLabel()}.art.invalid`;
    const near = `https://${nearMissLabel()}.art.invalid`;
    expect(masks(shaped)).toBe(true);
    expect(masks(near)).toBe(false);
    expect(matchesShape(shaped)).toBe(true);
    expect(matchesShape(near)).toBe(false);
  });

  it('config: an artifact origin the mask would alter is off/invalid, naming the key and never echoing the value', () => {
    const label = shapedLabel();
    const r = off(artifactConfig(
      { origin: `https://${label}.art.invalid`, content: 'https://content.example.invalid', port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(r.why).toBe('invalid');
    expect(r.detail).toContain('CCRC_ARTIFACT_ORIGIN');
    expect(r.detail).not.toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    expect(r.detail).not.toContain(label);
  });

  it('config: a content origin the mask would alter is off/invalid, naming its key', () => {
    const label = shapedLabel();
    const r = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: `https://${label}.content.invalid`, port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(r.why).toBe('invalid');
    expect(r.detail).toContain('CCRC_ARTIFACT_CONTENT_ORIGIN');
    expect(r.detail).not.toContain(label);
  });

  it('config: a near miss of the shape stays on', () => {
    const c = artifactConfig(
      { origin: `https://${nearMissLabel()}.art.invalid`, content: `https://${nearMissLabel()}.content.invalid`, port: '7790' },
      CONSOLE, CONSOLE_PORT, masks);
    expect(c.state).toBe('on');
  });

  it('config: the site rule is decided before the mask, so a name both refuse is the site rule\'s refusal, not the mask\'s', () => {
    const r = off(artifactConfig(
      { origin: `https://${shapedLabel()}.example.test`, content: 'https://content.example.invalid', port: '7790' },
      CONSOLE, CONSOLE_PORT, masks));
    expect(r.why).toBe('invalid');
    expect(r.detail).not.toContain('answer mask');
  });
});

describe('loadConfig asks the server\'s own answer mask (D-9161)', () => {
  const home = mkTmp('artmask-');
  seedRoster(home);
  const base = { CCRC_HOME: home, CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json') };

  afterEach(() => vi.restoreAllMocks());

  it('config: a shaped artifact label read from the environment turns the tier off with one warning naming the key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const label = shapedLabel();
    const cfg = loadConfig({
      ...base, CCRC_ORIGIN: CONSOLE,
      CCRC_ARTIFACT_ORIGIN: `https://${label}.art.invalid`, CCRC_ARTIFACT_CONTENT_ORIGIN: 'https://content.example.invalid',
      CCRC_ARTIFACT_PORT: '7790',
    });
    expect(off(cfg.artifact).why).toBe('invalid');
    const lines = warn.mock.calls.map((a: readonly unknown[]) => String(a[0])).filter((l) => l.startsWith('ccrc-server: artifact tier off'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('CCRC_ARTIFACT_ORIGIN');
    expect(lines[0]).not.toContain(label);
  });
});

// X5-FU (the coordinator's ruling on item 3): a refusal decided before the mask, a site or grammar refusal, names a value the
// answer mask would alter by its key only, as the setup command's refusal does (`ccd/ccrc#_art_q`, the same words), and the
// site rule's sentence, which names the hosts and their shared suffix, is withheld whole when it would hold such a name.
describe('config: a refusal never quotes a value the answer mask would alter (X5-FU)', () => {
  const HIDDEN = '(a value with a credential\'s shape, not shown)';
  const SITE_HIDDEN = 'it fails the site rule against the console\'s host (a name with a credential\'s shape is not shown)';

  it('config: a grammar refusal of a shaped artifact or content origin names its key only', () => {
    const label = shapedLabel();
    const a = off(artifactConfig(
      { origin: `https://${label}.art.invalid/x`, content: 'https://content.example.invalid', port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(a.detail).toBe(`CCRC_ARTIFACT_ORIGIN=${HIDDEN} is not a bare https origin (https://<host>, lower case, no path, no trailing slash)`);
    const c = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: `https://${label}.content.invalid:0443`, port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(c.detail).toBe(`CCRC_ARTIFACT_CONTENT_ORIGIN=${HIDDEN} writes its port with a leading zero`);
    for (const d of [a.detail, c.detail]) expect(d).not.toContain(label);
  });

  it('config: a site refusal of a shaped name withholds the value and the site rule\'s sentence', () => {
    const label = shapedLabel();
    const r = off(artifactConfig(
      { origin: `https://${label}.example.test`, content: 'https://content.example.invalid', port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(r.detail).toBe(`CCRC_ARTIFACT_ORIGIN=${HIDDEN}: ${SITE_HIDDEN}`);
    // A shaped console host: the sentence would name it and the suffix it shares.
    const site = `${shapedLabel()}.test`;
    const s = off(artifactConfig(
      { origin: `https://art.${site}`, content: 'https://content.example.invalid', port: '7790' }, `https://ccrc.${site}`, CONSOLE_PORT, masks));
    expect(s.detail).toBe(`CCRC_ARTIFACT_ORIGIN=${HIDDEN}: ${SITE_HIDDEN}`);
    expect(s.detail).not.toContain(site.split('.')[0]!);
  });

  it('config: a clean value beside a shaped console host is quoted, and the site sentence that would name the host is withheld', () => {
    const consoleHost = `${shapedLabel()}.example.test`;
    const r = off(artifactConfig(
      { origin: 'https://example.test', content: 'https://content.example.invalid', port: '7790' }, `https://${consoleHost}`, CONSOLE_PORT, masks));
    expect(r.detail).toBe(`CCRC_ARTIFACT_ORIGIN="https://example.test": ${SITE_HIDDEN}`);
    expect(r.detail).not.toContain(consoleHost);
  });

  it('config: every refusal that quotes a value names a shaped one by its key only', () => {
    const label = shapedLabel();
    const sh = `https://${label}`;
    const art = 'https://art.example.invalid';
    const cont = 'https://content.example.invalid';
    const rows: { what: string; env: { origin: string; content: string; port: string }; console: string; want: string }[] = [
      { what: 'a port that is not one', env: { origin: art, content: cont, port: label }, console: CONSOLE,
        want: `CCRC_ARTIFACT_PORT=${HIDDEN} is not a port (digits only, no leading zero, 1 to 65535)` },
      { what: 'the artifact origin is the console origin', env: { origin: `${sh}.example.test`, content: cont, port: '7790' },
        console: `${sh}.example.test`, want: `CCRC_ARTIFACT_ORIGIN=${HIDDEN} is the console origin` },
      { what: 'the content origin is the console origin', env: { origin: art, content: `${sh}.example.test`, port: '7790' },
        console: `${sh}.example.test`, want: `CCRC_ARTIFACT_CONTENT_ORIGIN=${HIDDEN} is the console origin` },
      { what: 'the two origins are one', env: { origin: `${sh}.art.invalid`, content: `${sh}.art.invalid`, port: '7790' }, console: CONSOLE,
        want: `CCRC_ARTIFACT_CONTENT_ORIGIN=${HIDDEN} is the same origin as CCRC_ARTIFACT_ORIGIN` },
      { what: 'beside a loopback console', env: { origin: `${sh}.art.invalid`, content: 'http://127.0.0.1:7791', port: '7790' },
        console: 'http://localhost:7788', want: `CCRC_ARTIFACT_ORIGIN=${HIDDEN}: beside a loopback console only http://127.0.0.1:<port> is accepted` },
      { what: 'an address', env: { origin: `${sh}.10`, content: cont, port: '7790' }, console: CONSOLE,
        want: `CCRC_ARTIFACT_ORIGIN=${HIDDEN} is an address; artifacts need names` },
      { what: 'the default port written out', env: { origin: `${sh}.art.invalid:443`, content: cont, port: '7790' }, console: CONSOLE,
        want: `CCRC_ARTIFACT_ORIGIN=${HIDDEN} names the default port; write it without :443` },
    ];
    for (const row of rows) {
      const r = off(artifactConfig(row.env, row.console, CONSOLE_PORT, masks));
      expect(r.detail, row.what).toBe(row.want);
      expect(r.detail, row.what).not.toContain(label);
    }
  });

  it('config: a shaped console origin the grammar refuses is named by its key only', () => {
    const label = shapedLabel();
    const r = off(artifactConfig(
      { origin: 'https://art.example.invalid', content: 'https://content.example.invalid', port: '7790' }, `https://${label}.example.test/`, CONSOLE_PORT, masks));
    expect(r.detail).toBe(`CCRC_ORIGIN=${HIDDEN} is neither a bare https origin nor http://localhost:<port>`);
  });

  it('CONTROL: an ordinary value is quoted as before, and with no mask handed in nothing is withheld', () => {
    const plain = off(artifactConfig(
      { origin: 'https://art.example.test', content: 'https://content.example.invalid', port: '7790' }, CONSOLE, CONSOLE_PORT, masks));
    expect(plain.detail).toBe('CCRC_ARTIFACT_ORIGIN="https://art.example.test": art.example.test shares the site example.test with the console');
    const label = shapedLabel();
    const unmasked = off(artifactConfig(
      { origin: `https://${label}.example.test`, content: 'https://content.example.invalid', port: '7790' }, CONSOLE, CONSOLE_PORT));
    expect(unmasked.detail).toContain(label);
  });

  it('config: the boot warning of a shaped name a site refusal turns off never holds the label', () => {
    const home = mkTmp('artmask-boot-');
    seedRoster(home);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const label = shapedLabel();
      const cfg = loadConfig({
        CCRC_HOME: home, CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'), CCRC_ORIGIN: CONSOLE,
        CCRC_ARTIFACT_ORIGIN: `https://${label}.example.test`, CCRC_ARTIFACT_CONTENT_ORIGIN: 'https://content.example.invalid',
        CCRC_ARTIFACT_PORT: '7790',
      });
      expect(off(cfg.artifact).why).toBe('invalid');
      const lines = warn.mock.calls.map((a: readonly unknown[]) => String(a[0])).filter((l) => l.startsWith('ccrc-server: artifact tier off'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`CCRC_ARTIFACT_ORIGIN=${HIDDEN}`);
      expect(lines[0]).not.toContain(label);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
