// `ws-collect`'s loose arm (fleet disk retention spec 2026-10-23 §2.4, D-6625): an entry directly under `~/.cc-tmp` that no
// witness and no registry row names. The census classes it, `ws-audit --loose-hex <hex> --collect` mints a token that
// binds the entry's own identity, and `ws-collect --expect <token> --loose-hex <hex>` quarantines, re-proves and removes
// it. Every case builds its entries in a FIXTURE HOME and runs the SOURCED functions; nothing here touches a live HOME.
// Time is a seam, never a sleep: `_ws_collect_now_ns` is redefined to an instant measured off the tree's own ctime, so
// "49 hours quiet" is exact.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { GAP_LOG, WRONG_TOKEN, crashAt, docOf, gapAt, gaps, holderAt, inoAt, killHolder, type Run } from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => {
  h = makePrHarness('ccrc-ws-collect-loose-');
  // The witness directory a live registry always holds: the slug-free check's listing control finds it (D-6625).
  fs.mkdirSync(path.join(h.home, '.cc-sessions', 'tmproots'), { recursive: true });
});
afterEach(() => { killHolder(h); h.cleanup(); });

const LINUX = process.platform === 'linux';
const HOUR_NS = 3_600_000_000_000n;
const FLOOR_H = 48;
const hexOf = (name: string): string => Buffer.from(name, 'utf8').toString('hex');
const unhex = (hex: string): string => Buffer.from(hex, 'hex').toString('utf8');
const ccTmp = (): string => path.join(h.home, '.cc-tmp');
const at = (name: string): string => path.join(ccTmp(), name);
const regDir = (): string => path.join(h.home, '.cc-sessions');
const quarantine = (): string => path.join(fs.realpathSync(ccTmp()), '.ccd-quarantine');
const slots = (): string[] => (fs.existsSync(quarantine()) ? fs.readdirSync(quarantine()).sort() : []);
const looseRecs = (): string[] => {
  const d = path.join(regDir(), 'tmpquarantine-loose');
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
};

