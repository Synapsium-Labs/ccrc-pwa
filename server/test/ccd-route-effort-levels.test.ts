// Task A3.3 (model classes, Anthropic arm, D-8750): "a class whose model lists no effort levels takes none".
//
// The haiku rule (a class that takes no effort level) used to be spelled `class == haiku` at five sites of ccd/ccd. It is now
// asked of the lane's own files first (`_class_takes_no_effort`, ccd/lib/model-aliases.sh): an Anthropic lane's aliases file
// says whether the class's current model lists effort levels, a Codex lane's catalogue says it for its pinned model. A lane
// whose files cannot say (no file, an unreadable or invalid one, a row with no effort field, a Codex empty list, no lane)
// keeps today's rule, so data only ever relaxes it on a Codex lane. The five sites, each measured on its own below:
// `cmd_route`, `_route_argv_check` (which also takes the lane from its two callers, apart from the user's pairs: `ROUTE_ARGV_LANE`), `_route_seed_default`,
// `_route_effort_for_to` and `_spawn_start`. Fixture HOME only; every id is invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD_REAL_SPAWN, ghContainedEnv, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';
import { seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-route-effort-');
  h.makeRepo('demo');
  seedAccountsSh(h.home, { version: 1, accounts: [
    { id: 'claude', label: 'AN', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-a', label: 'LA', configDirSuffix: '.lane-a', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
  ] });
  fs.writeFileSync(path.join(h.home, '.local', 'bin', 'lane-a'), '#!/bin/sh\n', { mode: 0o755 });
});
afterEach(() => { h.cleanup(); });

const ANTHROPIC = 'claude';
const CODEX = 'lane-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const modelsDir = (): string => path.join(h.home, '.ccrc', 'models');
const put = (name: string, text: string): void => {
  fs.mkdirSync(modelsDir(), { recursive: true });
  fs.writeFileSync(path.join(modelsDir(), name), text);
};
const unplant = (name: string): void => { fs.rmSync(path.join(modelsDir(), name), { force: true }); };

const row = (id: string, efforts: string[] | null) => ({ id, label: null, efforts, defaultEffort: null, minVersion: null });
const entry = (id: string, efforts: string[] | null) => ({
  id, source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: id, seenId: null, unobserved: false,
  unlaunchable: null, row: row(id, efforts), rowFrom: 'own', heldRow: null, orphaned: null,
});
/** The Anthropic lane's aliases file, every class listing `efforts` for its model (`claude-<class>-9-1`). */
const plantAliases = (efforts: string[] | null, over: Record<string, string[] | null> = {}): void => {
  const classes: Record<string, unknown> = {};
  for (const c of ['fable', 'opus', 'sonnet', 'haiku']) classes[c] = entry(`claude-${c}-9-1`, c in over ? over[c]! : efforts);
  put(`${ANTHROPIC}.aliases.json`, serializeAliases(parseAliases({
    v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes,
  })));
};
/** The Codex lane's registry pins `cls` to a catalogue row listing `efforts`. */
const plantCodex = (cls: string, efforts: string[] | null): void => {
  put(`${CODEX}.classes.json`, JSON.stringify({ v: 1, classes: { [cls]: 'gpt-9-1' } }));
  put(`${CODEX}.json`, JSON.stringify({ models: [{ id: 'gpt-9-1', ...(efforts === null ? {} : { efforts }) }] }));
};

/** `h.sh` cannot see a fatal `die` (it throws and gives no status): this runner does, with the fixture HOME and the three
 *  poisons (`ccd-workspaces.test.ts` scans every ccd test file for `ghContainedEnv(` with systemd and tmux). */
const shStatus = (snippet: string): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

