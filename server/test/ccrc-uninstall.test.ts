// `ccrc uninstall` / `ccrc backup` / `ccrc logs` — stage 4, Task 8 (spec §7).
// Uninstall moves a box OFF ccrc to a state where reinstall is safe: it
// refuses while live sessions exist (unless --force), removes the units
// (incl. both drop-ins and the slice escape), removes ccrc's managed
// settings.json hook entries through the installer's OWN predicate (unmanaged
// entries survive byte-identically, each rewritten file backed up first),
// removes marker-verified wrappers ONLY (`shared/mark.mjs` — a marker-less
// file with a wrapper's name survives), removes ccrc's own artifacts inside
// `~/.cc-sessions` file-by-file (registry rows and operator switches stay),
// and removes `~/ccrc` and the executables. It PRESERVES `~/.ccrc` whole,
// worktrees and backups; `--purge` additionally removes `~/.ccrc` and
// `~/ccrc-backups` — never worktrees, never tmux state. `backup` is update's
// step 2 standalone with `CCRC_BACKUP_KEEP` pruning; `logs` is a thin,
// role-aware journalctl passthrough.
//
// ── THE HARNESS ───────────────────────────────────────────────────────────
// `ccrc-update.test.ts`'s box idiom, trimmed to this file's needs and COPIED
// rather than imported (importing a .test.ts registers its whole suite —
// build-release.test.ts's stated reason). Everything runs against a throwaway
// $HOME; systemctl and journalctl are RECORDING stubs (no real systemd, no
// real journal, ever); tmux is a POISON — uninstall must never reach for it.
// The verbs run from the CHECKOUT's ccrc, so `$CCRC_HERE` resolves the REAL
// `install-session-hooks.sh`, `ccrc-wrapper-shape` and `shared/mark.mjs` —
// the predicate and the marker under test are the shipped ones, not copies.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, chmodSync,
  symlinkSync, rmSync, lstatSync, readlinkSync, realpathSync, unlinkSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
// W6 Task 2's one planter of a versioned box: `~/ccrc-versions/<name>/` built
// from the same fixture tree the install suites place, with its kept stamp and
// install record, and — for the first name — the `~/ccrc` link.
import { installVersionedTree } from './installTreeFixture.js';
// The REAL marker writer — the wrapper fixtures below carry exactly the
// marker `verifyMarker` recognises, so the "marker-verified only" gate is
// measured against the shipped format, never a test's re-spelling of it.
import { markGenerated } from '../../shared/mark.mjs';
import { itLinux, itDarwin, describeLinux } from './platformFixtures.js';
// Plan 2b-2 Task 11: the codex lane library's fixture, Task 4's/5's writers
// and processes, Task 10's spine join to the fake user manager, and its
// extraction harness helpers — one definition each, imported rather than
// re-spelled here (Interfaces).
import {
  codexRoster, plantCodexBins, plantFakeRuntime, plantSystemd, spawnListener, killLaneProcesses,
  registerLaneCleanup, trackChild, adoptPlantedSystemd, assertSpineFrontContained, spineSystemctlArms, spineSystemdRun, SPINE_CONTAINMENT_PROBE,
  managerCalls, spineRunCalls, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls, ccrcFunction,
  ccrcLine, recordingStub, lockStub, freeLanes, portAccepts, laneAnswer, eventually, authDirOf, plantLaneAuth,
  plantLaneConfig, laneUnits, GPT_LANE_BINS, type StubRc, type LanePorts,
} from './codexLaneFixture.js';
import { psArgs } from './laneReaper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');

interface Result { code: number; stdout: string; stderr: string }

/** Recorders and poisons on the fixture PATH. systemctl answers uninstall's
 *  own two shapes (`disable --now`, `daemon-reload`) PLUS, since Plan 2b-2
 *  Task 11, the codex-tier verbs `spineSystemctlArms()` forwards to an
 *  adopted `plantSystemd` delegate (`stop` by exact unit among them);
 *  `systemd-run` is the contained recorder `spineSystemdRun()` plants, which
 *  refuses with 97 unless a delegate was adopted. `adoptPlantedSystemd`
 *  itself now also writes a front the instant it moves anything aside
 *  (belt-and-braces: Task 11 review fix round 1), and this function's own
 *  last act, `assertSpineFrontContained`, THROWS unless BOTH `systemd-run`
 *  and `systemctl` resolve to `<home>/.local/bin/<name>` and carry the spine
 *  mark (systemctl joined in fix round 2, N1). `runVerb` repeats that check
 *  on its FINAL env, after `extraEnv` is spread over this one. So a later
 *  edit here that drops either plant() call leaves that name fronted by
 *  adopt's own write or refused by the check, never resolving to the box's
 *  real binary. What the check proves is those two names; the other tools
 *  below are contained by their own plants, unchecked. journalctl RECORDS
 *  (the `logs` passthrough pin); tmux is a poison — neither verb has any
 *  business near a pane. */
function verbEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  const plant = (name: string, body: string): void =>
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  plant('tmux',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/tmux-poison"\n'
    + 'echo "ccrc uninstall/backup/logs must never touch tmux" >&2\nexit 97\n');
  // launchd's half, contained the same way: every argv recorded, only the
  // verbs this box's uninstall actually issues answered, and a loud exit on
  // anything else so a step driving a job nobody authorised is visible.
  plant('launchctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/launchctl-calls"',
    'case "$1" in',
    '  bootout|disable|enable|bootstrap|kickstart) exit 0 ;;',
    '  print) exit 113 ;;',
    '  *) echo "fixture launchctl: unexpected argv: $*" >&2; exit 90 ;;',
    'esac',
  ].join('\n') + '\n');
  // ── Plan 2b-2 Task 11: the transient-unit launcher, contained ──────────
  // Same reasoning as ccrcEnv's/updateEnv's own comment (ccrc-install.test.ts,
  // ccrc-update.test.ts): `_uninst_codex` reaches `systemd-run` through the
  // lane library's identity checks and stops, and this harness planted none
  // until now (m-platform §3.2).
  adoptPlantedSystemd(home);
  plant('systemd-run', spineSystemdRun());

  plant('systemctl', [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
    '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    // Plan 2b-2 Task 11: the codex tiers' verbs (`stop` by exact unit among
    // them), forwarded to an adopted `plantSystemd`, or answered as a manager
    // that never loaded a codex unit — this stub knew only daemon-reload and
    // `disable --now` (m-platform §3.3).
    ...spineSystemctlArms(),
    'case "$1" in',
    '  daemon-reload) exit 0 ;;',
    '  disable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // Plan 3a Task 7: an instance of ccrc's usage template is disabled the
    // way systemd disables one — its `timers.target.wants` link goes — and the
    // stub records whether the TEMPLATE was still on disk at that moment, so
    // "instances before the template" is a measurement.
    '    case "$3" in ccrc-codex-usage@*.timer)',
    '      t=absent; [ -e "$HOME/.config/systemd/user/ccrc-codex-usage@.timer" ] && t=present',
    '      printf \'%s template=%s\\n\' "$3" "$t" >> "$HOME/usage-disables"',
    '      grep -qxF -- "$3" "$HOME/usage-keeplink" 2>/dev/null || rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    '    esac',
    '    exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  plant('journalctl',
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/journalctl-argv"\nexit 0\n');
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_RELEASE_BASE_URL',
    'CCRC_BACKUP_KEEP', 'CCRC_ROLE', 'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete env[k];
  // Task 11 review fix round 1 (spec-1/mut-1 CRITICAL): the harness's own
  // final check, after every plant() above — THROWS before this env can be
  // handed to any runVerb/spawn if systemd-run is not the contained front.
  assertSpineFrontContained(env, home);
  return env;
}

const MANAGED_HOOK = { type: 'command', command: 'bash "$HOME/.cc-sessions/session-hook.sh"' };
const UNMANAGED_ENTRY = { hooks: [{ type: 'command', command: 'echo my-own-stop-hook' }] };
/** Hand-formatted on purpose (extra spaces): if uninstall rewrites this file
 *  at all, the bytes change and the byte-identity assertion goes red. */
const UNMANAGED_ONLY_SETTINGS =
  '{   "hooks": { "Stop": [ {"hooks":[{"type":"command","command":"echo mine"}]} ] },'
  + '  "note": "hand-formatted, no managed entry"  }\n';

/** A box `ccrc install` (or a deploy) has converged: the tree, the bins, the
 *  units + both drop-in dirs, the ~/.ccrc config, ccrc's ~/.cc-sessions
 *  artifacts, two account homes with settings.json, three wrapper-named
 *  files (marked / marker-less / the upstream ELF), a worktree, an old
 *  backup, and a keep-aside pair. */
function plantInstalledBox(home: string, opts: { versioned?: string[] } = {}): void {
  // The shipped tree. By default a REAL `~/ccrc` directory: a box installed
  // before W6, or by deploy.sh onto one. With `versioned`, W6's layout (spec
  // §11): each name a placed version under `~/ccrc-versions/`, the FIRST the
  // one `~/ccrc` links to — the shape `_uninst_tree_bins`' sweep exists for.
  const versioned = opts.versioned ?? [];
  if (versioned.length === 0) {
    mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'server', 'dist', 'index.js'), '// the installed dist\n');
    mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    mkdirSync(join(home, 'ccrc', 'agent', 'dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'agent', 'dist', 'index.js'), '// agent dist\n');
  } else {
    versioned.forEach((name, i) => { installVersionedTree(home, name, { link: i === 0 }); });
  }
  // The executables.
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'ccd'), '#!/bin/sh\n# the installed ccd\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccrc'), '#!/bin/sh\n# the launcher\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccd-cap-scopes'), '#!/bin/sh\n# cap scopes\n', { mode: 0o755 });
  // graphify Task 10/fix-round F2: another `_inst_bins` executable. NO
  // ORDINALS here either — the sweep's two names below landed in the middle of
  // this list and made every number after them wrong, which is the same defect
  // `_uninst_tree_bins`' own census just retired. What matters is that every
  // name `_inst_bins` writes is planted here, so the uninstall can be measured
  // removing it.
  writeFileSync(join(bin, 'ccd-graph-sweep'), '#!/bin/sh\n# graph sweep\n', { mode: 0o755 });
  // Routing slice 0 Task 7: the usage-accounting sweep's runner and scanner,
  // on the sweep's exact terms — a bash driver plus its Python engine.
  writeFileSync(join(bin, 'ccd-usage-sweep'), '#!/bin/sh\n# usage sweep\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccd-usage-sweep.py'), '#!/usr/bin/env python3\n# usage sweep scanner\n', { mode: 0o755 });
  writeFileSync(join(bin, 'ccd-account-health'), '#!/bin/sh\n# account health\n', { mode: 0o755 });
  // The per-uid temp-dir reaper, placed by `_inst_bins` on the non-Darwin arm.
  writeFileSync(join(bin, 'ccd-tmp-sweep'), '#!/bin/sh\n# tmp sweep\n', { mode: 0o755 });
  // The pane-scope sweep, placed by `_inst_bins` on the same non-Darwin arm.
  writeFileSync(join(bin, 'ccd-scope-sweep'), '#!/bin/sh\n# scope sweep\n', { mode: 0o755 });
  // history spec §9.5: the history sweep's shim, placed by `_inst_bins` off
  // server boxes — planted so `_uninst_tree_bins`' removal is measured.
  writeFileSync(join(bin, 'ccd-history-sweep'), '#!/bin/sh\n# history sweep\n', { mode: 0o755 });
  // account-pool-membership wave 1, Task 4 fix round 1 (F1/F4): the leased-
  // projection puller. `_inst_bins` places it on the non-Darwin arm for every
  // role, so an installed Linux box has it and `_uninst_tree_bins` must take
  // it away — planted here so that removal can be MEASURED rather than read.
  writeFileSync(join(bin, 'ccd-pool-sync'), '#!/bin/sh\n# pool sync\n', { mode: 0o755 });
  // programme wave 4: the update-intent puller, placed by `_inst_bins` on the
  // non-Darwin arm for EVERY role (only its timer is fleet-gated) — planted
  // so `_uninst_tree_bins`' removal of it is measured rather than read.
  writeFileSync(join(bin, 'ccd-update-sync'), '#!/bin/sh\n# update sync\n', { mode: 0o755 });
  // spec 2026-09-07 §C: the telemetry keepalive, beside the health probe above.
  writeFileSync(join(bin, 'ccd-telemetry-keepalive'), '#!/bin/sh\n# keepalive\n', { mode: 0o755 });
  // The account wave's own, and UNMARKED exactly as every name above is:
  // `_inst_atomic` copies and chmods, it never stamps, so a real box's copy
  // carries no marker either. It is also the only one `_inst_bins` places on
  // BOTH platform arms.
  writeFileSync(join(bin, 'ccd-account-auth'), '#!/bin/sh\n# account auth\n', { mode: 0o755 });
  // The GPT lane's four, which `_inst_bins` places on both platform arms and
  // every role but server — so a `both`/`fleet` box has them and
  // `_uninst_tree_bins` must take them away. UNMARKED, as `_inst_atomic`
  // leaves them. `ccrc-codex` is the launcher every generated Codex wrapper
  // execs — NOT `ccgpt`, which on a live box is another repository's (D-3478).
  for (const name of GPT_LANE_BINS) {
    const shell = name.endsWith('.py') ? 'python3' : 'bash';
    writeFileSync(join(bin, name), `#!/usr/bin/env ${shell}\n# fixture ${name}\n`, { mode: 0o755 });
  }
  // ── the one name in ~/.local/bin that is not a ccrc binary (it read
  // "the EIGHTH" while the list above had grown to nine; `_uninst_tree_bins`
  // retired its own ordinals for the same reason, routing slice 0)
  // (R3, D-1347): `_inst_graphify_engine` links `graphify` at the
  // pinned venv's own engine. The venv is planted too, because the proof this
  // link is ccrc's is its TARGET — the uninstall reads it with a one-hop
  // `readlink` and compares it against the exact literal the install writes.
  const venvBin = join(home, '.ccrc', 'graphify-venv', 'bin');
  mkdirSync(venvBin, { recursive: true });
  writeFileSync(join(venvBin, 'graphify'),
    '#!/bin/sh\n[ "$1" = --version ] && { echo "graphify 0.9.9"; exit 0; }\nexit 0\n', { mode: 0o755 });
  symlinkSync(join(venvBin, 'graphify'), join(bin, 'graphify'));
  // …and the pip console-script shim the install copied aside before it
  // repointed that path (D-1349). `_uninst_keep_asides` must name it, for the
  // same reason it names the tmux conf: after `_uninst_tree_bins` removes
  // ccrc's link, this file is the operator's own graphify and the printed `mv`
  // is how they get it back.
  writeFileSync(join(bin, 'graphify.pre-ccrc-20260101T000000Z'),
    '#!/usr/bin/python3\nfrom graphify.__main__ import main\n', { mode: 0o755 });
  // The units, both drop-in dirs and the slice escape (its literal \x2d name).
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(join(units, 'claude-session@.service.d'), { recursive: true });
  mkdirSync(join(units, 'app-claude\\x2dsession.slice.d'), { recursive: true });
  for (const u of ['ccrc.service', 'ccrc-agent.service', 'claude-session@.service',
    'ccd-cap-scopes.service', 'ccd-cap-scopes.timer',
    // account-pool-membership wave 1, Task 4: the pool-sync pair. UNLIKE
    // every role-gated pair below it, `_inst_units` ships this one on every
    // non-Darwin role — so it is on the box under test whatever role it had.
    'ccd-pool-sync.service', 'ccd-pool-sync.timer',
    // programme wave 4: the update-intent puller's pair. `_inst_units` ships
    // it on the `fleet` role only; planted here because the uninstall removes
    // it whatever role the box had.
    'ccd-update-sync.service', 'ccd-update-sync.timer',
    // graphify Task 10 (O3/O6b): the sweep pair, mirroring cap-scopes.
    'ccd-graph-sweep.service', 'ccd-graph-sweep.timer',
    // Routing slice 0 Task 7: the usage-accounting sweep's pair, on the same
    // terms as the graph sweep above it.
    'ccd-usage-sweep.service', 'ccd-usage-sweep.timer',
    // The temp-dir reaper's pair, on the same role-gated terms.
    'ccd-tmp-sweep.service', 'ccd-tmp-sweep.timer',
    'ccd-scope-sweep.service', 'ccd-scope-sweep.timer',
    // history spec §9.5: the history sweep's pair, on the same role-gated terms.
    'ccd-history-sweep.service', 'ccd-history-sweep.timer',
    'ccd-account-health.service', 'ccd-account-health.timer',
    'ccd-telemetry-keepalive.service', 'ccd-telemetry-keepalive.timer',
    // C5: the models pair, mirroring the three role-gated siblings above.
    'ccrc-models.service', 'ccrc-models.timer',
    // W4a Task 9: the server-role watchdog's pair.
    'ccrc-update-watchdog.service', 'ccrc-update-watchdog.timer',
    // Plan 3a Task 6: ccrc's own usage pair, placed on fleet/both.
    'ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
    writeFileSync(join(units, u), `[Unit]\nDescription=fixture ${u}\n`);
  }
  writeFileSync(join(units, 'claude-session@.service.d', 'limits.conf'), '[Service]\n');
  writeFileSync(join(units, 'app-claude\\x2dsession.slice.d', 'limits.conf'), '[Slice]\n');
  // …and the same "this box is installed" fixture in launchd's spelling. The
  // verbs under test read whichever directory THIS platform installs into, so
  // a fixture that planted only the systemd set would leave the Darwin arm
  // with nothing to remove and every assertion measuring the fixture.
  if (process.platform === 'darwin') {
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    for (const label of ['app.ccrc.ccrc', 'app.ccrc.ccrc-agent']) {
      writeFileSync(join(agents, `${label}.plist`),
        '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
        + `<key>Label</key><string>${label}</string></dict></plist>\n`);
    }
  }
  // ~/.ccrc — the user-owned side, which uninstall PRESERVES (spec §7).
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=both\n');
  writeFileSync(join(home, '.ccrc', 'build.json'),
    '{"sha":"fixturesha000000000000000000000000000000","ref":"main",'
    + '"builtAt":"2026-08-21T00:00:00Z","dirty":false}\n');
  writeFileSync(join(home, '.ccrc', 'installed'), 'fixturesha000000000000000000000000000000\n');
  writeFileSync(join(home, '.ccrc', 'node-id'), '01234567-89ab-cdef-0123-456789abcdef\n');
  writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\nnode-id\nfloor\n');
  writeFileSync(join(home, '.ccrc', 'floor'), 'v1.0.0\n');
  // W4 Task 4: the node's update state — install-state like the three above.
  writeFileSync(join(home, '.ccrc', 'previous'), 'v0.9.0\nfixturesha000000000000000000000000000000\n');
  writeFileSync(join(home, '.ccrc', 'install-step'), '_inst_skills\n');
  writeFileSync(join(home, '.ccrc', 'update.json'),
    '{"target":"v1.0.0","phase":"done","startedAt":1,"updatedAt":2,"detail":null,"from":"cli","pid":4242}\n');
  writeFileSync(join(home, '.ccrc', 'update.lock'), '');
  // W4a Task 8: the control plane's projection — install-state too: a box with
  // no tree follows nothing, and a stale copy would outlive the node's identity.
  writeFileSync(join(home, '.ccrc', 'update-intent'),
    'epoch 1\nissued 1\nlease 901\nchannel stable\ndesired none\ndesired-stable none\ndesired-dev none\nauto off\nend\n', { mode: 0o600 });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), '{"fixture":"roster"}\n');
  writeFileSync(join(home, '.ccrc', 'accounts.sh'), [
    '# fixture projection — just enough for install-session-hooks.sh',
    'CCRC_ACCOUNTS=(claude2 claude3)',
    '_ccrc_cfg_dir() {',
    '  case "$1" in',
    '    claude2) printf \'%s\' "$HOME/.claude-claude2" ;;',
    '    claude3) printf \'%s\' "$HOME/.claude-claude3" ;;',
    '  esac',
    '}',
    '',
  ].join('\n'));
  // ccrc's artifacts in ~/.cc-sessions, beside a registry row and an
  // operator switch that MUST survive.
  const reg = join(home, '.cc-sessions');
  mkdirSync(join(reg, 'coordinator-skill'), { recursive: true });
  mkdirSync(join(reg, 'worker-skill'), { recursive: true });
  mkdirSync(join(reg, 'reviewer-skill'), { recursive: true });
  // The compaction card's helper (compaction-card spec §2): `_inst_files`
  // places it, so `_uninst_cc_sessions` is the sweep that must remove it.
  writeFileSync(join(reg, 'compact-card.mjs'), '// fixture helper\n', { mode: 0o644 });
  writeFileSync(join(reg, 'session-hook.sh'), '#!/bin/sh\n# hook\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-session-hooks.sh'), '#!/bin/sh\n# old installed copy\n', { mode: 0o755 });
  writeFileSync(join(reg, 'notify.sh'), '#!/bin/sh\n# notify\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-coordinator-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-worker-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(reg, 'install-reviewer-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  // graphify Task 3: `_inst_graphify_skill` stages this beside the other three
  // installers, the same lane `_uninst_cc_sessions` must remove it from.
  writeFileSync(join(reg, 'install-graphify-skill.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(reg, 'coordinator-skill', 'SKILL.md'), '# the coordinator skill\n');
  writeFileSync(join(reg, 'worker-skill', 'SKILL.md'), '# the worker skill\n');
  writeFileSync(join(reg, 'reviewer-skill', 'SKILL.md'), '# the reviewer skill\n');
  // Two account homes. claude2: one managed entry per event shape the
  // installer writes, one unmanaged entry, a CUSTOM statusLine. claude3:
  // no managed entry at all, hand-formatted.
  mkdirSync(join(home, '.claude-claude2'), { recursive: true });
  writeFileSync(join(home, '.claude-claude2', 'settings.json'), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [MANAGED_HOOK] }, UNMANAGED_ENTRY],
      PreToolUse: [{ matcher: '*', hooks: [MANAGED_HOOK] }],
    },
    statusLine: { type: 'command', command: 'my-custom-statusline' },
  }, null, 2) + '\n');
  mkdirSync(join(home, '.claude-claude3'), { recursive: true });
  writeFileSync(join(home, '.claude-claude3', 'settings.json'), UNMANAGED_ONLY_SETTINGS);
  // Three wrapper-named files: MARKED (exactly what ccrc last wrote),
  // marker-less (somebody's hand-written launcher), and the upstream binary.
  writeFileSync(join(bin, 'claude2'), markGenerated(
    '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.claude-claude2"\n'
    + 'exec "$HOME/.local/bin/claude" "$@"\n'), { mode: 0o755 });
  writeFileSync(join(bin, 'claude3'),
    '#!/usr/bin/env bash\n# hand-written launcher — NOT ccrc\'s\nexec /usr/bin/claude "$@"\n',
    { mode: 0o755 });
  writeFileSync(join(bin, 'claude'),
    '\x7fELF\x02\x01\x01\x00not-a-real-binary-just-a-fixture-marker', { mode: 0o755 });
  // A worktree, an existing backup, and the keep-aside pair.
  mkdirSync(join(home, 'worktrees', 'fixture-ws'), { recursive: true });
  writeFileSync(join(home, 'worktrees', 'fixture-ws', 'work.txt'), 'a session\'s work\n');
  mkdirSync(join(home, 'ccrc-backups', '20250101-000000'), { recursive: true });
  writeFileSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd'), '# an old backup\n');
  writeFileSync(join(home, '.tmux.conf'), '# the shipped tmux.conf\n');
  writeFileSync(join(home, '.tmux.conf.pre-ccrc-20260101T000000Z'), '# the operator\'s own\n');
}

