# Settings audit: what goes, what is derived, what stays

Date: 2026-11-22. Scope: every setting, parameter, hand-touched file and manual act in the product, read from a checkout of `main`.

## In short

- The product has about **475** distinct settings and manual acts today, after merging the ones that were listed twice.
- **311 go.** The behaviour is fixed in the code and nobody chooses it.
- **80 are derived.** The system measures or computes the value itself.
- **30 stay with a default.** They work untouched. Most users never see them.
- **31 stay as the user's own choice.** Almost all of them are asked once at set-up.
- **23 stay as stops.** They move out of Settings to the place where the thing they stop lives.

So 391 of 475, about 82 in every 100, disappear from the user's view (removed or derived).

The principle has four parts.

1. **Shadow is a release stage, not a user act.** A new lane ships in shadow, the publisher reads the shadow record, and the next release ships it live. No box arms anything. This one habit produced about 45 of the settings in this audit.
2. **A number is a constant.** Timeouts, retention counts, batch sizes and paths are fixed in the code. If one is wrong, a release fixes it for everyone.
3. **A machine fact is measured.** Memory, cores, addresses, time zone, tool paths and a repository's visibility are read, never typed.
4. **One stop per kind of harm.** Four fleet-wide stops, each with a console button, replace about 20 per-lane off files.

How the counts were made: each row in the tables below carries its own count, and the totals are the sums. Three challengers reviewed the first verdicts. I re-read the code for every row they disputed. The undisputed rows carry the first readers' findings.

## What a user still sees after this

Settings shrinks from five sections to three short pages: Appearance, Security and Updates. The Automation section goes entirely, and Notifications has nothing left to hold.

### Set-up (once)

| What | n | Where it is asked |
|---|---|---|
| What this box is for: server, fleet or both | 1 | The installer |
| A second box: the other box's address (one pairing step writes the rest) | 1 | The installer |
| Public access: the public name, the dynamic DNS secret, and the printed root steps | 3 | `ccrc expose`, folded into the installer |
| The console passphrase | 1 | The installer |
| Passkeys: add this device, revoke one | 1 | Offered once after the first sign-in; the list stays in Security |
| Accounts: add one, sign in again when the provider forces it, remove one | 3 | The Accounts screen, the one door |
| Projects: the repository and a name | 1 | Add project |
| Approvals on a single box: sign them here, knowing sessions run beside the key | 1 | One question at a single-box install |
| Accept a new approval signing key | 1 | One confirm in Security, rare |
| Optional: a test box (its address, the access line and fingerprint confirm, Disconnect) | 3 | The test box page |
| Optional: Linear (a key per workspace, one confirm before the tracker is reshaped) | 2 | Security; the confirm arrives as a Waiting on you item |
| Optional: the Overlord (start or retire it, a key for the decision model) | 2 | One tap in set-up |
| Optional: the cloud provider's API token for Reboot | 1 | Security, as a secret |
| Optional: command-line rollout coordinates (two ssh addresses) | 2 | A file on the operator's machine; the console update needs none |
| Optional: the Mac screenshot helper's box address | 1 | Its own file |
| History store full: remove history older than a chosen age | 1 | A Waiting on you item with one tap, only at the cap |
| Publisher only: promote a release to stable, tag a minor release | 2 | The publisher's git, never a user's box |

### Preferences

| What | n | Where |
|---|---|---|
| Theme | 1 | Appearance; default follows the system |
| Push notifications for this browser | 1 | Asked once per device; the header bell is the only toggle |
| Sign out | 1 | Security |
| Priority between programmes | 1 | The portfolio view; works with nothing ranked |

A few optional controls also stay where the thing lives, each with a default that is already right: the workers cap on Runs, a session's model, pool tags on accounts and projects, a workspace hold, the Overlord's model, accounts and authority, and a privacy toggle for history capture. They are listed under "Kept with a default".

### Emergency stops

Four fleet-wide stops sit in one Stop panel on the fleet banner. A stop that is standing shows there, not in Settings.

