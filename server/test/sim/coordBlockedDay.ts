// The worked example (Overlord spec §11.7): the stall watch's coord-blocked arm, driven for a seeded day on the
// simulator's world. The decider's module is a parameter, so a mutated copy can be handed to the same scenario. The
// lane is mirrored from watch.ts's coord-blocked step: it keeps the episode and the push latch as volatile state in the
// boot routine's closure, builds the input, calls the decider and applies the verdict. It imports no L3.
import {
  COORD_BLOCKED_HELD_MS, stallPushRoute,
  type StallChildFact, type StallCoordBlockedInput, type StallCoordEpisode, type StallDeliveryRow, type StallMailRow,
  type StallRunRow, type StallSessionInput, type StallWorker, type TurnMark, type TurnMarkRead,
} from '../../src/coord/stall.js';
import { STALL_SWEEP_MS } from '../../src/laneSchedule.js';
import type { Invariant, SequenceLine, Violation } from './sequence.js';
import type { Scenario } from './run.js';
import { chance, pick } from './world.js';

/** The decider's module, passed in so that Task 5 can hand a mutant to the same scenario. */
export type CoordBlockedModule = Pick<typeof import('../../src/coord/stall.js'), 'stallCoordBlockedStep' | 'stallPushRoute'>;
export const COORD_BLOCKED_EDGES = ['rung-1', 'rung-2', 'rung-2-direct', 'held', 'episode-closed',
  'reopened-after-boot', 'stretch-ended-while-held'] as const;
export type CoordBlockedEdge = (typeof COORD_BLOCKED_EDGES)[number];

const COORD = 'lane-a-coordinator';
const WORKER_ID = 'lane-a-worker';
const START = Date.parse('2026-10-12T00:00:00Z');
const DAY_MS = 24 * 3_600_000;
const BEAT_MS = 5 * 60_000;
const MIN = 60_000;
const WORDS = ['busy-turn', 'busy-background', 'waiting', 'idle', 'idle-blocked'] as const;
type Word = (typeof WORDS)[number];

const RUN: StallRunRow = {
  id: 67, kind: 'work', state: 'working', sessionId: WORKER_ID, claimedBy: COORD, dispatchedAt: START,
  program: 'program-a', wave: 1, waveOf: 1, project: 'project-a', workspace: null,
};
const CHILD: StallChildFact = { kind: 'none' };

