// Task A3.2 (model classes, Anthropic arm; D-8744): the launch marker `$REG/<id>.aliaslaunch`, which `_spawn_start` writes for a
// fresh alias launch only (`_alias_launch_mark`), and the supervise tick's own step `_alias_observe`, which fills it once with the
// id the session first reported after its process started (`_alias_launch_fill`, `_alias_fill_overruled`). Fixture HOME only;
// every model id is invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { CCD, ghContainedEnv, makeCcdHarness, seedAccountsSh, ccdSource, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';
import { seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-alias-launch-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const OTHER_UUID = 'cafef00d-0000-4000-8000-000000000000';
const nowS = (): number => Math.floor(Date.now() / 1000);
const MARKER = (): string => path.join(h.home, '.cc-sessions', `${ID}.aliaslaunch`);
const marker = (): string | null => (fs.existsSync(MARKER()) ? fs.readFileSync(MARKER(), 'utf8').trim() : null);

const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}`);
};

// ── the spawn half ──────────────────────────────────────────────────────────────────────────────────────────────────────
const BORN = 1_700_000_000;
/** `ccd-route-spawn.test.ts`'s substrate: every tmux call is recorded, a created session is "up", and `_pane_born`'s one query
 *  (`display-message … #{session_created}`) answers `$HOME/born` when that file exists. */
const SPAWN_STUB = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)     : > "$HOME/pane-up" ;;
      has-session)     [[ -e "$HOME/pane-up" ]] ;;
      display-message) [[ -f "$HOME/born" ]] && cat "$HOME/born"; return 0 ;;
      list-sessions)   return 0 ;;
    esac
  };`;
const spawn = (mode: 'new' | 'resume', pre = ''): void => {
  fs.writeFileSync(path.join(h.home, 'born'), `${BORN}\n`);
  h.sh(`${SPAWN_STUB} ${pre} _spawn_start ${ID} ${mode} 2>/dev/null`);
};
const dir = (): string => path.join(h.home, '.ccrc', 'models');
const put = (name: string, text: string): void => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(path.join(dir(), name), text); };
const row = (id: string) => ({ id, label: null, efforts: ['low', 'high'], defaultEffort: null, minVersion: null });
const aliasesText = (): string => {
  const classes: Record<string, unknown> = {};
  for (const c of ['fable', 'opus', 'sonnet', 'haiku']) {
    classes[c] = { id: 'claude-opus-9-1', source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: 'claude-opus-9-1',
      seenId: null, unobserved: false, unlaunchable: null, row: row('claude-opus-9-1'), rowFrom: 'own', heldRow: null, orphaned: null };
  }
  return serializeAliases(parseAliases({ v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes }));
};
/** A lane whose `cls` is held on `model`, beside an aliases file that reads (a hold is only known through both files). */
const hold = (cls: string): void => {
  put('claude.aliases.json', aliasesText());
  const a = seedAnthropicAdvance() as { classes: Record<string, { hold: unknown }> };
  a.classes[cls]!.hold = { at: '2026-11-02T00:00:00Z', by: 'hand', model: 'claude-opus-9-2' };
  put('claude.advance.json', serializeAdvance(a as unknown as Parameters<typeof serializeAdvance>[0]));
};

/** The CONTROL of every "writes none" case: the same fixture, spawned fresh with nothing in the way, DOES write the marker
 *  (which is then removed), so a case that expects none cannot pass for want of a writer. */
const control = (): void => {
  spawn('new');
  expect(marker(), 'control: a fresh alias launch of this fixture writes a marker').toBe(`${BORN} claude opus -`);
  fs.rmSync(MARKER());
};

describe('the launch marker, written by _spawn_start', () => {
  it('a fresh alias launch writes a marker', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    spawn('new');
    expect(marker()).toBe(`${BORN} claude opus -`);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions')).filter((f) => f.startsWith(`${ID}.aliaslaunch`)), 'written in place: no temp file').toEqual([`${ID}.aliaslaunch`]);
  });

  it('the process start is _pane_born\'s answer, never the .spawn stamp', () => {
    seed(); h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} spawn "1600000000 0"`);
    spawn('new');
    expect(marker()).toBe(`${BORN} claude sonnet -`);
  });

  it('no marker when tmux cannot say when the process started', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    control();
    h.sh(`${SPAWN_STUB} rm -f "$HOME/born"; _spawn_start ${ID} new 2>/dev/null`);
    expect(marker()).toBeNull();
  });

  it('a hold on another class still writes a marker', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    hold('sonnet');
    spawn('new');
    expect(marker()).toBe(`${BORN} claude opus -`);
  });

  it('a resume writes no marker', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    control();
    spawn('resume');
    expect(marker()).toBeNull();
  });

  it('a swap leaves no marker (the old one removed before the new process)', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    fs.writeFileSync(MARKER(), `${BORN - 500} claude opus claude-opus-9-1\n`);
    spawn('resume');
    expect(marker()).toBeNull();
    // and a fresh launch replaces whatever stood, filled or not
    fs.writeFileSync(MARKER(), `${BORN - 500} claude opus claude-opus-9-1\n`);
    spawn('new');
    expect(marker()).toBe(`${BORN} claude opus -`);
  });

  it('a held launch writes no marker (its own class held)', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    control();
    hold('opus');
    spawn('new');
    expect(marker()).toBeNull();
  });

  it('an explicit model writes no marker', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    control();
    spawn('new', '_profile_spawn_compose() { PROFILE_SPAWN_FLAGS="$2 --model claude-opus-9-3"; PROFILE_SPAWN_ENV=""; return 0; };');
    expect(h.calls().filter((c) => c.startsWith('tmux new-session')).join('\n')).toContain('--model opus --');   // control: the class was composed too
    expect(marker()).toBeNull();
  });

  it('class default writes no marker (A3.0\'s launches), and neither does a session with no record', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    control();
    h.sh(`_reg_set ${ID} class default`);
    spawn('new');
    expect(marker()).toBeNull();
    h.sh(`rm -f "$REG/${ID}.class"`);
    spawn('new');
    expect(marker()).toBeNull();
  });

  it('a lane that is not Anthropic writes no marker', () => {
    seed();
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    h.sh(`_reg_set ${ID} class opus`);
    control();
    h.sh(`_reg_set ${ID} wrapper gpt`);
    spawn('new');
    expect(marker()).toBeNull();
  });
});

