// The isolation word's deciders (Overlord W1, spec 2026-11-09 §7.4, H28; plan `w1-isolation.md` Task 3). Ring L1, context
// C1: pure, over measured facts. No fs, no os, no clock, no crypto: the reader (`isolationFacts.ts`, L3) measures, and
// computes the server's digests under the link's bearer, before it asks.
//
// Either side may narrow, and only the two sides together widen (question 8). In W1 the server proves no other kernel
// (question 9, ruled F1), so no arm here answers `separate-host` or the relation `other-host`.
import type {
  AgentHostRelation, HostReport, IsolationCause, IsolationRead, IsolationUnmeasured, Measured, PeerFacts,
} from '../../shared/isolation.js';
import type { ConditionReading } from '../../shared/overlord-ladder.js';

/** One element of a held path's chain, as `lstat` measured it. */
export interface PathStat { readonly uid: number; readonly mode: number; readonly dir: boolean }
/** A held path's chain: its leaf first (the path as resolved, or its nearest existing ancestor for a store not yet
 *  created), then every directory above it, then, for a path reached through a symbolic link, the directories that hold
 *  the link. `unmeasured` when any element could not be read. */
export interface HoldingChain {
  readonly name: string; readonly concern: 'secret' | 'control';
  readonly elements: Measured<readonly PathStat[]>;
}
export interface Holding {
  readonly name: string;
  readonly owners: Measured<readonly number[]>;
  readonly exposure: Measured<'owner-only' | 'exposed'>;
}

const GROUP_OTHER_WRITE = 0o022;
const GROUP_OTHER_ANY = 0o077;
const STICKY = 0o1000;

/** Question 11's rule. Write exposure: a directory of the chain writable by group or others without the sticky bit, or
 *  the leaf writable by group or others. Read exposure (`secret` only): no element is owner-only and owned by the server
 *  or root. Owners: every uid owning an element, other than root and the server. */
export function holdingExposure(chain: HoldingChain, serverUid: Measured<number>): Holding {
  const { name, elements } = chain;
  if (elements === 'unmeasured' || elements.length === 0) return { name, owners: 'unmeasured', exposure: 'unmeasured' };
  const owners = [...new Set(elements.map((e) => e.uid).filter((u) => u !== 0 && u !== serverUid))];
  const writable = elements.some((e, i) => (e.mode & GROUP_OTHER_WRITE) !== 0 && (i === 0 || (e.mode & STICKY) === 0));
  if (writable) return { name, owners, exposure: 'exposed' };
  if (chain.concern === 'control') return { name, owners, exposure: 'owner-only' };
  const guarded = elements.some((e) => (e.mode & GROUP_OTHER_ANY) === 0 && (e.uid === 0 || e.uid === serverUid));
  if (guarded) return { name, owners, exposure: 'owner-only' };
  return { name, owners, exposure: serverUid === 'unmeasured' ? 'unmeasured' : 'exposed' };
}

/** What the server measured of itself, once at boot. Its raw host ids stay in the reader's memory, never here. */
export interface ServerFacts {
  readonly uid: Measured<number>;
  /** `/proc/self/uid_map` is the identity map. */
  readonly initialNamespace: Measured<boolean>;
  readonly overflowUid: Measured<number>;
  readonly holdings: readonly Holding[];
}

/** The server's own two digests, under the link's bearer, computed by the reader at each comparison. */
export interface ServerDigests { readonly machine: Measured<string>; readonly boot: Measured<string> }

export type LinkFacts =
  | { readonly link: 'none' }                     // no ready since boot
  | { readonly link: 'down' }
  | { readonly link: 'ready'; readonly report: HostReport | 'absent' | 'malformed'; readonly peer: PeerFacts;
      readonly serverDigests: ServerDigests; readonly readySerial: number };
type ReadyLink = Extract<LinkFacts, { link: 'ready' }>;

export type LinkKernel = 'same' | 'forwarded' | 'unproven' | 'unmeasured';

const equalMeasured = (a: Measured<string>, b: Measured<string>): boolean => a !== 'unmeasured' && b !== 'unmeasured' && a === b;
const differMeasured = (a: Measured<string>, b: Measured<string>): boolean => a !== 'unmeasured' && b !== 'unmeasured' && a !== b;

/** Whether the link's agent shares this kernel, first match: a local peer is `same`, unless the report's two digests
 *  are both measured and both differ from the server's (a forward, question 12); an equal digest is `same`; a peer that
 *  is not local is `unproven`; otherwise `unmeasured`. */
export function linkKernel(link: ReadyLink): LinkKernel {
  const { report, peer, serverDigests: s } = link;
  const present = typeof report === 'object';
  if (peer.locality === 'local') {
    return present && differMeasured(report.machine, s.machine) && differMeasured(report.boot, s.boot) ? 'forwarded' : 'same';
  }
  if (present && (equalMeasured(report.machine, s.machine) || equalMeasured(report.boot, s.boot))) return 'same';
  if (peer.locality === 'not-local') return 'unproven';
  return 'unmeasured';
}

const unmeasured = (why: IsolationUnmeasured): IsolationRead => ({ kind: 'unmeasured', why });
const sharedUser = (cause: IsolationCause): IsolationRead => ({ kind: 'measured', word: 'shared-user', cause });

