// FLEET DISK RETENTION DR-19 (D-6631; spec 2026-10-23 section 2.3; resolves lifecycle policy Open Question 6). L1: PURE.
// The orphan-worktree lane's decisions, with no IO and no clock of its own. The lane asks `ccd ws-audit --orphans` for
// the linked worktrees no registry row names, audits the ones in a class it may remove, and removes a tree only when two
// audits of one UNCHANGED token stand at least `ORPHAN_LICENCE_MS` apart and the arming marker stands. Every doubt keeps
// the tree. The L3 executor (`coord/collectOrphanTree.ts`) asks ccd; the L4 driver (`orphanTreeSweep.ts`) holds the
// memory and the timer; neither decides anything this file decides.
import type { DiskOrphanTrees } from '../../shared/disk.js';
import { isRegistryId, type OrphanToken } from '../../shared/api.js';

/** The census runs this often, and hourly while the fleet is in pressure mode. */
export const ORPHAN_CENSUS_MS = 6 * 60 * 60 * 1000;
export const ORPHAN_CENSUS_PRESSURE_MS = 60 * 60 * 1000;
/** The licence: the second audit of one token is at least this long after the first. */
export const ORPHAN_LICENCE_MS = 60 * 60 * 1000;
/** Learning audits per pass, and under pressure. The act job is separate: at most one per pass fleet-wide. */
export const ORPHAN_AUDITS_PER_PASS = 2;
export const ORPHAN_AUDITS_PER_PASS_PRESSURE = 4;
/** A tree whose audit could not be measured, and an unreadable census, are asked again after this. A truncated census
 *  starts its back-off here (`orphanTruncatedWaitMs`). */
export const ORPHAN_RETRY_MS = 15 * 60 * 1000;
/** One lane-wide `KeyedQueue` key: every audit and act of the lane runs one at a time. */
export const ORPHAN_QUEUE_KEY = 'orphan-tree-lane';

/** The census's classes, as ccd prints them. `other` and `not-a-worktree` are reported and never audited. */
export const ORPHAN_CLASSES = ['ccd-root', 'claude', 'superpowers', 'other', 'not-a-worktree'] as const;
export type OrphanClass = (typeof ORPHAN_CLASSES)[number];
export const ORPHAN_AUDITED_CLASSES = ['ccd-root', 'claude', 'superpowers'] as const;
export type OrphanAuditedClass = (typeof ORPHAN_AUDITED_CLASSES)[number];
export const isAuditedClass = (c: OrphanClass): c is OrphanAuditedClass => (ORPHAN_AUDITED_CLASSES as readonly string[]).includes(c);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^(?:[0-9a-f]{2})+$/;
const TOKEN = /^[0-9a-f]{64}$/;

// ── what ccd answers ─────────────────────────────────────────────────────────

/** `inside` is the registry id of the workspace whose workdir CONTAINS the tree (DR-22, G4), else null. A ccd that does not
 *  print it reads as null: such a tree is never inside anything this lane knows. Whether that row is a workspace at all is
 *  decided by the server (`isWorkspace`, below): a plain session or main checkout has no reclaim or expiry exit. */
export interface OrphanRow { readonly hex: string; readonly cls: OrphanClass; readonly inside: string | null }
export type OrphanCensus =
  | { readonly kind: 'census'; readonly rows: readonly OrphanRow[]; readonly truncated: boolean }
  | { readonly kind: 'unreadable' };

/** `ws-audit --orphans`: one JSON document. One malformed row makes the whole census unreadable, because a half-read
 *  population is a population nobody measured. */
