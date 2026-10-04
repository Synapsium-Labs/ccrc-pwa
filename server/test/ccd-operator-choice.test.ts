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
    expect(floorRow(), 'the floor never rotates out, and never moves').toBe(floor);
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
