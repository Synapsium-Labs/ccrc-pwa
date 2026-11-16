// The Overlord W1 pool set, PR B1 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`, Task 6):
// `ccd pool-answer --session <id>`, the read-only pool answer for the account a session runs on, and its parser,
// `server/src/poolrule.ts#parsePoolAnswer`.
//
// What it must hold: the line agrees with `_pool_ok` and `_crosspool_valid` run directly, for every side (an untagged
// project, a named one, a set, an unreadable set) and every account state; the verb writes nothing; rc 1 is "no such
// session", rc 2 usage, rc 3 a field of the session that could not be read, none of them with a line on stdout. The
// parser reads `ran` before `code` (Review Focus 6), so an older agent's `forbidden` is never "no such session".
//
// Fixture HOMEs only (`makeCcdHarness`); pool names are the fixture table's (`pool-a`, `pool-b`), account ids the test
// roster's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { CCD, makeCcdHarness, plantPoolEpoch, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parsePoolAnswer } from '../src/poolrule.js';
import { parsePoolAnswerCases } from './sim/poolSetSets.js';

let h: CcdHarness;
let reg: string;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-pool-answer-');
  seedAccountsSh(h.home, LANE_ROSTER);
  plantPoolEpoch(h.home, POOL_BY_ID);
  reg = path.join(h.home, '.cc-sessions');
});
afterEach(() => {
  try { fs.chmodSync(reg, 0o755); } catch { /* absent */ }
  for (const f of ['wrapper', 'project']) { try { fs.chmodSync(path.join(reg, `${ID}.${f}`), 0o644); } catch { /* absent */ } }
  h.cleanup();
});

const ID = 'lane-a-overlord';
/** Three neutral accounts of its own: one in each fixture pool and one untagged, declared and projected alike (a roster
 *  needs exactly one upstream account: `lane-a`). */
const lane = (id: string, hue: string, pool?: string): Record<string, unknown> => ({
  id, label: id, configDirSuffix: `.${id}`, exec: { kind: id === 'lane-a' ? 'upstream' : 'generated' }, homeAble: true, hue,
  telemetry: 'anthropic',
  ...(pool === undefined ? {} : { pool }),
});
const LANE_ROSTER = { version: 1, accounts: [lane('lane-a', 'cyan', 'pool-a'), lane('lane-b', 'violet', 'pool-b'), lane('lane-c', 'blue')] };
const POOL_BY_ID: Readonly<Record<string, string>> = { 'lane-a': 'pool-a', 'lane-b': 'pool-b' };
const PROJECT = 'project-a';
const seedRow = (wrapper: string, project: string | null = PROJECT): void => {
  h.sh(`_reg_set ${ID} uuid b7001948-3333-4bcc-b60b-0cfc0dc3d199
    _reg_set ${ID} wrapper ${wrapper}`);
  if (project !== null) h.sh(`_reg_set ${ID} project ${project}`);
};
const tagProject = (name: string): void => {
  fs.mkdirSync(path.join(reg, 'pools'), { recursive: true });
  fs.writeFileSync(path.join(reg, 'pools', PROJECT), `${name}\n`);
};
const plantSet = (spelling: string): void => { fs.writeFileSync(path.join(reg, `${ID}.poolset`), spelling); };
const unreadableSet = (): void => { fs.mkdirSync(path.join(reg, `${ID}.poolset`)); };
const plantCrossing = (pool: string, account: string): void => {
  fs.writeFileSync(path.join(reg, `${ID}.crosspool`), `1 ${pool} ${account}\n`);
};

const verb = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const r = spawnSyncGroup('bash', [CCD, 'pool-answer', ...args], {
    encoding: 'utf8', cwd: h.home, timeout: 30_000, env: h.env(),
  });
  return { code: r.status ?? -1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
};
/** What `_pool_ok` and `_crosspool_valid` answer, run directly on the same row: the line's oracle. */
const direct = (account: string): { verdict: string; poolSide: string; poolState: string; crossing: string; side: string } => {
  const out = h.sh(`p=$(_reg_read ${ID} project); s=$(_session_pool_side ${ID} "$p")
    _pool_ok ${account} "$s"; rc=$?; ps=$POOL_OK_SIDE; st=$POOL_OK_STATE
    _crosspool_valid ${ID} "$s" ${account}; x=$?
    printf '%s|%s|%s|%s|%s' "$rc" "$ps" "$st" "$x" "$s"`);
  const [rc, poolSide, poolState, x, side] = out.split('|') as [string, string, string, string, string];
  return {
    verdict: ['serve', 'mismatch', 'undecidable'][Number(rc)]!, poolSide, poolState: poolState.replace(' ', ':'),
    crossing: ['valid', 'none', 'unreadable'][Number(x)]!, side: side.replace(' ', ':'),
  };
};
const listing = (): string[] => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? [p, ...walk(p)] : [`${p} ${fs.lstatSync(p).size}`];
  });
  return walk(h.home).sort();
};

describe('parsePoolAnswer: the line\'s one reader, ran first (Review Focus 6)', () => {
  for (const [name, c] of Object.entries(parsePoolAnswerCases({ parsePoolAnswer }))) it(name, c);
});

