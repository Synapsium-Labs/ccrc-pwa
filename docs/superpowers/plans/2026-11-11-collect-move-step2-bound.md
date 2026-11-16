# The collect move's step-2 vanish case fits its timeout beside a fork-churning neighbour

- **D-8280 (2026-11-11)** — `server/test/ccd-ws-collect-move.test.ts`'s step-2 vanish case ('nothing stands at step 2's lstat') drives the verb through the fixture's `evalSays` seam instead of a real audit plus a real present-leaf evaluation, so it no longer runs the `/proc` in-use walk at all; its retry half (the audit's witness-without-leaf arm, then the verb's witness-only drop) stays wholly real. `ccd/ccd` is unchanged.

## Why

The case timed out at vitest's 20 s in merge group 42986805207 (server shard 9/12, 22.0 s). On most runs it takes
about 2 s; on some it takes 7 to 22 s.

## Measured, not assumed

The case's time beside two of its neighbours in the same file, per merge-group run (vitest's own per-test time in the
job log), and whether it overlapped `session-hook-append-race.test.ts` > 'the shipped append loses no line while the
drain renames the file away and a sibling creates it, eight races at once' (below: "the race"), which vitest runs in
parallel with it when the two files land in one shard. 'another directory' is the third swap case, which runs just
before it and drives the real evaluation; 'an absence' runs just after it and stubs the evaluation.

| run | another directory | the vanish case | an absence | the race beside it |
|---|---|---|---|---|
| 42934429340 | 1225 ms | 2079 ms | 435 ms | other shard |
| 42949857153 | 1017 ms | 1685 ms | 356 ms | other shard |
| 42964054790 | 1302 ms | 2156 ms | 469 ms | same shard, started after the vanish case |
| 42965976933 | 2096 ms | 7164 ms | 5070 ms | vanish case overlaps its file's first cases and the race's first 4 s; 'an absence' wholly inside the race |
| 42972269282 | 9281 ms | 15797 ms | 581 ms | race 06:38:56.2-06:39:20.8; 'another directory' 06:38:55.6-06:39:04.9 and the vanish case 06:39:04.9-06:39:20.7 inside it; 'an absence' after it |
| 42980275120 | 1045 ms | 1789 ms | 370 ms | same shard, started after the vanish case |
| 42986805207 | 5326 ms | 22033 ms (timed out) | 556 ms | race 08:38:27.1-08:38:53.2; 'another directory' 08:38:25.4-08:38:30.8 and the vanish case 08:38:30.8-08:38:52.8 inside it; 'an absence' at its last half-second |
| 42989444079 | 1423 ms | 2163 ms | 480 ms | same shard, started after the whole collect-move file |

(The race's window is its file's end minus the per-case times that follow it; the job log stamps each case's start.)

So the runner as a whole was not slow: every case outside the race's window runs at or near its normal time, the
real-evaluation cases of the same file that start after the race ends in 42986805207 (after 08:38:53) are back at
about 1.6 to 2.7 s, and every slow sample sits inside the race's window. The race runs eight append-and-drain loops at
once for about 25 s, a constant stream of short-lived forks.

That stream is what the real evaluation is most exposed to. Its in-use probe, `_ws_path_users_many` in `ccd/ccd`, is
a fixed-point walk of `/proc`, never one snapshot: it reads every pid's environ, cwd, fds and map_files, then lists the
table again until a listing names no pid this walk has not read, and only `WS_PATH_USERS_SCAN_S` (10 s per walk)
bounds it. Under the race a listing can keep naming new pids, so a walk keeps re-reading the table until one listing comes back clean. The old vanish
case ran two such walks (the audit's evaluation and the verb's), the swap cases run two each. The earlier claim that
nothing on the path polls was wrong: this walk is the path's poll loop.

The race also slows a case that never walks: in 42965976933 'an absence', stubbed, took 5070 ms inside the race
against its usual 0.4 s. So the fork churn costs every shell something, and the data cannot separate that general cost
from the walk's own re-listing; the walk is the part that grows with how long the race keeps forking, and it is what
the slow cases share.

## The bound

The first verb now runs with `evalSays(WRONG_TOKEN)`, the seam this file's other step-2 and step-3a cases already use
to pin the verb's own guards past the evaluation; the swap cases above still drive the real evaluation into the same
`consented` gap. The case loses the audit shell and both real evaluations, so it runs no `/proc` walk at all: the
retry audit and the retry verb take the absent-leaf arm, which answers before the in-use probe. Its work is now four
light shells, about twice 'an absence': about 1 s on a quiet runner, and, by 'an absence''s 5 s inside the race,
about 10 s at worst under full overlap, against 15.8 s and 22.0 s (timed out) before. It no longer depends on
whether a walk converges.

## Deviations found

- The task expected a sleep, poll, backoff or lock wait on the step-2 path. The step-2 lstat, its `_ws_reclaim_absent`
  proof and the refusal are a handful of `stat` calls, and the reap lock is `flock -n`. The poll loop is upstream of
  step 2, in the real evaluation's in-use walk, which re-lists `/proc` until it converges (above). The bound removes
  that walk from this case through the existing `evalSays` seam; no delay is shortened and `ccd/ccd` is unchanged.
- The file is not yet bounded as a whole. The three swap cases ('a symbolic link', 'a regular file', 'another
  directory') still run two real walks each and stay exposed to the same race: 'another directory' reached 9.3 s in
  42972269282. They are the next timeout candidates. A walk that outran its own 10 s bound would also answer
  unmeasured, which would fail their witness-mismatch assertion rather than the timeout.
- No darwin-runnable test is added: the collector is Linux-only (`_ws_collect_mv` answers 2 on Darwin), and the case
  itself stays `describe.skipIf(!LINUX)`. The pull request's Linux CI is the proof.
