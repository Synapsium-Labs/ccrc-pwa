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
