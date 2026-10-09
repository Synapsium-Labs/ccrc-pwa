// The box token at boot (server/src/token/boot.ts, spec 4.2, 4.2.1, 4.10; D-4388):
// the mint, the hand-made refusals kept exactly, recovery for server-written
// files only, a retired value never coming back, the auxiliary files, and the
// both-role boot write on a RECORDED both box only. Fixture homes only; every
// value here is random per run and is searched for in everything boot printed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
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

// D-4410 (review 349 F1 and sec-M2): a retired value's record is never lost, and an unusable retired file never lets a
// foreign value in. Fixture homes only; every value is random per run.
describe('an unusable retired file never lets boot adopt a value it did not write (D-4410)', () => {
  const asides = (home: string): string[] => readdirSync(path.join(home, '.ccrc')).filter((n) => n.startsWith('box-token-retired.json.unusable-'));
  /** One rotation done, the previous value retired and its record landed, then the retired file left unusable (v 2). */
  async function retiredThenCorrupt(home: string): Promise<{ old: string; next: string; state: BoxTokenState }> {
    const paths = P(home);
    const { old, next, state } = await rotateOnce(home, await boot(home));
    await appendRetired(paths.retired, valueDigestHex(old), Date.now());
    rmSync(paths.previous);
    const settled = { ...state, previous: null };
    await writeState(paths.state, settled);
    writeFileSync(paths.retired, '{"v":2,"retired":[]}\n', { mode: 0o600 });
    return { old, next, state: settled };
  }
  const writeBack = (home: string, value: string): void => {
    rmSync(P(home).current);
    writeFileSync(P(home).current, `# an older deploy.sh shipped this\n${value}\n`, { mode: 0o600 });
  };

  it("F1's sequence: unusable retired file, L written back, restart: L is refused, a fresh value is minted and a rotation is owed", async () => {
    const home = mkHome();
    const { old } = await retiredThenCorrupt(home);
    writeBack(home, old);
    const r = await boot(home);
    expect(checkMailToken(r.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r.holder.currentValue()).not.toBe(old);
    expect(r.holder.currentValue()).toMatch(TOKEN_VALUE_RE);
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(readFileSync(P(home).current, 'utf8').trim()).toBe(r.holder.currentValue());
    neverPrinted(r.printed, old, r.holder.currentValue() as string);
  });

  it('a mail.token the server did not write is not adopted either: no state at all, a hand-made value, an unusable retired file', async () => {
    const home = mkHome();
    const hand = mintValue();
    writeFileSync(P(home).current, `${hand}\n`, { mode: 0o600 });
    writeFileSync(P(home).retired, 'not json at all', { mode: 0o600 });
    const r = await boot(home);
    expect(checkMailToken(r.holder, hand)).toBe('bad');
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    neverPrinted(r.printed, hand);
  });

  it('after a rotation a foreign value in mail.token (not a retired one) is not adopted while the list is unusable', async () => {
    const home = mkHome();
    await retiredThenCorrupt(home);
    const foreign = mintValue();
    writeBack(home, foreign);
    const r = await boot(home);
    expect(checkMailToken(r.holder, foreign)).toBe('bad');
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true });
  });

  it('a server-written current stays current: no mint, nothing owed, the value unchanged', async () => {
    const home = mkHome();
    const { next } = await retiredThenCorrupt(home);
    const r = await boot(home);
    expect(r.holder.currentValue()).toBe(next);
    expect(checkMailToken(r.holder, next)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'rotated', rotationOwed: false });
    expect(readFileSync(P(home).current, 'utf8').trim()).toBe(next);
  });

  it('the unusable file is moved aside under a new name, byte-equal, and warned about once; a fresh list starts', async () => {
    const home = mkHome();
    const { old } = await retiredThenCorrupt(home);
    writeBack(home, old);
    const r = await boot(home, { now: 777 });
    expect(asides(home)).toEqual(['box-token-retired.json.unusable-777']);
    expect(readFileSync(path.join(home, '.ccrc', asides(home)[0]), 'utf8')).toBe('{"v":2,"retired":[]}\n');
    expect(existsSync(P(home).retired)).toBe(false);
    expect(r.warnings.filter((w) => w.includes('box-token-retired.json'))).toHaveLength(1);
    expect(r.warnings.join('\n')).toContain('unusable');
  });

  it('with the current server-written the warning is still one line and the file is still set aside', async () => {
    const home = mkHome();
    await retiredThenCorrupt(home);
    const r = await boot(home, { now: 778 });
    expect(asides(home)).toEqual(['box-token-retired.json.unusable-778']);
    expect(r.warnings.filter((w) => w.includes('box-token-retired.json'))).toHaveLength(1);
  });

  it('the set-aside never overwrites a file already holding the name', async () => {
    const home = mkHome();
    await retiredThenCorrupt(home);
    const taken = `${P(home).retired}.unusable-779`;
    writeFileSync(taken, 'an earlier set-aside', { mode: 0o600 });
    await boot(home, { now: 779 });
    expect(readFileSync(taken, 'utf8')).toBe('an earlier set-aside');
    expect(asides(home).sort()).toEqual(['box-token-retired.json.unusable-779', 'box-token-retired.json.unusable-779-1']);
  });

  // Review of batch 2 (D-4410, Important): the digests that had landed in the set-aside file are forgotten, so on boot 2
  // and after a written-back earlier-retired value would be adopted. While ANY set-aside retired file stands, boot keeps
  // the unusable posture: a mail.token it cannot match to its own write record is never adopted.
  it('boot 2 and after: while a set-aside retired file stands, a written-back earlier-retired value is still not adopted', async () => {
    const home = mkHome();
    const { old, next } = await retiredThenCorrupt(home);
    const r1 = await boot(home, { now: 880 });                                // boot 1: sets it aside, the server-written current stays
    expect(r1.holder.currentValue()).toBe(next);
    expect(asides(home)).toEqual(['box-token-retired.json.unusable-880']);
    expect(existsSync(P(home).retired)).toBe(false);
    writeBack(home, old);
    const r2 = await boot(home, { now: 881 });                                // boot 2: the retired file is merely absent now
    expect(checkMailToken(r2.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r2.holder.currentValue()).not.toBe(old);
    expect(r2.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(asides(home)).toEqual(['box-token-retired.json.unusable-880']);   // still there, untouched, not read into the list
    const w = r2.warnings.filter((x) => x.includes('box-token-retired.json.unusable-880'));
    expect(w).toHaveLength(1);                                                // warned once, naming the set-aside file
    expect(w[0]).toContain('removing');
    neverPrinted(r2.printed, old, r2.holder.currentValue() as string);
  });

  it('while a set-aside file stands, a server-written current stays current and boot says nothing new', async () => {
    const home = mkHome();
    const { next } = await retiredThenCorrupt(home);
    await boot(home, { now: 882 });
    const r = await boot(home, { now: 883 });
    expect(r.holder.currentValue()).toBe(next);
    expect(r.state).toMatchObject({ origin: 'rotated', rotationOwed: false });
    expect(r.warnings.filter((x) => x.includes('unusable-882'))).toHaveLength(0);
  });

  it('with the set-aside file removed, a genuinely hand-made value is adopted as before', async () => {
    const home = mkHome();
    await retiredThenCorrupt(home);
    await boot(home, { now: 884 });
    rmSync(path.join(home, '.ccrc', 'box-token-retired.json.unusable-884'));
    const hand = mintValue();
    writeBack(home, hand);
    const r = await boot(home, { now: 885 });
    expect(checkMailToken(r.holder, hand)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
  });

  // Listing a directory needs READ permission; opening a file inside needs only search. A -wx ~/.ccrc lists nothing yet boot
  // can read everything else, so a failed listing must refuse (D-4403 item 2), never mean "no set-aside file".
  it.skipIf(isRoot)('a set-aside listing that fails (mode 0300 directory, EACCES) refuses boot, naming the path and errno, writing nothing', async () => {
    const home = mkHome();
    const v = mintValue();
    writeFileSync(P(home).current, `${v}\n`, { mode: 0o600 });
    const dir = path.join(home, '.ccrc');
    chmodSync(dir, 0o300);
    try {
      const err = await bootBoxToken(input(home)).then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toBe(`${dir}: unreadable (EACCES); boot refuses rather than rewrite it`);
      expect(err?.message).not.toContain(v);
    } finally { chmodSync(dir, 0o700); }
    expect(existsSync(P(home).state)).toBe(false);                            // nothing was written
    expect(readFileSync(P(home).current, 'utf8')).toBe(`${v}\n`);
  });

  it('a missing directory (ENOENT) still means no set-aside file', async () => {
    const home = mkHome();
    rmSync(path.join(home, '.ccrc'), { recursive: true });
    const r = await bootBoxToken(input(home));                                // no listing refusal: it boots, and only the mint fails
    expect(r.mintFailed).toBe(true);
  });

  it("the set-aside file's content is never read: an unreadable one (mode 000) is only counted by its name", async () => {
    if (isRoot) return;
    const home = mkHome();
    const { old } = await retiredThenCorrupt(home);
    await boot(home, { now: 886 });
    const aside = path.join(home, '.ccrc', 'box-token-retired.json.unusable-886');
    chmodSync(aside, 0o000);
    try {
      writeBack(home, old);
      const r = await boot(home, { now: 887 });
      expect(checkMailToken(r.holder, old)).toBe('bad');
    } finally { chmodSync(aside, 0o600); }
  });

  it('a retired file that cannot be READ is unreadable, never unusable: boot refuses, moves nothing aside, writes nothing (EISDIR)', async () => {
    const home = mkHome();
    const v = mintValue();
    writeFileSync(P(home).current, `${v}\n`, { mode: 0o600 });
    mkdirSync(P(home).retired);
    await expect(bootBoxToken(input(home))).rejects.toThrow('unreadable (EISDIR)');
    expect(asides(home)).toEqual([]);
    expect(statSync(P(home).retired).isDirectory()).toBe(true);
  });

  it.skipIf(isRoot)('EACCES on the retired file refuses boot the same way, and the file is not moved aside', async () => {
    const home = mkHome();
    const { old } = await retiredThenCorrupt(home);
    writeBack(home, old);
    chmodSync(P(home).retired, 0o000);
    try {
      const err = await bootBoxToken(input(home)).then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toBe(`${P(home).retired}: unreadable (EACCES); boot refuses rather than rewrite it`);
    } finally { chmodSync(P(home).retired, 0o600); }
    expect(asides(home)).toEqual([]);
    expect(readFileSync(P(home).current, 'utf8')).toContain(old);          // nothing was written over mail.token
  });

  it("sec-M2's boot half: a digest still in box-token.json's retiring record refuses the value though the retired file lacks it", async () => {
    const home = mkHome();
    const paths = P(home);
    const { old, state } = await rotateOnce(home, await boot(home));
    rmSync(paths.previous);
    await writeState(paths.state, { ...state, previous: null, retiring: [{ sha256: valueDigestHex(old), at: Date.now() }] });
    writeBack(home, old);
    const r = await boot(home);
    expect(existsSync(paths.retired)).toBe(false);                            // the append never landed
    expect(checkMailToken(r.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r.holder.counters().retiredByLane).toEqual({ 'POST /api/mail': 1 });
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(r.state?.retiring).toEqual([{ sha256: valueDigestHex(old), at: expect.any(Number) }]);   // still carried until it lands
    neverPrinted(r.printed, old);
  });

  it('control: with no retiring record and no retired file the same write-back is adopted as a hand-made value (today\'s rule)', async () => {
    const home = mkHome();
    const paths = P(home);
    const { old, state } = await rotateOnce(home, await boot(home));
    rmSync(paths.previous);
    await writeState(paths.state, { ...state, previous: null });
    writeBack(home, old);
    const r = await boot(home);
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
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

  // F4 (review 349) with D-4413: a state file with more pending entries than the cap reads unusable (why: over-cap) and
  // boot REFUSES it, naming the path and the word, never with the holder's RangeError and never writing over the file.
  // Three handed-out entries (the cap with the exit's slot) boot normally.
  it('pending entries at the cap boot with every slot filled; one more than the cap refuses boot cleanly, never a RangeError (F4)', async () => {
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
    const before = readFileSync(P(over.home).state);
    const err = await bootBoxToken(input(over.home)).then(() => null, (e: unknown) => e);   // refuses: no RangeError from setSlots
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RangeError);
    expect((err as Error).message).toContain(P(over.home).state);
    expect((err as Error).message).toContain('over-cap');
    for (const v of over.values) expect((err as Error).message.includes(v)).toBe(false);
    expect(readFileSync(P(over.home).state).equals(before), 'nothing is written over the file').toBe(true);
  });

  // D-4413 boot clause: three unverifiable pending files are normal now (the exit's value is the third), so none is dropped.
  it('value files with no state record: up to the cap of three pending files stay accepted, a fourth is not read', async () => {
    const home = mkHome();
    await boot(home);
    rmSync(P(home).state);
    const ids = ['a', 'b', 'c', 'd'].map((c) => c.repeat(16));
    const vals = ids.map(() => mintValue());
    for (let i = 0; i < ids.length; i++) await writeValueFileAtomic(P(home).pending(ids[i]), `${vals[i]}\n`);
    const r = await boot(home);
    expect(r.state?.pending.map((p) => p.id)).toEqual(ids.slice(0, PENDING_HARD_CAP));
    for (const v of vals.slice(0, PENDING_HARD_CAP)) expect(checkMailToken(r.holder, v)).toBe('ok');
    expect(checkMailToken(r.holder, vals[PENDING_HARD_CAP])).toBe('bad');
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
      + `${P(home).fleetFile}; with no file there, notify.sh sends nothing (record CCRC_ROLE=both in ~/.ccrc/ccrc.env)`);
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
  // a server built with the boot's holder. A recorded both box is accepted; on a derived one (no fleet file)
  // notify.sh finds no token and sends nothing (D-4393), so no request reaches the server at all.
  const tool = (n: string): string => spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
  it.each([
    ['recorded both: notify.sh is accepted', 'recorded', true],
    ['derived both: no fleet file, so notify.sh sends nothing', 'derived-absent', false],
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
      // D-4393: with no fleet file notify.sh sends NOTHING, so no request reaches the server: it logs no refused
      // notify (every refusal there warns), and the loopback front recorded no refusal either (checked above).
      if (!accepted) expect(warn.mock.calls.flat().join(' ')).not.toMatch(/notify/);
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

  it('a malformed box-token.json beside a usable mail.token: warned, set aside, the value NOT adopted (D-4414, F1), the state rewritten', async () => {
    const home = mkHome();
    const r0 = await boot(home);
    const v = r0.holder.currentValue() as string;
    writeFileSync(P(home).state, '{"v":1,"not":"a state"}\n');
    const r = await boot(home, { now: 4242 });
    expect(checkMailToken(r.holder, v)).toBe('bad');                          // boot cannot match it to its own write record
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(r.warnings.join('\n')).toContain(`${P(home).state} is unusable`);
    expect((await readState(P(home).state)).kind).toBe('state');
    expect(readFileSync(`${P(home).state}.unusable-4242`, 'utf8')).toBe('{"v":1,"not":"a state"}\n');
    neverPrinted(r.printed, v);
  });
});

// D-4414 (review 352 F1): an unusable box-token.json takes D-4410's foreign posture, as an unusable retired file does. The
// `retiring` record, the only durable home of a digest whose append had not landed, lived in it.
describe('an unusable box-token.json never lets boot adopt a value it did not write (D-4414, F1)', () => {
  const stateAsides = (home: string): string[] => readdirSync(path.join(home, '.ccrc')).filter((n) => n.startsWith('box-token.json.unusable-'));
  const writeBack = (home: string, value: string): void => {
    rmSync(P(home).current);
    writeFileSync(P(home).current, `# an older deploy.sh shipped this\n${value}\n`, { mode: 0o600 });
  };
  /** F1's sequence up to the damage: L retired with its append failed (so its digest is only in `retiring`), then the
   *  state damaged in the way the variant says, then L written back. The retired file does not exist. */
  async function failedAppendThenDamage(home: string, damage: (s: BoxTokenState) => string): Promise<{ old: string; next: string; raw: string }> {
    const paths = P(home);
    const { old, next, state } = await rotateOnce(home, await boot(home));
    rmSync(paths.previous);
    const settled: BoxTokenState = { ...state, previous: null, retiring: [{ sha256: valueDigestHex(old), at: Date.now() }] };
    const raw = damage(settled);
    writeFileSync(paths.state, raw, { mode: 0o600 });
    expect(existsSync(paths.retired)).toBe(false);
    writeBack(home, old);
    return { old, next, raw };
  }
  const variants: [string, (s: BoxTokenState) => string][] = [
    ['a version this build does not read (v:2)', (s) => `${JSON.stringify({ ...s, v: 2 })}\n`],
    ['one malformed retiring entry', (s) => `${JSON.stringify({ ...s, retiring: [...(s.retiring ?? []), { sha256: 'not-hex', at: 1 }] })}\n`],
  ];

  it.each(variants)("F1's sequence, %s: a failed append, then an unusable state file, L written back, a restart: L is refused", async (_n, damage) => {
    const home = mkHome();
    const { old, raw } = await failedAppendThenDamage(home, damage);
    const r = await boot(home, { now: 9001 });
    expect(checkMailToken(r.holder, old, 'POST /api/mail')).toBe('bad');
    expect(r.holder.currentValue()).not.toBe(old);
    expect(r.holder.currentValue()).toMatch(TOKEN_VALUE_RE);
    expect(readFileSync(P(home).current, 'utf8').trim()).toBe(r.holder.currentValue());
    expect(r.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    // set aside under a new name, byte-equal; a fresh record stands in its place
    expect(stateAsides(home)).toEqual(['box-token.json.unusable-9001']);
    expect(readFileSync(path.join(home, '.ccrc', 'box-token.json.unusable-9001'), 'utf8')).toBe(raw);
    expect((await readState(P(home).state)).kind).toBe('state');
    expect(r.warnings.filter((w) => w.includes(P(home).state))).toHaveLength(1);
    neverPrinted(r.printed, old, r.holder.currentValue() as string);
  });

  it('boot 2 and after: while the set-aside state file stands, a written-back value is still not adopted', async () => {
    const home = mkHome();
    const { old } = await failedAppendThenDamage(home, (s) => `${JSON.stringify({ ...s, v: 2 })}\n`);
    const r1 = await boot(home, { now: 9002 });                               // the aside holds the only record of L's digest
    expect(stateAsides(home)).toEqual(['box-token.json.unusable-9002']);
    writeBack(home, old);
    const r2 = await boot(home, { now: 9003 });                               // the state is readable now; L is not in the retired file
    expect(r2.holder.currentValue()).not.toBe(old);
    expect(checkMailToken(r2.holder, old)).toBe('bad');
    expect(r2.state).toMatchObject({ origin: 'minted', rotationOwed: true, owedWhy: 'retired-written-back' });
    expect(stateAsides(home)).toEqual(['box-token.json.unusable-9002']);       // untouched, never read back
    const w = r2.warnings.filter((x) => x.includes('unusable-9002'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('removing');
    // a server-written current stays current under the same posture
    const r3 = await boot(home, { now: 9004 });
    expect(r3.holder.currentValue()).toBe(r2.holder.currentValue());
    expect(r3.state).toMatchObject({ rotationOwed: true });
    neverPrinted(r1.printed + r2.printed, old);
  });

  it('with the set-aside state file removed after review, a genuinely hand-made value is adopted as before', async () => {
    const home = mkHome();
    await failedAppendThenDamage(home, (s) => `${JSON.stringify({ ...s, v: 2 })}\n`);
    await boot(home, { now: 9005 });
    rmSync(path.join(home, '.ccrc', 'box-token.json.unusable-9005'));
    const hand = mintValue();
    writeBack(home, hand);
    const r = await boot(home, { now: 9006 });
    expect(checkMailToken(r.holder, hand)).toBe('ok');
    expect(r.state).toMatchObject({ origin: 'adopted', rotationOwed: true, owedWhy: 'adopted' });
  });

  it('the set-aside never overwrites a file already holding the name', async () => {
    const home = mkHome();
    await failedAppendThenDamage(home, (s) => `${JSON.stringify({ ...s, v: 2 })}\n`);
    const taken = `${P(home).state}.unusable-9007`;
    writeFileSync(taken, 'an earlier set-aside', { mode: 0o600 });
    await boot(home, { now: 9007 });
    expect(readFileSync(taken, 'utf8')).toBe('an earlier set-aside');
    expect(stateAsides(home).sort()).toEqual(['box-token.json.unusable-9007', 'box-token.json.unusable-9007-1']);
  });

  it('a state file that cannot be READ is still unreadable, never unusable: boot refuses and sets nothing aside (D-4403 item 2)', async () => {
    const home = mkHome();
    const v = mintValue();
    writeFileSync(P(home).current, `${v}\n`, { mode: 0o600 });
    mkdirSync(P(home).state);
    await expect(bootBoxToken(input(home))).rejects.toThrow('unreadable (EISDIR)');
    expect(stateAsides(home)).toEqual([]);
  });

  it.skipIf(isRoot)('a state file that cannot be moved aside refuses boot, naming the path and errno, and leaves it byte-identical', async () => {
    const home = mkHome();
    await boot(home);
    const raw = '{"v":2}\n';
    writeFileSync(P(home).state, raw);
    const dir = path.join(home, '.ccrc');
    chmodSync(dir, 0o500);                                                     // listing works; the hard link (and every write) is refused
    try {
      const err = await bootBoxToken(input(home)).then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toBe(`${P(home).state}: unusable, and it could not be set aside (EACCES); boot refuses rather than overwrite it`);
    } finally { chmodSync(dir, 0o700); }
    expect(readFileSync(P(home).state, 'utf8')).toBe(raw);
  });
});

// D-4414 (review 352 F6): a failed mint keeps the rotation it owes.
describe('a failed mint carries its owed rotation to the driver (D-4414, F6)', () => {
  it.skipIf(isRoot)('a foreign value under an unusable retired file and a mint that fails: BootResult names retired-written-back', async () => {
    const home = mkHome();
    const hand = mintValue();
    writeFileSync(P(home).current, `${hand}\n`, { mode: 0o600 });
    writeFileSync(P(home).retired, 'not json at all', { mode: 0o600 });
    chmodSync(path.join(home, '.ccrc'), 0o500);
    try {
      const r = await boot(home);
      expect(r.mintFailed).toBe(true);
      expect(r.mintOwed).toBe('retired-written-back');
      expect(r.state).toBeNull();
      neverPrinted(r.printed, hand);
    } finally { chmodSync(path.join(home, '.ccrc'), 0o700); }
  });

  it.skipIf(isRoot)('a first mint that fails owes nothing, and a mint that works carries no owed word', async () => {
    const home = mkHome();
    chmodSync(path.join(home, '.ccrc'), 0o500);
    try {
      const r = await boot(home);
      expect(r.mintFailed).toBe(true);
      expect(r.mintOwed).toBeNull();
    } finally { chmodSync(path.join(home, '.ccrc'), 0o700); }
    expect((await boot(mkHome())).mintOwed).toBeNull();
  });
});

// D-4414 (review 352 F3, boot half): the auxiliary arm never drops the record of a previous file it could not read.
describe('boot keeps the record of a previous file it cannot read (D-4414, F3)', () => {
  it.skipIf(isRoot)('an unreadable mail-previous.token: the record and the file stay, the slot is empty, a rotation is owed, one warning', async () => {
    const home = mkHome();
    const paths = P(home);
    const { old } = await rotateOnce(home, await boot(home));
    chmodSync(paths.previous, 0o000);
    try {
      const r = await boot(home);
      expect(r.state?.previous, 'the record is kept').not.toBeNull();
      expect(existsSync(paths.previous)).toBe(true);
      expect(checkMailToken(r.holder, old)).toBe('bad');                       // the accept set holds nothing it cannot read
      expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'aux-unusable' });
      expect(r.warnings.filter((w) => w.includes('cannot be read (EACCES)'))).toHaveLength(1);
      neverPrinted(r.printed, old);
    } finally { chmodSync(paths.previous, 0o600); }
  });

  it('an UNUSABLE previous file (read, but no value) still empties its slot and drops the record, as before', async () => {
    const home = mkHome();
    const paths = P(home);
    await rotateOnce(home, await boot(home));
    writeFileSync(paths.previous, '# no value here\n', { mode: 0o600 });
    const r = await boot(home);
    expect(r.state?.previous).toBeNull();
    expect(r.state).toMatchObject({ rotationOwed: true, owedWhy: 'aux-unusable' });
  });
});