| Stop | n | Where it lives |
|---|---|---|
| Pause coordination: no run is dispatched | 1 | Stop panel (button exists today) |
| Stop mail: nothing is delivered or dispatched | 1 | Stop panel (needs a console writer; hand file today) |
| Pause cleanup: nothing is deleted, put to sleep, rolled or swept | 1 | Stop panel (pause and resume in one place) |
| Roll back the fleet to an earlier release | 1 | Updates, under "Something went wrong" |
| Approvals off | 1 | Security, one switch for both boxes |
| Clear a refused update (Ack) | 1 | Updates, only for a signature refusal or a repeated failure |
| Hold this Claude Code build | 1 | Updates |
| Idle-only mail (`mail-gate-strict`) | 1 | Terminal brake, shown in the Stop panel while it stands |
| Stall watch off (`stall-watch-disabled`) | 1 | Terminal brake, shown in the Stop panel while it stands |
| Autocompact off (`autocompact-disabled`) | 1 | Terminal brake, until the continuity lane owns compaction |
| Account on or off | 1 | The account card |
| Move a session to another account | 1 | The session menu |
| Revert a model class after an automatic advance | 1 | The Models sheet |
| Renew now; cancel a session timer | 2 | The session page |
| Overlord: Pause, clear a tripped latch, stop asking the decision model | 3 | The Overlord's chat header and the item that announced the trip |
| Rotate the box token now; sign out everywhere | 2 | Security |
| Reboot the fleet host | 1 | The fleet host banner |
| Restore coordination data (one verb that knows which files to leave) | 1 | Recovery docs |
| Publisher only: demote a release | 1 | The publisher's runbook |

## Removed and hardcoded

### Settings > Automation

| Setting | n | Fixed at | Why |
|---|---|---|---|
| Stall watch level (seven-way radio) | 1 | Alert: check a quiet worker, tell its coordinator, push the operator. The two top steps join by release. | The ladder is a staged roll-out written as a permanent setting. Today an untouched box tells nobody about a stalled worker. |
| Stall watch quiet time | 1 | 2 hours | A tuning number. |
| Stall arming files (`stall-watch-live`, `-escalate`, `-w2-live`) | 3 | Deleted | A second, older control for the same level. |
| Overrides in force card | 1 | No card. A standing stop shows in the Stop panel. | It has no control. Once the arming files go it has almost nothing to list. |
| Shadow-to-live arming files touched by hand: hibernate, expiry (two), stale archive, collector (legacy and loose), orphan trees (two), nested rescue, drift push, child reclaim (two), deps shed, landing checks, scope sweep, roster card, run-close overrides (three) | 19 | Live, each in the release named under "Risky removals" | Arming is the publisher's job. A user who does nothing should get the behaviour. |
| Per-lane off files: asks, stop-done, child reclaim, idle nudge, landing, hibernate | 6 | Lane always on. The four stops cover them. | Narrower copies of a stop that already exists. Two of the six need a small code change first (see "Risky removals"). |
| Session hook flags: graph gate, product card, compaction card | 3 | On | Internal feature flags. |
| Mail gate busy and busy-shadow files | 2 | Deleted. The stall level sets the mode. | Roll-out steps for one behaviour. |
| Shadow lanes rows: Roster card, Park permission prompts, Sleep waiting workers, Count only working workers | 4 | Roster card live now. Park prompts row removed until its dependency ships. The two capacity rows stay shadow this release and go live together by release. | Arming switches. One of them cannot even be set. |
| Replay quiz Confirm, Discard and Withdraw | 2 | No operator step. The weekly run already records and confirms itself. | A hash compared by eye to unlock other switches. |
| Dispatches that never came back, and its age line | 2 | On, 15 minutes | Off only means "I will do it by hand". |
| Browser tools: box default, server list, per-session menu | 3 | Off at start. A session that needs a browser gets one on request. | Four surfaces for one thing whose default is right. |
| Roll idle sessions | 1 | Every idle session | "Coordinators only" is a reversed old rule. Off is the cleanup stop. |
| Auto memory for plain sessions | 1 | Off for every role | Memory is per account, and sessions move across accounts. |
| When soft renewals happen | 1 | At a break in the operator's activity | A scheduling nuance. The hard triggers bound it. |
| Leftover processes: stop at a deliberate stop, stop busy leftovers | 2 | Live | A stopped session that leaves processes behind is a leak. |
| Leftover sweep's own pause file | 1 | Folded into Pause cleanup | A second pause for one kind of harm. |
| Worktrees left behind | 1 | Kept, wherever the fleet box supports it | Nobody would choose to have finished work deleted. |
| Backups card and transcript-folders card | 2 | Status lines on the health view | They are statuses, not settings. |
| Backup state directory and stale hours | 2 | One fixed directory under the product's state folder; 36 hours | The user's backup job can write to the product's directory. |
| Run-close groups on Runs > Advanced (never started, coordinator crashed, coordinator gone) | 3 | Shadow this release, on by release | Three more three-state arming controls. Both pauses already hold them. |
| Review-round cap: the operator's lift | 1 | Cap 3 per grant. The coordinator lifts and the operator is told. | The coordinator's own lift is already always on. Two doors for one lift. |

