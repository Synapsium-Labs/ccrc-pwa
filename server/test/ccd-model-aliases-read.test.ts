// Task A3.1 (model classes, Anthropic arm): `ccd/lib/model-aliases.sh`'s one cached reader of a lane's aliases and advance
// files (`_alias_facts_to`), the same reading of a Codex lane's registry and catalogue (`_lane_class_efforts_to`) and the
// one reader of Claude Code's `[1m]` suffix (`_model_id_bare_to`). Fixture HOME only; every id is invented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { parseAliases, serializeAliases } from '../../shared/model-aliases.mjs';
import { seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-alias-read-'); });
afterEach(() => { h.cleanup(); });

const dir = (): string => path.join(h.home, '.ccrc', 'models');
const put = (name: string, text: string): void => {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), name), text);
};
const row = (id: string, efforts: string[] | null) => ({ id, label: null, efforts, defaultEffort: null, minVersion: null });
const entry = (o: Record<string, unknown> = {}) => ({
  id: 'claude-opus-9-1', source: 'cache', evidenceAt: null, idSince: null, seenAt: null, cacheTarget: 'claude-opus-9-1',
  seenId: null, unobserved: false, unlaunchable: null, row: row('claude-opus-9-1', ['low', 'high']), rowFrom: 'own',
  heldRow: null, orphaned: null, ...o,
});
const aliases = (over: Record<string, Record<string, unknown>> = {}): string => {
  const classes: Record<string, unknown> = {};
  for (const c of ['fable', 'opus', 'sonnet', 'haiku']) classes[c] = entry(over[c] ?? {});
  return serializeAliases(parseAliases({
    v: 1, at: '2026-11-01T00:00:00Z', cache: { format: 'current', fetchedAt: '2026-11-01T00:00:00Z' }, stale: false, classes,
  }));
};
const advance = (hold: Record<string, unknown> | null, cls = 'opus'): string => {
  const a = seedAnthropicAdvance() as { classes: Record<string, { hold: unknown }> };
  a.classes[cls]!.hold = hold;
  return serializeAdvance(a as unknown as Parameters<typeof serializeAdvance>[0]);
};
const facts = (cls = 'opus', w = 'claude'): string => h.sh(`_alias_facts_to v ${w} ${cls}; printf %s "$v"`);
const HELD = { at: '2026-11-02T00:00:00Z', by: 'hand', model: 'claude-opus-9-2' };

describe('_alias_facts_to', () => {
  it('answers absent with no aliases file, and ignores an absent advance file', () => {
    expect(facts()).toBe('absent');
    put('claude.aliases.json', aliases());
    expect(facts()).toBe('facts claude-opus-9-1 low,high - - -');
  });

  it('answers unreadable and invalid with the one word naming the file or field', () => {
    put('claude.aliases.json', '{ not json');
    expect(facts()).toBe('invalid json');
    put('claude.aliases.json', aliases());
    put('claude.advance.json', '{ not json');
    expect(facts()).toBe('invalid advance');
    fs.mkdirSync(path.join(dir(), 'claude.advance.json.d'));
    fs.rmSync(path.join(dir(), 'claude.advance.json'));
    fs.symlinkSync('claude.advance.json.d', path.join(dir(), 'claude.advance.json'));
    expect(facts()).toBe('unreadable advance');
    put('claude.aliases.json', aliases().replace('"v": 1', '"v": 2'));
    expect(facts()).toBe('invalid v');
    put('claude.aliases.json', aliases().replaceAll('"id": "claude-opus-9-1"', '"id": "bad id"'));
    expect(facts()).toBe('invalid classes.opus.id');
  });

  it('holds: the held id, orphaned level and the held row\'s efforts, and a hold with no model is not an id', () => {
    put('claude.aliases.json', aliases({ opus: { heldRow: row('claude-opus-9-2', []), orphaned: { id: 'claude-opus-9-0', level: 'xhigh' } } }));
    put('claude.advance.json', advance(HELD));
    expect(facts()).toBe('facts claude-opus-9-1 none claude-opus-9-2 xhigh -');
    put('claude.advance.json', advance({ at: HELD.at, by: 'hand' }));
    expect(facts()).toBe('facts claude-opus-9-1 low,high - xhigh -');
  });

  it('the id is checked: a held model that is no model id is refused, never spliced', () => {
    put('claude.aliases.json', aliases());
    put('claude.advance.json', advance({ ...HELD, model: 'x y' }));
    expect(facts()).toBe('invalid hold.model');
    put('claude.advance.json', advance({ ...HELD, model: 'claude-opus-9-2\n' }));
    expect(facts()).toBe('invalid hold.model');
  });

  it('a held class\'s efforts come from the held id\'s row', () => {
    put('claude.aliases.json', aliases({ opus: { heldRow: row('claude-opus-9-2', ['max']) } }));
    put('claude.advance.json', advance(HELD));
    expect(facts()).toBe('facts claude-opus-9-1 max claude-opus-9-2 - -');
    expect(facts('sonnet')).toBe('facts claude-opus-9-1 low,high - - -');
  });

  it('an unlaunchable id reads as no id', () => {
    put('claude.aliases.json', aliases({ opus: { unlaunchable: { needs: '9.9.9', laneVersion: null }, seenId: 'claude-opus-9-1' } }));
    expect(facts()).toBe('facts - - - - -');
  });

  it('a row with no effort field answers -, and an empty list none', () => {
    put('claude.aliases.json', aliases({ opus: { row: row('claude-opus-9-1', null) }, sonnet: { row: row('claude-opus-9-1', []) } }));
    expect(facts()).toBe('facts claude-opus-9-1 - - - -');
    expect(facts('sonnet')).toBe('facts claude-opus-9-1 none - - -');
  });

  it('seen only when the kept reading is the current id', () => {
    put('claude.aliases.json', aliases({ opus: { id: 'claude-opus-9-2', cacheTarget: 'claude-opus-9-2', seenId: 'claude-opus-9-1' } }));
    expect(facts()).toBe('facts claude-opus-9-2 low,high - - -');
    put('claude.aliases.json', aliases({ opus: { id: 'claude-opus-9-2', cacheTarget: 'claude-opus-9-2', seenId: 'claude-opus-9-2' } }));
    expect(facts()).toBe('facts claude-opus-9-2 low,high - - seen');
  });

  it('an unchanged file forks no jq, and a changed file is re-read', () => {
    put('claude.aliases.json', aliases());
    const count = (): number => {
      const f = path.join(h.home, 'jq-count');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
    };
    const shim = 'jq() { echo x >> "$HOME/jq-count"; command jq "$@"; }';
    const out = h.sh(`${shim}
      _alias_facts_to a claude opus; _alias_facts_to b claude opus; _alias_facts_to c claude fable; _alias_facts_to d claude haiku
      printf '%s|%s|%s|%s' "$a" "$b" "$c" "$d"`);
    expect(out).toBe(Array(4).fill('facts claude-opus-9-1 low,high - - -').join('|'));
    expect(count()).toBe(1);   // four classes, two reads each: one fork
    // one process: warm, rewrite the file, ask again in the SAME shell
    const second = h.sh(`${shim}
      _alias_facts_to a claude opus
      printf '%s' '${aliases({ opus: { row: row('claude-opus-9-1', ['max']) } }).replace(/'/g, '')}' > "$HOME/.ccrc/models/claude.aliases.json"
      _alias_facts_to b claude opus
      printf '%s|%s' "$a" "$b"`);
    expect(second).toBe('facts claude-opus-9-1 low,high - - -|facts claude-opus-9-1 max - - -');
    expect(count()).toBe(3);
  });

  it('a FIFO answers unreadable without blocking', () => {
    put('claude.aliases.json', aliases());
    execFileSync('mkfifo', [path.join(dir(), 'claude.advance.json')]);
    expect(facts()).toBe('unreadable advance');
    fs.rmSync(path.join(dir(), 'claude.aliases.json'));
    execFileSync('mkfifo', [path.join(dir(), 'claude.aliases.json')]);
    expect(facts()).toBe('unreadable aliases');
  });

  it('a class that is not one of the four is refused as data', () => {
    put('claude.aliases.json', aliases());
    expect(facts('default')).toBe('invalid class');
  });
});