// ── the tick half ───────────────────────────────────────────────────────────────────────────────────────────────────────
const B = nowS() - 600;   // the process start of the marker below
const usageFile = (): string => path.join(h.home, '.cc-sessions', 'usage', `${ID}.json`);
/** The marker as the spawn wrote it, its mtime at the spawn; the sidecar is newer than it unless a case says otherwise. */
const plant = (id = '-'): void => {
  fs.writeFileSync(MARKER(), `${B} claude opus ${id}\n`);
  fs.utimesSync(MARKER(), B, B);
};
const sidecar = (ts: number, model: string, uuid = UUID, mtime = B + 120): void => {
  fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
  fs.writeFileSync(usageFile(), `${JSON.stringify({ ts, uuid, account: 'acct-a', model, effort: 'xhigh', ctxPct: 12, cost: 0.5, agent: null })}\n`);
  fs.utimesSync(usageFile(), mtime, mtime);
};
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();
const cmd = (at: number, name: string, args = ''): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `c${at}${name}`, timestamp: iso(at),
  message: { role: 'user', content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>` },
});
const ack = (at: number, text: string): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `k${at}`, timestamp: iso(at),
  message: { role: 'user', content: `<local-command-stdout>${text}</local-command-stdout>` },
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-9-1', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
const SESSION = (name: string): string => `Set model to \`${name}\` for this session only`;
const transcriptPath = (): string => h.sh(`_transcript_path ${ID}`);
const writeTranscript = (lines: string[]): void => {
  const p = transcriptPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${lines.join('\n')}\n`);
};
const observe = (n = 1): void => { h.sh(`for _ in $(seq ${n}); do _alias_observe ${ID}; done`); };
const reads = (): number => {
  const f = path.join(h.home, 'usc-count');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
};
/** Counts every `_usage_sidecar_read`, the forking reader, by wrapping ccd's own. */
const COUNT_READS = `eval "_usc_real() $(declare -f _usage_sidecar_read | tail -n +2)"
  _usage_sidecar_read() { echo x >> "$HOME/usc-count"; _usc_real "$@"; };`;

describe('the observe step fills the marker once', () => {
  beforeEach(() => { seed(); h.sh(`_reg_set ${ID} class opus`); });

  it('the first reading fills the id', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1'); writeTranscript([turn(B + 90)]);
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a 1M reading fills the bare id', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1[1m]'); writeTranscript([turn(B + 90)]);
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a typed older id before the first reading drops the marker', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-0');
    writeTranscript([turn(B + 30), cmd(B + 50, 'model', 'claude-opus-9-0'), ack(B + 50, SESSION('Opus 9')), turn(B + 90)]);
    observe();
    expect(marker()).toBeNull();
  });

  it('a /model typed after the reading leaves the marker to fill (the reading is the launch\'s own)', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1');
    writeTranscript([turn(B + 30), turn(B + 90), cmd(B + 300, 'model', 'claude-opus-9-0'), ack(B + 300, SESSION('Opus 9'))]);
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a later typed older id never rewrites it', () => {
    plant('claude-opus-9-1'); sidecar(B + 400, 'claude-opus-9-0', UUID, B + 400);
    writeTranscript([turn(B + 30), cmd(B + 350, 'model', 'claude-opus-9-0'), ack(B + 350, SESSION('Opus 9'))]);
    h.sh(`${COUNT_READS} _alias_observe ${ID}`);
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
    expect(reads(), 'a filled marker reads no sidecar').toBe(0);
  });

  it('an unreadable transcript does not fill, and the next tick asks again', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1');
    observe();   // no transcript at all
    expect(marker()).toBe(`${B} claude opus -`);
    fs.mkdirSync(transcriptPath(), { recursive: true });   // a directory where the file should be
    observe();
    expect(marker()).toBe(`${B} claude opus -`);
    fs.rmSync(transcriptPath(), { recursive: true });
    writeTranscript([turn(B + 90)]);
    observe();
    expect(marker(), 'the same sidecar bytes are judged again while the verdict was undecided').toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a reading before the process start does not fill', () => {
    plant(); sidecar(B - 5, 'claude-opus-9-1'); writeTranscript([turn(B + 90)]);
    observe();
    expect(marker()).toBe(`${B} claude opus -`);
    sidecar(B + 100, 'claude-opus-9-1', UUID, B + 140);   // control: a reading after the start fills
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a reading in the born epoch\'s own second does not fill', () => {
    plant(); sidecar(B, 'claude-opus-9-1'); writeTranscript([turn(B + 90)]);
    observe();
    expect(marker()).toBe(`${B} claude opus -`);
    sidecar(B + 1, 'claude-opus-9-1', UUID, B + 121);
    observe();
    expect(marker(), 'one second later is later').toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('another uuid does not fill', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1', OTHER_UUID); writeTranscript([turn(B + 90)]);
    observe();
    expect(marker()).toBe(`${B} claude opus -`);
    sidecar(B + 100, 'claude-opus-9-1', UUID, B + 140);   // control: the session's own uuid fills
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('a transcript last written before the process start holds nothing newer: the reading fills', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1');
    writeTranscript([turn(B - 900)]);
    fs.utimesSync(transcriptPath(), B - 900, B - 900);
    observe();
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('an unfilled marker with a sidecar no newer than it reads nothing', () => {
    plant(); sidecar(B + 100, 'claude-opus-9-1', UUID, B - 10); writeTranscript([turn(B + 90)]);
    h.sh(`${COUNT_READS} _alias_observe ${ID}`);
    expect(marker()).toBe(`${B} claude opus -`);
    expect(reads()).toBe(0);
    fs.utimesSync(usageFile(), B + 140, B + 140);   // control: newer than the marker, it is read and fills
    h.sh(`${COUNT_READS} _alias_observe ${ID}`);
    expect(reads()).toBe(1);
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('an unchanged sidecar is read once, a changed one again', () => {
    plant(); sidecar(B - 5, 'claude-opus-9-1'); writeTranscript([turn(B + 90)]);
    const changed = JSON.stringify({ ts: B - 4, uuid: UUID, model: 'claude-opus-9-1' });
    h.sh(`${COUNT_READS}
      for _ in 1 2 3 4 5; do _alias_observe ${ID}; done
      echo '${changed}' > "$REG/usage/${ID}.json"; touch -d @${B + 130} "$REG/usage/${ID}.json"
      for _ in 1 2 3 4 5; do _alias_observe ${ID}; done`);
    expect(reads()).toBe(2);
    expect(marker()).toBe(`${B} claude opus -`);
  });

  it('the observe step forks nothing once filled, and nothing with no marker', () => {
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
    plant('claude-opus-9-1'); sidecar(B + 400, 'claude-opus-9-0', UUID, B + 400);
    const filled = trace();
    expect(filled.rc).toBe('0'); expect(filled.err).toBe(''); expect([...filled.pids]).toEqual([]);
  });
});

// ── the tick's wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
const runSupervise = (snippet: string): { code: number; stderr: string } => {
  const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 20000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
};

describe('the observe step is the tick\'s own, outside _route_apply_check', () => {
  it('the fill runs with nothing pending', () => {
    seed();
    // the record and the settle's stamp agree, so `_route_apply_check` returns at its gate 1 and does nothing at all
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=opus"`);
    plant(); sidecar(B + 100, 'claude-opus-9-1'); writeTranscript([turn(B + 90)]);
    const r = runSupervise(`
      systemctl() { :; }; cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }
      _auto_swap_check() { :; }; _auto_compact_check() { :; }
      n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL=""; if (( n <= 3 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
      sleep() { :; }
      cmd_supervise ${ID}`);
    expect(r.stderr).toContain('ended; exiting for systemd restart');
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
    expect(marker()).toBe(`${B} claude opus claude-opus-9-1`);
  });

  it('the call sits on its own line right after the applier\'s, and the applier names it nowhere', () => {
    const lines = ccdSource().split('\n');
    const i = lines.findIndex((l) => l.endsWith('_route_apply_check "$id"') && l.includes('_auto_compact_check "$id"; '));
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]!.trim()).toBe('_alias_observe "$id"');
    const start = lines.findIndex((l) => l.startsWith('_route_apply_check() {'));
    const end = lines.findIndex((l, k) => k > start && l === '}');
    expect(lines.slice(start, end).join('\n')).not.toContain('_alias_observe');
  });
});

describe('caps', () => {
  it('caps lists alias-launch-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('alias-launch-v1');
  });
});
