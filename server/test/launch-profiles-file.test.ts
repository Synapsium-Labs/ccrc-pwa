// server/test/launch-profiles-file.test.ts
//
// `ccd/lib/launch-profiles.json` is ccd's copy of `FLEET_ROLES.launchProfile` (Overlord W1a launch profiles, Task 2;
// spec §3.6, H1): a projection, never a second source. ccd reads it at every spawn whose route names a `profile`
// (`_profile_spawn_compose`), so a file that drifted from the table would launch a role with switches nobody ruled.
// This suite holds the two equal, byte for byte, and prints the expected text on a mismatch so it can be pasted.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FLEET_ROLE_NAMES } from '../../shared/fleetRoles.js';
import { HOOK_EVENTS } from '../../shared/hook-events.js';
import { launchRowOf } from '../src/continuity/launchProfile.js';

const FILE = path.resolve(__dirname, '../../ccd/lib/launch-profiles.json');

/** The projection is `launchRowOf` (Overlord W1 sandbox Task 2): the one function the file, ccd's digest, the route field
 *  `profiledigest` and the sandbox check all call (Review Focus 4). A row with no surface is W1a's five keys: `env`,
 *  `settings`, `autoMemory`, `compactionSettings` (`compaction.settings` or `{}`) and `compactText` (the role's compaction
 *  instructions, `compactInstructionsFor`), and `longLived` (`FLEET_ROLES`'s column); `aboveHardCapPts` stays server-side. A surfaced row adds what ccd renders. */
const projection = (): unknown => Object.fromEntries([...FLEET_ROLE_NAMES].sort().map((r) => [r, launchRowOf(r)]));
const expectedText = (): string => `${JSON.stringify(projection(), null, 2)}\n`;
/** W1a's five keys, and `longLived` (Overlord W1 ccd arms, Task 4): the column ccd's hold-down and `/model` skip read. */
const FIVE = ['autoMemory', 'compactText', 'compactionSettings', 'env', 'longLived', 'settings'];
const SURFACED = [...FIVE, 'flags', 'memory', 'remoteControl', 'stagedSkills', 'surfaceSettings'].sort();

/** Every string and number in a JSON value, keys included. */
function leaves(v: unknown, out: { strings: string[]; numbers: number[] } = { strings: [], numbers: [] }): { strings: string[]; numbers: number[] } {
  if (typeof v === 'string') out.strings.push(v);
  else if (typeof v === 'number') out.numbers.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.strings.push(k); leaves(x, out); }
  return out;
}

describe('ccd/lib/launch-profiles.json is the role table, projected (H1)', () => {
  it('equals the projection of FLEET_ROLES, byte for byte', () => {
    const text = fs.readFileSync(FILE, 'utf8');
    if (text !== expectedText()) {
      console.log(`ccd/lib/launch-profiles.json should read:\n${expectedText()}`);
    }
    expect(JSON.parse(text)).toStrictEqual(projection());
    expect(text).toBe(expectedText());
  });
  it('carries no role and no key the table lacks', () => {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, Record<string, unknown>>;
    expect(Object.keys(parsed).sort()).toEqual([...FLEET_ROLE_NAMES].sort());
    for (const r of Object.keys(parsed)) {
      expect(Object.keys(parsed[r]!).sort(), r).toEqual(r === 'overlord' ? SURFACED : FIVE);
    }
  });
  it('holds only what jq -cS and JSON.stringify spell alike: printable ASCII strings and integers (launchDigestOf)', () => {
    // jq and JSON.stringify differ on DEL, astral key order and exponent spellings (measured), so the digest ccd computes
    // and the server's agree only while the row holds neither.
    const { strings, numbers } = leaves(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    for (const s of strings) expect(s, s).toMatch(/^[\x20-\x7e]*$/);
    for (const n of numbers) expect(Number.isInteger(n), String(n)).toBe(true);
  });
  it("the overlord row's flag words are argv-safe, and the agents value carries no single quote", () => {
    const flags = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, { flags?: string[] }>).overlord!.flags!;
    const at = flags.indexOf('--agents');
    expect(at).toBeGreaterThan(-1);
    flags.forEach((w, i) => { if (i !== at + 1) expect(w).toMatch(/^[A-Za-z0-9,._-]+$/); });
    expect(flags[at + 1]).not.toContain("'");
  });
  it('ships where ccd reads it: both installers place it in ~/.cc-sessions/lib, ccd fallback path, and uninstall removes it', () => {
    const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
    expect(read('ccd/ccd')).toContain('[[ -f "$LAUNCH_PROFILES_JSON" ]] || LAUNCH_PROFILES_JSON="$HOME/.cc-sessions/lib/launch-profiles.json"');
    const ccrc = read('ccd/ccrc');
    expect(ccrc).toContain('_inst_atomic "$tree/ccd/lib/launch-profiles.json" "$HOME/.cc-sessions/lib/launch-profiles.json" 644');
    expect(ccrc).toContain('_upd_backup_copy "$HOME/.cc-sessions/lib/launch-profiles.json" launch-profiles.json');
    expect(ccrc).toContain('"$reg/lib/launch-profiles.json" \\');
    expect(read('deploy/deploy.sh')).toContain('install_atomic ccd/lib/launch-profiles.json .cc-sessions/lib/launch-profiles.json 644');
  });
  it('ships the constitution beside it: both installers, the backup set and uninstall (W1 sandbox Task 2)', () => {
    const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
    const ccrc = read('ccd/ccrc');
    expect(ccrc).toContain('_inst_atomic "$tree/ccd/lib/overlord-constitution.md" "$HOME/.cc-sessions/lib/overlord-constitution.md" 644');
    expect(ccrc).toContain('_upd_backup_copy "$HOME/.cc-sessions/lib/overlord-constitution.md" overlord-constitution.md');
    expect(ccrc).toContain('"$reg/lib/overlord-constitution.md" \\');
    expect(read('deploy/deploy.sh')).toContain('install_atomic ccd/lib/overlord-constitution.md .cc-sessions/lib/overlord-constitution.md 644');
  });
  it("every value is a literal ccd may put on an argv: no quote, no space, no shell character", () => {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, { env: Record<string, string> }>;
    for (const [r, p] of Object.entries(parsed)) {
      for (const [k, v] of Object.entries(p.env)) {
        expect(k, r).toMatch(/^CLAUDE_CODE_[A-Z_]+$/);
        expect(v, `${r} ${k}`).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    }
    expect(fs.readFileSync(FILE, 'utf8')).not.toContain("'");
  });
  it("the overlord row registers ccrc's hook on every HOOK_EVENTS event, the model events included (door process B2)", () => {
    // A new hook event changes the row, so the Overlord's digest moves with it: a running Overlord reads
    // `launch-profile-unmet` until its next start (the plan's sequencing note, ruled F13).
    const hooks = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, { surfaceSettings: { hooks: Record<string, unknown> } }>)
      .overlord!.surfaceSettings.hooks;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(Object.keys(hooks)).toEqual(expect.arrayContaining(['PreModelSwitch', 'PostModelSwitch']));
  });
});
