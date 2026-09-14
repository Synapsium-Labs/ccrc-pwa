// Task 7 fix round 1 (finding #1): the installer wiring in `ccd/ccrc` is
// pinned by `ccrc-install.test.ts`/`ccrc-uninstall.test.ts`, but `ccrc install`
// is never what a deploy runs — `deploy/deploy.sh agent` is (CLAUDE.md
// AGENT-FIRST, Task 8's only sanctioned path). Without this file the agent
// lane could ship the tree at `~/ccrc/ccd/` while never landing
// `ccd-usage-sweep`/`.py` at `~/.local/bin`, never installing its unit files,
// and never enabling its timer — a deploy that exits 0 while the sweep never
// runs. This is a source scan, not a behavioural test, for the reason
// `ccrc-api-ship.test.ts` and `graph-noise-ship.test.ts` both give: deploy.sh
// runs over ssh against a real box and cannot be exercised here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DEPLOY = path.join(import.meta.dirname, '..', '..', 'deploy', 'deploy.sh');
const deploySh = (): string => fs.readFileSync(DEPLOY, 'utf8');
const SYSTEMD = path.join(import.meta.dirname, '..', '..', 'deploy', 'systemd');
const unit = (name: string): string => fs.readFileSync(path.join(SYSTEMD, name), 'utf8');
/** Directives only — the units argue for their numbers in prose, and a scrape
 *  that counted the prose would read a comment about a key as the key. The
 *  same split `timer-first-run.test.ts` makes, for the same reason. */
const directives = (name: string): string[] =>
  unit(name).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** Executable lines only. deploy.sh's own comments name its helpers, so a
 *  scrape that counted prose would "prove" an ordering the shell never runs —
 *  the trap `ccrc-api-ship.test.ts` and `graph-noise-ship.test.ts` both record
 *  having sprung. */
const code = (): string[] =>
  deploySh().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('the usage-accounting sweep ships on the agent lane (Task 7 fix round 1, finding #1)', () => {
  it('installs the runner and the scanner through install_atomic, at 755, under .local/bin', () => {
    const runner = code().filter((l) => l.startsWith('install_atomic ccd/ccd-usage-sweep '));
    const scanner = code().filter((l) => l.startsWith('install_atomic ccd/ccd-usage-sweep.py'));
    expect(runner, 'deploy.sh installs ccd/ccd-usage-sweep exactly once').toHaveLength(1);
    expect(runner[0]).toBe('install_atomic ccd/ccd-usage-sweep .local/bin/ccd-usage-sweep 755');
    expect(scanner, 'deploy.sh installs ccd/ccd-usage-sweep.py exactly once').toHaveLength(1);
    expect(scanner[0]).toBe('install_atomic ccd/ccd-usage-sweep.py .local/bin/ccd-usage-sweep.py 755');
  });

  it('installs both unit files through _unit_atomic', () => {
    const svc = code().filter((l) =>
      l.includes('_unit_atomic ~/ccrc/deploy/systemd/ccd-usage-sweep.service') &&
      l.includes('~/.config/systemd/user/ccd-usage-sweep.service'));
    const timer = code().filter((l) =>
      l.includes('_unit_atomic ~/ccrc/deploy/systemd/ccd-usage-sweep.timer') &&
      l.includes('~/.config/systemd/user/ccd-usage-sweep.timer'));
    expect(svc, 'deploy.sh lands the service unit exactly once').toHaveLength(1);
    expect(timer, 'deploy.sh lands the timer unit exactly once').toHaveLength(1);
  });

  it('enables the timer with systemctl --user enable --now', () => {
    const enable = code().filter((l) => l === '&& systemctl --user enable --now ccd-usage-sweep.timer \\');
    expect(enable, 'deploy.sh enables ccd-usage-sweep.timer exactly once').toHaveLength(1);
  });

  it('all three ship inside the agent branch, BEFORE the agent restart', () => {
    // AGENT-FIRST end to end, the same property `ccd-account-auth.test.ts`
    // pins for its own executable: the agent caches `ccd caps` at boot, so
    // anything landed after the restart is invisible until the box is
    // restarted again.
    const sh = deploySh();
    const agentStart = sh.indexOf('if [ "$TARGET" = "agent" ]');
    expect(agentStart, 'deploy.sh has no agent branch').toBeGreaterThan(-1);
    const agentBranch = sh.slice(agentStart, sh.indexOf('\nelse', agentStart));

    const binShipAt = agentBranch.indexOf('install_atomic ccd/ccd-usage-sweep .local/bin/ccd-usage-sweep 755');
    const pyShipAt = agentBranch.indexOf('install_atomic ccd/ccd-usage-sweep.py .local/bin/ccd-usage-sweep.py 755');
    const svcAt = agentBranch.indexOf('_unit_atomic ~/ccrc/deploy/systemd/ccd-usage-sweep.service');
    const timerUnitAt = agentBranch.indexOf('_unit_atomic ~/ccrc/deploy/systemd/ccd-usage-sweep.timer');
    const enableAt = agentBranch.indexOf('systemctl --user enable --now ccd-usage-sweep.timer');
    const restartAt = agentBranch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');

    for (const [label, at] of [
      ['runner install', binShipAt], ['scanner install', pyShipAt],
      ['service unit', svcAt], ['timer unit', timerUnitAt], ['enable', enableAt],
    ] as const) {
      expect(at, `${label} is not in the agent branch`).toBeGreaterThan(-1);
    }
    expect(restartAt, 'the agent restart is not in the agent branch').toBeGreaterThan(-1);

    for (const [label, at] of [
      ['runner install', binShipAt], ['scanner install', pyShipAt],
      ['service unit', svcAt], ['timer unit', timerUnitAt], ['enable', enableAt],
    ] as const) {
      expect(at, `${label} must land before the agent restart that caches ccd caps`).toBeLessThan(restartAt);
    }
  });

  it('ships alongside its siblings, not the server lane', () => {
    // Adjacency to ccd-telemetry-keepalive is the check, for the reason
    // ccrc-api-ship.test.ts and graph-noise-ship.test.ts both state: "the
    // agent lane" is not a name the file uses — it is the block that installs
    // ccd-telemetry-keepalive. Deliberately NOT adjacent to ccd-graph-sweep:
    // graph-noise-ship.test.ts pins the sweep and its noise list as
    // neighbours with three code lines of slack, already fully spent by
    // ccrc-models-probe, so this sibling (like ccd-account-auth) is placed
    // below the noise list instead.
    const lines = code();
    const keepalive = lines.findIndex((l) => l.startsWith('install_atomic ccd/ccd-telemetry-keepalive '));
    const runner = lines.findIndex((l) => l.startsWith('install_atomic ccd/ccd-usage-sweep '));
    expect(keepalive, 'deploy.sh still installs ccd-telemetry-keepalive').toBeGreaterThan(-1);
    expect(runner, 'deploy.sh installs ccd-usage-sweep').toBeGreaterThan(-1);
    expect(Math.abs(runner - keepalive),
      'ccd-usage-sweep drifted away from its sibling executables').toBeLessThanOrEqual(2);
  });
});

