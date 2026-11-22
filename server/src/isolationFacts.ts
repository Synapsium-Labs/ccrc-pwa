// The isolation word's measured facts (Overlord W1, spec 2026-11-09 §7.4, H28; plan `w1-isolation.md` Tasks 2 and 3).
// Ring L3, context C1: it measures, and decides nothing. `measurePeer` is the one writer of the link's peer facts, called
// only by the client's ready handler, on the socket that delivered the ready. No address, uid or id is logged here.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readlinkSync, readSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { hostDigest, readHostIds, type HostIds } from '../../shared/host-identity.mjs';
import type { AgentHostRelation, IsolationRead, Measured, PeerFacts } from '../../shared/isolation.js';
import type { CcrcConfig } from './config.js';
import type { FleetState } from './fleetstate.js';
import {
  holdingExposure, hostRelation, isolationWord, wakingHostKey, type LinkFacts, type PathStat, type ServerDigests, type ServerFacts,
  type WakingHostKey,
} from './isolationWord.js';

export type { PeerFacts };

/** Each TCP socket table is read up to this many bytes; a table past it reads `unmeasured`. */
export const PEER_TABLE_MAX = 4 * 1024 * 1024;

/** The two host reads `measurePeer` makes, as a seam: tests pass synthetic values. */
export interface PeerSeams {
  interfaceAddresses(): readonly string[];
  /** Linux's TCP socket tables, each bounded at `PEER_TABLE_MAX`, or `'unmeasured'` when any cannot be read. */
  tables(): readonly string[] | 'unmeasured';
}

/** Read at most `max` bytes of `file`: its text, `'absent'` on ENOENT, `'unmeasured'` on any other failure or past `max`. */
function readBounded(file: string, max: number): string | 'absent' | 'unmeasured' {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      total += n;
      if (total > max) return 'unmeasured';
      chunks.push(buf.subarray(0, n));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unmeasured';
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* nothing to report */ } }
  }
}

/** The real reads. `/proc/net/tcp6` is absent on a host without IPv6, which is no table, not an unreadable one; `/proc/net/tcp`
 *  absent (off Linux, or no `/proc`) reads the whole set `unmeasured`. */
export function realPeerSeams(procRoot = '/proc'): PeerSeams {
  return {
    interfaceAddresses: () => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => i.address)),
    tables: () => {
      if (process.platform !== 'linux') return 'unmeasured';
      const out: string[] = [];
      for (const [name, required] of [['tcp', true], ['tcp6', false]] as const) {
        const t = readBounded(`${procRoot}/net/${name}`, PEER_TABLE_MAX);
        if (t === 'unmeasured' || (t === 'absent' && required)) return 'unmeasured';
        if (t !== 'absent') out.push(t);
      }
      return out;
    },
  };
}

/** One spelling per address: lower case, no zone, an IPv4-mapped IPv6 address as its IPv4 form. */
function canonicalAddress(addr: string): string {
  const a = addr.toLowerCase().replace(/%.*$/, '');
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped !== null) return mapped[1]!;
  return a.includes(':') ? expandIpv6(a) : a;
}
function expandIpv6(a: string): string {
  const [head, tail] = a.includes('::') ? a.split('::') as [string, string] : [a, null];
  const h = head === '' ? [] : head.split(':');
  const t = tail === null || tail === '' ? [] : tail.split(':');
  const fill = tail === null ? [] : Array<string>(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}
function isLoopback(addr: string): boolean {
  return /^127\.\d+\.\d+\.\d+$/.test(addr) || addr === '0:0:0:0:0:0:0:1';
}

/** The uid of the one established row whose local port is `localPort` and whose remote port is `remotePort`, across the
 *  tables. Zero rows, two or more, or a row it cannot read: `'unmeasured'`. Only ports are compared. */
function uidOfRow(tables: readonly string[], localPort: number, remotePort: number): Measured<number> {
  const found: number[] = [];
  for (const t of tables) {
    if (t.length > PEER_TABLE_MAX) return 'unmeasured';
    for (const line of t.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 8) continue;
      const lp = Number.parseInt(cols[1]!.split(':').at(-1) ?? '', 16);
      const rp = Number.parseInt(cols[2]!.split(':').at(-1) ?? '', 16);
      if (lp !== localPort || rp !== remotePort || cols[3] !== '01') continue;
      if (!/^\d+$/.test(cols[7]!)) return 'unmeasured';
      found.push(Number(cols[7]));
    }
  }
  return found.length === 1 && Number.isSafeInteger(found[0]) ? found[0]! : 'unmeasured';
}

