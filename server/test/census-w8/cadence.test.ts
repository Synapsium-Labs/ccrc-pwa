// The cadence chain's census queries (`census-w8/cadence.ts`; W8 Task C8a, D-7053; ARCH-69 (#804)), held the two ways
// `consolidation-census.test.ts` holds its own: against a fixture tree, where every shape a query must see or must
// skip is planted on purpose, and against the real tree, where the counts a PR body quotes are measured.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import { ddnsTranscriptCadences, doctorRestatedCadences, doctorSourceTimeCalls, launchdCadenceLiterals, timerSpellings } from './cadence.js';

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

// ── C8b (D-7054): the doctor's restated cadences and its source-time calls ─────────────────────────────────────────
const DOCTOR_FIXTURE = [
  '#!/usr/bin/env bash',
  '# a comment: the timer fires every 60s, and [ "$age" -gt 2700 ] — never a site',
  'if [ -z "${CCRC_HERE:-}" ]; then',
  '  CCRC_HERE="$(cd "${CCRC_HERE%/*}" && pwd)"',
  'fi',
  '_dr_pass() { _dr_line PASS "$1" "$2"; return 0; }',
  '_FIXTURE_TOP_BOUND=$(_dr_cycles_s a.timer 3)',
  'FIXTURE_LIMIT=4096',
  '_dr_timer_period_s() {',
  '  local stale_bound=900',
  '}',
  '_dr_cycles_s() {',
  '  printf "every 15 minutes, read here and never restated"',
  '}',
  '_check_words() {',
  '  _dr_warn words "the sweep runs every minute, so it has stopped" "fix"',
  '  _dr_warn words "the timer fires every five minutes" "fix"',
  '  _dr_warn words "a missed refresh waits for the next 5-minute tick" "fix"',
  '  note+=("the first poll runs five minutes after enable")',
  '  _dr_warn words "it has fired every 15min (up to ~900s late)" "fix"',
  "  printf 'every minute, single-quoted, is no sentence'",
  '  _dr_pass words "$((fetchedAt / 60)) min old, $((age / 3600)) h old"',
  '  _dr_pass words "nothing timed here: written $((now - at))s ago"',
  '  _dr_warn words "$(_dr_every_words "$p") is read, not restated" "fix"',
  '}',
  '_check_bounds() {',
  '  local grace=$((2 * 60)) other',
  '  local small_grace=30 limit=600',
  '  if [ "$age" -gt 2700 ]; then :; fi',
  '  if [ 10800 -lt "$age" ]; then :; fi',
  '  if (( age > 300 )); then :; fi',
  '  if [ "$age" -gt 30 ]; then :; fi',
  '  if [ "$age" -gt "$bound" ]; then :; fi',
  '  bound=$(_dr_cycles_s ccrc-models.timer 3)',
  '  stale=${FIXTURE_STALE_S:-300}',
  '  _dr_fixture_call',
  '}',
  '_check_server-caps() {',
  '  writer="this box\'s own ccrc server (it rewrites the file every minute)"',
  '  _dr_skip server-caps "a server here would derive the role both and write the file every minute"',
  '  writer="ccd-update-sync (it asks the server\'s /health every minute)"',
  '}',
  '_dr_codex_usage() {',
  '  note+=("no usage row yet (the first poll runs five minutes after enable)")',
  '}',
  '_DR_FIXTURE_STALE_S=2700',
  '',
].join('\n');

