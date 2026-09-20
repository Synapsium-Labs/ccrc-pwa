// Host gauge — the load on the box the SESSIONS run on, in the shape of an
// account gauge so the strip reads as one row of instruments: two mono rows,
// a 5px meter each, a percentage, a trailing readout.
//
// It is NOT an account, and two things keep it from being mistaken for one:
// the cyan label, and its position. It sits in its own column, pinned to the
// RIGHT EDGE of the bar (`.accounts-bar`, shell.css) rather than in the
// accounts grid — so its place does not move when an account is added,
// removed or disabled, and an operator's eye can go to the same spot every
// time. On the phone it is the last, full-width row under the strip, for the
// same reason: a fixed place, not a place that depends on the count.
//
// It is also deliberately OUTSIDE `AccountsStrip`'s `role="link"`: that whole
// grid is one tap target onto /accounts, and a tap on the host tile must not
// open the accounts screen — there is nothing there about this box.
//
// WHAT THE TWO ROWS SAY:
//  - `cpu` — the green fill is the whole box's average over the reading's own
//    window; the two ticks are the two busiest logical threads. A pegged
//    single thread (one build, one test run, one wedged process) is invisible
//    in a 20%-average bar on a 16-thread box, and that is exactly the state
//    worth catching. A tick can never land inside the fill: no average
//    outruns its own maximum.
//  - `mem` — used (banded) · cache (grey, the part the kernel gives back) on
//    one RAM track, and swap on its own hairline UNDER it, scaled to the swap
//    total rather than to RAM.
//
// WHY SWAP IS NOT IN THE RAM BAR. It was, pinned to the right edge, and that
// is wrong twice over: the two cannot share a scale (swap is a different
// device with its own total), and on the box that matters most — the one
// nearly out of memory — the violet segment lands ON TOP of the red one,
// so the single worst reading is the one that draws as a collision. htop
// keeps Mem and Swp as separate bars for the same reason. The hairline sits
// inside the row's existing height (5px bar + 2px gap + 3px hairline = 10px,
// under the 15px the percentage cell already sets), so nothing grew and
// nothing can overlap.
//
// CPU IS NOT BANDED, on purpose. The account meters go amber at 50% and red
// at 75% because usage there is a budget being spent. A fleet box at 80% CPU
// is a fleet box doing its job. Colouring that red trains the eye to ignore
// the one row — memory — where red really does mean an OOM is coming.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { hottestCpus, type HostStat, type HostStatFailure } from '../../../shared/hoststat';
import { api } from '../lib/api';
import { elapsedWords } from '../lib/elapsed';
import { useNow } from '../lib/useNow';
import './fleet.css';

/** Poll cadence. The server caches just under this (`HOST_CACHE_MS`), so one
 *  client gets a fresh reading every poll and twenty clients still cost the
 *  fleet box one sample. */
export const HOST_POLL_MS = 6_000;

/** When a reading starts reading as STALE. A minute, not two poll intervals:
 *  `elapsedWords` declines to name anything under a minute ("moments"), and a
 *  six-second hiccup is not a state worth a word. Below this the tile shows
 *  the last reading plainly — it is still the truth about a box that was fine
 *  six seconds ago. */
export const HOST_STALE_MS = 60_000;

/** Memory's own bands, deliberately NOT `limitBand`'s 50/75 (components/
 *  LimitBar.tsx). That ladder is a spend-rate policy for account windows;
 *  this one is about headroom on a box, where half the RAM in use is normal
 *  and 90% is the last warning before the OOM killer picks a session. */
export function memBand(pct: number): 'ok' | 'warn' | 'crit' {
  if (pct > 90) return 'crit';
  if (pct >= 75) return 'warn';
  return 'ok';
}

/** A tick this hot is worth the amber: one thread at 90%+ is one thread that
 *  has stopped waiting for anything. */
const HOT_THREAD_PCT = 90;

/** The trailing word for a half that has no reading — short enough for the
 *  cell, and a different word per condition, because each has a different
 *  fix. The sentence version rides `title` for whoever has a pointer. */
export function failureWord(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no agent';
    case 'timeout': return 'no answer';
    case 'unsupported': return 'agent old';
    case 'absent': return 'no /proc';
    case 'unreadable': return 'no access';
    case 'unparsable': return 'bad format';
  }
  // A token this build has never heard of — a newer server naming a seventh
  // condition. The union is closed at COMPILE time (the `never` below stops
  // compiling the day a member is added without a case) and open on the WIRE,
  // where absence-permits cuts both ways: render something honest rather than
  // the `undefined` an exhaustive switch would otherwise return.
  const unknown: never = why;
  void unknown;
  return 'no reading';
}

export function failureSentence(why: HostStatFailure): string {
  switch (why) {
    case 'offline': return 'no link to the fleet host — nothing was asked';
    case 'timeout': return 'the fleet host was asked and did not answer in time';
    case 'unsupported': return 'the agent on the fleet host predates this reading — deploy the agent lane';
    case 'absent': return 'this host has no /proc — not a Linux box';
    case 'unreadable': return 'this host has /proc and would not let it be read';
    case 'unparsable': return '/proc was read and its shape was not understood';
  }
  const unknown: never = why;
  void unknown;
  return 'this build does not know why there is no reading';
}