/** Every command currently reachable on this process's PATH except `missing`,
 *  collapsed into one link farm. This models one absent dependency without
 *  also losing the ordinary tools that happen to share its system directory. */
function pathWithout(home: string, missing: string): string {
  const farm = join(home, `no-${missing}-bin`);
  mkdirSync(farm);
  const seen = new Set<string>([missing]);
  for (const dir of (process.env['PATH'] ?? '/usr/bin:/bin').split(':')) {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      symlinkSync(join(dir, name), join(farm, name));
    }
  }
  return `${join(home, '.local', 'bin')}:${farm}`;
}

function runVerb(home: string, verb: string, args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const env = { ...verbEnv(home), ...extraEnv };
  // Fix round 2 (N5): on the FINAL merged env — verbEnv's own internal call
  // (its last act) only ever saw the env BEFORE extraEnv was spread over it,
  // so this is the check that actually covers what the spawn below runs
  // under. No case in this file legitimately reaches no manager at all.
  assertSpineFrontContained(env, home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), verb, ...args],
    { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A REAL sqlite coord.db, so `backup-coord.mjs`'s VACUUM INTO runs. */
function plantCoordDb(home: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  const db = new DatabaseSync(join(home, '.ccrc', 'coord.db'));
  db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
  db.close();
}

const settingsOf = (home: string, acct: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, `.claude-${acct}`, 'settings.json'), 'utf8')) as Record<string, unknown>;

