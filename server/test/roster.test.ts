import { describe, it, expect, vi } from 'vitest';
import { parseRoster, RosterError } from '../../shared/roster.js';

const one = (over: Record<string, unknown> = {}) => ({
  version: 1,
  accounts: [{
    id: 'claude', label: 'claude', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    ...over,
  }],
});

/** A minimal valid two-account roster — one `upstream` `claude`, one
 *  `generated` `claude2` whose `exec` carries `secretsFile` when it is not
 *  `undefined`. Used by the `exec.secretsFile` gate cases below. */
const rosterWithSecrets = (secretsFile: string | undefined) => ({
  version: 1,
  accounts: [
    {
      id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    },
    {
      id: 'claude2', label: 'claude2', configDirSuffix: '.claude2',
      exec: secretsFile !== undefined ? { kind: 'generated', secretsFile } : { kind: 'generated' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic',
    },
  ],
});

describe('parseRoster', () => {
  it('parses the shipped single-account default', () => {
    const r = parseRoster(one());
    expect(r.accounts.map((a) => a.id)).toEqual(['claude']);
    expect(r.upstreamId).toBe('claude');
    expect(r.homeAble.map((a) => a.id)).toEqual(['claude']);
    expect(r.byId.get('claude')!.configDirSuffix).toBe('.claude');
  });

  // The label rule is a control-character ban, NOT a printable-ASCII
  // whitelist, and the difference is not academic: every label this fleet
  // actually runs carries U+00B7, and the emoji/box-drawing case is one
  // `ccrc adopt` away. A rule tightened past this point rejects the roster
  // the repo itself ships, on a box where a rejected roster means the server
  // refuses to boot. `gen-accounts.test.ts`'s CASES list guards the other
  // direction — that a control character is still refused by both sides.
  it('accepts the punctuation real labels are made of, banning only control characters', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'a', label: 'team·max', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id: 'b', label: 'team·d 🚀 — "quoted"', configDirSuffix: '.b', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    ] });
    expect(r.accounts.map((a) => a.label)).toEqual(['team·max', 'team·d 🚀 — "quoted"']);
  });

  it('orders byIdLengthDesc longest-first so a prefix id never wins over a longer one', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'a', label: 'a', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'a-b-c', label: 'abc', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
      { id: 'a-b', label: 'ab', configDirSuffix: '.ab', exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic' },
    ] });
    expect(r.byIdLengthDesc.map((a) => a.id)).toEqual(['a-b-c', 'a-b', 'a']);
    // declaration order is preserved separately — the accounts strip depends on it
    expect(r.accounts.map((a) => a.id)).toEqual(['a', 'a-b-c', 'a-b']);
  });

  it('assigns hues by position when absent, and never leaves one unset', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'x', label: 'x', configDirSuffix: '.x', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id: 'y', label: 'y', configDirSuffix: '.y', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    ] });
    expect(r.accounts.map((a) => a.hue)).toEqual(['cyan', 'violet']);
  });

  it('cycles hues round-robin past the sixth account, rather than clumping every excess account onto the last hue', () => {
    const accounts = Array.from({ length: 7 }, (_, i) => ({
      id: `acct${i}`, label: `acct${i}`, configDirSuffix: `.acct${i}`,
      exec: { kind: i === 0 ? 'upstream' : 'generated' }, homeAble: true, telemetry: 'anthropic',
    }));
    const r = parseRoster({ version: 1, accounts });
    expect(r.accounts.map((a) => a.hue)).toEqual(
      ['cyan', 'violet', 'blue', 'magenta', 'amber', 'green', 'cyan'],
    );
  });

  it.each([
    ['unknown version', { version: 2, accounts: [] }, /version/i],
    ['no upstream', { version: 1, accounts: [{ ...one().accounts[0], exec: { kind: 'generated' } }] }, /upstream/i],
    ['two upstreams', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], id: 'other', configDirSuffix: '.other' }] }, /upstream/i],
    ['duplicate id', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], exec: { kind: 'generated' } }] }, /duplicate/i],
    // /id/i also matches "invalid" (…val-id) in nearly every other message
    // this module throws, so it can't distinguish the id rule from any other
    // validation branch firing. "invalid id" is the literal phrase only the
    // id-charset check's message contains.
    ['bad id charset', one({ id: 'Claude' }), /invalid id/i],
    ['id with whitespace', one({ id: 'my claude' }), /invalid id/i],
    ['suffix without dot', one({ configDirSuffix: 'claude' }), /configDirSuffix/i],
    ['suffix with slash', one({ configDirSuffix: '.a/b' }), /configDirSuffix/i],
    ['suffix with dotdot', one({ configDirSuffix: '../x' }), /configDirSuffix/i],
    // "." passes "starts with a dot", "no slash" and "no .." individually,
    // and then resolves to $HOME itself when joined — the same failure class
    // agent/src/server.ts's assertProjectsRootIsSafe guards against.
    ['suffix is exactly "."', one({ configDirSuffix: '.' }), /configDirSuffix/i],
    // '.$(rm -rf ~)' starts with '.', has no '/' and no '..' — it passes
    // every check above this one, and is refused only by the safe-charset
    // gate added alongside shared/generate.mjs's own dqEscape defense
    // (server/test/roster-generate.test.ts's hostile-payload case exercises
    // that generator-side half independently, by constructing a
    // Roster-shaped object that never passes through parseRoster at all).
    ['suffix with a shell metacharacter', one({ configDirSuffix: '.$(rm -rf ~)' }), /outside the safe set/i],
    ['empty roster', { version: 1, accounts: [] }, /at least one/i],
  ])('refuses %s', (_name, bad, pattern) => {
    expect(() => parseRoster(bad)).toThrow(RosterError);
    try { parseRoster(bad); } catch (e) { expect((e as RosterError).message).toMatch(pattern); expect((e as RosterError).remedy).toBeTruthy(); }
  });

  it('warns but does not fail on an unknown field, naming the offending key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = parseRoster({ version: 1, accounts: [{ ...one().accounts[0], futureThing: 42 }] });
      expect(r.accounts).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.some(([msg]) => typeof msg === 'string' && msg.includes('futureThing'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('warns on an unknown field inside exec, e.g. a typo\'d secretsFile, rather than dropping it silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = parseRoster({ version: 1, accounts: [
        one().accounts[0],
        {
          id: 'other', label: 'other', configDirSuffix: '.other',
          exec: { kind: 'generated', secretFile: 'oops.env' }, // typo: should be secretsFile
          homeAble: true, hue: 'violet', telemetry: 'anthropic',
        },
      ] });
      expect(r.accounts).toHaveLength(2);
      expect(warn.mock.calls.some(([msg]) => typeof msg === 'string' && msg.includes('secretFile'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('exec.secretsFile is a path, not merely a string', () => {
  // The value is embedded inside a double-quoted bash string in the generated
  // wrapper (`[ -r "$HOME/<path>" ] && . "$HOME/<path>"`), so the same
  // conservative gate configDirSuffix carries applies here. parseRoster used
  // to require only `typeof === "string"`.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['a double quote', '.cc-secrets/a"b.env'],
    ['a dollar sign', '.cc-secrets/$USER.env'],
    ['a backtick', '.cc-secrets/`id`.env'],
    ['a backslash', '.cc-secrets/a\\b.env'],
    ['a newline', '.cc-secrets/a\nb.env'],
    ['a parent-directory hop', '../.ssh/id_ed25519'],
    ['an absolute path', '/etc/shadow'],
    ['the empty string', ''],
    ['a trailing slash', '.cc-secrets/'],
    ['a space', '.cc-secrets/a b.env'],
  ];
  for (const [what, secretsFile] of cases) {
    it(`rejects ${what}`, () => {
      expect(() => parseRoster(rosterWithSecrets(secretsFile)))
        .toThrow(/exec\.secretsFile/);
    });
  }

  it('accepts the shape every real account uses', () => {
    const r = parseRoster(rosterWithSecrets('.cc-secrets/claude2-oauth.env'));
    const acct = r.accounts.find((a) => a.id === 'claude2');
    expect(acct?.exec).toEqual({ kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' });
  });

  it('still accepts a generated account with no secretsFile at all', () => {
    const r = parseRoster(rosterWithSecrets(undefined));
    expect(r.accounts.find((a) => a.id === 'claude2')?.exec).toEqual({ kind: 'generated' });
  });
});
