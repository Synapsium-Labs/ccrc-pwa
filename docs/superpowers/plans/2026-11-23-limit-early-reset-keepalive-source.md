# The keepalive's turn measures, and it measures beside sessions that wait: plan

A follow-up to `2026-11-22-limit-early-reset-empty-account-and-wait.md`. That plan's "What stays open" for gap 1 named
two things the code could not close without the operator: the keepalive measures nothing on a fleet, because a `-p`
turn renders no statusline, and it refuses an account whose only sessions are blocked at the limit. This plan closes
both. It delivers D-6185's source (spec `2026-10-21-auto-swap-reliability-design.md` §3.7, D7) and a narrow part of its
occupancy rule.

## The operator's direction of 2026-11-23

Asked about the open plan, the operator answered: "why is it waiting on me? is the work done?" It is read as: decide and
build. That releases the two gates the earlier plans held this behind: OA-S4 (the stream-json measurement and the
concurrency measurement, `2026-10-21-auto-swap-reliability-w1-w2.md`) and spec §3.7's occupancy question. Neither
measurement was taken on a fleet; what each one would have answered is stated below as an assumption, with the fleet pass
that confirms it.

## Change 1: the turn's figures reach the writer (D-8957)

### What was measured

- The turn was `<wrapper> -p <prompt> --model <model> --output-format json`. Print mode renders no statusline, and the
  json result object carries no rate limits, so `~/.cc-limits/<account>.json` never moved: the last ten passes on a
  fleet held no `refreshed` outcome (re-measured 2026-11-22).
- Spec §3.7 rules the source: `-p --output-format stream-json --verbose`, a rate-limit event carrying utilisation and a
  reset for both windows, built into `{"rate_limits":{"five_hour":{…},"seven_day":{…}}}` and piped to
  `statusline-command.sh` under the account's config dir. This plan departs from "both" in one case only, a plan with
  no five-hour window (rule 2 below).
- The shape, read from the installed Claude Code build's own schema and code (2.1.330, on the builder's machine; no
  credentialed turn was taken): print mode emits `{"type":"rate_limit_event","rate_limit_info":{…}}` when rate-limit
  information changes, and the first response carrying the headers is such a change. `rate_limit_info.unifiedWindows`
  carries `five_hour` and `seven_day`, each `{utilization, resetsAt}`: `utilization` a fraction of the window,
  `resetsAt` epoch seconds, from the `anthropic-ratelimit-unified-*` response headers. Claude Code's statusline builds
  its own `rate_limits` from the same values: `used_percentage` is the fraction times 100, to one decimal, rounded half
  up, at most 100. The top-level `utilization` and `rateLimitType` describe only the window that limits, so they are
  not a source for both.

### The rule

1. The turn asks for the stream: `--output-format stream-json --verbose` (print mode prints the stream only with
   `--verbose`). Its `result` line still carries the price the census reports.
2. After the turn, `_ka_feed` takes the newest `rate_limit_event` whose `unifiedWindows` names the weekly window
   (`seven_day`, with a numeric `utilization` and `resetsAt`), and builds the payload a render hands the writer,
   `used_percentage` spelled as Claude Code spells it. The five-hour window goes in when the event names it the same
   way: a plan with no five-hour window renders `seven_day` alone, and the writer reads that as such (D-8120's
   `fiveAbsentSince`), so the event, the same reading, gives the same payload.
3. No weekly window is no source: the writer reads a payload with no weekly figure as `"seven":0`, a measurement nobody
   made.
4. The payload is piped into `$HOME/.claude/statusline-command.sh`, the one writer, where `ccrc update` places it. It
   runs in a subshell of its own, under the turn's config dir and with `CCRC_KEEPALIVE_PROBE` set to the second the
   turn started (D-8943's marker, so a lower reading lands). It gets no credential (only the turn's subshell sources
   one) and no `TMUX_PANE` (so it is a render with no ccd id). It is bounded at 10 seconds, and its status line is
   discarded.
5. The writer decides as it does for any render. Whether the row moved is judged as before: `ts` advancing is
   `refreshed`, anything else `no-render` or `failed`.

### What is assumed, and what the first fleet pass must show (D-8959)

- **Assumed:** the fleet's Claude Code build emits `rate_limit_event` with `unifiedWindows` in print mode, for a
  setup-token lane, on the turn's first response. The field is described as internal in the build's schema, so a
  later build may move it.