/** Measured on the socket that delivered the ready (plan question 8). The address is compared and dropped: it is never
 *  stored, returned or logged. */
export function measurePeer(
  sock: { remoteAddress?: string | undefined; remotePort?: number | undefined; localPort?: number | undefined },
  seams: PeerSeams = realPeerSeams(),
): PeerFacts {
  const { remoteAddress, remotePort, localPort } = sock;
  if (remoteAddress === undefined || remotePort === undefined || localPort === undefined) return { locality: 'unmeasured', uid: 'unmeasured' };
  const peer = canonicalAddress(remoteAddress);
  let local = isLoopback(peer);
  if (!local) {
    try { local = seams.interfaceAddresses().some((a) => canonicalAddress(a) === peer); } catch { return { locality: 'unmeasured', uid: 'unmeasured' }; }
  }
  if (!local) return { locality: 'not-local', uid: 'unmeasured' };
  let tables: readonly string[] | 'unmeasured';
  try { tables = seams.tables(); } catch { tables = 'unmeasured'; }
  return { locality: 'local', uid: tables === 'unmeasured' ? 'unmeasured' : uidOfRow(tables, remotePort, localPort) };
}

// ------------------------------------------------------------------------------------------------- what the server holds

/** The server's unit and environment files, spelled as `ccd/ccrc` spells them (`role_unit`, `BOX_UNIT_DIR`, `BOX_ENV_FILE`,
 *  `CCRC_EXPOSURE_FILE`); `isolation-holdings.test.ts` holds them equal to those spellings. */
export const SERVER_UNIT_NAME = 'ccrc.service';
export const SERVER_UNIT_DIR_LINUX = '.config/systemd/user';
export const SERVER_UNIT_DIR_DARWIN = 'Library/LaunchAgents';
export const SERVER_ENV_FILE = '.ccrc/ccrc.env';
export const SERVER_EXPOSURE_FILE = '.ccrc/exposure.env';

/** Every `CcrcConfig` path field that names something the server does NOT hold, with its reason (plan question 11): a
 *  new field ending `Path`, `Dir`, `Root` or `Bin` is in `serverHoldings` or here, or `isolation-holdings.test.ts` is red. */
export const NOT_HELD: Readonly<Record<string, string>> = {
  registryDir: "the sessions' own registry, which they write",
  limitsDir: "the sessions' own limit files",
  clipsDir: "the sessions' clips, which they write",
  uploadsDir: "the operator's uploads for the sessions",
  projectsRoot: "the fleet's project checkouts, the sessions' own working trees",
  ccdBin: "the fleet's ccd, which the sessions run; the server's code tree is held as codeRoot",
  buildInfoPath: 'the build stamp the server reports: it holds no secret and chooses no code',
  installedCcrcPath: 'the install record the server reports: it holds no secret and chooses no code',
};

export interface HeldPath { readonly name: string; readonly path: string; readonly concern: 'secret' | 'control' }

/** Every path the server holds, from the configuration, in one place (plan question 11, ruled F3). `secret`: a read or
 *  a write reaches what it holds. `control`: a write changes what the server runs. */
export function serverHoldings(cfg: CcrcConfig, codeRoot: string, env: NodeJS.ProcessEnv, platform: string = process.platform): readonly HeldPath[] {
  const home = cfg.home;
  const unitDir = path.join(home, platform === 'darwin' ? SERVER_UNIT_DIR_DARWIN : SERVER_UNIT_DIR_LINUX);
  const secret = (name: string, p: string): HeldPath => ({ name, path: p, concern: 'secret' });
  const control = (name: string, p: string): HeldPath => ({ name, path: p, concern: 'control' });
  return [
    secret('ccrcDir', cfg.ccrcDir),
    secret('coordDbPath', cfg.coordDbPath),
    secret('operatorModelDbPath', cfg.operatorModelDbPath),
    secret('mailTokenPath', cfg.mailTokenPath),
    secret('authSecretPath', cfg.authSecretPath),
    secret('sessionsPath', cfg.sessionsPath),
    secret('passkeysPath', cfg.passkeysPath),
    secret('accountsPath', cfg.accountsPath),
    control('codeRoot', codeRoot),
    control('unit', platform === 'darwin' ? unitDir : path.join(unitDir, SERVER_UNIT_NAME)),
    control('unitDropIns', path.join(unitDir, `${SERVER_UNIT_NAME}.d`)),
    control('envFile', path.join(home, SERVER_ENV_FILE)),
    control('exposureFile', env.CCRC_EXPOSURE_FILE !== undefined && env.CCRC_EXPOSURE_FILE !== '' ? env.CCRC_EXPOSURE_FILE : path.join(home, SERVER_EXPOSURE_FILE)),
  ];
}