export function coordBlockedDay(mod: CoordBlockedModule): Scenario<CoordBlockedEdge> {
  return {
    name: 'coord-blocked-day', startWallMs: START, durationMs: DAY_MS, edges: COORD_BLOCKED_EDGES,
    setup({ world, seq, cover, entropy }) {
      const line = (kind: string, id: string, state: string, actor: string): void => { seq.append({ kind, id, state, actor }); };
      // DURABLE state: survives a crash.
      const mail: StallMailRow[] = [];
      const deliveries: StallDeliveryRow[] = [];
      let word: Word = 'idle';
      let stamp = START;
      let mark: TurnMarkRead = { ok: false, reason: 'absent' };
      let unmeasured = false;

      const markOf = (state: 'working' | 'done', at: number): TurnMarkRead => {
        const base: TurnMark = {
          sessionId: 'session-a', state, event: state === 'working' ? 'PreToolUse' : 'Stop', at, turnAt: at,
          stopAt: state === 'working' ? null : at, bg: state === 'working' ? 0 : 1,
          bgKinds: state === 'working' ? [] : ['workflow'], bgIds: state === 'working' ? [] : ['bg-1'], err: null,
          restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null,
        };
        return { ok: true, ...base };
      };
      // busy-turn: live busy over a current working marker (the coordinator's own turn); busy-background: live busy
      // over a current done marker (a finished turn over background work), per stallCoordGate.
      const liveWord = (): string => (word === 'busy-turn' || word === 'busy-background' ? 'busy' : word === 'waiting' ? 'waiting' : 'idle');
      const sessionInput = (): StallSessionInput => {
        const worker: StallWorker = {
          present: true, unmeasured, lifecycle: 'running', limits: null, dialogPending: false, stranded: false,
          swapBlocked: false, live: { ok: true, word: liveWord(), since: stamp }, hookAsk: { kind: 'none' },
          askRow: { kind: 'none' }, autoContinueHeldAt: null,
        };
        return {
          sessionId: COORD, role: 'coordinator', run: null, worker, mark, liveStartedAt: START, markUnreadableSince: null,
          mail, deliveries, notices: [], arming: { disabled: false, live: true, escalate: true },
          coordinationPaused: false,
        };
      };
      const pushedBefore = (key: string, state?: string): boolean =>
        seq.lines().some((l) => l.kind === 'push' && l.id === key && (state === undefined || l.state === state));

      world.onBoot(() => {
        // VOLATILE state, lost on a crash: the episode, the push latch and what the last sweep saw.
        let episode: StallCoordEpisode | null = null;
        const latch = new Set<string>();
        let heldSome = false;
        let lastVerdict = 'none';
        let firstSweep = true;
        line('server', 'boot', 'up', 'sim');
        const sweep = (): void => {
          const now = world.server.clock.wall();
          const input: StallCoordBlockedInput = { session: sessionInput(), child: CHILD, runs: [RUN], episode };
          const step = mod.stallCoordBlockedStep(input, now);
          const queued = deliveries.some((d) => d.state === 'queued');
          if (queued !== heldSome) { heldSome = queued; line('held', COORD, queued ? 'some' : 'none', 'stalls'); }
          const prev = episode;
          episode = step.episode;
          if (prev === null && episode !== null) {
            line('episode', String(episode.since), 'open', 'stalls');
            if (firstSweep && pushedBefore(String(episode.since))) cover('reopened-after-boot');
          }
          if (prev !== null && episode === null) {
            line('episode', String(prev.since), 'closed', 'stalls');
            cover('episode-closed');
          }
          firstSweep = false;
          const v = step.verdict;
          const name = v.act === 'notify' ? `rung-${v.rung}` : v.act === 'hold' ? 'hold' : 'none';
          if (name !== lastVerdict) { lastVerdict = name; line('verdict', COORD, name, 'stalls'); }
          if (v.act === 'hold') cover('held');
          if (v.act === 'notify') {
            const tag = mod.stallPushRoute(v, COORD, null).tag;
            if (!latch.has(tag)) {
              latch.add(tag);
              const key = String(v.key);
              if (v.rung === 2 && !pushedBefore(key, 'rung-1')) cover('rung-2-direct');
              line('push', key, `rung-${v.rung}`, 'stalls');
              cover(v.rung === 1 ? 'rung-1' : 'rung-2');
            }
          }
          if ((word === 'idle' || word === 'idle-blocked') && queued && episode !== null && episode.rung === 2) {
            cover('stretch-ended-while-held');
          }
          world.server.scheduler.after(STALL_SWEEP_MS, sweep);
        };
        world.server.scheduler.after(0, sweep);
      });

      const beat = (): void => {
        const now = world.time.ports.clock.wall();
        // Six draws, every one taken on every beat, in this order.
        const queue = chance(entropy, 0.25);
        const change = chance(entropy, 0.2);
        const next = pick(entropy, WORDS);
        const flip = chance(entropy, 0.01);
        const crash = chance(entropy, 0.007);
        const downMin = entropy.below(11);
        if (queue) {
          const id = mail.length + 1;
          mail.push({ id, at: now, runId: RUN.id, fromId: WORKER_ID, toId: COORD, kind: 'question', subject: 'question' });
          deliveries.push({ id, mailId: id, toId: COORD, state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null,
            gateSince: null, replayCount: 0 });
          line('mail', String(id), 'queued', 'worker');
        }
        if (change && next !== word) {
          const idleWord = (w: Word): boolean => w === 'idle' || w === 'idle-blocked';
          const wasIdle = idleWord(word);
          word = next; stamp = now;
          // A turn ends on idle and idle-blocked, so the Stop hook leaves a done mark; waiting keeps the turn open (the
          // doc of stallCoordBusySince: the turn's own start carries across busy and waiting), so its mark stays.
          if (idleWord(word) && !wasIdle) mark = markOf('done', now);
          if (word === 'busy-turn') mark = markOf('working', now);
          else if (word === 'busy-background') mark = markOf('done', now);
          line('word', COORD, word, 'coordinator');
        }
        if (flip) { unmeasured = !unmeasured; line('link', COORD, unmeasured ? 'unmeasured' : 'measured', 'sim'); }
        if (crash && !world.isDown()) { line('server', 'crash', 'down', 'sim'); world.crash(downMin * MIN); }
        if (word === 'idle' && !world.isDown()) {
          for (let i = 0; i < deliveries.length; i++) {
            const d = deliveries[i]!;
            if (d.state !== 'queued') continue;
            deliveries[i] = { ...d, state: 'delivered', deliveredAt: now };
            line('mail', String(d.mailId), 'delivered', 'gate');
          }
        }
        world.envAfter(BEAT_MS, beat);
      };
      world.envAfter(BEAT_MS, beat);
    },
  };
}