describe('the doctor\'s cadence census, on a fixture tree', () => {
  const root = tree({ 'ccd/ccrc-doctor-checks': DOCTOR_FIXTURE });
  const rows = (): string[] => doctorRestatedCadences(root).map((s) => `${s.check}${s.kept === null ? '' : ' (kept)'} ${s.text.trim()}`);

  it('doctorRestatedCadences: each word form, each age comparison >= 60 either way round, each grace/stale/bound literal; display arithmetic, a comment, a single-quoted string, the reader\'s own helpers and the two server-beat lines are passed over', () => {
    expect(rows()).toEqual([
      'words _dr_warn words "the sweep runs every minute, so it has stopped" "fix"',
      'words _dr_warn words "the timer fires every five minutes" "fix"',
      'words _dr_warn words "a missed refresh waits for the next 5-minute tick" "fix"',
      'words note+=("the first poll runs five minutes after enable")',
      'words _dr_warn words "it has fired every 15min (up to ~900s late)" "fix"',
      'bounds local grace=$((2 * 60)) other',
      'bounds local small_grace=30 limit=600',
      'bounds if [ "$age" -gt 2700 ]; then :; fi',
      'bounds if [ 10800 -lt "$age" ]; then :; fi',
      'bounds if (( age > 300 )); then :; fi',
      'bounds stale=${FIXTURE_STALE_S:-300}',
      'server-caps writer="ccd-update-sync (it asks the server\'s /health every minute)"',
      'codex (kept) note+=("no usage row yet (the first poll runs five minutes after enable)")',
      '(top level) _DR_FIXTURE_STALE_S=2700',
    ]);
  });

  it('doctorSourceTimeCalls: a top-level line calling a _dr_* helper; the CCRC_HERE resolution, a one-line definition, a plain assignment and every call inside a function are not', () => {
    expect(doctorSourceTimeCalls(root).map((s) => s.text)).toEqual(['_FIXTURE_TOP_BOUND=$(_dr_cycles_s a.timer 3)']);
  });

  it('a tree with no doctor table answers no rows', () => {
    const empty = mkTmp('census-w8-cadence-doctor-empty-');
    expect(doctorRestatedCadences(empty)).toEqual([]);
    expect(doctorSourceTimeCalls(empty)).toEqual([]);
  });
});

/** One real-tree row: its check, ` (kept)` for a kept row, and the first 60 characters of its line. */
const realRow = (s: { check: string; kept: string | null; text: string }): string =>
  `${s.check}${s.kept === null ? '' : ' (kept)'} ${s.text.trim().slice(0, 60).trimEnd()}`;

/** The rows that still restate a timer's period on this tree, and the kept set. The base (`e664a6e11`): 14 rows in 7
 *  checks, the scope-sweep default among them (kept: call-bound), plus the kept OnActiveSec note. Each move commit of
 *  C8b removes its own row from this list. */
const REAL_BASE: string[] = [
  'pool-sync local pool_sync_grace=$((2 * 60)) unit_mtime unit_age grace',
  'pool-sync _dr_warn pool-sync "pool-sync-not-yet-synced: ccd-pool-sync.',
  'pool-sync "wait for the timer to fire (up to ~60s) and re-run ccrc doc',
  'pool-sync local period cad_rc=0 every=" (every 60s)"',
  'update-sync local update_sync_grace=$((2 * 60)) unit_mtime unit_age grac',
  'update-sync _dr_warn update-sync "update-sync-not-yet-synced: ccd-update',
  'update-sync "wait for the timer to fire (up to ~60s) and re-run ccrc doc',
  'graphify elif [ "$age" -gt 2700 ]; then',
  'models elif [ "$age" -gt 10800 ]; then',
  'codex _DR_CODEX_USAGE_STALE_S=2700',
  'codex _DR_CODEX_USAGE_STALE_DIRECT_S=3600',
  'codex (kept) note+=("no usage row yet (enabled $((now - en))s ago; the fi',
  'scope-sweep (kept) stale=${CCRC_SCOPE_SWEEP_STALE_S:-300}; [[ "$stale" =~ ^[1-9',
  'scope-sweep local period cad_rc=0 runs="the sweep runs every minute, so',
  'server-caps writer="ccd-update-sync (it asks the server\'s /health every',
];

describe('the doctor\'s cadence census, on the real tree', () => {
  // The base (`e664a6e11`): 14 rows in 7 checks, the scope-sweep default among them (kept: call-bound), plus the kept
  // OnActiveSec note. Each move commit of C8b removes its own row from this list.
  it('doctorRestatedCadences: the rows still restated, and the kept set', () => {
    expect(doctorRestatedCadences().map(realRow)).toEqual(REAL_BASE);
  });

  it('doctorSourceTimeCalls: none', () => {
    expect(doctorSourceTimeCalls()).toEqual([]);
  });
});
