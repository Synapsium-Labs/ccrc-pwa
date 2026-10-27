// The cadence chain's census queries (`census-w8/cadence.ts`; W8 Task C8a, D-7053; ARCH-69 (#804)), held the two ways
// `consolidation-census.test.ts` holds its own: against a fixture tree, where every shape a query must see or must
// skip is planted on purpose, and against the real tree, where the counts a PR body quotes are measured.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import { ddnsTranscriptCadences, launchdCadenceLiterals, timerSpellings } from './cadence.js';

/** A fixture tree: `ccd/ccrc`, `ccd/ccd` and `deploy/systemd/*.timer`, each as given. */
function tree(files: Record<string, string>): string {
  const root = mkTmp('census-w8-cadence-');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const plist = (value: string): string => [
  '    cat > "$gen" <<PL',
  '<dict>',
  `  <key>StartInterval</key>${value}`,
  '</dict>',
  'PL',
].join('\n');

const CCRC_FIXTURE = [
  '#!/usr/bin/env bash',
  '# a comment naming <key>StartInterval</key><integer>300</integer> is no writer',
  '_job_literal() {',
  plist('<integer>300</integer>'),
  '}',
  '_job_inline() {',
  plist('<integer>$(_timer_period_s "$t")</integer>'),
  '}',
  '_job_foreign() {',
  '  local p',
  plist('<integer>$PERIOD</integer>'),
  '}',
  '_job_unassigned_local() {',
  '  local p',
  '  p=300',
  plist('<integer>$p</integer>'),
  '}',
  '_job_calendar() {',
  '  local p',
  '  p="$(_timer_period_s "$t")" || return 1',
  '  cat > "$gen" <<PL',
  '  <key>StartCalendarInterval</key><dict><key>Minute</key><integer>$p</integer></dict>',
  'PL',
  '}',
  '_job_accepted() {',
  '  local t="$1" gen period',
  '  period="$(_timer_period_s "$t")" || return 1',
  plist('<integer>$period</integer>'),
  '}',
  '_job_assigned_in_another_function() {',
  plist('<integer>$period</integer>'),
  '}',
  '_exp_ddns_units() {',
  '  # the next 5-minute tick, in a comment: not a sentence',
  '  if [ "$CCD_OS" = darwin ]; then',
  '    echo "expose: a missed refresh waits for the next 5-minute tick"',
  '    if true; then',
  '      echo "expose: enabled — the record refreshes every 5 minutes"',
  '    fi',
  '    echo "expose: nothing timed here"',
  '    return 0',
  '  fi',
  '  echo "expose: enabled — the record refreshes every five minutes"',
  '  echo "expose: or every minute, or 90 seconds"',
  '  echo "curl --max-time 30 is not a cadence"',
  '}',
  '_elsewhere() {',
  '  echo "refreshes every 5 minutes, outside the ddns function"',
  '}',
  '',
].join('\n');

const CCD_FIXTURE = ['#!/usr/bin/env bash', '_ccd_job() {', plist('<integer>60</integer>'), '}', ''].join('\n');

const TIMER = (lines: string[]): string => ['[Unit]', 'Description=fixture', '[Timer]', ...lines, '[Install]', 'WantedBy=timers.target', ''].join('\n');

describe('the cadence census, on a fixture tree', () => {
  const root = tree({
    'ccd/ccrc': CCRC_FIXTURE,
    'ccd/ccd': CCD_FIXTURE,
    'deploy/systemd/a.timer': TIMER(['OnBootSec=45s', 'OnUnitActiveSec=60s', 'AccuracySec=10s']),
    'deploy/systemd/b.timer': TIMER(['OnActiveSec=2min', 'OnUnitActiveSec=60s', 'RandomizedDelaySec=5min', 'Persistent=true']),
    'deploy/systemd/c.timer': TIMER(['  OnCalendar=*:0/5', 'Persistent=true', '# OnUnitActiveSec=1h in a comment']),
    'deploy/systemd/c.service': TIMER(['OnUnitActiveSec=9h']),
  });

  it('launchdCadenceLiterals: a literal, an inline $(…), a foreign variable, a local not read from the timer and every StartCalendarInterval count; the accepted shape does not', () => {
    const rows = launchdCadenceLiterals(root).map((s) => `${s.file} ${s.text.trim()}`);
    expect(rows).toEqual([
      'ccd/ccrc <key>StartInterval</key><integer>300</integer>',
      'ccd/ccrc <key>StartInterval</key><integer>$(_timer_period_s "$t")</integer>',
      'ccd/ccrc <key>StartInterval</key><integer>$PERIOD</integer>',
      'ccd/ccrc <key>StartInterval</key><integer>$p</integer>',
      'ccd/ccrc <key>StartCalendarInterval</key><dict><key>Minute</key><integer>$p</integer></dict>',
      'ccd/ccrc <key>StartInterval</key><integer>$period</integer>',
      'ccd/ccd <key>StartInterval</key><integer>60</integer>',
    ]);
    // The one accepted site is `_job_accepted`'s; the same text in a function that never assigned it is counted.
    const accepted = CCRC_FIXTURE.split('\n').indexOf(plist('<integer>$period</integer>').split('\n')[2]!) + 1;
    expect(launchdCadenceLiterals(root).map((s) => s.line)).not.toContain(accepted);
  });

  it('ddnsTranscriptCadences: the duration sentences of _exp_ddns_units only, tagged by arm, comments skipped', () => {
    expect(ddnsTranscriptCadences(root).map((s) => [s.arm, s.text.trim()])).toEqual([
      ['darwin', 'echo "expose: a missed refresh waits for the next 5-minute tick"'],
      ['darwin', 'echo "expose: enabled — the record refreshes every 5 minutes"'],
      ['linux', 'echo "expose: enabled — the record refreshes every five minutes"'],
      ['linux', 'echo "expose: or every minute, or 90 seconds"'],
    ]);
  });

  it('timerSpellings: the cadence lines of the .timer files only, distinct and sorted; every other key, a comment and a .service are not listed', () => {
    expect(timerSpellings(root)).toEqual(['OnCalendar=*:0/5', 'OnUnitActiveSec=60s']);
  });

  it('a tree with none of the files answers no rows', () => {
    const empty = mkTmp('census-w8-cadence-empty-');
    expect(launchdCadenceLiterals(empty)).toEqual([]);
    expect(ddnsTranscriptCadences(empty)).toEqual([]);
    expect(timerSpellings(empty)).toEqual([]);
  });
});

describe('the cadence census, on the real tree', () => {
  it('launchdCadenceLiterals: none (1 at the base, the ddns job\'s literal 300)', () => {
    expect(launchdCadenceLiterals().map((s) => `${s.file} ${s.text.trim()}`)).toEqual([]);
  });

  it('ddnsTranscriptCadences: the Linux arm\'s enable sentence alone (3 at the base: two Darwin, one Linux)', () => {
    expect(ddnsTranscriptCadences().map((s) => [s.arm, s.text.trim()])).toEqual([
      ['linux', 'echo "expose: $CCRC_DDNS_UNIT.timer enabled — the DuckDNS record refreshes every 5 minutes"'],
    ]);
  });

  it('timerSpellings: the shipped spellings', () => {
    expect(timerSpellings()).toEqual([
      'OnCalendar=*:0/5',
      'OnUnitActiveSec=15min',
      'OnUnitActiveSec=1h',
      'OnUnitActiveSec=2min',
      'OnUnitActiveSec=4h',
      'OnUnitActiveSec=60min',
      'OnUnitActiveSec=60s',
    ]);
  });
});
