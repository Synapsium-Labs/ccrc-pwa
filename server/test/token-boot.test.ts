// The box token at boot (server/src/token/boot.ts, spec 4.2, 4.2.1, 4.10; D-4388):
// the mint, the hand-made refusals kept exactly, recovery for server-written
// files only, a retired value never coming back, the auxiliary files, and the
// both-role boot write on a RECORDED both box only. Fixture homes only; every
// value here is random per run and is searched for in everything boot printed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
} from 'node:fs';
import { promises as fsp } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootBoxToken, type BootInput, type BootResult } from '../src/token/boot.js';
import {
  appendRetired, mintGenerationId, mintValue, readState, renameOverAtomic, tokenPaths, valueDigestHex,
  writeState, writeValueFileAtomic,
} from '../src/token/files.js';
import { PENDING_HARD_CAP, confirmedGeneration, handedOutState, promotedState, stagedState, type BoxTokenState } from '../src/token/policy.js';
import { checkMailToken, MailTokenFileUnusable, MailTokenPlaceholderUnedited, PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_VALUE_RE } from '../../shared/box-token.js';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { loopbackCurlFront } from './containedTools.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

afterEach(() => { vi.restoreAllMocks(); });

const mkHome = (): string => {
  const home = mkTmp('ccrc-token-boot-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  return home;
};
const P = (home: string) => tokenPaths(path.join(home, '.ccrc', 'mail.token'), home);
const input = (home: string, over: Partial<BootInput> = {}): BootInput => ({
  mailTokenPath: P(home).current, home, role: 'server', roleSource: 'recorded', fleetMode: 'remote', now: Date.now(), ...over,
});

/** Everything boot could print, captured: console and both std streams, plus its own warnings. */
async function boot(home: string, over: Partial<BootInput> = {}): Promise<BootResult & { printed: string }> {
  const out: string[] = [];
  for (const m of ['warn', 'log', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a) => { out.push(a.join(' ')); });
  const w1 = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
  const w2 = vi.spyOn(process.stderr, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
  try {
    const r = await bootBoxToken(input(home, over));
    return { ...r, printed: [...out, ...r.warnings].join('\n') };
  } finally { w1.mockRestore(); w2.mockRestore(); }
}
const neverPrinted = (printed: string, ...values: string[]): void => {
  for (const v of values) {
    expect(printed.includes(v), 'a value was printed').toBe(false);
    expect(printed.includes(valueDigestHex(v)), 'a value digest was printed').toBe(false);
  }
};

/** One rotation done with the adapter and the policy, exactly as the driver orders it (spec §5). */
async function rotateOnce(home: string, r: BootResult): Promise<{ old: string; next: string; id: string; state: BoxTokenState }> {
  const paths = P(home);
  const old = r.holder.currentValue() as string;
  const id = mintGenerationId();
  const next = mintValue();
  const now = Date.now();
  let s = stagedState(r.state as BoxTokenState, id, now, await writeValueFileAtomic(paths.pending(id), `${next}\n`));
  s = handedOutState(s, id, now);
  const prevW = await writeValueFileAtomic(paths.previous, `${old}\n`);
  await renameOverAtomic(paths.pending(id), paths.current);
  s = promotedState(s, id, now, prevW);
  await writeState(paths.state, s);
  return { old, next, id, state: s };
}
/** Truncate in place and set the mtime back before the record: what a lost data flush leaves. */
const tornWrite = (p: string): void => {
  const before = statSync(p).mtime;
  truncateSync(p, 0);
  utimesSync(p, before, new Date(before.getTime() - 1000));
};

describe('mint, adopt and the hand-made refusals (spec 4.2)', () => {
  it('absent with no history: 64 hex minted at 0600, origin minted, nothing owed, warned once', async () => {
    const home = mkHome();
    const r = await boot(home);
    const v = readFileSync(P(home).current, 'utf8');
    expect(v).toMatch(/^[0-9a-f]{64}\n$/);
    expect(v.trim()).toMatch(TOKEN_VALUE_RE);
    expect(statSync(P(home).current).mode & 0o777).toBe(0o600);
    expect(checkMailToken(r.holder, v.trim())).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: false });
    // A minted value carries a generation id (plan assembly): the fleet's absent generation then reads behind.
    expect(r.state?.current.id).toMatch(GENERATION_ID_RE);
    expect(r.warnings).toEqual([`ccrc-server: box token: minted a new value at ${P(home).current} (no token existed)`]);
    expect((await readState(P(home).state)).kind).toBe('state');
    neverPrinted(r.printed, v.trim());
  });

  it('a present, usable value with no state is adopted, and the first rotation is owed', async () => {
    const home = mkHome();
    const v = mintValue();
    writeFileSync(P(home).current, `# hand-made\n${v}\n`, { mode: 0o600 });
    const r = await boot(home);
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
    expect(checkMailToken(r.holder, v)).toBe('ok');
    const rec = await readState(P(home).state);
    expect(rec.kind === 'state' && rec.state.rotationOwed).toBe(true);
    expect(r.warnings.join('\n')).toContain('adopted the hand-made value');
    neverPrinted(r.printed, v);
  });

  it.each([
    ['0 bytes', '', MailTokenFileUnusable], ['comments only', '# x\n', MailTokenFileUnusable],
    ['the placeholder', `${PLACEHOLDER_TOKEN}\n`, MailTokenPlaceholderUnedited],
  ])('a hand-made file that is %s still refuses boot exactly as today', async (_n, content, cls) => {
    const home = mkHome();
    writeFileSync(P(home).current, content);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(cls);
  });

  it.skipIf(isRoot)('a read error still refuses boot (EACCES)', async () => {
    const home = mkHome();
    writeFileSync(P(home).current, `${mintValue()}\n`);
    chmodSync(P(home).current, 0o000);
    await expect(bootBoxToken(input(home))).rejects.toMatchObject({ code: 'EACCES' });
  });

  // Conventions I1 (D-4403 item 2): a state or retired file that cannot be READ is not a malformed one. Boot must not
  // treat it as "no state" (that rewrites box-token.json and loses the history); it refuses, naming the path and errno.
  it.each([['state', 'box-token.json'], ['retired', 'box-token-retired.json']] as const)(
    'an unreadable %s file refuses boot, naming the path and the errno only, and writes nothing over it', async (_n, file) => {
      const home = mkHome();
      const v = mintValue();
      writeFileSync(P(home).current, `${v}\n`, { mode: 0o600 });
      const target = path.join(home, '.ccrc', file);
      mkdirSync(target);                                                  // EISDIR on read
      const err = await bootBoxToken(input(home)).then(() => null, (e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toBe(`${target}: unreadable (EISDIR); boot refuses rather than rewrite it`);
      expect(err?.message).not.toContain(v);
      expect(statSync(target).isDirectory()).toBe(true);                  // nothing was written over it
      expect(readFileSync(P(home).current, 'utf8')).toBe(`${v}\n`);
    });

  it.skipIf(isRoot)('a failed mint boots with no current value: every lane answers unconfigured, and the mint is retried', async () => {
    const home = mkHome();
    chmodSync(path.join(home, '.ccrc'), 0o500);
    try {
      const r = await boot(home);
      expect(r.mintFailed).toBe(true);
      expect(r.holder.hasCurrent()).toBe(false);
      expect(checkMailToken(r.holder, 'f'.repeat(64))).toBe('unconfigured');
      expect(r.warnings.join('\n')).toMatch(/could not mint at .*\(EACCES\).*the driver retries each minute/);
    } finally { chmodSync(path.join(home, '.ccrc'), 0o700); }
  });
});

describe('boot recovery, server files only (spec 4.2.1)', () => {
  it('a torn mail.token the server wrote is recovered from mail-previous.token, warned, and a rotation owed', async () => {
    const home = mkHome();
    const first = await boot(home);
    const { old, next } = await rotateOnce(home, first);
    tornWrite(P(home).current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, old)).toBe('ok');                 // the previous value, now current
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'recovered', previous: null });
    expect(r.state?.lastBootRecovery?.source).toBe('previous');
    expect(existsSync(P(home).previous)).toBe(false);
    expect(r.warnings.join('\n')).toContain(`${P(home).current} carries no usable value, but this server wrote it (generation #2); `
      + `recovered from ${P(home).previous}, also written by this server.`);
    neverPrinted(r.printed, old, next);
  });

  it('a recorded promotion finishes at boot with no 401: the pending value becomes current, the old one previous', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const paths = P(home);
    const old = r0.holder.currentValue() as string;
    const id = mintGenerationId();
    const next = mintValue();
    let s = stagedState(r0.state as BoxTokenState, id, Date.now(), await writeValueFileAtomic(paths.pending(id), `${next}\n`));
    s = { ...handedOutState(s, id, Date.now()), promoting: { id } };   // step (a) recorded, then the process died
    await writeState(paths.state, s);
    const r = await boot(home);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(checkMailToken(r.holder, old)).toBe('ok');                  // previous, in grace
    expect(r.state).toMatchObject({ origin: 'rotated', promoting: null, current: { id } });
    expect(existsSync(paths.pending(id))).toBe(false);
  });

  it('a promotion that died after its rename (step c) is finished from the record', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const paths = P(home);
    const old = r0.holder.currentValue() as string;
    const id = mintGenerationId();
    const next = mintValue();
    let s = stagedState(r0.state as BoxTokenState, id, Date.now(), await writeValueFileAtomic(paths.pending(id), `${next}\n`));
    s = { ...handedOutState(s, id, Date.now()), promoting: { id } };
    await writeState(paths.state, s);
    await writeValueFileAtomic(paths.previous, `${old}\n`);
    await renameOverAtomic(paths.pending(id), paths.current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(checkMailToken(r.holder, old)).toBe('ok');
    expect(r.state?.current.id).toBe(id);
  });

  it.each<[string, (home: string, rot: Awaited<ReturnType<typeof rotateOnce>>) => Promise<void> | void]>([
    ['origin adopted', async (home, rot) => { await writeState(P(home).state, { ...rot.state, origin: 'adopted' }); }],
    ['no state file', (home) => { rmSync(P(home).state); }],
    ['mail.token replaced with a new inode', (home) => { rmSync(P(home).current); writeFileSync(P(home).current, ''); }],
    ['an in-place edit with a later mtime', (home) => {
      const p = P(home).current; truncateSync(p, 0); const t = new Date(Date.now() + 60_000); utimesSync(p, t, t);
    }],
    ['a previous file holding a retired value', async (home, rot) => { await appendRetired(P(home).retired, valueDigestHex(rot.old), 1); }],
    ['a handed-out pending file as the only sibling', async (home, rot) => {
      const paths = P(home);
      const id = mintGenerationId();
      const s = handedOutState(stagedState({ ...rot.state, previous: null }, id, Date.now(),
        await writeValueFileAtomic(paths.pending(id), `${mintValue()}\n`)), id, Date.now());
      rmSync(paths.previous);
      await writeState(paths.state, s);
    }],
  ])('refuses as today (MailTokenFileUnusable): %s', async (_n, spoil) => {
    const home = mkHome();
    const rot = await rotateOnce(home, await boot(home));
    tornWrite(P(home).current);
    await spoil(home, rot);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(MailTokenFileUnusable);
  });

  it('mail.token absent on a box with history is recovered, not minted', async () => {
    const home = mkHome();
    const { old } = await rotateOnce(home, await boot(home));
    rmSync(P(home).current);
    const r = await boot(home);
    expect(r.holder.currentValue()).toBe(old);
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'recovered' });
  });

  it('mail.token absent with history and no qualifying sibling: minted, and a rotation owed', async () => {
    const home = mkHome();
    const { old, next } = await rotateOnce(home, await boot(home));
    rmSync(P(home).current);
    rmSync(P(home).previous);
    const r = await boot(home);
    expect([old, next]).not.toContain(r.holder.currentValue());
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'recovered' });
  });
});

