// `ccrc account check` records the identity and runs the first-run seed in-verb (accounts plan Task A13; spec §6.2
// steps 8 and 9, §3.4, G1; D-5518, D-7731). OA1a measured, on 2026-11-01, that a sign-in lane's `.claude.json` exists
// before its first check (written by `auth login`) and that the probe turn does not add `hasCompletedOnboarding`, so
// the seed follows the probe and writes the flag itself. The token methods were not measured, so a lane that reaches
// its first check with no `.claude.json` has one created. The fixture is `laneStateFixture.ts`; every launcher here
// is a stub, and nothing reaches a real `claude`.
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_OP, HAVE_FLOCK, answer, ccrcRun, laneBox, laneState, modeOf,
} from './laneStateFixture.js';
import { LANE_IDENTITY_MAX, LANE_IDENTITY_SOURCES } from '../../shared/accounts.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

/** The upstream lane, one sign-in lane (no secrets file) and one token lane, in the plan's lane vocabulary. */
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-a', label: 'lane·a', configDirSuffix: '.claude-lane-a', exec: { kind: 'generated' },
      homeAble: true, hue: 'green', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane·b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  ],
};

const SUFFIX: Record<string, string> = { 'lane-a': '.claude-lane-a', 'lane-b': '.claude-lane-b' };
const claudeJson = (home: string, id: string): string => join(home, SUFFIX[id]!, '.claude.json');
const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

/** A box with the three lanes and their config directories. */
function seedBox(prefix: string): string {
  const home = laneBox(prefix, ROSTER);
  for (const s of Object.values(SUFFIX)) mkdirSync(join(home, s), { recursive: true });
  return home;
}

/**
 * The lane's launcher as a stub. `auth status` says signed in, as `email`. The probe turn appends to
 * `$HOME/probe-calls` and, when `rewrites`, rewrites the lane's `.claude.json` WITHOUT `hasCompletedOnboarding`, as
 * OA1a measured a probe run leaves it: the file grows, and the flag is not there.
 */
