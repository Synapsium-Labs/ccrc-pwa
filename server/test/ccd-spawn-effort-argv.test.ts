// server/test/ccd-spawn-effort-argv.test.ts
// D-8149 — the box-default effort rides the spawn argv; nothing is typed at settle.
//
// Claude Code 2.1.321 saves the plain `/effort <level>` form as the ACCOUNT's default
// for new sessions (the model's `effortLevel` in the config dir's user settings). A
// settle keystroke of that form therefore rewrote an account setting on every fresh
// session. The `--effort` flag is session-only, so a session with no effort field
// takes `SPAWN_EFFORT` there, on BOTH spawn lines, exactly as a recorded effort does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-effort-'); });
afterEach(() => { h.cleanup(); });

const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};
const spawnBoth = (id: string, pre = ''): string[] => {
  h.sh(`${RESUME_DIES} ${pre} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
  expect(lines).toHaveLength(2);
  return lines;
};
const effortFlags = (line: string): string[] => [...line.matchAll(/--effort (\S+)/g)].map((m) => m[1]!);

describe('a session with no effort field takes SPAWN_EFFORT on the spawn argv (D-8149)', () => {
  it('no record: --effort high on BOTH the resume line and the --session-id retry', () => {
    seed('myid');
    const [primary, retry] = spawnBoth('myid');
    expect(effortFlags(primary!)).toEqual(['high']);
    expect(effortFlags(retry!)).toEqual(['high']);
    expect(primary).toContain(`--effort high --resume '${UUID}'`);
    expect(retry).toContain(`--effort high --session-id '${UUID}'`);
  });
  it('a record with a class and no effort: the default rides the argv beside --model', () => {
    seed('myid'); h.sh('_reg_set myid class sonnet');
    const [primary] = spawnBoth('myid');
    expect(primary).toContain('--model sonnet --effort high ');
    expect(effortFlags(primary!)).toEqual(['high']);
  });
  it('SPAWN_EFFORT empty disables it: no --effort at all', () => {
    seed('myid');
    for (const l of spawnBoth('myid', 'SPAWN_EFFORT="";')) expect(effortFlags(l)).toEqual([]);
  });
  it('a recorded effort wins and is not doubled', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort medium');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual(['medium']);
  });
  it('a recorded effort of auto: the lane decides, the default is not added behind it', () => {
    seed('myid'); h.sh('_reg_set myid effort auto');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
  it('never a top-level effortLevel in --settings (it would apply to every model)', () => {
    seed('myid');
    for (const l of spawnBoth('myid')) expect(l).not.toMatch(/effortLevel/);
  });
  it('a lane that is neither Anthropic nor Codex takes no --effort (the third-backend control, D-8631)', () => {
    twoLanes();
    seed('myid', 'gpt');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
});

/** Three backends: Anthropic, a Codex lane (`telemetry: 'codex'`, `exec.kind: 'external'`, the
 *  shape `ccd-backend-vs-placement.test.ts` uses) and a lane that is neither (`telemetry: 'none'`). */
const twoLanes = (): void => {
  seedAccountsSh(h.home, {
    version: 1, accounts: [
      { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-a', label: 'la', configDirSuffix: '.lane-a', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
      { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
    ],
  });
  for (const w of ['lane-a', 'gpt']) fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};

// D-8631 — a Codex lane resolves the same effort an Anthropic lane does: the record's level, else SPAWN_EFFORT.
describe('a Codex lane takes SPAWN_EFFORT on the spawn argv as an Anthropic lane does (D-8631)', () => {
  beforeEach(() => { twoLanes(); });
  it('(a) no record: --effort high on BOTH the resume line and the --session-id retry', () => {
    seed('myid', 'lane-a');
    const [primary, retry] = spawnBoth('myid');
    expect(effortFlags(primary!)).toEqual(['high']);
    expect(effortFlags(retry!)).toEqual(['high']);
    expect(primary).toContain(`--effort high --resume '${UUID}'`);
    expect(retry).toContain(`--effort high --session-id '${UUID}'`);
  });
  it('(b) a record naming only class=opus: --model opus --effort high', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus');
    for (const l of spawnBoth('myid')) {
      expect(l).toContain('--model opus --effort high ');
      expect(effortFlags(l)).toEqual(['high']);
    }
  });
  it('(c) a recorded effort=medium wins and is not doubled', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort medium');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual(['medium']);
  });
  it('control: class=haiku and no effort takes no --effort (the haiku rule holds on both backends)', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class haiku');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
  it('control: class=haiku effort=high takes no --effort, and the pair is noted', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class haiku; _reg_set myid effort high');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/route-refuse myid: class haiku takes no effort level/);
  });
  it('control: a recorded effort=auto composes no flag and stamps no inert', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid effort auto');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
    expect(h.reg('myid', 'inert')).toBeNull();
  });
  it('control: SPAWN_EFFORT empty disables it on a Codex lane too', () => {
    seed('myid', 'lane-a');
    for (const l of spawnBoth('myid', 'SPAWN_EFFORT="";')) expect(effortFlags(l)).toEqual([]);
  });
});

describe('the settle types no effort command (D-8149)', () => {
  it('_inject_spawn_effort and its settle call are gone', () => {
    expect(h.sh('type _inject_spawn_effort 2>&1 || true')).toMatch(/not found/);
    const src = ccdSource();
    expect(src).not.toMatch(/^\s*_inject_spawn_effort\b/m);
    expect(src).not.toMatch(/&&\s*_inject_spawn_effort/);
  });
});

// Task A3.5 (model classes, Anthropic arm; D23, D-8746, spec §2.5.5): the effort a home saved under an older id of a class's family is
// ORPHANED when the class's alias moves on. ccd carries it to the current id at launch, session-only (`--effort`), and only when the
// routing record says `auto` ("the lane decides"): the saved level is the lane's decision. Every other composition is unchanged.
describe('an orphaned saved effort is carried at launch, only under auto (D23, D-8746)', () => {
  const modelsDir = (): string => path.join(h.home, '.ccrc', 'models');
  /** One aliases file for `claude`: opus's current id, its row's levels, and the orphaned level (null for none). */
  const plantAliases = (o: { id?: string; orphan?: string | null; efforts?: string[] | null; orphanOn?: string } = {}): void => {
    const id = o.id ?? 'claude-opus-9-1';
    const classes: Record<string, unknown> = {};
    for (const c of ['fable', 'opus', 'sonnet', 'haiku']) {
      const cid = c === 'opus' ? id : `claude-${c}-9-1`;
      const orphaned = c === (o.orphanOn ?? 'opus') && o.orphan ? { id: 'claude-opus-8-1', level: o.orphan } : null;
      classes[c] = { id: cid, source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: cid, seenId: null, unobserved: false,
        unlaunchable: null, row: { id: cid, label: null, efforts: o.efforts === undefined ? ['low', 'medium', 'high', 'xhigh'] : o.efforts, defaultEffort: null, minVersion: null },
        rowFrom: 'own', heldRow: null, orphaned };
    }
    fs.mkdirSync(modelsDir(), { recursive: true });
    fs.writeFileSync(path.join(modelsDir(), 'claude.aliases.json'), serializeAliases(parseAliases({
      v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes })));
  };
  /** `spawnBoth` on a clean call log (it asserts two lines, and a block spawns more than once). */
  const both = (): string[] => { fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true }); return spawnBoth('myid'); };
  const swapLog = (): string => { const f = path.join(h.home, '.cc-sessions', 'swap.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };

  it('an orphaned level is carried under auto', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort auto');
    plantAliases({ orphan: 'xhigh' });
    const [primary, retry] = both();
    expect(effortFlags(primary!)).toEqual(['xhigh']);
    expect(effortFlags(retry!)).toEqual(['xhigh']);
    expect(primary).toContain(`--model opus --effort xhigh --resume '${UUID}'`);
    // the stamp keeps the RECORD's word, so the applier finds nothing pending and types nothing
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus effort=auto');
    expect(h.sh('_route_apply_pending myid; echo rc=$?')).toBe('rc=1');
    expect(h.sh('_route_pending_word myid')).toBe('');
    // and the record itself is untouched: ccrc writes no level of its own
    expect(h.reg('myid', 'effort')).toBe('auto');
  });

  it('no orphan, auto composes none', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort auto');
    plantAliases({ orphan: null });
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus effort=auto');
    // the other no-orphan shapes: no aliases file at all, an unreadable one, and an orphan under ANOTHER class
    fs.rmSync(modelsDir(), { recursive: true, force: true });
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    fs.mkdirSync(path.join(modelsDir(), 'claude.aliases.json'), { recursive: true });
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    fs.rmSync(modelsDir(), { recursive: true, force: true });
    plantAliases({ orphan: 'xhigh', orphanOn: 'sonnet' });
    for (const l of both()) expect(effortFlags(l), 'the class served is opus: sonnet\'s orphan is not its').toEqual([]);
    // control: the same files with the orphan on the served class carry it
    plantAliases({ orphan: 'xhigh' });
    for (const l of both()) expect(effortFlags(l)).toEqual(['xhigh']);
  });

  it('a record level wins over an orphan', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort medium');
    plantAliases({ orphan: 'xhigh' });
    for (const l of both()) expect(effortFlags(l)).toEqual(['medium']);
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus effort=medium');
    h.sh('_reg_set myid effort auto');
    for (const l of both()) expect(effortFlags(l), 'control: the same orphan is carried once the record says auto').toEqual(['xhigh']);
  });

  it('SPAWN_EFFORT wins over an orphan when the record has no effort', () => {
    seed('myid'); h.sh('_reg_set myid class opus');
    plantAliases({ orphan: 'xhigh' });
    for (const l of both()) expect(effortFlags(l)).toEqual(['high']);
    // and with no record at all
    h.sh('rm -f "$REG/myid.class"');
    for (const l of both()) expect(effortFlags(l)).toEqual(['high']);
    h.sh('_reg_set myid class opus; _reg_set myid effort auto');
    for (const l of both()) expect(effortFlags(l), 'control: the same orphan is carried once the record says auto').toEqual(['xhigh']);
  });

  it('an id move changes no composed effort', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort high');
    plantAliases({ id: 'claude-opus-9-1' });
    const before = both();
    const stampBefore = h.reg('myid', 'routeapplied');
    // the alias moves on, and the home's saved level is now orphaned: the same record composes the same argv
    plantAliases({ id: 'claude-opus-9-2', orphan: 'low' });
    const after = both();
    expect(after).toEqual(before);
    expect(h.reg('myid', 'routeapplied')).toBe(stampBefore);
    expect(effortFlags(after[0]!)).toEqual(['high']);
    // the box default rides unchanged across the move too (a record with no effort)
    h.sh('rm -f "$REG/myid.effort"');
    plantAliases({ id: 'claude-opus-9-1' });
    const dBefore = both();
    plantAliases({ id: 'claude-opus-9-2', orphan: 'low' });
    expect(both()).toEqual(dBefore);
    h.sh('_reg_set myid effort auto');
    expect(effortFlags(both()[0]!), 'control: under auto the same move DOES surface the orphan, which is the carry and nothing else').toEqual(['low']);
  });

  it('a level the current id does not list is not carried, and nothing is said', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort auto');
    plantAliases({ orphan: 'max', efforts: ['low', 'high'] });   // a level the row does not offer would not be a launch Claude Code accepts
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    plantAliases({ orphan: 'high', efforts: ['low', 'high'] });
    for (const l of both()) expect(effortFlags(l), 'control: a listed level is carried').toEqual(['high']);
    plantAliases({ orphan: 'high', efforts: null });   // a row with no effort field cannot rule it out
    for (const l of both()) expect(effortFlags(l)).toEqual(['high']);
    plantAliases({ orphan: 'high', efforts: [] });   // a model that takes none takes no carried level either
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    expect(swapLog()).not.toMatch(/route-refuse/);
  });

  it('a Codex lane and a lane with no class carry nothing', () => {
    twoLanes();
    plantAliases({ orphan: 'xhigh' });
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort auto');
    fs.copyFileSync(path.join(modelsDir(), 'claude.aliases.json'), path.join(modelsDir(), 'lane-a.aliases.json'));
    for (const l of both()) expect(effortFlags(l)).toEqual([]);
    seed('myid'); h.sh('rm -f "$REG/myid.class"; _reg_set myid effort auto');
    for (const l of both()) expect(effortFlags(l), 'auto with no class served: no class to carry for').toEqual([]);
    h.sh('_reg_set myid class opus');
    for (const l of both()) expect(effortFlags(l), 'control: the Anthropic lane, same file, with a class').toEqual(['xhigh']);
  });
});