- **The census says which half failed.** A row that did not move says why: `its stream carried no rate-limit event with
  a weekly window` (the source is wrong on that build), `the writer was handed the turn's figures` (the writer kept the
  row by its own rules), or `the turn's figures had no writer at $HOME/.claude/statusline-command.sh`.
- **The first fleet pass after deploy must show** `refreshed` for an idle measured account whose row is older than
  `CCRC_KEEPALIVE_FRESH`, in `~/.ccrc/keepalive.json`, with `fiveAfter` set. That is OA-S5. A `no-render` that names the
  stream means the build does not carry the field: the source is then parked, as spec §3.7 says, and the interactive
  source goes back to the operator. Nothing else changes in that case: the turns are the ones the keepalive took
  before.

## Change 2: an account whose every session waits at the limit gets the turn (D-8958)

### What was measured

- `_ka_session_on` refused a turn on an account any registered session sits on: a fresh supervisor heartbeat, a live
  pane, or a pane it cannot measure. A session stopped at a limit has a live pane and a ticking supervisor, so its
  account was always refused. It makes no API call, so its own reading never changes. When every account is exhausted
  and every session waits on its own, an early reset of all of them is seen by nobody.
- The owner of "this session has stopped at a limit and has nowhere to go" is the limit watchdog (`ccd limit-watchdog`,
  D-8123, once a minute). Its records are `$REG/<id>.limitsign` (`<since> <sign>[ <flag>…]`, read by `_wd_record_read`)
  and `$REG/<id>.limitwait` (one writer, `_limitwait_open`/`_limitwait_close`). A `pane`, `banner`, `menu` or
  `transcript` sign is a session that has stopped. An `account` sign is an account that reads high, and that session
  may still be working (`_wd_running` holds it).

### The rule

1. A session on the account is **waiting at the limit** when all of these hold:
   - its `.limitsign` holds a stopped sign (`pane`, `banner`, `menu` or `transcript`), in the watchdog's own grammar
     (`_wd_record_read`'s pattern), dated no later than now;
   - its `.limitwait` is open and names this account, in the open-record grammar of `_limitwait_choose`. Its own
     `sign=` is not read: `_limitwait_open` keeps an open record for the same account as it is, so a wait opened on an
     `account` sign keeps it after the session's next turn hits the limit, and the current `.limitsign` is what says
     the session stopped;
   - its turn marker (`$REG/<id>.turn.json`, the session hook's) reads a turn that has ended, `done` or `failed` (a
     limit ends a turn by StopFailure, `rate_limit`). This is the current reading that confirms the watchdog's records,
     which are as old as its last pass: the watchdog re-stamps neither while a sign holds, and a pass that is off,
     starved by its 40-second budget, or cannot measure the session leaves them as they are. A prompt or a tool call
     writes `working` before the session's next API call. An absent or unreadable marker is no confirmation;
   - no move was stamped on it in the last 120 seconds (`lastswap`; read after the records). An in-place resume stamps
     `lastswap` before its unit starts and clears both records after, so a restart that is under way is not a wait. A
     `lastswap` that does not read as an epoch is unmeasured, and holds, as it does for ccd's hibernate.
   Each file is refused as a symlink or as anything but a regular file, and matched, never evaluated. The three
   patterns are ccd's own, text for text, and `keepalive-limit-record-parity.test.ts` holds them equal, so a field the
   watchdog adds reds a suite instead of quietly turning the exception off.
2. A waiting session is not counted as sitting on the account **only when its pane is live**: the pane is asked first,
   and any other answer is judged as before on that same answer. So a dead pane with a fresh heartbeat (`restarting`:
   the supervisor is about to respawn `claude`) and an unmeasurable pane still refuse the turn, as spec §3.7 keeps them.
   Every other session is judged as before: a fresh heartbeat, a live pane or an unmeasurable pane refuses the turn. So
   the account gets the turn only when every live session on it waits, and never beside a session that is working.
3. The census row of a turn taken beside waiting sessions names them.
4. `$REG/keepalive-heartbeat-occupied` (any file, the `-e`/`-L` test; the name the w1-w2 plan gave D-6185's off
   marker) restores today's answer: a waiting session holds the account again. Absent is the rule above. It is the
   operator's no-deploy rollback; nothing in the tree writes it.

The reader decides nothing of its own: it reads the watchdog's two records in the watchdog's grammar. Why both: the
sign says the session has stopped now (the watchdog re-measures it every minute), and the open wait says no account had
room and binds the wait to this account. A wait stays open until a pass finds no sign at all, so a session that went
back to work on an account that still reads high carries an open wait beside an `account` sign; the sign is what
refuses it.

### The one-config-dir hazard

The keepalive's header refused a second `claude` under one `CLAUDE_CONFIG_DIR`. Spec §3.7 asked for a measurement first
(credential refresh and rotation on setup-token lanes, the shared config and history files). It was not taken. What
holds without it: a setup-token lane takes its credential from the environment, so neither process refreshes or
rotates a stored one; the turn runs in its own empty working directory; and many fleet sessions already share each
account's config dir, so concurrent `claude` processes under one config dir are the fleet's ordinary state. The
exception adds one `-p` process beside processes that are idle at a limit, never beside one that is working.

## Cost

Keepalive turns are paid from the account's own subscription window. The source adds no turn: the turns are the ones
the keepalive took before, and now they measure. The occupancy rule adds turns only on an account whose every session
waits at the limit with no room, under the same gates: at most one turn per account per `CCRC_KEEPALIVE_FRESH` (30
minutes by default), the attempt throttle, and the failure backoff, which settles at one a day after about nine failed
turns. That is at most 48 turns per such account per day, each at the cheapest model with an empty prompt and an empty
working directory, and only while the watchdog records the wait. A probe that finds the account still exhausted costs
one minimal turn; the census reports each turn's price.

## What did not change

- No interactive turn, no key, no pane: the turn is `claude -p` with stdin closed, in a process of its own, and nothing
  here reads a pane's text or types into one.
- Cadence, backoff, lock, credential handling and the writer's rules are untouched. The writer is still the only one,
  and a `-p` turn that renders, if a build ever does, still writes through it as before.

## What stays open

- **The source is unmeasured on a fleet** (above). Until the first pass shows `refreshed`, the source is an assumption
  read from one build's schema.
- **A turn with no hook event.** The turn marker is written by the session hook on a prompt, a tool call, a Stop and a
  StopFailure. A session that went on after a reset without any of them (ccd's spawns pin auto-continue off, so Claude
  Code does not continue by itself there) would still read as waiting until the watchdog's next pass clears its sign.
- **A resume that starts during the turn.** A dated reset can pass while the turn runs (at most the turn's timeout,
  120 s), and the watchdog may then restart a waiting session beside it. Nothing shares a lock between the two.
- **A still-limited account reads `refreshed`.** A probe on an account that is still at its limit, if Claude Code
  answers it with both windows, advances the row: the reading is real, and it clears the failure streak, so such an
  account stays at up to one turn per 30 minutes and does not back off. This assumes a turn the limit rejects costs no
  usage; the census reports each turn's price, so the first passes show it.
- **The backoff** still asks an account whose probes fail once a day.
- D-6185's wider occupancy rule (a live idle pane reads clear, a parity copy of `_ws_status`'s busy reading) is not
  built: only a session the watchdog records as waiting is excepted.

