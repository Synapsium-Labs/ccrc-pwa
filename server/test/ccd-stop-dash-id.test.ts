// server/test/ccd-stop-dash-id.test.ts
//
// stop never takes a flag spelling as a surface value, a token or an id
// (path-identity spec §2.2, §2.4).
//
// `cmd_stop` strips `--surface` from ANY position before its arity rule, and a
// server before W1a composes the pair AFTER the id (`stop <id> --surface <word>`).
// So an id that spells `--surface` cannot be told from the key:
// `stop --surface --surface pwa` took `--surface` as the word and stopped `pwa`,
// the console's surface word. Every other dash-leading id stayed the literal id
// and was stopped as such. Three rules close it, and each has a case here that
// goes red without it:
//   - a `--surface` value, in either spelling, never begins with `-` (stop's usage line);
//   - no token left after the strip begins with `-` (`bad session id: <token>`);
//   - the composed id passes `_reg_id_ok` before the journal line (`bad session id: <id>`).
// Each refusal is a bare `die` before anything is journaled, so a refusal stops
// NOTHING: no journal line, no stamp, no keep marker, no unit call, no pane kill.
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. It spawns no bash of its own: every snippet runs through
// `makePrHarness().run`, and every row is planted with node:fs (`plantRow`),
// never through ccd, so a row may be named for a flag.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import { DASH_IDS, DECOY_IDS, plantRow, regListing } from './dashIdFixture.js';

let h: PrHarness;

/** The real row the controls stop: a workspace-shaped id, as the suite's other stop cases use. */
const ID = 'demo-quiet-mesa';

/** stop's one usage literal. Every arity refusal and every dash-leading surface value answers with it. */
const USAGE = 'usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>';

/** Every id the residue rule refuses as one word: each flag spelling the server's builders append
 *  except `--surface` (it has its own two cases), and a short one. */
const RESIDUE_IDS: string[] = [...DASH_IDS.filter((d) => d !== '--surface'), '-x'];

/** The unit manager and tmux as shell functions that LOG, the `cmd_stop` idiom of
 *  `ccd-session-state.test.ts`. A function wins over the harness's PATH poison, so every call a stop
 *  makes lands in `$HOME/ccd-calls`, and a refusal leaves that file absent. */
const STOP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; '
  + 'launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
  + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };';

/** `ccd stop <args>`, sourced, with the logging stubs; a failure is returned, never thrown. */
const stop = (args: string): { code: number; stdout: string; stderr: string } =>
  h.run(`${STOP} cmd_stop ${args}`);

/** The last stderr line: ccd's own `die` line (`ccd: <text>`), whatever the shell printed above it. */
const lastErr = (stderr: string): string => stderr.trim().split('\n').pop() ?? '';

/** `_tmux_t`'s exact pane target for an id, with `.` and `:` renamed as `_tmux` renames them. */
const paneOf = (id: string): string => `=cc-${id.replace(/[.:]/g, '_')}:`;

/** The row `id` was not stopped: no stamp, no keep marker, no stop row, and no unit call or pane kill names it. */
const notStopped = (id: string): void => {
  expect(h.reg(id, 'stopped'), `${id} carries no stop stamp`).toBeNull();
  expect(h.reg(id, 'choicekept'), `${id} carries no keep marker`).toBeNull();
  expect(eventsOf(h.home, 'stop').filter((e) => e['id'] === id), `no stop row names ${id}`).toEqual([]);
  expect(asManagerCalls(h.calls()).filter((l) => l.split(/\s+/).includes(`claude-session@${id}`)),
    `no unit call names ${id}`).toEqual([]);
  expect(h.calls().filter((l) => l === `tmux kill-session -t ${paneOf(id)}`), `no pane kill names ${id}`)
    .toEqual([]);
};

/** A refusal stopped NOTHING: no journal line at all, no stop stamp or keep marker anywhere under $REG,
 *  no call to the unit manager or tmux, and the harness's contained manager never reached. */
const nothingStopped = (): void => {
  expect(readJournal(h.home), 'a refusal journals nothing').toEqual([]);
  expect(regListing(h.home).filter((n) => /\.(stopped|choicekept)$/.test(n)), 'no stop stamp or keep marker')
    .toEqual([]);
  expect(h.calls(), 'no unit call, no pane kill and no probe').toEqual([]);
  expect(h.systemctlCalls(), 'the contained manager was never reached').toEqual([]);
};

beforeEach(() => {
  h = makePrHarness('ccrc-stop-dash-id-');
  // The decoys: the sweeps' `agent` and the console's `pwa`, the words a redirect lands on.
  for (const d of DECOY_IDS) plantRow(h.home, d);
  // The row the controls stop, and a row for every dash-leading id, so a stop that took one as its id
  // would find a live-looking row (its keep marker is the first thing such a stop writes).
  plantRow(h.home, ID);
  for (const d of [...DASH_IDS, '-x']) plantRow(h.home, d);
});
afterEach(() => { h.cleanup(); });

