/**
 * D-6051 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-23 (#527)). One
 * representative call per `CCD_ARGV` entry, so `ccd-verb-sets.test.ts` can read the verb each entry sends.
 * D-6053: moved here from `whitelist-subset.test.ts`, which imports it as its `SAMPLES`; one table, two readers.
 */
import type { OrphanToken } from '../../shared/api.js';
import type { CCD_ARGV } from '../src/ccdargv.js';

/** One representative call per entry. Every entry MUST appear: the `Record` type is total over `CCD_ARGV`, so a
 *  new entry with no sample fails `tsc`. */
// `unknown[]`, not `string[]`, since wave 6: `wsArchive` and its four siblings
// take an `ActorFlags | null` argument, so a sample is no longer all-strings.
// Every call site casts through `unknown[]`; this widens the
// declaration to match what the table accepts. EXPECTED stays `string[]` — an
// argv is still tokens.
export const CCD_ARGV_SAMPLES: Record<keyof typeof CCD_ARGV, unknown[]> = {
  start: ['claude', 'demo'],
  // `enable` is a SEPARATE entry, not a parameter of `start`: POST /api/sessions
  // picks between the two words (`POST /api/sessions` in `server.ts`) and the agent grants them
  // separately, so `whitelist-subset.test.ts`'s layer 3 fails outright if nothing builds `enable`.
  enable: ['claude', 'demo'],
  ensure: ['demo-quiet-basin'],
  stopId: ['demo-quiet-basin', 'pwa'],
  stopPair: ['claude', 'demo', 'pwa'],
  forget: ['claude-acme-demo'],
  // D-5242: the dec rides after the one positional, as an unattended lane sends it; the bare `['hibernate']` grant
  // admits it with no widening.
  hibernate: ['demo-quiet-basin', { surface: 'agent', actor: 'sweep:hibernate', reason: null }],
  swap: ['demo-quiet-basin', 'claude9'],
  /** THE DELIBERATE CROSSING (account pools, spec §5.7). Three separate
   *  ENTRIES rather than an option on the three above — `start`/`enable`'s own
   *  rule, for its reason: a route picks the ENTRY, so both spellings are
   *  enumerated here and neither can drift out of the agent's whitelist. */
  swapCross: ['demo-quiet-basin', 'claude-b'],
  // D-5240: the operator's consent to lose the turn, LEADING like `--cross-pool`; the bare `['swap']` prefix grant
  // admits both with no widening.
  swapInterrupt: ['demo-quiet-basin', 'claude9'],
  swapCrossInterrupt: ['demo-quiet-basin', 'claude-b'],
  startCross: ['claude', 'demo'],
  enableCross: ['claude', 'demo'],
  wsAdd: ['demo'],
  // The named create (named workspaces S5): the same bare `['ws-add']` grant, a third builder. Its sample carries a
  // title, a wrapper, no route and a dec, so layer 2 proves the leading `--title`/`--wrapper` pair and the trailing slug
  // cross the grant with no widening.
  wsAddNamed: ['demo', 'eng-1234', { title: 'ENG-1234', wrapper: 'lane-a' }, null, { surface: 'pwa', actor: 'unmeasured', reason: null }],
  // Same bare `['ws-add']` grant, second builder: the dispatch path's
  // worker-declaring form. Its sample proves the FLAGGED shape crosses the
  // existing prefix with no widening — tokens after the prefix are
  // unconstrained, the same rule that carries `stop --surface`. It CARRIES A
  // DEC, for `wsHold`'s reason two entries down: a bare sample would leave
  // `whitelist-subset.test.ts`'s layer 2 proving only the unflagged shape reachable, which is not the shape
  // the dispatch path sends on a caps-advertising box.
  //
  // AND THIS FILE STILL CANNOT BE THE PLACE THAT VALIDATES IT (D-410): trailing
  // tokens are unconstrained by the agent's prefix grant, so the flagged shape
  // crosses this layer green whether or not the fleet binary can read it — it
  // did, for a whole commit, while real ccd refused it as an invalid slug.
  // `ccdargv-dec-parity.test.ts` runs the real binary; this layer only says the
  // tokens reach it.
  // AND IT CARRIES A CHILD (child-workspace reclamation wave 1), for the dec's
  // reason: the shape the dispatch path sends to a box advertising
  // `child-argv-v1` is the one `whitelist-subset.test.ts`'s layer 2 must prove crosses the bare grant.
  wsAddWorker: ['demo', { surface: 'agent', actor: 'run:7 dispatch', reason: null }, null, 7],
  prStateSession: ['demo-quiet-basin'],
  prStateProject: ['demo'],
  prLanding: ['demo', [{ id: 'demo-quiet-basin', pr: 41 }]],
  prOpen: ['demo-quiet-basin', 'the work', 'Ym9keQ==', 'false'],
  wsArchive: ['demo-quiet-basin', null],
  wsRestore: ['demo-quiet-basin', null],
  wsAudit: ['demo-quiet-basin'],
  // NAMED WORKSPACES S9: the rename verb's own two-token grant, `['ws-title','--session']`. The sample sets a title that
  // BEGINS WITH DASHES, so layer 2 proves a title token ccd must read as text still crosses the grant; its sibling
  // clear form is pinned by name in `whitelist-subset.test.ts`.
  wsTitle: ['demo-quiet-basin', { title: '-- ENG-1234 - Fix the login flow' }],
  wsReap: ['a'.repeat(64), 'demo-quiet-basin'],
  // CHILD RECLAMATION wave 3. The audit half rides wsAudit's grant; the verb
  // carries a dec, so `whitelist-subset.test.ts`'s layer 2 proves the FLAGGED shape crosses the new grant.
  wsReclaimAudit: ['demo-quiet-basin', true],
  wsReclaim: ['a'.repeat(64), 7, 'demo-quiet-basin', false,
              { surface: 'agent', actor: 'run:7 reclaim close', reason: null }],
  // WORKSPACE LIFECYCLE wave 3: the expiry's audit rides wsAudit's grant; the verb carries a dec, so
  // `whitelist-subset.test.ts`'s layer 2 proves the FLAGGED shape crosses its own grant.
  wsExpireAudit: ['demo-quiet-dune'],
  wsExpire: ['a'.repeat(64), 'demo-quiet-dune', { surface: 'agent', actor: 'expiry sweep', reason: null }],
  // CHILD RECLAMATION wave 7: the collector's audit rides wsAudit's grant; the verb carries a dec, so
  // `whitelist-subset.test.ts`'s layer 2 proves the FLAGGED shape crosses its own grant.
  wsCollectAudit: ['demo-quiet-dune'],
  wsCollect: ['a'.repeat(64), 'demo-quiet-dune', { surface: 'agent', actor: 'collect sweep', reason: null }],
  // FLEET DISK RETENTION DR-18 (D-6630): the orphan lane's census and audit ride `ws-audit`'s two new grants; the verb
  // carries a dec, so `whitelist-subset.test.ts`'s layer 2 proves the FLAGGED shape crosses its own grant.
  wsOrphanCensus: [],
  wsOrphanAudit: ['2f6f7270'],
  wsOrphan: ['a'.repeat(64) as OrphanToken, '2f6f7270', true, { surface: 'agent', actor: 'orphan sweep', reason: null }],
  // THE COLLECTOR'S LOOSE ARM (D-6626): the census rides `['ws-audit','--collect-census']`, the audit
  // `['ws-audit','--loose-hex']`, and the verb the collector's own `['ws-collect','--expect']`; the verb's sample carries a
  // dec so layer 2 proves the FLAGGED shape crosses with no third prefix.
  wsCollectCensus: [],
  wsCollectLooseAudit: ['2d7266'],
  wsCollectLoose: ['a'.repeat(64), '2d7266', { surface: 'agent', actor: 'collect sweep', reason: null }],
  wsAttic: ['demo-quiet-basin'],
  // The one sample that carries a dec, so `whitelist-subset.test.ts`'s layer 2's `isExecAllowed` check
  // actually proves the FLAGGED shape is reachable under the granted
  // `['ws-hold','--session']` prefix rather than only the bare one.
  wsHold: ['demo-quiet-basin', 'program:prog-j wave:1/4',
           { surface: 'pwa', actor: 'device:iPhone', reason: null }],
  wsRelease: ['demo-quiet-basin', null],
  wsRename: ['demo-quiet-basin', 'ws/brainstorm-helix-and-slide-notes', null],
  coordPause: ['on'],
  // CHILD RECLAMATION wave 4 — `coordPause`'s shape exactly.
  reclaimPause: ['on'],
  // Two ENTRIES, not one parameterised by `pool: string | null` — the
  // `start`/`enable` rule stated in `CCD_ARGV`'s `enable` docstring: the route
  // picks between two words, the argv shapes differ in their tail, and layer
  // 3 fails outright if nothing builds one of them.
  projectPoolSet: ['demo', 'pool-a'],
  projectPoolClear: ['demo'],
  // Routing slice 1: the record's one writer besides ccd. The sample carries
  // a real field=value so `whitelist-subset.test.ts`'s layer 2 proves the flagged shape is reachable under
  // the granted `['route','--session']` prefix.
  route: ['demo-quiet-basin', 'effort', 'high'],
  // The SAME `['route','--session']` grant, second builder — `wsAdd`/
  // `wsAddWorker`'s own precedent. The multi-pair form is what a writer with
  // more than one field to set must use (ccd validates every pair before it
  // writes any; N calls would half-apply), and it is enumerated separately so
  // the repeated-`--set` shape cannot hide behind its single-field sibling.
  routeSet: ['demo-quiet-basin', { class: 'opus', effort: 'high' }],
  // The live-change form (slice 4, Task 5): same `['route','--session']`
  // grant as `route`/`routeSet` above, `--apply` is a trailing token and
  // trailing tokens are unconstrained by the agent's prefix, so no new grant
  // is needed — this sample proves the flagged shape still crosses it.
  routeApply: ['demo-quiet-basin', 'effort', 'high', null],
  // TERMINAL DRAWER wave 2. The mode is part of the argv, not a parameter the
  // route may omit: `cmd_win_size` asserts exactly four tokens.
  winSize: ['demo-quiet-basin', 'smallest'],
  // NATIVE DOCS READER wave 2. Read-only verbs, one grant each; the two
  // `docs-show` builders share `['docs-show','--project']`. The `null` tails
  // are the samples, so `whitelist-subset.test.ts`'s layer 2c pins the shortest argv of `docsTree` and
  // `docsFetch`; their non-null tails are pinned by the case after it.
  docsIndex: [],
  docsTree: ['demo', null],
  docsShowCommitted: ['demo', 'a'.repeat(40), 'refs/remotes/origin/main', 'specs', 'a.md', 2097152],
  docsShowDraft: ['demo', 'main', 'b'.repeat(40), 'plans', 'b.md', 'c'.repeat(64), 2097152],
  docsFetch: ['demo', null],
};