### Test box

| Setting | n | Fixed at | Why |
|---|---|---|---|
| The Settings panel (about forty fields labelled with variable names) | 1 | Removed | It exists only because the keys do. |
| Fleet-side keys: token and key paths, size bounds, deadlines, queue numbers, budget, lost-run and fallback behaviour, deny globs, poll, times path | 14 | Today's defaults | Tuning numbers and paths. Deny globs: a git-ignored file never leaves the box, and a hit only makes the run local. |
| Box-side keys: paths, timers, retention, retry schedule, users, loopback proxy, mirror, egress list, registry, forwarded names, probe settings | 26 | Today's defaults. Root and repository paths use the absolute ones the form already starts from. | The table's home-relative path defaults cannot be installed. The egress list accepts only its three fixed hosts. The registry proxy has no sign-in path. |
| Replace and Revoke key | 2 | Disconnect, then Connect. Disconnect always deletes the key. | Two buttons that differ by one deleted file. |
| Capture again | 1 | Retried automatically at the next product release | Three failed replays need a fix, not a tap. |

### Appearance, notifications, updates

| Setting | n | Fixed at | Why |
|---|---|---|---|
| Character | 1 | Orb | A cosmetic pair that costs a server row and a sync queue. |
| Reader lab and Measure highlighting doors | 2 | Reachable by URL only | Developer tools. |
| Announce new releases | 1 | No push for a release that installs itself. Push only when an update needs the user. | Noise once updates are automatic. |
| Check now | 1 | Poll every 30 minutes and when the Updates page opens | A manual refresh of something the server does. |
| Per-node Roll back | 1 | One Roll back for the fleet | A second entry to the same door. |
| Per-node channel and pinned version | 1 | Fleet scope only. Only a rollback writes a pin. | One fleet, one version. |

### Accounts, sessions, linking

| Setting | n | Fixed at | Why |
|---|---|---|---|
| Models sheet Hold and Release | 1 | Always advance. A Revert holds until something newer appears. | Hold is the standing form of Revert. |
| Switch sign-in method | 1 | The long-lived token, which is already the default the door opens on | The sign-in method is the one that keeps asking to sign in again. |
| Roster file fields edited by hand | 1 | Written by the add flow only | Plumbing. |
| Request path of a second-provider lane, and its wait | 2 | The product's own bridge, migrated at update | Two implementations of one job. New lanes already get the bridge. |
| Session effort | 1 | The default for the model class | A second dial beside the model. |
| New session routing row (four selects) | 4 | Defaults. Change the model from the session menu. | Four dials on the most common act. |
| Fleet class chooser | 1 | Automatic | A forecast filter that doubles as a hidden setting. |
| Route fields with no console control (subagent model, compact) | 2 | Routing defaults | Internal tuning. |
| Hand-placed no-hibernate and no-roll files | 2 | No hand path. Only the system's own keep-awake writes them. | Both lanes already hold anything with work, mail, a viewer or a scheduled wake. Sleep is reversible. |
| Wait until reset | 1 | The watchdog's own wait | The tap only makes a session wait longer. |
| Decision model daily ceilings | 1 | 600 per row, 3000 in total | A cost guard nobody can pick. |
| Overlord response retention | 1 | 180 days | Remove it before its Settings row is built. |
| Per-project admin-merge allowance file | 1 | A raw admin merge is always refused. The door is the one way. | Two mechanisms for one act. |
| Linear legacy single-key row | 1 | Migrated into a workspace slot at update | Two kinds of row for one credential. |
| Experiment and debug files of a second-provider lane | 7 | Product decides by release; recording is a diagnostics verb | Request shaping and debugging aids. |