describe('ccrc uninstall: the argument surface', () => {
  it('-h prints usage on STDOUT at exit 0 — a verb with flags explains them', () => {
    const home = mkTmp('ccrc-uninst-help-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'ccrc')), 'help removed the tree').toBe(true);
  });

  it('an unknown argument is a usage error, exit 2, before anything is removed', () => {
    const home = mkTmp('ccrc-uninst-badarg-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    expect(existsSync(join(home, 'ccrc'))).toBe(true);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });
});

describe('ccrc uninstall: the live-session gate', () => {
  it('refuses while live sessions exist — exit 1, names the count and --force, removes NOTHING', () => {
    const home = mkTmp('ccrc-uninst-live-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    writeFileSync(join(home, '.cc-sessions', 'beta.uuid'), 'fixture-uuid\n');
    const r = runVerb(home, 'uninstall');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/2 live ccd session/);
    expect(r.stderr).toMatch(/--force/);
    // Nothing was removed and no unit was touched: the gate runs FIRST.
    expect(existsSync(join(home, 'ccrc'))).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', 'ccd'))).toBe(true);
    expect(existsSync(join(home, '.local', 'bin', 'claude2'))).toBe(true);
    expect(existsSync(join(home, '.config', 'systemd', 'user', 'ccrc.service'))).toBe(true);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  it('--force proceeds past live sessions, and the registry rows themselves still survive', () => {
    const home = mkTmp('ccrc-uninst-force-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    expect(existsSync(join(home, '.cc-sessions', 'alpha.uuid')),
      '--force removed a live registry row').toBe(true);
  });

  it('zero sessions need no --force', () => {
    const home = mkTmp('ccrc-uninst-zero-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });
});

/** Every regular file under the unit directory, relative to it, sorted —
 *  what `plantInstalledBox`, or a case, actually put there. */
function unitFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(rel === '' ? dir : join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/** Every unit file `_inst_units`' systemd arm places, relative to the unit
 *  directory, READ OUT OF ccd/ccrc (Plan 3a Task 7). Each is an
 *  `_inst_atomic` destination, `"$dir/<name>"` or `"$slice/<name>"`, with
 *  `$role_unit` read as both values the function gives it. Any other variable
 *  in a destination THROWS: a name this reader cannot resolve would drop out
 *  of the fixture check silently (install-census.test.ts's no-silent-drops
 *  rule). */
function instUnitsDestinations(): string[] {
  const body = ccrcFunction('_inst_units');
  const roles = [...body.matchAll(/\brole_unit=([A-Za-z0-9@._-]+)/g)].map((m) => m[1]!);
  if (roles.length < 2) throw new Error(`_inst_units gives role_unit ${roles.length} value(s), not the two this reader expects`);
  const slice = /\bslice="\$dir\/([^"]+)"/.exec(body);
  if (slice === null) throw new Error('_inst_units no longer names its slice drop-in directory as slice="$dir/…"');
  const out = new Set<string>();
  for (const m of body.matchAll(/_inst_atomic\s+"[^"]*"\s*(?:\\\n\s*)?"\$(dir|slice)\/([^"]+)"/g)) {
    const root = m[1]!; const rest = m[2]!;
    for (const n of rest === '$role_unit' ? roles : [rest]) {
      if (n.includes('$')) throw new Error(`_inst_units places "${m[0]}" through a variable this reader does not resolve — spell it literally, or teach it`);
      out.add(root === 'slice' ? `${slice[1]!}/${n}` : n);
    }
  }
  if (out.size < 10) throw new Error(`_inst_units read as only ${out.size} destinations — this reader has gone stale`);
  return [...out].sort();
}

describe('ccrc uninstall: the remove set (spec §7)', () => {
  itLinux('units: every unit file the box had goes — read off the fixture, which must plant all of _inst_units — disable --now, daemon-reload last, recording stub only (Plan 3a Task 7; 2b-1 item 19)', () => {
    const home = mkTmp('ccrc-uninst-units-');
    plantInstalledBox(home);
    const units = join(home, '.config', 'systemd', 'user');
    const before = unitFilesUnder(units);
    // THE FIXTURE COVERS THE INSTALL (D-3728). The hand-typed list this
    // replaces named every pair but `ccd-usage-sweep`'s, while the fixture
    // planted it and the uninstall removed it: a list with a hole is a green
    // nobody earned.
    for (const u of instUnitsDestinations()) {
      expect(before, `plantInstalledBox does not plant ${u}, which _inst_units places — plant it, so its removal is measured`).toContain(u);
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(before.filter((f) => existsSync(join(units, f))), 'these unit files survived the uninstall').toEqual([]);
    expect(existsSync(join(units, 'claude-session@.service.d'))).toBe(false);
    expect(existsSync(join(units, 'app-claude\\x2dsession.slice.d'))).toBe(false);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls).toContain('--user disable --now ccrc.service');
    expect(calls).toContain('--user disable --now ccrc-agent.service');
    expect(calls).toContain('--user disable --now ccd-cap-scopes.timer');
    // The half a file-absence assertion cannot see: a unit file deleted under
    // a still-enabled unit leaves systemd holding a dangling enablement.
    expect(calls).toContain('--user disable --now ccd-pool-sync.timer');
    expect(calls).toContain('--user disable --now ccd-update-sync.timer');
    expect(calls).toContain('--user disable --now ccd-graph-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-usage-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-tmp-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-scope-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-history-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-account-health.timer');
    expect(calls).toContain('--user disable --now ccd-telemetry-keepalive.timer');
    expect(calls).toContain('--user disable --now ccrc-models.timer');
    expect(calls).toContain('--user disable --now ccrc-update-watchdog.timer');
    expect(calls[calls.length - 1]).toBe('--user daemon-reload');
    // The sacred rule holds even here: no claude-session@ instance is ever a
    // systemctl target, and tmux is never touched (poison would have fired).
    expect(calls.join('\n')).not.toMatch(/claude-session@/);
    expect(existsSync(join(home, 'tmux-poison'))).toBe(false);
  });

  itLinux('every ENABLED instance of ccrc\'s usage template is stopped and disabled while its template is still on disk, whatever the roster says (Plan 3a Task 7; spec §13, ruling R-C9)', () => {
    const home = mkTmp('ccrc-uninst-usage-instances-');
    plantInstalledBox(home);
    const units = join(home, '.config', 'systemd', 'user');
    const wants = join(units, 'timers.target.wants');
    mkdirSync(wants, { recursive: true });
    // Two instances, and `plantInstalledBox`'s roster is not even a roster
    // (`{"fixture":"roster"}`): the sweep reads the manager's links, never the roster.
    for (const id of ['codex-a', 'codex-b']) {
      symlinkSync(join(units, 'ccrc-codex-usage@.timer'), join(wants, `ccrc-codex-usage@${id}.timer`));
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'usage-disables'), 'utf8').split('\n').filter(Boolean), 'an instance was disabled after its template was gone, or not at all')
      .toEqual(['ccrc-codex-usage@codex-a.timer template=present', 'ccrc-codex-usage@codex-b.timer template=present']);
    expect(readdirSync(wants), 'an enabled instance survived the uninstall').toEqual([]);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(join(units, u)), `${u} survived`).toBe(false);
    }
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n').filter(Boolean);
    expect(calls.indexOf('--user disable --now ccrc-codex-usage@codex-a.timer')).toBeGreaterThan(-1);
    expect(calls[calls.length - 1]).toBe('--user daemon-reload');
    expect(r.stdout).toMatch(/^uninstall: units: 2 codex usage timer\(s\) stopped and disabled$/m);
  });

  itLinux('an instance whose disable the manager answers 0 while its link stays is NOT counted stopped: its failed line names it and the count is the measured one (Plan 3b Task A2, usage template)', () => {
    const home = mkTmp('ccrc-uninst-usage-keeplink-');
    plantInstalledBox(home);
    const units = join(home, '.config', 'systemd', 'user');
    const wants = join(units, 'timers.target.wants');
    mkdirSync(wants, { recursive: true });
    for (const id of ['codex-a', 'codex-b']) symlinkSync(join(units, 'ccrc-codex-usage@.timer'), join(wants, `ccrc-codex-usage@${id}.timer`));
    writeFileSync(join(home, 'usage-keeplink'), 'ccrc-codex-usage@codex-b.timer\n');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^uninstall: units: 1 codex usage timer\(s\) stopped and disabled$/m);
    expect(r.stderr).toMatch(/^uninstall: units: disable --now ccrc-codex-usage@codex-b\.timer failed \(continuing/m);
  });

  // The same three promises — stop it, forget it, remove it — in launchd's
  // vocabulary. There is no template unit and no drop-in directory to sweep
  // (launchd has neither), and the per-SESSION plists are deliberately left
  // alone for the same reason the Linux arm leaves `claude-session@<id>`
  // instances alone: an operator stops sessions through ccd, not through an
  // uninstall's side effect.
  itDarwin('jobs: bootout, disable, delete every ccrc job file — recording stub only', () => {
    const home = mkTmp('ccrc-uninst-jobs-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const agents = join(home, 'Library', 'LaunchAgents');
    for (const j of ['app.ccrc.ccrc.plist', 'app.ccrc.ccrc-agent.plist']) {
      expect(existsSync(join(agents, j)), `${j} survived`).toBe(false);
    }
    const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls.join('\n'), 'the job was never booted out').toMatch(/^bootout /m);
    expect(calls.join('\n'), 'the job was never disabled').toMatch(/^disable /m);
    expect(r.stdout).toMatch(/^uninstall: units: stopped, disabled and removed/m);
    expect(r.stdout).toMatch(/no drop-ins or slice on macOS/);
  });

  it('settings.json: managed entries go through the installer\'s own predicate, unmanaged entries and the custom statusLine survive, the rewritten file is backed up first', () => {
    const home = mkTmp('ccrc-uninst-hooks-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const s = settingsOf(home, 'claude2');
    const hooks = s['hooks'] as Record<string, unknown[]>;
    // The managed Stop entry is gone; the operator's own survives, deep-equal.
    expect(hooks['Stop']).toEqual([UNMANAGED_ENTRY]);
    // PreToolUse held ONLY the managed entry — swept empty, the key is dropped.
    expect(hooks['PreToolUse']).toBeUndefined();
    // The custom statusLine is not ccrc's to remove.
    expect(s['statusLine']).toEqual({ type: 'command', command: 'my-custom-statusline' });
    // The per-file backup, in install-session-hooks.sh's own shape.
    const backups = readdirSync(join(home, 'ccrc-backups'))
      .filter((d) => d !== '20250101-000000');
    expect(backups.length).toBe(1);
    expect(readdirSync(join(home, 'ccrc-backups', backups[0]!)))
      .toContain('.claude-claude2.settings.json');
  });

  it('a settings.json with NO managed entry is not rewritten — byte-identical, hand formatting and all', () => {
    const home = mkTmp('ccrc-uninst-hooks-noop-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.claude-claude3', 'settings.json'), 'utf8'))
      .toBe(UNMANAGED_ONLY_SETTINGS);
  });

  it('wrappers: removes ONLY the marker-verified file — a marker-less file with a wrapper\'s name survives byte-identically, and so does the upstream binary', () => {
    const home = mkTmp('ccrc-uninst-wrappers-');
    plantInstalledBox(home);
    const foreign = readFileSync(join(home, '.local', 'bin', 'claude3'), 'utf8');
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', 'claude2')),
      'the marker-verified wrapper survived').toBe(false);
    expect(readFileSync(join(home, '.local', 'bin', 'claude3'), 'utf8'),
      'the hand-written launcher was touched').toBe(foreign);
    expect(existsSync(join(home, '.local', 'bin', 'claude')),
      'the upstream binary was removed').toBe(true);
    expect(r.stdout).toMatch(/uninstall: wrappers: removed .*claude2/);
  });

  it('a marked-but-edited wrapper is KEPT and named — the edit is the operator\'s work', () => {
    const home = mkTmp('ccrc-uninst-edited-');
    plantInstalledBox(home);
    const p = join(home, '.local', 'bin', 'claude2');
    writeFileSync(p, readFileSync(p, 'utf8') + '# an operator\'s edit\n', { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(p)).toBe(true);
    expect(r.stdout).toMatch(/uninstall: wrappers: kept .*claude2.*edited/);
  });

  it('~/.cc-sessions: ccrc\'s own artifacts go file-by-file; registry rows and operator switches stay', () => {
    const home = mkTmp('ccrc-uninst-sessions-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.cc-sessions', 'alpha.uuid'), 'fixture-uuid\n');
    writeFileSync(join(home, '.cc-sessions', 'coordinator-paused'), 'operator switch\n');
    writeFileSync(join(home, '.cc-sessions', 'mail-disabled'), 'operator switch\n');
    // The worker stall watch's seven switches (spec §9.14, §5): written by nothing in
    // the tree, touched and removed by hand — so uninstall leaves them as it
    // leaves `coordinator-paused` and `mail-disabled`.
    for (const m of ['mail-gate-strict', 'stall-watch-disabled', 'stall-watch-live', 'stall-watch-escalate', 'stall-watch-w2-live', 'mail-gate-busy', 'mail-gate-busy-shadow']) {
      writeFileSync(join(home, '.cc-sessions', m), 'operator switch\n');
    }
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, r.stderr).toBe(0);
    for (const f of ['session-hook.sh', 'install-session-hooks.sh', 'notify.sh', 'compact-card.mjs',
      'install-coordinator-skill.sh', 'install-worker-skill.sh', 'install-reviewer-skill.sh',
      'install-graphify-skill.sh',
      'coordinator-skill', 'worker-skill', 'reviewer-skill']) {
      expect(existsSync(join(home, '.cc-sessions', f)), `${f} survived`).toBe(false);
    }
    for (const f of ['alpha.uuid', 'coordinator-paused', 'mail-disabled',
      'mail-gate-strict', 'stall-watch-disabled', 'stall-watch-live', 'stall-watch-escalate', 'stall-watch-w2-live', 'mail-gate-busy', 'mail-gate-busy-shadow']) {
      expect(existsSync(join(home, '.cc-sessions', f)), `${f} was removed`).toBe(true);
    }
  });

  it('graphify skills: skills/graphify is removed from every rostered home, while OTHER skills there survive', () => {
    // `_uninst_graphify_skills` (graphify Task 3) — beside `_uninst_cc_sessions`
    // in the sweep, but a DIFFERENT lane: the assembled skill lives one level
    // down, in each rostered home's own `skills/graphify`, never under
    // `~/.cc-sessions`. A dummy `skills/ccrc-worker` in the same directory is
    // the proof the sweep is scoped to the one name, not a directory wipe.
    const home = mkTmp('ccrc-uninst-graphify-skills-');
    plantInstalledBox(home);
    for (const acct of ['claude2', 'claude3']) {
      const skills = join(home, `.claude-${acct}`, 'skills');
      mkdirSync(join(skills, 'graphify', 'references'), { recursive: true });
      writeFileSync(join(skills, 'graphify', 'SKILL.md'), '# the graphify skill\n');
      writeFileSync(join(skills, 'graphify', '.graphify_version'), '0.9.9');
      mkdirSync(join(skills, 'ccrc-worker'), { recursive: true });
      writeFileSync(join(skills, 'ccrc-worker', 'SKILL.md'), '# the worker skill (dummy)\n');
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    for (const acct of ['claude2', 'claude3']) {
      const skills = join(home, `.claude-${acct}`, 'skills');
      expect(existsSync(join(skills, 'graphify')), `${acct}: graphify survived`).toBe(false);
      expect(existsSync(join(skills, 'ccrc-worker', 'SKILL.md')),
        `${acct}: an unrelated skill was swept too`).toBe(true);
    }
    expect(r.stdout).toMatch(/^uninstall: graphify skills: removed from 2 account home\(s\)/m);
  });

  it('the tree and the executables go; ~/.ccrc, worktrees and backups are PRESERVED without --purge', () => {
    const home = mkTmp('ccrc-uninst-preserve-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    // graphify Task 10/fix-round F2: `ccd-graph-sweep` joins the set — an
    // uninstall that removed its units (`_uninst_units`) and left the binary
    // orphaned it on PATH forever, exactly the defect this test already
    // existed to catch for the other three.
    // D-1347: `graphify` joins the set for a reason strictly worse than the
    // other four's. It is not a ccrc binary — it is ccrc's LINK into the
    // pinned venv — and `--purge` takes `~/.ccrc` whole a few lines later, so
    // an uninstall that left it behind would leave a DANGLING `graphify` first
    // on every session's PATH: worse than the box was before ccrc, because the
    // pip shim that used to answer there was copied aside by the install and
    // never put back.
    // account-pool-membership wave 1, Task 4 fix round 1 (F4): `ccd-pool-sync`
    // joins the set on `ccd-graph-sweep`'s own terms — its units go above and
    // the binary would otherwise stay on PATH for ever.
    // Plan 2b-2: the GPT lane's four join the set on `ccd-pool-sync`'s terms —
    // `_inst_bins` places them, so an uninstall that left them strands them on
    // PATH for ever.
    for (const b of ['ccd', 'ccrc', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-usage-sweep',
      'ccd-usage-sweep.py', 'ccd-account-health', 'ccd-tmp-sweep', 'ccd-scope-sweep', 'ccd-history-sweep',
      'ccd-telemetry-keepalive', 'ccd-account-auth', 'ccd-pool-sync', 'ccd-update-sync',
      ...GPT_LANE_BINS, 'graphify']) {
      expect(existsSync(join(home, '.local', 'bin', b)), `${b} survived`).toBe(false);
    }
    expect(r.stdout).toMatch(/uninstall: tree: graphify removed from \$HOME\/\.local\/bin/);
    // The preserve set, whole.
    // The completed-install record is NOT config: a box with no tree has no
    // completed install, and leaving it would let a later `ccrc update` skip.
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // The node's three files are install-state, not config (design 2026-09-20
    // §3, §9): an uninstalled box has no identity to the console, no
    // capabilities and no floor.
    for (const f of ['node-id', 'ccrc-caps', 'floor', 'previous', 'install-step', 'update.json', 'update.lock', 'update-intent']) {
      expect(existsSync(join(home, '.ccrc', f)), `${f} survived`).toBe(false);
    }
    // W4 Task 4: a box with no tree has no update in flight, no baseline to
    // restore to and no spine step to classify.
    // W6 Task 6: the line now ENDS with what the versions sweep found — on
    // this box, a real `~/ccrc` directory, nothing.
    expect(r.stdout).toMatch(/; the completed-install record and the node's update state \(~\/\.ccrc\/previous, install-step, update\.json, update\.lock, update-intent\) removed; no ~\/ccrc-versions$/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(true);
    expect(existsSync(join(home, '.ccrc', 'ccrc.env'))).toBe(true);
    expect(existsSync(join(home, 'worktrees', 'fixture-ws', 'work.txt'))).toBe(true);
    expect(existsSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd'))).toBe(true);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(true);
  });

  it('ccd\'s BODY goes with its launcher, and ~/.local/libexec/ccrc only when that leaves it empty (D-3696)', () => {
    // The pair: `_inst_bins` publishes the launcher at ~/.local/bin/ccd and the
    // body at ~/.local/libexec/ccrc/ccd, so an uninstall that removed only the
    // launcher would strand a 1.7 MB Bash body nothing can start.
    const body = (home: string): string => join(home, '.local', 'libexec', 'ccrc', 'ccd');
    const plantBody = (home: string): void => {
      mkdirSync(join(home, '.local', 'libexec', 'ccrc'), { recursive: true });
      writeFileSync(body(home), '#!/usr/bin/env bash\n# fixture ccd body\n', { mode: 0o644 });
    };
    const empty = mkTmp('ccrc-uninst-body-');
    plantInstalledBox(empty);
    plantBody(empty);
    writeFileSync(join(empty, '.local', 'libexec', 'operator-tool'), '#!/bin/sh\n', { mode: 0o755 });
    const r = runVerb(empty, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(empty, '.local', 'bin', 'ccd')), 'the launcher survived').toBe(false);
    expect(existsSync(body(empty)), 'the body survived').toBe(false);
    expect(existsSync(join(empty, '.local', 'libexec', 'ccrc')), 'an emptied ccrc libexec directory survived').toBe(false);
    expect(existsSync(join(empty, '.local', 'libexec', 'operator-tool')), 'unrelated libexec content was removed').toBe(true);
    expect(r.stdout).toMatch(/and ccd's body from \$HOME\/\.local\/libexec\/ccrc; /);
    // Something of the operator's beside the body keeps the directory.
    const kept = mkTmp('ccrc-uninst-body-kept-');
    plantInstalledBox(kept);
    plantBody(kept);
    writeFileSync(join(kept, '.local', 'libexec', 'ccrc', 'notes.txt'), 'mine\n');
    expect(runVerb(kept, 'uninstall').code).toBe(0);
    expect(existsSync(body(kept)), 'the body survived').toBe(false);
    expect(readFileSync(join(kept, '.local', 'libexec', 'ccrc', 'notes.txt'), 'utf8'), 'an operator file beside the body was removed').toBe('mine\n');
  });

  it('a STAMPED ccd-account-auth is still the bin arm\'s subject, never counted as a wrapper', () => {
    // `_inst_atomic` does not stamp, so a real box's copy is unmarked and the
    // wrapper arm keeps it silently whether or not `_uninst_wrappers`' case
    // names it. The case line's whole value is that it does not DEPEND on
    // that: stamp the file and, without the entry, `_uninst_wrappers` reads
    // `ccrc-unmodified`, removes it FIRST, and reports a toolchain executable
    // in the wrapper census as though ccrc had found an account launcher on
    // this box. That is the failure this fixture can see and a text pin
    // cannot.
    const home = mkTmp('ccrc-uninst-auth-marked-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.local', 'bin', 'ccd-account-auth'),
      markGenerated('#!/bin/sh\n# account auth\n'), { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', 'ccd-account-auth')),
      'the helper survived the uninstall').toBe(false);
    expect(r.stdout, 'a toolchain executable was counted in the wrapper census')
      .not.toMatch(/uninstall: wrappers: removed .*ccd-account-auth/);
    expect(r.stdout, 'the bin census does not name it')
      .toMatch(/uninstall: tree: .*ccd-account-auth.* removed from \$HOME\/\.local\/bin/);
  });

  it('a STAMPED ccd-pool-sync is the bin arm\'s subject too — the uninstall twin of its TOOLCHAIN_EXECUTABLES entry', () => {
    // account-pool-membership wave 1, Task 4 fix round 2 (B1). The sibling
    // above states the mechanism; this is the same claim for the name that
    // shipped into `_inst_bins`, `_uninst_tree_bins` and
    // `deploy/gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES` in fix round 1
    // while `_uninst_wrappers`' exclusion case was left without it — the one
    // place in the five-path census that got no entry.
    //
    // INERT ON A REAL BOX TODAY, and pinned anyway for the reason the case's
    // own comment gives: `_inst_atomic` does not stamp, so the installed copy
    // is unmarked and `verifyMarker` answers `foreign` whether or not the
    // case names it. A marked fixture is the only thing that can tell the two
    // worlds apart, which is why it is the fixture rather than a text scan.
    const home = mkTmp('ccrc-uninst-poolsync-marked-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.local', 'bin', 'ccd-pool-sync'),
      markGenerated('#!/bin/sh\n# pool sync\n'), { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', 'ccd-pool-sync')),
      'the puller survived the uninstall').toBe(false);
    expect(r.stdout, 'a toolchain executable was counted in the wrapper census')
      .not.toMatch(/uninstall: wrappers: removed .*ccd-pool-sync/);
    expect(r.stdout, 'the bin census does not name it')
      .toMatch(/uninstall: tree: .*ccd-pool-sync.* removed from \$HOME\/\.local\/bin/);
  });

  it('a STAMPED ccd-update-sync is the bin arm\'s subject too — the uninstall twin of its TOOLCHAIN_EXECUTABLES entry', () => {
    // programme wave 4: the pool-sync sibling above, for the update-intent
    // puller. INERT ON A REAL BOX TODAY for the same reason (`_inst_atomic`
    // never stamps), and pinned for the same reason: only a MARKED fixture
    // can tell `_uninst_wrappers`' case entry from its absence.
    const home = mkTmp('ccrc-uninst-updatesync-marked-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.local', 'bin', 'ccd-update-sync'),
      markGenerated('#!/bin/sh\n# update sync\n'), { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', 'ccd-update-sync')),
      'the puller survived the uninstall').toBe(false);
    expect(r.stdout, 'a toolchain executable was counted in the wrapper census')
      .not.toMatch(/uninstall: wrappers: removed .*ccd-update-sync/);
    expect(r.stdout, 'the bin census does not name it')
      .toMatch(/uninstall: tree: .*ccd-update-sync.* removed from \$HOME\/\.local\/bin/);
  });

  it('STAMPED ccgpt-runtime and ccrc-codex are the bin arm\'s subject too, never counted as wrappers', () => {
    // The uninstall twin of their `TOOLCHAIN_EXECUTABLES` entries, on the terms
    // the two cases above state for `ccd-account-auth` and `ccd-pool-sync`:
    // `_inst_atomic` does not stamp, so a real box's copies are unmarked and the
    // wrapper arm keeps them whether or not `_uninst_wrappers`' case names them.
    // A marked fixture is the only thing that tells the two worlds apart.
    // `install-census.test.ts` derives the case's MEMBERSHIP; this measures
    // what the membership DOES.
    // The lane's ID-SHAPED two — the ones with no dot, which is what makes a
    // name id-shaped — derived from the one test-side list (final review F4).
    const idShaped = GPT_LANE_BINS.filter((n) => !n.includes('.'));
    expect(idShaped).toEqual(['ccgpt-runtime', 'ccrc-codex']);
    for (const name of idShaped) {
      const home = mkTmp(`ccrc-uninst-${name}-marked-`);
      plantInstalledBox(home);
      writeFileSync(join(home, '.local', 'bin', name), markGenerated(`#!/usr/bin/env bash\n# ${name}\n`), { mode: 0o755 });
      const r = runVerb(home, 'uninstall');
      expect(r.code, r.stderr).toBe(0);
      expect(existsSync(join(home, '.local', 'bin', name)), `${name} survived the uninstall`).toBe(false);
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(r.stdout, `${name} was counted in the wrapper census`)
        .not.toMatch(new RegExp(`uninstall: wrappers: removed .*/${esc}(?![\\w-])`));
      expect(r.stdout, `the bin census does not name ${name}`)
        .toMatch(new RegExp(`uninstall: tree: .*(?<![\\w-])${esc}(?![\\w-]).* removed from \\$HOME/\\.local/bin`));
    }
  });

  // The GPT lane's FOUR placed executables (`plantInstalledBox` plants them),
  // and never a bare `ccgpt` — on a live fleet box that name is another
  // repository's launcher (D-3478). Another repository's
  // `ccgpt-usage@.{service,timer}` pair is the other half of this case since
  // 2b-1's final review, F-1: ccrc places its own under `ccrc-codex-usage@`
  // (Plan 3a), because on a live fleet box those two names hold ANOTHER
  // repository's pair with an instance enabled, so an uninstall that removed
  // them would delete a live unit ccrc never wrote. They must survive byte for
  // byte, their enabled instance's wants link too, and no systemctl verb may
  // name them. `itLinux`, as every other systemd-argv assertion in this file.
  itLinux('uninstall removes the four GPT-lane executables and ccrc\'s own usage pair and instance, and leaves a ccgpt-usage@ pair and instance it never placed alone (Plan 3a Task 7)', () => {
    const home = mkTmp('ccrc-uninst-ccgpt-');
    plantInstalledBox(home);
    const bin = join(home, '.local', 'bin');
    const units = join(home, '.config', 'systemd', 'user');
    const foreignSvc = '[Unit]\nDescription=FOREIGN-FIXTURE ccgpt-usage@.service, not ccrc\'s\n';
    const foreignTimer = '[Unit]\nDescription=FOREIGN-FIXTURE ccgpt-usage@.timer, not ccrc\'s\n';
    writeFileSync(join(units, 'ccgpt-usage@.service'), foreignSvc);
    writeFileSync(join(units, 'ccgpt-usage@.timer'), foreignTimer);
    mkdirSync(join(units, 'timers.target.wants'), { recursive: true });
    const wants = join(units, 'timers.target.wants', 'ccgpt-usage@codex-a.timer');
    symlinkSync(join(units, 'ccgpt-usage@.timer'), wants);
    // ccrc's OWN instance for the SAME id, beside the foreign one.
    const ours = join(units, 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer');
    symlinkSync(join(units, 'ccrc-codex-usage@.timer'), ours);
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    for (const name of GPT_LANE_BINS) {
      expect(existsSync(join(bin, name)), `${name} survived uninstall`).toBe(false);
      // FLANKED: a name must be printed on its own, never satisfied by a
      // longer sibling that happens to contain it.
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(r.stdout, `the bin census does not name ${name} on its own`)
        .toMatch(new RegExp(`uninstall: tree: .*(?<![\\w-])${esc}(?![\\w-]).* removed from \\$HOME/\\.local/bin`));
    }
    expect(r.stdout, 'the bin census claims to remove a bare ccgpt, which ccrc never placed')
      .not.toMatch(/uninstall: tree: .*(?<![\w-])ccgpt(?![\w-])/);
    expect(readFileSync(join(units, 'ccgpt-usage@.service'), 'utf8'), 'the foreign .service was removed or changed')
      .toBe(foreignSvc);
    expect(readFileSync(join(units, 'ccgpt-usage@.timer'), 'utf8'), 'the foreign .timer was removed or changed')
      .toBe(foreignTimer);
    expect(lstatSync(wants).isSymbolicLink(), 'the enabled instance\'s wants link was removed').toBe(true);
    expect(readlinkSync(wants)).toBe(join(units, 'ccgpt-usage@.timer'));
    expect(existsSync(ours) || (() => { try { lstatSync(ours); return true; } catch { return false; } })(),
      'ccrc\'s own usage instance survived the uninstall').toBe(false);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(join(units, u)), `ccrc's own ${u} survived`).toBe(false);
    }
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls, 'a systemctl verb named a ccgpt-usage unit, template or instance').not.toContain('ccgpt-usage');
  });

  // The other half of D-1347, and the half that makes the removal safe: the
  // install REFUSES to touch a `graphify` it did not write (`ccrc did not
  // write it — left in place`), so the uninstall may not remove one either.
  // `_uninst_wrappers`' rule one function up, in this file's own words:
  // everything ccrc could not prove it wrote is left in place. Proof is the
  // link's own one-hop target against the literal the install writes — nothing
  // else.
  it('graphify: a launcher ccrc did not write SURVIVES uninstall — file and foreign symlink alike', () => {
    const home = mkTmp('ccrc-uninst-gfx-foreign-');
    plantInstalledBox(home);
    const bin = join(home, '.local', 'bin');
    // (a) a hand-written launcher — a regular file, exactly what
    // `_inst_graphify_engine` refuses to replace.
    rmSync(join(bin, 'graphify'), { force: true });
    const hand = '#!/bin/bash\n# my own launcher\nexec /opt/graphify/bin/graphify "$@"\n';
    writeFileSync(join(bin, 'graphify'), hand, { mode: 0o755 });
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(bin, 'graphify'), 'utf8'),
      'a launcher ccrc never wrote was removed by the uninstall').toBe(hand);
    expect(r.stdout).toMatch(/uninstall: tree: kept .*graphify.*ccrc never wrote it/);

    // (b) a symlink at a DIFFERENT engine — a pipx install, a moved venv, an
    // older layout's link. It is a symlink, so the arm that judges symlinks is
    // the one that answers, and its target is not the literal ccrc writes.
    const home2 = mkTmp('ccrc-uninst-gfx-foreignlink-');
    plantInstalledBox(home2);
    const bin2 = join(home2, '.local', 'bin');
    const other = join(home2, 'opt', 'graphify', 'bin');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'graphify'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    rmSync(join(bin2, 'graphify'), { force: true });
    symlinkSync(join(other, 'graphify'), join(bin2, 'graphify'));
    const r2 = runVerb(home2, 'uninstall');
    expect(r2.code, r2.stderr).toBe(0);
    expect(lstatSync(join(bin2, 'graphify')).isSymbolicLink(),
      'a link at somebody else\'s engine was removed').toBe(true);
    expect(r2.stdout).toMatch(/uninstall: tree: kept .*graphify — it is a symlink to /);
  });

  it('keep-asides: the restore commands are PRINTED and the files untouched', () => {
    const home = mkTmp('ccrc-uninst-keepaside-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    const saved = join(home, '.tmux.conf.pre-ccrc-20260101T000000Z');
    expect(r.stdout).toContain(`mv ${saved} ${join(home, '.tmux.conf')}`);
    expect(readFileSync(saved, 'utf8')).toBe('# the operator\'s own\n');
    expect(readFileSync(join(home, '.tmux.conf'), 'utf8')).toBe('# the shipped tmux.conf\n');
    // THE THIRD GLOB (D-1349): the pip console-script shim the graphify
    // converge copied aside before repointing `~/.local/bin/graphify`. Without
    // it in the loop the operator is off ccrc with a HOLE where their graphify
    // used to be — the aside sits there unnamed and nothing tells them it is
    // the file to move back. `_uninst_tree_bins` has already removed ccrc's
    // link by the time this prints, so the destination path is free.
    const gsaved = join(home, '.local', 'bin', 'graphify.pre-ccrc-20260101T000000Z');
    expect(r.stdout).toContain(`mv ${gsaved} ${join(home, '.local', 'bin', 'graphify')}`);
    expect(existsSync(gsaved), 'the graphify aside was consumed rather than named').toBe(true);
  });

  // R34 (final whole-branch review, Critical): since `ccrc memory --apply`,
  // `~/.ccrc/memory/<slug>` is the SOLE live copy of a project's durable
  // memory — every agent home's own copy is a symlink into it. A bare
  // `--purge` must not destroy it: the documented-safe sequence `ccrc
  // backup && ccrc uninstall --purge` would otherwise silently destroy a
  // session's prose with no exception, no prompt and no mention. Bare
  // `--purge` removes ~/.ccrc's CONFIG and ~/ccrc-backups but PRESERVES
  // ~/.ccrc/memory (and so ~/.ccrc itself, now holding only `memory/`).
  it('--purge removes ~/.ccrc\'s config and ~/ccrc-backups, PRESERVES ~/.ccrc/memory, and NEVER touches worktrees', () => {
    const home = mkTmp('ccrc-uninst-purge-');
    plantInstalledBox(home);
    mkdirSync(join(home, '.ccrc', 'memory', '-p-demo'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'memory', '-p-demo', 'a-lesson.md'),
      '---\nname: A lesson\n---\nprose a session wrote once\n');
    const r = runVerb(home, 'uninstall', ['--purge']);
    expect(r.code, r.stderr).toBe(0);
    // config is gone
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'ccrc.env'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    // the memory store survives, byte for byte
    expect(readFileSync(join(home, '.ccrc', 'memory', '-p-demo', 'a-lesson.md'), 'utf8'))
      .toContain('prose a session wrote once');
    expect(r.stdout).toMatch(/PRESERVED/);
    expect(r.stdout).toMatch(/--purge-memory/);
    expect(existsSync(join(home, 'worktrees', 'fixture-ws', 'work.txt')),
      '--purge ate a worktree').toBe(true);
    expect(existsSync(join(home, 'tmux-poison'))).toBe(false);
  });

  // Bare `--purge` with NO memory ever migrated: nothing to preserve, and
  // the whole of `~/.ccrc` (never just its config) should still go, exactly
  // as `--purge` always did before this fix.
  it('--purge with no memory store ever migrated removes ~/.ccrc whole, as before', () => {
    const home = mkTmp('ccrc-uninst-purge-nomem-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['--purge']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // Re-review fix: `_uninst_purge`'s preserve-memory arm used to iterate
  // `"$HOME/.ccrc"/*` under `nullglob` ALONE, so a DOTFILE directly under
  // `~/.ccrc` (nothing in this tree writes one, but an operator or the OS
  // can — a `.DS_Store`, an editor swap file, a `.bak`) survived the loop,
  // the `rmdir` right after it then failed on ENOTEMPTY, and the close line
  // still unconditionally claimed "~/.ccrc and ~/ccrc-backups removed" —
  // measured, with the dotfile left behind beside that very message. Seed
  // one and require BOTH that it is actually gone (the `dotglob` fix) and
  // that the close line cannot lie about it either way.
  it('a dotfile under ~/.ccrc does not survive bare --purge, and the close line never claims a removal that did not happen', () => {
    const home = mkTmp('ccrc-uninst-purge-dotfile-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.ccrc', '.hidden-thing'), 'operator/OS residue, not written by ccrc');
    const r = runVerb(home, 'uninstall', ['--purge']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', '.hidden-thing'))).toBe(false);
    expect(r.stdout).toMatch(/~\/\.ccrc and ~\/ccrc-backups removed/);
  });

  // The explicit second flag: an operator who really wants the memory gone
  // too says so, and only then does it go.
  it('--purge --purge-memory removes ~/.ccrc whole, memory store included', () => {
    const home = mkTmp('ccrc-uninst-purge-mem-');
    plantInstalledBox(home);
    mkdirSync(join(home, '.ccrc', 'memory', '-p-demo'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'memory', '-p-demo', 'a-lesson.md'), 'prose\n');
    const r = runVerb(home, 'uninstall', ['--purge', '--purge-memory']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(r.stdout).toMatch(/config AND its memory store/);
  });

  // `--purge-memory` names something to extend; without `--purge` there is
  // nothing to extend, and silently ignoring the flag would be the same
  // "operator asked for X, the tool quietly did not-X" shape this branch's
  // own conventions forbid elsewhere.
  it('--purge-memory without --purge is a usage error, exit 2, nothing removed', () => {
    const home = mkTmp('ccrc-uninst-purgemem-alone-');
    plantInstalledBox(home);
    const r = runVerb(home, 'uninstall', ['--purge-memory']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--purge-memory needs --purge/);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(true);
    expect(existsSync(join(home, 'ccrc'))).toBe(true);
  });
});

// ── W6 Task 6: the versions root and a stray migration ────────────────────
// Spec §11's audit gives `cmd_uninstall`'s `rm -rf -- "$BOX_TREE_DIR"` the
// verdict "removes only the link — gains a sweep of `~/ccrc-versions/`". The
// sweep takes the kept versions and, D-3452, the
// pre-versioned tree a one-time migration keeps until a gate that will now
// never run, with its `~/.ccrc/migrating-to` marker.
describe('ccrc uninstall: the versions root and a stray migration (W6 Task 6)', () => {
  // `lstat`, never `existsSync`: a DANGLING `~/ccrc` answers existsSync false,
  // and a link that survives with nothing behind it is exactly what the
  // trailing-slash spelling of step 1 leaves (GNU rm empties the version
  // THROUGH the link, answers 0, keeps the link — measured).
  const present = (p: string): boolean => {
    try { lstatSync(p); return true; } catch { return false; }
  };
  const plantMemory = (home: string): string => {
    const d = join(home, '.ccrc', 'memory', 'fixture-project');
    mkdirSync(d, { recursive: true });
    const f = join(d, 'MEMORY.md');
    writeFileSync(f, '# a project\'s durable memory\n');
    return f;
  };
  const plantMigration = (home: string, name: string): void => {
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    writeFileSync(join(home, 'ccrc.migrating', 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    writeFileSync(join(home, '.ccrc', 'migrating-to'), `${name}\n`);
  };

  it('a versioned box: the link, every kept version and the root go; backups and memory stay (spec §11 audit: "gains a sweep of ~/ccrc-versions/")', () => {
    const home = mkTmp('ccrc-uninst-versions-');
    plantInstalledBox(home, { versioned: ['v9.9.2', 'v9.9.1', 'v9.9.0'] });
    // A legacy target's staging directory (Task 4's `.<tag>.incoming.<pid>`):
    // removed WITH the root, never counted as a kept tree.
    mkdirSync(join(home, 'ccrc-versions', '.v9.9.3.incoming.4242', 'ccd'), { recursive: true });
    // A flip to v9.9.1 killed between `_plat_ln_swap`'s `ln -sfn` and its
    // rename (Task 1): the staged link stands beside `~/ccrc`, and only the
    // NEXT flip would ever replace it — an uninstalled box flips nothing.
    symlinkSync(join(home, 'ccrc-versions', 'v9.9.1'), join(home, 'ccrc.new'));
    const memory = plantMemory(home);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'the fixture is not a W6 box').toBe(true);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link survived').toBe(false);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived').toBe(false);
    // `lstat`: with the root gone the staged link DANGLES, and existsSync
    // would call a surviving one absent.
    expect(present(join(home, 'ccrc.new')), 'a staged ~/ccrc.new link survived').toBe(false);
    expect(readFileSync(memory, 'utf8'), '~/.ccrc/memory was touched').toBe('# a project\'s durable memory\n');
    expect(existsSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd')), 'a backup was removed').toBe(true);
    expect(r.stdout).toMatch(/^uninstall: tree: ~\/ccrc removed; .*update-intent\) removed; ~\/ccrc-versions removed \(3 kept tree\(s\)\); ~\/ccrc\.new removed$/m);
    expect(r.stdout).not.toMatch(/ccrc\.migrating removed/);
  });

  it('a migrated box: ~/ccrc.migrating and ~/.ccrc/migrating-to go too — no gate will ever run to remove them', () => {
    const home = mkTmp('ccrc-uninst-migrated-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    plantMigration(home, 'v9.9.1');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc.migrating')), '~/ccrc.migrating survived').toBe(false);
    expect(present(join(home, '.ccrc', 'migrating-to')), 'migrating-to survived').toBe(false);
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link survived').toBe(false);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived').toBe(false);
    expect(r.stdout).toMatch(/; ~\/ccrc-versions removed \(1 kept tree\(s\)\); ~\/ccrc\.migrating removed$/m);
  });

  it('a box installed before W6 (a real ~/ccrc directory): today\'s removal, and the line says there was no versions root', () => {
    const home = mkTmp('ccrc-uninst-prew6-');
    plantInstalledBox(home);
    expect(lstatSync(join(home, 'ccrc')).isDirectory()).toBe(true);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc'))).toBe(false);
    expect(r.stdout).toMatch(/update-intent\) removed; no ~\/ccrc-versions$/m);
    expect(r.stdout).not.toMatch(/ccrc\.migrating removed/);
    expect(r.stdout).not.toMatch(/ccrc\.new/);
  });

  it('a crashed migration (~/ccrc.migrating and no ~/ccrc): the sweep still runs and nothing dies', () => {
    const home = mkTmp('ccrc-uninst-crashpair-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    // The two-syscall window's crash shape (Task 3): the old tree moved aside,
    // the marker written, and the link never placed.
    unlinkSync(join(home, 'ccrc'));
    plantMigration(home, 'v9.9.1');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    for (const p of ['ccrc', 'ccrc-versions', 'ccrc.migrating', join('.ccrc', 'migrating-to')]) {
      expect(present(join(home, p)), `${p} survived`).toBe(false);
    }
    expect(r.stdout).toMatch(/; ~\/ccrc-versions removed \(1 kept tree\(s\)\); ~\/ccrc\.migrating removed$/m);
  });

  it('a ~/ccrc-versions that is not a directory, and a ~/ccrc.new that is not a link, are left in place, and the line says so — ccrc made neither', () => {
    const home = mkTmp('ccrc-uninst-versions-notdir-');
    plantInstalledBox(home);
    writeFileSync(join(home, 'ccrc-versions'), 'not a versions root\n');
    // `_plat_ln_swap` only ever writes a LINK at `~/ccrc.new` (Task 1), and
    // refuses to flip over anything else; a directory there is someone else's.
    mkdirSync(join(home, 'ccrc.new'));
    writeFileSync(join(home, 'ccrc.new', 'MINE'), 'not ccrc\'s\n');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'ccrc-versions'), 'utf8')).toBe('not a versions root\n');
    expect(readFileSync(join(home, 'ccrc.new', 'MINE'), 'utf8'), 'a ~/ccrc.new ccrc did not make was touched').toBe('not ccrc\'s\n');
    expect(r.stdout).toMatch(/update-intent\) removed; ~\/ccrc-versions left in place — it is not a directory ccrc made; ~\/ccrc\.new left in place — it is not a link ccrc made$/m);
  });

  // ── D-3453 ──────────────────────────────
  // The sweep above removes what every other writer touches only under
  // ~/.ccrc/update.lock, so an uninstall PROBES it before removing anything.
  // A real holder, wave 4's shape: ONE process takes flock and then becomes
  // `sleep` (exec keeps the pid and the descriptor), killed after each case.
  const holders: ChildProcess[] = [];
  afterEach(() => { for (const h of holders.splice(0)) h.kill('SIGKILL'); });
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const holdLock = (home: string): void => {
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    const t0 = Date.now();
    while (lockFree(home)) {
      if (Date.now() - t0 > 10_000) throw new Error('timed out waiting for the fixture holder to take the lock');
      spawnSync('sleep', ['0.05']);
    }
  };
  // What a refusal must leave: the gate runs after the live-session gate and
  // BEFORE `_uninst_units`, so nothing at all was removed or stopped.
  const untouched = (home: string): void => {
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link was removed').toBe(true);
    expect(present(join(home, 'ccrc-versions', 'v9.9.1')), 'a kept version was removed').toBe(true);
    expect(existsSync(join(home, '.config', 'systemd', 'user', 'ccrc.service')), 'a unit file was removed').toBe(true);
    expect(existsSync(join(home, 'systemctl-calls')), 'a unit was touched').toBe(false);
  };

  itLinux('an update holding ~/.ccrc/update.lock refuses the uninstall before anything is removed, naming the holder; --force proceeds past it', () => {
    const home = mkTmp('ccrc-uninst-lock-held-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    holdLock(home);
    let r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    // The holder's fields come from the `update.json` wave 4 plants in
    // `plantInstalledBox` (pid 4242, target v1.0.0).
    expect(r.stderr).toMatch(/^ccrc: an update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v1\.0\.0\) — uninstalling under it would remove the version it is placing or flipping to\. Wait for it to finish, or run: ccrc uninstall --force — nothing on this box was removed$/m);
    untouched(home);
    // THE CONTROL: the same box, the holder STILL holding, and --force.
    r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived --force').toBe(false);
  });

  itLinux('a ~/.ccrc/update.lock that cannot be MEASURED refuses with its own sentence — never the holder\'s, and nothing is removed', () => {
    const home = mkTmp('ccrc-uninst-lock-unmeasured-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    // A DIRECTORY where the lock file goes: it exists, and the probe's
    // `exec {p}>>` on it fails, so `_upd_lock_probe` answers 3 at every uid
    // (wave 4's own rc-3 fixture; a `chmod 000` file root opens anyway).
    rmSync(lockPath(home));
    mkdirSync(lockPath(home));
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: ~\/\.ccrc\/update\.lock could not be measured \(probe rc 3\) — refusing to uninstall past a lock this box cannot see\. Run ccrc uninstall --force to proceed anyway — nothing on this box was removed$/m);
    expect(r.stderr, 'rc 3 was folded into "held"').not.toMatch(/an update holds/);
    untouched(home);
  });
});