describe('a retired value never returns (spec 4.2 step 3)', () => {
  it('written back after its retirement, it is never adopted: a fresh value is minted, the old one answers bad and is counted', async () => {
    const home = mkHome();
    const paths = P(home);
    const { old, state } = await rotateOnce(home, await boot(home));
    await appendRetired(paths.retired, valueDigestHex(old), Date.now());     // retirement
    rmSync(paths.previous);
    await writeState(paths.state, { ...state, previous: null });
    rmSync(paths.current);
    writeFileSync(paths.current, `# shipped by an older deploy.sh\n${old}\n`, { mode: 0o600 });   // the write-back
    const r = await boot(home);
    expect(r.holder.currentValue()).not.toBe(old);
    expect(r.holder.currentValue()).toMatch(TOKEN_VALUE_RE);
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(checkMailToken(r.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r.holder.counters().retiredByLane).toEqual({ 'POST /api/mail': 1 });
    expect(r.warnings.join('\n')).toContain('held a retired value; it was not adopted, a fresh value was minted and a rotation is owed');
    neverPrinted(r.printed, old, r.holder.currentValue() as string);
  });
});

describe('auxiliary files', () => {
  it('value files with no state file are accepted as unverifiable and a rotation is owed', async () => {
    const home = mkHome();
    const paths = P(home);
    const [cur, pend, prev] = [mintValue(), mintValue(), mintValue()];
    const id = mintGenerationId();
    writeFileSync(paths.current, `${cur}\n`);
    writeFileSync(paths.pending(id), `${pend}\n`);
    writeFileSync(paths.previous, `${prev}\n`);
    const r = await boot(home);
    for (const v of [cur, pend, prev]) expect(checkMailToken(r.holder, v)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
    expect(r.state?.pending.map((p) => p.id)).toEqual([id]);
    expect(r.warnings.join('\n')).toContain('stay accepted as unverifiable');
  });

  it('an unusable handed-out pending file empties its slot and owes a rotation; a staged one is discarded', async () => {
    const home = mkHome();
    const paths = P(home);
    const r0 = await boot(home);
    const [a, b] = [mintGenerationId(), mintGenerationId()];
    let s = stagedState(r0.state as BoxTokenState, a, Date.now(), await writeValueFileAtomic(paths.pending(a), `${mintValue()}\n`));
    s = handedOutState(s, a, Date.now());
    s = stagedState(s, b, Date.now(), await writeValueFileAtomic(paths.pending(b), `${mintValue()}\n`));
    await writeState(paths.state, s);
    truncateSync(paths.pending(a), 0);
    const r = await boot(home);
    expect(r.state?.pending).toEqual([]);
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'aux-unusable' });
    expect(existsSync(paths.pending(b))).toBe(false);
  });

  // F4 (review 349) with D-4413: a state file with more pending entries than the cap reads unusable, so boot takes the
  // unusable-state path (a warning, the usable mail.token adopted as unverifiable) and never reaches the holder's
  // RangeError, which killed the process before. Three handed-out entries (the cap with the exit's slot) boot normally.
  it('pending entries at the cap boot with every slot filled; one more than the cap is an unusable state, never a RangeError (F4)', async () => {
    const seed = async (n: number): Promise<{ home: string; values: string[] }> => {
      const home = mkHome();
      const paths = P(home);
      const r0 = await boot(home);
      let s = r0.state as BoxTokenState;
      const values: string[] = [];
      for (let i = 0; i < n; i++) {
        const id = mintGenerationId();
        const v = mintValue();
        values.push(v);
        s = handedOutState(stagedState(s, id, Date.now(), await writeValueFileAtomic(paths.pending(id), `${v}\n`)), id, Date.now());
      }
      await writeState(paths.state, s);
      return { home, values };
    };
    const ok = await seed(PENDING_HARD_CAP);
    const r = await boot(ok.home);
    expect(r.state?.pending).toHaveLength(PENDING_HARD_CAP);
    for (const v of ok.values) expect(checkMailToken(r.holder, v)).toBe('ok');
    const over = await seed(PENDING_HARD_CAP + 1);
    const r2 = await boot(over.home);                                  // resolves: no RangeError from setSlots
    expect(r2.warnings.join('\n')).toContain(`${P(over.home).state} is unusable`);
    expect(r2.state).toMatchObject({ origin: 'adopted', rotationOwed: true });
  });

  // Review Focus 1, its restart sub-case (plan assembly): the server restarts between the claim's 200 (the hand-out
  // was persisted first, D-4394) and the promotion. The handed-out value stays accepted with its own deadline, a
  // staged sibling is discarded, and a later generation read naming it confirms it.
  it('a restart after the hand-out keeps the handed-out value accepted, its deadline unchanged, and confirms it by a later generation read', async () => {
    const home = mkHome();
    const paths = P(home);
    const r0 = await boot(home);
    const [a, b] = [mintGenerationId(), mintGenerationId()];
    const va = mintValue();
    const at = Date.now() - 1000;
    let s = stagedState(r0.state as BoxTokenState, a, at, await writeValueFileAtomic(paths.pending(a), `${va}\n`));
    s = handedOutState(s, a, at);
    s = stagedState(s, b, at, await writeValueFileAtomic(paths.pending(b), `${mintValue()}\n`));
    await writeState(paths.state, s);
    const confirmBy = s.pending.find((p) => p.id === a)?.confirmBy;
    const r = await boot(home);
    expect(checkMailToken(r.holder, va)).toBe('ok');
    expect(checkMailToken(r.holder, r0.holder.currentValue() as string)).toBe('ok');   // the current value is unchanged
    expect(r.state?.pending.map((p) => [p.id, p.handedOutAt, p.confirmBy])).toEqual([[a, at, confirmBy]]);
    expect(existsSync(paths.pending(b))).toBe(false);
    expect(confirmedGeneration(r.state as BoxTokenState, { read: { kind: 'id', id: a }, measuredAt: at + 1 })).toBe(a);
    neverPrinted(r.printed, va);
  });
});

