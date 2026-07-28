// ccd and the ccrc server both read ~/.cc-limits and both decide something from
// it — routing and the accounts strip respectively. They cannot share code
// across the language boundary, so they share FIXTURES instead: if either
// implementation of the rollover rule drifts, this file goes red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { rolloverCases } from './fixtures/rollover.js';

const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
let home: string;

/** ccd reads the clock itself, so fixtures are written relative to real now. */
const now = (): number => Math.floor(Date.now() / 1000);

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-ccd-limits-'));
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  // _avail requires the wrapper binary to exist and be executable.
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const writeLimits = (file: string, content: string): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', file), content);

const json = (o: Record<string, number>): string => JSON.stringify(o);

/** readLimits says "unknown" with null; _limit_field says it with an empty
 *  string. Same state, two vocabularies — translate, don't compare literally,
 *  or `String(null)` quietly demands that bash print the word "null". */
const asShell = (v: number | null): string => (v === null ? '' : String(v));

describe('_limit_field rollover', () => {
  it('agrees with readLimits on every shared fixture', () => {
    for (const c of rolloverCases(now())) {
      const wrapper = c.file.slice(0, -'.json'.length);
      writeLimits(c.file, c.content);
      expect(sh(`_limit_field ${wrapper} five`), `${c.file} five: ${c.why}`)
        .toBe(asShell(c.expect.five));
      expect(sh(`_limit_field ${wrapper} seven`), `${c.file} seven: ${c.why}`)
        .toBe(asShell(c.expect.seven));
    }
  });

  it('still answers "unknown" when the caller demanded fresh telemetry', () => {
    // The maxage gate must win: a caller asking for fresh data gets nothing,
    // not an inferred 0 it did not ask for.
    const t = now();
    writeLimits('claude.json', json({ five: 50, seven: 50, ts: t - 9000, fiveResetAt: t - 100, sevenResetAt: t - 100 }));
    expect(sh('_limit_field claude five 1800')).toBe('');
  });
});

describe('_gpt_status on a python-written gpt.json', () => {
  // ~/.cc-limits/gpt.json is written by infra/handoff/ccgpt-usage (python
  // json.dump), whose default separators put a space after every colon. Every
  // other reader in ccd tolerates that; _gpt_status must too, or `ccd ls`
  // silently drops the cooldown countdown it exists to print.
  const excludeGpt = (spacing: string): void => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    // 30m30s into the 5h cooldown: the remaining minutes floor to 269 for a
    // full half-minute, so ccd reading its own clock a beat later can't flake.
    const t = now() - 1830;
    writeLimits('gpt.json', `{"five":${spacing}100,"seven":${spacing}0,"ts":${spacing}${t}}`);
  };

  it('reports the remaining cooldown when json.dump spaced the colons', () => {
    excludeGpt(' ');
    expect(sh('_gpt_status')).toBe('429-excluded (~269m of 5h cooldown left)');
  });

  it('still reports it for compact printf-written json', () => {
    excludeGpt('');
    expect(sh('_gpt_status')).toBe('429-excluded (~269m of 5h cooldown left)');
  });
});

describe('the account that was stranded on 2026-07-27', () => {
  const strand = (): void => {
    const t = now();
    // claude: 20h-old sample, 7d window reset 14h ago -> read as 98 before the fix.
    writeLimits('claude.json', json({ five: 10, seven: 98, ts: t - 72000, fiveResetAt: t - 72000, sevenResetAt: t - 50000 }));
    writeLimits('claude2.json', json({ five: 0, seven: 93, ts: t - 60, fiveResetAt: t + 17000, sevenResetAt: t + 105000 }));
    writeLimits('claude-corp.json', json({ five: 9, seven: 57, ts: t - 60, fiveResetAt: t + 17000, sevenResetAt: t + 260000 }));
    // Registry for a session whose HOME is claude but which sits on gpt.
    const reg = path.join(home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'claude-synapsium-platform.home'), 'claude');
    fs.writeFileSync(path.join(reg, 'claude-synapsium-platform.wrapper'), 'gpt');
  };

  it('makes the home account available again', () => {
    strand();
    expect(sh('_avail claude && echo AVAIL || echo NO')).toBe('AVAIL');
  });

  it('sends the exiled session home instead of leaving it on gpt', () => {
    strand();
    expect(sh('_swap_target claude-synapsium-platform gpt claude')).toBe('claude');
  });
});