/** A body this component is willing to render. `api.host()` is typed, and a
 *  TYPE IS NOT A GUARD: a fetch stub answering an unmatched route with a bare
 *  `{}` (several fixtures across this suite do exactly that) hands back
 *  `undefined` for both halves, and `cpu.ok` on it throws inside render —
 *  taking the whole screen down, not just this tile. The same lesson
 *  `AccountsStrip` records for its roster array, one component over. A
 *  malformed body keeps the last good reading, which then ages into `stale`. */
function isReading(v: unknown): v is HostStat {
  if (typeof v !== 'object' || v === null) return false;
  const { at, cpu, mem } = v as { at?: unknown; cpu?: unknown; mem?: unknown };
  return typeof at === 'number' && isHalf(cpu) && isHalf(mem);
}

function isHalf(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const half = v as { ok?: unknown; why?: unknown };
  return half.ok === true || (half.ok === false && typeof half.why === 'string');
}

const gib = (kb: number): string => (kb / 1048576).toFixed(1);
const pctOf = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.min(100, Math.max(0, (part / whole) * 100)));

/** One track, the shape `.acct-meter` has everywhere else in the strip. */
const track = (inner: ReactNode): ReactNode => <span className="acct-meter host-meter">{inner}</span>;

function Row({ label, cell, pct, trail, title, dim }: {
  label: string;
  /** The whole middle column — one track for cpu, a track plus the swap
   *  hairline for memory. Passed whole rather than wrapped here, because the
   *  two rows are genuinely different shapes and a `swap?:` prop on this
   *  component would be a second way to say the same thing. */
  cell: ReactNode;
  pct: string;
  trail: string;
  title: string;
  dim: boolean;
}): ReactNode {
  return (
    <div className="acct-row" title={title}>
      <span className="acct-win">{label}</span>
      {cell}
      <span className="acct-pct" data-dim={dim ? 'true' : undefined}>{pct}</span>
      <span className="host-trail">{trail}</span>
    </div>
  );
}

function CpuRow({ stat }: { stat: HostStat }): ReactNode {
  const cpu = stat.cpu;
  if (!cpu.ok) {
    return <Row label="cpu" cell={track(null)} pct="—" trail={failureWord(cpu.why)} title={failureSentence(cpu.why)} dim />;
  }
  // `Array.isArray` for the same reason the shape check above exists at all:
  // `isReading` proves a measured half says `ok: true`, not that it carries a
  // per-thread list, and this line reads `.length` the instant it renders.
  // There is no error boundary in this app, so a throw here unmounts the ROOT
  // and the whole console goes blank — one empty row is the smaller loss.
  // The server's own guard (`isCpuHalf`, server/src/hoststat.ts) refuses such
  // a payload one layer up; this is the layer that does not depend on that one
  // having been deployed.
  const perCpu = Array.isArray(cpu.perCpu) ? cpu.perCpu : [];
  // Two ticks, and only when there is more than one thread to distinguish: on
  // a single-CPU box the hottest thread IS the average, and a tick sitting on
  // the fill's own edge would be noise dressed as information.
  const hot = perCpu.length > 1 ? hottestCpus(perCpu, 2) : [];
  const title = [
    `cpu ${Math.round(cpu.total)}% over ${(cpu.windowMs / 1000).toFixed(1)}s`,
    perCpu.length > 0 ? `${perCpu.length} threads` : null,
    hot.length > 0 ? `hottest ${hot.map((h) => `#${h.id} ${Math.round(h.pct)}%`).join(', ')}` : null,
  ].filter((p) => p !== null).join(' · ');
  return (
    <Row
      label="cpu"
      cell={track(
        <>
          <span className="host-fill host-fill--cpu" style={{ width: `${cpu.total.toFixed(2)}%` }} />
          {hot.map((h, i) => (
            <span
              key={h.id}
              className="host-tick"
              data-hot={h.pct >= HOT_THREAD_PCT ? 'true' : undefined}
              data-rank={i === 0 ? 'first' : 'second'}
              style={{ left: `calc(${h.pct.toFixed(2)}% - 1px)` }}
            />
          ))}
        </>,
      )}
      pct={`${Math.round(cpu.total)}%`}
      trail={hot.length > 0 ? `↑${hot.map((h) => Math.round(h.pct)).join('·')}` : ''}
      title={title}
      dim={false}
    />
  );
}