describe('ccrc backup: update\'s step 2 standalone, with CCRC_BACKUP_KEEP pruning', () => {
  it('takes the same set to the same directory shape: coord.db snapshot, dists, ccd, units', () => {
    const home = mkTmp('ccrc-backup-set-');
    plantInstalledBox(home);
    plantCoordDb(home);
    const r = runVerb(home, 'backup');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const m = /^backup: (\S+)/m.exec(r.stdout);
    expect(m, `no "backup:" line in:\n${r.stdout}`).not.toBeNull();
    const dir = m![1]!;
    expect(dir.startsWith(join(home, 'ccrc-backups') + '/')).toBe(true);
    // A real snapshot (VACUUM INTO writes a database), the ccd, a unit, a dist.
    const snap = readFileSync(join(dir, 'coord.db'));
    expect(snap.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    expect(readFileSync(join(dir, 'ccd'), 'utf8'))
      .toBe(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8'));
    // The job file, under the name THIS platform has it: `_upd_backup` copies
    // whichever the box installs, and macOS has one plist where Linux has a
    // unit. A rollback needs the file it actually took.
    expect(existsSync(join(dir, process.platform === 'darwin'
      ? 'app.ccrc.ccrc.plist' : 'ccrc.service'))).toBe(true);
    expect(existsSync(join(dir, 'server-dist', 'index.js'))).toBe(true);
    expect(existsSync(join(dir, 'agent-dist', 'index.js'))).toBe(true);
  });

  // R34 (final whole-branch review): `~/.ccrc/memory` used to be absent
  // from this set entirely — the exact gap that let `ccrc backup && ccrc
  // uninstall --purge` read as a documented-safe sequence while destroying
  // a project's only copy of its own memory. `ccrc backup` must snapshot it
  // like everything else here, byte for byte.
  it('includes ~/.ccrc/memory — the one live copy of every project\'s durable memory', () => {
    const home = mkTmp('ccrc-backup-memory-');
    plantInstalledBox(home);
    plantCoordDb(home);
    mkdirSync(join(home, '.ccrc', 'memory', '-p-demo'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'memory', '-p-demo', 'a-lesson.md'), 'prose\n');
    const r = runVerb(home, 'backup');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const dir = /^backup: (\S+)/m.exec(r.stdout)![1]!;
    expect(readFileSync(join(dir, 'memory', '-p-demo', 'a-lesson.md'), 'utf8')).toBe('prose\n');
  });

  it('absence of ~/.ccrc/memory (nothing ever migrated) is ordinary, not a failure', () => {
    const home = mkTmp('ccrc-backup-nomemory-');
    plantInstalledBox(home);
    plantCoordDb(home);
    const r = runVerb(home, 'backup');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });

  it('prunes to the newest CCRC_BACKUP_KEEP timestamped dirs — hand-made siblings survive', () => {
    const home = mkTmp('ccrc-backup-prune-');
    plantInstalledBox(home);
    for (const ts of ['20250101-000000', '20250102-000000', '20250103-000000']) {
      mkdirSync(join(home, 'ccrc-backups', ts), { recursive: true });
    }
    mkdirSync(join(home, 'ccrc-backups', 'pre-flip-agent-dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc-backups', 'pre-flip-agent-dist', 'keep.txt'), 'hand-made\n');
    const r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '2' });
    expect(r.code, r.stderr).toBe(0);
    const left = readdirSync(join(home, 'ccrc-backups')).sort();
    // This run's own dir (newest) + the newest planted one + the sibling.
    expect(left).toContain('pre-flip-agent-dist');
    expect(left).toContain('20250103-000000');
    expect(left).not.toContain('20250101-000000');
    expect(left).not.toContain('20250102-000000');
    expect(left.length).toBe(3);
  });
});