describe('stop never rebinds to the surface word, and never takes a flag spelling as an id (path-identity spec §2.4)', () => {
  it('the order a server before W1a composes for id --surface is refused, and pwa is never stopped', () => {
    // `stopId('--surface', 'pwa')` before W1a composes `['stop', '--surface', '--surface', 'pwa']`.
    // Without the value rule the arm takes `--surface` as the word, and `pwa` falls out as the id.
    const r = stop('--surface --surface pwa');
    expect(r.code).toBe(1);
    expect(lastErr(r.stderr)).toBe(`ccd: ${USAGE}`);
    notStopped('pwa');
    nothingStopped();
  });

  it("W1a's order for id --surface is refused by arity", () => {
    // `['stop', '--surface', 'pwa', '--surface']`: the arm takes `pwa` as the word, and the second
    // `--surface` has no value. The arm's own arity check refuses it, not an id check. Green before
    // this wave, and pinned so the order W1a moves to stays refused.
    const r = stop('--surface pwa --surface');
    expect(r.code).toBe(1);
    expect(lastErr(r.stderr)).toBe(`ccd: ${USAGE}`);
    notStopped('pwa');
    nothingStopped();
  });

  it('a --surface= value beginning with "-" is refused', () => {
    // The third row is the `=` spelling of the redirect: the word `--surface`, then `pwa` as the id.
    for (const args of [`--surface=-x ${ID}`, `${ID} --surface=--actor`, '--surface=--surface pwa']) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: ${USAGE}`);
    }
    notStopped(ID);
    notStopped('pwa');
    nothingStopped();
  });

  it.each(RESIDUE_IDS)('a dash-leading id dies "bad session id" with no systemctl call and no stop row: %s', (id) => {
    // Three shapes: no surface (`['stop', id]`), a server before W1a (`['stop', id, '--surface', 'pwa']`)
    // and W1a's (`['stop', '--surface', 'pwa', id]`). Before this wave each one stopped the literal row.
    for (const args of [`'${id}'`, `'${id}' --surface pwa`, `--surface pwa '${id}'`]) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: bad session id: ${id}`);
    }
    notStopped(id);
    notStopped('pwa');
    nothingStopped();
  });

  it('a dash-leading wrapper or project in the two-argument form dies', () => {
    // `stopPair` composes `['stop', w, p, '--surface', s]` before W1a and `['stop', '--surface', s, w, p]`
    // after it. `_id` would bury a dash-leading project INSIDE the composed id (`claude-a--x`), where
    // `_reg_id_ok` cannot see it, so the residue rule is what refuses these.
    const rows: ReadonlyArray<readonly [string, string, string]> = [
      // [the argv after `stop`, the die line, the id `_id` would have composed]
      ['claude-a -x', 'ccd: bad session id: -x', 'claude-a--x'],
      ['-x demo', 'ccd: bad session id: -x', '-x-demo'],
      ['--surface pwa -x demo', 'ccd: bad session id: -x', '-x-demo'],
      ['claude-a --actor --surface pwa', 'ccd: bad session id: --actor', 'claude-a---actor'],
      ['--surface pwa claude-a --actor', 'ccd: bad session id: --actor', 'claude-a---actor'],
      // A project of `--surface` before W1a: the arm would take `--surface` as the word and stop `claude-a-pwa`.
      ['claude-a --surface --surface pwa', `ccd: ${USAGE}`, 'claude-a-pwa'],
    ];
    for (const [args, said, composed] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(said);
      notStopped(composed);
    }
    notStopped('pwa');
    nothingStopped();
  });

  it('a composed id the registry charset refuses dies', () => {
    // Before this wave stop had no id check at all: these were journaled, stamped and sent to the
    // unit manager as `claude-session@a/b`.
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["'a/b'", 'a/b'],
      ["'a b'", 'a b'],
      ["'a=b'", 'a=b'],
      ["claude-a 'p/q'", 'claude-a-p/q'],
    ];
    for (const [args, id] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(1);
      expect(lastErr(r.stderr), args).toBe(`ccd: bad session id: ${id}`);
    }
    nothingStopped();
  });

  it("an empty --surface value keeps today's meaning", () => {
    // An empty word is not a flag spelling. It is declared, normalised to `unknown` in the stamp, and
    // journaled as no declaration (`none`), exactly as before this wave.
    for (const args of [`--surface '' ${ID}`, `--surface= ${ID}`]) {
      const r = stop(args);
      expect(r.code, args).toBe(0);
      expect(r.stdout, args).toBe(`stopped ${ID}`);
      expect(h.reg(ID, 'stopped'), args).toMatch(/^\d{10} unknown$/);
    }
    const rows = eventsOf(h.home, 'stop');
    expect(rows).toHaveLength(2);
    expect(rows.map((e) => decOf(e)['surface'])).toEqual(['none', 'none']);
  });

  it('a well-formed id or pair is still stopped in either order, a dot-leading or inner-dash id included', () => {
    // THE CONTROL. Order stays free for every word that is not a flag spelling. The dot rule belongs to
    // the token verbs alone (path-identity spec §2.6), so stop still binds a dot-leading id, and
    // `_reg_id_ok` refuses a LEADING dash only, so an inner `--` (a wrapper may end in `-`) still binds.
    const rows: ReadonlyArray<readonly [string, string, RegExp]> = [
      [`${ID} --surface pwa`, ID, /^\d{10} pwa$/],
      [`--surface agent ${ID}`, ID, /^\d{10} agent$/],
      ['claude-a demo --surface pwa', 'claude-a-demo', /^\d{10} pwa$/],
      ['--surface pwa claude-a demo', 'claude-a-demo', /^\d{10} pwa$/],
      ['.hidden-x', '.hidden-x', /^\d{10} cli$/],
      ['a--b', 'a--b', /^\d{10} cli$/],
    ];
    for (const [args, id, stamp] of rows) {
      const r = stop(args);
      expect(r.code, args).toBe(0);
      expect(r.stdout, args).toBe(`stopped ${id}`);
      expect(h.reg(id, 'stopped'), args).toMatch(stamp);
    }
    // The surface word is never the id.
    notStopped('pwa');
    notStopped('agent');
  });
});