## Tasks

1. Tests first (`server/test/telemetry-keepalive.test.ts`; the suite runs on Linux): the stream reaches the real writer
   and lowers a row at the ceiling with the probe marker; the newest event naming the weekly window wins; no weekly
   window is no source; the census tells "no event" from "the writer kept the row" from "no writer"; every session
   waiting gives the turn and the row names them; a working session beside a waiting one still refuses; an `account`
   sign, a wait for another account, a closed wait, a sign with no open wait and a move in the last two minutes each
   still refuse; the marker restores today's answer, in both directions. The review round's cases are in task 4.
2. `ccd/ccd-telemetry-keepalive`: the stream flag, `_ka_feed`, the reasons, `_ka_waits_at_limit` and its use in
   `_ka_session_on`, the header's amended rules. `ccd/statusline-command.sh`: one comment.
3. Remove or weaken each new condition in turn and read the red tests:

   | Mutant | Red |
   |---|---|
   | the writer's subshell drops the probe marker | both-windows lowering; newest event |
   | `_ka_feed` not called | both-windows lowering; newest event; the two reason cases |
   | the writer not run (the payload goes nowhere) | both-windows lowering; newest event |
   | one window accepted alone | no weekly window is no source |
   | the oldest event taken | newest event |
   | the reasons collapsed | the census tells the halves apart |
   | no waiting exception | every session waits; working beside waiting; the marker |
   | one waiting session clears the account | every session waits; working beside waiting |
   | an `account` sign accepted | the `account` sign beside an open wait |
   | the account binding ignored | a wait for another account |
   | a closed wait accepted | a closed wait |
   | no open wait required | a sign with no open wait, and three others |
   | `lastswap` ignored | a move in the last two minutes |
   | the marker ignored | the marker restores today's answer |

