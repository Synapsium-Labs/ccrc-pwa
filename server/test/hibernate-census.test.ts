// THE HIBERNATION CENSUS (D-5242, plan Task 17b): every reader that can call a session dead states its stance on a
// HIBERNATED row — `ccd hibernate`'s `.stopped` plus `.hibernated`, a pane gone, lifecycle `stopped`, bucket `dead`.
//
// The reader list is DERIVED, never listed by hand (`hibernateCensusScan.ts`): five sources over `server/src`, `shared`
// and `pwa/src`, grouped by source and file with a hit count, so a new reader — or a new hit in a file already here —
// is red until its row (or its count) is written. Each row's stance is argued from WHAT THAT READER READS, not only from
// the verdict's holds (a run can be opened naming a sleeping session: `POST /api/runs` takes `claimedBy` from its body):
//   - `consults`      it reads `hibernatedAt` (or `.hibernated`) itself, or through the PWA's `hibernatedSince` — held:
//                     the file mentions it, or (`via`) the file it reads the dead answer through does (plan Task 18);
//   - `wakes-first`   it meets a hibernated row only through a path that wakes it first (dispatch's `ensure`, the mail
//                     lane);
//   - `journal`       the lifecycle journal's `hibernate` row makes the sleep deliberate;
//   - `held-awake`    the verdict's holds keep it from ever meeting one (no claim, no open run, no background work);
//   - `other-meaning` the word means something else there;
//   - `true-of-pane`  it counts a sleeping session's pane as not running, which is true, and says so;
//   - `definition`    the vocabulary's own definition.
// THE CENSUS IS THE SERVER TREE'S. The box-side sweeps keyed on a live process were audited by hand; `ccd-tmp-sweep` is
// the only one, and Task 16 gave it its stance (a hibernated row's uuid is live). The rows by NAME below are the readers
// outside the scan's reach: ccd's verbs, the PWA's Forget and the kickoff route.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CENSUS_SOURCE_NAMES, REPO, censusFiles, censusScan, type CensusFile, type CensusSource,
} from './hibernateCensusScan.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

type Stance = 'consults' | 'wakes-first' | 'journal' | 'held-awake' | 'other-meaning' | 'true-of-pane' | 'definition';
interface Row {
  readonly source: CensusSource; readonly file: string; readonly hits: number;
  readonly stances: readonly Stance[]; readonly why: string;
  /** For a `consults` row that reads the dead answer through another file (`coordPresence`, `lifecycleQualifier`): that
   *  file, which is the one that consults the marker. */
  readonly via?: string;
}

