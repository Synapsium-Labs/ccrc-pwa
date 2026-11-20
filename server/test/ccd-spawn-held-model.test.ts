// Task A3.4 (model classes, Anthropic arm; D24, spec §2.5.7): a held Anthropic class launches on its held id. `_spawn_start` splices the
// env words `ANTHROPIC_DEFAULT_<CLASS>_MODEL='<held id>'` (one per class of the lane with a `hold.model`, from
// `_held_model_env_to` in ccd/lib/model-aliases.sh) into the env string both spawn lines share, so a fresh launch, a resume, the
// `--session-id` retry and a swap respawn all carry it, and `routeapplied` records it as `held=<class>:<id>[,...]`. A3.0's Step 1 held
// (Claude Code honours the variable for the main session and subagents), so this is the env form, not `--model '<id>'`.
// Fixture HOME only; every model id is invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';
import { seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-held-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const KEY = 'ANTHROPIC_DEFAULT_';
/** `ccd-spawn-effort-argv.test.ts`'s substrate: the `--resume` line leaves no session, so `_spawn_start resume` runs BOTH spawn lines. */
const STUB = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      list-sessions) return 0 ;;
    esac
  };`;
const lines = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const seed = (wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}`);
};
/** `resume` runs the `--resume` line and the `--session-id` retry (two lines); `new` runs one. */
const spawn = (mode: 'new' | 'resume', pre = ''): string[] => {
  fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true });
  h.sh(`${STUB} ${pre} rm -f "$HOME/pane-up"; _spawn_start ${ID} ${mode} 2>/dev/null`);
  return lines();
};
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const heldUnread = (): string[] => swapLog().split('\n').filter((l) => /\bheld-unread\b/.test(l));

const dir = (): string => path.join(h.home, '.ccrc', 'models');
const put = (name: string, text: string): void => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(path.join(dir(), name), text); };
const row = (id: string) => ({ id, label: null, efforts: ['low', 'high'], defaultEffort: null, minVersion: null });
const aliasesText = (): string => {
  const classes: Record<string, unknown> = {};
  for (const c of ['fable', 'opus', 'sonnet', 'haiku']) {
    classes[c] = { id: `claude-${c}-9-1`, source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: `claude-${c}-9-1`,
      seenId: null, unobserved: false, unlaunchable: null, row: row(`claude-${c}-9-1`), rowFrom: 'own', heldRow: null, orphaned: null };
  }
  return serializeAliases(parseAliases({ v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes }));
};
type Holds = Record<string, string | null>;
const advanceText = (holds: Holds): string => {
  const a = seedAnthropicAdvance() as { classes: Record<string, { hold: unknown }> };
  for (const [cls, model] of Object.entries(holds)) {
    a.classes[cls]!.hold = model === null ? null : { at: '2026-11-02T00:00:00Z', by: 'hand', model };
  }
  return serializeAdvance(a as unknown as Parameters<typeof serializeAdvance>[0]);
};
/** A lane's two files: an aliases file that reads, and an advance file whose classes are held on the given ids. */
const lane = (wrapper: string, holds: Holds): void => {
  put(`${wrapper}.aliases.json`, aliasesText());
  put(`${wrapper}.advance.json`, advanceText(holds));
};
const OPUS_HELD = 'claude-opus-9-2';
const SONNET_HELD = 'claude-sonnet-9-1';