/** The tree the running entry was loaded from: the parent of the first directory above `entryFile` that holds a
 *  `package.json` (the server package), so the code tree is measured, never guessed. */
export function codeRootOf(entryFile: string): string {
  let dir = path.dirname(entryFile);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return path.dirname(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.dirname(entryFile);
}

// ----------------------------------------------------------------------------------------------- the server's own facts

type Lstat = { readonly uid: number; readonly mode: number; readonly dir: boolean; readonly link: boolean };
/** The server's own reads, as a seam: tests pass synthetic trees and values. */
export interface ServerSeams {
  lstat(p: string): Lstat | 'absent' | 'unmeasured';
  /** A symbolic link's target, as written. */
  readlink(p: string): string | 'unmeasured';
  readText(p: string): string | 'unmeasured';
  uid(): number | undefined;
  hostIds(): HostIds;
  readonly procRoot: string;
  readonly platform: string;
}

export function realServerSeams(): ServerSeams {
  return {
    lstat: (p) => {
      try {
        const st = lstatSync(p);
        return { uid: st.uid, mode: st.mode & 0o7777, dir: st.isDirectory(), link: st.isSymbolicLink() };
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'absent' : 'unmeasured';
      }
    },
    readlink: (p) => { try { return readlinkSync(p); } catch { return 'unmeasured'; } },
    readText: (p) => { const t = readBounded(p, 64 * 1024); return t === 'absent' ? 'unmeasured' : t; },
    uid: () => process.getuid?.(),
    hostIds: () => readHostIds(),
    procRoot: '/proc',
    platform: process.platform,
  };
}

/** The most path components `chainOf` resolves for one held path, every link's target included. Past it the chain is
 *  not established (a link loop, or a chain too long), so it reads `unmeasured`. */
export const CHAIN_STEPS_MAX = 256;

/** A held path's chain (plan question 11), resolved one component at a time from `/`, as the kernel resolves it: every
 *  directory passed through, every symbolic link met on the way (its owner can rewrite it, and the directory holding it
 *  is passed through first), and through each link, the directories its target passes through, link after link. It ends
 *  at the path, or at its nearest existing ancestor for a store not yet created; the leaf comes first. Anything that
 *  stops the chain being established whole reads `unmeasured`, never a partial chain: an element or a link's target that
 *  cannot be read, a component below something that is not a directory, or more than `CHAIN_STEPS_MAX` steps. */
function chainOf(p: string, seams: ServerSeams): Measured<readonly PathStat[]> {
  const root = seams.lstat('/');
  if (root === 'absent' || root === 'unmeasured' || !root.dir) return 'unmeasured';
  const seen = new Map<string, PathStat>([['/', { uid: root.uid, mode: root.mode, dir: true }]]);
  let cur = '/';
  let todo = path.resolve(p).split('/').filter((c) => c !== '');
  for (let steps = 0; todo.length > 0; steps++) {
    if (steps >= CHAIN_STEPS_MAX) return 'unmeasured';
    const c = todo.shift()!;
    if (c === '.') continue;
    if (c === '..') { cur = path.dirname(cur); continue; }
    const next = path.join(cur, c);
    const st = seams.lstat(next);
    if (st === 'unmeasured') return 'unmeasured';
    if (st === 'absent') break;
    if (st.link) {
      seen.set(next, { uid: st.uid, mode: st.mode, dir: false, link: true });
      const to = seams.readlink(next);
      if (to === 'unmeasured' || to === '') return 'unmeasured';
      if (path.isAbsolute(to)) cur = '/';
      todo = [...to.split('/').filter((x) => x !== ''), ...todo];
      continue;
    }
    if (!st.dir && todo.length > 0) return 'unmeasured';
    seen.set(next, { uid: st.uid, mode: st.mode, dir: st.dir });
    cur = next;
  }
  const leaf = seen.get(cur);
  if (leaf === undefined) return 'unmeasured';
  return [leaf, ...[...seen].filter(([k]) => k !== cur).map(([, v]) => v)];
}

function uidMapIsIdentity(text: string): boolean {
  const lines = text.trim().split('\n').filter((l) => l.trim() !== '');
  return lines.length === 1 && lines[0]!.trim().split(/\s+/).join(' ') === '0 0 4294967295';
}

/** What `measureServerFacts` answers: the facts the deciders read, and the raw host ids, which stay in the reader's
 *  memory and are digested under a key at each comparison. Never logged, never served. */
export interface MeasuredServer { readonly facts: ServerFacts; readonly ids: HostIds }

/** The server's own facts, measured once at boot over the one list `serverHoldings`. Each fact is a value or
 *  `'unmeasured'`, field by field (plan question 15). */
export function measureServerFacts(cfg: CcrcConfig, codeRoot: string, env: NodeJS.ProcessEnv = process.env, seams: ServerSeams = realServerSeams()): MeasuredServer {
  const raw = seams.uid();
  const uid: Measured<number> = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 'unmeasured';
  let initialNamespace: Measured<boolean> = 'unmeasured';
  let overflowUid: Measured<number> = 'unmeasured';
  if (seams.platform === 'linux') {
    const map = seams.readText(`${seams.procRoot}/self/uid_map`);
    if (map !== 'unmeasured') initialNamespace = uidMapIsIdentity(map);
    const ov = seams.readText(`${seams.procRoot}/sys/kernel/overflowuid`);
    if (ov !== 'unmeasured' && /^\d+$/.test(ov.trim())) overflowUid = Number(ov.trim());
  }
  const holdings = serverHoldings(cfg, codeRoot, env, seams.platform)
    .map((h) => holdingExposure({ name: h.name, concern: h.concern, elements: chainOf(h.path, seams) }, uid));
  let ids: HostIds;
  try { ids = seams.hostIds(); } catch { ids = { machine: 'unmeasured', boot: 'unmeasured' }; }
  return { facts: { uid, initialNamespace, overflowUid, holdings }, ids };
}

// ------------------------------------------------------------------------------------------------------------ the reader

type LinkState = Pick<FleetState, 'connected' | 'hostReport' | 'peer' | 'readySerial'>;

/** The one reader every consumer takes: the ladder's input, the board (PR B2), the authority witness's relation and the
 *  renewal readings' carrier. It holds the server's facts and a reference to the live fleet state, reads them on each
 *  call, and caches nothing. */
export interface IsolationReader {
  read(): IsolationRead;
  relationOf(link: LinkFacts): AgentHostRelation;
  linkOf(state: LinkState): LinkFacts;
  wakingHostKey(): WakingHostKey | 'unmeasured';
}

export function makeIsolationReader(mode: 'local' | 'remote', server: MeasuredServer, bearer: string | null, state: LinkState | null): IsolationReader {
  // The carrier's key in local mode: minted once, in memory only, so a restart makes the next comparison unmeasured.
  const bootKey = randomBytes(32).toString('hex');
  const digests = (): ServerDigests => ({
    machine: bearer === null || server.ids.machine === 'unmeasured' ? 'unmeasured' : hostDigest(bearer, 'machine', server.ids.machine),
    boot: bearer === null || server.ids.boot === 'unmeasured' ? 'unmeasured' : hostDigest(bearer, 'boot', server.ids.boot),
  });
  const linkOf = (s: LinkState): LinkFacts => {
    if (s.hostReport === undefined) return { link: 'none' };
    if (!s.connected) return { link: 'down' };
    return { link: 'ready', report: s.hostReport, peer: s.peer ?? { locality: 'unmeasured', uid: 'unmeasured' },
      serverDigests: digests(), readySerial: s.readySerial ?? 0 };
  };
  return {
    read: () => isolationWord(mode, server.facts, mode === 'local' || state === null ? [] : [linkOf(state)]),
    relationOf: (link) => hostRelation(link),
    linkOf,
    wakingHostKey: () => mode === 'local'
      ? wakingHostKey('local', server.ids.machine === 'unmeasured' ? 'unmeasured' : hostDigest(bootKey, 'machine', server.ids.machine), null)
      : wakingHostKey('remote', 'unmeasured', state === null ? null : linkOf(state)),
  };
}