/** A loose directory with scratch two levels down. */
function mkLoose(name: string, kind: 'dir' | 'file' = 'dir'): string {
  const p = at(name);
  fs.mkdirSync(ccTmp(), { recursive: true });
  if (kind === 'file') { fs.writeFileSync(p, 'scratch\n'); return p; }
  fs.mkdirSync(path.join(p, 'out', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(p, 'out', 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(p, 'b.txt'), 'b\n');
  return p;
}
/** The newest ctime under `p`, in epoch ns (the walk's own measure). */
function newestNs(p: string): bigint {
  let best = fs.lstatSync(p, { bigint: true }).ctimeNs;
  if (fs.lstatSync(p).isDirectory()) {
    for (const n of fs.readdirSync(p)) { const v = newestNs(path.join(p, n)); if (v > best) best = v; }
  }
  return best;
}
/** The clock, `hours` after the newest change under `p`. */
const clockAfter = (p: string, hours: number, extraNs = 0n): string =>
  `_ws_collect_now_ns() { echo ${newestNs(p) + BigInt(Math.round(hours * 3600)) * 1_000_000_000n + extraNs}; };`;

// The box's own disk must never decide a case: pressure is OFF unless a case turns it on, after this line.
const NO_PRESSURE = '_disk_pressure() { return 1; };';
const audit = (name: string, pre = ''): Run => h.run(`${NO_PRESSURE} ${pre} cmd_ws_audit --loose-hex ${hexOf(name)} --collect`);
const docFor = (r: Run): Record<string, any> => JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Record<string, any>;
const tokenOf = (name: string, pre = ''): string => {
  const r = audit(name, pre);
  const d = docFor(r);
  if (d['verdict'] !== 'collectable') throw new Error(`no token: ${r.stdout}${r.stderr}`);
  return d['token'] as string;
};
const verb = (name: string, token: string, pre = ''): Run => h.run(`${NO_PRESSURE} ${pre} cmd_ws_collect --expect ${token} --loose-hex ${hexOf(name)}`);
const census = (pre = ''): Record<string, any> => {
  const r = h.run(`${pre} cmd_ws_audit --collect-census`);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return docFor(r);
};
const classOf = (c: Record<string, any>, name: string): string | undefined =>
  (c['entries'] as { hex: string; class: string }[]).find((e) => e.hex === hexOf(name))?.class;
const verdictOf = (name: string, pre = ''): string => docFor(audit(name, pre))['verdict'] as string;

describe.skipIf(!LINUX)('characterization: today an unwitnessed leaf is not the witnessed arm’s (green before the loose arm)', () => {
  it('the audit and the verb both answer not-witnessed for a name no witness stands for', () => {
    mkLoose('stray-dir');
    const a = h.run('cmd_ws_audit --session stray-dir --collect');
    expect(docFor(a)['verdict'], a.stdout + a.stderr).toBe('not-witnessed');
    const v = h.run(`cmd_ws_collect --expect ${WRONG_TOKEN} --session stray-dir`);
    expect(docOf(v.stdout)['refused'], v.stdout + v.stderr).toBe('not-witnessed');
    expect(fs.existsSync(at('stray-dir')), 'nothing was touched').toBe(true);
  }, 60_000);
});

describe.skipIf(!LINUX)('the census', () => {
  it('classes each top-level entry in the order of spec §2.4', () => {
    mkLoose('plain-dir'); mkLoose('plain-file', 'file');
    mkLoose('demo-quiet-reef');
    h.sh(`_ws_tmproot_witness_write demo-quiet-reef '${at('demo-quiet-reef')}' 7`);
    mkLoose('demo-calm-mesa');
    fs.writeFileSync(path.join(regDir(), 'demo-calm-mesa.child'), '1');
    fs.mkdirSync(at('.ccd-quarantine'));
    fs.symlinkSync(at('plain-dir'), at('a-link'));
    execFileSync('mkfifo', [at('a-fifo')]);
    const c = census();
    expect(classOf(c, 'plain-dir')).toBe('loose');
    expect(classOf(c, 'plain-file')).toBe('loose');
    expect(classOf(c, 'demo-quiet-reef')).toBe('witnessed');
    expect(classOf(c, 'demo-calm-mesa')).toBe('registered');
    expect(classOf(c, '.ccd-quarantine')).toBe('quarantine');
    expect(classOf(c, 'a-link'), 'a symbolic link is the operator’s').toBe('refused');
    expect(classOf(c, 'a-fifo'), 'a FIFO is the operator’s').toBe('refused');
    expect(c['truncated']).toBe(false);
  }, 60_000);

  it('a 47 h-old file and a 49 h-old directory are both loose: age is the audit’s, not the census’', () => {
    const f = mkLoose('old-file', 'file'); const d = mkLoose('old-dir');
    const t47 = new Date(Date.now() - 47 * 3600e3); const t49 = new Date(Date.now() - 49 * 3600e3);
    fs.utimesSync(f, t47, t47); fs.utimesSync(d, t49, t49);
    const c = census();
    expect([classOf(c, 'old-file'), classOf(c, 'old-dir')]).toEqual(['loose', 'loose']);
  }, 60_000);

  it('names -rf, .hidden and one with a space survive hex both ways', () => {
    const names = ['-rf', '.hidden', 'with space', 'café'];
    for (const n of names) mkLoose(n, 'file');
    const c = census();
    for (const n of names) {
      expect(classOf(c, n), n).toBe('loose');
      expect(unhex(hexOf(n))).toBe(n);
    }
    for (const e of c['entries'] as { hex: string }[]) expect(e.hex).toMatch(/^([0-9a-f]{2})+$/);
  }, 60_000);

  it('is bounded: past COLLECT-POPULATION-MAX it is truncated, and the bound is 1,024', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain('WS_LOOSE_CENSUS_MAX=1024');
    for (const n of ['e1', 'e2', 'e3', 'e4', 'e5']) mkLoose(n, 'file');
    const c = census('WS_LOOSE_CENSUS_MAX=3;');
    expect(c['truncated']).toBe(true);
    expect((c['entries'] as unknown[]).length).toBe(3);
  }, 60_000);

  it('is read-only: it creates nothing under HOME', () => {
    mkLoose('plain-dir');
    const before = h.sh(`find "$HOME" -mindepth 1 | LC_ALL=C sort | grep -v 'lifecycle' | tr '\\n' '|'`);
    census();
    expect(h.sh(`find "$HOME" -mindepth 1 | LC_ALL=C sort | grep -v 'lifecycle' | tr '\\n' '|'`)).toBe(before);
  }, 60_000);
});

describe.skipIf(!LINUX)('the audit: ws-audit --loose-hex <hex> --collect', () => {
  it('a 49 h-quiet unheld loose directory mints a token; its document names the identity it binds', () => {
    const p = mkLoose('stray-dir');
    const r = audit('stray-dir', clockAfter(p, 49));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const d = docFor(r);
    expect(d['verdict']).toBe('collectable');
    expect(d['token']).toMatch(/^[0-9a-f]{64}$/);
    expect(d['name']).toBe(hexOf('stray-dir'));
    expect(d['collect']).toMatchObject({ class: 'loose', type: 'd', floorS: FLOOR_H * 3600, pressure: false, entries: 5 });
  }, 60_000);

  it('a 49 h-quiet regular file mints a token too, of type f', () => {
    const p = mkLoose('stray-file', 'file');
    const d = docFor(audit('stray-file', clockAfter(p, 49)));
    expect(d['verdict']).toBe('collectable');
    expect(d['collect']).toMatchObject({ type: 'f', entries: 1 });
  }, 60_000);

  it('47 h answers changed-recently, with the instant it is collectable from', () => {
    const p = mkLoose('stray-dir');
    const d = docFor(audit('stray-dir', clockAfter(p, 47)));
    expect(d['verdict']).toBe('changed-recently');
    expect((d['collect'] as Record<string, unknown>)['idleAt']).toBeGreaterThan(0);
  }, 60_000);

  it('a new file deep inside resets it', () => {
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, FLOOR_H);   // the tree is exactly 48 h old: just licensed
    expect(verdictOf('stray-dir', clock)).toBe('collectable');
    fs.writeFileSync(path.join(p, 'out', 'deep', 'fresh.txt'), 'new\n');
    expect(verdictOf('stray-dir', clock), 'the same instant, after a write deep inside').toBe('changed-recently');
  }, 60_000);

  it('mtime is never the measure: a file with a back-dated mtime and a fresh ctime is still young', () => {
    const p = mkLoose('stray-file', 'file');
    const old = new Date(Date.now() - 400 * 3600e3);
    fs.utimesSync(p, old, old);
    expect(verdictOf('stray-file', clockAfter(p, 47))).toBe('changed-recently');
  }, 60_000);

  it('a holder by file mapping answers in-use', () => {
    const p = mkLoose('stray-dir');
    const fake = [
      'CCD_OS=linux; rm -rf "$HOME/fp";',
      '_fpp() { mkdir -p "$HOME/fp/$1/fd" "$HOME/fp/$1/map_files";',
      ' printf "Name:\\tx\\nPPid:\\t%s\\nUid:\\t%s\\t%s\\t%s\\t%s\\n" "$2" "$3" "$3" "$3" "$3" > "$HOME/fp/$1/status";',
      ' : > "$HOME/fp/$1/environ"; ln -sfn / "$HOME/fp/$1/cwd"; };',
      `_fpp $$ 1 "$(id -u)"; _fpp 4242 1 "$(id -u)"; ln -sfn "${p}/b.txt" "$HOME/fp/4242/map_files/7f00-7f10";`,
      '_ws_path_users_proc_root() { printf %s "$HOME/fp"; };',
    ].join(' ');
    const d = docFor(audit('stray-dir', `${clockAfter(p, 49)} ${fake}`));
    expect(d['verdict']).toBe('in-use');
    expect(String(d['detail'])).toContain('4242');
  }, 60_000);

  it('a registry row whose workdir is inside it holds it', () => {
    const p = mkLoose('stray-dir');
    fs.mkdirSync(path.join(p, 'clone'));
    fs.writeFileSync(path.join(regDir(), 'demo-other.workdir'), path.join(p, 'clone'));
    fs.writeFileSync(path.join(regDir(), 'demo-other.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf('stray-dir', clockAfter(p, 49))).toBe('containment-unproven');
  }, 60_000);

  it('registry residue that names a path inside the entry is a row: the census classes it registered, the audit refuses it', () => {
    const p = mkLoose('demo-calm-mesa');
    fs.writeFileSync(path.join(regDir(), 'demo-calm-mesa.workdir'), path.join(p, 'out'));
    fs.writeFileSync(path.join(regDir(), 'demo-calm-mesa.wrapper'), 'lane-a');
    expect(classOf(census(), 'demo-calm-mesa')).toBe('registered');
    const d = docFor(audit('demo-calm-mesa', clockAfter(p, 49)));
    expect(d['verdict']).not.toBe('collectable');
    expect(fs.existsSync(p), 'nothing was touched').toBe(true);
  }, 60_000);

  it('a row named for the entry itself that lies inside it holds a name no slug check reaches', () => {
    const p = mkLoose('scratchdir');
    fs.writeFileSync(path.join(regDir(), 'scratchdir.workdir'), path.join(p, 'out'));
    expect(verdictOf('scratchdir', clockAfter(p, 49))).toBe('containment-unproven');
  }, 60_000);

  it('a checkout git records elsewhere holds it', () => {
    const p = mkLoose('stray-dir');
    const wt = path.join(p, 'wt'); fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(h.home, 'gone-repo', '.git', 'worktrees', 'x')}\n`);
    expect(verdictOf('stray-dir', clockAfter(p, 49))).toBe('containment-unproven');
  }, 60_000);

  it('pause answers paused, last', () => {
    const p = mkLoose('stray-dir');
    fs.writeFileSync(path.join(regDir(), 'reclaim-paused'), '');
    expect(verdictOf('stray-dir', clockAfter(p, 49))).toBe('paused');
  }, 60_000);

  it('only a loose entry is this arm’s: a witnessed leaf, a registered name, a link and a missing entry answer not-loose', () => {
    mkLoose('demo-quiet-reef');
    h.sh(`_ws_tmproot_witness_write demo-quiet-reef '${at('demo-quiet-reef')}' 7`);
    mkLoose('demo-calm-mesa'); fs.writeFileSync(path.join(regDir(), 'demo-calm-mesa.child'), '1');
    const target = mkLoose('plain-dir'); fs.symlinkSync(target, at('a-link'));
    for (const n of ['demo-quiet-reef', 'demo-calm-mesa', 'a-link', 'not-there']) {
      expect(verdictOf(n, clockAfter(target, 49)), n).toBe('not-loose');
    }
  }, 60_000);

  it('a name that is not hex is a usage error, never read as a name', () => {
    mkLoose('stray-dir');
    const r = h.run('cmd_ws_audit --loose-hex -rf --collect');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('bad loose hex');
  }, 60_000);

  it('the usage line of the session forms is unchanged for anything else', () => {
    const r = h.run('cmd_ws_audit --loose-hex 6162');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-audit --session <id>');
  }, 60_000);
});

describe.skipIf(!LINUX)('pressure and the floor', () => {
  const PRESSURE = '_disk_pressure() { return 0; };';
  it('under pressure the floor is 24 h: 25 h licenses, 23 h does not', () => {
    const p = mkLoose('stray-dir');
    const ok = docFor(audit('stray-dir', `${PRESSURE} ${clockAfter(p, 25)}`));
    expect(ok['verdict']).toBe('collectable');
    expect(ok['collect']).toMatchObject({ floorS: 86400, pressure: true });
    expect(verdictOf('stray-dir', `${PRESSURE} ${clockAfter(p, 23)}`)).toBe('changed-recently');
    expect(verdictOf('stray-dir', clockAfter(p, 25)), 'without pressure 25 h is still young').toBe('changed-recently');
  }, 60_000);

  it('and never below 86400 s, whatever the knob says', () => {
    const p = mkLoose('stray-dir');
    expect(verdictOf('stray-dir', `${PRESSURE} WS_COLLECT_LOOSE_FLOOR_S=1; ${clockAfter(p, 23)}`)).toBe('changed-recently');
    expect(verdictOf('stray-dir', `WS_COLLECT_LOOSE_FLOOR_S=1; ${clockAfter(p, 47)}`), 'the knob only raises').toBe('changed-recently');
    expect(docFor(audit('stray-dir', `WS_COLLECT_LOOSE_FLOOR_S=259200; ${clockAfter(p, 60)}`))['verdict'], 'a raise is honoured').toBe('changed-recently');
    const bad = audit('stray-dir', `WS_COLLECT_LOOSE_FLOOR_S=48h; ${clockAfter(p, 60)}`);
    expect(bad.code).toBe(1);
    expect(docFor(bad)['collect']).toMatchObject({ unmeasured: 'floor' });
  }, 60_000);

  it('_disk_pressure reads df: bytes or inodes at 92 percent or more, nothing else', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain('_DISK_CRITICAL_PCT=92');
    const bin = path.join(h.home, 'fakebin'); fs.mkdirSync(bin);
    const df = (bytes: number, inodes: number): void => {
      fs.writeFileSync(path.join(bin, 'df'), `#!/bin/sh\nif [ "$1" = -Pk ]; then printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nx 1000 ${bytes * 10} ${1000 - bytes * 10} ${bytes}%% /\\n'; else printf 'Filesystem Inodes IUsed IFree IUse%% Mounted\\nx 1000 ${inodes * 10} ${1000 - inodes * 10} ${inodes}%% /\\n'; fi\n`, { mode: 0o755 });
    };
    const ask = (): string => h.sh(`PATH='${bin}':$PATH; _disk_pressure "$HOME" && echo yes || echo no`);
    df(91, 10); expect(ask()).toBe('no');
    df(92, 10); expect(ask()).toBe('yes');
    df(40, 93); expect(ask(), 'inodes at 93 with bytes at 40').toBe('yes');
    df(40, 91); expect(ask()).toBe('no');
  }, 60_000);
});