/** Two Anthropic lanes and a Codex lane (`ccd-spawn-effort-argv.test.ts`'s `twoLanes`, with a second Anthropic lane for the swap). */
const roster = (): void => {
  seedAccountsSh(h.home, {
    version: 1, accounts: [
      { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-b', label: 'b', configDirSuffix: '.lane-b', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'anthropic' },
      { id: 'lane-a', label: 'la', configDirSuffix: '.lane-a', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'codex' },
    ],
  });
  for (const w of ['lane-a', 'lane-b']) fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};
/** The env keys a spawn line carries, in order: `[[KEY, id], ...]`. */
const keys = (line: string): string[][] => [...line.matchAll(/(ANTHROPIC_DEFAULT_[A-Z]+_MODEL)='([^']*)'/g)].map((m) => [m[1]!, m[2]!]);
/** Where the env words sit: between `exec env` and the wrapper path (so `env` exports them to the session). */
const envPart = (line: string): string => line.slice(line.indexOf('exec env'), line.search(/\/(?:claude|lane-b)'/));

describe('a held class launches with its id (D24)', () => {
  it('held class launches with its id', () => {
    seed(); roster();
    lane('claude', { opus: OPUS_HELD });
    h.sh(`_reg_set ${ID} class opus`);
    // a fresh launch: one spawn line
    const fresh = spawn('new');
    expect(fresh).toHaveLength(1);
    expect(keys(fresh[0]!)).toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
    expect(envPart(fresh[0]!), 'the key is an env word of `exec env`, ahead of the wrapper').toContain(`${KEY}OPUS_MODEL='${OPUS_HELD}'`);
    expect(fresh[0]).toContain('--model opus');   // the alias stays on the argv: the key makes it resolve to the held id
    // a resume: BOTH spawn lines, the `--resume` line and the `--session-id` retry
    const resumed = spawn('resume');
    expect(resumed).toHaveLength(2);
    for (const l of resumed) expect(keys(l)).toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
    expect(resumed[0]).toContain(`--resume '${UUID}'`);
    expect(resumed[1]).toContain(`--session-id '${UUID}'`);
  });

  it('a held class carries into a swap respawn, on the lane it lands on (and only there)', () => {
    seed(); roster();
    lane('claude', { opus: OPUS_HELD });
    lane('lane-b', { opus: 'claude-opus-9-3' });
    h.sh(`_reg_set ${ID} class opus`);
    for (const l of spawn('resume')) expect(keys(l)).toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
    // the swap re-points the row's wrapper, then respawns with --resume
    h.sh(`_reg_set ${ID} wrapper lane-b`);
    const swapped = spawn('resume');
    expect(swapped).toHaveLength(2);
    for (const l of swapped) expect(keys(l)).toEqual([[`${KEY}OPUS_MODEL`, 'claude-opus-9-3']]);
    // a lane with no hold of its own takes nothing from the one it left
    lane('lane-b', {});
    for (const l of spawn('resume')) expect(keys(l)).toEqual([]);
  });

  it('every held class is held, so a subagent naming another alias runs on its held id too', () => {
    seed(); roster();
    lane('claude', { sonnet: SONNET_HELD, opus: OPUS_HELD });
    h.sh(`_reg_set ${ID} class opus`);
    for (const l of spawn('resume')) {
      expect(keys(l)).toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD], [`${KEY}SONNET_MODEL`, SONNET_HELD]]);   // ROUTE_CLASSES' order
    }
  });

  it('a session with no routing record is held too, and still gets no routeapplied file', () => {
    seed(); roster();
    lane('claude', { opus: OPUS_HELD });
    for (const l of spawn('new')) expect(keys(l)).toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
    // `_route_apply_seed`'s gate is "no stamp": a stamp written for a record-less session would let the first routing write skip its seed
    expect(h.reg(ID, 'routeapplied')).toBeNull();
  });

  it('the launch is recorded in routeapplied as held=<class>:<id>, one word for every held class, and nothing is pending', () => {
    seed(); roster();
    h.sh(`_reg_set ${ID} class opus`);
    lane('claude', { opus: OPUS_HELD });
    spawn('new');
    expect(h.reg(ID, 'routeapplied')).toBe(`class=opus held=opus:${OPUS_HELD}`);
    lane('claude', { sonnet: SONNET_HELD, opus: OPUS_HELD });
    spawn('resume');
    expect(h.reg(ID, 'routeapplied')).toBe(`class=opus held=opus:${OPUS_HELD},sonnet:${SONNET_HELD}`);
    // the routing readers find their own fields by name: the extra word confuses none of them
    expect(h.sh(`_route_applied_get ${ID} class`)).toBe('opus');
    expect(h.sh(`_route_applied_get ${ID} held`)).toBe(`opus:${OPUS_HELD},sonnet:${SONNET_HELD}`);
    expect(h.sh(`_route_apply_pending ${ID}; echo rc=$?`)).toBe('rc=1');
    expect(h.sh(`_route_pending_word ${ID}`)).toBe('');
    // a later write of a field keeps the word, and a re-spawn with no hold drops it
    h.sh(`_route_applied_set ${ID} effort high`);
    expect(h.reg(ID, 'routeapplied')).toContain(`held=opus:${OPUS_HELD}`);
    lane('claude', {});
    spawn('resume');
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
  });
});