export function parseOrphanCensus(stdout: string): OrphanCensus {
  let doc: unknown;
  try { doc = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch { return { kind: 'unreadable' }; }
  if (!isObj(doc) || doc['mode'] !== 'orphans' || typeof doc['truncated'] !== 'boolean' || !Array.isArray(doc['rows'])) return { kind: 'unreadable' };
  const rows: OrphanRow[] = [];
  for (const r of doc['rows']) {
    if (!isObj(r) || typeof r['pathHex'] !== 'string' || !HEX.test(r['pathHex']) || typeof r['class'] !== 'string') return { kind: 'unreadable' };
    if (!(ORPHAN_CLASSES as readonly string[]).includes(r['class'])) return { kind: 'unreadable' };
    const ins = r['inside'];
    if (ins !== undefined && ins !== null && !isRegistryId(ins)) return { kind: 'unreadable' };
    rows.push({ hex: r['pathHex'], cls: r['class'] as OrphanClass, inside: typeof ins === 'string' ? ins : null });
  }
  return { kind: 'census', rows, truncated: doc['truncated'] };
}

/** The refusals a rescue token may sit beside: rung 9 (commits on no remote) and rung 11 (a nested checkout). */
export type RescuableWord = 'head-not-on-remote' | 'nested-checkout';

/** `ws-audit --orphan-hex`, as the lane reads it. `token` and `rescuable` carry the consent `ws-orphan` spends. */
export type OrphanAudit =
  | { readonly kind: 'token'; readonly token: OrphanToken }
  | { readonly kind: 'rescuable'; readonly word: RescuableWord; readonly rescueToken: OrphanToken; readonly detail: string }
  | { readonly kind: 'refused'; readonly word: string; readonly detail: string }
  | { readonly kind: 'unmeasured'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The ONE reader of the audit document, and the one place a token is branded. An answer for another path, a token
 *  that is not 64 hex characters and a verdict it does not know are all `unreadable`, which keeps the tree. */
export function parseOrphanAudit(stdout: string, hex: string): OrphanAudit {
  const bad = (detail: string): OrphanAudit => ({ kind: 'unreadable', detail });
  let doc: unknown;
  try { doc = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch { return bad('ws-audit --orphan-hex answered no document'); }
  if (!isObj(doc) || doc['mode'] !== 'orphan' || doc['pathHex'] !== hex) return bad('ws-audit --orphan-hex answered for another tree');
  const detail = typeof doc['detail'] === 'string' ? doc['detail'] : '';
  const refusal = typeof doc['refusal'] === 'string' ? doc['refusal'] : null;
  if (doc['verdict'] === 'token') {
    return typeof doc['token'] === 'string' && TOKEN.test(doc['token']) ? { kind: 'token', token: doc['token'] as OrphanToken } : bad('the audit token is malformed');
  }
  if ((refusal === 'head-not-on-remote' || refusal === 'nested-checkout') && typeof doc['rescueToken'] === 'string') {
    return TOKEN.test(doc['rescueToken']) ? { kind: 'rescuable', word: refusal, rescueToken: doc['rescueToken'] as OrphanToken, detail } : bad('the rescue token is malformed');
  }
  if (doc['verdict'] === 'unmeasured' || refusal === 'unmeasured') return { kind: 'unmeasured', detail };
  return refusal !== null && /^[a-z][a-z0-9-]{0,40}$/.test(refusal) ? { kind: 'refused', word: refusal, detail } : bad('the audit verdict is unknown');
}

/** `ws-orphan`'s one JSON line. */
export type OrphanResult =
  | { readonly kind: 'removed'; readonly branch: string }
  | { readonly kind: 'refused'; readonly word: string; readonly detail: string }
  | { readonly kind: 'failed'; readonly word: string; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

export function parseOrphanResult(stdout: string, hex: string): OrphanResult {
  let doc: unknown;
  try { doc = JSON.parse(stdout.trim().split('\n').pop() ?? ''); } catch { return { kind: 'unreadable', detail: 'ws-orphan answered no document' }; }
  if (!isObj(doc)) return { kind: 'unreadable', detail: 'ws-orphan answered no document' };
  const detail = typeof doc['detail'] === 'string' ? doc['detail'] : '';
  if (doc['removed'] === true) {
    return doc['pathHex'] === hex && typeof doc['branch'] === 'string'
      ? { kind: 'removed', branch: doc['branch'] } : { kind: 'unreadable', detail: 'ws-orphan answered for another tree' };
  }
  const word = (v: unknown): string | null => (typeof v === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v) ? v : null);
  if (word(doc['refused']) !== null) return { kind: 'refused', word: word(doc['refused'])!, detail };
  if (word(doc['failed']) !== null) return { kind: 'failed', word: word(doc['failed'])!, detail };
  return { kind: 'unreadable', detail: 'ws-orphan answered a document this server does not know' };
}

// ── the licence ──────────────────────────────────────────────────────────────

/** The first of the two audits: the token it saw and when (monotonic ms). `rescue` says the token is the rescue token. */
export interface OrphanObservation { readonly token: string; readonly rescue: boolean; readonly atMono: number }

/** The licence: the standing observation, with the same token, at least `ORPHAN_LICENCE_MS` before this audit. Nothing
 *  standing is `first`; a different token restarts it (`changed`); the same token too soon is `early` and keeps the
 *  first sighting. ONE observation never licenses. */
export function orphanLicence(obs: OrphanObservation | null, token: string, nowMono: number): 'licensed' | 'first' | 'early' | 'changed' {
  if (obs === null) return 'first';
  if (obs.token !== token) return 'changed';
  return nowMono - obs.atMono >= ORPHAN_LICENCE_MS ? 'licensed' : 'early';
}

// ── the switches ─────────────────────────────────────────────────────────────

/** `reclaim-paused` stops every audit and act. `live` is `orphan-tree-live`; `rescueLive` is its rescue marker, which
 *  means something only beside `live`. */
export type OrphanSwitches =
  | { readonly paused: true; readonly why: 'raised' | 'unlistable' }
  | { readonly paused: false; readonly live: boolean; readonly rescueLive: boolean };

/** Whether a rescue token may be spent now: both markers, never the rescue marker alone. */
export const orphanRescueArmed = (s: OrphanSwitches): boolean => !s.paused && s.live && s.rescueLive;

// ── outcomes, the feed ───────────────────────────────────────────────────────

/** What the lane last said about a tree. `would` is the shadow's word; `left` names the refusal. */
export type OrphanOutcome =
  | { readonly kind: 'removed'; readonly rescued: boolean }
  | { readonly kind: 'would'; readonly rescued: boolean }
  | { readonly kind: 'left'; readonly word: string; readonly detail: string };

/** One feed row per change of (path, outcome): this is the key. The refusal's detail is not in it, because a detail may
 *  carry a count that moves while the word stands. */
export const orphanOutcomeKey = (hex: string, o: OrphanOutcome): string =>
  `${hex}|${o.kind}${o.kind === 'left' ? `|${o.word}` : o.rescued ? '|rescued' : ''}`;

/** The refusal words as sentences. An unknown word is said as ccd's own word, never dropped. */
export const ORPHAN_LEFT_SENTENCE: Readonly<Record<string, string>> = {
  'not-a-worktree': 'git no longer lists it as a worktree',
  'out-of-scope': 'it is outside the places this lane may remove',
  'not-a-workspace': 'it is a main checkout',
  registered: 'a registry row names it or a path inside it',
  locked: 'git has it locked',
  dirty: 'it holds uncommitted or untracked changes',
  'tree-unreadable': 'its status could not be read',
  'tree-busy': 'a git operation is in progress inside it',
  'head-unreadable': 'its HEAD could not be read',
  'head-not-on-remote': 'its HEAD has commits on no remote, and the rescue arm is not armed',
  'secrets-ignored': 'an ignored file in it looks like a secret',
  'nested-checkout': 'it holds a nested checkout',
  'nested-checkout-rescuable': 'it holds a nested checkout with work on no remote, and the rescue arm is not armed',
  'in-use': 'a process holds it',
  'changed-recently': 'something in it changed within the floor',
  paused: 'cleanup is paused fleet-wide',
  'state-changed': 'it changed since the audit',
  'locked-elsewhere': 'another remover holds its lock',
  'pin-failed': 'its commits could not be pinned, so nothing was removed',
  'worktree-remove-failed': 'git refused to remove it without force',
  'probe-unmeasured': 'who holds it could not be measured',
  'no-rescue-token': 'it needs no rescue',
};

const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);

/** The path a hex string names, for a feed row only; control characters are shown as a space. */
export const orphanPathOfHex = (hex: string): string => oneLine(Buffer.from(hex, 'hex').toString('utf8'));

export const ORPHAN_FEED_TITLE = {
  removed: 'orphan worktree removed',
  would: 'orphan worktree would be removed',
  left: 'orphan worktree left',
  truncated: 'orphan census truncated',
} as const;

export function orphanFeedRow(hex: string, cls: OrphanClass, o: OrphanOutcome): { readonly title: string; readonly body: string } {
  const where = `${orphanPathOfHex(hex)} (${cls})`;
  if (o.kind === 'left') {
    const said = ORPHAN_LEFT_SENTENCE[o.word] ?? `ccd answered ${o.word}`;
    return { title: ORPHAN_FEED_TITLE.left, body: `${where}: ${said}${o.detail === '' ? '' : ` (${oneLine(o.detail)})`}` };
  }
  const tail = o.rescued ? ' after its commits are pinned in the attic' : '';
  return { title: ORPHAN_FEED_TITLE[o.kind], body: `${where}${tail}` };
}

/** #1565 (D-6987): the wait before a truncated census is asked again. `streak` counts the truncated censuses in a row,
 *  this one included; the wait doubles from `ORPHAN_RETRY_MS` and stops at the pass's own cadence, so a box whose every
 *  census meets its bound is asked about 4 times a day, not 96. */
export const orphanTruncatedWaitMs = (streak: number, censusMs: number): number =>
  Math.min(ORPHAN_RETRY_MS * 2 ** (streak - 1), censusMs);

/** The `lastCensus` that makes the next census due `waitMs` after now, at a cadence of `censusMs` (`orphanCensusDue`). */
export const orphanCensusRetryMono = (nowMono: number, censusMs: number, waitMs: number): number => nowMono - censusMs + waitMs;

/** #1565 (D-6988): the row for a truncated census. The answer carries only `truncated`, so the row cannot say which of
 *  ccd's bounds stopped it; the rows seen and the seconds the call took let a reader tell, and ccd's bounds are not
 *  copied here. */
export function orphanTruncatedRow(rowsSeen: number, tookMs: number, waitMs: number): { readonly title: string; readonly body: string } {
  return {
    title: ORPHAN_FEED_TITLE.truncated,
    body: `the orphan census stopped at its bound after ${rowsSeen} rows in ${(tookMs / 1000).toFixed(1)} s (the answer does not say whether rows or time); nothing was audited this pass, asked again in ${waitMs / 60_000} min`,
  };
}

// ── the lane's memory, and who is asked ──────────────────────────────────────

export interface OrphanTreeMemory {
  readonly cls: OrphanAuditedClass;
  /** The workspace the tree sits inside (DR-23), or null. */
  readonly inside: string | null;
  /** The standing first sighting, or null. */
  readonly obs: OrphanObservation | null;
  /** Earliest monotonic instant the next audit may be asked. */
  readonly nextMono: number;
  readonly outcome: OrphanOutcome | null;
}

export type OrphanMemory = ReadonlyMap<string, OrphanTreeMemory>;

/** The next census is due at once before the first, else after the interval (shorter under pressure). */
export const orphanCensusDue = (lastMono: number | null, nowMono: number, pressure: boolean): boolean =>
  lastMono === null || nowMono - lastMono >= (pressure ? ORPHAN_CENSUS_PRESSURE_MS : ORPHAN_CENSUS_MS);

/** The population after a census. A truncated one adds nothing and drops nothing ("the lane audits nothing new that
 *  pass"); a whole one keeps the memory of every tree it still lists and forgets the rest. */
export function orphanPopulate(
  prev: OrphanMemory, census: Extract<OrphanCensus, { kind: 'census' }>, nowMono: number, coordinators: ReadonlySet<string> | null, isWorkspace: OrphanIsWorkspace,
): OrphanMemory {
  if (census.truncated) return prev;
  const next = new Map<string, OrphanTreeMemory>();
  for (const r of census.rows) {
    if (!isAuditedClass(r.cls) || orphanInsideVerdict(r.inside, coordinators, isWorkspace) !== 'candidate') continue;
    next.set(r.hex, { ...(prev.get(r.hex) ?? { cls: r.cls, obs: null, nextMono: nowMono, outcome: null }), inside: r.inside });
  }
  return next;
}

/** The workspaces that are coordinators (G4): every id any run was ever claimed by, in any state or generation (open,
 *  closed, unplaced, displaced) plus the open ones. `everClaimedIds` is the store read's one home
 *  (`childReclaimEverClaimedIds`, spec §1 rule 4), handed in by the caller so this pure file reads no store itself.
 *  A throw from either read is null, which keeps the tree. */
export function orphanCoordinatorSet(coord: { everClaimedIds(): Iterable<string>; openCoordinatorIds(): Iterable<string> }): ReadonlySet<string> | null {
  try {
    return new Set([...coord.everClaimedIds(), ...coord.openCoordinatorIds()]);
  } catch { return null; }
}

/** Whether a registry row is a workspace: true when its `workspace` field is set, false for a plain session or a main checkout
 *  (the same `workspace !== null` test the child-reclaim lane uses), null when the row cannot be read. */
export type OrphanIsWorkspace = (id: string) => boolean | null;

/** A tree nested inside a registry row (DR-23). Inside nothing, or inside a row that is no workspace (a main checkout has no
 *  reclaim or expiry exit, so its agent worktrees are this lane's own population): a candidate. Inside a workspace: a candidate
 *  only when that workspace is a coordinator (any run's claimedBy, in any state); a worker's tree goes with its workspace.
 *  A coordinator list or a row that could not be read keeps the tree. */
export function orphanInsideVerdict(inside: string | null, coordinators: ReadonlySet<string> | null, isWorkspace: OrphanIsWorkspace): 'candidate' | 'goes-with-workspace' | 'unmeasured' {
  if (inside === null) return 'candidate';
  const ws = isWorkspace(inside);
  if (ws === null) return 'unmeasured';
  if (!ws) return 'candidate';
  if (coordinators === null) return 'unmeasured';
  return coordinators.has(inside) ? 'candidate' : 'goes-with-workspace';
}

/** The trees held back this pass: nested in a workspace that is no longer a known coordinator (or whose list is unreadable). */
export function orphanHeldBack(memory: OrphanMemory, coordinators: ReadonlySet<string> | null, isWorkspace: OrphanIsWorkspace): ReadonlySet<string> {
  const held = new Set<string>();
  for (const [hex, m] of memory) if (orphanInsideVerdict(m.inside, coordinators, isWorkspace) !== 'candidate') held.add(hex);
  return held;
}

/** The feed row for a tree reported and never audited. */
export function orphanGoesWithRow(hex: string, cls: OrphanClass): { readonly title: string; readonly body: string } {
  return { title: 'orphan worktree left', body: `${orphanPathOfHex(hex)} (${cls}): it goes with its workspace` };
}

/** Counts by class (every census row) and by outcome (every audited tree). `removed` is the lane's running count. */
export function orphanTreesHealth(
  rows: readonly OrphanRow[], memory: OrphanMemory, removed: number,
): DiskOrphanTrees {
  const byClass = { 'ccd-root': 0, claude: 0, superpowers: 0, other: 0, 'not-a-worktree': 0 };
  for (const r of rows) byClass[r.cls] += 1;
  const byOutcome = { pending: 0, would: 0, left: 0, removed };
  for (const m of memory.values()) {
    if (m.outcome === null) byOutcome.pending += 1;
    else if (m.outcome.kind !== 'removed') byOutcome[m.outcome.kind] += 1;
  }
  return { byClass, byOutcome };
}

export interface OrphanOffers { readonly act: string | null; readonly learn: readonly string[] }

/** Who is asked this pass. The act job is the ripe tree with the earliest first sighting (at most ONE per pass,
 *  fleet-wide); the learning audits go to due trees by next-ask instant, at most `auditsMax`. A busy tree is skipped. */
export function orphanOffers(
  memory: OrphanMemory, nowMono: number, auditsMax: number, busy: ReadonlySet<string>,
): OrphanOffers {
  const due = [...memory.entries()].filter(([hex, m]) => m.nextMono <= nowMono && !busy.has(hex));
  const ripe = due.filter(([, m]) => m.obs !== null && nowMono - m.obs.atMono >= ORPHAN_LICENCE_MS)
    .sort((a, b) => a[1].obs!.atMono - b[1].obs!.atMono || (a[0] < b[0] ? -1 : 1));
  const act = ripe.length === 0 ? null : ripe[0]![0];
  const learn = due.filter(([hex, m]) => hex !== act && !(m.obs !== null && nowMono - m.obs.atMono >= ORPHAN_LICENCE_MS))
    .sort((a, b) => a[1].nextMono - b[1].nextMono || (a[0] < b[0] ? -1 : 1)).slice(0, auditsMax).map(([hex]) => hex);
  return { act, learn };
}

// ── folding an answer into the memory ────────────────────────────────────────

/** What the L3 job reports for a tree, which the lane folds. `stopped` composed nothing and says nothing. */
export type OrphanJobOutcome =
  | { readonly kind: 'stopped'; readonly why: 'caps' | 'paused' | 'epoch' | 'switch' }
  | { readonly kind: 'audited'; readonly audit: OrphanAudit }
  | { readonly kind: 'would'; readonly rescued: boolean }
  | { readonly kind: 'result'; readonly result: OrphanResult; readonly rescued: boolean };

export interface OrphanFold {
  /** The tree's memory after the answer, or null when the tree is gone and is forgotten. */
  readonly mem: OrphanTreeMemory | null;
  /** The outcome to say, or null when the answer changes nothing worth a row. */
  readonly say: OrphanOutcome | null;
}

const left = (word: string, detail: string): OrphanOutcome => ({ kind: 'left', word, detail });

/** Folds one audit answer. `rescueArmed` says a rescue token may be spent (both markers). The first sighting of a token
 *  is remembered and says nothing; the same token too soon keeps its first sighting; a changed token restarts. */
export function orphanFoldAudit(m: OrphanTreeMemory, audit: OrphanAudit, nowMono: number, rescueArmed: boolean, censusMs: number): OrphanFold {
  const keep = (mem: OrphanTreeMemory, say: OrphanOutcome | null): OrphanFold => ({ mem, say: say !== null && orphanSameOutcome(m.outcome, say) ? null : say });
  switch (audit.kind) {
    case 'token': return keep(observe(m, audit.token, false, nowMono), null);
    case 'rescuable':
      return rescueArmed
        ? keep(observe(m, audit.rescueToken, true, nowMono), null)
        : keep({ ...m, obs: null, nextMono: nowMono + censusMs }, left(audit.word === 'nested-checkout' ? 'nested-checkout-rescuable' : audit.word, audit.detail));
    case 'refused': return keep({ ...m, obs: null, nextMono: nowMono + censusMs }, left(audit.word, audit.detail));
    case 'unmeasured': case 'unreadable': return keep({ ...m, obs: null, nextMono: nowMono + ORPHAN_RETRY_MS }, null);
  }
}

function observe(m: OrphanTreeMemory, token: string, rescue: boolean, nowMono: number): OrphanTreeMemory {
  const lic = orphanLicence(m.obs, token, nowMono);
  const obs: OrphanObservation = (lic === 'early' || lic === 'licensed') && m.obs !== null ? m.obs : { token, rescue, atMono: nowMono };
  return { ...m, obs, nextMono: obs.atMono + ORPHAN_LICENCE_MS };
}

const orphanSameOutcome = (a: OrphanOutcome | null, b: OrphanOutcome): boolean =>
  a !== null && orphanOutcomeKey('', a) === orphanOutcomeKey('', b);

/** Folds the act job's report. */
export function orphanFoldJob(m: OrphanTreeMemory, job: OrphanJobOutcome, nowMono: number, rescueArmed: boolean, censusMs: number): OrphanFold {
  const say = (o: OrphanOutcome): OrphanOutcome | null => (orphanSameOutcome(m.outcome, o) ? null : o);
  switch (job.kind) {
    case 'stopped': return { mem: { ...m, obs: null, nextMono: nowMono + ORPHAN_RETRY_MS }, say: null };
    case 'audited': return orphanFoldAudit(m, job.audit, nowMono, rescueArmed, censusMs);
    case 'would': {
      const o: OrphanOutcome = { kind: 'would', rescued: job.rescued };
      return { mem: { ...m, outcome: o, nextMono: nowMono + censusMs }, say: say(o) };
    }
    case 'result': {
      const r = job.result;
      if (r.kind === 'removed') return { mem: null, say: { kind: 'removed', rescued: job.rescued } };
      if (r.kind === 'unreadable') return { mem: { ...m, obs: null, nextMono: nowMono + ORPHAN_RETRY_MS }, say: null };
      const transient = r.word === 'locked-elsewhere' || r.word === 'probe-unmeasured';
      const o = left(r.word, r.detail);
      return { mem: { ...m, obs: null, outcome: o, nextMono: nowMono + (transient ? ORPHAN_RETRY_MS : censusMs) }, say: say(o) };
    }
  }
}

/** The memory a fold leaves when it says something: the tree remembers what was said, so a repeat is silent. */
export const orphanRemember = (f: OrphanFold): OrphanTreeMemory | null =>
  f.mem === null ? null : f.say === null ? f.mem : { ...f.mem, outcome: f.say };
