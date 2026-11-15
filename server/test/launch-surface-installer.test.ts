// server/test/launch-surface-installer.test.ts
//
// The overlord row registers ccrc's hook and status line itself, because pinned setting sources drop the account's
// settings that `ccd/install-session-hooks.sh` writes them into (Overlord W1 sandbox Task 2; the W0 results' proposal 4;
// slug `statusline-registered-by-the-profile`). Two writers of one registration would drift, so this suite runs the real
// installer on an empty fixture home and holds what it writes equal to the row's `surfaceSettings` (the `CHILD_DENY_RULES`
// precedent): a rule that changes in either one is red here.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { launchRowOf } from '../src/continuity/launchProfile.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');

describe("the overlord surface's hooks and status line are the installer's (proposal 4)", () => {
  it('deep-equals what install-session-hooks.sh writes into an empty home', () => {
    const home = mkTmp('ccrc-surface-install-');
    const cfg = path.join(home, '.claude');
    fs.mkdirSync(cfg, { recursive: true });
    fs.mkdirSync(path.join(home, 'ccrc-backups'), { recursive: true });
    execFileSync('bash', [INSTALLER, '--homes', cfg], { env: { ...process.env, HOME: home } });
    const written = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8')) as { hooks: unknown; statusLine: unknown };
    const surface = (launchRowOf('overlord') as { surfaceSettings: { hooks: unknown; statusLine: unknown } }).surfaceSettings;
    expect(surface.hooks).toStrictEqual(written.hooks);
    expect(surface.statusLine).toStrictEqual(written.statusLine);
  });
});