describe('the sweep unit is budgeted from the first measured passes (routing slice 0, Task 8; ruling R13)', () => {
  // Task 8 measured what Task 7 had only guessed. The unit shipped saying a
  // full seven-day scan was "well under a minute" at "well under 1G"; on this
  // fleet the first cold pass took 12m46s of wall clock and peaked at 1.9G
  // against a 2G cap, over a 48.3 GB / 32563-file seven-day corpus that does
  // not fit the box's page cache — and the third pass peaked at 2.2G, ABOVE
  // that cap, surviving only because most of the peak is reclaimable page
  // cache. Both shipped numbers were a busy day away from killing a pass. These
  // assertions are the mechanism that keeps a later "harmonisation" from
  // putting the guessed numbers back.
  it('the service gives the measured pass headroom, not the guessed budget', () => {
    const d = directives('ccd-usage-sweep.service');
    expect(d, 'the sweep service lost the 3G cap the 1.9G measured peak needs')
      .toContain('MemoryMax=3G');
    expect(d, 'the sweep service lost the 1800s start timeout the 12m46s cold pass needs')
      .toContain('TimeoutStartSec=1800');
  });

  it('the service says WHY, in the measured numbers — a false budget comment is worse than none', () => {
    // `ccd-account-health.timer`'s lesson, pinned the same way in
    // `timer-first-run.test.ts`: the next reader's instinct is to trim these
    // back towards the siblings', so the argument has to live at the key.
    const prose = unit('ccd-usage-sweep.service');
    expect(prose, 'the service no longer states the measured cold-pass wall clock')
      .toContain('12m46s');
    expect(prose, 'the service no longer states the measured peak RSS')
      .toContain('1.9G');
    expect(prose, 'the service no longer states the corpus the two numbers were measured over')
      .toContain('48.3 GB');
  });

  it('the timer runs four-hourly — the gate is days of data, and the sidecar is the live signal', () => {
    const d = directives('ccd-usage-sweep.timer');
    expect(d, 'the sweep timer is back on a cadence shorter than its own pass costs')
      .toContain('OnUnitActiveSec=4h');
    // Unchanged by the re-budgeting, and listed here so a sweep of these three
    // keys cannot quietly drop the two that were already right.
    expect(d, 'the sweep timer lost its OnActiveSec anchor').toContain('OnActiveSec=5min');
    expect(d, 'the sweep timer lost its AccuracySec').toContain('AccuracySec=1min');
  });

  it('the timer says why four hours, in the measured cost of a pass', () => {
    const prose = unit('ccd-usage-sweep.timer');
    expect(prose, 'the timer no longer states the measured warm-pass cost that sets the cadence')
      .toContain('7m07s');
    expect(prose, 'the timer no longer states that the seven-day gate is what the cadence serves')
      .toMatch(/seven-day/i);
  });
});
