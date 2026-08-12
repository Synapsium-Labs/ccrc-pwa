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
      hue: 'cyan' as const, telemetry: 'anthropic' as const,
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
