// The operator's choice survives a restart (session-continuity spec §5.7;
// wave 3). A `/model` or `/effort` typed in a session changes the running
// process only, and the next spawn rebuilds its command line from the route
// record — §1.4 measured an operator's switch to Opus come back as Fable at the
// next auto-home. So before every stop that a spawn follows, ccd reads the
// transcript for the newest of each local command that no journal row explains
// and writes that OPERATOR's choice through `cmd_route`'s own writer
// (`actor=operator-session`), while ccd's own keystrokes — the settle's
// `/effort`, `route --apply` — are journalled in `$REG/<id>.typed` and never
// promoted. Each case is red when its guard is removed (the plan's mutation
// table is the measurement).
//
// FIXTURE HOME ONLY (`makeCcdHarness`): systemd, tmux and every keystroke are
// shell functions that LOG, and the transcript is a file this file writes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE, WS_ADD, CCD } from './ccdWsHelpers.js';
import { familyClassOf, FAMILY_TOKENS } from '../../shared/models.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-operator-choice-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();
const DAY = 86400;

/** The journal's floor (`<epoch> since`), as a spawn by this ccd leaves it —
 *  two days ago unless the case says otherwise, so it is older than every
 *  command a case writes. */
const journal = (id = ID, age = 2 * DAY): void => {
  h.sh(`_reg_set ${id} typed "$(( $(date +%s) - ${age} )) since"`);
};
const seed = (id = ID, opened = true): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} home claude
        _reg_set ${id} project demo
        _reg_set ${id} workdir "$HOME/projects/demo"
        _reg_set ${id} uuid ${UUID}
        _reg_set ${id} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  if (opened) journal(id);
};
/** Route fields, written a day ago — older than every command a case writes,
 *  unless the case says otherwise (THE RECORD WINS WHEN IT IS NEWER). */
const record = (fields: Record<string, string>, id = ID, age = DAY): void => {
  for (const [f, v] of Object.entries(fields)) {
    const p = path.join(h.home, '.cc-sessions', `${id}.${f}`);
    fs.writeFileSync(p, v);
    fs.utimesSync(p, now() - age, now() - age);
  }
};

/** Claude Code 2.1's own rows, field for field as a live transcript has them:
 *  the command envelope, then its acknowledgement as the next row. */
