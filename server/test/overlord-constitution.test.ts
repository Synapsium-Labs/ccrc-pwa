// server/test/overlord-constitution.test.ts
//
// The Overlord's constitution (Overlord W1 sandbox, Task 2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`,
// question 8; spec §3.3.3 and §11.3): the workspace memory file the launch profile ships, which ccd links into the
// Overlord's workspace as its `CLAUDE.md`. It sits in the cached prefix of every generation, so it is held small, and its
// sha256 is the row's `constitutionSha256`, which the sandbox check compares the loaded file against.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FLEET_ROLES } from '../../shared/fleetRoles.js';

const FILE = path.resolve(__dirname, '../../ccd/lib/overlord-constitution.md');
const text = (): string => fs.readFileSync(FILE, 'utf8');

describe('ccd/lib/overlord-constitution.md (question 8)', () => {
  it('is at most 8,000 bytes', () => {
    expect(fs.statSync(FILE).size).toBeLessThanOrEqual(8000);
  });
  it('carries one line per ruling R1 to R20 and per anti-goal A1 to A15, each starting with its id, in order', () => {
    const ids = text().split('\n').map((l) => /^([RA]\d+):/.exec(l)?.[1]).filter((x): x is string => x !== undefined);
    expect(ids).toStrictEqual([...Array.from({ length: 20 }, (_, i) => `R${i + 1}`), ...Array.from({ length: 15 }, (_, i) => `A${i + 1}`)]);
  });
  it("its sha256 is the overlord surface's constitutionSha256", () => {
    expect(createHash('sha256').update(fs.readFileSync(FILE)).digest('hex')).toBe(FLEET_ROLES.overlord.launchProfile.surface?.constitutionSha256);
  });
  it('names no shell command: no backtick, no dollar sign, no prompt line', () => {
    expect(text()).not.toMatch(/[`$]/);
    expect(text()).not.toMatch(/^\s*(\$|#!)/m);
    expect(text()).not.toMatch(/\b(bash|sh -c|sudo|curl|git|ccd|tmux|rm -)\b/);
  });
});
