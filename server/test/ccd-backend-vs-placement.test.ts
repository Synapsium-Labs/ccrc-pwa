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

// ── THE OTHER HALF OF THE SPLIT ────────────────────────────────────────────
//
// `_is_anthropic_backend` above keeps Claude-only machinery off a Codex lane.
// This half is the mirror: it keeps Codex-only PROSE off everything else.
//
// `ccd ls` ends in a line per Codex lane reading that lane's usage story in
// Codex's vocabulary — "Codex weekly cap reached (100%)", a 5h cooldown
// countdown, the ccgpt-usage JSON shape. Until 2026-09-14 that trailer was a
// single hardcoded line about `gpt`, which by then was wrong twice over: a
// second Codex lane (`gpt2`) had existed since 2026-09-10 and had no line at
// all, and both lanes had become home-able on 2026-09-11, so calling either an
// "overflow lane" was false.
//
// The tempting repairs are both wrong, and `nx` is the fixture that proves it:
// a lane is NOT Codex because it is non-home-able (cx is home-able), and NOT
// because it is non-Anthropic (nx is neither Anthropic nor Codex). Only the
// positive `telemetry === 'codex'` membership can answer.
describe('_is_codex_backend — and why it is not the complement of the other two', () => {
  it('names the Codex lane and nothing else', () => {
    expect(yn('_is_codex_backend', 'cx')).toBe('yes');
    expect(yn('_is_codex_backend', 'an')).toBe('no');
  });

  it('says NO for a third-backend lane that is neither Anthropic nor placeable', () => {
    // THE WHOLE POINT. `nx` satisfies "not Anthropic" and "not home-able", so
    // either shortcut would hand it Codex's weekly-cap prose — a lane that has
    // never met Codex, told Codex's story. Both shortcuts are one character
    // shorter than the real question, which is how they get written.
    expect(yn('_is_anthropic_backend', 'nx')).toBe('no');
    expect(yn('_is_home_able', 'nx')).toBe('no');
    expect(yn('_is_codex_backend', 'nx')).toBe('no');
  });

  it('the generator emits the Codex membership as its own array', () => {
    expect(sh('echo "${CCRC_CODEX_BACKEND[@]}"')).toBe('cx');
  });

  it('_codex_lanes enumerates the same membership, in roster order', () => {
    expect(sh('_codex_lanes')).toBe('cx');
  });

  it('a roster with NO Codex lane enumerates NOTHING, not one empty line', () => {
    // `printf '%s\n' "${arr[@]}"` on an empty array prints a blank line, and a
    // blank line read back as a lane name is a lane called "" — which
    // `_is_valid_wrapper` would reject, but only by luck. The count guard makes
    // it produce no output at all, so the trailer is skipped rather than
    // silently malformed.
    const none = parseRoster({ version: 1, accounts: [
      { id: 'up', label: 'UP', configDirSuffix: '.up', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    ] });
    const dir = mkTmp('ccd-backend-nocodex-');
    mkdirSync(path.join(dir, '.ccrc'), { recursive: true });
    writeFileSync(path.join(dir, '.ccrc', 'accounts.sh'), generateAccountsSh(none));
    const out = execFileSync('bash', ['-c',
      `source "$HOME/.ccrc/accounts.sh"; source "${CCD}"; _codex_lanes | wc -l`],
      { cwd: dir, encoding: 'utf8',
        env: ghContainedEnv(dir, { ...process.env, HOME: dir }, { systemd: true, tmux: true }) }).trim();
    expect(out).toBe('0');
  });

  it('falls back to the historical single `gpt` when the roster predates the field', () => {
    // Same deploy window as `_is_anthropic_backend`'s fallback (a new ccd over
    // an old accounts.sh), but deliberately a DIFFERENT answer: reusing the
    // homeAble fallback would claim every placeable lane speaks Codex. Before
    // this array existed there was exactly one Codex lane and it was spelled
    // `gpt`, so that is what "behave as this box behaved yesterday" means.
    //
    // Its OWN home with the line stripped, for the reason the sibling fallback
    // test states: ccd sources `$HOME/.ccrc/accounts.sh` itself, so a legacy
    // file merely sourced alongside is overwritten by the real one — and the
    // test would pass against the array it meant to remove.
    const old = mkTmp('ccd-backend-precodex-');
    mkdirSync(path.join(old, '.ccrc'), { recursive: true });
    writeFileSync(path.join(old, '.ccrc', 'accounts.sh'), generateAccountsSh(roster)
      .split('\n').filter((l) => !l.startsWith('CCRC_CODEX_BACKEND=')).join('\n'));
    const ask = (snippet: string) => execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
      { cwd: old, encoding: 'utf8',
        env: ghContainedEnv(old, { ...process.env, HOME: old }, { systemd: true, tmux: true }) }).trim();
    expect(ask('_codex_lanes')).toBe('gpt');
    expect(ask('_is_codex_backend gpt && echo yes || echo no')).toBe('yes');
    // cx IS the Codex lane in this roster, but a pre-field accounts.sh cannot
    // say so — and inventing the answer is what the fallback must not do.
    expect(ask('_is_codex_backend cx && echo yes || echo no')).toBe('no');
  });
});

describe('the `ccd ls` trailer describes every Codex lane, not one by name', () => {
  /** Two Codex lanes and one Anthropic lane, all placeable — the live fleet's
   *  shape since 2026-09-11, which the single hardcoded trailer could not
   *  describe. */
  const twoLanes = parseRoster({ version: 1, accounts: [
    { id: 'an', label: 'AN', configDirSuffix: '.an', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'cx', label: 'CX', configDirSuffix: '.cx', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
    { id: 'cx2', label: 'CX2', configDirSuffix: '.cx2', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'codex' },
  ] });

  const lsOutput = (): string => {
    const dir = mkTmp('ccd-ls-trailer-');
    mkdirSync(path.join(dir, '.ccrc'), { recursive: true });
    writeFileSync(path.join(dir, '.ccrc', 'accounts.sh'), generateAccountsSh(twoLanes));
    // One session on `an`, one on `cx`, two on `cx2` — so a per-lane count that
    // is really the old single total would be visibly wrong on at least one line.
    const rows = ['an-p:an', 'cx-p:cx', 'cx2-p:cx2', 'cx2-q:cx2']
      .map((r) => { const [id, w] = r.split(':');
        return `_reg_set ${id} uuid u; _reg_set ${id} wrapper ${w}; _reg_set ${id} workdir /w/${id}; _reg_set ${id} started 1`; })
      .join('; ');
    return execFileSync('bash', ['-c',
      `source "$HOME/.ccrc/accounts.sh"; source "${CCD}"; ${rows}; _alive() { return 1; }; cmd_ls`],
      { cwd: dir, encoding: 'utf8',
        env: ghContainedEnv(dir, { ...process.env, HOME: dir }, { systemd: true, tmux: true }) });
  };

  it('prints one line per Codex lane, each counting only its own sessions', () => {
    const out = lsOutput();
    expect(out).toContain('codex lane cx: not installed  —  1 session(s) currently on it');
    expect(out).toContain('codex lane cx2: not installed  —  2 session(s) currently on it');
  });

  it('prints no such line for the Anthropic lane, however many sessions it holds', () => {
    expect(lsOutput()).not.toContain('codex lane an');
  });

  it('no longer calls a placeable lane an overflow lane', () => {
    // Both Codex lanes above are home-able. The words the trailer used to use
    // said the opposite, and an operator reading `ccd ls` had no other place to
    // learn otherwise.
    expect(lsOutput()).not.toContain('overflow lane');
  });
});
