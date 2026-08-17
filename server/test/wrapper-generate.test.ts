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

  // PINNED HERE AND NOT IN THE ROUND-TRIP TEST, deliberately. Task 3 measured
  // the round-trip pin against exactly this mutation — dropping the trailing
  // newline — and it stayed GREEN, 12/12: `_wrap_parse_shape` reads with
  // `mapfile -t`, which yields an unterminated final line identically to a
  // terminated one, so the bash reader is blind to this property and no
  // round-trip through it can ever pin it.
  //
  // It still matters, and not only for tidiness: `shared/mark.mjs` splits on
  // "\n" to hash a body, so a missing terminator changes the digest — and the
  // digest is what `verifyMarker` compares a file against to decide whether
  // ccrc wrote it. Once Task 5 runs this text through `markGenerated`, a
  // writer that silently stopped emitting the terminator would make `ccrc
  // wrappers` read its own output back as `ccrc-edited` and refuse to touch
  // it: a box disowning the wrappers it just wrote.
  //
  // NOT the `/api/fleet/health` roster fingerprint, which an earlier draft of
  // this comment claimed (Task 3 review). That fingerprint is
  // `bodyDigest(generateAccountsSh(...))` on the server side and a digest of
  // `~/.ccrc/accounts.sh` on the agent side — both about the `_ccrc_*`
  // functions file, never about a wrapper. Nothing in this plan wires a
  // wrapper's digest into that endpoint, and a reader sent to the wrong
  // mechanism when this test goes red would be looking at the wrong box.
  it('ends in exactly one newline', () => {
    for (const a of [CLAUDE2, NOSECRETS]) {
      const text = generateWrapperBody(a, 'claude');
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }
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

  it('refuses a configDirSuffix that resolves to $HOME or its parent, but not one that merely contains dots', () => {
    // "." collapses to $HOME itself; ".." escapes to $HOME's PARENT — both
    // are exact-SEGMENT collisions, not "contains a dot" collisions.
    // `SUFFIX_SAFE_RE` alone does not catch ".." (its character class allows
    // "."), which is exactly the gap a reviewer found: `configDirSuffix: '..'`
    // used to pass straight through and land `CLAUDE_CONFIG_DIR` on $HOME's
    // parent directory, and the real `_wrap_parse_shape` accepted that file
    // too.
    for (const hostile of ['.', '..']) {
      expect(() => generateWrapperBody({ ...NOSECRETS, configDirSuffix: hostile }, 'claude'))
        .toThrow(WrapperInvalid);
    }
    // "..." and "..foo" only CONTAIN ".." as a substring — they are ordinary,
    // if odd-looking, one-segment directory names (`configDirSuffix` can
    // never contain "/", so a suffix is always exactly one segment, and only
    // the literal segment ".." means "go up" to the OS). Neither may be
    // refused: a broader `.includes('..')` guard — the one `shared/roster.ts`
    // and `shared/roster-json.mjs` carry on this same field — would wrongly
    // reject both, taking away a legitimate dotfile-style name for no safety
    // gain.
    for (const legal of ['...', '..foo']) {
      const text = generateWrapperBody({ ...NOSECRETS, configDirSuffix: legal }, 'claude');
      expect(text).toContain(`export CLAUDE_CONFIG_DIR="$HOME/${legal}"`);
    }
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