const CENSUS: readonly Row[] = [
  // ── server ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { source: 'dead-compare', file: 'server/src/coord/hibernate.ts', hits: 1, stances: ['definition'],
    why: 'the verdict itself: a dead row holds `pane`, so a sleeping row is never put to sleep again' },
  { source: 'dead-compare', file: 'server/src/watch.ts', hits: 5, stances: ['consults', 'true-of-pane', 'held-awake'],
    why: 'the push copy\'s active projects (a sleeper\'s pane is not running, true); `claimProbe` reads a dead row as '
      + '`gone`, and it meets no sleeper, because the verdict\'s `claim` hold keeps a claimant awake (the `claimExpiry` '
      + 'argument); the delegation lane\'s death memory (`noteSessions`) CONSULTS `hibernatedAt`, so a sleep never feeds '
      + 'its breaker, which suspends at two parent deaths in ten minutes; its owner census skips dead rows, and a sleeper '
      + 'has no delegation running (the `background`, `roster` and `marker-background` holds)' },
  { source: 'dead-lifecycle', file: 'server/src/watch.ts', hits: 1, stances: ['consults'],
    why: 'the mail lane\'s `session-dead` rung: the `hibernated` rung ahead of it gates and wakes a sleeper instead' },
  { source: 'stopped-compare', file: 'server/src/watch.ts', hits: 1, stances: ['consults', 'journal'],
    why: 'the dead-coordinator lane\'s released set: it reads `measureClaimant`, which answers a sleeper `alive`; a '
      + 'claimant whose wake failed reads `orphan`, and its journal\'s `hibernate` row makes it deliberate' },
  { source: 'tmux-verdict', file: 'server/src/watch.ts', hits: 2, stances: ['consults'],
    why: 'the dead-coordinator lane\'s tmux port (it feeds `measureClaimant`) and the mail lane\'s rung, which consults '
      + '`hibernatedAt` on `gone` before the lifecycle' },
  { source: 'dead-lifecycle', file: 'server/src/coord/reclaim.ts', hits: 3, stances: ['consults'],
    why: '`measureClaimant`: a `stopped` row with `.hibernated` answers `alive`, so the reclaim door refuses as for a '
      + 'live claimant, and the dead-coordinator lane and the ask hold read the same verdict' },
  { source: 'stopped-compare', file: 'server/src/coord/reclaim.ts', hits: 1, stances: ['consults'],
    why: 'that same rung: `lc === \'stopped\' && hibernatedAt !== null` answers alive' },
  { source: 'tmux-verdict', file: 'server/src/coord/reclaim.ts', hits: 1, stances: ['consults'],
    why: '`measureClaimant`\'s tmux rung; `gone` falls to the hibernated rung' },
  { source: 'dead-lifecycle', file: 'server/src/coord/stall.ts', hits: 1, stances: ['held-awake'],
    why: 'the stall watch reads an open run\'s worker, and an open run as worker or claimant holds `run-worker` or '
      + '`run-claimant`; were it to meet one, `stopped` holds `lifecycle-stopped` (no push), which is right for a sleep' },
  { source: 'stopped-compare', file: 'server/src/coord/stall.ts', hits: 1, stances: ['held-awake'],
    why: 'the same rung: a stopped worker is a deliberate stop, never a stall' },
  { source: 'stopped-compare', file: 'server/src/deadCoordinator.ts', hits: 1, stances: ['journal'],
    why: '`deadCoordinatorCrash`: a claimant still reading `stopped` is never counted; one whose wake failed reads '
      + '`orphan`, and `hibernate` in `DEAD_COORDINATOR_DELIBERATE_ACTS` makes it deliberate' },
  { source: 'stopped-compare', file: 'server/src/coord/collectTempRoot.ts', hits: 1, stances: ['other-meaning'],
    why: 'the collector\'s own lane state (`lane.kind === \'stopped\'`), not a session' },
  { source: 'tmux-verdict', file: 'server/src/coord/claims.ts', hits: 3, stances: ['held-awake'],
    why: '`LivenessVerdict` and `claimExpiry`: a session holding a claim is never put to sleep (`claim`), and a sleeping '
      + 'session takes none' },
  { source: 'lifecycle-table', file: 'server/src/coord/peers.ts', hits: 2, stances: ['consults', 'true-of-pane'],
    why: '`LIFECYCLE_RUNG`: `peerDeliverable` answers a hibernated probe `yes` before the tmux rung and this table; '
      + '`ARCHIVE_CONTRADICTS`: a sleeper is not live, so it contradicts no archive stamp' },
  { source: 'tmux-verdict', file: 'server/src/coord/peers.ts', hits: 1, stances: ['consults'],
    why: '`PeerProbe.tmux`: the hibernated rung answers before it is read' },
  { source: 'tmux-verdict', file: 'server/src/exec.ts', hits: 1, stances: ['true-of-pane'],
    why: '`hasSession`: whether a pane is live, which a sleeper\'s is not' },
  { source: 'tmux-verdict', file: 'server/src/server.ts', hits: 1, stances: ['true-of-pane'],
    why: 'the archive door\'s stop-after-archive arm acts only on a live pane; `ccd ws-archive` removes `.hibernated`' },
  { source: 'tmux-verdict', file: 'server/src/turnverdict.ts', hits: 1, stances: ['wakes-first'],
    why: 'the fail-closed turn verdict reads a sleeper `unmeasured`; dispatch\'s `/clear` gate meets it only after '
      + 'its `ensure` woke it (D-5238\'s `worker-starting`), and the swap route answers `409 hibernated` before reading it' },
  // ── shared ─────────────────────────────────────────────────────────────────────────────────────────────────────
  { source: 'dead-compare', file: 'shared/api.ts', hits: 3, stances: ['consults', 'true-of-pane'],
    why: '`bucketFor`: a sleeper\'s bucket stays `dead` (D-5242: the PWA words it `hibernated`, Task 18); '
      + '`inArchivedFold`\'s second clause excludes a row with `hibernatedAt`' },
  { source: 'dead-lifecycle', file: 'shared/api.ts', hits: 2, stances: ['definition'],
    why: '`lifecycleIsDead` and `DEAD_LIFECYCLES` themselves; `stopped` stays dead, and every reader that must tell a '
      + 'sleep from a stop consults `hibernatedAt` (this table)' },
  { source: 'lifecycle-table', file: 'shared/api.ts', hits: 2, stances: ['definition'],
    why: '`SESSION_LIFECYCLE_MAP` and `LIFECYCLE_DEAD`: no new lifecycle member (the plan\'s wire discipline)' },
  // ── pwa ── (plan Task 18 made each of these consult `hibernatedAt`, through `pwa/src/fleet/hibernated.ts`; the
  // `task-18` stance they waited under is retired, `hibernated-census-stances-consult`, D-5429)
  { source: 'dead-compare', file: 'pwa/src/fleet/hibernated.ts', hits: 1, stances: ['definition'],
    why: '`hibernatedSince`, the PWA\'s one reader of `hibernatedAt`: a row is asleep only while it is `dead` with the '
      + 'marker (both halves), so a crash is never woken and a stale marker on a live row is ignored' },
  { source: 'dead-compare', file: 'pwa/src/session/SessionHeader.tsx', hits: 4, stances: ['consults'],
    why: 'forces bucket `dead` for a dead stream and paints the ✕ lamp ("not running") with the word `exited` '
      + '(`headerStatusWord`, D-5545); a dead row with `hibernatedAt` (`hibernatedSince`) reads `hibernated` with the '
      + 'calm dot instead, so "not running" never sits above "Waking…"' },
  { source: 'dead-compare', file: 'pwa/src/fleet/SessionActionsSheet.tsx', hits: 6, stances: ['consults', 'true-of-pane'],
    why: 'the narrow-spawn note and Forget on a dead row are hidden on a sleeper (`hibernatedSince`), which offers Wake '
      + 'session (ccd forget refuses it, D-5423); the quota, narrow and wrapper notes speak of a live pane only' },
  { source: 'dead-compare', file: 'pwa/src/fleet/sessionFacts.ts', hits: 1, stances: ['consults'],
    why: 'the card\'s and the header\'s facts (D-5545) for a dead row; a sleeper (`hibernatedSince`) reads '
      + '`hibernated · 6h` with a calm dot and no stop stamp' },
  { source: 'dead-compare', file: 'pwa/src/screens/SessionScreen.tsx', hits: 2, stances: ['consults'],
    why: 'a dead screen is read-only; a sleeper (`useWakeOnOpen`) is woken when shown, reads "Waking…" with Wake, and '
      + 'keeps the composer shut until its row is alive; the dead banner\'s Restart is for a dead row with no marker' },
  { source: 'dead-compare', file: 'pwa/src/fleet/coordWords.ts', hits: 1, stances: ['consults'],
    why: '`coordPresence` answers a sleeping coordinator `hibernated` before its dead rung, so no Resume door and no '
      + '"coordinator gone"; the reclaim door those point at refuses a sleeper too (`claimant-alive`)' },
  { source: 'dead-lifecycle', file: 'pwa/src/fleet/coordWords.ts', hits: 1, stances: ['consults'],
    why: 'the same `coordPresence` rung, reached only after the `hibernated` answer' },
  { source: 'dead-compare', file: 'pwa/src/fleet/orphanWords.ts', hits: 1, stances: ['consults'],
    why: 'the orphan marker reads `coordPresence`, and says `coordinator hibernated` for a sleeper, never "coordinator gone"' },
  { source: 'dead-compare', file: 'pwa/src/screens/RunRow.tsx', hits: 1, stances: ['consults'], via: 'pwa/src/fleet/coordWords.ts',
    why: 'the Resume button reads `coordPresence`, which answers a sleeper `hibernated`, never `dead`' },
  { source: 'stopped-compare', file: 'pwa/src/fleet/lifecycleWords.ts', hits: 1, stances: ['consults'], via: 'pwa/src/fleet/sessionFacts.ts',
    why: '`lifecycleQualifier` words a stopped row "stopped by …"; `sessionFacts`, its one reader (D-5545), skips it '
      + 'on a sleeper and reads `hibernated · 6h`' },
  { source: 'dead-compare', file: 'pwa/src/fleet/groupFleet.ts', hits: 2, stances: ['true-of-pane'],
    why: 'a dead row\'s rank on the card and the stranded count over live rows: a sleeper\'s pane is not running; '
      + '`inArchivedFold` keeps it at the top level' },
  { source: 'dead-compare', file: 'pwa/src/fleet/ArchiveAllPlane.tsx', hits: 1, stances: ['true-of-pane'],
    why: 'counts the batch\'s live rows: a sleeper is not running' },
  { source: 'dead-compare', file: 'pwa/src/screens/AccountsScreen.tsx', hits: 1, stances: ['true-of-pane'],
    why: 'counts an account\'s running sessions: a sleeper is not running' },
  { source: 'dead-compare', file: 'pwa/src/fleet/startProgramPolicy.ts', hits: 3, stances: ['true-of-pane'],
    why: 'the live main checkout and live ids: a sleeping session is not running, which is true of its pane' },
  { source: 'dead-compare', file: 'pwa/src/fleet/spawnWords.ts', hits: 1, stances: ['true-of-pane'],
    why: 'silent about a spawn on a dead row: a sleeper has no spawn in progress to speak of' },
];