describe('the both-role boot write: recorded role only (spec 4.10)', () => {
  const both = { role: 'both', fleetMode: 'local' } as const;

  it('no CCRC_ROLE (derived both) and a planted fleet file: the file is byte-identical after boot', async () => {
    const home = mkHome();
    mkdirSync(path.join(home, '.cc-secrets'), { mode: 0o700 });
    const planted = `# the live fleet copy\n${mintValue()}\n`;
    writeFileSync(P(home).fleetFile, planted, { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'derived-absent' });
    expect(r.bothWriterArmed).toBe(false);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(planted);
    expect(existsSync(P(home).generation)).toBe(false);
  });

  it('a recorded both box whose agent.env carries CCRC_AGENT_TOKEN (a fleet box): the planted file is untouched', async () => {
    const home = mkHome();
    const agentEnv = `CCRC_SERVER_URL=ws://127.0.0.1:1\n${['CCRC', 'AGENT', 'TOKEN'].join('_')}=${mintValue()}\n`;
    writeFileSync(P(home).agentEnv, agentEnv, { mode: 0o600 });
    mkdirSync(path.join(home, '.cc-secrets'), { mode: 0o700 });
    const planted = `${mintValue()}\n`;
    writeFileSync(P(home).fleetFile, planted, { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect(r.bothWriterArmed).toBe(false);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(planted);
    expect(readFileSync(P(home).agentEnv, 'utf8')).toBe(agentEnv);
    expect(existsSync(P(home).generation)).toBe(false);
  });

  it('derived both with no fleet file warns once, naming the fleet path and the unrecorded role', async () => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource: 'derived-absent' });
    expect(existsSync(P(home).fleetFile)).toBe(false);
    expect(r.warnings).toContain(`ccrc-server: box token: this box's role is not recorded as both, so the server will not write `
      + `${P(home).fleetFile}; with no file there, notify.sh is refused (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`);
  });

  it("recorded both with the README's agent.env (CCRC_SERVER_URL only) is armed, and gets its fleet file and generation file", async () => {
    // D-4399 (plan assembly): the README's single-box block writes this file for ccrc-api.
    const home = mkHome();
    writeFileSync(P(home).agentEnv, 'CCRC_SERVER_URL=http://127.0.0.1:7788\n', { mode: 0o600 });
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect([r.bothWriterArmed, r.agentEnvMarksFleet]).toEqual([true, false]);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${r.holder.currentValue()}\n`);
    expect(readFileSync(P(home).generation, 'utf8')).toBe(`${r.state?.current.id}\n`);
  });

  it('a recorded both box with no fleet file gets one at boot: 0600, the fixed comment line, the current value', async () => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource: 'recorded' });
    expect(r.bothWriterArmed).toBe(true);
    expect(readFileSync(P(home).fleetFile, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${r.holder.currentValue()}\n`);
    expect(statSync(P(home).fleetFile).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(P(home).fleetFile)).mode & 0o777).toBe(0o700);
  });

  // Mixed versions (spec 10.1 "Notify tolerance removed"): the real notify.sh, through the loopback curl front, to
  // a server built with the boot's holder. A recorded both box is accepted; a derived one (no file) is refused.
  const tool = (n: string): string => spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
  it.each([
    ['recorded both: notify.sh is accepted', 'recorded', true],
    ['derived both: no fleet file, so notify.sh is refused', 'derived-absent', false],
  ] as const)('%s', async (_n, roleSource, accepted) => {
    const home = mkHome();
    const r = await boot(home, { ...both, roleSource });
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('notice', (n) => seen.push(n.message));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await buildServer({ ...testDeps(home), mailToken: r.holder }, bus);
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const port = (app.server.address() as AddressInfo).port;
      const bin = path.join(home, 'stub-bin');
      mkdirSync(bin);
      writeFileSync(path.join(bin, 'curl'), loopbackCurlFront(tool('curl')), { mode: 0o755 });
      writeFileSync(path.join(home, 'curl-allow-ports'), `${port}\n`);
      for (const t of ['jq', 'grep', 'tail', 'cut', 'tr', 'head', 'cat']) symlinkSync(tool(t), path.join(bin, t));
      const env: NodeJS.ProcessEnv = { HOME: home, PATH: bin, CCRC_ADDR: `http://127.0.0.1:${port}` };
      const code = await new Promise<number>((resolve) => {
        const child = spawn(tool('bash'), [path.join(repoRoot, 'deploy', 'notify.sh'), 'cc swap: x moved a -> b'], { env, stdio: 'ignore' });
        child.on('close', (c) => resolve(c ?? -1));
      });
      expect(code).toBe(0);
      expect(existsSync(path.join(home, 'curl-poison'))).toBe(false);
      expect(seen).toEqual(accepted ? ['cc swap: x moved a -> b'] : []);
      if (!accepted) expect(warn.mock.calls.flat().join(' ')).toMatch(/notify/);
    } finally { await app.close(); }
  });
});

