// Task A3.6, the half that records (model classes, Anthropic arm; spec 2026-10-13 §2.5.6): `routeapplied` carries `model=<bare id>`, the
// id the session's own reading last named, on every lane. It is RECORDED, never typed: by the supervise tick's own step `_alias_observe`
// (outside `_route_apply_check`'s gate) and by `_route_readback` when it confirms a class from a fresh reading. It is written with `keep`
// (`_route_applied_set`'s fourth argument), which leaves the stamp (`routeapplied`'s mtime) where it was. A class change drops it, a
// spawn's settle writes a list without it, and nothing here creates `routeapplied` or types a model (the coordinator's ruling on A3.0
// Step 3's fallback: an id change is recorded, never typed). Fixture HOME only; every model id is invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { CCD, ghContainedEnv, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-model-id-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const OTHER_UUID = 'cafef00d-0000-4000-8000-000000000000';
const nowS = (): number => Math.floor(Date.now() / 1000);
const S = nowS() - 600;   // the stamp: routeapplied's mtime
const REG = (f: string): string => path.join(h.home, '.cc-sessions', f);
const RA = (): string => REG(`${ID}.routeapplied`);
const ra = (): string | null => (fs.existsSync(RA()) ? fs.readFileSync(RA(), 'utf8') : null);
const raMtime = (): number => fs.statSync(RA()).mtimeMs;
const usageFile = (): string => REG(`usage/${ID}.json`);

const seed = (wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} class opus
        _reg_set ${ID} effort xhigh`);
};
/** `routeapplied` as a settle wrote it, its mtime the stamp. */
const plantRA = (text = 'class=opus effort=xhigh', mtime = S): void => {
  fs.writeFileSync(RA(), text);
  fs.utimesSync(RA(), mtime, mtime);
};
const setBorn = (epoch: number): void => { fs.writeFileSync(path.join(h.home, 'born'), `${epoch}\n`); };
const sidecar = (ts: number, model: string, uuid = UUID, mtime = ts + 20): void => {
  fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
  fs.writeFileSync(usageFile(), `${JSON.stringify({ ts, uuid, account: 'acct-a', model, effort: 'xhigh', ctxPct: 12, cost: 0.5, agent: null })}\n`);
  fs.utimesSync(usageFile(), mtime, mtime);
};

/** Every tmux call is recorded; `_pane_born`'s one query answers `$HOME/born`; the pane is idle and measurable. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/tmux-calls"
    case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
    case "$1" in
      display-message) [[ -f "$HOME/born" ]] && cat "$HOME/born"; return 0 ;;
      capture-pane)    cat "$HOME/pane.txt" 2>/dev/null ;;
      list-panes)      echo 4242 ;;
      new-session)     : > "$HOME/pane-up" ;;
      has-session)     [[ -e "$HOME/pane-up" ]] ;;
    esac; return 0
  };`;