/** CB-reach (I1's shape, fails towards the operator): a mail held past the threshold reaches the operator within one
 *  sweep, unless the link is unmeasured. The clock stops while the server is down and restarts at its boot: a `server
 *  crash` line sets `up` false and a `server boot` line sets it true and restarts `steadySince`. Each line is judged
 *  before it is applied, so the boot line and every line during the downtime are judged while `up` is false. */
function reach(lines: readonly SequenceLine[]): Violation | null {
  const queued = new Map<string, number>();
  let pushed = false;
  let steadySince = lines.length > 0 ? lines[0]!.at : 0;
  let measured = true;
  let up = true;
  for (const l of lines) {
    if (measured && up && !pushed) {
      for (const [id, at] of queued) {
        if (l.at > Math.max(at + COORD_BLOCKED_HELD_MS, steadySince) + STALL_SWEEP_MS) {
          return { invariant: 'CB-reach', seq: l.seq, message: `mail ${id} held past the threshold with no push within one sweep` };
        }
      }
    }
    if (l.kind === 'mail' && l.state === 'queued') queued.set(l.id, l.at);
    else if (l.kind === 'mail' && l.state === 'delivered') queued.delete(l.id);
    else if (l.kind === 'held' && l.state === 'none') pushed = false;
    else if (l.kind === 'push') pushed = true;
    else if (l.kind === 'server' && l.id === 'crash') up = false;
    else if (l.kind === 'server' && l.id === 'boot') { up = true; steadySince = l.at; }
    else if (l.kind === 'link') {
      measured = l.state === 'measured';
      if (measured) steadySince = l.at;
    }
  }
  return null;
}

function rungNeverFalls(lines: readonly SequenceLine[]): Violation | null {
  let key = '';
  let open = false;
  let sawTwo = false;
  for (const l of lines) {
    if (l.kind === 'server' && l.id === 'boot') { open = false; sawTwo = false; }
    else if (l.kind === 'episode' && l.state === 'open') { open = true; sawTwo = false; key = l.id; }
    else if (l.kind === 'episode' && l.state === 'closed') { open = false; sawTwo = false; }
    else if (l.kind === 'verdict' && open) {
      if (l.state === 'rung-2') sawTwo = true;
      else if (l.state === 'rung-1' && sawTwo) {
        return { invariant: 'CB-rung-never-falls', seq: l.seq, message: `episode ${key} pushed a lower rung after rung 2` };
      }
    }
  }
  return null;
}

export const COORD_BLOCKED_INVARIANTS: readonly Invariant[] = [
  { name: 'CB-reach', says: 'a mail held past the threshold reaches the operator within one sweep, unless the link is unmeasured; the clock stops while the server is down and restarts at its boot', check: reach },
  { name: 'CB-rung-never-falls', says: 'between two boots, inside one open episode, no rung-1 verdict follows a rung-2 one', check: rungNeverFalls },
];