/** One link's verdict (plan Figure 1), first match. */
export function linkIsolation(server: ServerFacts, link: LinkFacts): IsolationRead {
  if (link.link === 'none') return unmeasured('no-agent');
  if (link.link === 'down') return unmeasured('link-down');
  const { report, peer } = link;
  const kernel = linkKernel(link);
  if (kernel === 'forwarded') return unmeasured('forwarded');
  if (kernel !== 'same') {
    if (report === 'absent') return unmeasured('agent-older');
    if (report === 'malformed') return unmeasured('report-malformed');
    return unmeasured(kernel === 'unproven' ? 'kernel-unproven' : 'host-unmeasured');
  }
  // One kernel: a narrowing fact needs one side only.
  if (server.holdings.some((h) => h.exposure === 'exposed')) return sharedUser('store-mode');
  const uids: number[] = [];
  if (peer.locality === 'local' && peer.uid !== 'unmeasured') uids.push(peer.uid);
  if (typeof report === 'object' && report.uid !== 'unmeasured') uids.push(report.uid);
  if (uids.includes(0)) return sharedUser('root-agent');
  if (server.uid !== 'unmeasured' && uids.includes(server.uid)) return sharedUser('same-user');
  if (server.holdings.some((h) => h.owners !== 'unmeasured' && h.owners.some((o) => uids.includes(o)))) return sharedUser('store-owner');
  if (peer.locality === 'not-local') return unmeasured('other-namespace');
  if (peer.locality === 'unmeasured') return unmeasured('host-unmeasured');
  // A local peer: the one widening needs both sides and every server fact (question 10).
  if (peer.uid === 'unmeasured') return unmeasured('peer-uid-unmeasured');
  if (server.overflowUid !== 'unmeasured' && peer.uid === server.overflowUid) return unmeasured('peer-uid-overflow');
  if (report === 'absent') return unmeasured('agent-older');
  if (report === 'malformed') return unmeasured('report-malformed');
  if (report.uid === 'unmeasured' || report.uid !== peer.uid) return unmeasured('report-disagrees');
  // The report must agree that this is one kernel, by a measured digest equal to the server's (slug
  // `separate-user-needs-an-equal-digest`): otherwise unmeasuring a forward's differing digests would widen it.
  if (!equalMeasured(report.machine, link.serverDigests.machine) && !equalMeasured(report.boot, link.serverDigests.boot)) {
    return unmeasured('host-unmeasured');
  }
  if (server.initialNamespace === false) return unmeasured('server-namespace');
  if (server.initialNamespace === 'unmeasured' || server.uid === 'unmeasured' || server.overflowUid === 'unmeasured'
    || server.holdings.some((h) => h.owners === 'unmeasured' || h.exposure === 'unmeasured')) return unmeasured('server-facts');
  return { kind: 'measured', word: 'separate-user', cause: 'other-user' };
}

/** The fleet-wide word. Local mode reads `shared-user`, cause `local-mode` (question 21); remote mode folds the links:
 *  any `shared-user` link wins, then any `unmeasured` one, in link order. No arm answers `separate-host` in W1. */
export function isolationWord(mode: 'local' | 'remote', server: ServerFacts, links: readonly LinkFacts[]): IsolationRead {
  if (mode === 'local') return sharedUser('local-mode');
  if (links.length === 0) return unmeasured('no-agent');
  const reads = links.map((l) => linkIsolation(server, l));
  const shared = reads.find((r) => r.kind === 'measured' && r.word === 'shared-user');
  if (shared !== undefined) return shared;
  const blind = reads.find((r) => r.kind === 'unmeasured');
  if (blind !== undefined) return blind;
  return { kind: 'measured', word: 'separate-user', cause: 'other-user' };
}

/** The witness's relation, per link (question 17). Never `other-host` in W1 (question 9). */
export function hostRelation(link: LinkFacts): AgentHostRelation {
  return link.link === 'ready' && linkKernel(link) === 'same' ? 'same-host' : 'unmeasured';
}

/** What a consumer reads when no reader is wired (a test's deps, a script): unmeasured, which acts as `shared-user`. */
export const ISOLATION_NOT_WIRED: IsolationRead = { kind: 'unmeasured', why: 'not-wired' };

/** The ladder's input: `shared-user` stands, a separate word lifts, and `unmeasured` is unmeasured, which caps as
 *  `shared-user` does (the ladder's question 17). */
export function isolationCondition(read: IsolationRead): ConditionReading {
  if (read.kind === 'unmeasured') return 'unmeasured';
  return read.word === 'shared-user' ? 'standing' : 'lifted';
}

export interface WakingHostKey { readonly digest: string; readonly keyEpoch: number }

/** The carrier for the renewal readings' `notLocal` report (question 16), compared in memory only. Local mode: the
 *  server's machine id under the boot key, `keyEpoch` 0. Remote mode: the ready link's reported machine digest, `keyEpoch`
 *  its ready serial, so two carriers compare only under one key. Anything else: `unmeasured`. */
export function wakingHostKey(mode: 'local' | 'remote', localDigest: Measured<string>, link: LinkFacts | null): WakingHostKey | 'unmeasured' {
  if (mode === 'local') return localDigest === 'unmeasured' ? 'unmeasured' : { digest: localDigest, keyEpoch: 0 };
  if (link === null || link.link !== 'ready' || typeof link.report !== 'object' || link.report.machine === 'unmeasured') return 'unmeasured';
  return { digest: link.report.machine, keyEpoch: link.readySerial };
}