const keys = (): string[] => {
  const f = path.join(h.home, 'tmux-calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('tmux send-keys')) : [];
};
const observe = (n = 1, pre = ''): void => { h.sh(`${TMUX} ${pre} for _ in $(seq ${n}); do _alias_observe ${ID}; done`); };
const reads = (): number => {
  const f = path.join(h.home, 'usc-count');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
};
/** Counts every `_usage_sidecar_read`, the forking reader, by wrapping ccd's own. */
const COUNT_READS = `eval "_usc_real() $(declare -f _usage_sidecar_read | tail -n +2)"
  _usage_sidecar_read() { echo x >> "$HOME/usc-count"; _usc_real "$@"; };`;

describe('recording model=', () => {
  beforeEach(() => { seed(); });

  it('model is recorded with nothing pending', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    expect(h.sh(`_route_apply_pending ${ID}; echo $?`), 'nothing is pending: the applier returns at its gate 1').toBe('1');
    const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; ${TMUX}
      systemctl() { :; }; cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }
      _auto_swap_check() { :; }; _auto_compact_check() { :; }
      n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL=""; if (( n <= 3 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
      cmd_supervise ${ID}`], {
      encoding: 'utf8', cwd: h.home, timeout: 20000,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    });
    expect(r.stderr).toContain('ended; exiting for systemd restart');
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
    expect(keys()).toEqual([]);
  });

  it('model is recorded again after a spawn', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    observe();
    expect(ra(), 'control: recorded before the spawn').toContain('model=claude-opus-9-1');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(ra(), 'the settle writes a whole new list without it').not.toContain('model=');
    sidecar(nowS() + 100, 'claude-opus-9-2');   // a reading after the settle's stamp
    observe();
    expect(ra()).toContain('model=claude-opus-9-2');
  });

  it('a reading in the stamp\'s own second is not recorded', () => {
    plantRA(); setBorn(S - 50); sidecar(S, 'claude-opus-9-1', UUID, S + 20);
    observe();
    expect(ra()).toBe('class=opus effort=xhigh');
    sidecar(S + 1, 'claude-opus-9-1', UUID, S + 40);   // control: one second later is later
    observe();
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
  });

  it('a reading before the stamp is not recorded', () => {
    plantRA(); setBorn(S - 50); sidecar(S - 5, 'claude-opus-9-1', UUID, S + 20);
    observe();
    expect(ra()).toBe('class=opus effort=xhigh');
    sidecar(S + 100, 'claude-opus-9-1', UUID, S + 140);
    observe();
    expect(ra(), 'control: a reading after the stamp records').toContain('model=claude-opus-9-1');
  });

  it('a reading no later than the process start is not recorded', () => {
    plantRA(); setBorn(S + 200); sidecar(S + 100, 'claude-opus-9-1');
    observe();
    expect(ra()).toBe('class=opus effort=xhigh');
    sidecar(S + 201, 'claude-opus-9-1', UUID, S + 240);
    observe();
    expect(ra()).toContain('model=claude-opus-9-1');
  });

  it('another uuid is not recorded', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1', OTHER_UUID);
    observe();
    expect(ra()).toBe('class=opus effort=xhigh');
    sidecar(S + 100, 'claude-opus-9-1', UUID, S + 140);
    observe();
    expect(ra()).toContain('model=claude-opus-9-1');
  });

  it('a 1M reading records the bare id', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1[1m]');
    observe();
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
  });

  it('a recorded model is never rewritten by a later reading', () => {
    plantRA('class=opus effort=xhigh model=claude-opus-9-1'); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-2');
    observe();
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
  });

  it('a class change drops model and picked, and the next fresh reading records model again', () => {
    const planted = 'class=opus effort=xhigh model=claude-opus-9-1 picked=claude-opus-9-2 held=opus:claude-opus-9-2';
    setBorn(S - 50);
    // the applier's class arm
    plantRA(planted);
    h.sh(`_reg_set ${ID} class sonnet; _route_type_model() { return 0; }; _route_apply_now ${ID}`);
    expect(ra(), 'the applier\'s class arm').toBe('effort=xhigh held=opus:claude-opus-9-2 class=sonnet');
    sidecar(nowS() + 200, 'claude-sonnet-9-1');
    observe();
    expect(ra()).toBe('effort=xhigh held=opus:claude-opus-9-2 class=sonnet model=claude-sonnet-9-1');
    // the class readback
    plantRA(planted);
    fs.rmSync(usageFile());
    h.sh(`_reg_set ${ID} class haiku`);
    sidecar(nowS() - 10, 'claude-haiku-9-1', UUID, nowS() - 5);
    expect(h.sh(`${TMUX} _route_readback ${ID}; echo $?`)).toBe('0');
    expect(ra(), 'the class readback').toBe('effort=xhigh held=opus:claude-opus-9-2 class=haiku model=claude-haiku-9-1');   // the readback records the reading's own id (below)
    // a write of the SAME class keeps both
    plantRA(planted);
    h.sh(`_route_applied_set ${ID} class opus`);
    expect(ra()).toContain('model=claude-opus-9-1');
    expect(ra()).toContain('picked=claude-opus-9-2');
    h.sh(`_route_applied_set ${ID} class sonnet`);
    expect(ra(), 'the one writer drops both on a different class').toBe('effort=xhigh held=opus:claude-opus-9-2 class=sonnet');
  });

  it('no routeapplied, no model', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    observe();
    expect(ra(), 'control: the same fixture records when the file stands').toContain('model=');
    fs.rmSync(RA());
    observe();
    expect(fs.existsSync(RA()), 'the file is never created').toBe(false);
  });

  it('the model= write keeps the stamp', () => {
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    const before = raMtime();
    observe();
    expect(ra()).toContain('model=claude-opus-9-1');
    expect(raMtime(), 'mtime unchanged').toBe(before);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((f) => f.endsWith('.tmp')), 'no temp file left').toEqual([]);
    h.sh(`_route_applied_set ${ID} effort high`);   // control: any other write moves it
    expect(raMtime()).toBeGreaterThan(before);
  });

  it('a marker judged on the same bytes does not stop the recording, nor the recording the marker', () => {
    // A: the marker cannot fill (its born epoch equals the reading's), the recording can.
    fs.writeFileSync(REG(`${ID}.aliaslaunch`), `${S + 100} claude opus -\n`); fs.utimesSync(REG(`${ID}.aliaslaunch`), S, S);
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    observe(2);
    expect(fs.readFileSync(REG(`${ID}.aliaslaunch`), 'utf8').trim()).toBe(`${S + 100} claude opus -`);
    expect(ra()).toContain('model=claude-opus-9-1');
    // B: the recording cannot (the reading is the stamp's own second), the marker can.
    fs.writeFileSync(REG(`${ID}.aliaslaunch`), `${S - 100} claude opus -\n`); fs.utimesSync(REG(`${ID}.aliaslaunch`), S - 100, S - 100);
    plantRA(); sidecar(S, 'claude-opus-9-1', UUID, S + 20);
    const tp = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(tp), { recursive: true });
    fs.writeFileSync(tp, `${JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: new Date((S - 10) * 1000).toISOString(), message: { model: 'claude-opus-9-1', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] } })}\n`);
    observe(2);
    expect(ra(), 'not recorded: the reading is in the stamp\'s own second').toBe('class=opus effort=xhigh');
    expect(fs.readFileSync(REG(`${ID}.aliaslaunch`), 'utf8').trim(), 'the marker is filled from the same bytes').toBe(`${S - 100} claude opus claude-opus-9-1`);
  });

  it('an unchanged sidecar is read once for the recording, a changed one again', () => {
    plantRA(); setBorn(S - 50); sidecar(S - 5, 'claude-opus-9-1', UUID, S + 20);   // judged and not recorded: before the stamp
    // a marker that cannot fill either, so both decisions judge the same bytes
    fs.writeFileSync(REG(`${ID}.aliaslaunch`), `${S + 500} claude opus -\n`); fs.utimesSync(REG(`${ID}.aliaslaunch`), S, S);
    h.sh(`${TMUX} ${COUNT_READS}
      for _ in 1 2 3 4 5; do _alias_observe ${ID}; done
      echo '{"ts":${S - 4},"uuid":"${UUID}","model":"claude-opus-9-1"}' > "$REG/usage/${ID}.json"; touch -d @${S + 30} "$REG/usage/${ID}.json"
      for _ in 1 2 3 4 5; do _alias_observe ${ID}; done`);
    // one read per decision per distinct bytes: two decisions, two byte states (the marker's own read is A3.2's)
    expect(reads()).toBe(4);
    expect(ra()).toBe('class=opus effort=xhigh');
  });

  it('the observe step forks nothing once recorded, and nothing with no routeapplied', () => {
    const trace = (): { pids: Set<string>; err: string; rc: string } => {
      const out = h.sh(`exec 9>"$HOME/xt"; BASH_XTRACEFD=9; PS4='@\${BASHPID}@ '
        me=$BASHPID; export PATH=/nonexistent
        set -x; _alias_observe ${ID} 2>"$HOME/err"; rc=$?; set +x
        printf '%s %s' "$me" "$rc"`);
      const [me, rc] = out.split(' ');
      const pids = new Set((fs.readFileSync(path.join(h.home, 'xt'), 'utf8').match(/^@+(\d+)@/gm) ?? []).map((m) => m.replace(/@/g, '')));
      pids.delete(me!);
      return { pids, err: fs.existsSync(path.join(h.home, 'err')) ? fs.readFileSync(path.join(h.home, 'err'), 'utf8') : '', rc: rc! };
    };
    const none = trace();
    expect(none.rc).toBe('0'); expect(none.err).toBe(''); expect([...none.pids]).toEqual([]);
    plantRA('class=opus effort=xhigh model=claude-opus-9-1'); sidecar(S + 400, 'claude-opus-9-2', UUID, S + 400);
    const recorded = trace();
    expect(recorded.rc).toBe('0'); expect(recorded.err).toBe(''); expect([...recorded.pids]).toEqual([]);
    // the sidecar no newer than the record: still builtins only
    plantRA('class=opus effort=xhigh'); sidecar(S + 400, 'claude-opus-9-2', UUID, S - 10);
    const older = trace();
    expect(older.rc).toBe('0'); expect([...older.pids]).toEqual([]);
    // CONTROL: the same fixture with a newer sidecar and no model does fork (the reader), so the trace can see a fork
    sidecar(S + 400, 'claude-opus-9-2', UUID, S + 400);
    expect([...trace().pids].length, 'the trace sees the reader\'s fork').toBeGreaterThan(0);
  });

  it('a Codex lane records model too', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    h.sh(`_reg_set ${ID} wrapper gpt`);
    plantRA(); setBorn(S - 50); sidecar(S + 100, 'gpt-9-codex');
    observe();
    expect(ra()).toBe('class=opus effort=xhigh model=gpt-9-codex');
  });
});

// ── what the new keys must not disturb ──────────────────────────────────────────────────────────────────────────────────
// REVIEW 2964 F13c (with F12): `keep` never creates the record. A write that keeps the stamp has no stamp to keep when there is no file, so it answers 1
// and writes nothing (every caller checks first; this pins the writer, which is where the promise is made).
describe('_route_applied_put with keep creates nothing', () => {
  beforeEach(() => { seed(); });
  it('keep and no routeapplied: rc 1 and no file', () => {
    expect(h.sh(`_route_applied_put ${ID} 'class=opus model=claude-opus-9-1' keep; echo rc=$?`)).toBe('rc=1');
    expect(ra()).toBeNull();
    expect(h.sh(`_route_applied_set ${ID} model claude-opus-9-1 keep; echo rc=$?`)).toBe('rc=1');
    expect(ra()).toBeNull();
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // the control: the same write without keep is `_reg_set`'s and creates the record, and with a record `keep` keeps its stamp
    expect(h.sh(`_route_applied_put ${ID} 'class=opus'; echo rc=$?`)).toBe('rc=0');
    expect(ra()).toBe('class=opus');
    plantRA();
    const before = raMtime();
    expect(h.sh(`_route_applied_put ${ID} 'class=opus effort=xhigh model=claude-opus-9-1' keep; echo rc=$?`)).toBe('rc=0');
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
    expect(raMtime()).toBe(before);
  });
});

describe('model=, picked= and held= in the record', () => {
  beforeEach(() => { seed(); });

  it('never read as pending, and a pending class is still found beside them', () => {
    plantRA('class=opus effort=xhigh model=claude-opus-9-1 picked=claude-opus-9-2 held=opus:claude-opus-9-2');
    expect(h.sh(`_route_apply_pending ${ID}; echo $?`)).toBe('1');
    expect(h.sh(`_route_readback ${ID}; echo $?`), 'nothing pending: the readback has nothing to confirm').toBe('1');
    h.sh(`_reg_set ${ID} class sonnet`);
    expect(h.sh(`_route_apply_pending ${ID}; echo $?`)).toBe('0');
    expect(h.sh(`_route_pending_word ${ID}`)).toBe('class=sonnet');
  });
});

// ── the readback by id ──────────────────────────────────────────────────────────────────────────────────────────────────
// The case of a class confirmed by the TRANSCRIPT's acknowledgement (no reading named an id, so no `model=`) is pinned where its
// fixture lives: `ccd-route-apply.test.ts`, "the project-k shape", plants a stale reading that carries a model beside the
// acknowledgement and expects `routeapplied` to read exactly `class=opus` (review 2964 F11a: the placeholder that stood here
// planted neither a transcript nor a sidecar, so `_route_readback` returned before the acknowledgement path).
describe('the readback records the id it read', () => {
  beforeEach(() => { seed(); h.sh(`_reg_set ${ID} class sonnet`); setBorn(S - 50); });

  it('the readback confirms by id', () => {
    plantRA('class=opus effort=xhigh');
    sidecar(nowS() - 10, 'claude-sonnet-9-1', UUID, nowS() - 5);
    expect(h.sh(`${TMUX} _route_readback ${ID}; echo $?`)).toBe('0');
    expect(ra()).toBe('effort=xhigh class=sonnet model=claude-sonnet-9-1');
    expect(raMtime(), 'the class write moved the stamp off the planted one').toBeGreaterThan(S * 1000);
  });

  it('the model= write after the class write does not move the stamp', () => {
    plantRA('class=opus effort=xhigh');
    sidecar(nowS() - 10, 'claude-sonnet-9-1', UUID, nowS() - 5);
    // a clock the test controls: the class write lands, then the model= write; the stamp after both is the class write's
    const out = h.sh(`${TMUX}
      eval "_ras_real() $(declare -f _route_applied_set | tail -n +2)"
      _route_applied_set() { _ras_real "$@"; [[ "$2" == class ]] && { touch -d @${S + 300} "$REG/$1.routeapplied"; }; return 0; }
      _route_readback ${ID}; echo $?; _plat_mtime "$REG/${ID}.routeapplied"`);
    expect(out.split('\n')).toEqual(['0', String(S + 300)]);
    expect(ra()).toContain('model=claude-sonnet-9-1');
  });

  it('a [1m] reading of the wanted class records the bare id', () => {
    plantRA('class=opus effort=xhigh');
    sidecar(nowS() - 10, 'claude-sonnet-9-1[1m]', UUID, nowS() - 5);
    expect(h.sh(`${TMUX} _route_readback ${ID}; echo $?`)).toBe('0');
    expect(ra()).toBe('effort=xhigh class=sonnet model=claude-sonnet-9-1');
  });
});

// ── an id change is recorded, never typed ───────────────────────────────────────────────────────────────────────────────
const row = (id: string) => ({ id, label: null, efforts: ['low', 'high', 'xhigh'], defaultEffort: null, minVersion: null });
const aliasesFor = (id: string, seenId: string | null): string => {
  const classes: Record<string, unknown> = {};
  for (const c of ['fable', 'opus', 'sonnet', 'haiku']) {
    classes[c] = { id, source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: id,
      seenId, unobserved: false, unlaunchable: null, row: row(id), rowFrom: 'own', heldRow: null, orphaned: null };
  }
  return serializeAliases(parseAliases({ v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes }));
};
const putAliases = (text: string): void => {
  const dir = path.join(h.home, '.ccrc', 'models');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude.aliases.json'), text);
};
const IDLE = `${'─'.repeat(40)}\n❯ \n${'─'.repeat(40)}\n  👤 acct-a │ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 20% │ 💲 1.0\n`;

describe('an id change is recorded, never typed', () => {
  beforeEach(() => {
    seed();
    const dir = path.join(h.sh('_cfg_dir claude').trim(), 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
    fs.writeFileSync(path.join(h.home, 'pane.txt'), IDLE);
  });

  it('five ticks type nothing, nothing is pending, and model stays the old id; a respawn then records the new one', () => {
    plantRA('class=opus effort=xhigh model=claude-opus-9-1'); setBorn(S - 50);
    putAliases(aliasesFor('claude-opus-9-2', 'claude-opus-9-2'));   // the class moved, and a fresh launch has reported the new id: `seen`
    expect(h.sh(`_alias_facts_to f claude opus; printf '%s' "$f"`), 'control: the facts name X2 as seen').toBe('facts claude-opus-9-2 low,high,xhigh - - seen');
    sidecar(S + 100, 'claude-opus-9-1');   // the session keeps reporting the old id
    h.sh(`${TMUX} for _ in 1 2 3 4 5; do _route_apply_check ${ID}; _alias_observe ${ID}; done`);
    expect(keys(), 'nothing was sent to the pane').toEqual([]);
    expect(h.sh(`_route_apply_pending ${ID}; echo $?`), 'nothing is pending').toBe('1');
    expect(h.reg(ID, 'routetries') ?? '').toBe('');
    expect(ra()).toBe('class=opus effort=xhigh model=claude-opus-9-1');
    // a respawn: a fresh routeapplied without model, and a fresh reading of the new id
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(ra()).not.toContain('model=');
    sidecar(nowS() + 100, 'claude-opus-9-2');
    observe();
    expect(ra()).toContain('model=claude-opus-9-2');
  });
});

describe('the tick reads no file twice', () => {
  it('the tick forks no jq on an unchanged file', () => {
    seed();
    putAliases(aliasesFor('claude-opus-9-1', 'claude-opus-9-1'));
    plantRA('class=opus effort=xhigh model=claude-opus-9-1'); setBorn(S - 50); sidecar(S + 100, 'claude-opus-9-1');
    const out = h.sh(`${TMUX} jq() { echo x >> "$HOME/jq-count"; command jq "$@"; }
      _route_apply_check ${ID}; _alias_observe ${ID}; _alias_facts_to f claude opus
      one=$(wc -l < "$HOME/jq-count" 2>/dev/null || echo 0)
      for _ in 1 2 3 4 5; do _route_apply_check ${ID}; _alias_observe ${ID}; _alias_facts_to f claude opus; done
      all=$(wc -l < "$HOME/jq-count" 2>/dev/null || echo 0)
      echo "$one $all"`).trim().split(/\s+/).map(Number);
    expect(out[0], 'control: the first tick\'s facts read did fork the jq').toBe(1);
    expect(out[1], 'five more ticks of the same shell fork no jq').toBe(out[0]);
  });
});