let n = 0;
const freshId = (): string => `demo-${++n}`;
const seedRow = (id: string, wrapper: string): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}; _reg_set ${id} workdir '${h.home}'; _reg_set ${id} uuid ${UUID}`);
};

/** What one site did with `<class>` + a level on `<wrapper>`: `refused` (the level was refused or dropped, the haiku-rule
 *  outcome) and the text it said, when it says any. */
interface Verdict { refused: boolean; text: string }
interface Site {
  name: string;
  /** Does this site say a sentence when it refuses? (`_route_seed_default` and `_spawn_start` drop the level silently.) */
  says: boolean;
  probe: (wrapper: string, cls: string) => Verdict;
}

/** A verb that refuses says `takes no effort level` and exits 1; one that accepts exits 0. Any other outcome is a broken probe,
 *  never a "not refused" (a refusal for an unrelated reason must not read as a level taken). */
const verdictOf = (r: { status: number; out: string }): Verdict => {
  const refused = r.status === 1 && /takes no effort level/.test(r.out);
  if (!refused && r.status !== 0) throw new Error(`probe broke (status ${r.status}): ${r.out}`);
  return { refused, text: r.out };
};

const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

const SITES: Site[] = [
  { name: 'cmd_route', says: true, probe: (w, cls) => {
    const id = freshId(); seedRow(id, w);
    const r = shStatus(`cmd_route --session ${id} --set class=${cls} --set effort=high`);
    return verdictOf(r);
  } },
  { name: '_route_argv_check', says: true, probe: (w, cls) => {
    const r = shStatus(`ROUTE_ARGV_LANE=${w} _route_argv_check class=${cls} effort=high`);
    return verdictOf(r);
  } },
  { name: '_route_seed_default', says: false, probe: (w, cls) => {
    const id = freshId(); seedRow(id, w);
    h.sh(`_route_seed_default ${id} ${w} class=${cls}`);   // the coordinator row carries effort=high unless the pair is barred
    return { refused: h.reg(id, 'effort') === null, text: '' };
  } },
  { name: '_route_effort_for_to', says: true, probe: (w, cls) => {
    const id = freshId(); seedRow(id, w);
    h.sh(`_reg_set ${id} effort high`);
    const got = h.sh(`_route_effort_for_to v ${id} ${cls}; printf %s "$v"`);
    return { refused: got === '', text: swapLog() };
  } },
  { name: '_spawn_start', says: false, probe: (w, cls) => {
    const id = freshId(); seedRow(id, w);
    h.sh(`_reg_set ${id} class ${cls}`);
    fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true });
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);   // no effort field: SPAWN_EFFORT's default rides the argv
    const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
    expect(lines.length).toBeGreaterThan(0);
    return { refused: !lines.some((l) => /--effort high/.test(l)), text: '' };
  } },
];

const refuses = (s: Site, w: string, cls: string): boolean => s.probe(w, cls).refused;

describe.each(SITES)('$name', (site) => {
  it('an Anthropic class that takes none refuses a level', () => {
    plantAliases(['low', 'high'], { opus: [] });
    expect(refuses(site, ANTHROPIC, 'opus')).toBe(true);
    // the same class, the same lane, once its model lists levels: taken (a positive control for the file being read)
    plantAliases(['low', 'high']);
    expect(refuses(site, ANTHROPIC, 'opus')).toBe(false);
  });

  it('an Anthropic class listing levels takes one', () => {
    plantAliases(['low', 'high']);
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(false);   // the data relaxes the haiku rule on an Anthropic lane too
    expect(refuses(site, ANTHROPIC, 'sonnet')).toBe(false);
  });

  it('a Codex haiku class with levels takes one', () => {
    plantCodex('haiku', ['low', 'high']);
    expect(refuses(site, CODEX, 'haiku')).toBe(false);
  });

  it('a Codex empty list keeps the haiku rule', () => {
    plantCodex('haiku', []);
    expect(refuses(site, CODEX, 'haiku')).toBe(true);
    plantCodex('opus', []);   // data never tightens a Codex lane: an empty list for another class is no rule (it is not `none`)
    expect(refuses(site, CODEX, 'opus')).toBe(false);
    plantCodex('haiku', ['low']);   // a catalogue that now lists levels relaxes it (the positive control: the data is read at all)
    expect(refuses(site, CODEX, 'haiku')).toBe(false);
  });

  it('no file keeps the haiku rule', () => {
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(true);
    expect(refuses(site, ANTHROPIC, 'opus')).toBe(false);
    expect(refuses(site, CODEX, 'haiku')).toBe(true);
    expect(refuses(site, CODEX, 'opus')).toBe(false);
    plantAliases(['low']);   // control: a file present changes the answer ...
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(false);
    unplant(`${ANTHROPIC}.aliases.json`);   // ... and gone it is today's rule again
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(true);
  });

  it('a file that cannot say keeps the haiku rule, whatever the class', () => {
    put(`${ANTHROPIC}.aliases.json`, '{ not json');
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(true);
    expect(refuses(site, ANTHROPIC, 'opus')).toBe(false);
    plantAliases(null);   // a row with no effort field: the files cannot say
    expect(refuses(site, ANTHROPIC, 'haiku')).toBe(true);
    expect(refuses(site, ANTHROPIC, 'opus')).toBe(false);
    put(`${CODEX}.classes.json`, JSON.stringify({ v: 1, classes: { haiku: 'gpt-9-1' } }));
    put(`${CODEX}.json`, '{ not json');
    expect(refuses(site, CODEX, 'haiku')).toBe(true);
  });
});

describe('the refusal names the model, not the class word', () => {
  const sayers = SITES.filter((s) => s.says);
  it.each(sayers)('$name: an Anthropic class that takes none is named by its model id', (site) => {
    plantAliases(['low', 'high'], { opus: [] });
    const v = site.probe(ANTHROPIC, 'opus');
    expect(v.refused).toBe(true);
    expect(v.text).toContain('claude-opus-9-1 takes no effort level');
    expect(v.text).not.toContain('class opus');
  });
  it.each(sayers)('$name: the standing haiku rule still says the class word', (site) => {
    const v = site.probe(ANTHROPIC, 'haiku');
    expect(v.refused).toBe(true);
    expect(v.text).toContain('class haiku takes no effort level');
  });
});

describe('a held class is judged on the held row, and the refusal names the held id (review 2964 F13a)', () => {
  const HELD = 'claude-opus-9-0';
  /** opus is held on `HELD`, whose row lists `heldEfforts`; the alias's current row (`claude-opus-9-1`) lists `curEfforts`. */
  const plantHeld = (curEfforts: string[], heldEfforts: string[]): void => {
    const classes: Record<string, unknown> = {};
    for (const c of ['fable', 'opus', 'sonnet', 'haiku']) classes[c] = entry(`claude-${c}-9-1`, ['low', 'high']);
    classes.opus = { ...entry('claude-opus-9-1', curEfforts), heldRow: row(HELD, heldEfforts) };
    put(`${ANTHROPIC}.aliases.json`, serializeAliases(parseAliases({
      v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes,
    })));
    const adv = seedAnthropicAdvance() as { classes: Record<string, { hold: unknown }> };
    adv.classes.opus!.hold = { at: '2026-11-02T00:00:00Z', by: 'hand', model: HELD };
    put(`${ANTHROPIC}.advance.json`, serializeAdvance(adv as unknown as Parameters<typeof serializeAdvance>[0]));
  };
  const sayers = SITES.filter((s) => s.says);
  it.each(sayers)('$name: a held row that takes none names the held id, not the alias\'s current one', (site) => {
    plantHeld(['low', 'high'], []);
    const v = site.probe(ANTHROPIC, 'opus');
    expect(v.refused).toBe(true);
    expect(v.text).toContain(`${HELD} takes no effort level`);
    expect(v.text).not.toContain('claude-opus-9-1 takes no effort level');
  });
  it('the decision comes from the held row: levels on the held row take a level though the current row lists none', () => {
    plantHeld([], ['low', 'high']);
    expect(refuses(SITES[0]!, ANTHROPIC, 'opus')).toBe(false);
  });
});

describe('_class_takes_no_effort', () => {
  const ask = (w: string, cls: string): number => {
    const r = shStatus(`_class_takes_no_effort ${w} ${cls}; echo "rc=$?"`);
    return Number(/rc=(\d)/.exec(r.out)![1]);
  };
  it('answers 0 when the model takes none, 1 when it lists levels, 2 when the files cannot say', () => {
    expect(ask(ANTHROPIC, 'opus')).toBe(2);   // no file
    plantAliases(['low'], { opus: [] });
    expect(ask(ANTHROPIC, 'opus')).toBe(0);
    expect(ask(ANTHROPIC, 'sonnet')).toBe(1);
    plantAliases(null);
    expect(ask(ANTHROPIC, 'opus')).toBe(2);   // `-`: no effort field
    expect(ask('nolane', 'opus')).toBe(2);
    expect(ask(ANTHROPIC, 'default')).toBe(2);
  });
  it('never answers 0 on a Codex lane: an empty list is the haiku rule, not data', () => {
    plantCodex('opus', []);
    expect(ask(CODEX, 'opus')).toBe(2);
    plantCodex('opus', ['low', 'high']);
    expect(ask(CODEX, 'opus')).toBe(1);
  });
});

describe('the two callers of _route_argv_check pass the lane they have chosen', () => {
  it('ws-add --wrapper: an Anthropic class that takes none refuses a level before anything is minted, naming the model', () => {
    plantAliases(['low', 'high'], { opus: [] });
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --wrapper ${ANTHROPIC} --route class=opus --route effort=high demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('claude-opus-9-1 takes no effort level');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.uuid'))).toBe(false);
  });
  it('ws-add --wrapper: with no file the haiku rule stands and opus takes a level', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --wrapper ${ANTHROPIC} --route class=haiku --route effort=high demo`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('class haiku takes no effort level');
    // the other branch of the title: opus takes the level (the same call is not refused for it)
    const ok = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=calm-reef cmd_ws_add --no-rc --wrapper ${ANTHROPIC} --route class=opus --route effort=high demo`);
    expect(ok.out).not.toContain('takes no effort level');
    expect(ok.status).toBe(0);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-calm-reef.uuid'))).toBe(true);
  });
  it('start <wrapper> <project>: an Anthropic class that takes none refuses a level before the mint, naming the model', () => {
    plantAliases(['low', 'high'], { opus: [] });
    const r = shStatus(`_spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; }; _ws_supervise() { :; }; _supervised_start() { :; }; tmux() { return 1; };
      cmd_start ${ANTHROPIC} demo --route class=opus --route effort=high`);
    expect(r.status).toBe(1);
    expect(r.out).toContain('claude-opus-9-1 takes no effort level');
  });
  it('without a lane the argv check keeps the haiku rule: data on a lane nobody named is not read', () => {
    plantAliases(['low', 'high'], { opus: [] });
    expect(shStatus('_route_argv_check class=opus effort=high').status).toBe(0);
    const r = shStatus('_route_argv_check class=haiku effort=high');
    expect(r.status).toBe(1);
    expect(r.out).toContain('class haiku takes no effort level');
  });
});

// REVIEW 2964 F2 (the coordinator's decision, D-8855 `route-effort-intent`): a stored class+effort pair that the lane's data now
// bars is FILTERED at spawn with a floored note (`_route_effort_for_to`), never refused on an unrelated write. A call refuses
// the barred pair only when its own sets name `class` or `effort`; the pair it judges is the resulting one. On a Codex lane
// the data can only RELAX the haiku rule (D-8750), and where no lane is known (an unregistered wrapper, an empty one) the
// haiku rule decides.
describe('a barred pair refuses only a call that changes class or effort', () => {
  const regFile = (id: string, f: string): string | null => {
    const p = path.join(h.home, '.cc-sessions', `${id}.${f}`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const standing = (id: string): (string | null)[] => ['class', 'effort', 'workflow'].map((f) => regFile(id, f));

  it('an unknown lane falls back to the haiku rule', () => {
    plantAliases(['low', 'high'], { opus: [] });   // data that would bar opus on the named lane, if the lane were known
    const id = freshId(); seedRow(id, 'nolane');
    const ok = shStatus(`cmd_route --session ${id} --set class=opus --set effort=high`);
    expect(ok.status).toBe(0);
    const bad = shStatus(`cmd_route --session ${id} --set class=haiku --set effort=high`);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('class haiku takes no effort level');
    // and the argv check with no lane named reads no lane's file either
    expect(shStatus('_route_argv_check class=opus effort=high').status).toBe(0);
  });

  it('a level accepted on a lane, then barred by changed lane data, does not refuse an unrelated write', () => {
    plantAliases(['low', 'high']);
    const id = freshId(); seedRow(id, ANTHROPIC);
    expect(shStatus(`cmd_route --session ${id} --set class=opus --set effort=high`).status).toBe(0);
    plantAliases(['low', 'high'], { opus: [] });   // the files change: the class now takes none
    const before = standing(id);
    expect(before.slice(0, 2)).toEqual(['opus', 'high']);
    const r = shStatus(`cmd_route --session ${id} --set workflow=on`);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('takes no effort level');
    expect(standing(id)).toEqual([before[0], before[1], 'on']);   // class and effort are left alone
  });

  it('an explicit class or effort change still refuses a barred pair without writing', () => {
    plantAliases(['low', 'high']);
    const id = freshId(); seedRow(id, ANTHROPIC);
    expect(shStatus(`cmd_route --session ${id} --set class=sonnet --set effort=high`).status).toBe(0);
    plantAliases(['low', 'high'], { opus: [] });
    const before = standing(id);
    const log = swapLog();
    // a class change onto a barred class, with the stored level
    const toClass = shStatus(`cmd_route --session ${id} --set class=opus`);
    expect(toClass.status).toBe(1);
    expect(toClass.out).toContain('claude-opus-9-1 takes no effort level');
    expect(standing(id)).toEqual(before);
    // a level on a stored class that is barred
    h.sh(`_reg_set ${id} class opus`);   // the standing class is now the barred one (data changed under it)
    const stored = standing(id);
    const toEffort = shStatus(`cmd_route --session ${id} --set effort=low`);
    expect(toEffort.status).toBe(1);
    expect(toEffort.out).toContain('claude-opus-9-1 takes no effort level');
    expect(standing(id)).toEqual(stored);
    expect(swapLog()).toBe(log);   // nothing was journalled either
    // `effort=auto` is the absent-equivalent: it is the way out
    expect(shStatus(`cmd_route --session ${id} --set effort=auto`).status).toBe(0);
  });

  it('the spawn filter still drops a barred stored pair, with its note', () => {
    plantAliases(['low', 'high']);
    const id = freshId(); seedRow(id, ANTHROPIC);
    expect(shStatus(`cmd_route --session ${id} --set class=opus --set effort=high`).status).toBe(0);
    plantAliases(['low', 'high'], { opus: [] });
    expect(h.sh(`_route_effort_for_to v ${id} opus; printf %s "$v"`)).toBe('');
    expect(swapLog()).toContain(`route-refuse ${id}: model claude-opus-9-1 takes no effort level — the effort field is ignored`);
  });
});
