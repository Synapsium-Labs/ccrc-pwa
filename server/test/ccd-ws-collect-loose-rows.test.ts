// The loose arm's rows rung, asked of a REGULAR FILE as well as a directory (fleet disk retention spec 2026-10-23 §2.4,
// D-6625). A file cannot be a session's workdir and cannot hold one, so the rung compares each registry row's spelling with
// the entry's own: a row at the file, or spelled through it, holds it; every other row is no concern of the file's.
// Measured on a fleet: every loose regular file answered `unmeasured` ("registry row(s) … cannot be placed against this
// child") for as long as the registry held one row, because the child's own workdir was resolved as a directory.
// Every case builds its entries in a FIXTURE HOME and runs the SOURCED functions; nothing here touches a live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { docOf, killHolder, type Run } from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => {
  h = makePrHarness('ccrc-ws-collect-loose-rows-');
  fs.mkdirSync(path.join(h.home, '.cc-sessions', 'tmproots'), { recursive: true });
});
afterEach(() => { killHolder(h); h.cleanup(); });

const LINUX = process.platform === 'linux';
const hexOf = (name: string): string => Buffer.from(name, 'utf8').toString('hex');
const ccTmp = (): string => path.join(h.home, '.cc-tmp');
const at = (name: string): string => path.join(ccTmp(), name);
const regDir = (): string => path.join(h.home, '.cc-sessions');
const NO_PRESSURE = '_disk_pressure() { return 1; };';

function mkLoose(name: string, kind: 'dir' | 'file'): string {
  const p = at(name);
  fs.mkdirSync(ccTmp(), { recursive: true });
  if (kind === 'file') fs.writeFileSync(p, 'scratch\n');
  else { fs.mkdirSync(path.join(p, 'out'), { recursive: true }); fs.writeFileSync(path.join(p, 'out', 'a.txt'), 'a\n'); }
  return p;
}
/** A registry row for another session whose workdir stands elsewhere. */
function mkRow(id: string, workdir: string): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(regDir(), `${id}.workdir`), workdir);
  fs.writeFileSync(path.join(regDir(), `${id}.uuid`), 'deadbeef-0000-4000-8000-000000000000');
}
const newestNs = (p: string): bigint => {
  let best = fs.lstatSync(p, { bigint: true }).ctimeNs;
  if (fs.lstatSync(p).isDirectory()) for (const n of fs.readdirSync(p)) { const v = newestNs(path.join(p, n)); if (v > best) best = v; }
  return best;
};
const clockAfter = (p: string, hours: number): string =>
  `_ws_collect_now_ns() { echo ${newestNs(p) + BigInt(Math.round(hours * 3600)) * 1_000_000_000n}; };`;
const audit = (name: string, pre: string): Run => h.run(`${NO_PRESSURE} ${pre} cmd_ws_audit --loose-hex ${hexOf(name)} --collect`);
const docFor = (r: Run): Record<string, any> => JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as Record<string, any>;
const verdictOf = (name: string, pre: string): Record<string, any> => docFor(audit(name, pre));

describe.skipIf(!LINUX)('characterization: a directory beside unrelated registry rows (green before the file arm)', () => {
  it('a 49 h-quiet loose directory is collectable while another session’s row stands elsewhere', () => {
    const p = mkLoose('stray-dir', 'dir');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    const d = verdictOf('stray-dir', clockAfter(p, 49));
    expect(d['verdict'], JSON.stringify(d)).toBe('collectable');
    expect(d['collect']).toMatchObject({ type: 'd' });
  }, 60_000);
});

describe.skipIf(!LINUX)('a loose regular file beside registry rows', () => {
  it('a 49 h-quiet file is collectable while another session’s row stands elsewhere', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    mkRow('demo-quiet-reef', path.join(h.home, 'projects', 'other'));
    const d = verdictOf('stray.json', clockAfter(p, 49));
    expect(d['verdict'], JSON.stringify(d)).toBe('collectable');
    expect(d['collect']).toMatchObject({ type: 'f', entries: 1 });
  }, 60_000);

  it('the verb quarantines and removes it, rows or no rows', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    const clock = clockAfter(p, 49);
    const tok = verdictOf('stray.json', clock)['token'] as string;
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    const r = h.run(`${NO_PRESSURE} ${clock} cmd_ws_collect --expect ${tok} --loose-hex ${hexOf('stray.json')}`);
    expect(docOf(r.stdout), r.stdout + r.stderr).toMatchObject({ collected: hexOf('stray.json'), loose: true });
    expect(fs.existsSync(p)).toBe(false);
  }, 60_000);

  it('a row whose workdir is the file itself holds it', () => {
    const p = mkLoose('stray.json', 'file');
    fs.writeFileSync(path.join(regDir(), 'demo-odd.workdir'), p);
    fs.writeFileSync(path.join(regDir(), 'demo-odd.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    const d = verdictOf('stray.json', clockAfter(p, 49));
    expect(d['verdict']).toBe('containment-unproven');
    expect(fs.existsSync(p), 'nothing was touched').toBe(true);
  }, 60_000);

  it('a row spelled through the file holds it', () => {
    const p = mkLoose('stray.json', 'file');
    fs.writeFileSync(path.join(regDir(), 'demo-odd.workdir'), `${p}/sub`);
    fs.writeFileSync(path.join(regDir(), 'demo-odd.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf('stray.json', clockAfter(p, 49))['verdict']).toBe('containment-unproven');
  }, 60_000);

  it('a row spelled with the root’s physical path holds it too', () => {
    const p = mkLoose('stray.json', 'file');
    fs.writeFileSync(path.join(regDir(), 'demo-odd.workdir'), path.join(fs.realpathSync(ccTmp()), 'stray.json'));
    fs.writeFileSync(path.join(regDir(), 'demo-odd.uuid'), 'deadbeef-0000-4000-8000-000000000000');
    expect(verdictOf('stray.json', clockAfter(p, 49))['verdict']).toBe('containment-unproven');
  }, 60_000);

  it('a sibling that shares the file’s name as a prefix is no row of it', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, '.cc-tmp', 'stray.json.d'));
    expect(verdictOf('stray.json', clockAfter(p, 49))['verdict']).toBe('collectable');
  }, 60_000);

  it('a row that cannot be read is unmeasured, never collectable', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    const d = verdictOf('stray.json', `${clockAfter(p, 49)} _reg_read() { return 2; };`);
    expect(d['verdict']).toBe('unmeasured');
    expect(fs.existsSync(p)).toBe(true);
  }, 60_000);

  it('a process still using the file keeps it, rows or no rows', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    const fake = '_ws_path_users() { _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="cwd"; return 1; };';
    expect(verdictOf('stray.json', `${clockAfter(p, 49)} ${fake}`)['verdict']).toBe('in-use');
  }, 60_000);

  it('a file idle under the floor keeps its quiet window', () => {
    const p = mkLoose('stray.json', 'file');
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    expect(verdictOf('stray.json', clockAfter(p, 47))['verdict']).toBe('changed-recently');
  }, 60_000);

  it('a link is never followed: a link to a file is not loose', () => {
    mkLoose('real.json', 'file');
    fs.symlinkSync(at('real.json'), at('lnk.json'));
    mkRow('demo-calm-mesa', path.join(h.home, 'projects', 'elsewhere'));
    expect(verdictOf('lnk.json', clockAfter(at('real.json'), 49))['verdict']).toBe('not-loose');
  }, 60_000);
});