/** Readers outside the scan's reach, by name, each with the text that holds its stance. */
const NAMED: readonly { name: string; stances: readonly Stance[]; file: string; holds: (src: string) => boolean; why: string }[] = [
  { name: 'measureClaimant', stances: ['consults'], file: 'server/src/coord/reclaim.ts',
    holds: (s) => /export async function measureClaimant[\s\S]*?lc === 'stopped' && read\.record\.hibernatedAt !== null/.test(s),
    why: 'answers a sleeping claimant `alive`, why hibernated' },
  { name: 'ccd cmd_forget', stances: ['consults'], file: 'ccd/ccd', holds: (s) => /hibernated/.test(bashFn(s, 'cmd_forget')),
    why: 'refuses a hibernated row (`_lc_refuse hibernated`): wake it or stop it first' },
  { name: 'ccd cmd_stop', stances: ['consults'], file: 'ccd/ccd', holds: (s) => /hibernat/.test(bashFn(s, 'cmd_stop')),
    why: 'removes `.hibernated`: a stopped row is never woken by mail' },
  { name: 'ccd cmd_ws_archive', stances: ['consults'], file: 'ccd/ccd', holds: (s) => /hibernat/.test(bashFn(s, 'cmd_ws_archive')),
    why: 'removes `.hibernated`: an archived row is never woken by mail' },
  { name: 'the PWA\'s Forget', stances: ['consults'], file: 'pwa/src/fleet/SessionActionsSheet.tsx',
    holds: (s) => /const asleep = hibernatedSince\(session\) !== null/.test(s)
      && /session\.workspace === null && session\.status === 'dead' && !asleep && \(\s*<Button[\s\S]*?Forget session/.test(s),
    why: 'offered on a dead non-workspace row and hidden on a sleeper, which offers Wake (ccd forget refuses it)' },
  { name: 'the kickoff route', stances: ['wakes-first'], file: 'server/src/coord/kickoff.ts',
    holds: (s) => /export function queueProgramKickoff[\s\S]*?queueSystemMail\(/.test(s),
    why: 'queues system mail and never refuses a dead session: the mail lane wakes its recipient like any mail\'s' },
];

function bashFn(src: string, name: string): string {
  const at = src.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const end = src.indexOf('\n}', at + 1);
  return src.slice(at, end < 0 ? undefined : end);
}
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
const key = (r: Pick<Row, 'source' | 'file'>): string => `${r.source} ${r.file}`;
const tableMap = (): Map<string, number> => new Map(CENSUS.map((r) => [key(r), r.hits] as const));
const sorted = (m: Map<string, number>): [string, number][] => [...m].sort(([a], [b]) => (a < b ? -1 : 1));

describe('the hibernation census (D-5242)', () => {
  it('the derived reader list equals the table — a new reader, or a new hit in a listed file, needs its row', () => {
    expect(sorted(censusScan(censusFiles()))).toEqual(sorted(tableMap()));
  });

  it('every row is argued: a stance from the closed set and a reason', () => {
    for (const r of CENSUS) {
      expect(r.stances.length, key(r)).toBeGreaterThan(0);
      expect(r.why.length, key(r)).toBeGreaterThan(20);
    }
    expect(new Set(CENSUS.map(key)).size, 'one row per source and file').toBe(CENSUS.length);
  });

  it('a `consults` stance is real: the file (or the one it reads through) reads hibernatedAt or .hibernated', () => {
    for (const r of CENSUS.filter((x) => x.stances.includes('consults'))) {
      const reader = r.via ?? r.file;
      expect(/hibernatedAt|\.hibernated|hibernated:|'hibernated'|hibernatedSince|hibernatedWords/.test(read(reader)), `${key(r)} (via ${reader})`).toBe(true);
      if (r.via !== undefined) expect(read(r.file), `${r.file} reads through ${r.via}`).toMatch(/coordPresence|lifecycleQualifier/);
    }
  });

  it('the readers by name hold their stances', () => {
    for (const n of NAMED) expect(n.holds(read(n.file)), n.name).toBe(true);
  });

  // The derivation's own teeth: a scratch file holding one reader of each kind, added in turn, reds the census.
  const SCRATCH: Record<CensusSource, string> = {
    'dead-lifecycle': 'export const f = (lc: SessionLifecycle) => lifecycleIsDead(lc);',
    'lifecycle-table': "const T: Record<SessionLifecycle, number> = {} as never;",
    'stopped-compare': "export const g = (lc: string) => lc === 'stopped';",
    'tmux-verdict': 'export const h = async (t: Tmux) => (await t.sessionVerdict(\'x\')).verdict;',
    'dead-compare': "export const k = (s: { bucket: string }) => s.bucket === 'dead';",
  };
  for (const src of CENSUS_SOURCE_NAMES) {
    it(`a scratch reader of the ${src} kind is found, and reds the census`, () => {
      const scratch: CensusFile = { rel: 'server/src/zz-scratch-reader.ts', text: SCRATCH[src] };
      const scanned = censusScan([...censusFiles(), scratch]);
      expect(scanned.get(`${src} server/src/zz-scratch-reader.ts`)).toBe(1);
      expect(sorted(scanned)).not.toEqual(sorted(tableMap()));
    });
  }

  it('a reader in a comment or an import is not a reader', () => {
    const quiet: CensusFile = { rel: 'server/src/zz-quiet.ts', text: [
      "import { lifecycleIsDead, DEAD_LIFECYCLES } from '../../shared/api.js';",
      "// if (s.status === 'dead') lifecycleIsDead(x)",
      "/* lc === 'stopped' */",
    ].join('\n') };
    expect(censusScan([quiet]).size).toBe(0);
  });
});

// The one reader this census changed in behaviour (beside the ones the plan names): the delegation lane's death memory.
describe('the delegation lane never counts a sleep as a death (D-5242)', () => {
  const pass = (sessions: { id: string; status: string; hibernatedAt?: number | null }[], now: number) =>
    ({ records: [], sessions: sessions.map((s) => ({ project: 'project-a', ...s })), now }) as never;
  // The lane is private to the watcher (`delegationLane()`); its two methods are reached through it, as the tick does.
  type Lane = { noteSessions(p: unknown): void; firstDeadParents(): { parentId: string }[] };
  const lane = (w: FleetWatcher): Lane => (w as unknown as { delegationLane(): Lane }).delegationLane();
  const deaths = (w: FleetWatcher): string[] => lane(w).firstDeadParents().map((d) => d.parentId);
  const note = (w: FleetWatcher, p: unknown): void => { lane(w).noteSessions(p); };

  it('a parent seen alive and then hibernated is not a fresh death; one seen alive and then dead is', () => {
    const w = new FleetWatcher(testDeps(mkTmp('ccrc-census-')) as never, new Bus(), 10_000);
    const ids = ['project-a-basin-a', 'project-a-basin-b'];
    note(w, pass(ids.map((id) => ({ id, status: 'idle', hibernatedAt: null })), 1_000));
    note(w, pass([
      { id: ids[0]!, status: 'dead', hibernatedAt: 900_000 },
      { id: ids[1]!, status: 'dead', hibernatedAt: null },
    ], 2_000));
    expect(deaths(w)).toEqual([ids[1]]);
  });
});