describe.skipIf(!LINUX)('the verb: ws-collect --expect <token> --loose-hex <hex>', () => {
  const lines = (r: Run): string[] => r.stdout.replace(/\n$/, '').split('\n');

  it('quarantines, re-proves and removes a directory; the slot and the record go, and ONE done line says so', () => {
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, 49);
    const tok = tokenOf('stray-dir', clock);
    const r = verb('stray-dir', tok, `${clock} ${GAP_LOG}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(lines(r)).toHaveLength(1);
    const d = docOf(r.stdout);
    expect(d).toMatchObject({ collected: hexOf('stray-dir'), resumed: false, loose: true });
    expect(String(d['record'])).toMatch(/^[0-9a-f]{16}\.\d{19}\.\d+$/);
    expect(fs.existsSync(p), 'the entry').toBe(false);
    expect(slots(), 'no slot is left').toEqual([]);
    expect(looseRecs(), 'no record is left').toEqual([]);
    expect(gaps(h)).toEqual(['locked', 'consented', 'recorded', 'slotted', 'moved', 'proven', 'removed', 'emptied', 'dropped']);
    const ev = eventsOf(h.home, 'collect');
    expect(ev.map((e) => [e['outcome'], e['verb']])).toEqual([['intent', 'ws-collect'], ['done', 'ws-collect']]);
    expect(ev[1]!['tx']).toBe(ev[0]!['tx']);
  }, 120_000);

  it('unlinks a regular file', () => {
    const p = mkLoose('stray-file', 'file');
    const clock = clockAfter(p, 49);
    const r = verb('stray-file', tokenOf('stray-file', clock), clock);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: hexOf('stray-file'), loose: true });
    expect(fs.existsSync(p)).toBe(false);
    expect(slots()).toEqual([]);
    expect(looseRecs()).toEqual([]);
  }, 120_000);

  it('names that look like options or hold a space are collected through hex, never read as a flag', () => {
    for (const n of ['-rf', 'with space']) {
      const p = mkLoose(n);
      const clock = clockAfter(p, 49);
      const r = verb(n, tokenOf(n, clock), clock);
      expect(r.code, `${n}: ${r.stdout}${r.stderr}`).toBe(0);
      expect(fs.existsSync(p), n).toBe(false);
    }
  }, 120_000);

  it('collects when ~/.cc-tmp is itself a link to the volume (the box’s bind-mount shape)', () => {
    const real = path.join(h.home, 'cctmp-real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, ccTmp());
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, 49);
    const c = census();
    expect(classOf(c, 'stray-dir')).toBe('loose');
    const r = verb('stray-dir', tokenOf('stray-dir', clock), clock);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(real, 'stray-dir'))).toBe(false);
    expect(slots()).toEqual([]);
    expect(looseRecs()).toEqual([]);
  }, 120_000);

  it('removed and recreated under the same name between audit and verb: state-changed, and the newcomer is untouched', () => {
    const p = mkLoose('stray-dir');
    // The walk is pinned, so ONLY the inode differs: the token must bind it.
    const walk = '_ws_loose_idle() { _WS_IDLE_NEWEST_NS=1700000000000000000; _WS_IDLE_COUNT=5; _WS_IDLE_WHY=; _WS_IDLE_DETAIL=; };';
    const clock = '_ws_collect_now_ns() { echo 1800000000000000000; };';
    const pre = `${clock} ${walk}`;
    const tok = tokenOf('stray-dir', pre);
    const other = at('other-dir'); fs.mkdirSync(path.join(other, 'x'), { recursive: true });
    fs.rmSync(p, { recursive: true }); fs.renameSync(other, p);
    const r = verb('stray-dir', tok, pre);
    expect(docOf(r.stdout)['refused'], r.stdout + r.stderr).toBe('state-changed');
    expect(fs.existsSync(path.join(p, 'x')), 'the newcomer stands').toBe(true);
    expect(slots()).toEqual([]);
    expect(looseRecs()).toEqual([]);
  }, 120_000);

  it('a wrong token is state-changed, and nothing moves', () => {
    const p = mkLoose('stray-dir');
    const r = verb('stray-dir', WRONG_TOKEN, `${clockAfter(p, 49)} ${GAP_LOG}`);
    expect(docOf(r.stdout)['refused']).toBe('state-changed');
    expect(gaps(h)).toEqual(['locked']);
    expect(fs.existsSync(p)).toBe(true);
  }, 120_000);

  it('a holder appearing after the move puts it back, whole', () => {
    const p = mkLoose('stray-dir');
    const ino = inoAt(p);
    const clock = clockAfter(p, 49);
    const tok = tokenOf('stray-dir', clock);
    const hold = holderAt('cd "$3/leaf" && exec sleep 30', '[[ "$(readlink "/proc/$_hp/cwd" 2>/dev/null)" == "$3/leaf" ]]');
    const r = verb('stray-dir', tok, `${clock} ${gapAt('moved', hold)}`);
    expect(docOf(r.stdout)['refused'], r.stdout + r.stderr).toBe('in-use');
    expect(inoAt(p), 'the same inode is back at its own path').toBe(ino);
    expect(fs.readFileSync(path.join(p, 'b.txt'), 'utf8')).toBe('b\n');
    expect(slots()).toEqual([]);
    expect(looseRecs()).toEqual([]);
  }, 120_000);

  it('a killed verb resumes from the loose record', () => {
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, 49);
    const tok = tokenOf('stray-dir', clock);
    const crashed = verb('stray-dir', tok, `${clock} ${crashAt('moved')}`);
    expect(crashed.code).toBe(137);
    expect(fs.existsSync(p), 'the entry left its place').toBe(false);
    expect(looseRecs()).toHaveLength(1);
    expect(slots()).toHaveLength(1);
    const a = docFor(audit('stray-dir', clock));
    expect(a['verdict']).toBe('collectable');
    expect(a['resume']).toBe('moved');
    const r = verb('stray-dir', a['token'], clock);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r.stdout)).toMatchObject({ collected: hexOf('stray-dir'), resumed: true, loose: true });
    expect(slots()).toEqual([]);
    expect(looseRecs()).toEqual([]);
  }, 120_000);

  it('a pause read in the lock stops the verb before anything moves', () => {
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, 49);
    const tok = tokenOf('stray-dir', clock);
    fs.writeFileSync(path.join(regDir(), 'reclaim-paused'), '');
    const r = verb('stray-dir', tok, clock);
    expect(docOf(r.stdout)['refused']).toBe('paused');
    expect(fs.existsSync(p)).toBe(true);
  }, 120_000);

  it('another verb holding the loose lock: in-progress', () => {
    const p = mkLoose('stray-dir');
    const clock = clockAfter(p, 49);
    const tok = tokenOf('stray-dir', clock);
    const r = h.run(`${clock} exec 8>>"$REG/.collect-loose.lock"; flock -n 8; cmd_ws_collect --expect ${tok} --loose-hex ${hexOf('stray-dir')}`);
    expect(docOf(r.stdout)['refused']).toBe('in-progress');
    expect(fs.existsSync(p)).toBe(true);
  }, 120_000);

  it('a bad token or hex is a usage error', () => {
    mkLoose('stray-dir');
    expect(h.run(`cmd_ws_collect --expect nope --loose-hex ${hexOf('stray-dir')}`).stderr).toContain('bad token');
    expect(h.run(`cmd_ws_collect --expect ${WRONG_TOKEN} --loose-hex -rf`).stderr).toContain('bad loose hex');
  }, 60_000);
});

describe('the surface it rides', () => {
  it('ccd caps lists collect-loose-v1 beside collect-v1', () => {
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps).toContain('collect-v1');
    expect(caps).toContain('collect-loose-v1');
  }, 60_000);

  it('the launcher protects ws-audit --loose-hex <v> --collect and nothing wider (the body’s guard matches)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('"${2-}" == --loose-hex && "${4-}" == --collect');
    const entry = fs.readFileSync(path.join(path.dirname(CCD), 'ccd-entry.py'), 'utf8');
    expect(entry).toContain("folds_to(argv[1], '--loose-hex') and folds_to(argv[3], '--collect')");
  });
});
