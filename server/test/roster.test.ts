import { describe, it, expect, vi } from 'vitest';
import { parseRoster, RosterError, POOL_NAME_RE } from '../../shared/roster.js';

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

  // `hidden` — the operator's "this entry is plumbing, not an account".
  // OPTIONAL on purpose: the field is additive, so every roster written before
  // it existed has to keep parsing with the same meaning it always had.
  it('defaults hidden to false when the key is absent, so a roster predating the field is unchanged', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] });
    expect(r.byId.get('claude')!.hidden).toBe(false);
  });

  it('parses hidden:true — the operator declaring an entry names a binary, not an account', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'binary', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: false, hue: 'cyan', telemetry: 'anthropic', hidden: true },
      { id: 'work', label: 'work', configDirSuffix: '.work', exec: { kind: 'generated' },
        homeAble: true, hue: 'green', telemetry: 'anthropic' },
    ] });
    expect(r.byId.get('claude')!.hidden).toBe(true);
    expect(r.byId.get('work')!.hidden).toBe(false);
  });

  // Leniency here would be the loudest possible mistake: `hidden` is the one
  // field whose truthy value REMOVES an account from every surface that lists
  // one, so `"false"` — a truthy string — must be refused, not coerced.
  it('refuses a non-boolean hidden rather than letting a truthy string erase an account', () => {
    expect(() => parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'c', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic', hidden: 'false' },
    ] })).toThrow(/non-boolean hidden/);
  });

  // `pool` — the operator's optional grouping of accounts, and the account half
  // of the rule an account may serve a project by (design §5.2). OPTIONAL in
  // the FILE like `hidden`, and `null` on the type: absence is how the roster
  // says "untagged", which is what every roster written before this field
  // existed says, so nothing on a live box changes on the day it ships.
  it('parses a pool tag, and answers null for an account carrying none', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-a' },
      { id: 'work', label: 'work', configDirSuffix: '.work', exec: { kind: 'generated' },
        homeAble: true, hue: 'green', telemetry: 'anthropic' },
    ] });
    expect(r.byId.get('claude')!.pool).toBe('pool-a');
    expect(r.byId.get('work')!.pool).toBeNull();
  });

  // Five refusals, one per way a hand-edited roster gets this wrong. A written
  // `null` is in the list ON PURPOSE and is NOT the same as an absent key:
  // absence is the file saying "untagged", a written `null` is a half-finished
  // edit, and folding the two would be this parser narrowing a distinction it
  // received. Every remedy names the file and the grammar, because nobody
  // reading a boot refusal at 2am has this regex memorised.
  //
  // The grammar is INTERPOLATED from the imported object rather than typed out
  // again: this file already value-imports `POOL_NAME_RE`, and a hand-typed
  // fourth copy of `^[a-z][a-z0-9-]{0,31}$` would be one more spelling to keep
  // in step — including with a remedy that widened while this string did not,
  // which is the drift that would make the assertion pass while the remedy
  // named a grammar the parser no longer enforces.
  it.each([
    ['an empty pool name', ''],
    ['an explicit null pool — absence is untagged, a written null is a half-edit', null],
    ['a non-string pool', 7],
    ['a pool name with an uppercase letter', 'Corp'],
    ['a pool name containing a space', 'a b'],
  ])('refuses %s, naming the file and the fix', (_name, pool) => {
    const bad = { version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool },
    ] };
    expect(() => parseRoster(bad)).toThrow(RosterError);
    try {
      parseRoster(bad);
    } catch (e) {
      expect((e as RosterError).message).toMatch(/invalid pool/i);
      expect((e as RosterError).remedy).toContain('~/.ccrc/accounts.json');
      expect((e as RosterError).remedy).toContain(POOL_NAME_RE.source);
    }
  });

  // `pool` in ACCOUNT_KEYS is what stops `warnUnknownKeys` printing "unknown
  // field" for a roster this parser now fully understands. A warning on a legal
  // field trains the operator to ignore the one diagnostic that catches a real
  // typo — `secretFile` for `secretsFile`, the case that docstring names.
  it('does not warn about the pool key it now understands', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      parseRoster({ version: 1, accounts: [
        { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
          homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-b' },
      ] });
      expect(warn.mock.calls.some(([m]) => typeof m === 'string' && m.includes('"pool"'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  // The grammar is ID_RE's, deliberately, and the boundary is worth pinning
  // rather than trusting to a shared regex source: `ccd` carries a
  // hand-typed bash copy of this literal (wave 2a landed it), and a drift in
  // the CAP is the drift a "same shape" comment would never catch.
  it('accepts the full 32-character grammar and refuses what falls outside it', () => {
    const longest = `a${'b'.repeat(31)}`;
    expect(longest.length).toBe(32);
    expect(POOL_NAME_RE.test(longest)).toBe(true);
    expect(POOL_NAME_RE.test(`${longest}b`)).toBe(false);
    expect(POOL_NAME_RE.test('1pool')).toBe(false);
    expect(POOL_NAME_RE.test('-pool')).toBe(false);
    expect(POOL_NAME_RE.test('pool_a')).toBe(false);
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
    // `provider` is now on every generated exec — defaulted to `anthropic` for a
    // roster that predates the field, which is what this fixture is.
    expect(acct?.exec).toEqual(
      { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/claude2-oauth.env' });
  });

  it('still accepts a generated account with no secretsFile at all', () => {
    const r = parseRoster(rosterWithSecrets(undefined));
    expect(r.accounts.find((a) => a.id === 'claude2')?.exec)
      .toEqual({ kind: 'generated', provider: 'anthropic' });
  });
});

// ── §4.1: provider, endpoint and models ────────────────────────────────────
// Three gates and one default. The default is the migration: a `generated`
// entry with no `provider` is `anthropic`, because every generated wrapper ccrc
// has ever written is one — and `parseRoster` says so ONCE per parse rather
// than once per account, naming the accounts it assumed for.

/** A two-account roster whose second account carries an arbitrary exec. */
const rosterWithExec = (exec: unknown) => ({
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane', label: 'team·shared', configDirSuffix: '.claude-lane',
      exec, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ],
});
const execOf = (roster: unknown, id: string) =>
  parseRoster(roster).accounts.find((a) => a.id === id)?.exec;

describe('exec.provider', () => {
  it('defaults a generated entry to anthropic and WARNS once, naming the accounts it assumed for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = parseRoster({ version: 1, accounts: [
        { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' },
          homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'one', label: 'team·max', configDirSuffix: '.claude-one', exec: { kind: 'generated' },
          homeAble: true, hue: 'violet', telemetry: 'anthropic' },
        { id: 'two', label: 'alt·max', configDirSuffix: '.claude-two', exec: { kind: 'generated' },
          homeAble: true, hue: 'blue', telemetry: 'anthropic' },
      ] });
      expect(r.byId.get('one')!.exec).toEqual({ kind: 'generated', provider: 'anthropic' });
      // ONE warning for TWO accounts. Once per parse, not once per account:
      // `loadConfig` runs this on every boot and every test, and a roster
      // written by `ccrc-adopt` (which emits `{"kind":"generated"}` with no
      // provider, `ccd/ccrc-adopt:496-503`, the bare literal at `:500`) would
      // otherwise print a line per
      // generated account forever.
      const said = warn.mock.calls.flat().join(' ');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(said).toContain('exec.provider');
      expect(said).toContain('anthropic');
      expect(said).toContain('one');
      expect(said).toContain('two');
    } finally { warn.mockRestore(); }
  });

  it('says nothing when every generated entry declares one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(execOf(rosterWithExec({ kind: 'generated', provider: 'openrouter' }), 'lane'))
        .toEqual({ kind: 'generated', provider: 'openrouter' });
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('leaves an external entry UNDECLARED when it names no provider', () => {
    // Absent is a third answer, not a default: the UI shows the lane, offers
    // enable/disable and remove, and offers no provider operation (§4.1).
    expect(execOf(rosterWithExec({ kind: 'external' }), 'lane')).toEqual({ kind: 'external' });
  });

  it('refuses an unknown provider, listing the ones that exist', () => {
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'anthorpic' })))
      .toThrow(/exec\.provider/);
    try { parseRoster(rosterWithExec({ kind: 'generated', provider: 'anthorpic' })); }
    catch (e) { expect((e as RosterError).remedy).toContain('openrouter'); }
  });

  it('refuses a provider on an UPSTREAM entry — upstream is anthropic and does not say so', () => {
    // `provider` is not in EXEC_KEYS_UPSTREAM, so this is the unknown-key WARN
    // path, and the value is dropped rather than honoured: an upstream entry
    // claiming `openrouter` would be a roster asserting that the Claude Code
    // binary talks to somebody else.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = parseRoster({ version: 1, accounts: [
        { id: 'claude', label: 'claude', configDirSuffix: '.claude',
          exec: { kind: 'upstream', provider: 'openrouter' },
          homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      ] });
      expect(r.byId.get('claude')!.exec).toEqual({ kind: 'upstream' });
      expect(warn.mock.calls.some(([m]) => typeof m === 'string' && m.includes('provider'))).toBe(true);
    } finally { warn.mockRestore(); }
  });
});