describe('only a hold that stands puts a key on a launch', () => {
  it('released class launches on the alias', () => {
    seed(); roster();
    h.sh(`_reg_set ${ID} class opus`);
    lane('claude', { opus: OPUS_HELD });
    for (const l of spawn('resume')) expect(keys(l), 'control: the held class carries its key').toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
    lane('claude', { opus: null });   // a release clears the hold
    for (const l of spawn('resume')) {
      expect(l).not.toContain(KEY);
      expect(l).toContain('--model opus');
    }
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
  });

  it('no hold, no key', () => {
    seed(); roster();
    const fixtures: Array<[string, () => void]> = [
      ['no model files at all', () => {}],
      ['an aliases file, no advance file', () => put('claude.aliases.json', aliasesText())],
      ['an advance file with no hold, no aliases file', () => put('claude.advance.json', advanceText({}))],
      ['both files, every class unheld', () => lane('claude', {})],
      ['both files, a hold released on every class', () => lane('claude', { fable: null, opus: null, sonnet: null, haiku: null })],
    ];
    for (const [name, plant] of fixtures) {
      fs.rmSync(dir(), { recursive: true, force: true });
      plant();
      for (const cls of ['', 'opus', 'haiku']) {
        if (cls) h.sh(`_reg_set ${ID} class ${cls}`);
        for (const mode of ['new', 'resume'] as const) {
          for (const l of spawn(mode)) expect(l, `${name}, class ${cls || '(none)'}, ${mode}`).not.toContain('ANTHROPIC_DEFAULT_');
        }
      }
      expect(h.reg(ID, 'routeapplied')).not.toContain('held=');
    }
    // the control that makes the matrix mean something: the same lane with a hold DOES carry the key
    lane('claude', { haiku: 'claude-haiku-9-1' });
    expect(keys(spawn('new')[0]!)).toEqual([[`${KEY}HAIKU_MODEL`, 'claude-haiku-9-1']]);
  });

  it('a hold is read from the advance file, never from an aliases file alone (an aliases file with no hold, whatever its ids)', () => {
    seed(); roster();
    put('claude.aliases.json', aliasesText());
    put('claude.advance.json', advanceText({ opus: null }));
    expect(spawn('new')[0]).not.toContain(KEY);
  });
});