### Environment lines (the box's env files)

| Group | n | Fixed at | Why |
|---|---|---|---|
| Backups and updates: keep counts, health wait, deadline, models budget | 6 | Today's values | Retention counts and timeouts. One of them is read by two programs from three places. |
| Test slice: swap, weights, wide-files threshold, pressure threshold | 5 | Today's values; one shared pressure rule later | cgroup tuning. Three settings answer "wait under pressure" on three scales. |
| Code graph: store, source ref, exclusions, intervals, budgets, timeouts, thresholds | 22 | Today's values | Scheduler and heuristic numbers. The exclusion list wants internal keys no user knows. |
| Usage keepalive: model, prompt, freshness, turn bound, backoff | 7 | Today's values | It should always be the cheapest possible ping. |
| Usage sweep days, carry-copy warning | 2 | 7 days, 10 GiB | A window and a warning threshold. |
| Memory gate and update sweep: pressure word, headroom, batch, wait | 4 | Today's values | A protective gate should simply be on. |
| Limit rescue: jitter, watchdog minutes | 2 | 15 s, 5 min | The rescue is the point of the product. Its hidden off goes. |
| Deps shed: three server numbers, three box numbers | 6 | Today's values | One arm had seven controls. |
| Paths: projects root, roster, passphrase, sessions, passkeys, database, token (two names), home, graph engine | 10 | Today's defaults | A path override only creates ways for two programs to disagree. `ccd` already ignores the projects root override. |
| Push subject, release owner and repo, pool lease | 4 | Today's values | Internal. |
| Deploy script lines: ssh key, ssh port, env file path, service-worker denylist, roster seed, health URL | 6 | ssh's own configuration; defaults | Fallback-path plumbing. |
| Call bounds read from the environment (release fetch, account probes, doctor, verify, sweeps) | 28 | Today's values, test-injected only | Test-speed overrides reachable from a live environment. |
| Other timing and test seams (sync timeouts, sign-in helper, runtime install, poll, output form, verify script) | 13 | Today's values | Same. |
| `ccd` numbers: disk floor, temp budgets, conflict-radar bounds, landed label, lower-only bounds | 18 | Today's values | Tuning numbers and one label name. |

### Files touched by hand on a box

| File | n | Fixed at | Why |
|---|---|---|---|
| Idle hours before sleep | 1 | 6 hours | Already reasoned from the prompt-cache lifetime. |
| Mail-hold arming files (notice, refuse) | 2 | Live | Two files for one hold. Invisible to the console today. |
| Graceful stop | 1 | Measuring mode now; live by release once the wait is set from recorded exits | The wait is a number to measure once. |
| Carry dedupe | 1 | Live | Identical-only is lossless. |
| Temp sweep live arm | 1 | Live | Disk fills otherwise. |
| Swap brakes (pin expiry off, stagger off) | 2 | Pins expire; swaps are staggered | Revert levers for shipped changes. |
| Per-timer pause files (temp, usage, graph, account health, conflict radar, per-project radar) | 6 | Read-only timers always run. The temp sweep's pause folds into Pause cleanup. | Seven pause files where one stop is enough. |
| Conflict radar `lander` key | 1 | Deleted | Nothing reads it. |
| launchd class, tmux socket, project origins path | 3 | Standard class; defaults | The shipped launchd default can starve the server, so fix the default. |
| Per-repository graph noise list | 1 | The shipped list; a repository states its own in a committed ignore file | The refusal it worked around no longer exists. |
| History steering, headless and subagent files | 4 | Subagent transcripts ingested; steering and headless decided by release | Experiment switches. |
| Snapshot posture statement | 1 | No file; one informational doctor line | It only turns a warning off. |
| Screenshot helper: ssh key and `ccd` path | 2 | ssh's configuration; the installed path | Two of three values are not the user's. |
| Bridge upstream override | 1 | The provider's endpoint; test-injected only | A test seam. |

## Derived automatically

