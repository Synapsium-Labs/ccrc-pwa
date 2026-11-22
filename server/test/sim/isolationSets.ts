// The isolation word's deciders' oracles and mutant sets (Overlord W1, plan `w1-isolation.md` Task 3). The cases are
// written ONCE here, as suite cases over a module: `isolation-word.test.ts` and `isolation-vocabulary.test.ts` run them
// against the real modules, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's floors).
// Synthetic facts only: uids 1000 (the server), 2000 (a held path's owner), 3000 (a third user), 65534 (the overflow uid).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { HostReport, IsolationRead, Measured, PeerFacts } from '../../../shared/isolation.js';
import type { Holding, LinkFacts, PathStat, ServerDigests, ServerFacts } from '../../src/isolationWord.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORD_TS = path.join(ROOT, 'server/src/isolationWord.ts');
const SHARED_TS = path.join(ROOT, 'shared/isolation.ts');

export type WordModule = typeof import('../../src/isolationWord.js');
type SharedModule = typeof import('../../../shared/isolation.js');

// ------------------------------------------------------------------------------------------------------------ fixtures

export const SERVER_UID = 1000;
export const OWNER_UID = 2000;
export const THIRD_UID = 3000;
export const OVERFLOW_UID = 65534;
/** The server's own digests under the link's bearer, and another host's. */
export const SD: ServerDigests = { machine: 'a'.repeat(64), boot: 'd'.repeat(64) };
export const OTHER = { machine: 'b'.repeat(64), boot: 'e'.repeat(64) };

const ownerOnly = (name: string, owners: readonly number[] = []): Holding => ({ name, owners, exposure: 'owner-only' });
export const HOLDINGS = {
  /** Every held path owner-only; one chain has an element the owner uid owns. */
  owned: [ownerOnly('ccrcDir'), ownerOnly('codeRoot', [OWNER_UID])] as readonly Holding[],
  exposed: [ownerOnly('ccrcDir'), { name: 'codeRoot', owners: [OWNER_UID], exposure: 'exposed' }] as readonly Holding[],
  blind: [ownerOnly('ccrcDir'), { name: 'codeRoot', owners: 'unmeasured', exposure: 'unmeasured' }] as readonly Holding[],
};
export const server = (over: Partial<ServerFacts> = {}): ServerFacts => ({
  uid: SERVER_UID, initialNamespace: true, overflowUid: OVERFLOW_UID, holdings: HOLDINGS.owned, ...over,
});
export const report = (uid: Measured<number>, machine: Measured<string> = SD.machine, boot: Measured<string> = SD.boot): HostReport =>
  ({ uid, machine, boot });
export const ready = (peer: PeerFacts, rep: HostReport | 'absent' | 'malformed', readySerial = 1): LinkFacts =>
  ({ link: 'ready', report: rep, peer, serverDigests: SD, readySerial });
export const local = (uid: Measured<number>): PeerFacts => ({ locality: 'local', uid });
export const notLocal: PeerFacts = { locality: 'not-local', uid: 'unmeasured' };
export const shared = (cause: string): IsolationRead => ({ kind: 'measured', word: 'shared-user', cause } as IsolationRead);
export const blind = (why: string): IsolationRead => ({ kind: 'unmeasured', why } as IsolationRead);
export const SEPARATE: IsolationRead = { kind: 'measured', word: 'separate-user', cause: 'other-user' };
/** The one cell that widens: a local peer whose kernel uid is the third user's, a report that agrees, every fact measured. */
export const WIDE = ready(local(THIRD_UID), report(THIRD_UID));

const eq = (a: unknown, b: unknown): void => { expect(a).toEqual(b); };

// ------------------------------------------------------------------------------------------------ the generated domain

const LOCALITIES = ['local', 'not-local', 'unmeasured'] as const;
const UIDS: readonly Measured<number>[] = [SERVER_UID, OWNER_UID, 0, THIRD_UID, OVERFLOW_UID, 'unmeasured'];
const DIGESTS = (own: string, other: string): readonly Measured<string>[] => [own, other, 'unmeasured'];
const HOLDING_SETS = [HOLDINGS.owned, HOLDINGS.exposed, HOLDINGS.blind] as const;