describe('ccrc backup: CCRC_BACKUP_KEEP is one bounded number, the same validator as CCRC_VERSIONS_KEEP (F6)', () => {
  const PLANTED = ['20250101-000000', '20250102-000000', '20250103-000000'];
  const WHY = (v: string): string => `CCRC_BACKUP_KEEP='${v}' is not a whole number from 0 to 9999`;
  const box = (prefix: string): string => {
    const home = mkTmp(prefix);
    plantInstalledBox(home);
    for (const ts of PLANTED) mkdirSync(join(home, 'ccrc-backups', ts), { recursive: true });
    return home;
  };

  it('18446744073709551615 wraps in arithmetic and used to prune EVERY backup, the new one included: it is refused and nothing is pruned', () => {
    const home = box('ccrc-backup-keep-wrap-');
    const r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '18446744073709551615' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain(`ccrc: ${WHY('18446744073709551615')} — nothing was pruned`);
    // the three planted ones, and this run's own (the backup is taken before the prune is asked)
    const left = readdirSync(join(home, 'ccrc-backups')).sort();
    expect(left.slice(0, 3)).toEqual(PLANTED);
    expect(left).toHaveLength(4);
  });

  it('controls: 9999 works, 10000 is refused, a non-number is refused naming its value, and 0002 is two', () => {
    let home = box('ccrc-backup-keep-9999-');
    let r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '9999' });
    expect(r.code, r.stderr).toBe(0);
    expect(readdirSync(join(home, 'ccrc-backups'))).toHaveLength(4);
    home = box('ccrc-backup-keep-10000-');
    r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '10000' });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain(`ccrc: ${WHY('10000')} — nothing was pruned`);
    expect(readdirSync(join(home, 'ccrc-backups'))).toHaveLength(4);
    home = box('ccrc-backup-keep-word-');
    r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: 'many\x1b[0m' });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain(`ccrc: ${WHY('many?[0m')} — nothing was pruned`);
    // `08` in bash arithmetic is an invalid octal number: normalised, it is eight and prunes nothing here.
    home = box('ccrc-backup-keep-octal-');
    r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '0008' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toMatch(/value too great for base/);
    expect(readdirSync(join(home, 'ccrc-backups'))).toHaveLength(4);
    home = box('ccrc-backup-keep-zeros-');
    r = runVerb(home, 'backup', [], { CCRC_BACKUP_KEEP: '0002' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readdirSync(join(home, 'ccrc-backups')).sort().slice(0, 1)).toEqual(['20250103-000000']);
    expect(readdirSync(join(home, 'ccrc-backups'))).toHaveLength(2);
  });
});