| Setting | n | Derived from |
|---|---|---|
| Temp root collector Off or Live, and "Confirm Live again" | 2 | Live when the box's `ccd` reports the two capabilities and the cleanup row is clear. Bound to the fleet node the server measures. |
| Continuity lanes: Renew long-lived sessions, Launch profiles, Anchor at every start | 3 | Each box arms them itself once its own weekly quiz run has recorded a baseline. |
| Test box remote runs switch | 1 | On when a box is connected and parity passes. Runs fall back locally and say why. |
| Test box: the address the box sees, the repositories, the durations source list | 3 | The preflight's own answer; the fleet's projects and lockfiles; the repository table. |
| Test box pairing keys: service URL, push URL, listen address | 3 | The one address typed at Connect and the fixed service port. |
| Test box sizes: runs at once, workers, memory and CPU per run | 4 | The box's cores and memory. |
| Chrome binary for browser tests | 1 | The build the product installs or finds. |
| Layout skin | 1 | The device rule (pointer and width), which is already the default. |
| Auto-install | 1 | On for every node that carries the update health gate. Off for a node that does not, which the console names. |
| Sign-in gate, relying-party id, origin, cookie flag | 4 | Armed whenever the box is exposed. All four follow from the one public name. |
| Linear: Check again | 1 | Re-checked when a call fails, when the page opens, and on a schedule. |
| Project linking: team key, workspace, Linear owner, initiatives, owning project | 5 | The evidence the server already reads. An undecidable project becomes one Waiting on you item. |
| Private tracker keys | 1 | Team keys of linked private projects. |
| Overlord: renewal backstop hour, daily digest hour | 2 | Morning in the operator's time zone, read from the signed-in browser. |
| Decision model line (threshold) | 1 | The strictest candidate that meets the row's target. |
| Private names list | 1 | Seeded from names the box already treats as private. An upload stays as an optional addition. |
| Keep awake | 1 | Follows the Overlord designation, as today. |
| New account: id, label and colour | 3 | A neutral provider-N, the plan read after sign-in, the next unused colour. |
| Account facts: placement, stated account, continuity record | 3 | How the lane bills; the sign-in that minted the token; the doctor's own check of each home. |
| Usage keepalive pause | 1 | Follows each account's own on/off switch. |
| Model registry of a non-Anthropic lane, and two request flags | 3 | The provider's catalogue at connect and at each refresh. |
| Session home account | 1 | Placement's choice at start. A manual move makes the new account home. |
| New session: account pick | 1 | The suggested account in the project's pool, preselected. |
| Finished delegated worktrees: Keep, Attach, Not delegated | 1 | Kept and attached automatically. Only an undecidable one asks. |
| A coordinator's workspace hold file | 1 | The programme's open runs; written by the coordinator's own verbs. |
| Fleet mode (local or remote) | 1 | The role chosen at install. |
| Two-box link: agent token, server URL, agent bind address, server bind address | 4 | One pairing step mints the token and writes both sides. |
| Web push key pair | 2 | Generated at first start. |
| Cloud server id for Reboot | 1 | Looked up with the token. |
| Release listing API address | 1 | The one mirror setting. |
| Work mounts for the disk alarm | 1 | The volume that holds the projects. |
| Exposure records: mode, measured address, DNS provider | 3 | Written by the exposure step, as today. |
| Server address for one command; installed tree path | 2 | The box's own files; where the script runs from. |
| Admin merge auto or off | 1 | GitHub: the door lands only where the fleet's identity is a repository admin, there is no merge queue, checks are green and no review requests changes. |
| Conflict radar per-project conf | 1 | Every project with a hosted remote; base is the remote's default branch. |
| Machine sizes: session swap ceiling, test slice memory and CPU, heavy test slots, graph workers | 5 | The box's memory and cores. |
| History store size cap | 1 | A share of the home filesystem, at most 50 GB. |

## Kept with a default