describe('exec.baseUrl', () => {
  it('keeps a legal endpoint, normalised', () => {
    expect(execOf(rosterWithExec(
      { kind: 'generated', provider: 'compatible', baseUrl: 'HTTPS://Orchard-API/V1' }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'compatible', baseUrl: 'https://orchard-api/V1' });
  });

  it('requires one on compatible, and only on compatible', () => {
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'compatible' })))
      .toThrow(/base-url-required/);
    // openrouter falls back to PROVIDERS.openrouter.baseUrl, so absence is legal
    // and the roster does NOT store the default — the table stays the one home.
    expect(execOf(rosterWithExec({ kind: 'generated', provider: 'openrouter' }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'openrouter' });
  });

  it.each([
    ['base-url-insecure', 'http://orchard-api/v1'],
    ['base-url-credentials', 'https://user:pass@orchard-api/v1'],
    ['base-url-query', 'https://orchard-api/v1?beta=true'],
    ['base-url-fragment', 'https://orchard-api/v1#frag'],
    ['base-url-unparseable', 'orchard-api'],
  ] as const)('refuses %s, and the message says which', (reason, baseUrl) => {
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'compatible', baseUrl })))
      .toThrow(new RegExp(reason));
  });

  it('admits a loopback endpoint — the proxy lane this fleet already runs (§4.3)', () => {
    expect(execOf(rosterWithExec(
      { kind: 'generated', provider: 'compatible', baseUrl: 'http://127.0.0.1:8642' }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'compatible', baseUrl: 'http://127.0.0.1:8642/' });
  });

  it('is DECLARATIVE on external: recorded, never written', () => {
    expect(execOf(rosterWithExec(
      { kind: 'external', provider: 'openrouter', baseUrl: 'https://orchard-api/v1' }), 'lane'))
      .toEqual({ kind: 'external', provider: 'openrouter', baseUrl: 'https://orchard-api/v1' });
  });
});