describe('_lane_class_efforts_to', () => {
  const eff = (w: string, cls = 'opus'): string => h.sh(`_lane_class_efforts_to v ${w} ${cls}; printf %s "$v"`);
  beforeEach(() => {
    seedAccountsSh(h.home, { version: 1, accounts: [
      { id: 'claude', label: 'AN', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'cx', label: 'CX', configDirSuffix: '.cx', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
    ] });
  });
  const codex = (pin: string | null, models: unknown): void => {
    put('cx.classes.json', JSON.stringify({ v: 1, classes: { opus: pin } }));
    put('cx.json', typeof models === 'string' ? models : JSON.stringify({ models }));
  };

  it('an Anthropic lane answers the facts\' efforts, unknown when the files cannot say', () => {
    expect(eff('claude')).toBe('unknown');
    put('claude.aliases.json', aliases({ opus: { row: row('claude-opus-9-1', []) } }));
    expect(eff('claude')).toBe('none');
  });

  it('a Codex lane answers the catalogue row\'s levels', () => {
    codex('gpt-9-1', [{ id: 'gpt-9-1', efforts: ['low', 'high'] }]);
    expect(eff('cx')).toBe('low,high');
  });

  it('a Codex empty list is -, never none', () => {
    codex('gpt-9-1', [{ id: 'gpt-9-1', efforts: [] }]);
    expect(eff('cx')).toBe('-');
    codex('gpt-9-1', [{ id: 'gpt-9-2', efforts: ['low'] }]);
    expect(eff('cx')).toBe('-');
  });

  it('a Codex lane whose files cannot say answers unknown, and so does a lane of neither kind', () => {
    expect(eff('cx')).toBe('unknown');
    codex('gpt-9-1', '{ not json');
    expect(eff('cx')).toBe('unknown');
    expect(eff('nolane')).toBe('unknown');
  });

  it('a changed Codex file is re-read', () => {
    codex('gpt-9-1', [{ id: 'gpt-9-1', efforts: ['low'] }]);
    const out = h.sh(`_lane_class_efforts_to a cx opus
      printf '%s' '{"models":[{"id":"gpt-9-1","efforts":["high"]}]}' > "$HOME/.ccrc/models/cx.json"
      _lane_class_efforts_to b cx opus; printf '%s|%s' "$a" "$b"`);
    expect(out).toBe('low|high');
  });
});

describe('_model_id_bare_to', () => {
  it('the bare id matches the JS reader, row by row', () => {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'model-id-bare.json'), 'utf8')) as Array<{ raw: string; bare: string }>;
    for (const r of rows) {
      const got = h.sh(`_model_id_bare_to v '${r.raw}'; printf %s "$v"`);
      expect(got, r.raw).toBe(r.bare);
    }
  });
});
