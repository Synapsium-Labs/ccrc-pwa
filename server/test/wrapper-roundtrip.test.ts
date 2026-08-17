import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { markGenerated } from '../../shared/mark.mjs';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SHAPE_LIB = new URL('../../ccd/ccrc-wrapper-shape', import.meta.url).pathname;

/** Runs the real `_wrap_parse_shape` over `text` and returns the four fields
 *  it prints. Sourcing the shipped library rather than restating its rules is
 *  the entire point of this file. */
function parseShape(text: string): { ok: string; target: string; suffix: string; secrets: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ccrc-roundtrip-'));
  try {
    const f = join(dir, 'w');
    writeFileSync(f, text);
    const out = execFileSync('bash', ['-c',
      `. "$1" && _wrap_parse_shape "$2"`, 'bash', SHAPE_LIB, f], { encoding: 'utf8' });
    const [ok = '', target = '', suffix = '', secrets = ''] = out.replace(/\n$/, '').split('\t');
    return { ok, target, suffix, secrets };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A production-shaped roster: the reference box's real spread of accounts —
// with and without a secrets file, ids that are strict prefixes of one another,
// and a suffix that is not derived from the id.
const ACCOUNTS = [
  { id: 'claude2', configDirSuffix: '.claude-personal', execKind: 'generated',
    secretsFile: '.cc-secrets/claude2-oauth.env' },
  { id: 'claude-corp', configDirSuffix: '.claude-corp', execKind: 'generated',
    secretsFile: '.cc-secrets/claude-corp-oauth.env' },
  { id: 'claude-dev0', configDirSuffix: '.claude-dev0', execKind: 'generated',
    secretsFile: '.cc-secrets/claude-dev0-oauth.env' },
  { id: 'plain', configDirSuffix: '.claude-plain', execKind: 'generated' },
  { id: 'x', configDirSuffix: '.x_1-2.3', execKind: 'generated', secretsFile: 'a/b/c.env' },
] as const;

describe('the wrapper the writer writes is the wrapper the reader reads', () => {
  for (const a of ACCOUNTS) {
    it(`round-trips ${a.id} unmarked`, () => {
      const r = parseShape(generateWrapperBody(a, 'claude'));
      expect(r.ok).toBe('ok');
      expect(r.target).toBe('claude');
      expect(r.suffix).toBe(a.configDirSuffix);
      expect(r.secrets).toBe((a as { secretsFile?: string }).secretsFile ?? '');
    });

    it(`round-trips ${a.id} once the provenance marker is stamped on`, () => {
      // The marker is a comment line inserted at line 2, and the reader strips
      // comment lines before counting significant ones. If that ever stops
      // being true, every wrapper ccrc installs becomes foreign to ccrc.
      const r = parseShape(markGenerated(generateWrapperBody(a, 'claude')));
      expect(r.ok).toBe('ok');
      expect(r.target).toBe('claude');
      expect(r.suffix).toBe(a.configDirSuffix);
      expect(r.secrets).toBe((a as { secretsFile?: string }).secretsFile ?? '');
    });
  }

  it('the marked text still verifies as ccrc-unmodified', async () => {
    const { verifyMarker } = await import('../../shared/mark.mjs');
    expect(verifyMarker(markGenerated(generateWrapperBody(ACCOUNTS[0], 'claude'))))
      .toBe('ccrc-unmodified');
  });

  it('a wrapper for a DIFFERENT upstream is read back with that upstream', () => {
    // The reader captures the exec target without judging it; the writer must
    // put the roster's upstream there and nothing else.
    expect(parseShape(generateWrapperBody(ACCOUNTS[3], 'cc')).target).toBe('cc');
  });
});