describe('a file ccd cannot read launches, and says so once', () => {
  it('unreadable advance file launches', () => {
    seed(); roster();
    h.sh(`_reg_set ${ID} class opus`);
    put('claude.aliases.json', aliasesText());
    fs.mkdirSync(path.join(dir(), 'claude.advance.json'));   // a path that is no readable regular file
    const first = spawn('resume');
    expect(first).toHaveLength(2);   // never refuses a launch
    for (const l of first) expect(l).not.toContain(KEY);
    expect(heldUnread(), 'one floored line, written once').toHaveLength(1);
    expect(heldUnread()[0]).toContain(ID);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
    // a second and third spawn inside the floor write no second line
    spawn('resume'); spawn('new');
    expect(heldUnread()).toHaveLength(1);
    // a standing hold elsewhere is not read through it: the lane still launches on the alias
    fs.rmdirSync(path.join(dir(), 'claude.advance.json'));
    put('claude.advance.json', advanceText({ opus: OPUS_HELD }));
    expect(keys(spawn('new')[0]!), 'control: the readable file holds').toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
  });

  it('an advance file that is not valid JSON, and an aliases file that is a directory, launch the same way', () => {
    seed(); roster();
    put('claude.aliases.json', aliasesText());
    put('claude.advance.json', '{ not json');
    for (const l of spawn('resume')) expect(l).not.toContain(KEY);
    expect(heldUnread()).toHaveLength(1);
    fs.rmSync(path.join(h.home, '.cc-sessions', `${ID}.heldunread`));   // the floor marker, so the next line is a new one
    fs.rmSync(path.join(dir(), 'claude.aliases.json'));
    fs.mkdirSync(path.join(dir(), 'claude.aliases.json'));
    for (const l of spawn('resume')) expect(l).not.toContain(KEY);
    expect(heldUnread()).toHaveLength(2);
  });

  it('no file at all is silent: the common case writes no line', () => {
    seed(); roster();
    spawn('resume');
    put('claude.aliases.json', aliasesText());   // an aliases file and no advance file is the same
    spawn('resume');
    expect(heldUnread()).toEqual([]);
  });
});

describe('the lane decides', () => {
  it('a Codex lane never gets the key', () => {
    seed('lane-a'); roster();
    // the same two files that make the Anthropic lane carry a key
    lane('lane-a', { opus: OPUS_HELD });
    lane('claude', { opus: OPUS_HELD });
    h.sh(`_reg_set ${ID} class opus`);
    for (const l of spawn('resume')) expect(l).not.toContain(KEY);
    expect(h.reg(ID, 'routeapplied')).not.toContain('held=');
    expect(heldUnread()).toEqual([]);
    h.sh(`_reg_set ${ID} wrapper claude`);
    for (const l of spawn('resume')) expect(keys(l), 'control: the Anthropic lane, same files').toEqual([[`${KEY}OPUS_MODEL`, OPUS_HELD]]);
  });
});

describe('the id is checked', () => {
  it('an id outside the id regex is refused by the reader and never spliced', () => {
    seed(); roster();
    h.sh(`_reg_set ${ID} class opus`);
    put('claude.aliases.json', aliasesText());
    const hostile = ["x';touch pwned;'", 'claude-opus-9-2 --model other', 'a$(touch pwned)', 'a`touch pwned`', '-claude-opus-9-2', ' claude-opus-9-2', `claude-opus-9-2\n`, 'x'.repeat(129), ''];
    for (const model of hostile) {
      const a = JSON.parse(advanceText({}));
      a.classes.opus.hold = { at: '2026-11-02T00:00:00Z', by: 'hand', model };
      put('claude.advance.json', `${JSON.stringify(a)}\n`);
      for (const l of spawn('resume')) {
        expect(l, `hold.model ${JSON.stringify(model)}`).not.toContain(KEY);
        expect(l).not.toContain('touch');
      }
      expect(fs.existsSync(path.join(h.home, 'pwned')), 'nothing was run').toBe(false);
      fs.rmSync(path.join(h.home, '.cc-sessions', `${ID}.heldunread`), { force: true });
    }
    // the reader names it: a refused id is the one `held-unread` line, not a silent miss
    const a = JSON.parse(advanceText({}));
    a.classes.opus.hold = { at: '2026-11-02T00:00:00Z', by: 'hand', model: "x';touch pwned;'" };
    put('claude.advance.json', `${JSON.stringify(a)}\n`);
    spawn('resume');
    expect(heldUnread().length).toBeGreaterThan(0);
    // control: a well-formed id in the same file shape is spliced, quoted
    a.classes.opus.hold.model = 'claude-opus-9-2:thinking/v1.0_x';
    put('claude.advance.json', `${JSON.stringify(a)}\n`);
    expect(keys(spawn('new')[0]!)).toEqual([[`${KEY}OPUS_MODEL`, 'claude-opus-9-2:thinking/v1.0_x']]);
  });
});