const cmd = (at: number, name: string, args = '', over: Record<string, unknown> = {}): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `c${at}${name}`, timestamp: iso(at),
  message: { role: 'user', content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>` },
  ...over,
});
const ack = (at: number, text: string, over: Record<string, unknown> = {}): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'user', uuid: `k${at}`, timestamp: iso(at),
  message: { role: 'user', content: `<local-command-stdout>${text}</local-command-stdout>` },
  ...over,
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
/** The acknowledgement as the fleet's builds write it (2.1.250 and later:
 *  backticks), and as 2.1.226 wrote it (ANSI bold) — measured read-only over
 *  the fleet box's transcripts while planning. */
const MODEL_ACK = (name: string): string => `Set model to \`${name}\` for this session only`;
const MODEL_ACK_ANSI = (name: string): string => `Set model to \u001b[1m${name}\u001b[22m for this session only`;
const EFFORT_ACK = (level: string): string => `Set effort level to ${level} (this session only)`;
const ULTRACODE_ACK = 'Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration';

const writeTranscript = (lines: string[], id = ID): string => {
  const p = h.sh(`_transcript_path ${id}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
const keep = (id = ID): string => h.sh(`_operator_choice_keep ${id}; echo "rc=$?"`);
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const routeLines = (): string[] => swapLog().split('\n').filter((l) => /^\S+ \S+ route \S+: /.test(l));
/** The journal's KEYSTROKE rows, and its floor row apart. */
const typedRows = (id = ID): string[] => (h.reg(id, 'typed') ?? '').split('\n').filter((l) => / (model|effort) /.test(l));
const floorRow = (id = ID): string | undefined => (h.reg(id, 'typed') ?? '').split('\n')[0] || undefined;

/** The real cmd_swap, with systemd, tmux and the flush wait stubbed (the
 *  `ccd-swap.test.ts` idiom); TMUX is emptied so the detached arm is never taken. */
const SWAP = 'systemctl() { :; }; launchctl() { :; }; tmux() { :; }; sleep() { :; };';

// ── THE JOURNAL ───────────────────────────────────────────────────────────────

describe('ccd journals its own keystrokes in $REG/<id>.typed', () => {
  /** tmux RECORDS and answers `$PANE_TEXT` (the `ccd-route-settle.test.ts` stub). */
  const STUBS = `sleep() { :; };
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
      case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
    _pane_box_draft() { printf ''; };`;
  const READY = '? for shortcuts\n❯ ';

  it('the settle journals its /effort before it types it', () => {
    seed();
    h.sh(`${STUBS} _inject_spawn_effort cc-${ID}`, { PANE_TEXT: READY });
    expect(h.calls()).toContain(`tmux send-keys -t =cc-${ID}: -l /effort ultracode`);
    expect(typedRows()).toHaveLength(1);
    expect(typedRows()[0]).toMatch(/^\d{10} effort ultracode$/);
  });

  it('a session whose record carries an effort types nothing and journals nothing', () => {
    seed(); record({ effort: 'high' });
    h.sh(`${STUBS} _inject_spawn_effort cc-${ID}`, { PANE_TEXT: READY });
    expect(typedRows()).toEqual([]);
  });

  it('route --apply journals the class it types and the effort, and nothing for auto', () => {
    seed(); record({ class: 'sonnet', effort: 'high' });
    const TYPERS = `_route_type_model() { echo "type-model $2" >> "$HOME/ccd-calls"; return 0; };
      _route_type_effort() { echo "type-effort $2" >> "$HOME/ccd-calls"; return 0; };`;
    h.sh(`${TYPERS} _route_apply_now ${ID}`);
    expect(typedRows().map((r) => r.replace(/^\d{10} /, ''))).toEqual(['model sonnet', 'effort high']);
    h.sh(`rm -f "$REG/${ID}.typed" "$REG/${ID}.routeapplied"; _reg_set ${ID} effort auto; ${TYPERS} _route_apply_now ${ID}`);
    expect(typedRows().map((r) => r.replace(/^\d{10} /, ''))).toEqual(['model sonnet']);
  });

  it('the spawn opens the journal at a floor, and a later spawn or keystroke keeps that floor', () => {
    const SPAWN = `tmux() { ${WIDE_PANE} :; }; _spawn_start ${ID} new || :`;
    h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} workdir "$HOME"; _reg_set ${ID} uuid u1; ${SPAWN}`);
    expect(floorRow(), 'the first spawn by this ccd opens the journal').toMatch(/^\d{10} since$/);
    h.sh(`_reg_set ${ID} typed "1000000000 since"; ${SPAWN}; _typed_note ${ID} effort high`);
    expect(floorRow()).toBe('1000000000 since');
    expect(typedRows()).toHaveLength(1);
  });

  it('keeps the last TYPED_KEEP_ROWS keystroke rows below its floor, and refuses a value that is not one token', () => {
    seed();
    const floor = floorRow();
    h.sh(`for i in $(seq 1 20); do _typed_note ${ID} effort "l$i"; done; _typed_note ${ID} effort "a b"; _typed_note ${ID} colour red`);
    const keepRows = Number(h.sh('echo "$TYPED_KEEP_ROWS"'));
    expect(typedRows()).toHaveLength(keepRows);
    expect(typedRows()[keepRows - 1]).toMatch(/ effort l20$/);
    expect(floorRow(), 'the floor is the first row, never rotates out, and never moves backward').toMatch(/^\d{10} since$/);
    expect(Number(floorRow()!.split(' ')[0])).toBeGreaterThanOrEqual(Number(floor!.split(' ')[0]));
  });

  it('a keystroke that rotated out of the journal is still never promoted: the floor follows the rotation', () => {
    seed(); record({ effort: 'high' });
    const keepRows = Number(h.sh('echo "$TYPED_KEEP_ROWS"'));
    const window = Number(h.sh('echo "$TYPED_MATCH_WINDOW"'));
    const first = floorRow()!;
    const t0 = now() - 4000, step = 2 * window;   // each keystroke is its own match window apart
    const times = Array.from({ length: keepRows + 1 }, (_, i) => t0 + i * step);
    // ccd types the settle's /effort ultracode keepRows+1 times, journalling each one (the clock is stubbed per call)
    h.sh(`date() { if [[ "\${1:-}" == +%s ]]; then echo "$T"; else command date "$@"; fi; };
      for T in ${times.join(' ')}; do _typed_note ${ID} effort ultracode; done`);
    writeTranscript(times.flatMap((t) => [cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]));
    expect(typedRows()).toHaveLength(keepRows);
    const floorEpoch = Number(floorRow()!.split(' ')[0]);
    expect(floorRow(), 'the floor keeps its shape and place').toMatch(/^\d{10} since$/);
    expect(floorEpoch, 'the floor moved forward, past the rotated-out row\'s command').toBe(times[0] + window + 1);
    expect(floorEpoch).toBeGreaterThan(Number(first.split(' ')[0]));
    expect(floorEpoch, 'and still precedes every kept row').toBeLessThan(Number(typedRows()[0].split(' ')[0]));
    expect(keep()).toBe('rc=0');
    expect(routeLines(), swapLog()).toEqual([]);
    expect(h.reg(ID, 'effort')).toBe('high');
  });

  it('.typed purges with the row', () => {
    seed();
    h.sh(`_typed_note ${ID} effort high; _reg_purge ${ID}`);
    expect(h.reg(ID, 'typed')).toBeNull();
  });
});

