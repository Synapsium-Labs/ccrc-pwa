// ccd/ccd — WHERE WORK MAY GO is not WHAT THE LANE SPEAKS.
//
// `homeAble` answers the first question. Until a ChatGPT/Codex lane became
// placeable it accidentally answered the second too, because every home-able
// account was an Anthropic one — so four things in ccd ask `_is_home_able`
// while their own comments state a BACKEND reason:
//
//   1. `--remote-control` — Claude Code's own protocol; Codex cannot answer it.
//   2. `_inject_spawn_effort` — types Claude-specific input into the TUI.
//   3. the transcript sanitiser — exists FOR the cross-backend hop.
//   4. the 429 exclusion row — the Codex lane's only "pool is full" signal.
//
// Flipping `homeAble` on a Codex lane would silently re-point all four. This
// file pins the separation: `_is_anthropic_backend` answers the backend
// question, and it keeps answering correctly for a lane that is BOTH placeable
// and not Anthropic — the configuration that did not exist before.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { mkTmp } from './tmpHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';

/** A roster in the shape this change exists for: a Codex lane that IS placeable. */
const roster = parseRoster({ version: 1, accounts: [
  { id: 'an', label: 'AN', configDirSuffix: '.an', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'cx', label: 'CX', configDirSuffix: '.cx', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
  { id: 'nx', label: 'NX', configDirSuffix: '.nx', exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' },
] });

const home = mkTmp('ccd-backend-');
mkdirSync(path.join(home, '.ccrc'), { recursive: true });
writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(roster));

const sh = (snippet: string, accountsSh = true): string =>
  execFileSync('bash', ['-c',
    `${accountsSh ? 'source "$HOME/.ccrc/accounts.sh"; ' : ''}source "${CCD}"; ${snippet}`],
    { cwd: home, encoding: 'utf8',
      env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) }).trim();

const yn = (pred: string, w: string) => sh(`${pred} ${w} && echo yes || echo no`);

describe('_is_anthropic_backend — the question homeAble was overloaded with', () => {
  it('separates a PLACEABLE Codex lane from an Anthropic one', () => {
    // The configuration that did not exist before: cx is home-able AND not
    // Anthropic. Placement says yes to both; the backend question must not.
    expect(yn('_is_home_able', 'cx')).toBe('yes');
    expect(yn('_is_anthropic_backend', 'cx')).toBe('no');
    expect(yn('_is_home_able', 'an')).toBe('yes');
    expect(yn('_is_anthropic_backend', 'an')).toBe('yes');
  });

  it('still says no for a lane that is neither placeable nor Anthropic', () => {
    expect(yn('_is_home_able', 'nx')).toBe('no');
    expect(yn('_is_anthropic_backend', 'nx')).toBe('no');
  });

  it('falls back to _is_home_able when the roster predates the field', () => {
    // A box whose accounts.sh has not been regenerated must behave EXACTLY as
    // it did before this predicate existed — every one of the four callers
    // asked `_is_home_able` then, so that is the safe fallback.
    //
    // It needs its OWN home: ccd sources `$HOME/.ccrc/accounts.sh` itself, so a
    // legacy file sourced alongside would just be overwritten by the real one.
    const old = mkTmp('ccd-backend-legacy-');
    mkdirSync(path.join(old, '.ccrc'), { recursive: true });
    writeFileSync(path.join(old, '.ccrc', 'accounts.sh'), generateAccountsSh(roster)
      .split('\n').filter((l) => !l.startsWith('CCRC_ANTHROPIC_BACKEND=')).join('\n'));
    const ask = (w: string) => execFileSync('bash', ['-c',
      `source "${CCD}"; _is_anthropic_backend ${w} && echo yes || echo no`],
      { cwd: old, encoding: 'utf8',
        env: ghContainedEnv(old, { ...process.env, HOME: old }, { systemd: true, tmux: true }) }).trim();
    // cx is home-able, so the fallback answers yes — today's behaviour, kept.
    expect(ask('cx')).toBe('yes');
    expect(ask('nx')).toBe('no');
  });

  it('a roster with NO Anthropic account answers no, rather than falling back', () => {
    // `${CCRC_ANTHROPIC_BACKEND+x}` tests ELEMENT 0 on an array, so a
    // declared-but-empty array would read as absent and take the homeAble
    // fallback — turning "this roster has no Anthropic lane" into "every
    // placeable lane is an Anthropic lane", which is the opposite answer.
    // The schema requires exactly one `upstream` account, so "no Anthropic lane"
    // is reachable only as an upstream that reports no telemetry.
    const codexOnly = parseRoster({ version: 1, accounts: [
      { id: 'up', label: 'UP', configDirSuffix: '.up', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'none' },
      { id: 'cx', label: 'CX', configDirSuffix: '.cx', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
    ] });
    const only = mkTmp('ccd-backend-codexonly-');
    mkdirSync(path.join(only, '.ccrc'), { recursive: true });
    writeFileSync(path.join(only, '.ccrc', 'accounts.sh'), generateAccountsSh(codexOnly));
    const out = execFileSync('bash', ['-c',
      `source "${CCD}"; _is_anthropic_backend cx && echo yes || echo no`],
      { cwd: only, encoding: 'utf8',
        env: ghContainedEnv(only, { ...process.env, HOME: only }, { systemd: true, tmux: true }) }).trim();
    expect(out).toBe('no');
  });

  it('the generator emits the two sets independently', () => {
    expect(sh('echo "${CCRC_HOME_ABLE[@]}"')).toBe('an cx');
    expect(sh('echo "${CCRC_ANTHROPIC_BACKEND[@]}"')).toBe('an');
    // CCRC_MEASURED drives the STATUSLINE writer and must NOT gain the Codex
    // lane: its row is written by ccgpt-usage, and a second writer would race it.
    expect(sh('echo "${CCRC_MEASURED[@]}"')).toBe('an');
  });
});

describe('the four callers now ask the backend question', () => {
  const src = readFileSync(CCD, 'utf8');   // ccd is ~17k lines: a spawned cat ENOBUFs
  const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));

  it('the transcript sanitiser fires on the CROSS-BACKEND hop', () => {
    // Not "into a placeable lane" — Codex -> Anthropic must still sanitise once
    // the Codex lane is itself placeable.
    const line = code.find((l) => l.includes('sanitize=1'));
    expect(line).toBeDefined();
    expect(line).toContain('_is_anthropic_backend "$cur"');
    expect(line).toContain('_is_anthropic_backend "$target"');
  });

  it('Remote Control and the effort injection are gated on the backend', () => {
    expect(code.find((l) => l.includes("rcflag=\"--remote-control")))
      .toContain('_is_anthropic_backend');
    expect(code.find((l) => l.includes('_inject_spawn_effort "$tname"')))
      .toContain('_is_anthropic_backend');
  });

  it('placement keeps asking the PLACEMENT question', () => {
    // The two sites that genuinely mean "may work go here" must not have moved.
    expect(code.some((l) => l.includes('_is_home_able "$w" && continue'))).toBe(true);
    expect(code.some((l) => l.includes('if _is_home_able "$cand"; then'))).toBe(true);
  });
});