describe('ccd pool-answer: the line agrees with _pool_ok and _crosspool_valid', () => {
  type Side = readonly [string, () => void];
  const SIDES: readonly Side[] = [
    ['an untagged project', () => {}],
    ['a project named pool-a', () => tagProject('pool-a')],
    ['the set pool-b', () => plantSet('pool-b')],
    ['the set pool-a,pool-b+untagged', () => plantSet('pool-a,pool-b+untagged')],
    ['an unreadable set', () => unreadableSet()],
    ['a malformed set', () => plantSet('pool-b,pool-a')],
  ];
  const ACCOUNTS: readonly (readonly [string, string])[] = [
    ['lane-a', 'in pool-a'], ['lane-b', 'in pool-b'], ['lane-c', 'untagged'],
  ];
  for (const [sideName, plant] of SIDES) {
    for (const [account, accountName] of ACCOUNTS) {
      it(`${sideName}, the account ${accountName}`, () => {
        seedRow(account);
        plant();
        const r = verb('--session', ID);
        expect(r.code, r.stderr).toBe(0);
        const read = parsePoolAnswer({ ran: true, code: r.code, stdout: r.stdout });
        expect(read.kind, r.stdout).toBe('answer');
        if (read.kind !== 'answer') return;
        const d = direct(account);
        expect(read.answer).toStrictEqual({
          side: d.side, verdict: d.verdict, poolSide: d.poolSide, poolState: d.poolState, crossing: d.crossing, account,
        });
      });
    }
  }

  it('a stale projection is undecidable on the account side, under a set and under a named project', () => {
    plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 });
    seedRow('lane-a');
    plantSet('pool-a');
    expect(verb('--session', ID).stdout)
      .toBe('pool-answer side=set:pool-a verdict=undecidable pool-side=account pool-state=stale crossing=none account=lane-a\n');
    fs.rmSync(path.join(reg, `${ID}.poolset`));
    tagProject('pool-a');
    expect(verb('--session', ID).stdout)
      .toBe('pool-answer side=named:pool-a verdict=undecidable pool-side=account pool-state=stale crossing=none account=lane-a\n');
  });

  it('the exact line for a set the account is outside, and for an unreadable set', () => {
    seedRow('lane-a');
    plantSet('pool-b');
    expect(verb('--session', ID).stdout)
      .toBe('pool-answer side=set:pool-b verdict=mismatch pool-side=account pool-state=named:pool-a crossing=none account=lane-a\n');
    fs.rmSync(path.join(reg, `${ID}.poolset`));
    unreadableSet();
    expect(verb('--session', ID).stdout)
      .toBe('pool-answer side=set-unreadable verdict=undecidable pool-side=set pool-state=unreadable crossing=none account=lane-a\n');
  });

  it('a valid crossing marker answers crossing=valid, a lapsed one none, an unreadable one unreadable', () => {
    seedRow('lane-a');
    plantSet('pool-b');
    plantCrossing('set:pool-b', 'lane-a');
    expect(verb('--session', ID).stdout).toContain(' verdict=mismatch pool-side=account pool-state=named:pool-a crossing=valid ');
    plantCrossing('set:pool-a', 'lane-a');
    expect(verb('--session', ID).stdout).toContain(' crossing=none ');
    fs.rmSync(path.join(reg, `${ID}.crosspool`));
    fs.mkdirSync(path.join(reg, `${ID}.crosspool`));
    expect(verb('--session', ID).stdout).toContain(' crossing=unreadable ');
  });

  it('a row with no project field reads the empty project, as _swap_target does: untagged', () => {
    seedRow('lane-a', null);
    expect(verb('--session', ID).stdout)
      .toBe('pool-answer side=untagged verdict=serve pool-side=project pool-state=untagged crossing=none account=lane-a\n');
  });

  it('writes nothing: the fixture HOME lists the same before and after', () => {
    seedRow('lane-b');
    plantSet('pool-a,pool-b');
    plantCrossing('set:pool-a,pool-b', 'lane-b');
    const before = listing();
    expect(verb('--session', ID).code).toBe(0);
    expect(listing()).toStrictEqual(before);
  });
});

describe('ccd pool-answer: its refusals carry no line', () => {
  it('rc 1: no such session (no uuid)', () => {
    const r = verb('--session', 'lane-a-nobody');
    expect(r).toMatchObject({ code: 1, stdout: '' });
    expect(r.stderr).toContain('no such session');
  });

  it('rc 2: usage, for any other argument shape or an id outside the registry-id grammar', () => {
    seedRow('lane-a');
    for (const args of [[], ['--session'], [ID], ['--session', ID, 'extra'], ['--id', ID], ['--session', '-x'], ['--session', 'a b'], ['--session', '../x']]) {
      const r = verb(...args);
      expect(r, JSON.stringify(args)).toMatchObject({ code: 2, stdout: '' });
    }
  });

  it('rc 3: the session\'s wrapper or project field could not be read, with a reason and no line', () => {
    seedRow('lane-a');
    fs.chmodSync(path.join(reg, `${ID}.wrapper`), 0o000);
    let r = verb('--session', ID);
    fs.chmodSync(path.join(reg, `${ID}.wrapper`), 0o644);
    if (process.getuid?.() !== 0) {
      expect(r).toMatchObject({ code: 3, stdout: '' });
      expect(r.stderr).toContain('wrapper');
    }
    fs.rmSync(path.join(reg, `${ID}.project`));
    fs.mkdirSync(path.join(reg, `${ID}.project`));
    r = verb('--session', ID);
    expect(r).toMatchObject({ code: 3, stdout: '' });
    expect(r.stderr).toContain('project');
    fs.rmSync(path.join(reg, `${ID}.project`), { recursive: true });
    fs.rmSync(path.join(reg, `${ID}.wrapper`));
    r = verb('--session', ID);
    expect(r, 'a row with no wrapper names no account to answer for').toMatchObject({ code: 3, stdout: '' });
  });

  it('a registry that cannot be searched is rc 3, never "no such session"', () => {
    seedRow('lane-a');
    fs.chmodSync(reg, 0o600);
    const r = verb('--session', ID);
    fs.chmodSync(reg, 0o755);
    if (process.getuid?.() !== 0) expect(r).toMatchObject({ code: 3, stdout: '' });
  });
});