describe('exec.models', () => {
  const MAP = { opus: 'vendor/opus-1', sonnet: 'vendor/sonnet-1', haiku: 'vendor/haiku-1', subagent: 'vendor/haiku-1' };

  it('accepts the four aliases on an api-key lane', () => {
    expect(execOf(rosterWithExec({ kind: 'generated', provider: 'openrouter', models: MAP }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'openrouter', models: MAP });
  });

  it('accepts them on the OTHER api-key lane too — compatible, not just openrouter', () => {
    // THE ROW THAT DISTINGUISHES THE TWO SPELLINGS OF THIS GATE, and the only
    // one that can. §4.1 says "the two api-key providers" and §14 line 1455 says
    // "refused on a non-openrouter provider"; every other row in this describe
    // uses `openrouter`, on which both readings agree, so without this row the
    // gate could be written either way and the suite could not tell. Step 5(c)
    // mutates the gate to §14's spelling and names THIS row as the red.
    //
    // `baseUrl` is not decoration here: `compatible` is the one provider with
    // `baseUrlRequired`, so a compatible lane with no endpoint throws
    // `base-url-required` before `models` is ever reached, and the row would
    // then be green under both spellings for the wrong reason.
    const exec = {
      kind: 'generated', provider: 'compatible', baseUrl: 'https://orchard-api/v1', models: MAP,
    };
    expect(execOf(rosterWithExec(exec), 'lane')).toEqual(exec);
  });

  it('refuses models on a lane whose provider carries no api-key model map', () => {
    // Read off PROVIDERS[p].apiKeyModels, not off a second list of provider
    // names — §4.1 line 229 and §14 line 1455 disagree about which providers
    // those are, and the table is where that is settled.
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'anthropic', models: MAP })))
      .toThrow(/exec\.models/);
  });

  it('refuses a missing alias — all four are the lane\'s routing map, not a suggestion', () => {
    const { subagent: _drop, ...three } = MAP;
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'openrouter', models: three })))
      .toThrow(/subagent/);
  });

  it.each([
    ['a leading slash', '/vendor/opus'],
    ['a space', 'vendor/opus 1'],
    ['a quote', 'vendor/"opus"'],
    ['the empty string', ''],
  ] as const)('refuses %s as a model id', (_why, bad) => {
    expect(() => parseRoster(rosterWithExec(
      { kind: 'generated', provider: 'openrouter', models: { ...MAP, opus: bad } })))
      .toThrow(/exec\.models\.opus/);
  });

  it('accepts the punctuation OpenRouter ids are made of', () => {
    const ids = { ...MAP, opus: 'anthropic/claude-opus-4.5:beta', sonnet: 'a_b-c.d:e/f' };
    expect(execOf(rosterWithExec({ kind: 'generated', provider: 'openrouter', models: ids }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'openrouter', models: ids });
  });

  it('accepts a selectable allowlist and requires every alias to be in it', () => {
    const ok = { ...MAP, selectable: [
      { id: 'vendor/opus-1', label: 'Opus' }, { id: 'vendor/sonnet-1' }, { id: 'vendor/haiku-1' },
    ] };
    expect(execOf(rosterWithExec({ kind: 'generated', provider: 'openrouter', models: ok }), 'lane'))
      .toEqual({ kind: 'generated', provider: 'openrouter', models: ok });
    // A routing target the operator cannot select is a lane that answers
    // `/model opus` with something the picker never showed (§4.1).
    const bad = { ...MAP, selectable: [{ id: 'vendor/sonnet-1' }, { id: 'vendor/haiku-1' }] };
    expect(() => parseRoster(rosterWithExec({ kind: 'generated', provider: 'openrouter', models: bad })))
      .toThrow(/vendor\/opus-1/);
  });
});