function plantStub(home: string, id: string, o: { email: string; rewrites: boolean }): void {
  const rewrite = o.rewrites
    ? `printf '%s\\n' '{"numStartups":1,"userID":"fixture","projects":{}}' > "$HOME/${SUFFIX[id]}/.claude.json"`
    : ':';
  writeFileSync(join(home, '.local', 'bin', id), [
    '#!/bin/sh',
    `if [ "$1" = auth ]; then echo '{"loggedIn":true,"authMethod":"claudeai","email":"${o.email}"}'; exit 0; fi`,
    'printf \'probe\\n\' >> "$HOME/probe-calls"',
    rewrite,
    'echo \'{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0}\'',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
}

describe('check runs the seed after its probe turn (G1)', () => {
  it('after check the flag reads true and `seedVerifiedAt > lastRunAt`', () => {
    const home = seedBox('ccrc-check-seed-order-');
    // What `auth login` left (OA1a): a file, and no onboarding flag in it.
    writeFileSync(claudeJson(home, 'lane-a'), '{"userID":"fixture"}\n', { mode: 0o600 });
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: true });

    const r = ccrcRun(home, ['account', 'check', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    const a = answer(r);
    expect((a['health'] as { verdict: string }).verdict).toBe('ok');
    expect(readFileSync(join(home, 'probe-calls'), 'utf8')).toBe('probe\n');

    const cj = readJson(claudeJson(home, 'lane-a'));
    expect(cj['hasCompletedOnboarding']).toBe(true);
    expect(cj['theme']).toBe('dark');
    // What the probe wrote stands: the seed adds to the file, it does not replace it.
    expect(cj['numStartups']).toBe(1);

    const st = laneState(home, 'lane-a')!;
    expect(typeof st['lastRunAt'], 'lastRunAt').toBe('string');
    expect(typeof st['seedVerifiedAt'], 'seedVerifiedAt').toBe('string');
    expect(Date.parse(st['seedVerifiedAt'] as string)).toBeGreaterThan(Date.parse(st['lastRunAt'] as string));
    const seed = a['seed'] as { verifiedAt: string; trustCopied: number };
    expect(seed.verifiedAt).toBe(st['seedVerifiedAt']);
    expect(seed.trustCopied).toBe(0);
  });

  it('only trust flags accepted upstream are copied, project by project, and the count is answered', () => {
    const home = seedBox('ccrc-check-seed-trust-');
    writeFileSync(join(home, '.claude.json'), `${JSON.stringify({
      theme: 'light',
      projects: {
        '/projects/project-a': { hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: true,
          allowedTools: ['Bash'], history: [{ display: 'not a flag' }] },
        '/projects/project-b': { hasTrustDialogAccepted: false, hasClaudeMdExternalIncludesApproved: false },
        '/projects/project-c': { hasClaudeMdExternalIncludesWarningShown: true, hasCompletedProjectOnboarding: true },
        '/projects/project-d': { mcpServers: { x: { command: 'not-a-flag' } } },
      },
    })}\n`);
    writeFileSync(claudeJson(home, 'lane-a'), '{"userID":"fixture"}\n', { mode: 0o600 });
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: true });

    const r = ccrcRun(home, ['account', 'check', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect((answer(r)['seed'] as { trustCopied: number }).trustCopied).toBe(2);

    const cj = readJson(claudeJson(home, 'lane-a'));
    expect(cj['theme'], 'the upstream lane\'s theme, since the lane had none').toBe('light');
    expect(cj['projects']).toEqual({
      '/projects/project-a': { hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: true },
      '/projects/project-c': { hasClaudeMdExternalIncludesWarningShown: true },
    });

    // A later check re-verifies: nothing is left to copy, and the file is not rewritten.
    const before = readFileSync(claudeJson(home, 'lane-a'), 'utf8');
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: false });
    const again = ccrcRun(home, ['account', 'check', '--id', 'lane-a']);
    expect(again.code, again.stderr).toBe(0);
    expect((answer(again)['seed'] as { trustCopied: number }).trustCopied).toBe(0);
    expect(readFileSync(claudeJson(home, 'lane-a'), 'utf8')).toBe(before);
  });

  it('the identity is recorded from `auth status --json` for a login lane and never for a token lane', () => {
    const home = seedBox('ccrc-check-seed-identity-');
    writeFileSync(claudeJson(home, 'lane-a'), '{}\n', { mode: 0o600 });
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: true });
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n',
      { mode: 0o600 });
    plantStub(home, 'lane-b', { email: 'other@example.invalid', rewrites: false });

    for (const id of ['lane-a', 'lane-b']) {
      const r = ccrcRun(home, ['account', 'check', '--id', id]);
      expect(r.code, `${id}: ${r.stderr}`).toBe(0);
    }
    expect(laneState(home, 'lane-a')).toMatchObject({ identity: 'someone@example.invalid', identitySource: 'measured' });
    const b = laneState(home, 'lane-b')!;
    expect(b).not.toHaveProperty('identity');
    expect(b).not.toHaveProperty('identitySource');
    expect(JSON.stringify(b)).not.toContain('other@example.invalid');
  });

  it('a token lane that reaches its first check with no `.claude.json` has one created, 0600, and seeded', () => {
    const home = seedBox('ccrc-check-seed-create-');
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(join(home, '.cc-secrets', 'lane-b-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=fixture-not-a-token\n',
      { mode: 0o600 });
    plantStub(home, 'lane-b', { email: 'other@example.invalid', rewrites: false });

    const r = ccrcRun(home, ['account', 'check', '--id', 'lane-b']);
    expect(r.code, r.stderr).toBe(0);
    expect(readJson(claudeJson(home, 'lane-b'))).toEqual({ hasCompletedOnboarding: true, theme: 'dark' });
    expect(modeOf(claudeJson(home, 'lane-b'))).toBe('600');
    expect(typeof laneState(home, 'lane-b')!['seedVerifiedAt']).toBe('string');
  });

  it('a `.claude.json` that is not a JSON object is refused and left byte for byte; the check still answers', () => {
    const home = seedBox('ccrc-check-seed-unreadable-');
    writeFileSync(claudeJson(home, 'lane-a'), 'not json\n', { mode: 0o600 });
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: false });

    const r = ccrcRun(home, ['account', 'check', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    const a = answer(r);
    expect(a['seed']).toEqual({ verifiedAt: null, error: 'seed-unreadable' });
    expect(r.stderr).toContain('cannot be seeded without losing what it holds');
    expect(readFileSync(claudeJson(home, 'lane-a'), 'utf8')).toBe('not json\n');
    const st = laneState(home, 'lane-a')!;
    expect(typeof st['lastRunAt']).toBe('string');
    expect(st).not.toHaveProperty('seedVerifiedAt');
  });

  it('`ccrc account seed --id` is the same step on its own: no Claude Code run, and the time recorded', () => {
    const home = seedBox('ccrc-check-seed-verb-');
    writeFileSync(claudeJson(home, 'lane-a'), '{"userID":"fixture"}\n', { mode: 0o640 });
    plantStub(home, 'lane-a', { email: 'someone@example.invalid', rewrites: true });

    const r = ccrcRun(home, ['account', 'seed', '--id', 'lane-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(answer(r)).toMatchObject({ ok: true, created: false, written: true, trustCopied: 0 });
    expect(readJson(claudeJson(home, 'lane-a'))).toEqual({ userID: 'fixture', hasCompletedOnboarding: true, theme: 'dark' });
    expect(modeOf(claudeJson(home, 'lane-a')), 'the file keeps its mode').toBe('640');
    expect(existsSync(join(home, 'probe-calls')), 'a Claude Code run').toBe(false);
    expect(typeof laneState(home, 'lane-a')!['seedVerifiedAt']).toBe('string');
  });
});

describe('the box spells the server\'s identity grammar (D-7731)', () => {
  it('`LANE_IDENTITY_SOURCES` and `LANE_IDENTITY_MAX` in deploy/account-op.mjs match shared/accounts.ts', () => {
    const src = readFileSync(ACCOUNT_OP, 'utf8');
    const sources = /^const LANE_IDENTITY_SOURCES = (\[[^\]]*\]);$/m.exec(src);
    expect(sources, 'account-op.mjs has no LANE_IDENTITY_SOURCES').toBeTruthy();
    expect(JSON.parse(sources![1]!.replace(/'/g, '"'))).toEqual([...LANE_IDENTITY_SOURCES]);
    const max = /^const LANE_IDENTITY_MAX = (\d+);$/m.exec(src);
    expect(Number(max?.[1])).toBe(LANE_IDENTITY_MAX);
  });
});