// Added by the worker (D-4404): the arms the controller's rulings (D-4400, D-4403) and the 4.2.1 refusals need around a
// recorded promotion, a rejected post-rename fsync, and an unusable state file.
describe('boot hardening around a recorded promotion, a state-unknown write and an unusable state file (D-4404)', () => {
  /** A promotion recorded for `id` (step (a) written), the pending file in place, nothing else done. */
  async function recordPromotion(home: string, r0: BootResult, over: { alsoStaged?: boolean; alsoHandedOut?: boolean } = {}) {
    const paths = P(home);
    const id = mintGenerationId();
    const next = mintValue();
    const at = Date.now();
    let s = stagedState(r0.state as BoxTokenState, id, at, await writeValueFileAtomic(paths.pending(id), `${next}\n`));
    s = handedOutState(s, id, at);
    const later = mintGenerationId();
    const laterValue = mintValue();
    if (over.alsoStaged || over.alsoHandedOut) {
      s = stagedState(s, later, at, await writeValueFileAtomic(paths.pending(later), `${laterValue}\n`));
      if (over.alsoHandedOut) s = handedOutState(s, later, at);
    }
    s = { ...s, promoting: { id } };
    await writeState(paths.state, s);
    return { id, next, later, laterValue };
  }

  it('D-4400: a promotion finished at boot keeps a later handed-out value accepted and its pending file in place', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const { next, later, laterValue } = await recordPromotion(home, r0, { alsoHandedOut: true });
    const r = await boot(home);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(checkMailToken(r.holder, laterValue)).toBe('ok');
    expect(r.state?.pending.map((p) => p.id)).toEqual([later]);
    expect(existsSync(P(home).pending(later))).toBe(true);
    neverPrinted(r.printed, next, laterValue);
  });

  it('a promotion finished at boot discards the pending file of a staged value it drops (no orphan file)', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const { later } = await recordPromotion(home, r0, { alsoStaged: true });
    const r = await boot(home);
    expect(r.state?.pending).toEqual([]);
    expect(existsSync(P(home).pending(later))).toBe(false);
  });

  it('a promotion over a torn mail.token the server wrote finishes, and the stale previous file is not kept as previous', async () => {
    const home = mkHome();
    const first = await boot(home);
    const rot = await rotateOnce(home, first);                                // mail-previous.token holds the FIRST value
    const second = await recordPromotion(home, { ...first, state: rot.state });
    tornWrite(P(home).current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, second.next)).toBe('ok');
    expect(checkMailToken(r.holder, rot.next), 'the lost current value is not recoverable and not guessed').toBe('bad');
    expect(checkMailToken(r.holder, rot.old), 'a stale previous file is not relabelled as the previous value').toBe('bad');
    expect(r.state?.previous).toBeNull();
    expect(existsSync(P(home).previous)).toBe(false);
  });

  it('a promotion finished over a torn mail.token the server wrote is a recovery: warned, recorded from pending, a rotation owed (D-4404 item 5)', async () => {
    const home = mkHome();
    const first = await boot(home);
    const rot = await rotateOnce(home, first);
    const second = await recordPromotion(home, { ...first, state: rot.state });
    tornWrite(P(home).current);
    const r = await boot(home);
    expect(checkMailToken(r.holder, second.next)).toBe('ok');
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'recovered', promoting: null, current: { id: second.id } });
    expect(r.state?.lastBootRecovery?.source).toBe('pending');
    expect(r.warnings.join('\n')).toContain(`${P(home).current} carries no usable value, but this server wrote it (generation #${rot.state.current.seq}); `
      + `recovered from ${P(home).pending(second.id)}, also written by this server. A forward rotation is owed now; `
      + `the fleet box's calls may answer 401 until it confirms one.`);
    neverPrinted(r.printed, second.next, rot.next, rot.old);
  });

  it('a promotion finished over an intact old mail.token is not a recovery: nothing owed, nothing recorded', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    await recordPromotion(home, r0);
    const r = await boot(home);
    expect(r.state).toMatchObject({ rotationOwed: false, owedWhy: null, lastBootRecovery: null });
    expect(r.warnings.join('\n')).not.toContain('carries no usable value');
  });

  it('a recorded promotion over a placeholder mail.token still refuses boot, and renames nothing', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const { id } = await recordPromotion(home, r0);
    writeFileSync(P(home).current, `${PLACEHOLDER_TOKEN}\n`);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(MailTokenPlaceholderUnedited);
    expect(existsSync(P(home).pending(id))).toBe(true);
    expect(readFileSync(P(home).current, 'utf8')).toBe(`${PLACEHOLDER_TOKEN}\n`);
  });

  it('a recorded promotion over a hand-made unusable mail.token (a new inode) still refuses boot, and renames nothing', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const { id } = await recordPromotion(home, r0);
    // Created beside the old file and renamed over it: a guaranteed different inode (a remove-then-create can reuse one).
    writeFileSync(`${P(home).current}.hand`, '# nothing here\n');
    renameSync(`${P(home).current}.hand`, P(home).current);
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(MailTokenFileUnusable);
    expect(existsSync(P(home).pending(id))).toBe(true);
  });

  it('a mint whose directory fsync rejects after the rename boots with the value that is in place, recorded', async () => {
    const home = mkHome();
    const real = fsp.open.bind(fsp);
    let rejected = 0;
    vi.spyOn(fsp, 'open').mockImplementation(((p: string, flags?: unknown, ...rest: unknown[]) => {
      if (flags === 'r' && rejected === 0) { rejected++; return Promise.reject(Object.assign(new Error('fsync'), { code: 'EIO' })); }
      return (real as (...a: unknown[]) => Promise<unknown>)(p, flags, ...rest);
    }) as typeof fsp.open);
    const r = await boot(home);
    expect(rejected).toBe(1);
    const v = readFileSync(P(home).current, 'utf8').trim();
    expect(r.mintFailed).toBe(false);
    expect(r.holder.currentValue()).toBe(v);
    const st = statSync(P(home).current);
    expect(r.state?.current.write).toMatchObject({ dev: st.dev, ino: st.ino });
    expect(r.warnings.join('\n')).toMatch(/could not confirm .*(EIO)/);
    neverPrinted(r.printed, v);
  });

  it('a malformed box-token.json beside a hand-made unusable mail.token refuses boot and the state file is not overwritten', async () => {
    const home = mkHome();
    await boot(home);
    writeFileSync(P(home).state, '{"v":1,"not":"a state"}\n');
    writeFileSync(P(home).current, '# nothing here\n');
    const before = readFileSync(P(home).state, 'utf8');
    await expect(bootBoxToken(input(home))).rejects.toBeInstanceOf(MailTokenFileUnusable);
    expect(readFileSync(P(home).state, 'utf8')).toBe(before);
  });

  it('a malformed box-token.json beside a usable mail.token: warned, the value adopted as unverifiable, the state rewritten', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const v = r0.holder.currentValue() as string;
    writeFileSync(P(home).state, '{"v":1,"not":"a state"}\n');
    const r = await boot(home);
    expect(checkMailToken(r.holder, v)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
    expect(r.warnings.join('\n')).toContain(`${P(home).state} is unusable`);
    expect((await readState(P(home).state)).kind).toBe('state');
  });
});
