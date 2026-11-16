// server/test/ccd-route-settle.test.ts
// The effort field decides what a spawn carries (routing spec 2026-09-14 §5.2, S1-R8/S1-R11),
// and since D-8149 the decision is made on the spawn ARGV alone: the settle types nothing.
// (This file used to drive `_inject_spawn_effort`, the settle keystroke.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-settle-'); });
afterEach(() => { h.cleanup(); });

const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; esac; return 0; };`;
const seed = (): void => {
  h.sh(`_reg_set myid wrapper claude; _reg_set myid workdir '${h.home}'; _reg_set myid uuid deadbeef-0000-4000-8000-000000000000`);
};
const spawn = (): string => {
  h.sh(`${STUBS} _spawn_start myid new 2>/dev/null`);
  return h.calls().filter((l) => l.startsWith('tmux new-session')).join('\n');
};
const efforts = (line: string): string[] => [...line.matchAll(/--effort (\S+)/g)].map((m) => m[1]!);
const typed = (): string[] => h.calls().filter((l) => l.includes('send-keys'));
const log = (): string => h.sh('cat "$HOME/.cc-sessions/swap.log" 2>/dev/null; true');

describe('the spawn argv reads the routing record (routing spec 2026-09-14 §5.2)', () => {
  it('no record: --effort high, and no keystroke', () => {
    seed();
    expect(efforts(spawn())).toEqual(['high']);
    expect(typed()).toEqual([]);
  });
  it.each(['high', 'ultracode'])('a record with effort %s: that level only, never the default beside it', (lvl) => {
    seed(); h.sh(`_reg_set myid class opus; _reg_set myid effort ${lvl}`);
    expect(efforts(spawn())).toEqual([lvl]);
  });
  it('a record with effort auto: the lane decides, so no flag', () => {
    seed(); h.sh('_reg_set myid effort auto');
    expect(efforts(spawn())).toEqual([]);
  });
  it('a record with no effort field at all (only class): the default rides the argv (S1-R11)', () => {
    seed(); h.sh('_reg_set myid class sonnet');
    expect(efforts(spawn())).toEqual(['high']);
  });
  it('class haiku with no effort field: haiku takes no effort level, so none is passed', () => {
    seed(); h.sh('_reg_set myid class haiku');
    expect(efforts(spawn())).toEqual([]);
  });
  it('a ccd-WRITTEN field alone never switches off the default: `degraded` is not a record of anybody\'s effort', () => {
    seed(); h.sh('_reg_set myid degraded opus');
    expect(efforts(spawn())).toEqual(['high']);
  });
  it('an EMPTY effort file still counts as present: a field somebody wrote is a field somebody meant', () => {
    seed(); h.sh('_reg_set myid effort ""');
    expect(efforts(spawn())).toEqual([]);
  });
  it('an effort file `_reg_get` cannot CAT still counts as present, and the spawn SAYS SO', () => {
    seed();
    h.sh('_reg_set myid effort high; ln -sf /dev/null "$HOME/.cc-sessions/myid.effort"');
    expect(efforts(spawn())).toEqual([]);
    expect(log()).toMatch(/route-unmeasured myid: field effort is present but could not be read — treated as absent/);
    expect(log(), 'no byte count: nothing was read').not.toMatch(/bytes/);
  });
  it('a field that is genuinely ABSENT stays silent — the other half of `_reg_get`\'s folded rc', () => {
    seed();
    h.sh('_reg_set myid class opus; _route_get myid class >/dev/null; _route_get myid effort >/dev/null');
    expect(log()).not.toMatch(/route-unmeasured|route-reject/);
  });
  it('class haiku with an effort on disk: no flag, and the PAIR is noted', () => {
    seed(); h.sh('_reg_set myid class haiku; _reg_set myid effort high');
    expect(efforts(spawn())).toEqual([]);
    expect(log()).toMatch(/route-refuse myid: class haiku takes no effort level/);
  });
  it('an unrecognised effort: no flag and a note — nothing unrecognised reaches the argv', () => {
    seed(); h.sh("_reg_set myid effort 'extreme; rm -rf /'");
    const line = spawn();
    expect(efforts(line)).toEqual([]);
    expect(line).not.toContain('rm -rf');
    expect(log()).toMatch(/route-reject myid: field effort holds an unrecognised value \(17 bytes\)/);
    expect(log()).not.toContain('rm -rf');
  });
});