| Setting | n | Default | Why it stays |
|---|---|---|---|
| Update channel | 1 | Stable | The publisher's own soak fleet must follow dev unattended, or shadow lanes get no soak. It leaves Settings and becomes a set-up fact. |
| Install, Update all and per-node Update buttons | 2 | Automatic | Shown only when the automatic move refused a node. The manual path can move nodes the automatic one refuses. |
| Project visibility override | 1 | Automatic | One option stays, "treat as public", for a repository about to be opened. The "Private" option goes. |
| Overlord: model class, account set, authority | 3 | The cheaper class; every enabled account; the highest rung short of acting in the user's name | Cost, account separation and trust are choices a user recognises. None is a required field. |
| Decision model gates | 1 | Shadow starts by itself; advice rows arm themselves | A row that gates what the Overlord may do is armed once by the operator, behind the step-up. |
| Organization label | 1 | Not set | Nothing measures it yet. It goes when the measured arm is built. |
| Account pool tag, project pool tag, cross-pool override | 3 | Untagged; off | Some deployments keep work for different parties on different accounts. |
| Costliest model class is included in this account's plan | 1 | Not set, read as "bills credits" | Nothing measures it. The safe direction spends nothing unasked. |
| Session model class | 1 | Automatic | Putting one hard task on a stronger model is a real choice. |
| Workspace hold | 1 | Not held | With every cleanup lane live, it is the one way to say "leave this one". |
| Workers cap | 1 | Derived from the fleet box's memory (3 today) | The one bound on concurrent spend. The dial stays on Runs. |
| Test box ssh port and login user | 2 | 22, root | Folded under "advanced" in Connect. |
| Release mirror address | 1 | The public release host | A mirror or fork is a real deployment need. It becomes the one release-source setting. |
| Session slice memory ceiling | 1 | A share of physical memory, by role | The override stays in the env file for a box that runs other software. |
| Server port, agent port | 2 | 7788, 7789 | A port clash is the only reason to touch them. |
| Proxy bind address | 1 | Every address | Only a box with other web services needs it. |
| Publish sessions to the vendor's own app | 1 | Off | A privacy choice. One toggle, no hand file. |
| History capture; recall for one session | 2 | On | The store keeps verbatim text. One Privacy toggle. |
| Fast service tier for a second-provider lane | 1 | Standard | Speed against cost. A toggle on the account, not a hidden file. |
| Per-device view state (inspector, grouping, accounts strip) | 3 | As today | Remembered toggles, not settings. Listed for completeness. |

## Manual acts the system should do itself

| Act today | n | Verdict | What replaces it |
|---|---|---|---|
| Reading a lane's shadow log, then touching a file or a Shadow lanes row | 1 | remove | The publisher reads shadow results. The lane ships live in a release. |
| Moving the fleet to each release | – | remove | Auto-install (counted above). The fleet converges by itself, fleet box first. |
| Acking a failed update before any later one can install | – | derive | A health-gate failure clears itself once, when a newer stable release appears. Ack stays for a signature refusal or a repeat. |
| First move of an old box onto the release lane | 1 | derive | The updater reads the role from the installed units and migrates the box. |
| Recording the role on a box placed by the fallback script | 1 | derive | The server records the role it already derives at boot. |
| `ccrc doctor --fix` | 1 | derive | The settings timer applies a cure when a check that knows its cure fails, with a retry cap. |
| Backups | 1 | derive | A daily local snapshot from a shipped timer. The off-box job stays optional. |
| Enabling or disabling timers after an update or rollback | 1 | derive | Update and rollback reconcile the unit set with the build they place. |
| Pruning kept versions | 1 | remove | The updater already does it. |
| Removing leftovers by hand over ssh | 1 | derive | The cleanup lanes, once live. What remains is listed with one Remove. |
| Merging memory across account homes (`ccrc memory --apply`) | 1 | derive | The update runs it when the doctor reads the stores as forked. |
| Re-capturing pane fixtures after an upstream upgrade | 1 | derive | The test box's build capture, before the roll. |
| The fallback deploy script | 1 | remove | A development tool, out of the user docs. |
| Test box: bring tools up to date, run parity, apply release, repair, rotate key | 5 | remove | Done automatically after install, after an update, on a failed act, and on a fixed interval. |
| Account "Check" before a lane can be switched on | 1 | remove | Runs after connect, after a credential change and when the switch is turned on. |
| Moving sessions off a switched-off account | 1 | remove | Sessions leave at their next idle moment, inside their pool. |
| Opening the PR-template pull request | 1 | remove | Opened once when a private project gains a team key and has no template. |
| Wiring two boxes by editing two env files | – | derive | The pairing step (counted above). |
| Recording and confirming the quiz baseline | – | remove | The weekly run does both (counted above). |
| History store maintenance | – | derive | Migration runs at update. Pruning is one tap at the cap (counted under Set-up). |

