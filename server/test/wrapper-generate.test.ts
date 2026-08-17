import { describe, expect, it } from 'vitest';
import { generateWrapperBody, WrapperInvalid } from '../../shared/wrapper.mjs';

const CLAUDE2 = { id: 'claude2', configDirSuffix: '.claude-personal', execKind: 'generated',
  secretsFile: '.cc-secrets/claude2-oauth.env' };
const NOSECRETS = { id: 'plain', configDirSuffix: '.claude-plain', execKind: 'generated' };

describe('generateWrapperBody', () => {
  it('writes the three-line shape when the account has a secrets file', () => {
    expect(generateWrapperBody(CLAUDE2, 'claude')).toBe(
      '#!/usr/bin/env bash\n'
      + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
      + 'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"\n'
      + '[ -r "$HOME/.cc-secrets/claude2-oauth.env" ] && . "$HOME/.cc-secrets/claude2-oauth.env"\n'
      + 'exec "$HOME/.local/bin/claude" "$@"\n',
    );
  });

  it('omits the secrets line entirely when there is no secrets file', () => {
    const text = generateWrapperBody(NOSECRETS, 'claude');
    expect(text).toBe(
      '#!/usr/bin/env bash\n'
      + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
      + 'export CLAUDE_CONFIG_DIR="$HOME/.claude-plain"\n'
      + 'exec "$HOME/.local/bin/claude" "$@"\n',
    );
    // Not "an empty guard line" — an absent one. A `[ -r "$HOME/" ]` line
    // would parse as a secrets guard naming $HOME itself.
    expect(text).not.toContain('[ -r');
  });

  it('refuses to write anything for an account ccrc does not own', () => {
    for (const execKind of ['upstream', 'external']) {
      expect(() => generateWrapperBody({ ...NOSECRETS, execKind }, 'claude'))
        .toThrow(WrapperInvalid);
    }
  });

  it('refuses a suffix, secrets path or upstream id that could break out of its quoting', () => {
    const hostile = ['a"b', 'a$b', 'a`b', 'a\\b', 'a\nb'];
    for (const h of hostile) {
      expect(() => generateWrapperBody({ ...NOSECRETS, configDirSuffix: `.${h}` }, 'claude'))
        .toThrow(WrapperInvalid);
      expect(() => generateWrapperBody({ ...NOSECRETS, secretsFile: `.cc-secrets/${h}` }, 'claude'))
        .toThrow(WrapperInvalid);
    }
    expect(() => generateWrapperBody(NOSECRETS, 'not a legal id')).toThrow(WrapperInvalid);
    // The account's own id is never embedded in the text, but an emitter that
    // cannot name the account it refused is useless in a manifest.
    expect(() => generateWrapperBody({ ...NOSECRETS, id: 'NOT-AN-ID' }, 'claude'))
      .toThrow(/NOT-AN-ID/);
  });

  it('never escapes its way past the reader', () => {
    // The alternative to refusing is escaping, and escaping is the bug: a
    // backslash-escaped suffix produces a line `_wrap_parse_shape` rejects, so
    // the writer would emit files the reader calls foreign. Refusal is the
    // only answer that keeps the two in step.
    expect(() => generateWrapperBody({ ...NOSECRETS, configDirSuffix: '.a"b' }, 'claude'))
      .toThrow(WrapperInvalid);
  });

  it('carries a remedy on every refusal', () => {
    try {
      generateWrapperBody({ ...NOSECRETS, execKind: 'external' }, 'claude');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WrapperInvalid);
      expect(typeof (e as { remedy?: unknown }).remedy).toBe('string');
      expect((e as { remedy: string }).remedy.length).toBeGreaterThan(0);
    }
  });
});