export interface Cell { readonly peer: PeerFacts; readonly report: HostReport | 'absent' | 'malformed'; readonly holdings: readonly Holding[] }
/** The attacker's domain (ruled, F5): peer locality × peer uid × the report × the holdings. */
export function domain(): Cell[] {
  const reports: (HostReport | 'absent' | 'malformed')[] = ['absent', 'malformed'];
  for (const uid of UIDS) for (const machine of DIGESTS(SD.machine as string, OTHER.machine)) for (const boot of DIGESTS(SD.boot as string, OTHER.boot)) {
    reports.push(report(uid, machine, boot));
  }
  const cells: Cell[] = [];
  for (const locality of LOCALITIES) for (const uid of UIDS) for (const rep of reports) for (const holdings of HOLDING_SETS) {
    cells.push({ peer: { locality, uid: locality === 'local' ? uid : 'unmeasured' }, report: rep, holdings });
  }
  return cells;
}
const cellLink = (c: Cell): LinkFacts => ready(c.peer, c.report);
/** The cells question 10 names, and only those, read `separate-user`. */
export function widens(c: Cell): boolean {
  if (c.peer.locality !== 'local' || c.peer.uid !== THIRD_UID || c.holdings !== HOLDINGS.owned) return false;
  if (typeof c.report !== 'object' || c.report.uid !== THIRD_UID) return false;
  const forwarded = c.report.machine === OTHER.machine && c.report.boot === OTHER.boot;
  const agrees = c.report.machine === SD.machine || c.report.boot === SD.boot;
  return !forwarded && agrees;
}
/** Each way of replacing one fact of a cell with `unmeasured`, or the report with `absent`. */
export function blinded(c: Cell): Cell[] {
  const out: Cell[] = [
    { ...c, peer: { locality: 'unmeasured', uid: 'unmeasured' } },
    { ...c, peer: { ...c.peer, uid: 'unmeasured' } },
    { ...c, report: 'absent' },
    { ...c, holdings: HOLDINGS.blind },
  ];
  if (typeof c.report === 'object') {
    for (const k of ['uid', 'machine', 'boot'] as const) out.push({ ...c, report: { ...c.report, [k]: 'unmeasured' } });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------- suites

export function holdingExposureSuite(mod: Pick<WordModule, 'holdingExposure'>): Record<string, SuiteCase> {
  const f = (uid: number, mode: number, dir = true, onResolvedPath = true): PathStat => ({ uid, mode, dir, onResolvedPath });
  const lnk = (uid: number): PathStat => ({ uid, mode: 0o777, dir: false, link: true, onResolvedPath: false });
  const chain = (elements: Measured<readonly PathStat[]>, concern: 'secret' | 'control' = 'secret', uid: Measured<number> = SERVER_UID) =>
    mod.holdingExposure({ name: 'x', concern, elements }, uid);
  return {
    'an owner-only leaf owned by the server': () => eq(chain([f(SERVER_UID, 0o600, false), f(SERVER_UID, 0o755), f(0, 0o755)]), { name: 'x', owners: [], exposure: 'owner-only' }),
    'an owner-only ancestor owned by the server guards a 0644 leaf': () => eq(chain([f(SERVER_UID, 0o644, false), f(SERVER_UID, 0o700), f(0, 0o755)]).exposure, 'owner-only'),
    'an owner-only ancestor owned by root guards': () => eq(chain([f(SERVER_UID, 0o644, false), f(0, 0o700)]).exposure, 'owner-only'),
    'an owner-only element owned by a third user does not guard': () => eq(chain([f(SERVER_UID, 0o644, false), f(THIRD_UID, 0o700)]).exposure, 'exposed'),
    'a 0755 chain is read-exposed for a secret': () => eq(chain([f(SERVER_UID, 0o755), f(SERVER_UID, 0o755), f(0, 0o755)]).exposure, 'exposed'),
    'a group-readable chain is read-exposed for a secret': () => eq(chain([f(SERVER_UID, 0o640, false), f(SERVER_UID, 0o750), f(0, 0o755)]).exposure, 'exposed'),
    'a 0755 chain is not exposed for a control path': () => eq(chain([f(SERVER_UID, 0o755), f(0, 0o755)], 'control').exposure, 'owner-only'),
    'a group-writable directory without the sticky bit is exposed': () => eq(chain([f(SERVER_UID, 0o700), f(SERVER_UID, 0o775)], 'control').exposure, 'exposed'),
    'an others-writable directory without the sticky bit is exposed': () => eq(chain([f(SERVER_UID, 0o700), f(0, 0o757)], 'control').exposure, 'exposed'),
    'a sticky world-writable directory above an owner-only leaf is not': () => eq(chain([f(SERVER_UID, 0o700), f(0, 0o1777)]).exposure, 'owner-only'),
    'a leaf writable by others is exposed, sticky or not': () => {
      eq(chain([f(SERVER_UID, 0o602, false), f(SERVER_UID, 0o700)]).exposure, 'exposed');
      eq(chain([f(SERVER_UID, 0o1777), f(SERVER_UID, 0o700)], 'control').exposure, 'exposed');
    },
    'a leaf writable by its group is exposed': () => eq(chain([f(SERVER_UID, 0o620, false), f(SERVER_UID, 0o700)], 'control').exposure, 'exposed'),
    'a third-user ancestor is among the owners, root and the server are not': () =>
      eq(chain([f(SERVER_UID, 0o600, false), f(OWNER_UID, 0o755), f(0, 0o755)]).owners, [OWNER_UID]),
    'owners are listed once': () => eq(chain([f(OWNER_UID, 0o600, false), f(OWNER_UID, 0o700)]).owners, [OWNER_UID]),
    'an unreadable element reads the holding unmeasured': () => eq(chain('unmeasured'), { name: 'x', owners: 'unmeasured', exposure: 'unmeasured' }),
    'an empty chain reads unmeasured': () => eq(chain([]).exposure, 'unmeasured'),
    "a link's own mode grants nothing: an owner-only chain through a link stays owner-only": () =>
      eq(chain([f(SERVER_UID, 0o600, false), lnk(SERVER_UID), f(SERVER_UID, 0o700), f(0, 0o755)]), { name: 'x', owners: [], exposure: 'owner-only' }),
    "a link's owner is among the owners": () =>
      eq(chain([f(SERVER_UID, 0o600, false), lnk(OWNER_UID), f(0, 0o1777)]).owners, [OWNER_UID]),
    'a link is never the guard of a secret': () => eq(chain([f(SERVER_UID, 0o644, false), { ...lnk(SERVER_UID), mode: 0o700 }, f(0, 0o755)]).exposure, 'exposed'),
    'a chain of links only reads unmeasured': () => eq(chain([lnk(SERVER_UID)], 'control').exposure, 'unmeasured'),
    'a directory outside the resolved ancestry cannot guard a secret': () =>
      eq(chain([f(SERVER_UID, 0o644, false), f(SERVER_UID, 0o700, true, false), f(0, 0o755)]).exposure, 'exposed'),
    'an unmeasured server uid cannot prove a server-owned guard': () => {
      eq(chain([f(SERVER_UID, 0o600, false), f(SERVER_UID, 0o755)], 'secret', 'unmeasured').exposure, 'unmeasured');
      eq(chain([f(SERVER_UID, 0o600, false), f(0, 0o700)], 'secret', 'unmeasured').exposure, 'owner-only');
      eq(chain([f(SERVER_UID, 0o600, false)], 'secret', 'unmeasured').owners, [SERVER_UID]);
    },
    'a measured exposed path remains exposed even with an unmeasured server uid': () =>
      eq(chain([f(SERVER_UID, 0o644, false), f(SERVER_UID, 0o700, true, false), f(0, 0o755)], 'secret', 'unmeasured').exposure, 'exposed'),
  };
}

export function linkKernelSuite(mod: Pick<WordModule, 'linkKernel'>): Record<string, SuiteCase> {
  const k = (peer: PeerFacts, rep: HostReport | 'absent' | 'malformed') => mod.linkKernel(ready(peer, rep) as Extract<LinkFacts, { link: 'ready' }>);
  return {
    'a local peer is one kernel': () => { eq(k(local(THIRD_UID), 'absent'), 'same'); eq(k(local('unmeasured'), report(1)), 'same'); },
    'a local peer whose two digests both differ is a forward': () => eq(k(local(THIRD_UID), report(1, OTHER.machine, OTHER.boot)), 'forwarded'),
    'one differing digest is not a forward': () => {
      eq(k(local(THIRD_UID), report(1, OTHER.machine, SD.boot)), 'same');
      eq(k(local(THIRD_UID), report(1, OTHER.machine, 'unmeasured')), 'same');
      eq(k(local(THIRD_UID), report(1, 'unmeasured', OTHER.boot)), 'same');
    },
    'an equal digest makes a non-local peer one kernel': () => {
      eq(k(notLocal, report(1, SD.machine, OTHER.boot)), 'same');
      eq(k(notLocal, report(1, OTHER.machine, SD.boot)), 'same');
      eq(k({ locality: 'unmeasured', uid: 'unmeasured' }, report(1, SD.machine, 'unmeasured')), 'same');
    },
    'a non-local peer with no equal digest is unproven': () => {
      eq(k(notLocal, report(1, OTHER.machine, OTHER.boot)), 'unproven');
      eq(k(notLocal, report(1, 'unmeasured', 'unmeasured')), 'unproven');
      eq(k(notLocal, 'absent'), 'unproven');
    },
    'an unmeasured locality with no equal digest is unmeasured': () => eq(k({ locality: 'unmeasured', uid: 'unmeasured' }, report(1, OTHER.machine, OTHER.boot)), 'unmeasured'),
    'an unmeasured server digest is never equal': () =>
      eq(mod.linkKernel({ link: 'ready', report: report(1, 'unmeasured', 'unmeasured'), peer: notLocal, serverDigests: { machine: 'unmeasured', boot: 'unmeasured' }, readySerial: 1 }), 'unproven'),
  };
}

export function linkIsolationSuite(mod: Pick<WordModule, 'linkIsolation'>): Record<string, SuiteCase> {
  const v = (link: LinkFacts, s = server()) => mod.linkIsolation(s, link);
  return {
    'no ready since boot, and a link that is down': () => { eq(v({ link: 'none' }), blind('no-agent')); eq(v({ link: 'down' }), blind('link-down')); },
    'the one widening': () => eq(v(WIDE), SEPARATE),
    // F1 (ruled): no other kernel is proven in W1.
    'F1: a container at its bridge address forging both digests different': () => eq(v(ready(notLocal, report(THIRD_UID, OTHER.machine, OTHER.boot))), blind('kernel-unproven')),
    'F1: a NAT or hairpin peer reporting nothing of its kernel': () => eq(v(ready(notLocal, report(THIRD_UID, 'unmeasured', 'unmeasured'))), blind('kernel-unproven')),
    'F1: an AnyIP address routed to this host but on no interface': () => eq(v(ready(notLocal, report(THIRD_UID, OTHER.machine, 'unmeasured'))), blind('kernel-unproven')),
    'F1: a non-local proxy in front of an agent reporting both local digests': () => eq(v(ready(notLocal, report(THIRD_UID))), blind('other-namespace')),
    'an older agent at a non-local peer, and a malformed one': () => {
      eq(v(ready(notLocal, 'absent')), blind('agent-older')); eq(v(ready(notLocal, 'malformed')), blind('report-malformed'));
    },
    'an unmeasured locality with no equal digest': () => eq(v(ready({ locality: 'unmeasured', uid: 'unmeasured' }, report(THIRD_UID, OTHER.machine, OTHER.boot))), blind('host-unmeasured')),
    // F9 (ruled): a same-user forward reads unmeasured, before any narrowing.
    'F9: a same-user forward to an agent reporting another kernel': () => {
      eq(v(ready(local(SERVER_UID), report(SERVER_UID, OTHER.machine, OTHER.boot))), blind('forwarded'));
      // Before any narrowing, an exposed holding included.
      eq(v(ready(local(SERVER_UID), report(SERVER_UID, OTHER.machine, OTHER.boot)), server({ holdings: HOLDINGS.exposed })), blind('forwarded'));
    },
    'narrowing: an exposed holding first': () => eq(v(ready(local(0), report(0)), server({ holdings: HOLDINGS.exposed })), shared('store-mode')),
    'narrowing: a root peer or a root report': () => {
      eq(v(ready(local(0), report(THIRD_UID))), shared('root-agent'));
      eq(v(ready(local(THIRD_UID), report(0))), shared('root-agent'));
    },
    // F2 (ruled): a reported overflow uid with a real peer uid 0 is root.
    'F2: a reported 65534 with a real peer uid 0 reads root-agent': () => eq(v(ready(local(0), report(OVERFLOW_UID))), shared('root-agent')),
    "narrowing: the server's uid on either side": () => {
      eq(v(ready(local(SERVER_UID), report(THIRD_UID))), shared('same-user'));
      eq(v(ready(local(THIRD_UID), report(SERVER_UID))), shared('same-user'));
    },
    'narrowing: root before same-user before store-owner': () => {
      eq(v(ready(local(SERVER_UID), report(0))), shared('root-agent'));
      eq(v(ready(local(OWNER_UID), report(SERVER_UID))), shared('same-user'));
    },
    "narrowing: a held path's owner": () => eq(v(ready(local(OWNER_UID), report(OWNER_UID))), shared('store-owner')),
    'a narrowing fact needs one side only: an older agent at a local peer': () => {
      eq(v(ready(local(SERVER_UID), 'absent')), shared('same-user'));
      eq(v(ready(local(THIRD_UID), 'absent')), blind('agent-older'));
      eq(v(ready(local(THIRD_UID), 'malformed')), blind('report-malformed'));
    },
    'a non-local peer narrows only by the report': () => {
      eq(v(ready(notLocal, report(SERVER_UID, SD.machine, OTHER.boot))), shared('same-user'));
      eq(v(ready(notLocal, report(THIRD_UID, SD.machine, OTHER.boot))), blind('other-namespace'));
    },
    'one kernel at an unmeasured locality, no narrowing': () => eq(v(ready({ locality: 'unmeasured', uid: 'unmeasured' }, report(THIRD_UID))), blind('host-unmeasured')),
    'the peer uid unmeasured, or the overflow uid': () => {
      eq(v(ready(local('unmeasured'), report(THIRD_UID))), blind('peer-uid-unmeasured'));
      eq(v(ready(local(OVERFLOW_UID), report(OVERFLOW_UID))), blind('peer-uid-overflow'));
    },
    // F2 (ruled): a third-user forwarder in front of an honest agent.
    'F2: a third-user forwarder in front of an honest agent reads report-disagrees': () => eq(v(ready(local(4000), report(THIRD_UID))), blind('report-disagrees')),
    'the reported uid unmeasured disagrees': () => eq(v(ready(local(THIRD_UID), report('unmeasured'))), blind('report-disagrees')),
    // Question 10's stated residual, pinned by name so any change is seen.
    "the residual of question 10: a third-user forwarder with a report forged to its uid reads separate-user": () =>
      eq(v(ready(local(4000), report(4000))), SEPARATE),
    'no measured digest equal: the report does not agree the kernel is one': () => {
      eq(v(ready(local(THIRD_UID), report(THIRD_UID, 'unmeasured', 'unmeasured'))), blind('host-unmeasured'));
      eq(v(ready(local(THIRD_UID), report(THIRD_UID, OTHER.machine, 'unmeasured'))), blind('host-unmeasured'));
      eq(v(ready(local(THIRD_UID), report(THIRD_UID, OTHER.machine, SD.boot))), SEPARATE);
      eq(v(ready(local(THIRD_UID), report(THIRD_UID, SD.machine, OTHER.boot))), SEPARATE);
    },
    'F2: the server in a user namespace': () => eq(v(WIDE, server({ initialNamespace: false })), blind('server-namespace')),
    'a server fact unmeasured blocks the widening': () => {
      eq(v(WIDE, server({ initialNamespace: 'unmeasured' })), blind('server-facts'));
      eq(v(WIDE, server({ uid: 'unmeasured' })), blind('server-facts'));
      eq(v(WIDE, server({ overflowUid: 'unmeasured' })), blind('server-facts'));
      eq(v(WIDE, server({ holdings: HOLDINGS.blind })), blind('server-facts'));
      eq(v(WIDE, server({ holdings: [{ name: 'x', owners: [], exposure: 'unmeasured' }] })), blind('server-facts'));
      eq(v(WIDE, server({ holdings: [{ name: 'x', owners: 'unmeasured', exposure: 'owner-only' }] })), blind('server-facts'));
    },
    'an unmeasured holding narrows nothing': () => eq(v(ready(local(THIRD_UID), report(THIRD_UID)), server({ holdings: HOLDINGS.blind })), blind('server-facts')),
    'the generated domain: only question 10 widens, nothing reads separate-host': () => {
      for (const c of domain()) {
        const r = v(cellLink(c), server({ holdings: c.holdings }));
        if (r.kind === 'measured' && r.word === 'separate-host') throw new Error(`separate-host at ${JSON.stringify(c)}`);
        const wide = r.kind === 'measured' && r.word === 'separate-user';
        if (wide !== widens(c)) throw new Error(`separate-user ${wide} at ${JSON.stringify(c)}`);
      }
    },
    'monotonic: blinding any fact never widens': () => {
      for (const c of domain()) {
        const r = v(cellLink(c), server({ holdings: c.holdings }));
        if (r.kind === 'measured' && r.word === 'separate-user') continue;
        for (const b of blinded(c)) {
          const rb = v(cellLink(b), server({ holdings: b.holdings }));
          if (rb.kind === 'measured' && rb.word !== 'shared-user') throw new Error(`widened to ${rb.word} at ${JSON.stringify(b)} from ${JSON.stringify(c)}`);
        }
      }
    },
  };
}

export function isolationWordSuite(mod: Pick<WordModule, 'isolationWord'>): Record<string, SuiteCase> {
  const SU = ready(local(SERVER_UID), report(SERVER_UID));
  return {
    'local mode reads shared-user, local-mode, whatever it is given': () => {
      eq(mod.isolationWord('local', server(), []), shared('local-mode'));
      eq(mod.isolationWord('local', server(), [WIDE, WIDE]), shared('local-mode'));
      eq(mod.isolationWord('local', server({ uid: 'unmeasured', holdings: HOLDINGS.blind }), [{ link: 'down' }]), shared('local-mode'));
    },
    'remote mode with no link reads no-agent': () => eq(mod.isolationWord('remote', server(), []), blind('no-agent')),
    'one link is its own verdict': () => { eq(mod.isolationWord('remote', server(), [WIDE]), SEPARATE); eq(mod.isolationWord('remote', server(), [{ link: 'none' }]), blind('no-agent')); },
    'one shared-user link of two wins, in either order': () => {
      eq(mod.isolationWord('remote', server(), [WIDE, SU]), shared('same-user'));
      eq(mod.isolationWord('remote', server(), [SU, { link: 'down' }]), shared('same-user'));
      eq(mod.isolationWord('remote', server(), [{ link: 'down' }, SU]), shared('same-user'));
    },
    'one unmeasured link of two separate ones wins': () => {
      eq(mod.isolationWord('remote', server(), [WIDE, { link: 'down' }, WIDE]), blind('link-down'));
      eq(mod.isolationWord('remote', server(), [WIDE, WIDE]), SEPARATE);
    },
    'the first shared-user cause and the first unmeasured reason, in link order': () => {
      eq(mod.isolationWord('remote', server(), [ready(local(0), report(0)), SU]), shared('root-agent'));
      eq(mod.isolationWord('remote', server(), [{ link: 'down' }, { link: 'none' }]), blind('link-down'));
    },
  };
}

export function hostRelationSuite(mod: Pick<WordModule, 'hostRelation'>): Record<string, SuiteCase> {
  return {
    'a ready link on this kernel is same-host': () => {
      eq(mod.hostRelation(WIDE), 'same-host');
      eq(mod.hostRelation(ready(notLocal, report(1, SD.machine, OTHER.boot))), 'same-host');
    },
    'a forward, an unproven or unmeasured kernel, and no link are unmeasured': () => {
      eq(mod.hostRelation(ready(local(1), report(1, OTHER.machine, OTHER.boot))), 'unmeasured');
      eq(mod.hostRelation(ready(notLocal, report(1, OTHER.machine, OTHER.boot))), 'unmeasured');
      eq(mod.hostRelation(ready({ locality: 'unmeasured', uid: 'unmeasured' }, 'absent')), 'unmeasured');
      eq(mod.hostRelation({ link: 'none' }), 'unmeasured');
      eq(mod.hostRelation({ link: 'down' }), 'unmeasured');
    },
    'no cell of the domain, nor any blinding of one, yields other-host': () => {
      for (const c of domain()) for (const b of [c, ...blinded(c)]) {
        if (mod.hostRelation(cellLink(b)) === 'other-host') throw new Error(`other-host at ${JSON.stringify(b)}`);
      }
    },
  };
}

export function isolationConditionSuite(mod: Pick<WordModule, 'isolationCondition'>): Record<string, SuiteCase> {
  return {
    'shared-user stands': () => { eq(mod.isolationCondition(shared('store-mode')), 'standing'); eq(mod.isolationCondition(shared('local-mode')), 'standing'); },
    'a separate word lifts': () => {
      eq(mod.isolationCondition(SEPARATE), 'lifted');
      eq(mod.isolationCondition({ kind: 'measured', word: 'separate-host', cause: 'other-host' }), 'lifted');
    },
    'unmeasured is unmeasured, never lifted': () => { eq(mod.isolationCondition(blind('not-wired')), 'unmeasured'); eq(mod.isolationCondition(blind('link-down')), 'unmeasured'); },
  };
}

export function wakingHostKeySuite(mod: Pick<WordModule, 'wakingHostKey'>): Record<string, SuiteCase> {
  const D = 'f'.repeat(64);
  return {
    'local mode: the boot-keyed digest at epoch 0, whatever the link': () => {
      eq(mod.wakingHostKey('local', D, null), { digest: D, keyEpoch: 0 });
      eq(mod.wakingHostKey('local', D, WIDE), { digest: D, keyEpoch: 0 });
      eq(mod.wakingHostKey('local', 'unmeasured', null), 'unmeasured');
    },
    "remote mode: the ready link's machine digest at its ready serial": () => {
      eq(mod.wakingHostKey('remote', D, ready(local(1), report(1, OTHER.machine, 'unmeasured'), 7)), { digest: OTHER.machine, keyEpoch: 7 });
    },
    'two ready serials never compare': () => {
      const a = mod.wakingHostKey('remote', D, ready(local(1), report(1), 1));
      const b = mod.wakingHostKey('remote', D, ready(local(1), report(1), 2));
      expect(a).not.toEqual(b);
    },
    'remote mode: no link, a link down, no report or no machine digest is unmeasured': () => {
      eq(mod.wakingHostKey('remote', D, null), 'unmeasured');
      eq(mod.wakingHostKey('remote', D, { link: 'down' }), 'unmeasured');
      eq(mod.wakingHostKey('remote', D, { link: 'none' }), 'unmeasured');
      eq(mod.wakingHostKey('remote', D, ready(local(1), 'absent')), 'unmeasured');
      eq(mod.wakingHostKey('remote', D, ready(local(1), 'malformed')), 'unmeasured');
      eq(mod.wakingHostKey('remote', D, ready(local(1), report(1, 'unmeasured', SD.boot))), 'unmeasured');
    },
  };
}

export function readHostReportSuite(mod: Pick<SharedModule, 'readHostReport'>): Record<string, SuiteCase> {
  const good = { uid: 2000, machine: SD.machine, boot: SD.boot };
  return {
    absent: () => eq(mod.readHostReport(undefined), 'absent'),
    'well formed, and unmeasured in each field': () => {
      eq(mod.readHostReport(good), good);
      eq(mod.readHostReport({ uid: 0, machine: 'unmeasured', boot: 'unmeasured' }), { uid: 0, machine: 'unmeasured', boot: 'unmeasured' });
      eq(mod.readHostReport({ ...good, uid: 'unmeasured' }), { ...good, uid: 'unmeasured' });
    },
    'an extra key is ignored': () => eq(mod.readHostReport({ ...good, x: 1 }), good),
    'not an object': () => { for (const raw of [null, 'x', 7, [1, 2, 3], Object.assign([], good)]) eq(mod.readHostReport(raw), 'malformed'); },
    'a known key missing': () => { eq(mod.readHostReport({ machine: SD.machine, boot: SD.boot }), 'malformed'); eq(mod.readHostReport({ uid: 1, boot: SD.boot }), 'malformed'); eq(mod.readHostReport({ uid: 1, machine: SD.machine }), 'malformed'); },
    'a bad uid': () => { for (const uid of [-1, 1.5, '2000', 2 ** 53, 'unknown']) eq(mod.readHostReport({ ...good, uid }), 'malformed'); },
    'a bad digest': () => {
      for (const d of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 7, 'unknown']) {
        eq(mod.readHostReport({ ...good, machine: d }), 'malformed');
        eq(mod.readHostReport({ ...good, boot: d }), 'malformed');
      }
    },
  };
}

// --------------------------------------------------------------------------------------------------------- mutant sets

const set = <M>(modulePath: string, mutants: { id: string; old: string; new: string }[], suite: (mod: M) => Record<string, SuiteCase>): MutantSet<never> =>
  ({ modulePath, mutants, suite } as unknown as MutantSet<never>);

export const ISOLATION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'shared/isolation.ts#readHostReport': set<SharedModule>(SHARED_TS, [
    { id: 'R1 absent is malformed', old: "if (raw === undefined) return 'absent';", new: '' },
    { id: 'R2 arrays pass', old: ' || Array.isArray(raw)) return', new: ') return' },
    { id: 'R3 negative uid', old: 'Number.isSafeInteger(v) && v >= 0', new: 'Number.isSafeInteger(v)' },
    { id: 'R4 fractional uid', old: "(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)", new: "(typeof v === 'number' && v >= 0)" },
    { id: 'R5 63-hex digest', old: 'export const HOST_DIGEST_RE = /^[0-9a-f]{64}$/;', new: 'export const HOST_DIGEST_RE = /^[0-9a-f]{63,64}$/;' },
    { id: 'R6 missing key reads unmeasured', old: "v === 'unmeasured' || (typeof v === 'string'", new: "v === 'unmeasured' || v === undefined || (typeof v === 'string'" },
    { id: 'R7 extra keys kept', old: 'return { uid, machine, boot };', new: 'return { ...r, uid, machine, boot } as HostReport;' },
    { id: 'R8 boot unchecked', old: '|| !measuredDigest(boot)', new: '' },
  ], readHostReportSuite),
  'server/src/isolationWord.ts#holdingExposure': set<WordModule>(WORD_TS, [
    { id: 'H1 unmeasured chain reads owner-only', old: "if (elements === 'unmeasured') return { name, owners: 'unmeasured', exposure: 'unmeasured' };", new: "if (elements === 'unmeasured') return { name, owners: [], exposure: 'owner-only' };" },
    { id: 'H2 root counted as owner', old: 'u !== 0 && u !== serverUid', new: 'u !== serverUid' },
    { id: 'H3 server counted as owner', old: 'u !== 0 && u !== serverUid', new: 'u !== 0' },
    { id: 'H4 sticky excuses the leaf', old: '(i === 0 || (e.mode & STICKY) === 0)', new: '(e.mode & STICKY) === 0' },
    { id: 'H5 sticky ignored', old: '(i === 0 || (e.mode & STICKY) === 0)', new: 'true' },
    { id: 'H6 group write ignored', old: 'const GROUP_OTHER_WRITE = 0o022;', new: 'const GROUP_OTHER_WRITE = 0o002;' },
    { id: 'H7 control read-checked', old: "if (chain.concern === 'control') return { name, owners, exposure: 'owner-only' };", new: '' },
    { id: 'H8 group read ignored', old: 'const GROUP_OTHER_ANY = 0o077;', new: 'const GROUP_OTHER_ANY = 0o007;' },
    { id: 'H9 any owner guards', old: '(e.uid === 0 || e.uid === serverUid)', new: 'true' },
    { id: 'H10 root does not guard', old: '(e.uid === 0 || e.uid === serverUid)', new: '(e.uid === serverUid)' },
    { id: 'H11 unmeasured server reads exposed', old: "exposure: serverUid === 'unmeasured' && guardCandidates.length > 0 ? 'unmeasured' : 'exposed'", new: "exposure: 'exposed'" },
    { id: 'H12 unmeasured server reads owner-only', old: "guardCandidates.length > 0 ? 'unmeasured' : 'exposed'", new: "guardCandidates.length > 0 ? 'owner-only' : 'exposed'" },
    { id: "H13 a link's mode read", old: 'const dirs = elements.filter((e) => e.link !== true);', new: 'const dirs = elements;' },
    { id: "H14 a link's owner dropped", old: 'const owners = [...new Set(elements.map(', new: 'const owners = [...new Set(elements.filter((e) => e.link !== true).map(' },
    { id: 'H15 a links-only chain measured', old: "if (dirs.length === 0) return { name, owners: 'unmeasured', exposure: 'unmeasured' };", new: '' },
    { id: 'H16 a directory only visited can guard', old: 'e.onResolvedPath && (e.mode & GROUP_OTHER_ANY) === 0', new: '(e.mode & GROUP_OTHER_ANY) === 0' },
    { id: 'H17 unmeasured uid hides measured exposure', old: "serverUid === 'unmeasured' && guardCandidates.length > 0 ?", new: "serverUid === 'unmeasured' ?" },
  ], holdingExposureSuite),
  'server/src/isolationWord.ts#linkKernel': set<WordModule>(WORD_TS, [
    { id: 'K1 one differing digest forwards', old: "differMeasured(report.machine, s.machine) && differMeasured(report.boot, s.boot) ? 'forwarded'", new: "(differMeasured(report.machine, s.machine) || differMeasured(report.boot, s.boot)) ? 'forwarded'" },
    { id: 'K2 no forward', old: "? 'forwarded' : 'same';", new: "? 'same' : 'same';" },
    { id: 'K3 machine equality ignored', old: '(equalMeasured(report.machine, s.machine) || equalMeasured(report.boot, s.boot))) return', new: '(equalMeasured(report.boot, s.boot))) return' },
    { id: 'K4 boot equality ignored', old: '(equalMeasured(report.machine, s.machine) || equalMeasured(report.boot, s.boot))) return', new: '(equalMeasured(report.machine, s.machine))) return' },
    { id: 'K5 unmeasured equal', old: "const equalMeasured = (a: Measured<string>, b: Measured<string>): boolean => a !== 'unmeasured' && b !== 'unmeasured' && a === b;", new: 'const equalMeasured = (a: Measured<string>, b: Measured<string>): boolean => a === b;' },
    { id: 'K6 not-local is unmeasured', old: "if (peer.locality === 'not-local') return 'unproven';", new: '' },
    { id: 'K7 unmeasured locality is unproven', old: "  return 'unmeasured';\n}\n\nconst unmeasured", new: "  return 'unproven';\n}\n\nconst unmeasured" },
  ], linkKernelSuite),
  'server/src/isolationWord.ts#linkIsolation': set<WordModule>(WORD_TS, [
    { id: 'I1 down reads no-agent', old: "if (link.link === 'down') return unmeasured('link-down');", new: "if (link.link === 'down') return unmeasured('no-agent');" },
    { id: 'I2 a non-local peer widens (separate-host)', old: "return unmeasured(kernel === 'unproven' ? 'kernel-unproven' : 'host-unmeasured');", new: "return kernel === 'unproven' ? { kind: 'measured', word: 'separate-host', cause: 'other-host' } : unmeasured('host-unmeasured');" },
    { id: 'I3 forward narrows first', old: "  if (kernel === 'forwarded') return unmeasured('forwarded');\n", new: '' },
    { id: 'I4 report kind unread off-kernel', old: "    if (report === 'absent') return unmeasured('agent-older');\n    if (report === 'malformed') return unmeasured('report-malformed');\n    return unmeasured(kernel", new: '    return unmeasured(kernel' },
    { id: 'I5 exposed holding ignored', old: "if (server.holdings.some((h) => h.exposure === 'exposed')) return sharedUser('store-mode');", new: '' },
    { id: 'I6 peer uid ignored', old: "if (peer.locality === 'local' && peer.uid !== 'unmeasured') uids.push(peer.uid);", new: '' },
    { id: 'I7 reported uid ignored', old: "if (typeof report === 'object' && report.uid !== 'unmeasured') uids.push(report.uid);", new: '' },
    { id: 'I8 root ignored', old: "if (uids.includes(0)) return sharedUser('root-agent');", new: '' },
    { id: 'I9 same user ignored', old: "if (server.uid !== 'unmeasured' && uids.includes(server.uid)) return sharedUser('same-user');", new: '' },
    { id: 'I10 store owner ignored', old: "if (server.holdings.some((h) => h.owners !== 'unmeasured' && h.owners.some((o) => uids.includes(o)))) return sharedUser('store-owner');", new: '' },
    { id: 'I11 other namespace widens', old: "if (peer.locality === 'not-local') return unmeasured('other-namespace');", new: '' },
    { id: 'I12 unmeasured locality widens', old: "if (peer.locality === 'unmeasured') return unmeasured('host-unmeasured');", new: '' },
    { id: 'I13 peer uid unmeasured passes', old: "if (peer.uid === 'unmeasured') return unmeasured('peer-uid-unmeasured');", new: '' },
    { id: 'I14 overflow check dropped', old: "if (server.overflowUid !== 'unmeasured' && peer.uid === server.overflowUid) return unmeasured('peer-uid-overflow');", new: '' },
    { id: 'I15 report disagreement ignored', old: "if (report.uid === 'unmeasured' || report.uid !== peer.uid) return unmeasured('report-disagrees');", new: '' },
    { id: 'I16 unmeasured reported uid agrees', old: "if (report.uid === 'unmeasured' || report.uid !== peer.uid)", new: 'if (report.uid !== peer.uid && report.uid !== \'unmeasured\')' },
    { id: 'I17 no equal digest needed', old: "    return unmeasured('host-unmeasured');\n  }\n  if (server.initialNamespace === false)", new: "  }\n  if (server.initialNamespace === false)" },
    { id: 'I18 namespace ignored', old: "if (server.initialNamespace === false) return unmeasured('server-namespace');", new: '' },
    { id: 'I19 server facts ignored', old: "|| server.holdings.some((h) => h.owners === 'unmeasured' || h.exposure === 'unmeasured')) return unmeasured('server-facts');", new: ") return unmeasured('server-facts');" },
    { id: 'I20 narrowing after the forward check is moved before', old: "  if (kernel === 'forwarded') return unmeasured('forwarded');\n", new: "  if (kernel === 'forwarded' && !server.holdings.some((h) => h.exposure === 'exposed')) return unmeasured('forwarded');\n" },
    { id: 'I21 overflow uid unmeasured passes', old: "|| server.overflowUid === 'unmeasured'\n", new: '\n' },
  ], linkIsolationSuite),
  'server/src/isolationWord.ts#isolationWord': set<WordModule>(WORD_TS, [
    { id: 'W1 local mode folds the links', old: "if (mode === 'local') return sharedUser('local-mode');", new: "if (mode === 'local' && links.length === 0) return sharedUser('local-mode');" },
    { id: 'W2 empty is separate', old: "if (links.length === 0) return unmeasured('no-agent');", new: '' },
    { id: 'W3 unmeasured before shared', old: "  if (shared !== undefined) return shared;\n  const blind", new: "  const blind" },
    { id: 'W4 unmeasured folds as lifted', old: '  if (blind !== undefined) return blind;\n', new: '' },
    { id: 'W5 last shared wins', old: "const shared = reads.find((r) => r.kind === 'measured' && r.word === 'shared-user');", new: "const shared = [...reads].reverse().find((r) => r.kind === 'measured' && r.word === 'shared-user');" },
    { id: 'W6 last unmeasured wins', old: "const blind = reads.find((r) => r.kind === 'unmeasured');", new: "const blind = [...reads].reverse().find((r) => r.kind === 'unmeasured');" },
  ], isolationWordSuite),
  'server/src/isolationWord.ts#hostRelation': set<WordModule>(WORD_TS, [
    { id: 'E1 every ready link same-host', old: "return link.link === 'ready' && linkKernel(link) === 'same' ? 'same-host' : 'unmeasured';", new: "return link.link === 'ready' ? 'same-host' : 'unmeasured';" },
    { id: 'E2 never same-host', old: "return link.link === 'ready' && linkKernel(link) === 'same' ? 'same-host' : 'unmeasured';", new: "return 'unmeasured';" },
    { id: 'E3 unproven is other-host', old: "return link.link === 'ready' && linkKernel(link) === 'same' ? 'same-host' : 'unmeasured';", new: "return link.link === 'ready' && linkKernel(link) === 'same' ? 'same-host' : link.link === 'ready' && linkKernel(link) === 'unproven' ? 'other-host' : 'unmeasured';" },
  ], hostRelationSuite),
  'server/src/isolationWord.ts#isolationCondition': set<WordModule>(WORD_TS, [
    { id: 'C1 unmeasured lifted', old: "if (read.kind === 'unmeasured') return 'unmeasured';", new: "if (read.kind === 'unmeasured') return 'lifted';" },
    { id: 'C2 unmeasured standing', old: "if (read.kind === 'unmeasured') return 'unmeasured';", new: "if (read.kind === 'unmeasured') return 'standing';" },
    { id: 'C3 every word stands', old: "return read.word === 'shared-user' ? 'standing' : 'lifted';", new: "return 'standing';" },
    { id: 'C4 every word lifts', old: "return read.word === 'shared-user' ? 'standing' : 'lifted';", new: "return 'lifted';" },
  ], isolationConditionSuite),
  'server/src/isolationWord.ts#wakingHostKey': set<WordModule>(WORD_TS, [
    { id: 'P1 local epoch from the link', old: "{ digest: localDigest, keyEpoch: 0 }", new: "{ digest: localDigest, keyEpoch: link !== null && link.link === 'ready' ? link.readySerial : 0 }" },
    { id: 'P2 local unmeasured digest kept', old: "return localDigest === 'unmeasured' ? 'unmeasured' : { digest", new: "return { digest" },
    { id: 'P3 remote epoch 0', old: 'return { digest: link.report.machine, keyEpoch: link.readySerial };', new: 'return { digest: link.report.machine, keyEpoch: 0 };' },
    { id: 'P4 remote boot digest', old: 'return { digest: link.report.machine, keyEpoch: link.readySerial };', new: "return { digest: link.report.boot as string, keyEpoch: link.readySerial };" },
    { id: 'P5 remote unmeasured machine kept', old: " || link.report.machine === 'unmeasured') return 'unmeasured';", new: ") return 'unmeasured';" },
    { id: 'P6 remote uses the local digest', old: "if (link === null || link.link !== 'ready' || typeof link.report !== 'object'", new: "if (localDigest !== 'unmeasured') return { digest: localDigest, keyEpoch: 0 };\n  if (link === null || link.link !== 'ready' || typeof link.report !== 'object'" },
  ], wakingHostKeySuite),
};
