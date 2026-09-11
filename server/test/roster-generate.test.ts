// shared/generate.mjs — Task 3 of the stage-2a roster-becomes-data plan.
// Behaviour is asserted by running the GENERATED file in a real bash
// subshell, never by comparing generated text to a hand-written expectation:
// `_ccrc_id_wrapper`'s arm order is the point of this generator (today's
// hand-written `ccd` equivalent is only correct by accident — `claude-corp-`
// and `claude-dev0-` tie at 12 characters, and `claude2-` precedes `claude-`
// by hand-authoring luck, not a rule), so a test that pinned literal arm
// text would fail against a correctly-sorted generator the moment two ids
// happened to tie.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { mkTmp } from './tmpHelpers.js';

const roster = parseRoster({ version: 1, accounts: [
  { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'a-b-c', label: 'ABC', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  { id: 'a-b', label: 'AB', configDirSuffix: '.ab', exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
] });

/** Source the generated file in a real bash and evaluate one snippet. */
function sh(home: string, snippet: string): string {
  return execFileSync('bash', ['-c', `source "$HOME/.ccrc/accounts.sh"; ${snippet}`],
    { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim();
}

describe('generateAccountsSh', () => {
  const home = mkTmp('roster-gen-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

  it('exposes ids in declaration order and home-able as a subset', () => {
    expect(sh(home, 'echo "${CCRC_ACCOUNTS[@]}"')).toBe('a a-b-c a-b');
    expect(sh(home, 'echo "${CCRC_HOME_ABLE[@]}"')).toBe('a a-b-c');
  });

  it('resolves every config dir against the LIVE $HOME, not a baked path', () => {
    for (const acc of roster.accounts) {
      expect(sh(home, `_ccrc_cfg_dir '${acc.id}'`)).toBe(path.join(home, acc.configDirSuffix));
    }
    // the generated text must not contain the generating machine's home
    expect(generateAccountsSh(roster)).not.toContain(home);
  });

  it('answers empty at exit 0 for an unknown id — five ccd call sites depend on that silence', () => {
    expect(sh(home, "_ccrc_cfg_dir 'nope' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('resolves a session id to its account, longest prefix first', () => {
    expect(sh(home, "_ccrc_id_wrapper 'a-b-c-quiet-basin'")).toBe('a-b-c');
    expect(sh(home, "_ccrc_id_wrapper 'a-b-quiet-basin'")).toBe('a-b');
    expect(sh(home, "_ccrc_id_wrapper 'a-quiet-basin'")).toBe('a');
  });

  it('falls back to the upstream id for an id matching nothing', () => {
    expect(sh(home, "_ccrc_id_wrapper 'zzz-quiet-basin'")).toBe('a');
  });

  it('emits _ccrc_id_wrapper arms in descending id length', () => {
    const body = generateAccountsSh(roster);
    const arms = [...body.matchAll(/^\s{4}([a-z0-9-]+)-\*\)/gm)].map((m) => m[1]!);
    expect(arms).toEqual(['a-b-c', 'a-b', 'a']);
  });

  // Fix round 1: the six tests above never exercise `dqEscape` — every
  // fixture `configDirSuffix` (`.a`, `.ab`, `.abc`) is free of the four
  // characters it escapes, so a broken template literal or a broken regex
  // in `shared/generate.mjs` would leave this whole file green while
  // reopening shell injection. This test supplies a `configDirSuffix`
  // `shared/roster.ts`'s `parseRoster` now REJECTS outright (see
  // `server/test/roster.test.ts`'s "suffix with a shell metacharacter"
  // case) — so it is built as a plain `Roster`-shaped object, never passed
  // through `parseRoster` at all, on purpose: `generateAccountsSh` consumes
  // a `Roster` structurally (shared/generate.mjs's header), with no runtime
  // check that its argument was ever parsed, so this is the only way left
  // to exercise the generator's OWN defense independent of the parser's.
  //
  // A string-equality assertion alone would pass even if the payload had
  // ALSO executed (bash's command substitution still leaves the rest of the
  // string intact), so this additionally plants a canary file the payload
  // would create if any of its three injection vectors fired, and asserts
  // it does not exist.
  it('escapes a hostile configDirSuffix as inert literal text, and the injected commands never run', () => {
    const hostileHome = mkTmp('roster-gen-hostile-');
    mkdirSync(path.join(hostileHome, '.ccrc'), { recursive: true });
    const canary = path.join(hostileHome, 'canary-hit');

    // Three independent injection vectors aimed at the same canary file —
    // command substitution, a backtick command, and breaking out of the
    // double-quoted string via an embedded `"` to inject a bare command —
    // plus a literal trailing backslash to confirm it round-trips as a
    // single inert `\`, not a dropped or doubled character.
    const hostileSuffix =
      `.a$(touch ${canary})\`touch ${canary}\`"; touch ${canary}; echo "\\z`;
    const hostileAccount = {
      id: 'hostile', label: 'Hostile', configDirSuffix: hostileSuffix,
      exec: { kind: 'upstream' as const }, homeAble: true,
      hue: 'cyan' as const, telemetry: 'anthropic' as const, hidden: false,
      // Required on `AccountDef` — this object is deliberately built by hand
      // rather than parsed, so the compiler is the only thing that can ask it
      // for every field. Untagged: this case is about `dqEscape`, not pools.
      pool: null,
    };
    const hostileRoster = {
      version: 1 as const,
      accounts: [hostileAccount],
      byId: new Map([['hostile', hostileAccount]]),
      byIdLengthDesc: [hostileAccount],
      homeAble: [hostileAccount],
      upstreamId: 'hostile',
    };
    writeFileSync(path.join(hostileHome, '.ccrc', 'accounts.sh'), generateAccountsSh(hostileRoster));

    expect(sh(hostileHome, "_ccrc_cfg_dir 'hostile'")).toBe(`${hostileHome}/${hostileSuffix}`);
    expect(existsSync(canary), 'a hostile configDirSuffix executed instead of round-tripping as inert text')
      .toBe(false);
  });
});

// The four emissions `ccd/statusline-command.sh` reads. Until they existed
// that file held the last hand-written roster copy in the tree: a config dir
// it did not name got no `~/.cc-limits/<id>.json`, and `projectHome`'s
// "unknown is not zero" rule then ranked the account below every measured one
// forever. These assertions are what make "the statusline has no account list"
// a mechanism rather than a comment.
describe('generateAccountsSh — the statusline projection', () => {
  const home = mkTmp('roster-gen-statusline-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

  it('lists only accounts whose telemetry is anthropic in CCRC_MEASURED', () => {
    // `a-b` is telemetry:'none' — the `gpt` case. Writing a limits row for it
    // would hand `projectHome` a measured zero, which is the exact fake the
    // telemetry field exists to keep out of placement scoring.
    expect(sh(home, 'echo "${CCRC_MEASURED[@]}"')).toBe('a a-b-c');
  });

  it('maps a config dir back to its account — the direction a statusline needs', () => {
    for (const acc of roster.accounts) {
      expect(sh(home, `_ccrc_dir_id "$HOME/${acc.configDirSuffix}"`)).toBe(acc.id);
    }
  });

  it('answers empty at exit 0 for a config dir no account claims', () => {
    // Same contract as `_ccrc_cfg_dir`: the caller decides what silence means.
    // Here it means "leave this account unmeasured", which must not also mean
    // "print an error into every status bar on the box".
    expect(sh(home, '_ccrc_dir_id "$HOME/.nobody" ; echo "rc=$?"')).toBe('rc=0');
  });

  it('resolves an account to its label and hue', () => {
    expect(sh(home, "_ccrc_label 'a-b-c'")).toBe('ABC');
    expect(sh(home, "_ccrc_hue 'a-b-c'")).toBe('violet');
    expect(sh(home, "_ccrc_label 'a'")).toBe('A');
    expect(sh(home, "_ccrc_hue 'a'")).toBe('cyan');
    expect(sh(home, "_ccrc_label 'nobody' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  // `_ccrc_dir_id`'s arms are the only ones in the generated file whose
  // pattern contains an EXPANSION (`"$HOME/..."`) rather than a literal id, so
  // they are the only ones where the quoting of the pattern itself decides
  // whether bash matches literally or globs. A `$HOME` holding `[` is what
  // separates the two: unquoted, `h[o]me` is a character class matching `home`
  // and NOT the literal directory it came from, so every account on such a box
  // would silently lose its telemetry.
  it('matches a config dir literally even when $HOME contains glob metacharacters', () => {
    const globHome = path.join(mkTmp('roster-gen-glob-'), 'h[o]me');
    mkdirSync(path.join(globHome, '.ccrc'), { recursive: true });
    writeFileSync(path.join(globHome, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));
    expect(sh(globHome, '_ccrc_dir_id "$HOME/.a"')).toBe('a');
  });

  // The label's counterpart to the hostile-configDirSuffix case above, and the
  // more exposed of the two: `parseRoster` constrains a suffix to
  // `[A-Za-z0-9._-]`, but a LABEL is display text — it rejects only control
  // characters, so `$(...)` is a perfectly valid label that reaches
  // `_ccrc_label` verbatim. This roster therefore goes through the real
  // `parseRoster`, not a hand-built object: the payload is not hypothetical.
  // `_ccrc_label` is sourced by the statusline on every render under whatever
  // account is running, so an unescaped label is command execution in every
  // Claude Code session on the box.
  it('escapes a hostile label as inert literal text, and the payload never runs', () => {
    const labelHome = mkTmp('roster-gen-label-');
    mkdirSync(path.join(labelHome, '.ccrc'), { recursive: true });
    const canary = path.join(labelHome, 'canary-hit');
    const hostileLabel = `x$(touch ${canary})\`touch ${canary}\`"; touch ${canary}; echo "y`;
    const hostileRoster = parseRoster({ version: 1, accounts: [
      { id: 'h', label: hostileLabel, configDirSuffix: '.h', exec: { kind: 'upstream' },
        homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] });
    writeFileSync(path.join(labelHome, '.ccrc', 'accounts.sh'), generateAccountsSh(hostileRoster));

    expect(sh(labelHome, "_ccrc_label 'h'")).toBe(hostileLabel);
    expect(existsSync(canary), 'a hostile label executed instead of round-tripping as inert text')
      .toBe(false);
  });
});

// The account half of project pools. `_ccrc_pool` is the ONE thing on the
// account side that crosses into bash, and it is emitted rather than
// hand-written for the reason the whole of this file exists: a hand-kept `case`
// is a roster copy, and a roster copy is a silently unplaced account.
describe('generateAccountsSh — the pool projection', () => {
  // Some accounts tagged, some not — the only shape that can tell "one arm per
  // TAGGED account" from "one arm per account".
  const pooledRoster = parseRoster({ version: 1, accounts: [
    { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-a' },
    { id: 'a-b-c', label: 'ABC', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic', pool: 'pool-b' },
    { id: 'a-b', label: 'AB', configDirSuffix: '.ab', exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ] });

  const pooledHome = mkTmp('roster-gen-pool-');
  mkdirSync(path.join(pooledHome, '.ccrc'), { recursive: true });
  writeFileSync(path.join(pooledHome, '.ccrc', 'accounts.sh'), generateAccountsSh(pooledRoster));

  // The module-level `roster` (a, a-b-c, a-b) carries no pool at all — every
  // roster on every box, the day this ships.
  const untaggedHome = mkTmp('roster-gen-untagged-pool-');
  mkdirSync(path.join(untaggedHome, '.ccrc'), { recursive: true });
  writeFileSync(path.join(untaggedHome, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

  it('is defined even when NO account is tagged, so `declare -F` is a version probe', () => {
    // Two independent things depend on the unconditional emission: ccd's
    // `_acct_pool` (wave 2a landed it) asks `declare -F _ccrc_pool` to learn
    // whether this box's accounts.sh knows about pools at all, and a new ccd
    // will call the function every 5 seconds once wave 2b wires the swap tick
    // — a conditional emission would be `command not found` on the
    // supervisor's hot loop, on every box whose roster has no tags yet.
    expect(sh(untaggedHome, 'declare -F _ccrc_pool >/dev/null && echo yes')).toBe('yes');
    expect(sh(untaggedHome, "_ccrc_pool 'a' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('emits an EMPTY case for an all-untagged roster, not a missing function and not a default arm', () => {
    const body = generateAccountsSh(roster);
    expect(body).toContain('_ccrc_pool() {');
    const block = body.slice(body.indexOf('_ccrc_pool() {'));
    expect(block.slice(0, block.indexOf('esac'))).not.toMatch(/\) echo /);
  });

  it('answers the pool name for a tagged account', () => {
    expect(sh(pooledHome, "_ccrc_pool 'a'")).toBe('pool-a');
    expect(sh(pooledHome, "_ccrc_pool 'a-b-c'")).toBe('pool-b');
  });

  it('answers empty at rc 0 for an untagged account AND for an unknown id — the caller decides what silence means', () => {
    // `_ccrc_cfg_dir`'s contract, restated: the two silences are deliberately
    // one value here, and that fold is safe only because `_is_valid_wrapper`
    // gates every id before any pool question is asked (design §6).
    expect(sh(pooledHome, "_ccrc_pool 'a-b' ; echo \"rc=$?\"")).toBe('rc=0');
    expect(sh(pooledHome, "_ccrc_pool 'nosuch' ; echo \"rc=$?\"")).toBe('rc=0');
  });

  it('emits one arm per TAGGED account only, in byIdLengthDesc order', () => {
    const body = generateAccountsSh(pooledRoster);
    const block = body.slice(body.indexOf('_ccrc_pool() {'));
    const arms = [...block.slice(0, block.indexOf('esac'))
      .matchAll(/^ {4}([a-z0-9-]+)\) echo ([a-z0-9-]+) ;;$/gm)].map((m) => [m[1]!, m[2]!]);
    // `a-b` is untagged and has NO arm; the two that remain are longest-first.
    expect(arms).toEqual([['a-b-c', 'pool-b'], ['a', 'pool-a']]);
  });

  it('sits after _ccrc_hue, where the roster projection ends', () => {
    const body = generateAccountsSh(pooledRoster);
    expect(body.indexOf('_ccrc_pool() {')).toBeGreaterThan(body.indexOf('_ccrc_hue() {'));
  });

  // The arms above are filtered by `typeof a.pool === 'string'`, not by
  // `!= null`, and the 12-line comment on that predicate in
  // `shared/generate.mjs` argues the difference. Nothing measured it: every
  // case above is reachable with `!= null` too, because `parseRoster` cannot
  // build a non-string pool. So this roster is built BY HAND and never parsed,
  // the same way `hostileRoster` exercises `dqEscape` independent of the
  // parser — `generateAccountsSh` consumes a `Roster` structurally, and its
  // `.mjs` callers are not typechecked against that type at all.
  //
  // Under `!= null` the emitter would answer `junk) echo 7 ;;` for a value it
  // was never allowed to see; under `typeof === 'string'` it emits no arm, and
  // the account reads as untagged — the only honest answer for an unvalidated
  // value. Mutate the predicate and both assertions below red.
  it('emits NO arm for a non-string pool that reached the generator unvalidated', () => {
    const junkAccount = {
      id: 'junk', label: 'Junk', configDirSuffix: '.junk',
      exec: { kind: 'upstream' as const }, homeAble: true,
      hue: 'cyan' as const, telemetry: 'anthropic' as const, hidden: false,
      // `shared/generate.d.mts` types the parameter as `Roster`, so the cast is
      // what lets an unvalidated value past the compiler here the way an
      // untypechecked `.mjs` caller would let one past in production.
      pool: 7 as unknown as string,
    };
    const junkRoster = {
      version: 1 as const,
      accounts: [junkAccount],
      byId: new Map([['junk', junkAccount]]),
      byIdLengthDesc: [junkAccount],
      homeAble: [junkAccount],
      upstreamId: 'junk',
    };

    const body = generateAccountsSh(junkRoster);
    const block = body.slice(body.indexOf('_ccrc_pool() {'));
    const caseBody = block.slice(0, block.indexOf('esac'));
    expect(caseBody).not.toMatch(/^ {4}junk\)/m);

    // And the generated file in a real bash, which is what ccd will source:
    // silence at rc 0, indistinguishable from an untagged account.
    const junkHome = mkTmp('roster-gen-junk-pool-');
    mkdirSync(path.join(junkHome, '.ccrc'), { recursive: true });
    writeFileSync(path.join(junkHome, '.ccrc', 'accounts.sh'), body);
    expect(sh(junkHome, "_ccrc_pool 'junk' ; echo \"rc=$?\"")).toBe('rc=0');
  });
});