describe('exec.secretsFile is legal on all three kinds — and gated on all three', () => {
  // THE ONE NON-ADDITIVE CHANGE IN THIS WAVE (D-1857). Before this task (at
  // `b0bbd8a9`), these two rosters PARSED: `secretsFile` was not in
  // `EXEC_KEYS_BASE`, `warnUnknownKeys` only warned, and `parseExec`'s bare
  // `{ kind: 'upstream' }` literal dropped the value. Now the gate runs before
  // the kind is dispatched on, so the same bytes throw.
  it.each(['upstream', 'external'] as const)('refuses a parent-directory hop on %s', (kind) => {
    const roster = kind === 'upstream'
      ? { version: 1, accounts: [{ id: 'claude', label: 'claude', configDirSuffix: '.claude',
          exec: { kind, secretsFile: '../.ssh/id_ed25519' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }] }
      : rosterWithExec({ kind, secretsFile: '../.ssh/id_ed25519' });
    expect(() => parseRoster(roster)).toThrow(/exec\.secretsFile/);
  });

  it('KEEPS a declared upstream secretsFile — the point of hoisting it (§1.7)', () => {
    // The upstream launcher has a credential and nothing could see it. ccrc
    // still never writes that launcher; it now knows where the file is, which
    // is the only way that hole closes.
    const r = parseRoster({ version: 1, accounts: [
      { id: 'claude', label: 'claude', configDirSuffix: '.claude',
        exec: { kind: 'upstream', secretsFile: '.cc-secrets/claude-oauth.env' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] });
    expect(r.byId.get('claude')!.exec).toEqual(
      { kind: 'upstream', secretsFile: '.cc-secrets/claude-oauth.env' });
  });

  it('KEEPS a declared external secretsFile, beside its declared provider', () => {
    expect(execOf(rosterWithExec(
      { kind: 'external', provider: 'openai', secretsFile: '.cc-secrets/lane.env' }), 'lane'))
      .toEqual({ kind: 'external', provider: 'openai', secretsFile: '.cc-secrets/lane.env' });
  });
});