// ── THE VOCABULARY ────────────────────────────────────────────────────────────

describe('a /model value maps through the alias table, then familyClassOf\'s dash-token rule', () => {
  const classOf = (v: string): string => h.sh(`out=$(_model_class_of ${JSON.stringify(v)}); echo "$?|$out"`);

  it('the aliases — ROUTE_CLASSES, each also with [1m] — and an acknowledgement\'s display word', () => {
    for (const [v, c] of [['opus', 'opus'], ['sonnet', 'sonnet'], ['haiku', 'haiku'], ['fable', 'fable'], ['default', 'default'],
      ['opus[1m]', 'opus'], ['sonnet[1m]', 'sonnet'], ['fable[1m]', 'fable'], ['default[1m]', 'default'], ['Opus', 'opus'], ['Default', 'default']]) {
      expect(classOf(v), v).toBe(`0|${c}`);
    }
  });

  it('a full model id through the port, and everything else outside the vocabulary', () => {
    for (const [v, c] of [['claude-opus-5-5', 'opus'], ['claude-fable-5-1', 'fable'], ['claude-sonnet-5', 'sonnet'],
      ['claude-haiku-4-5-20251001', 'haiku'], ['claude-opus-5-5[1m]', 'opus']]) {
      expect(classOf(v), v).toBe(`0|${c}`);
    }
    for (const v of ['gpt-5.6-sol', 'opusml/x', 'vendor/sonnetish', 'opus-x', '?', '']) expect(classOf(v), v).toBe('1|');
  });

  // THE AGREEMENT PIN: `_model_family_class` is a bash port of `familyClassOf`
  // (shared/models.mjs), so the two are run over one corpus and must agree id
  // for id, and ccd's token list must be FAMILY_TOKENS in its own order.
  it('_model_family_class agrees with familyClassOf on every id, and MODEL_FAMILY_TOKENS is FAMILY_TOKENS', () => {
    const corpus = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001',
      'claude-fable-opus-hybrid-1', 'claude-opus-sonnet-x-1', 'claude-sonnet-haiku-2', 'gpt-5.6-sol', 'opusml/x',
      'vendor/sonnetish', 'CLAUDE-OPUS-5-5', 'claude-opus', 'x-haiku-', '-sonnet-', 'anthropic/claude-opus-5-5',
      'us.anthropic.claude-sonnet-5-v1:0', 'opus', 'opus[1m]', ''];
    const bash = h.sh(corpus.map((id) => `out=$(_model_family_class ${JSON.stringify(id)}); echo "[$out]"`).join('; ')).split('\n').map((l) => l.slice(1, -1));
    expect(bash).toHaveLength(corpus.length);
    corpus.forEach((id, i) => expect(bash[i], id).toBe(familyClassOf(id) ?? ''));
    const declared = /^MODEL_FAMILY_TOKENS="([^"]+)"/m.exec(fs.readFileSync(CCD, 'utf8'));
    expect(declared?.[1]).toBe(FAMILY_TOKENS.map(([t, c]) => `${t}:${c}`).join(' '));
  });
});