function MemRow({ stat }: { stat: HostStat }): ReactNode {
  const mem = stat.mem;
  if (!mem.ok) {
    return <Row label="mem" cell={track(null)} pct="—" trail={failureWord(mem.why)} title={failureSentence(mem.why)} dim />;
  }
  const used = pctOf(mem.usedKb, mem.totalKb);
  const cache = pctOf(mem.cacheKb, mem.totalKb);
  // Swap is measured against the SWAP TOTAL, on its own hairline: it is a
  // different device, and a bar that mixes the two scales answers neither
  // "how full is memory" nor "how deep into swap are we". A box with swap
  // configured but none in use draws no hairline at all — the row keeps its
  // height either way, so nothing shifts when it appears.
  const swap = pctOf(mem.swapUsedKb, mem.swapTotalKb);
  // Under half a percent is a segment nobody can see and a cap nobody can
  // read: below that the used fill simply keeps the right-hand cap itself.
  // NOTE for a reader looking at the bar: cache is NOT always the smaller of
  // the two, and it is not always the larger either — `parseMeminfo` computes
  // `used = total − free − cache`, so the pair always sums to the bar and
  // either can dominate. A box full of long-lived node processes reads mostly
  // used; a box that has just finished a big build reads a lot of cache.
  const hasCache = cache >= 0.5;
  const title = [
    `${gib(mem.usedKb)}G used of ${gib(mem.totalKb)}G`,
    `cache ${gib(mem.cacheKb)}G`,
    `available ${gib(mem.availableKb)}G`,
    mem.swapTotalKb > 0 ? `swap ${gib(mem.swapUsedKb)}G of ${gib(mem.swapTotalKb)}G` : 'no swap',
  ].join(' · ');
  return (
    <Row
      label="mem"
      cell={(
        <span className="host-mem">
          {track(
            <>
              {/* ONE PILL IN TWO TONES. The track clips both outer ends round,
                  the join between them stays square, and the right-hand cap
                  belongs to whichever segment is last — so a box with no cache
                  worth drawing still ends in a cap and does not look clipped. */}
              <span
                className="host-fill host-fill--mem"
                data-band={memBand(used)}
                data-tail={hasCache ? undefined : 'true'}
                style={{ width: `${used.toFixed(2)}%` }}
              />
              {hasCache && <span className="host-seg-cache" style={{ left: `${used.toFixed(2)}%`, width: `${cache.toFixed(2)}%` }} />}
            </>,
          )}
          {mem.swapUsedKb > 0 && (
            <span className="host-swap" title={`swap ${gib(mem.swapUsedKb)}G of ${gib(mem.swapTotalKb)}G`}>
              <span className="host-swap-fill" style={{ width: `${swap.toFixed(2)}%` }} />
            </span>
          )}
        </span>
      )}
      pct={`${Math.round(used)}%`}
      // The swap figure displaces the totals when there is any: a box that has
      // started swapping has one number worth the cell, and it is that one.
      trail={mem.swapUsedKb > 0 ? `sw ${gib(mem.swapUsedKb)}G` : `${gib(mem.usedKb)}/${gib(mem.totalKb)}G`}
      title={title}
      dim={false}
    />
  );
}

export function HostGauge(): ReactNode {
  const [stat, setStat] = useState<HostStat | null>(null);
  const now = useNow(HOST_POLL_MS);

  useEffect(() => {
    let live = true;
    let issued = 0;
    const load = (): void => {
      // A hidden tab is a tab nobody is reading a gauge in. The listener below
      // snaps it current the moment it comes back, so the cost of skipping is
      // one stale frame nobody saw.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const mine = ++issued;
      // `mine === issued` drops an out-of-order answer (FleetHostBanner's
      // idiom): a slow poll landing after a fast one would otherwise walk the
      // reading backwards. A failed poll sets nothing — the last reading
      // stands and ages into `stale`, which is the honest rendering of "the
      // box was fine six seconds ago and nobody can reach it now".
      void api.host().then((h) => {
        if (!live || mine !== issued) return;
        if (isReading(h)) { setStat(h); return; }
        console.warn('ccrc: GET /api/host answered a body this gauge cannot read; keeping the last reading.', h);
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, HOST_POLL_MS);
    const onVisible = (): void => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const stale = stat !== null && now - stat.at > HOST_STALE_MS;
  // NO `role="group"`/`aria-label` on the tile: the account gauges beside it
  // carry neither, its rows already read in order ("host · cpu 34% ↑91·78 ·
  // mem 57% sw 0.5G"), and FleetScreen's group census is its bucket chips —
  // a second kind of group in that list is one more dead end in the rotor
  // (fleet-screen.test.tsx, "adds no landmark per bucket").
  return (
    <div className="host-gauge" data-stale={stale ? 'true' : undefined}>
      <span className="host-label">host</span>
      <div className="acct-rows">
        {stat === null ? (
          <>
            <Row label="cpu" cell={track(null)} pct="—" trail="checking…" title="waiting for the first reading" dim />
            <Row label="mem" cell={track(null)} pct="—" trail="" title="waiting for the first reading" dim />
          </>
        ) : (
          <>
            <CpuRow stat={stat} />
            <MemRow stat={stat} />
          </>
        )}
      </div>
      {stale && <span className="host-stale" title="no fresh reading has landed">{elapsedWords(now - stat.at)} old</span>}
    </div>
  );
}
