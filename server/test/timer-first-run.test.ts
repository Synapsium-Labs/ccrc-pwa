// WHEN EACH TIMER TAKES ITS FIRST RUN, and why the two new ones answer that
// differently on purpose (D-1981).
//
// `OnBootSec=` anchors to MACHINE BOOT (`man 5 systemd.timer`, Table 1), not to
// when the timer unit is armed. The ONLY moment any of these timers is ever
// first armed on the fleet host is a deploy — `deploy/deploy.sh`'s AGENT_CMD or
// `ccrc install`'s enable, both `systemctl --user enable --now <timer>` — and a
// box taking a deploy has been up for days. Its boot-relative elapse point is
// therefore already in the past, so systemd starts the oneshot AT ONCE, bounded
// only by `AccuracySec=`. Whatever the number says, on the path that actually
// installs these units it buys nothing.
//
// That is FINE for `ccd-account-health` and NOT fine for
// `ccd-telemetry-keepalive`, which is the whole content of this file:
//
//   • the probe spends one `curl --max-time 20` per account and no tokens, and
//     what it writes is `$REG/<account>-authdead` — a MEASUREMENT which `ccd`'s
//     own `_authdead` header insists can be wrong, never joins `_account_ok`,
//     and so only ever costs PREFERENCE, never ELIGIBILITY. Re-measuring the
//     instant a corrected probe lands is the cheapest right answer;
//
//   • the keepalive spends a `timeout 120 claude -p` turn per idle measured
//     account, out of the very windows it exists to measure — and on a first
//     install `~/.ccrc/keepalive-state` is EMPTY, so its `lastAttempt` throttle
//     skips nobody and the pass is the largest it will ever take. It would land
//     on top of `deploy.sh`'s supervisor sweep, which is at that instant
//     `try-restart`ing every `claude-session@*` unit on the box.
//
// `OnActiveSec=` anchors to the moment the timer unit itself is activated, so it
// is the same thing as `OnBootSec=` at boot and a real offset at a deploy. That
// is what the keepalive carries. `Persistent=` is not the knob for any of this:
// it only has an effect on timers configured with `OnCalendar=` (same man page),
// which none of these are.
//
// This is a source scan for the reason `graph-noise-ship.test.ts` states about
// its own subject: the thing being pinned is a file systemd reads on a box this
// suite cannot touch, so the artifact IS the assertion.
//
// MUTATIONS MEASURED 2026-09-08, each applied to the shipped unit and reverted:
//   `OnActiveSec=10min` -> `OnBootSec=10min` on the keepalive
//     → "the keepalive timer lost its OnActiveSec anchor: expected
//        [ '[Unit]', …(7) ] to include 'OnActiveSec=10min'"
//   `OnBootSec=10min` ADDED beside it (the add-don't-replace slip) → two reds,
//     "the keepalive timer is anchored to boot again — on a deploy that is no
//      delay at all: expected [ 'OnBootSec=10min' ] to deeply equal []" and
//     "ccd-telemetry-keepalive.timer does not carry exactly one first-run
//      anchor: expected [ 'OnActiveSec=10min', …(1) ] to have a length of 1 but
//      got 2"
//   the probe "harmonised" to `OnActiveSec=7min` with its comment deleted
//     → "the health timer lost its boot anchor: expected [ '[Unit]', …(7) ] to
//        include 'OnBootSec=7min'"
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SYSTEMD = path.join(import.meta.dirname, '..', '..', 'deploy', 'systemd');
const unit = (name: string): string => readFileSync(path.join(SYSTEMD, name), 'utf8');
/** The unit's real directives — comments dropped, so prose about a key can
 *  never be mistaken for the key. */
const keys = (name: string): string[] =>
  unit(name).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

describe('first-run anchors: the two new timers answer the deploy differently, on purpose', () => {
  it('the keepalive is armed relative to ITSELF — a deploy does not buy it a free full-cost pass', () => {
    const k = keys('ccd-telemetry-keepalive.timer');
    expect(k, 'the keepalive timer lost its OnActiveSec anchor').toContain('OnActiveSec=10min');
    // The one that matters: `OnBootSec=` here is elapsed-on-arrival on every box
    // that has ever run this fleet, so its presence IS the defect.
    expect(k.filter((l) => l.startsWith('OnBootSec=')),
      'the keepalive timer is anchored to boot again — on a deploy that is no delay at all')
      .toEqual([]);
    expect(k, 'the keepalive timer lost its 15-minute cadence').toContain('OnUnitActiveSec=15min');
  });

  it('the health probe is anchored to boot DELIBERATELY, and its file says so where the key is', () => {
    const k = keys('ccd-account-health.timer');
    expect(k, 'the health timer lost its boot anchor').toContain('OnBootSec=7min');
    expect(k, 'the health timer lost its 15-minute cadence').toContain('OnUnitActiveSec=15min');
    // A DECISION, not an oversight — and the argument has to live at the key,
    // because the next reader's instinct is to make the two units match. The
    // comment that stood here until 2026-09-08 claimed the 7 minutes bought a
    // boot-herd separation that covered the deploy case too; it never did, and a
    // justification that is false at the only moment it is tested is worse than
    // none. These two phrases are what replaced it.
    const prose = unit('ccd-account-health.timer');
    expect(prose, 'nothing at the key says the boot anchor is a deliberate choice')
      .toContain('DELIBERATELY');
    expect(prose, 'the file no longer states that a deploy gets no offset from OnBootSec')
      .toContain('ON A DEPLOY IT IS NO OFFSET AT ALL');
  });

  it('neither timer reaches for Persistent=, which would do nothing on a monotonic timer', () => {
    for (const name of ['ccd-account-health.timer', 'ccd-telemetry-keepalive.timer']) {
      expect(keys(name).filter((l) => l.startsWith('Persistent=')),
        `${name} sets Persistent=, which only has an effect on OnCalendar= timers`).toEqual([]);
      expect(keys(name).filter((l) => l.startsWith('OnCalendar=')),
        `${name} became a calendar timer — the Persistent= reasoning above no longer applies`)
        .toEqual([]);
    }
  });

  it('every timer in deploy/systemd carries exactly one first-run anchor', () => {
    // The census, so a fifth timer joining the four cannot arrive with no
    // anchor at all (first run then waits for OnUnitActiveSec from an
    // activation that never happened) or with both (two elapse points, and
    // `man 5 systemd.timer` fires on whichever comes first — a stagger nobody
    // chose). `ccrc-ddns.timer` is the one deliberate abstainer: it is a
    // CALENDAR timer, which is also the only shape `Persistent=` means anything
    // for, and it carries that key.
    const CALENDAR = new Set(['ccrc-ddns.timer']);
    const timers = ['ccd-account-health.timer', 'ccd-cap-scopes.timer', 'ccd-graph-sweep.timer',
      'ccd-telemetry-keepalive.timer', 'ccrc-ddns.timer'];
    for (const name of timers) {
      const anchors = keys(name).filter((l) => /^On(Boot|Active|Startup)Sec=/.test(l));
      if (CALENDAR.has(name)) {
        expect(keys(name).some((l) => l.startsWith('OnCalendar=')),
          `${name} is listed as a calendar timer but sets no OnCalendar=`).toBe(true);
        continue;
      }
      expect(anchors, `${name} does not carry exactly one first-run anchor`).toHaveLength(1);
    }
  });
});
