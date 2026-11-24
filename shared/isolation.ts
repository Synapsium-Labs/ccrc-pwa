// The isolation word's vocabulary (Overlord W1, spec 2026-11-09 §7.4, H28), the agent's host report and its ONE reader.
// L0, context K: it imports nothing, because the PWA bundles it and the agent, the server and the board read it.
// Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-isolation.md`, Task 1.

const ISOLATION_WORD_MAP = {
  'shared-user': "the server's stores belong to, or can be reached by, the user fleet sessions run as (§7.4)",
  'separate-user': 'the sessions run on this kernel as another user, who cannot reach what the server holds',
  'separate-host': 'the sessions run on another kernel, proven by the server; never measured in W1',
} as const;
export type IsolationWord = keyof typeof ISOLATION_WORD_MAP;
export const ISOLATION_WORDS = Object.keys(ISOLATION_WORD_MAP) as IsolationWord[];

const ISOLATION_CAUSE_MAP = {
  'local-mode': 'no agent link: the server runs ccd itself, as its own user',
  'store-mode': 'a path the server holds is exposed to its group or others',
  'root-agent': 'the agent on this kernel runs as root',
  'same-user': "the agent on this kernel runs as the server's user",
  'store-owner': 'the agent on this kernel owns part of a path the server holds',
  'other-user': "the agent's own socket shows another user, and every held path is owner-only",
  'other-host': 'the agent runs on another kernel, proven by the server',
} as const;
export type IsolationCause = keyof typeof ISOLATION_CAUSE_MAP;
export const ISOLATION_CAUSES = Object.keys(ISOLATION_CAUSE_MAP) as IsolationCause[];

/** Why a reading is `unmeasured`. Every reader that acts treats `unmeasured` as `shared-user`; every reader that reports
 *  shows it as itself, with this reason (plan question 7, slug `isolation-unmeasured-reads-unmeasured`). */
const ISOLATION_UNMEASURED_MAP = {
  'no-agent': 'remote mode, and no agent link has gone ready since boot',
  'link-down': 'the agent link is down',
  'agent-older': 'the agent sent no host report',
  'report-malformed': "the agent's host report could not be read",
  'kernel-unproven': 'the peer is not on this host, and nothing proves another kernel',
  forwarded: 'the peer is local, but the agent reports another kernel: a forward',
  'host-unmeasured': 'neither side could measure whether the agent is on this kernel',
  'other-namespace': 'the agent shares this kernel from another network namespace',
  'peer-uid-unmeasured': "the uid of the link's peer socket could not be read",
  'peer-uid-overflow': "the peer socket's uid is the overflow uid, an unmapped user",
  'report-disagrees': "the agent's reported uid is not its socket's uid",
  'server-namespace': 'the server runs inside a user namespace',
  'server-facts': "the server's uid or a path it holds could not be measured",
  'not-wired': 'the reader is not wired',
} as const;
export type IsolationUnmeasured = keyof typeof ISOLATION_UNMEASURED_MAP;
export const ISOLATION_UNMEASURED = Object.keys(ISOLATION_UNMEASURED_MAP) as IsolationUnmeasured[];

/** The read every consumer takes: the board, the ladder's input, and W2's act rows. */
export type IsolationRead =
  | { readonly kind: 'measured'; readonly word: IsolationWord; readonly cause: IsolationCause }
  | { readonly kind: 'unmeasured'; readonly why: IsolationUnmeasured };

/** The witness's relation to one agent link (plan question 17). The authority journal's own type is this plus
 *  `'console'`. `other-host` is never answered in W1, because the server proves no other kernel (question 9). */
const AGENT_HOST_RELATION_MAP = {
  'same-host': 'the agent shares this kernel, by a local peer or an equal digest',
  'other-host': 'another kernel, proven by the server; never answered in W1',
  unmeasured: 'neither holds',
} as const;
export type AgentHostRelation = keyof typeof AGENT_HOST_RELATION_MAP;
export const AGENT_HOST_RELATIONS = Object.keys(AGENT_HOST_RELATION_MAP) as AgentHostRelation[];

/** A host digest: HMAC-SHA-256 under the link's bearer, of a kind tag and the value, as 64 lowercase hex. */
export const HOST_DIGEST_RE = /^[0-9a-f]{64}$/;

/** One measured fact: its value, or `'unmeasured'` (plan question 15, one representation per fact). */
export type Measured<T> = T | 'unmeasured';

/** `AgentReady.host`: what an agent measured of itself on connect. */
export interface HostReport {
  /** The agent process's own uid. */
  readonly uid: Measured<number>;
  /** `hostDigest(bearer, 'machine', the machine id)`. */
  readonly machine: Measured<string>;
  /** `hostDigest(bearer, 'boot', the kernel's boot id)`. */
  readonly boot: Measured<string>;
}

/** What the server measured of the link's peer socket, on the socket that delivered the ready. The address is
 *  compared and dropped: it is never stored here. */
export interface PeerFacts {
  readonly locality: Measured<'local' | 'not-local'>;
  /** The kernel's uid for the peer's socket, measured only when the peer is local. */
  readonly uid: Measured<number>;
}

const measuredUid = (v: unknown): v is Measured<number> =>
  v === 'unmeasured' || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
const measuredDigest = (v: unknown): v is Measured<string> =>
  v === 'unmeasured' || (typeof v === 'string' && HOST_DIGEST_RE.test(v));

/** THE ONE READER of `AgentReady.host`, called only by the client's ready handler. Absent: an older agent. Malformed: a
 *  known key missing or of the wrong type, a uid that is not a non-negative safe integer, or a digest off
 *  `HOST_DIGEST_RE`. Extra keys are ignored (additive). */
export function readHostReport(raw: unknown): HostReport | 'absent' | 'malformed' {
  if (raw === undefined) return 'absent';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'malformed';
  const r = raw as Record<string, unknown>;
  const { uid, machine, boot } = r;
  if (!measuredUid(uid) || !measuredDigest(machine) || !measuredDigest(boot)) return 'malformed';
  return { uid, machine, boot };
}