## Risky removals

Each row below was disputed by a challenger or needs a named condition. The rule used: the bolder removal wins unless the code shows a concrete harm.

| Setting | The dispute | Settled as | Condition |
|---|---|---|---|
| Stall watch level | Hardcode at the top, or lower | Alert now | The top two steps were never measured in shadow (the product's own gate text says so). They join in the release after the publisher reads that record. |
| `stall-watch-disabled` | One reader removed it, one kept it | Kept as a stop | With the ladder gone it is the only way to silence the watch. Stop mail does not hold the watch's pushes. |
| `mail-gate-strict` | Remove as a roll-out lever, or keep | Kept as a stop | Delivery to a non-idle session rests on upstream status words, and the automatic roll changes the upstream build unattended. |
| `autocompact-disabled` | Remove, or keep | Kept as a stop, for now | The act types into a pane and is lossy. Remove once the continuity lane owns compaction. |
| `hibernate-disabled` | Keep its own stop, or fold into Pause cleanup | Folded | Only after the idle-hours lane and the roll lane also read the cleanup pause. Today they read this file alone. Same pull request. |
| Scope sweep and temp sweep pause files | Same | Folded | Only after both sweeps read the cleanup pause. Today neither does, so a console pause does not stop them. |
| `landing-disabled` | Remove, or keep | Removed | Only after the coordination pause stops the landing-checks lane. Today the lane reads this file alone. |
| Temp root collector | Flat live, or conditional | Derived | Live only where the box reports both capabilities and the cleanup row is clear. These were the operator's checklist. |
| Continuity lanes (three) | Live by release, or per box | Derived per box | A box arms them after its own quiz baseline. The baseline is a per-box measurement. |
| Sleep waiting workers, Count only working workers | Live now, or later | Removed, later | Both merged within the last five days. Shadow this release; live together next. Live, the cap stops counting waiting runs. |
| Run-close groups | On now, or later | Removed, later | Merged twelve days ago. On in the release after the shadow tallies are read. |
| Orphan tree rescue | Live with the orphan lane, or after | Removed, one release after | The rescue removes trees whose commits are on no remote, after pinning them. |
| Graceful stop | Live now, or after measuring | Removed, later | Its wait is provisional. An unmeasured wait slows every swap and limit rescue. |
| Expiry, collector, temp sweep, busy leftover stop | Each box loses its own soak | Removed | These delete. They go live one release after the lossless lanes, with Pause cleanup wired first. |
| Update Ack | Self-clearing halt, or keep | Kept, narrower | Only a health-gate failure clears itself, once per newer stable release. A signature refusal stands until a person acks. |
| Auto-install Off | Keep an Off, or none | Derived, no Off | Stable releases are the publisher's promotion, so they are few. Roll back is the way out. |
| Update channel | Fix at stable, or keep | Kept, out of Settings | See "Decisions for you". |
| Server bind address | Hardcode loopback, or keep | Derived | A private two-box fleet needs a non-loopback bind. Pairing knows the interface. |
| Service-worker denylist | Remove, or keep for shared boxes | Removed | It already has no effect on a release build. A shared box gives the console its own name; the doctor check stays. |
| Session slice memory | Derive only, or keep an override | Kept with a derived default | Only the operator knows what else runs on a shared box. |
| Approvals on a single box | On by default, or ask | Kept as one set-up question | It relaxes a deliberate security boundary. See "Decisions for you". |
| Visibility override | Remove, or keep | Kept, one option | The code never lets a public repository be treated as private, so only "treat as public" has a use. |
| Workspace hold | Derive, or keep | Kept | A held workspace is never touched. Without it there is no per-workspace "leave this" once cleanup is unattended. |
| Per-session Keep awake toggle | Add one, or none | None | The sleep and roll lanes already hold anything with work, mail, a viewer or a scheduled wake, and sleep is reversible. |
| Admin merge off line | Keep as policy, or derive | Derived | The default is already "allowed". A team that forbids it withholds admin rights on GitHub, where it is enforced. |
| Decision model gates | Arm themselves, or operator arms | Kept | A gate bounds what the Overlord does in the user's name. Arming is a widening, behind the step-up. |
| History pruning at the cap | Automatic, or ask | Ask, one tap | The store can be the only copy of old session text. |
| Review-round cap lift | Keep the operator's lift, or drop it | Removed | The coordinator's lift is already always on, so the operator's tap adds no bound. |
| Workers cap | Derive only, or keep the dial | Kept with a derived default | It is the one bound on concurrent spend, and the capacity change alters what it counts. |
| Private registry, private mirror, extra egress hosts on the test box | Keep for teams that need them | Removed | The code cannot serve those cases today: no registry sign-in, and the egress list refuses any other host. |

## Decisions for you

1. **Unattended deletion without a per-box soak.** Expiry, the collector and the temp sweep would delete on every box once the publisher has read the shadow record. Recommendation: yes, one release after the lossless lanes, with Pause cleanup as the stop.
2. **No Off for automatic updates.** Recommendation: yes. Stable moves only when you promote, and Roll back holds a fleet.
3. **The dev channel.** Recommendation: drop the radio and fix users at stable. A fleet that follows dev says so once at install. Your own fleet needs this to soak shadow lanes.
4. **Approvals on a single box.** Recommendation: ask once at install, default yes, and state plainly that one box gives weaker separation than two.
5. **Admin merge.** Recommendation: drop the box-wide off line. GitHub admin rights are the control.
6. **A full history store.** Recommendation: ask with one tap. Do not prune the only copy unasked.

## How to ship it

Each pull request is safe alone and removes a visible chunk. Cheapest and most visible first.

1. **Clear the non-settings out of Settings.** Status cards to the health view, the diagnostic doors, Check now, Character, the layout radio, the second bell, the Overrides card, the dead rows (the roster-card marker row, the Park prompts row, the quiz buttons, the `lander` key). No behaviour changes. About a dozen items.
2. **One Stop panel.** Wire Pause cleanup into the sleep, roll, scope-sweep and temp-sweep paths. Make Pause coordination stop the landing checks. Give Stop mail a console button. Put all four stops and any standing terminal brake on the fleet banner. This is the safety net for everything after it.
3. **Fix the Automation cards that change nothing risky.** Dispatch abandon on, roll every idle session, renewals at a break, plain auto memory off, browser tools off, quiet time 2 hours, roster card live, finished worktrees kept. Drop the new-session routing row, the class chooser and the effort menu. About 20 items.
4. **Stall watch at Alert.** Delete the ladder, the three arming files and the two busy-gate files. Keep the one off file.
5. **Lossless lanes live.** Hibernation, stale archive, clean orphan trees, deps shed, carry dedupe, nested rescue, stop leftovers, idle leftover sweep, landing checks, drift push, child reclaim, mail hold. Delete their arming files and the per-lane off files. Needs step 2. About 25 items.
6. **Updates run themselves.** Auto-install where the gate exists, channel out of Settings, no release announcements, self-clearing halt for health failures, one Roll back, no per-node intent, a daily backup timer.
7. **Env-file purge.** Delete the tuning numbers, paths and call bounds, and the read-only Box settings panel. Derive the machine sizes. The largest single cut, about 130 lines of configuration.
8. **Test box.** Delete the Settings panel and its keys. Derive sizes and pairing values. Run parity, tool sync, release apply, repair and key rotation automatically. About 60 items.
9. **Set-up in one pass.** A pairing step for two boxes, generated push keys, the sign-in gate derived from exposure, the role recorded, the single-box approvals question.
10. **Accounts and linking.** Derived id, label and colour, automatic check and move-off, token by default, models always advance, linking from evidence, the legacy Linear row migrated, one request path for second-provider lanes.
11. **Deleting lanes live, one release after step 5.** Expiry, the collector (with its conditions), the temp sweep's live arm, busy leftovers, orphan rescue, run-close groups.
12. **By later releases, as each record is read.** Sleep waiting workers with the new cap count, the stall watch's top two steps, graceful stop, Overlord defaults and its Stop buttons.