// ── THE PROMOTION ─────────────────────────────────────────────────────────────

describe('_operator_choice_keep writes the operator\'s own /model and /effort to the record', () => {
  it('/model opus, acknowledged: the class is written through cmd_route, actor=operator-session', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([turn(t - 10), cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')), turn(t + 5)]);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('opus');
    expect(routeLines(), swapLog()).toHaveLength(1);
    expect(routeLines()[0]).toMatch(new RegExp(`route ${ID}: class fable -> opus \\[actor=operator-session\\]`));
  });

  it('the picker takes no argument: its acknowledgement names the value, in either shape Claude Code writes it', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Opus 5.5 (1M context)'))]);
    keep();
    expect(h.reg(ID, 'class'), 'backticks (2.1.250 and later)').toBe('opus');
    record({ class: 'fable' });
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Sonnet 5'))]);
    keep();
    expect(h.reg(ID, 'class'), 'ANSI bold (2.1.226)').toBe('sonnet');
  });

  it('a picker row Claude Code marks (default) is the default class, not the model it resolves to', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Sonnet 5 (default)'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('default');
  });

  it('/effort high, and both kinds in one transcript', () => {
    seed(); record({ class: 'fable', effort: 'ultracode' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(t + 30, 'effort'), ack(t + 30, EFFORT_ACK('high'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
    expect(h.reg(ID, 'effort')).toBe('high');
  });

  it('/effort ultracode as 2.1.284 and later acknowledge it ("Ultracode on …") is read', () => {
    seed(); record({ effort: 'high' }); const t = now() - 600;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, 'Ultracode on (this session only): dynamic workflows on every task. Effort stays medium.')]);
    keep();
    expect(h.reg(ID, 'effort')).toBe('ultracode');
  });

  it('the newest of two acknowledged commands wins', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(t + 60, 'model', 'opus'), ack(t + 60, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('the newest command NO JOURNAL ROW EXPLAINS wins: a later route --apply does not hide the operator\'s own', () => {
    seed(); record({ class: 'fable', degraded: 'opus' }); const t = now() - 600;
    h.sh(`_route_type_model() { return 0; }; _route_apply_now ${ID}`);   // journals `model opus` now: the degraded class
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')), cmd(now() + 5, 'model'), ack(now() + 5, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
  });

  it('an acknowledged command wins over a later one Claude Code refused, which changed nothing', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'sonnet'), ack(t, MODEL_ACK('Sonnet 5')),
      cmd(t + 60, 'model', 'opus'), ack(t + 60, "Model 'opus' is not available on this plan")]);
    keep();
    expect(h.reg(ID, 'class')).toBe('sonnet');
  });

  it('the record wins when it is newer: a field written after the command is not overwritten', () => {
    seed(); record({ class: 'fable' }, ID, 60); const t = now() - 3600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
  });

  it('a field whose time cannot be read is not overwritten', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    h.sh(`_plat_mtime() { return 1; }; _operator_choice_keep ${ID}`);
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('an argument that is not one token is logged with its real size as outside the vocabulary, never split into fields', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus 1712345678'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /model \\(15 bytes, not one token\\) is outside the class vocabulary`));
  });

  it('a session on a non-Anthropic lane is skipped: its /model is never read, logged or written', () => {
    seed(ID, false); record({ class: 'fable' }); h.sh(`_reg_set ${ID} wrapper gpt`); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog(), 'no operator-choice line, no route line').toBe('');
    expect(h.reg(ID, 'typed'), 'a skipped session opens no journal floor either').toBeNull();
  });

  // ── a lane change moves the journal floor: what was typed on the other lane is never read ──

  it('a swap between a non-Anthropic and an Anthropic lane moves the journal floor to its landing: a later stop reads nothing typed before it', () => {
    seed(); record({ class: 'fable' }); h.sh(`_reg_set ${ID} wrapper gpt`); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    const before = now();
    h.sh(`${SWAP} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(Number(floorRow()!.split(' ')[0]), 'the floor is at or after the landing').toBeGreaterThanOrEqual(before);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog(), 'no operator-choice line from the gpt lane\'s /model').not.toMatch(/operator-choice/);
  });

  it('control: the same /model typed on an Anthropic lane, swapped to another Anthropic lane, is still read (and logged)', () => {
    seed(); record({ class: 'fable' }); h.sh(`_reg_set ${ID} wrapper claude-d`); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`${SWAP} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude`, { TMUX: '' });
    keep();
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /model gpt-5\\.6-sol is outside the class vocabulary`));
  });

  it('the floor only ever moves forward: a lane change never moves it back, and keeps the journal\'s rows', () => {
    seed(); journal(ID, -3600);
    h.sh(`_typed_note ${ID} effort high`);
    const floor = floorRow();
    h.sh(`_typed_note ${ID} moved`);
    expect(floorRow()).toBe(floor);
    expect(typedRows()).toHaveLength(1);
  });

  it('a value the record already holds is not written again', () => {
    seed(); record({ class: 'opus' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(routeLines()).toEqual([]);
  });

  it('a human QUOTING the envelope is not a command, even above an acknowledgement', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    const quoting = JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', uuid: 'q', timestamp: iso(t),
      message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args>opus</command-args>\nthat is what I typed yesterday' } });
    writeTranscript([quoting, ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('a subagent\'s row is not the operator\'s', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus', { isSidechain: true }), ack(t, MODEL_ACK('Opus 5.5'), { isSidechain: true })]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
  });

  it('nothing to read is silent: no transcript, or no registry row — rc 0, nothing written, nothing logged', () => {
    seed(); record({ class: 'fable' });
    expect(keep()).toBe('rc=0');
    expect(keep('nobody-here')).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toBe('');
  });

  it('could not measure is said, never silent: a directory for a transcript, no python3, a reader that failed — rc 0, the record unchanged', () => {
    seed(); record({ class: 'fable' });
    const p = writeTranscript([cmd(now() - 600, 'model', 'opus'), ack(now() - 600, MODEL_ACK('Opus 5.5'))]);
    expect(h.sh(`command() { [[ "$*" == "-v python3" ]] && return 1; builtin command "$@"; }; _operator_choice_keep ${ID}; echo "rc=$?"`)).toBe('rc=0');
    expect(h.sh(`python3() { return 1; }; _operator_choice_keep ${ID}; echo "rc=$?"`)).toBe('rc=0');
    fs.rmSync(p); fs.mkdirSync(p);
    expect(keep()).toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog().split('\n').filter(Boolean).map((l) => l.replace(/^\S+ \S+ /, ''))).toEqual([
      `operator-choice ${ID}: unmeasured (no python3)`,
      `operator-choice ${ID}: unmeasured (the transcript reader failed)`,
      `operator-choice ${ID}: unmeasured (its transcript is not a readable regular file)`,
    ]);
  });

  it('a FIFO where the transcript should be is never opened: the stop is not held, and it is said', () => {
    seed(); record({ class: 'fable' });
    const p = h.sh(`_transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    h.sh(`mkfifo ${JSON.stringify(p)}`);
    const out = h.sh(`_operator_choice_keep ${ID} & pid=$!
      for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      if kill -0 "$pid" 2>/dev/null; then kill "$pid"; : > ${JSON.stringify(p)}; echo held; else wait "$pid"; echo "rc=$?"; fi`);
    expect(out, 'a grep on a FIFO blocks the stop until somebody writes to it').toBe('rc=0');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: unmeasured \\(its transcript is not a readable regular file\\)`));
  });

  // ── the journal's floor: what an older ccd typed is never the operator's ──

  it('a session with no journal yet (spawned by an older ccd) promotes nothing at its first stop, opens the journal, and says so', () => {
    seed(ID, false); const t = now() - 7200;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);   // an older ccd's settle, never journalled
    keep();
    expect(h.reg(ID, 'effort'), 'the box default became an operator choice at the deploy').toBeNull();
    expect(floorRow()).toMatch(/^\d{10} since$/);
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: unmeasured \\(its journal opened only now`));
    keep();
    expect(h.reg(ID, 'effort'), 'and at its second: the command is older than the floor').toBeNull();
  });

  it('a command older than the journal\'s floor is not read', () => {
    seed(ID, false); journal(ID, 1800); record({ class: 'fable' }); const t = now() - 3600;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Opus 5.5'))]);   // an older ccd's route --apply
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toBe('');
  });

  // ── the spec's four mutation rows ──

  it('the settle /effort on a session with no effort field is not promoted', () => {
    seed();
    h.sh(`sleep() { :; }; tmux() { ${WIDE_PANE} case "\${1:-}" in capture-pane) printf '? for shortcuts\\n❯ \\n' ;; esac; return 0; };
      _pane_box_draft() { printf ''; }; _inject_spawn_effort cc-${ID}`);
    const t = now() + 2;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);
    keep();
    expect(h.reg(ID, 'effort'), 'the box default became an operator choice').toBeNull();
  });

  it('control: the same /effort an hour from any journalled keystroke is the operator\'s', () => {
    seed();
    h.sh(`_typed_note ${ID} effort ultracode; _reg_set ${ID} typed "$(sed "2s/^[0-9]*/$(( $(date +%s) - 3600 ))/" "$REG/${ID}.typed")"`);
    const t = now() - 10;
    writeTranscript([cmd(t, 'effort', 'ultracode'), ack(t, ULTRACODE_ACK)]);
    keep();
    expect(h.reg(ID, 'effort')).toBe('ultracode');
  });

  it('a route --apply /model is not promoted — not even a degraded class typed over the operator\'s fable, in either acknowledgement shape', () => {
    seed(); record({ class: 'fable', degraded: 'opus' });
    h.sh(`_route_type_model() { return 0; }; _route_apply_now ${ID}`);
    const t = now() + 5;
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK('Opus 5.5'))]);
    keep();
    writeTranscript([cmd(t, 'model'), ack(t, MODEL_ACK_ANSI('Opus 5.5'))]);
    keep();
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(routeLines()).toEqual([]);
    expect(swapLog(), 'nor logged as a revert').toBe('');
  });

  it('an unmappable value does not abort a swap: logged, the record unchanged, and the swap lands', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(h.reg(ID, 'class')).toBe('fable');
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /model gpt-5\\.6-sol is outside the class vocabulary — the record is unchanged`));
  });

  it('…nor does a value the record\'s own checks refuse (haiku takes no effort level)', () => {
    seed(); record({ class: 'haiku' }); const t = now() - 600;
    writeTranscript([cmd(t, 'effort', 'high'), ack(t, EFFORT_ACK('high'))]);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(h.reg(ID, 'effort')).toBeNull();
    expect(swapLog()).toMatch(new RegExp(`operator-choice ${ID}: /effort high refused by the route record's own checks`));
  });

  it('an operator /model opus survives an auto-home: the home-ward swap writes it before its stop, and the next spawn composes opus', () => {
    seed(); h.sh(`_reg_set ${ID} wrapper claude-d`); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5')), turn(t + 5)]);
    h.sh(`${SWAP} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(h.sh(`_route_wanted ${ID}`).split(' ')[0], 'the class the spawn and the applier compose').toBe('opus');
    const log = swapLog().split('\n');
    const route = log.findIndex((l) => l.includes(` route ${ID}: class fable -> opus [actor=operator-session]`));
    const landed = log.findIndex((l) => l.includes(` swap ${ID}: claude-d -> claude `));
    expect(route).toBeGreaterThan(-1);
    expect(landed).toBeGreaterThan(route);
  });
});

// ── EVERY STOP THAT A SPAWN FOLLOWS ───────────────────────────────────────────

describe('every stop that a spawn follows keeps the operator\'s choice first', () => {
  it('ccd stop: `ccd start`/`enable` respawn from the record', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    h.sh(`_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; }; tmux() { :; }; cmd_stop ${ID}`);
    expect(h.calls()).toContain(`unsupervise ${ID}`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('a supervisor revival: cmd_ensure in the unit keeps the operator\'s /model before its spawn', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))]);
    h.sh(`_alive() { return 1; }
      _spawn_start() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return 0; }
      _spawn_settle() { echo "settle $1" >> "$HOME/ccd-calls"; return 0; }
      CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(h.reg(ID, 'class')).toBe('opus');
    expect(h.sh(`_route_wanted ${ID}`).split(' ')[0]).toBe('opus');
    expect(routeLines().some((l) => l.includes(`route ${ID}: class fable -> opus [actor=operator-session]`)), swapLog()).toBe(true);
    expect(h.calls()).toContain(`spawn ${ID} resume`);
  });

  // ── ONE READ PER RESTART: a stop's keep and the supervised spawn after it are one restart ──

  const ENSURE_STUBS = `_alive() { return 1; }
      _spawn_start() { echo "spawn $1 $2" >> "$HOME/ccd-calls"; return 0; }
      _spawn_settle() { echo "settle $1" >> "$HOME/ccd-calls"; return 0; }`;
  const oocLines = (): number => swapLog().split('\n').filter((l) => l.includes(`operator-choice ${ID}: /model gpt-5.6-sol is outside the class vocabulary`)).length;

  it('a swap logs an out-of-vocabulary /model once: the landing\'s cmd_ensure does not read again', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(oocLines(), 'the stop\'s keep').toBe(1);
    expect(fs.existsSync(regFile(`${ID}.choicekept`)), 'the stop\'s keep left its marker').toBe(true);
    h.sh(`${ENSURE_STUBS}; CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(h.calls()).toContain(`spawn ${ID} resume`);
    expect(oocLines(), 'the landing\'s spawn did not read again').toBe(1);
  });

  it('after a stop\'s keep and a spawn the marker is gone, so a later revival reads again', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`_operator_choice_keep ${ID}`);
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(true);
    h.sh(`tmux() { ${WIDE_PANE} :; }; _spawn_start ${ID} resume || :`);
    expect(fs.existsSync(regFile(`${ID}.choicekept`)), 'every spawn ends the marker').toBe(false);
    h.sh(`${ENSURE_STUBS}; CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(oocLines(), 'the revival read').toBe(2);
  });

  it('ccd ws-archive: ws-restore respawns from the record', () => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const WS = 'demo-quiet-basin';
    journal(WS); record({ class: 'fable' }, WS); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, MODEL_ACK('Opus 5.5'))], WS);
    const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; }; tmux() { return 1; }; _session_verdict() { echo gone; };`;
    expect(h.sh(`${ARCH} cmd_ws_archive --session ${WS}`)).toMatch(/^archived /);
    expect(h.reg(WS, 'class')).toBe('opus');
  });

  // THE CENSUS OF STOPS. Every function in ccd that stops a session — a
  // `tmux kill-session`, a `claude-session@` unit stopped or booted out, or a
  // `_ws_unsupervise` — is named here: either a stop a spawn follows, which
  // must call `_operator_choice_keep` as the statement before its stop, or a
  // stop after which no spawn follows, with the reason. A NEW function that
  // stops a session is in neither list, and this reds until it is classified.
  it('every stop in ccd is classified: three keep the operator\'s choice first, the rest end the row', () => {
    const KEEPS = ['cmd_stop', 'cmd_swap', 'cmd_ws_archive'];
    // A revival follows no ccd stop (cmd_supervise -> cmd_ensure, after Claude Code
    // exited — most often a pane-scope OOM kill), so its keep sits before its own
    // spawn rather than before a stop; it holds no stop line, so it is not a KEEP.
    // It runs only when no keep has run since the last spawn (`choicekept`), so the
    // spawn a stop's keep already read for does not read, or log, a second time.
    const REVIVES = ['cmd_ensure'];
    const ENDS: Record<string, string> = {
      cmd_ws_rm: 'the workspace and its row are removed',
      cmd_forget: 'the row is forgotten',
      _ws_reap_tail: 'the reap ends the row',
      _ws_reclaim_tail: 'the reclaim ends the child row',
      cmd_account_pane: 'an account\'s login pane, not a session',
      cmd_supervise: 'a crash loop\'s give-up: Claude Code already exited, and no ccd stop precedes a revival',
    };
    const src = fs.readFileSync(CCD, 'utf8').split('\n');
    const owner = (i: number): string => {
      for (let j = i; j >= 0; j--) { const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(src[j]!); if (m) return m[1]!; }
      return '';
    };
    const STOP = /tmux kill-session|_svc_stop "claude-session@|bootout .*claude-session@|_ws_unsupervise "/;
    const live = (l: string): boolean => !/^\s*#/.test(l);
    const stoppers = new Set(src.flatMap((l, i) => (live(l) && STOP.test(l) ? [owner(i)] : [])));
    expect([...stoppers].sort(), 'a function that stops a session is in neither list').toEqual([...KEEPS, ...Object.keys(ENDS)].sort());
    const sites = src.flatMap((l, i) => (live(l) && l.includes('_operator_choice_keep "$id"') ? [i] : []));
    expect(sites.map(owner).sort()).toEqual([...KEEPS, ...REVIVES].sort());
    for (const i of sites) {
      const fn = owner(i);
      if (fn === 'cmd_swap') expect(src[i + 1]).toMatch(/^ {2}_svc_stop "claude-session@\$id"/);
      if (fn === 'cmd_stop') expect(src[i + 1]).toMatch(/^ {2}_ws_unsupervise "\$id" "\$surface" "\$declared"$/);
      if (fn === 'cmd_ensure') {
        expect(src[i]).toMatch(/^ {2}\[\[ -e "\$REG\/\$id\.choicekept" \]\] \|\| _operator_choice_keep "\$id" /);
        expect(src[i + 1]).toMatch(/^ {2}_spawn_start "\$id" "\$mode" \|\| return \$\?$/);
      }
      if (fn === 'cmd_ws_archive') expect(src[i]).toMatch(/^ {2}_operator_choice_keep "\$id"; _ws_unsupervise "\$id" /);
    }
  });
});