describe('ccrc logs: a thin, role-aware journalctl passthrough', () => {
  itLinux('defaults to ccrc.service and passes -f / -n through — the recorded argv is the pin', () => {
    const home = mkTmp('ccrc-logs-server-');
    plantInstalledBox(home);
    const r = runVerb(home, 'logs', ['-f', '-n', '50']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'journalctl-argv'), 'utf8').trim())
      .toBe('--user -u ccrc.service -f -n 50');
  });

  itLinux('CCRC_ROLE=fleet in ccrc.env selects ccrc-agent.service', () => {
    const home = mkTmp('ccrc-logs-fleet-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    const r = runVerb(home, 'logs');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'journalctl-argv'), 'utf8').trim())
      .toBe('--user -u ccrc-agent.service');
  });

  // macOS HAS NO JOURNAL. systemd captures a unit's output into one and
  // `journalctl --user -u` reads it back; launchd's only equivalent is the
  // `StandardOutPath` the installer writes into the job's own plist. So the
  // verb tails THAT file — same two flags, same role selection, and the
  // arguments an operator types do not change across platforms.
  itDarwin('tails the job\'s own log file, with the same -f / -n flags', () => {
    const home = mkTmp('ccrc-logs-darwin-');
    plantInstalledBox(home);
    mkdirSync(join(home, '.ccrc', 'logs'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'logs', 'app.ccrc.ccrc.log'), 'one\ntwo\nthree\n');
    const r = runVerb(home, 'logs', ['-n', '2']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('two\nthree\n');
  });

  itDarwin('CCRC_ROLE=fleet selects the AGENT\'s log, by the same rule', () => {
    const home = mkTmp('ccrc-logs-darwin-fleet-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    mkdirSync(join(home, '.ccrc', 'logs'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'logs', 'app.ccrc.ccrc-agent.log'), 'agent line\n');
    const r = runVerb(home, 'logs');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('agent line');
  });

  itDarwin('REFUSES by name when the job has never run — not the same sentence as a missing journal', () => {
    // A box whose server has not started yet has no log FILE, and telling an
    // operator to go read one that is not there is the dead end this arm
    // exists to avoid. The remedy names the job to inspect instead.
    const home = mkTmp('ccrc-logs-darwin-nolog-');
    plantInstalledBox(home);
    const r = runVerb(home, 'logs');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no log at .*app\.ccrc\.ccrc\.log/);
    expect(r.stderr).toMatch(/launchctl print/);
  });

  it('-n without a value is a usage error, exit 2, and journalctl never ran', () => {
    const home = mkTmp('ccrc-logs-badn-');
    plantInstalledBox(home);
    const r = runVerb(home, 'logs', ['-n']);
    expect(r.code).toBe(2);
    expect(existsSync(join(home, 'journalctl-argv'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 11 — `_uninst_codex`: stop what ccrc started, remove the
// runtime, keep the lane state, the logs and the credential (spec §13).
//
// TIER ORDER: FRONT-FIRST — shim, then litellm (ruling PF-18), matching
// `_codex_stop_lane`'s own order (ccd/ccrc: "both tiers, the FRONT one
// first: the shim closes before the gateway behind it"). `CODEX_TIERS` is
// declared "litellm shim" for a DIFFERENT purpose (that function's composed
// "litellm <word>, shim <word>" answer), so every call-order and
// closing-line assertion below lists shim before litellm.
// ════════════════════════════════════════════════════════════════════════
const READY = { CCRC_CODEX_READY_S: '20' };
const realPy = (): string => realPath('python3');

describe('ccrc uninstall: the codex step, in order and contained (Plan 2b-2 Task 11)', () => {
  it('the harness contains the transient-unit launcher: it resolves inside this HOME and refuses', () => {
    const home = mkTmp('ccrc-uninst-sdrun-contained-');
    const r = spawnSync(BASH, ['-c', SPINE_CONTAINMENT_PROBE], { env: verbEnv(home), encoding: 'utf8' });
    expect(r.stdout).toContain(`at=${join(home, '.local', 'bin', 'systemd-run')}\n`);
    expect(r.stdout).toMatch(/^run-rc=97$/m);
    expect(r.stdout).toMatch(/^env-rc=0$/m);
    expect(spineRunCalls(home).join('\n')).toContain('--unit=fixture-containment-probe.service');
  });

  // ── Fix round 2, N2: harness-only pins on the two new containment
  // guards themselves (codexLaneFixture.ts) — no verb, no spawn of ccrc or
  // ccd, matching the HARD RULE. A bare env, not any builder's, so these
  // pin the GUARDS, not one file's use of them.
  const bareEnv = (home: string): NodeJS.ProcessEnv =>
    ({ ...process.env, HOME: home, PATH: `${join(home, '.local', 'bin')}:${process.env['PATH'] ?? ''}` });

  it('adoptPlantedSystemd alone fronts and marks both systemctl and systemd-run (fix round 2, N2a)', () => {
    const home = mkTmp('ccrc-uninst-adopt-alone-');
    // Task 4/5's real fake manager — the thing adoptPlantedSystemd must move
    // aside. No harness's own SUBSEQUENT plant() runs after this: the point
    // is what adoptPlantedSystemd leaves behind on its own.
    plantSystemd(home, { userManager: true });
    adoptPlantedSystemd(home);
    // Proven the same way a runner proves it — through the shared check,
    // not by re-reading the mark text here.
    expect(() => assertSpineFrontContained(bareEnv(home), home)).not.toThrow();
    expect(existsSync(join(home, '.local', 'bin', '.codex-systemctl')), 'the delegate systemctl was never adopted').toBe(true);
    expect(existsSync(join(home, '.local', 'bin', '.codex-systemd-run')), 'the delegate systemd-run was never adopted').toBe(true);
  });

  it('assertSpineFrontContained throws on an unfronted HOME, an unmarked front, and separately for systemctl and systemd-run (fix round 2, N2b)', () => {
    // (i) Nothing planted at all: neither name can resolve to <home>'s front.
    const unfronted = mkTmp('ccrc-uninst-assert-unfronted-');
    mkdirSync(join(unfronted, '.local', 'bin'), { recursive: true });
    expect(() => assertSpineFrontContained(bareEnv(unfronted), unfronted)).toThrow(/systemd-run/);

    // (ii) systemd-run planted at the right path, but WITHOUT the mark.
    const unmarkedRun = mkTmp('ccrc-uninst-assert-unmarked-run-');
    mkdirSync(join(unmarkedRun, '.local', 'bin'), { recursive: true });
    writeFileSync(join(unmarkedRun, '.local', 'bin', 'systemd-run'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    expect(() => assertSpineFrontContained(bareEnv(unmarkedRun), unmarkedRun))
      .toThrow(/systemd-run.*does not carry the spine front mark/);

    // (iii) systemd-run correctly fronted (via adoptPlantedSystemd), but
    // systemctl overwritten WITHOUT the mark — proves systemctl is checked
    // SEPARATELY, never satisfied by systemd-run alone passing (N1's gap).
    const unmarkedCtl = mkTmp('ccrc-uninst-assert-unmarked-ctl-');
    plantSystemd(unmarkedCtl, { userManager: true });
    adoptPlantedSystemd(unmarkedCtl);
    writeFileSync(join(unmarkedCtl, '.local', 'bin', 'systemctl'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    expect(() => assertSpineFrontContained(bareEnv(unmarkedCtl), unmarkedCtl))
      .toThrow(/systemctl.*does not carry the spine front mark/);

    // (iv) systemctl correctly fronted, systemd-run removed entirely after —
    // proves systemd-run is checked too, never skipped once systemctl passes.
    const noRun = mkTmp('ccrc-uninst-assert-no-run-');
    plantSystemd(noRun, { userManager: true });
    adoptPlantedSystemd(noRun);
    rmSync(join(noRun, '.local', 'bin', 'systemd-run'));
    expect(() => assertSpineFrontContained(bareEnv(noRun), noRun)).toThrow(/systemd-run/);

    // (v) Fix round 3 (C3): `expectAbsent` REFUSES a resolution, it never
    // trusts one. systemd-run is correctly fronted; systemctl is NOT in the
    // fixture bin, and /usr/bin is on PATH, so on a Linux box with systemd
    // `command -v` finds the REAL one. That is the shape runInstall's
    // `omit: ['systemctl']` produces if its `pathWithout` override is lost.
    // A decoy directory AFTER /usr/bin makes the resolution non-empty on
    // every box, one with no systemd at all included. Nothing is executed:
    // the check only asks `command -v`.
    const absentFound = mkTmp('ccrc-uninst-assert-absent-found-');
    mkdirSync(join(absentFound, '.local', 'bin'), { recursive: true });
    writeFileSync(join(absentFound, '.local', 'bin', 'systemd-run'), spineSystemdRun(), { mode: 0o755 });
    const decoy = join(absentFound, 'decoy-bin');
    mkdirSync(decoy, { recursive: true });
    writeFileSync(join(decoy, 'systemctl'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    const absentEnv = (tail: string): NodeJS.ProcessEnv =>
      ({ ...process.env, HOME: absentFound, PATH: `${join(absentFound, '.local', 'bin')}:${tail}` });
    expect(() => assertSpineFrontContained(absentEnv(`/usr/bin:${decoy}`), absentFound, { expectAbsent: ['systemctl'] }))
      .toThrow(/systemctl was expected absent .* but resolved to /);
    // The control: the same HOME with systemctl resolving NOWHERE passes, so
    // the throw above is the resolution's, not a broken fixture's.
    expect(() => assertSpineFrontContained(absentEnv(join(absentFound, 'no-such-dir')), absentFound,
      { expectAbsent: ['systemctl'] })).not.toThrow();
  });

  it('every runner calls assertSpineFrontContained on its final env, immediately before the spawn (fix round 2, N2c)', () => {
    // A TEXT pin, cross-file: each runner's own body, from its function
    // header to the point it spawns, must contain the call — not merely
    // somewhere in the file.
    const between = (src: string, header: RegExp, spawnMarker: string): string => {
      const m = header.exec(src);
      expect(m, `no match for ${header} in this file`).toBeTruthy();
      const from = m!.index;
      const to = src.indexOf(spawnMarker, from);
      expect(to, `no ${JSON.stringify(spawnMarker)} after ${header}`).toBeGreaterThan(from);
      return src.slice(from, to);
    };
    const uninstallSrc = readFileSync(join(here, 'ccrc-uninstall.test.ts'), 'utf8');
    const installSrc = readFileSync(join(here, 'ccrc-install.test.ts'), 'utf8');
    const updateSrc = readFileSync(join(here, 'ccrc-update.test.ts'), 'utf8');
    expect(between(uninstallSrc, /^function runVerb\(/m, 'spawnSync(BASH'))
      .toMatch(/assertSpineFrontContained\(env, home\)/);
    expect(between(updateSrc, /^function runUpdate\(/m, 'spawnSync(BASH'))
      .toMatch(/assertSpineFrontContained\(env, home\)/);

    // Fix round 3 (C4): "on its FINAL env" is an ORDER, and the order is
    // what is pinned. `replantDoctorStubs` and the `opts.stubs` loop both
    // write into `<home>/.local/bin`, so a check above either of them
    // validates a directory the spawn no longer runs against — an unmarked
    // `opts.stubs` systemctl would pass it.
    const indexIn = (s: string, what: RegExp, why: string): number => {
      const i = s.search(what);
      expect(i, why).toBeGreaterThan(-1);
      return i;
    };
    const inst = between(installSrc, /^function runInstall\(/m, 'const ccrc = opts.from');
    const instCall = indexIn(inst, /assertSpineFrontContained\(env, home,/,
      'runInstall does not call assertSpineFrontContained before its spawn');
    const instReplant = indexIn(inst, /replantDoctorStubs\(home\);/,
      'runInstall no longer calls replantDoctorStubs(home) — re-anchor this pin');
    const stubsLoop = indexIn(inst, /for \(const \[name, body\] of Object\.entries\(opts\.stubs \?\? \{\}\)\) \{/,
      'runInstall no longer has its opts.stubs loop — re-anchor this pin');
    const stubsLoopEnd = inst.indexOf('\n  }\n', stubsLoop);
    expect(stubsLoopEnd, 'the opts.stubs loop has no closing brace at two spaces').toBeGreaterThan(stubsLoop);
    expect(instCall, 'runInstall checks BEFORE replantDoctorStubs(home)').toBeGreaterThan(instReplant);
    expect(instCall, 'runInstall checks BEFORE its opts.stubs loop has finished').toBeGreaterThan(stubsLoopEnd);

    // Fix round 3 (C4): runInstallTty, sliced up to its pty spawn — the
    // call deleted there was green before this round. Same ORDER rule:
    // after the doctor-stub replant, and after `env` is filled from ccrcEnv.
    const tty = between(installSrc, /^function runInstallTty\(/m, 'pty.spawn(');
    const ttyCall = indexIn(tty, /assertSpineFrontContained\(env, home\)/,
      'runInstallTty does not call assertSpineFrontContained before its pty.spawn');
    const ttyReplant = indexIn(tty, /replantDoctorStubs\(home\);/,
      'runInstallTty no longer calls replantDoctorStubs(home) — re-anchor this pin');
    const ttyFill = indexIn(tty, /for \(const \[k, v\] of Object\.entries\(raw\)\)/,
      'runInstallTty no longer fills env from ccrcEnv — re-anchor this pin');
    expect(ttyCall, 'runInstallTty checks BEFORE replantDoctorStubs(home)').toBeGreaterThan(ttyReplant);
    expect(ttyCall, 'runInstallTty checks BEFORE env is filled').toBeGreaterThan(ttyFill);

    // Fix round 3 (C1): `ccrc version` through the installed launcher runs
    // the shipped ccrc, so it is a runner too. It has ONE spelling in the
    // file, inside `runLauncherVersion`, and that runner checks the env it
    // spawns with on the line before the spawn. A literal-shape pin: an
    // inline spawn spelled this way again is red; a differently-spelled
    // one is not, and nothing here claims otherwise.
    const launcherSpawn = /spawnSync\(BASH, \[join\(home, '\.local', 'bin', 'ccrc'\)/g;
    expect([...installSrc.matchAll(launcherSpawn)].length,
      'the installed launcher is spawned somewhere other than runLauncherVersion').toBe(1);
    expect(between(installSrc, /^function runLauncherVersion\(/m, 'spawnSync(BASH'))
      .toMatch(/const env = ccrcEnv\(home\);\n\s*assertSpineFrontContained\(env, home\);\n\s*const r = $/);
  });

  // ── Fix round 3, C2: the ISOLATION harnesses' wall, checked. Harness
  // level — the wall builder and the check only, no step, no spawn.
  it('assertIsolationWallFirst throws unless BOTH manager names resolve to the isolation wall (fix round 3, C2)', () => {
    // The two harnesses' own env shape: the wall first, then the caller's PATH.
    const wallEnv = (home: string, first: string): NodeJS.ProcessEnv =>
      ({ PATH: `${first}:${process.env['PATH'] ?? ''}`, HOME: home });
    // (i) control: the wall isolationManagerStubs builds, first on PATH, passes.
    const ok = mkTmp('ccrc-uninst-wall-ok-');
    expect(() => assertIsolationWallFirst(wallEnv(ok, isolationManagerStubs(ok)), ok)).not.toThrow();
    // (ii) the wall built but NOT on PATH: whatever PATH resolves (the real
    // one, or nothing) is not the wall.
    const offPath = mkTmp('ccrc-uninst-wall-off-path-');
    isolationManagerStubs(offPath);
    expect(() => assertIsolationWallFirst({ PATH: process.env['PATH'] ?? '', HOME: offPath }, offPath))
      .toThrow(/(systemd-run|systemctl) resolved to .*, not .*isolation-bin\/(systemd-run|systemctl)/);
    // (iii) the wall missing systemd-run: checked on its own, never
    // satisfied by systemctl passing.
    const noRun = mkTmp('ccrc-uninst-wall-no-run-');
    const noRunWall = isolationManagerStubs(noRun);
    rmSync(join(noRunWall, 'systemd-run'));
    expect(() => assertIsolationWallFirst(wallEnv(noRun, noRunWall), noRun))
      .toThrow(/systemd-run resolved to .*, not .*isolation-bin\/systemd-run/);
    // (iv) the wall missing systemctl: the same, the other way round.
    const noCtl = mkTmp('ccrc-uninst-wall-no-ctl-');
    const noCtlWall = isolationManagerStubs(noCtl);
    rmSync(join(noCtlWall, 'systemctl'));
    expect(() => assertIsolationWallFirst(wallEnv(noCtl, noCtlWall), noCtl))
      .toThrow(/systemctl resolved to .*, not .*isolation-bin\/systemctl/);
    // (v) the wall complete, but not FIRST: a directory ahead of it wins.
    const shadowed = mkTmp('ccrc-uninst-wall-shadowed-');
    const shadowedWall = isolationManagerStubs(shadowed);
    const ahead = join(shadowed, 'ahead-bin');
    mkdirSync(ahead, { recursive: true });
    writeFileSync(join(ahead, 'systemctl'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    expect(() => assertIsolationWallFirst(wallEnv(shadowed, `${ahead}:${shadowedWall}`), shadowed))
      .toThrow(/systemctl resolved to .*ahead-bin\/systemctl/);
  });

  // ── Final review F4: the wall is proven by WHAT the file is, not only by
  // where the name resolves. Harness level: the wall builder and the check
  // only, and the check only reads the file a name resolves to.
  it('assertIsolationWallFirst refuses a symlink to the real manager and an unmarked stub at the wall\'s own path (final review F4)', () => {
    const wallEnv = (home: string, first: string): NodeJS.ProcessEnv =>
      ({ PATH: `${first}:${process.env['PATH'] ?? ''}`, HOME: home });
    // (i) the review's measured shape: the wall's systemctl replaced by a
    // symlink to the box's real one (READ here, never run). Before this fix
    // the check passed it, because it resolves at the wall's own path.
    const real = spawnSync('/bin/sh', ['-c', 'command -v systemctl'], { encoding: 'utf8' }).stdout.trim();
    const linked = mkTmp('ccrc-uninst-wall-symlink-');
    const linkedWall = isolationManagerStubs(linked);
    rmSync(join(linkedWall, 'systemctl'));
    symlinkSync(real !== '' ? real : '/bin/sh', join(linkedWall, 'systemctl'));
    expect(() => assertIsolationWallFirst(wallEnv(linked, linkedWall), linked))
      .toThrow(/isolation-bin\/systemctl does not carry the isolation wall mark/);
    // (ii) an unmarked stub at the wall's own path, for the other name.
    const plain = mkTmp('ccrc-uninst-wall-unmarked-');
    const plainWall = isolationManagerStubs(plain);
    writeFileSync(join(plainWall, 'systemd-run'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
    expect(() => assertIsolationWallFirst(wallEnv(plain, plainWall), plain))
      .toThrow(/isolation-bin\/systemd-run does not carry the isolation wall mark/);
    // The control: the wall as built passes, so the throws above are the mark's.
    const ok = mkTmp('ccrc-uninst-wall-marked-');
    expect(() => assertIsolationWallFirst(wallEnv(ok, isolationManagerStubs(ok)), ok)).not.toThrow();
  });

  // These cases stay within fixture HOMEs and use direct ChildProcess handles
  // for unconditional cleanup; persisted PIDs grant no teardown authority.
  describeLinux('lane fixture cleanup ownership', () => {
    const children: ChildProcess[] = [];
    const living = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

    afterEach(async () => {
      await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
        child.once('exit', () => resolve());
        child.kill('SIGKILL');
      })));
    });

    const controlledChild = (home: string, childHome: string): ChildProcess => {
      const child = spawn('bash', ['-c', 'exec -a "$1" sleep 300', '_', `${home}/controlled-tier`], {
        cwd: home,
        env: { ...process.env, HOME: childHome },
        stdio: 'ignore',
      });
      expect(child.pid, 'the controlled fixture process has no pid').toBeDefined();
      children.push(child);
      return child;
    };

    it('persisted fixture evidence never grants teardown signal authority', async () => {
      const home = mkTmp('ccrc-uninst-reaper-evidence-');
      const child = controlledChild(home, home);
      const pid = child.pid!;
      await eventually(() => psArgs(pid).includes(`${home}/`), 'the controlled fixture argv');

      // Each shape is a product observation, deliberately containing the same
      // current-run PID. None is an ownership capability for fixture teardown.
      const unit = join(home, 'fake-systemd', 'units', 'fixture.service');
      mkdirSync(unit, { recursive: true });
      writeFileSync(join(home, 'fake-systemd', 'spawned'), `${pid}\n`);
      writeFileSync(join(unit, 'pid'), `${pid}\n`);
      mkdirSync(join(home, 'fake-procs'), { recursive: true });
      writeFileSync(join(home, 'fake-procs', 'litellm-1.json'), `${JSON.stringify({ pid })}\n`);
      const lane = join(home, '.ccrc', 'codex', 'codex-a');
      mkdirSync(lane, { recursive: true });
      writeFileSync(join(lane, 'litellm.pid'), `${pid}\n`);
      writeFileSync(join(lane, 'shim.pid'), `${pid}\n`);

      await killLaneProcesses(home);
      expect(living(pid), 'fixture teardown signalled a PID only persisted as evidence').toBe(true);
    });

    it('current-run callbacks run before direct handles and tolerate failures', async () => {
      const home = mkTmp('ccrc-uninst-reaper-callback-');
      const order: string[] = [];
      const child = controlledChild(home, home);
      child.once('exit', () => order.push('child'));
      trackChild(home, child);
      registerLaneCleanup(home, 'first', () => { order.push('first'); });
      registerLaneCleanup(home, 'failure', () => { order.push('failure'); throw new Error('expected fixture cleanup failure'); });
      registerLaneCleanup(home, 'last', () => { order.push('last'); });

      await killLaneProcesses(home);
      expect(order.slice(0, 3)).toEqual(['first', 'failure', 'last']);
      expect(order).toContain('child');
      await killLaneProcesses(home);
      expect(order).toEqual(['first', 'failure', 'last', 'child']);
    });

    it('the reaper has no numeric-PID teardown authority, registry, or ambient sweep machinery', () => {
      const reaper = readFileSync(join(here, 'laneReaper.ts'), 'utf8');
      for (const symbol of ['processHome', 'killIfOurs', 'LANE_REGISTRY', 'sweepableHome', 'registerLaneHome', 'unregisterLaneHome', 'reapOrphanedLaneHomes']) {
        expect(reaper, `${symbol} survived in laneReaper.ts`).not.toContain(symbol);
      }
      expect(reaper).not.toMatch(/ps[^\n]*eww|['"]eww['"]|process\.kill|rmSync|readdirSync|recursive:/);

      const fixture = readFileSync(join(here, 'codexLaneFixture.ts'), 'utf8');
      expect(fixture).not.toContain('killIfOurs');
      expect(fixture).not.toMatch(/const pids = new Set|filter\(\(pid\).*kill/);
      const config = readFileSync(join(REPO, 'server', 'vitest.config.ts'), 'utf8');
      expect(config).not.toMatch(/globalSetup|laneReaper\.ts/);
    });
  });

  it('Darwin-reachable fixture cleanup keeps current-run handle authority', () => {
    const codex = readFileSync(join(here, 'ccrc-codex.test.ts'), 'utf8');
    // Direct tiers and supervised reparented tiers both retain current-run
    // ChildProcess authority on every supported platform. L35's holder is
    // likewise a tracked helper; it has no numeric-PID teardown path.
    expect(codex).toMatch(/it\('L0b the instrument: spawnFakeLitellm \(supervised\)/);
    expect(codex).toMatch(/it\('L35 a rekey restart whose REAL stop frees the port, and a current-run foreign helper/);
    expect(codex).toMatch(/trackChild\(home, helper\)/);
    expect(codex).not.toMatch(/killIfOurs|foreignPid|nohup .*foreign-holder/);
    expect(codex).not.toMatch(/it\('L16 a tier whose proven handle lives/);
    expect(codex).toMatch(/itLinux\('L16 a tier whose proven handle lives/);

    // Product-started tiers have callbacks registered before start, so their
    // happy-path stops are behavioral assertions rather than failure cleanup.
    const account = readFileSync(join(here, 'ccrc-account.test.ts'), 'utf8');
    const foreignHelper = account.slice(account.indexOf('async function spawnForeign('), account.indexOf('/** C3\'S LOCK PROBE'));
    expect(foreignHelper).not.toMatch(/reparent:\s*true/);
    const c6 = account.slice(account.indexOf("it.skipIf(!PY3)('C6:"), account.indexOf("it('C7:"));
    expect(c6).toMatch(/finally \{ await killLaneProcesses\(home\); \}/);
    expect(account).toMatch(/it\.skipIf\(!PY3 \|\| process\.platform === 'darwin'\)\('C9:/);
  });

  it('both isolation harnesses check the env they spawn with, on the line before the spawn (fix round 3, C2)', () => {
    // A TEXT pin, cross-file. The call must sit IMMEDIATELY before the
    // harness's one spawn and name the same `env` object that spawn takes,
    // so nothing can be planted or merged between the check and the run.
    const installSrc = readFileSync(join(here, 'ccrc-install.test.ts'), 'utf8');
    const uninstallSrc = readFileSync(join(here, 'ccrc-uninstall.test.ts'), 'utf8');
    const CHECKED_SPAWN =
      /assertIsolationWallFirst\(env, home\);\n\s*const p = spawnSync\(BASH, \['-c', harness\], \{ env, encoding: 'utf8' \}\);/;
    for (const [src, header] of [
      [installSrc, /^function runStepHarness\(/m],
      [uninstallSrc, /^function runUninstCodex\(/m],
    ] as const) {
      const m = header.exec(src);
      expect(m, `no match for ${header}`).toBeTruthy();
      const end = src.indexOf('\n}\n', m!.index);
      expect(end, `${header} has no closing brace at column 0`).toBeGreaterThan(m!.index);
      const body = src.slice(m!.index, end);
      expect(body, `${header} spawns without checking its wall on the line before`).toMatch(CHECKED_SPAWN);
      expect(body.match(/spawnSync\(/g) ?? [], `${header} spawns more than once`).toHaveLength(1);
    }
  });

  it('cmd_uninstall stops the codex lanes immediately after the units, before anything else is removed', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const body = /\ncmd_uninstall\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_uninstall').toBeTruthy();
    // A step may take ONE quoted variable (the fix wave's `_uninst_codex
    // "$role"`, review C3's role gate), so the call is read by its name.
    const calls = body![1]!.split('\n').map((l) => l.trim()).filter((l) => /^_uninst_[a-z_]+( "\$[a-z_]+")?$/.test(l));
    expect(calls).toContain('_uninst_codex "$role"');
    const steps = calls.map((l) => l.split(' ')[0]!);
    expect(steps).toEqual([
      '_uninst_units',
      // Plan 2b-2 Task 11. After `_uninst_units`, whose `disable --now` takes
      // `ccrc-models.timer` down first — its refresh stops and starts a codex
      // lane's tiers — and before `_uninst_tree_bins` removes the lane's
      // executables.
      '_uninst_codex',
      '_uninst_hooks',
      '_uninst_wrappers',
      '_uninst_cc_sessions',
      '_uninst_graphify_skills',
      '_uninst_tree_bins',
      '_uninst_keep_asides',
    ]);
  });

  it('a roster with no codex lane: nothing to stop, the runtime still goes, and one line says so', () => {
    const home = mkTmp('ccrc-uninst-codex-none-');
    plantInstalledBox(home);
    // A REAL roster, upstream only. `plantInstalledBox`'s own accounts.json,
    // `{"fixture":"roster"}`, is not a roster, and it is the next case.
    codexRoster(home, []);
    // A built-looking runtime, generation and `current`: Task 4's one writer of
    // that layout (ruling R28), never a generation typed here.
    plantFakeRuntime(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex'))).toBe(false);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('uninstall: codex:')))
      .toEqual(['uninstall: codex: no codex lane in the roster — nothing to stop; the runtime at $HOME/.ccrc/runtime/codex removed']);
    // A readable roster with no codex lane is silent on stderr: rc 0 + empty
    // is Task 4's "none". MEASURED AT THE BASE (Step 0): the pre-task tree's
    // uninstall stderr on this fixture carries no `jq: ` line.
    expect(r.stderr).not.toMatch(/codex|^jq: /m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(true);
    // A box that never had a runtime says so, rather than claiming a removal.
    const home2 = mkTmp('ccrc-uninst-codex-none-absent-');
    plantInstalledBox(home2);
    codexRoster(home2, []);
    const r2 = runVerb(home2, 'uninstall');
    expect(r2.stdout).toMatch(/^uninstall: codex: no codex lane in the roster — nothing to stop; the runtime at \$HOME\/\.ccrc\/runtime\/codex was not installed$/m);
  });

  // Review C3: a lane that never ran on this box has no lane directory —
  // every ccrc start of its tiers writes one first — so there is nothing of
  // ccrc's to stop, and its lock, which would CREATE that directory and a
  // `.lock` in it, is never taken.
  it('a rostered codex lane with no lane directory is not locked or probed, and no directory is created for it (review C3)', async () => {
    const home = mkTmp('ccrc-uninst-codex-never-ran-');
    plantInstalledBox(home);
    const [lane] = await freeLanes(['codex-a']);
    codexRoster(home, [lane!]);
    plantFakeRuntime(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc', 'codex', 'codex-a')), 'the uninstall created the lane directory of a lane that never ran').toBe(false);
    expect(r.stdout).toMatch(/^uninstall: codex: codex-a: nothing to stop — it has no lane directory \(\$HOME\/\.ccrc\/codex\/codex-a\), which every ccrc start of its tiers writes first; nothing was measured or locked$/m);
    expect(r.stdout).toMatch(/^uninstall: codex: 1 codex lane\(s\) in the roster — stopped: none; left alone: none; not stopped: none; the runtime at \$HOME\/\.ccrc\/runtime\/codex removed; /m);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex'))).toBe(false);
  });

  // Review C3: install's codex steps do nothing on a server-role box, so the
  // uninstall reads, locks and probes nothing for a lane there either — even
  // one whose directory exists. The runtime goes regardless (spec §13).
  it('a server-role box reads, locks and probes no codex lane, says so in one line, and still removes the runtime (review C3)', async () => {
    const home = mkTmp('ccrc-uninst-codex-server-role-');
    plantInstalledBox(home);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const [lane] = await freeLanes(['codex-a']);
    codexRoster(home, [lane!]);
    mkdirSync(join(home, '.ccrc', 'codex', 'codex-a'), { recursive: true });
    plantFakeRuntime(home);
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, '.ccrc', 'codex', 'codex-a', '.lock')), 'the uninstall took a lane lock on a server-role box').toBe(false);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('uninstall: codex:')))
      .toEqual(['uninstall: codex: a server-role box (ccrc.env records CCRC_ROLE=server) runs no codex lane — no lane was read, measured or stopped; the runtime at $HOME/.ccrc/runtime/codex removed']);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex'))).toBe(false);
  });

  it('a file that is not a roster is never read as "no codex lane": its own line, nothing stopped, and the runtime still goes', () => {
    // `plantInstalledBox`'s accounts.json is `{"fixture":"roster"}`. Task 4's
    // `_codex_lanes` answers rc 1 there with `roster-invalid` — so this line
    // is what every other uninstall case on that fixture now prints too.
    const home = mkTmp('ccrc-uninst-codex-unreadable-');
    plantInstalledBox(home);
    plantFakeRuntime(home);   // Task 4's one runtime writer (ruling R28)
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    // Fix round 1 (spec-3/mut-5): the companion stderr line, on the real verb.
    expect(r.stderr).toMatch(/^uninstall: codex: any codex tier ccrc had started may still be running/m);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('uninstall: codex:')))
      .toEqual(['uninstall: codex: the roster could not be read (the ccrc codex: roster-invalid line above says why), so no codex lane\'s tier was measured or stopped; the runtime at $HOME/.ccrc/runtime/codex removed; kept: $HOME/.ccrc/codex/<id>/, $HOME/.ccrc/logs/codex/ and every lane\'s authDir']);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"roster"}\n');
  });
});

/** `_uninst_codex` alone: its two lane-library seams stubbed by table, Task 5's
 *  `_codex_lock` and `_codex_unlock` by `lockStub` (ruling R19), Task 4's
 *  `CODEX_TIERS` and the real `PROG`/`_ccrc_die` read out of ccd/ccrc, and a
 *  HOME holding what §13 removes (a runtime from Task 4's `plantFakeRuntime`,
 *  ruling R28) and keeps. `stopWords` (ruling PF-21) fakes `_codex_stop_tier`'s
 *  own stdout word — `foreign` at rc 0 — the race this step's consumer must
 *  never fold into `stopped`. */
function runUninstCodex(c: {
  lanes?: string[]; lanesRc?: number; withoutJq?: boolean; ours?: Record<string, StubRc>; stopRc?: Record<string, StubRc>;
  stopWords?: Record<string, string>; runtime?: boolean; lockRefuse?: string[]; lockNoFlock?: string[];
  /** The CX_TIER_WHY the `_codex_tier_ours` stub sets per `<id> <tier>` key
   *  (the final-review fix wave's addition, `runTiersStep`'s own knob): the
   *  step reads it through `_codex_tier_is_our_handle` and names a 2 through
   *  `_codex_foreign_what`. */
  oursWhy?: Record<string, string>;
}): {
  code: number; stdout: string; stderr: string; calls: string[]; home: string; kept: Record<string, string>;
  /** `CX_LOCK_FD` and `CX_LOCK_ID` after the step returned: empty unless a
   *  lane's lock was never released through `_codex_unlock`. */
  lockAfter: string;
} {
  const home = mkTmp('ccrc-uninst-codex-step-');
  const lanes = c.lanes ?? ['codex-a'];
  const kept: Record<string, string> = {};
  const keep = (rel: string, text: string): void => {
    mkdirSync(join(home, path.dirname(rel)), { recursive: true });
    writeFileSync(join(home, rel), text);
    kept[rel] = text;
  };
  for (const id of lanes) {
    for (const f of ['lane.json', 'runtime.env', 'litellm.yaml']) keep(`.ccrc/codex/${id}/${f}`, `fixture ${f} for ${id}\n`);
    keep(`.ccrc/logs/codex/${id}/shim.log`, 'fixture log\n');
    keep(`.local/share/ccrc/codex/${id}/auth.json`, '{"fixture": "test-token-not-a-secret"}\n');
  }
  if (c.runtime !== false) plantFakeRuntime(home);
  const lanesDef = c.withoutJq
    ? ccrcFunction('_codex_lanes')
    : (c.lanesRc ?? 0) === 0
      ? `_codex_lanes() { ${lanes.length === 0 ? ':' : `printf '%s\\n' ${lanes.join(' ')}`}; }`
      : `_codex_lanes() { echo "ccrc codex: roster-invalid: fixture: the roster could not be read" >&2; return ${c.lanesRc}; }`;
  const harness = [
    'set -uo pipefail',
    ccrcLine(/^PROG=.*$/m, 'PROG='),
    ccrcLine(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
    ...(c.withoutJq ? [ccrcFunction('_codex_say')] : []),
    // Fix round 2 (Leftover): `_uninst_codex` no longer reads $CODEX_TIERS
    // (it hardcodes its own front-first order, pinned separately below), so
    // splicing that declaration into this harness is dead.
    lanesDef,
    '_codex_bus_defaults() { :; }',
    // The final-review fix wave's seams (review A1, A2, C1, C3, N3): the lane
    // directory's one spelling, the one handle predicate and the by-hand
    // clause, REAL, read out of ccd/ccrc; `_codex_foreign_what` STUBBED, as
    // the tier question is — its fixture sentence names the WHY it was
    // handed, so a case sees that the step's words are the helper's. (The
    // real sentences are pinned on a real lane, below.)
    ccrcLine(/^_codex_lane_dir\(\).*$/m, '_codex_lane_dir'),
    ccrcFunction('_codex_tier_is_our_handle'),
    ccrcFunction('_uninst_codex_by_hand'),
    '_codex_foreign_what() { CX_FOREIGN_CODE=fixture-code; CX_FOREIGN_WHAT="fixture holder of $1\'s $2 tier (${CX_TIER_WHY:-no why})"; CX_FOREIGN_FIX=\'fixture remedy.\'; }',
    lockStub(c.lockRefuse ?? [], c.lockNoFlock ?? []),
    recordingStub('_codex_tier_ours', c.ours, 1, {}, c.oursWhy ?? {}),
    recordingStub('_codex_stop_tier', c.stopRc, 0, c.stopWords ?? {}),
    ccrcFunction('_uninst_codex'),
    '_uninst_codex; rc=$?',
    'printf \'%s\\n\' "${CX_LOCK_FD:-}" "${CX_LOCK_ID:-}" > "$HOME/lock-after"',
    'exit "$rc"',
  ].join('\n');
  // Task 10's isolation wall, FIRST on PATH (the containment rule): the step
  // stops tiers only through the stubbed `_codex_stop_tier`, so a direct
  // `systemctl` or `systemd-run` from its body is a thrown, named red, never
  // the real binary. Fix round 3 (C2): the wall is CHECKED on the env the
  // spawn takes, on the line before it — `strayManagerCalls` reads only the
  // wall's own log, so a name the wall lost would reach the real binary
  // unrecorded.
  const wall = isolationManagerStubs(home);
  const env = {
    PATH: c.withoutJq ? `${wall}:${pathWithout(home, 'jq')}` : `${wall}:${process.env['PATH'] ?? ''}`,
    HOME: home,
  };
  assertIsolationWallFirst(env, home);
  const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
  const stray = strayManagerCalls(home);
  if (stray.length > 0) {
    throw new Error(`_uninst_codex reached the user manager directly, not through the stubbed lane library:\n${stray.join('\n')}\n${p.stderr ?? ''}`);
  }
  const lines = (f: string): string[] =>
    (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8').split('\n').filter(Boolean) : []);
  return {
    code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '', calls: lines('calls'), home, kept,
    lockAfter: lines('lock-after').join('\n'),
  };
}

describe('ccrc uninstall: the codex step, measured in isolation (_uninst_codex)', () => {
  const RT = '$HOME/.ccrc/runtime/codex';
  const KEPT = 'kept: $HOME/.ccrc/codex/<id>/, $HOME/.ccrc/logs/codex/ and every lane\'s authDir';
  const LOCK_A = '_codex_lock codex-a';
  const LOCK_B = '_codex_lock codex-b';
  // `lockStub`'s record of Task 5's `_codex_unlock`, the lock's ONLY release
  // (ruling R19): an inline close leaves no such line.
  const UNLOCK_A = '_codex_unlock codex-a';
  const UNLOCK_B = '_codex_unlock codex-b';
  const keptIntact = (r: ReturnType<typeof runUninstCodex>): void => {
    for (const [rel, text] of Object.entries(r.kept)) {
      expect(readFileSync(join(r.home, rel), 'utf8'), `${rel} was removed or changed`).toBe(text);
    }
  };
  /** `_uninst_codex_by_hand`'s clause, typed out ONCE here so each line's
   *  pin reads what an operator reads (spec §19.8, D-3532; the fix wave's
   *  N3 adds the pidfile). */
  const byHand = (id: string, tier: string): string =>
    `systemctl --user status ccgpt-${id}-${tier} (or, where no user manager runs, the pid in $HOME/.ccrc/codex/${id}/${tier}.pid), `
    + `confirm that MainPID's or pid's argv names this lane (--ccrc-lane=${id}, or a path under $HOME/.ccrc/runtime/codex) `
    + '— a same-named unit may belong to another tool on this box — and only then stop it';

  it('missing jq is its own roster read failure and names missing-dependency, never roster-invalid', () => {
    // `cmd_uninstall` itself preflights jq because later removal steps need it;
    // this isolates the step, but uses its REAL `_codex_lanes` under a PATH
    // from which jq is genuinely absent rather than synthesising rc 2.
    const r = runUninstCodex({ withoutJq: true });
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('jq is not on PATH (the ccrc codex: missing-dependency line above says so), so no codex lane was read');
    expect(r.stdout).not.toContain('roster-invalid line above');
    expect(r.stderr).toMatch(/^ccrc codex: missing-dependency: jq is not on PATH/m);
    expect(r.stderr).not.toMatch(/roster-invalid/);
    expect(r.stderr).toContain('any codex tier ccrc had started may still be running');
  });

  // Review A1: the one 2 that carries a proven handle is this lane's own
  // process, and an uninstall that left it alone removed its runtime from
  // under it. It is stopped, through `_codex_stop_tier` (identity-gated
  // itself), read through `_codex_tier_is_our_handle`.
  it('this lane\'s own process while another holds its port (listener-other-process) is STOPPED through _codex_stop_tier, never left alone (review A1)', () => {
    const r = runUninstCodex({ ours: { 'codex-a litellm': 2 }, oursWhy: { 'codex-a litellm': 'listener-other-process' } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim',
      '_codex_tier_ours codex-a litellm', '_codex_stop_tier codex-a litellm', UNLOCK_A]);
    expect(r.stdout).toMatch(/— stopped: codex-a litellm; left alone: none; not stopped: none; /);
  });

  // Review A2/E2 (ruling PF-13): a live unit whose identity is only UNPROVEN
  // may be this lane's own tier between two restarts. Left running — an
  // uninstall stops only what it proves — named in the helper's words, as
  // unproven, with the way to finish once ccrc is gone.
  it('a unit whose identity is only unproven is left running, named in _codex_foreign_what\'s words, with the way to finish by hand — never "not this lane" (review A2/E2)', () => {
    const r = runUninstCodex({ ours: { 'codex-a litellm': 2 }, oursWhy: { 'codex-a litellm': 'unit-unproven' } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim', '_codex_tier_ours codex-a litellm', UNLOCK_A]);
    expect(r.stdout).toContain('uninstall: codex: codex-a litellm: left alone — fixture holder of codex-a\'s litellm tier (unit-unproven), '
      + 'and an uninstall stops only what it can prove ccrc started. It may be this lane\'s own tier between two of its restarts; '
      + `once uninstall finishes: ${byHand('codex-a', 'litellm')}\n`);
    expect(r.stdout).not.toMatch(/not this lane/);
    expect(r.stdout).toMatch(/— stopped: none; left alone: codex-a litellm; not stopped: none; /);
  });

  it('no codex lane: nothing is asked, the runtime is removed, and one line says both', () => {
    const r = runUninstCodex({ lanes: [] });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toBe(`uninstall: codex: no codex lane in the roster — nothing to stop; the runtime at ${RT} removed\n`);
    expect(existsSync(join(r.home, '.ccrc', 'runtime', 'codex'))).toBe(false);
  });

  it('no runtime on the box: the line says it was not installed, never that it was removed', () => {
    const r = runUninstCodex({ lanes: [], runtime: false });
    expect(r.stdout).toBe(`uninstall: codex: no codex lane in the roster — nothing to stop; the runtime at ${RT} was not installed\n`);
  });

  it('the runtime removal is guarded against an empty or unset path variable (a TEXT pin, not a behavioural one)', () => {
    // A TEXT pin over this line's own source, never behaviourally reachable:
    // `rt` is always "$HOME/.ccrc/runtime/codex", a fixed literal SUFFIX that
    // can never be empty. An UNSET HOME dies while ccrc is sourced, at the
    // top-level `_SVC_REG="$HOME/…"`, before `_uninst_codex` or `rt` exists;
    // an EMPTY HOME is still SET, so `rt` becomes
    // "/.ccrc/runtime/codex" instead (narrower, not wider — measured, `env
    // HOME= bash -u -c '...'` exits 0: round 2, N4 corrects round 1's claim
    // that an empty HOME "dies" too). Either way `${rt:?}` can never actually
    // fire. The live-box hazard rules still call for `rm -rf` to be guarded
    // with `${var:?}` or an explicit non-empty-plus-literal-suffix check,
    // belt-and-braces against a future edit that builds `rt` some other way
    // (review fix round 1, spec-5/mut-4). Read the real source, not the
    // isolation stub.
    const src = ccrcFunction('_uninst_codex');
    expect(src).toMatch(/rm -rf -- "\$\{rt:\?[^}]*\}"/);
  });

  it('the hardcoded front-first tier set is CODEX_TIERS reversed, so a third tier cannot be silently missed', () => {
    // Fix round 1 (spec-6): `local -a tiers=(shim litellm)` is a second
    // hand-kept list of the tiers, in PF-18's stop order — the same
    // precedent `_codex_stop_lane` sets. This pin catches a future
    // CODEX_TIERS that grows (or changes) without this step following: the
    // SET must match (a missing/extra tier reds the sorted-equality check),
    // and the ORDER must be the exact reverse of CODEX_TIERS's own
    // declaration (litellm first, for its "litellm <word>, shim <word>"
    // answer — the opposite of a stop sequence).
    const codexTiersLine = ccrcLine(/^CODEX_TIERS=.*$/m, 'CODEX_TIERS=');
    const m1 = /^CODEX_TIERS="([^"]*)"$/.exec(codexTiersLine);
    expect(m1, `CODEX_TIERS= is not the expected quoted-string shape: ${codexTiersLine}`).toBeTruthy();
    const declared = m1![1]!.trim().split(/\s+/).filter(Boolean);
    const src = ccrcFunction('_uninst_codex');
    const m2 = /local -a tiers=\(([^)]*)\)/.exec(src);
    expect(m2, '_uninst_codex has no hardcoded `local -a tiers=(...)`').toBeTruthy();
    const hardcoded = m2![1]!.trim().split(/\s+/).filter(Boolean);
    expect(hardcoded.slice().sort()).toEqual(declared.slice().sort());
    expect(hardcoded).toEqual([...declared].reverse());
  });

  it('a roster that cannot be read: no lane is asked or stopped, it is said in its own line, and the runtime still goes', () => {
    // `ours: 0` is the CONTROL: a step that read rc 1 as a lane list, or
    // guessed one, would ask and stop.
    const r = runUninstCodex({ lanesRc: 1, ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: /m);
    expect(r.stdout).toBe(`uninstall: codex: the roster could not be read (the ccrc codex: roster-invalid line above says why), so no codex lane's tier was measured or stopped; the runtime at ${RT} removed; ${KEPT}\n`);
    // Fix round 1 (spec-3/mut-5): a companion stderr line, since nothing was
    // measured or stopped but the runtime it ran from is gone regardless.
    // Fix round 2 (N3): the remedy names `systemctl --user status`, not
    // `ccrc codex status` — `_uninst_tree_bins` removes ccrc itself later in
    // this same verb, so a remedy naming it would not work by the time an
    // operator reads it. It carries the same-named-unit caution too.
    // Final-review fix wave (N3): the pidfile too — on Darwin, or a Linux box
    // with no user manager, every tier runs on the nohup arm.
    expect(r.stderr).toContain(`uninstall: codex: any codex tier ccrc had started may still be running — its runtime at ${RT} removed, so it cannot be restarted from there. ccrc itself is gone by the time uninstall finishes, so check by hand: ${byHand('<id>', '*')}\n`);
    expect(existsSync(join(r.home, '.ccrc', 'runtime', 'codex'))).toBe(false);
    keptIntact(r);
  });

  it('a running lane of ours: each tier is identity-checked under the lane lock, then stopped front-first; the runtime goes; everything §13 keeps is byte-identical', () => {
    const r = runUninstCodex({ ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim', '_codex_stop_tier codex-a shim',
      '_codex_tier_ours codex-a litellm', '_codex_stop_tier codex-a litellm', UNLOCK_A]);
    expect(r.stdout).toBe(`uninstall: codex: 1 codex lane(s) in the roster — stopped: codex-a shim, codex-a litellm; left alone: none; not stopped: none; the runtime at ${RT} removed; ${KEPT}\n`);
    expect(existsSync(join(r.home, '.ccrc', 'runtime', 'codex'))).toBe(false);
    expect(r.lockAfter).toBe('');
    keptIntact(r);
  });

  it('a tier of ours that is still STARTING (4) is stopped too — it is ccrc\'s own, and would outlive its runtime', () => {
    const r = runUninstCodex({ ours: { 'codex-a litellm': 4 } });
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim',
      '_codex_tier_ours codex-a litellm', '_codex_stop_tier codex-a litellm', UNLOCK_A]);
    expect(r.stdout).toMatch(/— stopped: codex-a litellm; left alone: none; not stopped: none; /);
  });

  it('a tier whose port or unit answers as something else is NEVER stopped — an uninstall stops only what ccrc started', () => {
    // `codex-a shim` at rc 1 is the CONTROL for the next mutation row: a
    // step that stopped every non-zero tier would stop it too.
    const r = runUninstCodex({ ours: { 'codex-a litellm': 2 }, oursWhy: { 'codex-a litellm': 'listener-unidentified' } });
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim', '_codex_tier_ours codex-a litellm', UNLOCK_A]);
    // Review A2: named in `_codex_foreign_what`'s words (its fixture here),
    // never a "not this lane" sentence of the step's own.
    expect(r.stdout).toMatch(/^uninstall: codex: codex-a litellm: left alone — fixture holder of codex-a's litellm tier \(listener-unidentified\), and an uninstall stops only what ccrc started$/m);
    expect(r.stdout).not.toMatch(/not this lane/);
    expect(r.stdout).toMatch(/— stopped: none; left alone: codex-a litellm; not stopped: none; /);
    keptIntact(r);
  });

  it('an identity answer the step cannot read is left alone too, in its own sentence, with the same-named-unit caution (fix round 1)', () => {
    const r = runUninstCodex({ ours: { 'codex-a shim': 3 } });
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim', '_codex_tier_ours codex-a litellm', UNLOCK_A]);
    expect(r.stdout).toContain(`uninstall: codex: codex-a shim: left alone — whether it is this lane's could not be measured, and an uninstall stops only what it can prove ccrc started. Once uninstall finishes: ${byHand('codex-a', 'shim')}\n`);
    expect(r.stdout).toMatch(/left alone: codex-a shim;/);
  });

  it('a stop that fails is its own stderr line and is not counted as stopped; the runtime is still removed', () => {
    const r = runUninstCodex({ ours: { 'codex-a litellm': 0 }, stopRc: { 'codex-a litellm': 1 } });
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^uninstall: codex: codex-a litellm: could not be stopped — it is still running/m);
    // Review C1: how to finish once ccrc is gone — never a ccrc verb.
    expect(r.stderr).toContain(`uninstall: codex: codex-a litellm: could not be stopped — it is still running, and ccrc itself is gone once uninstall finishes, so stop it by hand before any reinstall: ${byHand('codex-a', 'litellm')}\n`);
    expect(r.stdout).toMatch(/— stopped: none; left alone: none; not stopped: codex-a litellm; the runtime at \$HOME\/\.ccrc\/runtime\/codex removed; /);
  });

  it('a stop that finds the tier foreign after all is left alone, never counted as stopped (ruling PF-21)', () => {
    // `_codex_stop_tier` answers rc 0 for BOTH "stopped" and "foreign" — its
    // own identity gate, RE-MEASURED, can find between this step's own check
    // above and the stop call that the tier is no longer provably this
    // lane's, and leaves it running rather than force it. A consumer that
    // read only the rc would treat that rc 0 as a successful stop.
    const r = runUninstCodex({ ours: { 'codex-a litellm': 0 }, stopWords: { 'codex-a litellm': 'foreign' } });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim',
      '_codex_tier_ours codex-a litellm', '_codex_stop_tier codex-a litellm', UNLOCK_A]);
    expect(r.stderr).toBe('');
    // The stop names the holder itself (its `_codex_foreign_what` note, on
    // stderr); this line points at that, and never says "not this lane" of
    // its own (review A2).
    expect(r.stdout).toMatch(/^uninstall: codex: codex-a litellm: left alone — the stop found it no longer provably this lane's \(the ccrc codex: line above names what holds it\), and an uninstall stops only what ccrc started$/m);
    expect(r.stdout).toMatch(/— stopped: none; left alone: codex-a litellm; not stopped: none; /);
  });

  it('two lanes: only the running one is stopped, each under its own lock, released through _codex_unlock before the next is taken', () => {
    // `LOCK-STILL-HELD` is the stub's record of a lock entered while the
    // previous one was never released; `lockAfter` is the last lane's
    // `CX_LOCK_FD` and `CX_LOCK_ID`, which an inline close leaves naming a lane.
    const r = runUninstCodex({ lanes: ['codex-a', 'codex-b'], ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls.filter((l) => l.startsWith('_codex_stop_tier'))).toEqual(['_codex_stop_tier codex-a shim', '_codex_stop_tier codex-a litellm']);
    expect(r.calls.filter((l) => /^(_codex_lock|_codex_unlock|LOCK-STILL-HELD) /.test(l))).toEqual([LOCK_A, UNLOCK_A, LOCK_B, UNLOCK_B]);
    expect(r.calls.indexOf(UNLOCK_A)).toBeGreaterThan(r.calls.indexOf('_codex_stop_tier codex-a litellm'));
    expect(r.lockAfter).toBe('');
    expect(r.stdout).toMatch(/^uninstall: codex: 2 codex lane\(s\) in the roster — stopped: codex-a shim, codex-a litellm; /m);
  });

  it('a lane whose lock cannot be taken is not asked or stopped: named as not stopped, and the next lane still runs', () => {
    const r = runUninstCodex({
      lanes: ['codex-a', 'codex-b'], lockRefuse: ['codex-a'],
      ours: { 'codex-a litellm': 0, 'codex-b litellm': 0 },
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([LOCK_A, LOCK_B, '_codex_tier_ours codex-b shim',
      '_codex_tier_ours codex-b litellm', '_codex_stop_tier codex-b litellm', UNLOCK_B]);
    expect(r.stderr).toMatch(/^uninstall: codex: codex-a: not stopped — its lane lock could not be taken/m);
    // Fix round 1 (spec-3/mut-5): the same-named-unit caution, one line, once
    // per unstoppable-lock lane (not once per tier — this arm names the lane).
    // Fix wave (N3): the unit where a user manager runs, the pidfile where
    // none does, and the caution, from the one by-hand clause.
    expect(r.stderr).toContain(`uninstall: codex: codex-a: not stopped — its lane lock could not be taken (the line above says why), so neither of its tiers was measured. ccrc itself is gone once uninstall finishes, so stop them by hand before any reinstall: ${byHand('codex-a', '*')}\n`);
    expect(r.stdout).toMatch(/— stopped: codex-b litellm; left alone: none; not stopped: codex-a shim, codex-a litellm; the runtime at \$HOME\/\.ccrc\/runtime\/codex removed; /);
    expect(r.lockAfter).toBe('');
  });

  it('a box with no flock: the lock answers 0 with nothing held, and the lane is still measured and stopped, unserialised', () => {
    // Task 5's contract (ruling R19): rc 0 with CX_LOCK_FD EMPTY means "no
    // flock on this box", never a refusal. A step that read the empty
    // descriptor as a failed lock would leave every tier of such a box running
    // over a removed runtime. `_codex_unlock -` is the release of nothing.
    const r = runUninstCodex({ lockNoFlock: ['codex-a'], ours: { 'codex-a litellm': 0, 'codex-a shim': 0 } });
    expect(r.calls).toEqual([LOCK_A, '_codex_tier_ours codex-a shim', '_codex_stop_tier codex-a shim',
      '_codex_tier_ours codex-a litellm', '_codex_stop_tier codex-a litellm', '_codex_unlock -']);
    expect(r.stderr).not.toMatch(/its lane lock could not be taken/);
    expect(r.stdout).toMatch(/— stopped: codex-a shim, codex-a litellm; left alone: none; not stopped: none; /);
    expect(r.lockAfter).toBe('');
  });
});

// PLATFORM-ONLY: stopping a tier by its exact unit is the user-manager arm,
// faked by Task 4's `plantSystemd`; on Darwin `_svc_have_user_manager` is
// always false and the nohup arm (Task 5's subject) is the only one.
describeLinux('ccrc uninstall: the codex lanes on a real lane (Plan 2b-2 Task 11)', () => {
  const homes: string[] = [];
  // `killLaneProcesses` runs registered product stops while fixture state
  // remains, then ends every current-run child Task 4's fixture tracked.
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  /** An installed box whose roster carries `ids` as codex lanes, with the
   *  shipped shim and builder on PATH (Task 4's `plantCodexBins`: copies, 0755),
   *  every lane's rendered config (Task 5's `plantLaneConfig`, ruling R20: a
   *  case's `ccrc codex start` refuses `litellm-unrendered` without one), and
   *  Task 4's fake runtime and fake user manager. */
  async function codexUninstallBox(prefix: string, ids: string[]): Promise<{ home: string; lanes: LanePorts[] }> {
    const lanes = await freeLanes(ids);
    const home = mkTmp(prefix);
    homes.push(home);
    plantInstalledBox(home);
    codexRoster(home, lanes);
    for (const l of lanes) plantLaneConfig(home, l.id);
    plantCodexBins(home);
    plantFakeRuntime(home, { version: '1.101.0' });
    plantSystemd(home, { userManager: true });
    for (const lane of lanes) {
      // Register before a caller can initialise or start this lane. The real
      // fixture product path runs before teardown removes any state it needs.
      registerLaneCleanup(home, `uninstall-codex:${lane.id}`, () => {
        runVerb(home, 'codex', ['stop', lane.id], READY);
      });
    }
    return { home, lanes };
  }
  const initLane = (home: string, id: string): void => {
    const init = runVerb(home, 'models', [id, 'init', 'codex']);
    if (init.code !== 0) throw new Error(`ccrc models ${id} init codex:\n${init.stderr}`);
  };
  const stops = (home: string): string[] => managerCalls(home).filter((l) => /^systemctl --user stop\b/.test(l));

  it('a running lane is stopped by its exact units, the runtime goes, and the lane state, logs and credential stay', async () => {
    const { home, lanes: [lane] } = await codexUninstallBox('ccrc-uninst-codex-running-', ['codex-a']);
    initLane(home, 'codex-a');
    plantLaneAuth(home, 'codex-a');
    const s = runVerb(home, 'codex', ['start', 'codex-a'], READY);
    expect(s.code, `ccrc codex start codex-a:\n${s.stdout}\n${s.stderr}`).toBe(0);
    expect(existsSync(join(home, '.local', 'bin', '.codex-systemctl')),
      'plantSystemd did not plant into ~/.local/bin, so this harness cannot adopt it (Task 10 Interfaces)').toBe(true);
    const units = laneUnits(home, 'codex-a');
    const ans = await laneAnswer(lane!.proxyPort);   // Task 5's {status, type, body} (ruling R30)
    expect(ans?.type).toMatch(/^application\/json/);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    for (const u of [units.litellm, units.shim]) {
      expect(stops(home).some((l) => l.includes(u)), `${u} was not stopped by name:\n${managerCalls(home).join('\n')}`).toBe(true);
    }
    // Task 5's `eventually` THROWS on timeout and never resolves false (ruling R30).
    await eventually(async () => !(await portAccepts(lane!.proxyPort)), 'the shim to stop listening', 5000);
    await eventually(async () => !(await portAccepts(lane!.litellmPort)), 'litellm to stop listening', 5000);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex'))).toBe(false);
    for (const f of ['lane.json', 'runtime.env', 'litellm.yaml']) {
      expect(existsSync(join(home, '.ccrc', 'codex', 'codex-a', f)), `${f} was removed`).toBe(true);
    }
    expect(existsSync(join(home, '.ccrc', 'logs', 'codex', 'codex-a'))).toBe(true);
    expect(existsSync(join(authDirOf(home, 'codex-a'), 'auth.json')), 'the credential was removed').toBe(true);
    // Front-first (ruling PF-18): shim before litellm.
    expect(r.stdout).toMatch(/^uninstall: codex: 1 codex lane\(s\) in the roster — stopped: codex-a shim, codex-a litellm; left alone: none; not stopped: none; the runtime at \$HOME\/\.ccrc\/runtime\/codex removed; kept: /m);
    expect(r.stdout).toMatch(/^uninstall: done — /m);
  }, 120_000);

  it('a foreign listener on the lane port survives the uninstall', async () => {
    // The OTHER repository's shim shape (`text/plain`, the bare id — m-tiers
    // §1) on this lane's shim port: Task 4's `spawnListener`, bound when it
    // resolves. The lane was never materialised (no lane.json). Its directory
    // exists only because `codexUninstallBox` planted its config, so the lock's
    // missing-directory behaviour is Task 10's lazy case's to pin, not this one's.
    const { home, lanes: [lane] } = await codexUninstallBox('ccrc-uninst-codex-foreign-', ['codex-a']);
    const foreign = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: lane!.proxyPort });
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, r.stderr).toBe(0);
    // Review A2: the REAL `_codex_foreign_what` sentence, end to end.
    expect(r.stdout).toContain(`uninstall: codex: codex-a shim: left alone — port ${lane!.proxyPort} (codex-a's shim tier) is held by a listener that is not this lane's: its identity check failed, and an uninstall stops only what ccrc started\n`);
    expect(stops(home)).toEqual([]);
    expect(() => process.kill(foreign.pid, 0)).not.toThrow();
    expect(await portAccepts(lane!.proxyPort)).toBe(true);
  }, 120_000);

  it('a same-named ACTIVE unit that is not this lane is never stopped', async () => {
    // The fleet box's shape (m-livebox §3): a transient unit with the lane's
    // own unit name, active, holding the litellm port — owned by another
    // repository. Identity, not the name, decides.
    const { home, lanes: [lane] } = await codexUninstallBox('ccrc-uninst-codex-namesake-', ['codex-a']);
    initLane(home, 'codex-a');   // lane.json, so the unit name is read, not re-derived
    const units = laneUnits(home, 'codex-a');
    const env = verbEnv(home);
    const root = join(home, 'foreign-unit-root');
    mkdirSync(root, { recursive: true });
    const log = join(home, 'foreign-unit.log');
    const sd = spawnSync(join(home, '.local', 'bin', 'systemd-run'), ['--user', '--collect', '--quiet',
      `--unit=${units.litellm}`, '-p', `StandardOutput=append:${log}`, '-p', `StandardError=append:${log}`,
      '--', realPy(), '-m', 'http.server', String(lane!.litellmPort), '--bind', '127.0.0.1', '--directory', root],
    { env, encoding: 'utf8' });
    expect(sd.status, `the fake user manager would not start the namesake unit:\n${sd.stderr}`).toBe(0);
    await eventually(() => portAccepts(lane!.litellmPort), 'the namesake to bind', 5000);
    const active = spawnSync(join(home, '.local', 'bin', 'systemctl'), ['--user', 'is-active', units.litellm], { env, encoding: 'utf8' });
    expect(active.stdout.trim(), 'the fixture does not model a same-named ACTIVE unit, so this case would measure nothing').toBe('active');
    rmSync(join(home, 'manager-calls'), { force: true });
    const r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^uninstall: codex: codex-a litellm: left alone — /m);
    expect(stops(home).filter((l) => l.includes(units.litellm))).toEqual([]);
    expect(await portAccepts(lane!.litellmPort)).toBe(true);
  }, 120_000);
});
