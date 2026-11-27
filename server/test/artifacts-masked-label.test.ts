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
  it('CONTROL: the shape-only mask alters the shaped label and leaves the near miss alone', () => {
    expect(masks(`https://${shapedLabel()}.art.invalid`)).toBe(true);
    expect(masks(`https://${nearMissLabel()}.art.invalid`)).toBe(false);
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

  it('config: the site rule is decided before the mask, so a name both refuse keeps the site rule\'s words', () => {
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
