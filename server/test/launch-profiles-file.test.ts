// server/test/launch-profiles-file.test.ts
//
// `ccd/lib/launch-profiles.json` is ccd's copy of `FLEET_ROLES.launchProfile` (Overlord W1a launch profiles, Task 2;
// spec §3.6, H1): a projection, never a second source. ccd reads it at every spawn whose route names a `profile`
// (`_profile_spawn_compose`), so a file that drifted from the table would launch a role with switches nobody ruled.
// This suite holds the two equal, byte for byte, and prints the expected text on a mismatch so it can be pasted.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FLEET_ROLES, FLEET_ROLE_NAMES } from '../../shared/fleetRoles.js';

const FILE = path.resolve(__dirname, '../../ccd/lib/launch-profiles.json');

/** Every object's keys sorted, recursively, so the file has one spelling. */
const sorted = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
};

/** The projection: `{ role: { env, settings, autoMemory, compactionSettings } }`, `compactionSettings` being
 *  `compaction.settings` or `{}`. `aboveHardCapPts` stays server-side (the threshold is computed per session and rides
 *  the route's `compactwindow`), so ccd's copy does not carry it. */
const projection = (): unknown => sorted(Object.fromEntries(FLEET_ROLE_NAMES.map((r) => {
  const p = FLEET_ROLES[r].launchProfile;
  return [r, { env: p.env, settings: p.settings, autoMemory: p.autoMemory, compactionSettings: p.compaction?.settings ?? {} }];
})));
const expectedText = (): string => `${JSON.stringify(projection(), null, 2)}\n`;

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
      expect(Object.keys(parsed[r]!).sort(), r).toEqual(['autoMemory', 'compactionSettings', 'env', 'settings']);
    }
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
});