4. The review round (below) added these, each measured red under its mutant on Linux:

   | Mutant | Red |
   |---|---|
   | the turn marker not required | a running turn is not a wait; the parity suite's "read only here" |
   | a `working` marker accepted | a running turn is not a wait |
   | the marker's file not required to be a regular file | a symlinked `.turn.json` |
   | a wait taken without a live pane | restarting holds; unmeasurable holds |
   | the waiting check before the pane is asked (the first build's order) | restarting holds; unmeasurable holds |
   | a wait opened on an `account` sign refused (the first build's pattern) | that wait is a wait; the parity suite |
   | the five-hour window required | a weekly window alone is handed to the writer |
   | the weekly window made optional and dropped when absent | no weekly window is no source |
   | any `lastswap` file read as a recent move | a move an hour old does not stop a wait |
   | the `lastswap` window widened to about 11 days | a move an hour old does not stop a wait |
   | an unparseable `lastswap` read as a wait | an unmeasured move holds |
   | the symlink refusal dropped | the three symlinked records |
   | a sign dated ahead of now accepted | a sign dated ahead of now |
   | the writer keeps `TMUX_PANE` | the writer runs as a render with no ccd id |
   | the writer unbounded | a writer that hangs is cut off |
   | the price read as the old json object | the price past a line that is not JSON |
   | the percentage unrounded, or uncapped | the percentage is spelled as Claude Code spells it |
   | the account binding ignored | a wait for another account |
   | an `account` sign accepted | the `account` sign beside an open wait |
   | the off marker ignored | the marker restores today's answer |
   | the keepalive's wait pattern drifts from ccd's | the parity suite |

   One mutant stayed green and is equivalent: the weekly window made optional while the payload still names it. jq
   then fails on the missing window's arithmetic and hands the writer nothing, which is what the rule does.

## The review round

Two reviews of the first build (a correctness lens and a test lens). Every finding was checked against the code; all
were accepted.

- **The watchdog's records go stale, so a probe could run beside a working session** (medium). The watchdog re-stamps
  neither record while a sign holds, and a pass that is switched off, starved by its budget, or cannot measure the
  session leaves them. Fixed: the turn marker must read an ended turn (rule 1 above).
- **The exception skipped `restarting` and the unmeasurable pane**, which spec §3.7 keeps occupied (low-medium). Fixed:
  the pane is asked first and only `live` is a wait (rule 2).
- **A wait opened on an `account` sign was refused** although the current sign proves the stop (low). Fixed: the wait's
  own `sign=` is no longer read, and its pattern is now `_limitwait_choose`'s exactly.
- **A weekly-only event was refused**, though a render on a plan with no five-hour window gives the writer exactly that
  (low). Fixed: the weekly window is required, the five-hour one is optional.
- **An old `lastswap` was untested, and an unparseable one failed open** (medium). Fixed and pinned: an hour-old move
  still gets the turn, and an unparseable one holds.
- **A second copy of the watchdog's grammar with no parity pin** (low-medium). Fixed: the three patterns are named
  variables, held equal to ccd's by `keepalive-limit-record-parity.test.ts`.
- **The symlink refusal, the date check, the writer's isolation and bound, the percentage's rounding and cap, and the
  price's reading were untested** (low and info). Each now has a case, measured red under its mutant (table above).

## Deviations found

- **D-8957 (2026-11-23)** — keepalive-turn-figures-reach-the-writer. The keepalive's turn asks for Claude Code's stream,
  and the newest rate-limit event that names the weekly window is piped into the account row's one writer in the shape a
  render gives, with the probe marker. Delivers D-6185's source (spec 2026-10-21 §3.7).
- **D-8958 (2026-11-23)** — keepalive-probes-an-account-whose-sessions-all-wait. A session the limit watchdog records
  as stopped at a limit, with an open wait on that account, a turn marker that reads an ended turn, a live pane and no
  move in the last two minutes, is not counted as sitting on the account; every other session still refuses the turn,
  and so does a restarting or unmeasurable one. `$REG/keepalive-heartbeat-occupied` restores the
  rule without the exception. By the operator's direction of 2026-11-23.
- **D-8959 (2026-11-23)** — keepalive-census-names-the-missing-half. A keepalive row that did not move says whether the
  stream carried no event with a weekly window, the writer kept the row, or no writer was found, so the first fleet pass
  after deploy (which must show `refreshed`) tells a wrong source from the writer's own rules.
